"""
VoiceL2D Client - Backend service for voice-controlled Live2D.

This client runs as a background service that:
- Listens for commands from the frontend via WebSocket
- Records audio from microphone with VAD detection (when enabled)
- Transcribes speech using ASR (GLM-ASR API or Faster-Whisper local)
- Integrates with LLM for conversation
- Manages TTS voice generation with sentence-by-sentence synthesis
- Sends audio and messages to frontend via WebSocket
- Coordinates with MCP server for Live2D expressions

ASR Mode is controlled via ASR_MODE environment variable:
- 'api' (default): Uses GLM-ASR cloud API (requires ZHIPU_API_KEY)
- 'local': Uses Faster-Whisper locally (requires: uv sync --extra local-asr)

No interactive terminal input - all control is via frontend.
"""

import asyncio
import json
import os
import re
import time
from typing import Any, Optional

import numpy as np
from dotenv import load_dotenv
from fastmcp import Client
from loguru import logger as lg
from openai import OpenAI
from utils import (
    AudioRecorder,
    AudioWebSocketServer,
    CharacterManager,
    ContinuousVAD,
    TTSController,
    config,
    create_asr_controller,
)

# region ==== Config ====
load_dotenv()

# LLM Configuration (API key from .env, rest from config.toml)
API_KEY = os.getenv("ZHIPU_API_KEY")
BASE_URL = config.llm_base_url
MODEL_NAME = config.llm_model

# MCP Server Configuration
MCP_SERVER_URL = config.mcp_server_url

# WebSocket Configuration
WEBSOCKET_HOST = config.websocket_host
WEBSOCKET_PORT = config.websocket_port

# VAD Configuration
VAD_AGGRESSIVENESS = config.vad_aggressiveness
SILENCE_THRESHOLD = config.vad_silence_threshold
MIN_SPEECH_DURATION = config.vad_min_speech_duration

# Audio Configuration
AUDIO_SAMPLE_RATE = config.audio_sample_rate
AUDIO_CHANNELS = config.audio_channels
AUDIO_BLOCK_SIZE = config.audio_block_size

# endregion


def split_into_sentences(text: str, max_segments: int = 2) -> list[str]:
    """
    Split text into sentences for sequential TTS processing.

    Limits output to max_segments (default 2) to avoid excessive splitting.
    Handles Chinese and English punctuation marks.

    Args:
        text: Text to split
        max_segments: Maximum number of segments to return (default 2)

    Returns:
        List of sentences (at most max_segments)
    """
    # Pattern for sentence-ending punctuation (Chinese and English)
    pattern = r"([。！？；.!?;]+|\.{3}|……)"

    # Split but keep delimiters
    parts = re.split(pattern, text)

    # Combine sentences with their ending punctuation
    sentences = []
    current = ""

    for part in parts:
        if not part.strip():
            continue
        current += part
        if re.match(pattern, part):
            if current.strip():
                sentences.append(current.strip())
            current = ""

    if current.strip():
        sentences.append(current.strip())

    sentences = [s for s in sentences if len(s) > 1]

    if len(sentences) > max_segments:
        merged = []
        sentences_per_segment = len(sentences) // max_segments
        remainder = len(sentences) % max_segments

        idx = 0
        for i in range(max_segments):
            count = sentences_per_segment + (1 if i < remainder else 0)
            segment = "".join(sentences[idx : idx + count])
            if segment:
                merged.append(segment)
            idx += count

        sentences = merged

    return sentences


