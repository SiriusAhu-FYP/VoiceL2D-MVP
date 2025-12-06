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
from pathlib import Path
from typing import Any, Optional

import numpy as np
from dotenv import load_dotenv
from fastmcp import Client
from loguru import logger as lg
from openai import OpenAI
from utils import (
    AudioRecorder,
    AudioWebSocketServer,
    ContinuousVAD,
    TTSController,
    VoiceManager,
    create_asr_controller,
)

# region ==== Config ====
load_dotenv()

# LLM Configuration
API_KEY = os.getenv("ZHIPU_API_KEY")
BASE_URL = "https://open.bigmodel.cn/api/paas/v4/"
MODEL_NAME = "glm-4-flash"

# MCP Server Configuration
MCP_SERVER_URL = "http://localhost:8848/mcp"

# WebSocket Configuration
WEBSOCKET_HOST = "localhost"
WEBSOCKET_PORT = 7789

# VAD Configuration
VAD_AGGRESSIVENESS = 2  # 0-3, higher = more aggressive
SILENCE_THRESHOLD = 0.8  # seconds of silence to end speech

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
        lg.info("[VoiceL2DClient] Initializing...")

        # LLM client
        self.llm = OpenAI(api_key=API_KEY, base_url=BASE_URL)

        # MCP client for Live2D control
        self.mcp_client = Client(MCP_SERVER_URL)

        # TTS controller
        self.tts = TTSController()

        # Voice manager
        self.voice_manager = VoiceManager()

        # ASR controller (auto-selects based on ASR_MODE env var)
        self.asr = create_asr_controller()

        # Audio recorder
        self.recorder = AudioRecorder(
            sample_rate=16000,
            channels=1,
            block_size=480,
        )

        # VAD detector
        self.vad = ContinuousVAD(
            sample_rate=16000,
            aggressiveness=VAD_AGGRESSIVENESS,
            silence_threshold=SILENCE_THRESHOLD,
        )

        # WebSocket server
        self.ws_server = AudioWebSocketServer(WEBSOCKET_HOST, WEBSOCKET_PORT)

        # Load system prompt
        self.system_prompt = self._load_system_prompt()

        # Conversation history
        self.messages: list[dict] = []

        # Voice caching
        self._loaded_voice_name: Optional[str] = None

        # Recording state - starts OFF, frontend controls it
        self._is_listening = False

        # Asyncio primitives (created lazily)
        self._processing_lock: Optional[asyncio.Lock] = None
        self._text_input_queue: Optional[asyncio.Queue[tuple[str, str]]] = None

        # MCP tools config (set after connection)
        self._tools_config: Optional[list[dict]] = None

        # Event loop reference (set when run() starts)
        self._event_loop: Optional[asyncio.AbstractEventLoop] = None

        lg.info("[VoiceL2DClient] Initialized successfully")

    def _ensure_async_primitives(self) -> None:
        """Ensure asyncio primitives are created."""
        if self._processing_lock is None:
            self._processing_lock = asyncio.Lock()
        if self._text_input_queue is None:
            self._text_input_queue = asyncio.Queue()

    def _load_system_prompt(self) -> str:
        """Load system prompt from system_prompt.md file."""
        system_prompt_path = Path(__file__).parent / "system_prompt.md"
        try:
            with open(system_prompt_path, "r", encoding="utf-8") as f:
                content = f.read().strip()
                lg.info("[VoiceL2DClient] Loaded system prompt")
                return content
        except FileNotFoundError:
            lg.warning("[VoiceL2DClient] system_prompt.md not found")
            return ""
        except Exception as e:
            lg.warning(f"[VoiceL2DClient] Failed to load system prompt: {e}")
            return ""

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
        """Ensure the current voice is loaded on TTS server."""
        voice_config = self.voice_manager.get_current_voice()
        if not voice_config:
            lg.warning("[VoiceL2DClient] No voice configured")
            return False

        current_voice_name = self.voice_manager.current_voice

        if self._loaded_voice_name == current_voice_name:
            return True

        lg.info(f"[VoiceL2DClient] Loading voice: {current_voice_name}")
        if self.tts.load_voice(voice_config):
            self._loaded_voice_name = current_voice_name
            return True
        else:
            lg.error(f"[VoiceL2DClient] Failed to load voice: {current_voice_name}")
            return False

    async def speak(self, text: str) -> None:
        """Generate and send TTS audio for the given text."""
        if not self._ensure_voice_loaded():
            return

        voice_config = self.voice_manager.get_current_voice()
        if not voice_config:
            return

        sentences = split_into_sentences(text)
        if not sentences:
            lg.warning("[VoiceL2DClient] No sentences to speak")
            return

        lg.info(f"[VoiceL2DClient] Speaking {len(sentences)} sentence(s)")
        await self.ws_server.send_status("speaking")

        for i, sentence in enumerate(sentences):
            lg.debug(f"[VoiceL2DClient] TTS: {sentence[:30]}...")
            audio_data = self.tts.generate_audio(sentence, voice_config)

            if audio_data:
                await self.ws_server.send_audio(audio_data, sentence)
                if i < len(sentences) - 1:
                    await asyncio.sleep(0.5)
            else:
                lg.error(f"[VoiceL2DClient] TTS failed for sentence {i + 1}")

        await self.ws_server.send_status("idle")

    def get_voices_info(self) -> list[dict[str, Any]]:
        """Get list of available voices with their info."""
        voices = []
        for voice_name in self.voice_manager.list_voices():
            info = self.voice_manager.get_voice_info(voice_name)
            if info:
                voices.append({
                    "name": info["name"],
                    "prompt_text": info["prompt_text"],
                    "is_current": voice_name == self.voice_manager.current_voice,
                })
        return voices

    def switch_voice(self, voice_name: str) -> bool:
        """Switch to a different TTS voice."""
        if self.voice_manager.set_current_voice(voice_name):
            if self._loaded_voice_name != voice_name:
                lg.info(f"[VoiceL2DClient] Voice switched to: {voice_name}")
            return True
        return False

    async def process_user_input(
        self, text: str, source: str = "text"
    ) -> Optional[str]:
        """Process user input and generate response."""
        self._ensure_async_primitives()
        assert self._processing_lock is not None

        async with self._processing_lock:
            await self.ws_server.send_user_message(text, source)
            await self.ws_server.send_status("processing")

            lg.info(f"[VoiceL2DClient] Processing input ({source}): {text[:50]}...")

            if self._tools_config:
                response = await self.chat_with_tools(text, self._tools_config)
            else:
                response = await self.chat(text)

            lg.info(f"[VoiceL2DClient] LLM response: {response[:50]}...")

            await self.ws_server.send_ai_message(response)

            if response:
                await self.speak(response)

            return response

    async def chat(self, user_message: str) -> str:
        """Process a user message and generate a response."""
        self.messages.append({"role": "user", "content": user_message})

        messages_to_send = []
        if self.system_prompt:
            messages_to_send.append({"role": "system", "content": self.system_prompt})
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

        messages_to_send = []
        if self.system_prompt:
            messages_to_send.append({"role": "system", "content": self.system_prompt})
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

                lg.info(f"[VoiceL2DClient] Calling MCP tool: {tool_name}")
                result = await self._call_mcp_tool(tool_name, tool_args)

                self.messages.append({
                    "role": "tool",
                    "tool_call_id": tool_call.id,
                    "content": result,
                })

            messages_to_send = []
            if self.system_prompt:
                messages_to_send.append({
                    "role": "system",
                    "content": self.system_prompt,
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

        # Schedule the coroutine on the main event loop from this thread
        self._event_loop.call_soon_threadsafe(
            lambda: asyncio.create_task(self._process_speech_segment(audio_data))
        )

    async def _process_speech_segment(self, audio_data: np.ndarray) -> None:
        """Process a detected speech segment."""
        if not self._is_listening:
            return

        lg.info(f"[VoiceL2DClient] Speech detected ({len(audio_data)} samples)")

        await self.ws_server.send_status("processing", "Transcribing...")
        text = self.asr.transcribe(audio_data, sample_rate=16000)

        if text and text.strip():
            lg.info(f"[VoiceL2DClient] ASR result: {text}")
            self._ensure_async_primitives()
            assert self._text_input_queue is not None
            await self._text_input_queue.put(("voice", text))
        else:
            lg.warning("[VoiceL2DClient] ASR returned empty result")
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
            enabled = data.get("enabled", not self._is_listening)
            if enabled and not self._is_listening:
                await self.start_listening()
            elif not enabled and self._is_listening:
                self.stop_listening()
            return {"success": True, "listening": self._is_listening}

        elif command == "get_voices":
            voices = self.get_voices_info()
            return {"success": True, "voices": voices}

        elif command == "switch_voice":
            voice_name = data.get("voice_name")
            if voice_name:
                success = self.switch_voice(voice_name)
                return {
                    "success": success,
                    "current_voice": self.voice_manager.current_voice,
                }
            return {"success": False, "error": "No voice_name provided"}

        elif command == "get_status":
            return {
                "success": True,
                "listening": self._is_listening,
                "current_voice": self.voice_manager.current_voice,
                "loaded_voice": self._loaded_voice_name,
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
                if text:
                    self._ensure_async_primitives()
                    assert self._text_input_queue is not None
                    asyncio.create_task(self._text_input_queue.put(("text", text)))

            elif msg_type == "command":
                command = data.get("command")
                asyncio.create_task(self._handle_command_async(command, data))

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

                # Log available voices
                voices = self.voice_manager.list_voices()
                lg.info(f"[VoiceL2DClient] Available voices: {voices}")
                lg.info(
                    f"[VoiceL2DClient] Current voice: {self.voice_manager.current_voice}"
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
                await self.ws_server.send_voices_list(self.get_voices_info())

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
