"""
VoiceL2D Client - Main entry point for voice-controlled Live2D.

This client:
- Records audio from microphone with VAD detection
- Transcribes speech using GLM-ASR
- Integrates with LLM for conversation
- Manages TTS voice generation with sentence-by-sentence synthesis
- Sends audio and messages to frontend via WebSocket
- Coordinates with MCP server for Live2D expressions
"""

import asyncio
import json
import os
import re
import threading
from pathlib import Path
from typing import Optional

import numpy as np
from dotenv import load_dotenv
from fastmcp import Client
from loguru import logger as lg
from openai import OpenAI
from utils import (
    ASRController,
    AudioBuffer,
    AudioRecorder,
    AudioWebSocketServer,
    ContinuousVAD,
    TTSController,
    VoiceManager,
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
    # Include: 。！？；.!?;
    # Also handle ellipsis: ...、……
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
        # If this part is punctuation, finalize the sentence
        if re.match(pattern, part):
            if current.strip():
                sentences.append(current.strip())
            current = ""

    # Handle any remaining text without ending punctuation
    if current.strip():
        sentences.append(current.strip())

    # Filter out very short segments (likely just punctuation)
    sentences = [s for s in sentences if len(s) > 1]

    # If we have more than max_segments, merge them
    if len(sentences) > max_segments:
        # Calculate how many sentences to merge into each segment
        merged = []
        sentences_per_segment = len(sentences) // max_segments
        remainder = len(sentences) % max_segments

        idx = 0
        for i in range(max_segments):
            # Add one extra sentence to first 'remainder' segments
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

    Orchestrates LLM conversation, TTS generation, ASR transcription,
    and audio sending to the frontend for Live2D lip sync.
    """

    def __init__(self):
        """Initialize the VoiceL2D client."""
        # LLM client
        self.llm = OpenAI(api_key=API_KEY, base_url=BASE_URL)

        # MCP client for Live2D control
        self.mcp_client = Client(MCP_SERVER_URL)

        # TTS controller
        self.tts = TTSController()

        # Voice manager
        self.voice_manager = VoiceManager()

        # ASR controller
        self.asr = ASRController()

        # Audio recorder
        self.recorder = AudioRecorder(
            sample_rate=16000,  # GLM-ASR requirement
            channels=1,
            block_size=480,  # 30ms at 16kHz for VAD
        )

        # VAD detector
        self.vad = ContinuousVAD(
            sample_rate=16000,
            aggressiveness=VAD_AGGRESSIVENESS,
            silence_threshold=SILENCE_THRESHOLD,
        )

        # WebSocket server for audio
        self.ws_server = AudioWebSocketServer(WEBSOCKET_HOST, WEBSOCKET_PORT)

        # Load system prompt
        self.system_prompt = self._load_system_prompt()

        # Conversation history
        self.messages: list[dict] = []

        # Voice caching - track currently loaded voice on TTS server
        self._loaded_voice_name: Optional[str] = None

        # Recording state
        self._is_listening = False
        # Note: asyncio primitives are created lazily in _ensure_async_primitives()
        # to avoid "no running event loop" error when client is instantiated
        # before asyncio.run() is called
        self._processing_lock: Optional[asyncio.Lock] = None
        self._text_input_queue: Optional[asyncio.Queue[tuple[str, str]]] = None

        lg.info("[VoiceL2DClient] Initialized")

    def _ensure_async_primitives(self) -> None:
        """
        Ensure asyncio primitives are created.

        Must be called from within an async context (after event loop is running).
        """
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
                lg.info(
                    f"[VoiceL2DClient] Loaded system prompt from {system_prompt_path}"
                )
                return content
        except FileNotFoundError:
            lg.warning(
                f"[VoiceL2DClient] Warning: system_prompt.md not found at {system_prompt_path}"
            )
            return ""
        except Exception as e:
            lg.warning(f"[VoiceL2DClient] Warning: Failed to load system prompt: {e}")
            return ""

    def _adapt_tools(self, tools) -> list[dict]:
        """
        Convert FastMCP tool objects to OpenAI format.

        Args:
            tools: List of MCP tool objects

        Returns:
            List of OpenAI-compatible tool definitions
        """
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
        """
        Call an MCP tool and return the result.

        Args:
            tool_name: Name of the tool to call
            tool_args: Arguments for the tool

        Returns:
            Tool result as string
        """
        try:
            result = await self.mcp_client.call_tool(tool_name, arguments=tool_args)

            # Extract text from result
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
        """
        Ensure the current voice is loaded on TTS server.

        Only sends load request if voice has changed.

        Returns:
            True if voice is ready, False otherwise
        """
        voice_config = self.voice_manager.get_current_voice()
        if not voice_config:
            lg.warning("[VoiceL2DClient] No voice configured")
            return False

        current_voice_name = self.voice_manager.current_voice

        # Check if we need to load the voice
        if self._loaded_voice_name == current_voice_name:
            lg.debug(
                f"[VoiceL2DClient] Voice '{current_voice_name}' already loaded (cached)"
            )
            return True

        # Load voice weights
        lg.info(f"[VoiceL2DClient] Loading voice: {current_voice_name}")
        if self.tts.load_voice(voice_config):
            self._loaded_voice_name = current_voice_name
            return True
        else:
            lg.error(f"[VoiceL2DClient] Failed to load voice: {current_voice_name}")
            return False

    async def speak(self, text: str) -> None:
        """
        Generate and send TTS audio for the given text.

        Splits text into sentences and processes them sequentially.

        Args:
            text: Text to speak
        """
        # Ensure voice is loaded
        if not self._ensure_voice_loaded():
            return

        voice_config = self.voice_manager.get_current_voice()
        if not voice_config:
            return

        # Split text into sentences
        sentences = split_into_sentences(text)

        if not sentences:
            lg.warning("[VoiceL2DClient] No sentences to speak")
            return

        lg.info(f"[VoiceL2DClient] Speaking {len(sentences)} sentence(s)")

        # Update status
        await self.ws_server.send_status("speaking")

        # Process each sentence sequentially
        for i, sentence in enumerate(sentences):
            lg.debug(
                f"[VoiceL2DClient] Sentence {i + 1}/{len(sentences)}: {sentence[:30]}..."
            )

            # Generate audio for this sentence (non-streaming)
            audio_data = self.tts.generate_audio(sentence, voice_config)

            if audio_data:
                # Send audio to frontend via WebSocket
                await self.ws_server.send_audio(audio_data, sentence)

                # 0.5 second delay between sentences for natural pacing
                if i < len(sentences) - 1:
                    await asyncio.sleep(0.5)
            else:
                lg.error(
                    f"[VoiceL2DClient] Failed to generate audio for sentence {i + 1}"
                )

        # Update status
        await self.ws_server.send_status("idle")

    def switch_voice(self, voice_name: str) -> bool:
        """
        Switch to a different TTS voice.

        Args:
            voice_name: Name of the voice to switch to

        Returns:
            True if successful, False otherwise
        """
        if self.voice_manager.set_current_voice(voice_name):
            # Note: Actual loading will happen on next speak() call
            # This just marks the voice as needing to be loaded
            if self._loaded_voice_name != voice_name:
                lg.info(
                    f"[VoiceL2DClient] Voice will be loaded on next speak: {voice_name}"
                )
            return True
        return False

    def list_voices(self) -> list[str]:
        """
        List available TTS voices.

        Returns:
            List of voice names
        """
        return self.voice_manager.list_voices()

    async def process_user_input(
        self, text: str, source: str = "text", tools_config: Optional[list[dict]] = None
    ) -> Optional[str]:
        """
        Process user input (from voice or text) and generate response.

        Args:
            text: User's input text
            source: Input source ('voice' or 'text')
            tools_config: Optional tool configuration for MCP

        Returns:
            AI's response text
        """
        self._ensure_async_primitives()
        assert self._processing_lock is not None
        async with self._processing_lock:
            # Send user message to frontend
            await self.ws_server.send_user_message(text, source)
            await self.ws_server.send_status("processing")

            # Generate response
            if tools_config:
                response = await self.chat_with_tools(text, tools_config)
            else:
                response = await self.chat(text)

            # Send AI message to frontend
            await self.ws_server.send_ai_message(response)

            # Speak the response
            if response:
                await self.speak(response)

            return response

    async def chat(self, user_message: str) -> str:
        """
        Process a user message and generate a response.

        Args:
            user_message: The user's input message

        Returns:
            The assistant's response text
        """
        # Add user message to history
        self.messages.append({"role": "user", "content": user_message})

        # Build messages with system prompt
        messages_to_send = []
        if self.system_prompt:
            messages_to_send.append({"role": "system", "content": self.system_prompt})
        messages_to_send.extend(self.messages)

        # Get LLM response
        response = self.llm.chat.completions.create(
            model=MODEL_NAME,
            messages=messages_to_send,
        )

        assistant_message = response.choices[0].message.content or ""

        # Add assistant message to history
        self.messages.append({"role": "assistant", "content": assistant_message})

        return assistant_message

    async def chat_with_tools(self, user_message: str, tools_config: list[dict]) -> str:
        """
        Process a user message with tool support.

        Args:
            user_message: The user's input message
            tools_config: OpenAI-format tool definitions

        Returns:
            The assistant's final response text
        """
        # Add user message to history
        self.messages.append({"role": "user", "content": user_message})

        # Build messages with system prompt
        messages_to_send = []
        if self.system_prompt:
            messages_to_send.append({"role": "system", "content": self.system_prompt})
        messages_to_send.extend(self.messages)

        # Get LLM response
        response = self.llm.chat.completions.create(
            model=MODEL_NAME,
            messages=messages_to_send,
            tools=tools_config,
            tool_choice="auto",
        )

        ai_msg = response.choices[0].message

        # Handle tool calls if present
        if ai_msg.tool_calls:
            # Convert Message object to dict for consistent message history
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

                lg.info(f"[VoiceL2DClient] Calling tool: {tool_name}")
                result = await self._call_mcp_tool(tool_name, tool_args)

                self.messages.append({
                    "role": "tool",
                    "tool_call_id": tool_call.id,
                    "content": result,
                })

            # Get final response after tool calls
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
        else:
            assistant_message = ai_msg.content or ""

        # Add assistant message to history
        self.messages.append({"role": "assistant", "content": assistant_message})

        return assistant_message

    def _on_speech_segment(self, audio_data: np.ndarray) -> None:
        """
        Callback when a speech segment is detected.

        Called by VAD when speech ends.

        Args:
            audio_data: Audio data of the speech segment
        """
        # Queue audio for async processing
        asyncio.create_task(self._process_speech_segment(audio_data))

    async def _process_speech_segment(self, audio_data: np.ndarray) -> None:
        """
        Process a detected speech segment.

        Args:
            audio_data: Audio data of the speech segment
        """
        if not self._is_listening:
            return

        lg.info(
            f"[VoiceL2DClient] Processing speech segment ({len(audio_data)} samples)"
        )

        # Transcribe speech
        await self.ws_server.send_status("processing", "Transcribing...")
        text = self.asr.transcribe(audio_data, sample_rate=16000)

        if text and text.strip():
            lg.info(f"[VoiceL2DClient] Transcribed: {text}")
            # Queue for processing
            self._ensure_async_primitives()
            assert self._text_input_queue is not None
            await self._text_input_queue.put(("voice", text))
        else:
            lg.warning("[VoiceL2DClient] No transcription result")
            await self.ws_server.send_status("listening")

    async def _process_text_input_queue(
        self, tools_config: Optional[list[dict]] = None
    ) -> None:
        """
        Process text inputs from the queue.

        Args:
            tools_config: Optional tool configuration
        """
        self._ensure_async_primitives()
        assert self._text_input_queue is not None

        while self._is_listening:
            try:
                # Wait for input with timeout
                source, text = await asyncio.wait_for(
                    self._text_input_queue.get(), timeout=0.5
                )

                # Process the input
                await self.process_user_input(text, source, tools_config)

                # Resume listening
                await self.ws_server.send_status("listening")

            except asyncio.TimeoutError:
                continue
            except Exception as e:
                lg.error(f"[VoiceL2DClient] Error processing input: {e}")

    def _on_frontend_text_input(self, text: str) -> None:
        """
        Handle text input from frontend.

        Args:
            text: Text input from user
        """
        if text.strip():
            # Queue for processing (will be picked up by _process_text_input_queue)
            self._ensure_async_primitives()
            assert self._text_input_queue is not None
            asyncio.create_task(self._text_input_queue.put(("text", text)))

    async def start_listening(self) -> bool:
        """
        Start listening for voice input.

        Returns:
            True if started successfully
        """
        if self._is_listening:
            lg.warning("[VoiceL2DClient] Already listening")
            return True

        # Set up VAD callback
        self.vad.set_on_speech_segment(self._on_speech_segment)

        # Start recording
        if not self.recorder.start(callback=self.vad.process_audio):
            lg.error("[VoiceL2DClient] Failed to start recording")
            return False

        self._is_listening = True
        await self.ws_server.send_status("listening")
        lg.info("[VoiceL2DClient] Started listening")
        return True

    def stop_listening(self) -> None:
        """Stop listening for voice input."""
        if not self._is_listening:
            return

        self._is_listening = False
        self.recorder.stop()
        self.vad.reset()
        lg.info("[VoiceL2DClient] Stopped listening")

    async def run_voice_mode(self) -> None:
        """Run the client in voice-controlled mode."""
        lg.info("\n[VoiceL2DClient] Starting voice-controlled mode...")
        lg.info(
            f"[VoiceL2DClient] WebSocket server: ws://{WEBSOCKET_HOST}:{WEBSOCKET_PORT}"
        )
        lg.info(f"[VoiceL2DClient] MCP server: {MCP_SERVER_URL}")

        # Start WebSocket server
        await self.ws_server.start()

        # Set up frontend text input handler
        self.ws_server.set_on_text_input(self._on_frontend_text_input)

        # Connect to MCP server
        lg.info("\n[VoiceL2DClient] Connecting to MCP server...")

        async with self.mcp_client:
            # Get available tools
            available_tools = await self.mcp_client.list_tools()
            lg.info(
                f"[VoiceL2DClient] Connected! {len(available_tools)} tools available"
            )

            for tool in available_tools:
                lg.info(f"   - {tool.name}: {tool.description[:50]}...")

            tools_config = self._adapt_tools(available_tools)

            # Show available voices
            voices = self.list_voices()
            lg.info(f"\n[VoiceL2DClient] Available voices: {voices}")
            lg.info(
                f"[VoiceL2DClient] Current voice: {self.voice_manager.current_voice}"
            )

            # Start listening
            if not await self.start_listening():
                lg.error("[VoiceL2DClient] Failed to start voice input")
                return

            print("\n" + "=" * 60)
            print("Voice-controlled mode active!")
            print("Speak into your microphone or type in the frontend.")
            print("Press Ctrl+C to stop")
            print("=" * 60 + "\n")

            # Process text input queue
            try:
                await self._process_text_input_queue(tools_config)
            except KeyboardInterrupt:
                lg.info("\n\nInterrupted. Goodbye!")
                print("\n\nInterrupted. Goodbye!")
            finally:
                self.stop_listening()

        # Stop WebSocket server
        await self.ws_server.stop()

    async def run_interactive(self) -> None:
        """Run the client in interactive mode (keyboard input)."""
        lg.info(f"\n[VoiceL2DClient] Starting interactive session...")
        lg.info(
            f"[VoiceL2DClient] WebSocket server: ws://{WEBSOCKET_HOST}:{WEBSOCKET_PORT}"
        )
        lg.info(f"[VoiceL2DClient] MCP server: {MCP_SERVER_URL}")

        # Start WebSocket server
        await self.ws_server.start()

        # Set up frontend text input handler
        self.ws_server.set_on_text_input(self._on_frontend_text_input)

        # Connect to MCP server
        lg.info(f"\n[VoiceL2DClient] Connecting to MCP server...")

        async with self.mcp_client:
            # Get available tools
            available_tools = await self.mcp_client.list_tools()
            lg.info(
                f"[VoiceL2DClient] Connected! {len(available_tools)} tools available"
            )

            for tool in available_tools:
                lg.info(f"   - {tool.name}: {tool.description[:50]}...")

            tools_config = self._adapt_tools(available_tools)

            # Show available voices
            voices = self.list_voices()
            lg.info(f"\n[VoiceL2DClient] Available voices: {voices}")
            lg.info(
                f"[VoiceL2DClient] Current voice: {self.voice_manager.current_voice}"
            )

            print("\n" + "=" * 60)
            print("Commands:")
            print("  /voice <name>  - Switch voice")
            print("  /voices        - List voices")
            print("  /quit          - Exit")
            print("  (any text)     - Chat and generate speech")
            print("=" * 60 + "\n")

            while True:
                try:
                    user_input = input("You: ").strip()

                    if not user_input:
                        continue

                    # Handle commands
                    if user_input.startswith("/"):
                        parts = user_input.split(maxsplit=1)
                        cmd = parts[0].lower()

                        if cmd == "/quit":
                            print("Goodbye!")
                            break
                        elif cmd == "/voices":
                            print(f"Available voices: {self.list_voices()}")
                            print(f"Current voice: {self.voice_manager.current_voice}")
                            print(f"Loaded voice: {self._loaded_voice_name}")
                            continue
                        elif cmd == "/voice":
                            if len(parts) > 1:
                                voice_name = parts[1]
                                if self.switch_voice(voice_name):
                                    print(f"Switched to voice: {voice_name}")
                                else:
                                    print(f"Voice not found: {voice_name}")
                            else:
                                print("Usage: /voice <name>")
                            continue
                        else:
                            print(f"Unknown command: {cmd}")
                            continue

                    # Process user input
                    response = await self.process_user_input(
                        user_input, "text", tools_config
                    )
                    print(f"\nAssistant: {response}\n")

                except KeyboardInterrupt:
                    lg.info("\n\nInterrupted. Goodbye!")
                    print("\n\nInterrupted. Goodbye!")
                    break
                except Exception as e:
                    lg.error(f"Error: {e}")
                    print(f"Error: {e}")
                    import traceback

                    traceback.print_exc()

        # Stop WebSocket server
        await self.ws_server.stop()

    async def run_simple(self) -> None:
        """Run the client without MCP integration (simple mode)."""
        lg.info(f"\n[VoiceL2DClient] Starting simple mode (no MCP)...")
        lg.info(
            f"[VoiceL2DClient] WebSocket server: ws://{WEBSOCKET_HOST}:{WEBSOCKET_PORT}"
        )

        # Start WebSocket server
        await self.ws_server.start()

        # Set up frontend text input handler
        self.ws_server.set_on_text_input(self._on_frontend_text_input)

        # Show available voices
        voices = self.list_voices()
        lg.info(f"\n[VoiceL2DClient] Available voices: {voices}")
        lg.info(f"[VoiceL2DClient] Current voice: {self.voice_manager.current_voice}")

        print("\n" + "=" * 60)
        print("Commands:")
        print("  /voice <name>  - Switch voice")
        print("  /voices        - List voices")
        print("  /say <text>    - Speak text directly (no LLM)")
        print("  /quit          - Exit")
        print("  (any text)     - Chat and generate speech")
        print("=" * 60 + "\n")

        while True:
            try:
                user_input = input("You: ").strip()

                if not user_input:
                    continue

                # Handle commands
                if user_input.startswith("/"):
                    parts = user_input.split(maxsplit=1)
                    cmd = parts[0].lower()

                    if cmd == "/quit":
                        print("Goodbye!")
                        break
                    elif cmd == "/voices":
                        print(f"Available voices: {self.list_voices()}")
                        print(f"Current voice: {self.voice_manager.current_voice}")
                        print(f"Loaded voice: {self._loaded_voice_name}")
                        continue
                    elif cmd == "/voice":
                        if len(parts) > 1:
                            voice_name = parts[1]
                            if self.switch_voice(voice_name):
                                print(f"Switched to voice: {voice_name}")
                            else:
                                print(f"Voice not found: {voice_name}")
                        else:
                            print("Usage: /voice <name>")
                        continue
                    elif cmd == "/say":
                        if len(parts) > 1:
                            text = parts[1]
                            print("[Speaking...]")
                            await self.speak(text)
                            print("[Done]\n")
                        else:
                            print("Usage: /say <text>")
                        continue
                    else:
                        print(f"Unknown command: {cmd}")
                        continue

                # Process user input
                response = await self.process_user_input(user_input, "text")
                print(f"\nAssistant: {response}\n")

            except KeyboardInterrupt:
                lg.info("\n\nInterrupted. Goodbye!")
                print("\n\nInterrupted. Goodbye!")
                break
            except Exception as e:
                lg.error(f"Error: {e}")
                print(f"Error: {e}")
                import traceback

                traceback.print_exc()

        # Stop WebSocket server
        await self.ws_server.stop()


def main():
    """Main entry point."""
    import argparse

    parser = argparse.ArgumentParser(description="VoiceL2D Client")
    parser.add_argument(
        "--simple",
        action="store_true",
        help="Run in simple mode without MCP integration",
    )
    parser.add_argument(
        "--voice",
        action="store_true",
        help="Run in voice-controlled mode (microphone input)",
    )
    parser.add_argument(
        "--interactive",
        action="store_true",
        help="Run in interactive mode (keyboard input, default)",
    )
    args = parser.parse_args()

    client = VoiceL2DClient()

    try:
        if args.voice:
            asyncio.run(client.run_voice_mode())
        elif args.simple:
            asyncio.run(client.run_simple())
        else:
            asyncio.run(client.run_interactive())
    except KeyboardInterrupt:
        lg.info("\nExiting...")
        print("\nExiting...")


if __name__ == "__main__":
    main()