class VoiceL2DClient:
    """
    Main client for VoiceL2D system.

    Runs as a background service, controlled via WebSocket commands from frontend.
    """

    def __init__(self):
        """Initialize the VoiceL2D client."""

        # LLM client
        self.llm = OpenAI(api_key=API_KEY, base_url=BASE_URL)

        # MCP client for Live2D control
        self.mcp_client = Client(MCP_SERVER_URL)

        # TTS controller
        self.tts = TTSController()

        # Character manager (handles both persona prompts and voice configs)
        self.character_manager = CharacterManager()

        # ASR controller (auto-selects based on ASR_MODE env var)
        self.asr = create_asr_controller()

        # Audio recorder
        self.recorder = AudioRecorder(
            sample_rate=AUDIO_SAMPLE_RATE,
            channels=AUDIO_CHANNELS,
            block_size=AUDIO_BLOCK_SIZE,
        )

        # VAD detector
        self.vad = ContinuousVAD(
            sample_rate=AUDIO_SAMPLE_RATE,
            aggressiveness=VAD_AGGRESSIVENESS,
            silence_threshold=SILENCE_THRESHOLD,
        )

        # WebSocket server
        self.ws_server = AudioWebSocketServer(WEBSOCKET_HOST, WEBSOCKET_PORT)

        # Conversation history (multi-turn context)
        self.messages: list[dict] = []

        # Voice caching (track loaded TTS voice)
        self._loaded_character: Optional[str] = None

        # Recording state - starts OFF, frontend controls it
        self._is_listening = False

        # Audio playback lock - prevents recording during TTS playback
        self._audio_lock_until: float = 0.0  # Timestamp when lock expires
        self._audio_lock_buffer: float = config.audio_lock_buffer  # Extra seconds

        # Asyncio primitives (created lazily)
        self._processing_lock: Optional[asyncio.Lock] = None
        self._text_input_queue: Optional[asyncio.Queue[tuple[str, str]]] = None

        # MCP tools config (set after connection)
        self._tools_config: Optional[list[dict]] = None

        # Event loop reference (set when run() starts)
        self._event_loop: Optional[asyncio.AbstractEventLoop] = None

    def _ensure_async_primitives(self) -> None:
        """Ensure asyncio primitives are created."""
        if self._processing_lock is None:
            self._processing_lock = asyncio.Lock()
        if self._text_input_queue is None:
            self._text_input_queue = asyncio.Queue()

    def _is_audio_locked(self) -> bool:
        """Check if audio playback lock is active."""
        return time.time() < self._audio_lock_until

    def _calculate_audio_duration(self, audio_data: bytes) -> float:
        """
        Calculate audio duration from WAV data.

        Args:
            audio_data: WAV audio data as bytes

        Returns:
            Duration in seconds
        """
        # GPT-SoVITS outputs: 32000Hz, 1 channel, 16-bit (2 bytes per sample)
        sample_rate = 32000
        bytes_per_sample = 2
        channels = 1

        # WAV header is 44 bytes
        audio_bytes = len(audio_data) - 44
        if audio_bytes <= 0:
            return 0.0

        samples = audio_bytes // (bytes_per_sample * channels)
        return samples / sample_rate

    def _lock_audio_sync(self) -> None:
        """
        Synchronously lock microphone (thread-safe).

        Call this BEFORE starting TTS generation to prevent
        any new audio from being captured.
        """
        # Set a very long lock initially (will be updated when we know duration)
        self._audio_lock_until = time.time() + 60.0  # 60s max

        # Pause VAD to stop all speech detection during TTS
        self.vad.pause()

        lg.info("[AudioLock] 🔒 Locked (TTS starting)")

    async def _lock_audio(self, duration: float) -> None:
        """
        Lock microphone during audio playback.

        Args:
            duration: Audio duration in seconds
        """
        lock_duration = duration + self._audio_lock_buffer
        self._audio_lock_until = time.time() + lock_duration

        # Ensure VAD is paused (should already be from _lock_audio_sync)
        if not self.vad.is_paused:
            self.vad.pause()

        await self.ws_server.send_audio_lock(True, lock_duration)
        lg.debug(f"[AudioLock] Locked for {lock_duration:.1f}s")

    async def _unlock_audio(self, forced: bool = False) -> None:
        """
        Unlock microphone after audio playback.

        Args:
            forced: If True, this was a forced unlock due to timeout
        """
        was_locked = self._audio_lock_until > 0
        self._audio_lock_until = 0.0

        # Resume VAD processing
        self.vad.resume()

        if was_locked:
            await self.ws_server.send_audio_lock(False)
            if forced:
                lg.warning("[AudioLock] ⚠️ Forced unlock - playback may have failed")
            else:
                lg.info("[AudioLock] 🔓 Unlocked")

    async def _check_audio_lock_timeout(self) -> None:
        """Check and handle audio lock timeout."""
        if self._audio_lock_until > 0 and time.time() >= self._audio_lock_until:
            await self._unlock_audio(forced=True)

    def _adapt_tools(self, tools) -> list[dict]:
        """Convert FastMCP tool objects to OpenAI format."""
        openai_tools = []
        for tool in tools:
            openai_tools.append({
                "type": "function",
                "function": {
                    "name": tool.name,
                    "description": tool.description,
                    "parameters": tool.inputSchema,
                },
            })
        return openai_tools

    async def _call_mcp_tool(self, tool_name: str, tool_args: dict) -> str:
        """Call an MCP tool and return the result."""
        try:
            result = await self.mcp_client.call_tool(tool_name, arguments=tool_args)
            output_text = ""
            if hasattr(result, "content") and isinstance(result.content, list):
                for item in result.content:
                    if hasattr(item, "text"):
                        output_text += item.text
                    else:
                        output_text += str(item)
            else:
                output_text = str(result)
            return output_text
        except Exception as e:
            lg.error(f"[VoiceL2DClient] MCP tool call failed: {e}")
            return f"Error: {str(e)}"

    def _ensure_voice_loaded(self) -> bool:
        """Ensure the current character's voice is loaded on TTS server."""
        voice_config = self.character_manager.get_current_voice()
        if not voice_config:
            lg.warning("[VoiceL2DClient] No voice configured for current character")
            return False

        current_character = self.character_manager.current_character

        if self._loaded_character == current_character:
            return True

        lg.debug(f"[TTS] Loading voice for character: {current_character}")
        if self.tts.load_voice(voice_config):
            self._loaded_character = current_character
            return True
        else:
            lg.error(f"[VoiceL2DClient] Failed to load voice for: {current_character}")
            return False

    async def speak(self, text: str) -> None:
        """Generate and send TTS audio for the given text."""
        if not self._ensure_voice_loaded():
            return

        voice_config = self.character_manager.get_current_voice()
        if not voice_config:
            return

        sentences = split_into_sentences(text)
        if not sentences:
            lg.warning("[VoiceL2DClient] No sentences to speak")
            return

        lg.debug(f"[TTS] Speaking {len(sentences)} sentence(s)")

        # IMPORTANT: Lock microphone BEFORE generating audio
        # This prevents any new audio from being captured during TTS
        self._lock_audio_sync()
        await self.ws_server.send_status("speaking")

        # Generate all audio chunks
        total_duration = 0.0
        audio_chunks: list[tuple[str, bytes]] = []

        try:
            for sentence in sentences:
                lg.debug(f"[TTS] Generating: {sentence[:30]}...")
                audio_data = self.tts.generate_audio(sentence, voice_config)

                if audio_data:
                    audio_chunks.append((sentence, audio_data))
                    total_duration += self._calculate_audio_duration(audio_data)
                else:
                    lg.error(f"[TTS] Failed: {sentence[:30]}...")

            # Update lock with actual duration (add buffer for safety)
            if audio_chunks:
                # Set lock duration with extra buffer for network/playback delays
                lock_timeout = total_duration + self._audio_lock_buffer + 5.0
                await self._lock_audio(lock_timeout)

                # Send all audio chunks to frontend
                for i, (sentence, audio_data) in enumerate(audio_chunks):
                    await self.ws_server.send_audio(audio_data, sentence)
                    if i < len(audio_chunks) - 1:
                        await asyncio.sleep(0.1)  # Small delay between sends

                # Wait for frontend to confirm playback is complete
                lg.debug("[TTS] Waiting for frontend playback to complete...")
                playback_completed = await self.ws_server.wait_for_playback_complete(
                    timeout=lock_timeout
                )

                if not playback_completed:
                    lg.warning("[TTS] Playback wait timed out")

        finally:
            # Always unlock when done (even if error occurred)
            await self._unlock_audio()
            await self.ws_server.send_status("idle")

    def get_characters_info(self) -> list[dict[str, Any]]:
        """Get list of available characters with their info."""
        return self.character_manager.get_all_characters_info()

    def switch_character(self, char_id: str) -> bool:
        """
        Switch to a different character.

        This changes the persona prompt and TTS voice, and clears chat history.

        Args:
            char_id: Character ID (e.g., "Paimon")

        Returns:
            True if switch was successful
        """
        if self.character_manager.switch_character(char_id):
            # Clear conversation history for new character
            self.messages.clear()
            lg.info(f"[Character] Switched to: {char_id}, chat history cleared")
            return True
        return False

    def refresh_prompt(self) -> bool:
        """
        Refresh the current character's prompt from file.

        Useful for hot-reloading prompt changes without restarting.

        Returns:
            True if refresh was successful
        """
        return self.character_manager.refresh_prompt()

    async def process_user_input(
        self, text: str, source: str = "text"
    ) -> Optional[str]:
        """Process user input and generate response."""
        self._ensure_async_primitives()
        assert self._processing_lock is not None

        async with self._processing_lock:
            await self.ws_server.send_user_message(text, source)
            await self.ws_server.send_status("processing")

            lg.info(f"[Input] ({source}) {text[:40]}...")

            if self._tools_config:
                response = await self.chat_with_tools(text, self._tools_config)
            else:
                response = await self.chat(text)

            lg.info(f"[LLM] {response[:50]}...")

            await self.ws_server.send_ai_message(response)

            if response:
                await self.speak(response)

            return response

    async def chat(self, user_message: str) -> str:
        """Process a user message and generate a response."""
        self.messages.append({"role": "user", "content": user_message})

        # Get current character's system prompt
        system_prompt = self.character_manager.get_current_prompt()

        messages_to_send = []
        if system_prompt:
            messages_to_send.append({"role": "system", "content": system_prompt})
        messages_to_send.extend(self.messages)

        response = self.llm.chat.completions.create(
            model=MODEL_NAME,
            messages=messages_to_send,
        )

        assistant_message = response.choices[0].message.content or ""
        self.messages.append({"role": "assistant", "content": assistant_message})

        return assistant_message

    async def chat_with_tools(self, user_message: str, tools_config: list[dict]) -> str:
        """Process a user message with tool support."""
        self.messages.append({"role": "user", "content": user_message})

        # Get current character's system prompt
        system_prompt = self.character_manager.get_current_prompt()

        messages_to_send = []
        if system_prompt:
            messages_to_send.append({"role": "system", "content": system_prompt})
        messages_to_send.extend(self.messages)

        response = self.llm.chat.completions.create(
            model=MODEL_NAME,
            messages=messages_to_send,
            tools=tools_config,
            tool_choice="auto",
        )

        ai_msg = response.choices[0].message

        if ai_msg.tool_calls:
            self.messages.append({
                "role": "assistant",
                "content": ai_msg.content,
                "tool_calls": [
                    {
                        "id": tc.id,
                        "type": tc.type,
                        "function": {
                            "name": tc.function.name,
                            "arguments": tc.function.arguments,
                        },
                    }
                    for tc in ai_msg.tool_calls
                ],
            })

            for tool_call in ai_msg.tool_calls:
                tool_name = tool_call.function.name
                tool_args = json.loads(tool_call.function.arguments)

                lg.info(f"[MCP] Tool: {tool_name}")
                result = await self._call_mcp_tool(tool_name, tool_args)

                self.messages.append({
                    "role": "tool",
                    "tool_call_id": tool_call.id,
                    "content": result,
                })

            messages_to_send = []
            if system_prompt:
                messages_to_send.append({
                    "role": "system",
                    "content": system_prompt,
                })
            messages_to_send.extend(self.messages)

            final_response = self.llm.chat.completions.create(
                model=MODEL_NAME,
                messages=messages_to_send,
                tools=tools_config,
            )

            assistant_message = final_response.choices[0].message.content or ""
            # Append final assistant message after tool calls
            self.messages.append({"role": "assistant", "content": assistant_message})
        else:
            assistant_message = ai_msg.content or ""
            # Append assistant message when no tool calls
            self.messages.append({"role": "assistant", "content": assistant_message})

        return assistant_message

    def _on_speech_segment(self, audio_data: np.ndarray) -> None:
        """Callback when a speech segment is detected.

        This is called from the audio recording thread, so we need to use
        call_soon_threadsafe to schedule the async processing.
        """
        if self._event_loop is None:
            lg.warning("[VoiceL2DClient] Event loop not set, cannot process speech")
            return

        # Check audio lock (thread-safe check)
        if self._is_audio_locked():
            lg.info("[VAD] 🔇 Ignoring speech segment - audio locked")
            return

        # Schedule the coroutine on the main event loop from this thread
        self._event_loop.call_soon_threadsafe(
            lambda: asyncio.create_task(self._process_speech_segment(audio_data))
        )

    async def _process_speech_segment(self, audio_data: np.ndarray) -> None:
        """Process a detected speech segment."""
        # Double-check lock and listening state
        if not self._is_listening or self._is_audio_locked():
            lg.debug("[VAD] Ignoring segment - locked or not listening")
            return

        # Calculate audio duration
        audio_duration = len(audio_data) / AUDIO_SAMPLE_RATE

        # Minimum duration check
        if audio_duration < MIN_SPEECH_DURATION:
            lg.debug(
                f"[VAD] Audio too short ({audio_duration:.2f}s < {MIN_SPEECH_DURATION}s), ignoring"
            )
            if self._is_listening:
                await self.ws_server.send_status("listening")
            return

        lg.debug(
            f"[VAD] Speech detected ({audio_duration:.2f}s, {len(audio_data)} samples)"
        )

        await self.ws_server.send_status("processing", "Transcribing...")
        text = self.asr.transcribe(audio_data, sample_rate=AUDIO_SAMPLE_RATE)

        if text and text.strip():
            lg.info(f"[ASR] {text}")
            self._ensure_async_primitives()
            assert self._text_input_queue is not None
            await self._text_input_queue.put(("voice", text))
        else:
            lg.debug("[ASR] Empty result")
            if self._is_listening:
                await self.ws_server.send_status("listening")

    async def _process_text_input_queue(self) -> None:
        """Process text inputs from the queue."""
        self._ensure_async_primitives()
        assert self._text_input_queue is not None

        while True:
            try:
                source, text = await asyncio.wait_for(
                    self._text_input_queue.get(), timeout=0.5
                )
                await self.process_user_input(text, source)

                if self._is_listening:
                    await self.ws_server.send_status("listening")

            except asyncio.TimeoutError:
                continue
            except asyncio.CancelledError:
                break
            except Exception as e:
                lg.error(f"[VoiceL2DClient] Error processing input: {e}")

    async def _handle_frontend_command(self, command: str, data: dict) -> dict:
        """
        Handle commands from frontend.

        Args:
            command: Command type
            data: Command data

        Returns:
            Response dict
        """
        lg.debug(f"[VoiceL2DClient] Frontend command: {command}")

        if command == "toggle_listening":
            # Prevent toggling during audio lock
            if self._is_audio_locked():
                return {
                    "success": False,
                    "error": "Audio playback in progress",
                    "listening": self._is_listening,
                    "locked": True,
                }
            enabled = data.get("enabled", not self._is_listening)
            if enabled and not self._is_listening:
                await self.start_listening()
            elif not enabled and self._is_listening:
                self.stop_listening()
                await self.ws_server.send_status("idle")
            return {"success": True, "listening": self._is_listening}

        elif command == "get_characters":
            characters = self.get_characters_info()
            return {"success": True, "characters": characters}

        elif command == "switch_character":
            char_id = data.get("character_id")
            if char_id:
                success = self.switch_character(char_id)
                return {
                    "success": success,
                    "current_character": self.character_manager.current_character,
                }
            return {"success": False, "error": "No character_id provided"}

        elif command == "refresh_prompt":
            success = self.refresh_prompt()
            return {
                "success": success,
                "current_character": self.character_manager.current_character,
            }

        elif command == "get_status":
            current_char = self.character_manager.get_current_character()
            return {
                "success": True,
                "listening": self._is_listening,
                "audio_locked": self._is_audio_locked(),
                "current_character": self.character_manager.current_character,
                "current_character_name": current_char.name if current_char else None,
                "loaded_character": self._loaded_character,
            }

        else:
            return {"success": False, "error": f"Unknown command: {command}"}

    def _on_frontend_message(self, message: str) -> None:
        """Handle messages from frontend WebSocket."""
        try:
            data = json.loads(message)
            msg_type = data.get("type")

            if msg_type == "text_input":
                text = data.get("text", "").strip()
                if text and self._event_loop:
                    self._ensure_async_primitives()
                    assert self._text_input_queue is not None
                    # Schedule on event loop from callback thread
                    self._event_loop.call_soon_threadsafe(
                        lambda t=text: asyncio.create_task(
                            self._text_input_queue.put(("text", t))  # type: ignore
                        )
                    )

            elif msg_type == "command":
                command = data.get("command")
                if command and self._event_loop:
                    # Schedule on event loop from callback thread
                    self._event_loop.call_soon_threadsafe(
                        lambda c=command, d=data: asyncio.create_task(
                            self._handle_command_async(c, d)
                        )
                    )

        except json.JSONDecodeError:
            lg.warning("[VoiceL2DClient] Invalid JSON from frontend")

    async def _handle_command_async(self, command: str, data: dict) -> None:
        """Handle command asynchronously and send response."""
        response = await self._handle_frontend_command(command, data)
        await self.ws_server.send_command_response(command, response)

    async def start_listening(self) -> bool:
        """Start listening for voice input."""
        if self._is_listening:
            lg.warning("[VoiceL2DClient] Already listening")
            return True

        self.vad.set_on_speech_segment(self._on_speech_segment)

        if not self.recorder.start(callback=self.vad.process_audio):
            lg.error("[VoiceL2DClient] Failed to start recording")
            return False

        self._is_listening = True
        await self.ws_server.send_status("listening")
        lg.info("[VoiceL2DClient] Voice input ENABLED")
        return True

    def stop_listening(self) -> None:
        """Stop listening for voice input."""
        if not self._is_listening:
            return

        self._is_listening = False
        self.recorder.stop()
        self.vad.reset()
        lg.info("[VoiceL2DClient] Voice input DISABLED")

    async def run(self) -> None:
        """Run the client as a background service."""
        # Store event loop reference for thread-safe callbacks
        self._event_loop = asyncio.get_running_loop()

        lg.info("=" * 60)
        lg.info("[VoiceL2DClient] Starting service...")
        lg.info(f"[VoiceL2DClient] WebSocket: ws://{WEBSOCKET_HOST}:{WEBSOCKET_PORT}")
        lg.info(f"[VoiceL2DClient] MCP Server: {MCP_SERVER_URL}")
        lg.info("=" * 60)

        # Start WebSocket server
        await self.ws_server.start()

        # Set up message handler
        self.ws_server.set_on_text_input(self._on_frontend_message)

        # Connect to MCP server
        lg.info("[VoiceL2DClient] Connecting to MCP server...")

        try:
            async with self.mcp_client:
                available_tools = await self.mcp_client.list_tools()
                lg.info(
                    f"[VoiceL2DClient] MCP connected, {len(available_tools)} tools:"
                )
                for tool in available_tools:
                    lg.info(f"  - {tool.name}")

                self._tools_config = self._adapt_tools(available_tools)

                # Log available characters
                characters = self.character_manager.list_characters()
                lg.info(f"[Characters] {characters}")
                current_char = self.character_manager.get_current_character()
                lg.info(
                    f"[VoiceL2DClient] Current character: "
                    f"{current_char.name if current_char else 'None'} "
                    f"({self.character_manager.current_character})"
                )

                lg.info("")
                lg.info("[VoiceL2DClient] Service ready!")
                lg.info("[VoiceL2DClient] Voice input is OFF by default.")
                lg.info(
                    "[VoiceL2DClient] Use frontend to enable voice input or send text."
                )
                lg.info("")

                # Send initial status to frontend
                await self.ws_server.send_status("idle")
                await self.ws_server.send_characters_list(self.get_characters_info())

                # Run the text input queue processor
                queue_task = asyncio.create_task(self._process_text_input_queue())

                try:
                    # Keep running until interrupted
                    while True:
                        await asyncio.sleep(1)
                except asyncio.CancelledError:
                    pass
                finally:
                    queue_task.cancel()
                    try:
                        await queue_task
                    except asyncio.CancelledError:
                        pass

        except Exception as e:
            lg.error(f"[VoiceL2DClient] Error: {e}")
            raise
        finally:
            self.stop_listening()
            await self.ws_server.stop()
            lg.info("[VoiceL2DClient] Service stopped")


def main():
    """Main entry point."""
    client = VoiceL2DClient()

    try:
        asyncio.run(client.run())
    except KeyboardInterrupt:
        lg.info("\n[VoiceL2DClient] Shutting down...")


if __name__ == "__main__":
    main()
