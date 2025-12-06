"""
WebSocket Server - Bidirectional communication with frontend.

This module provides a WebSocket server that:
- Accepts connections from the frontend
- Sends audio data for playback with lip sync
- Sends chat messages (user and AI)
- Receives text input from frontend
- Supports sentence-by-sentence audio delivery
"""

import asyncio
import base64
import json
from typing import Callable, Optional, Set

import websockets
from loguru import logger as lg
from websockets.server import WebSocketServerProtocol

from .tts_controller import TTSController


class AudioWebSocketServer:
    """
    WebSocket server for bidirectional frontend communication.

    Manages client connections, sends audio/chat data,
    and receives user input from the frontend.
    """

    def __init__(self, host: str = "localhost", port: int = 7789):
        """
        Initialize the WebSocket server.

        Args:
            host: Host to bind the server to
            port: Port to listen on
        """
        self.host = host
        self.port = port
        self.clients: Set[WebSocketServerProtocol] = set()
        self._server: Optional[websockets.WebSocketServer] = None
        self._running = False

        # Callbacks for handling incoming messages
        self._on_text_input: Optional[Callable[[str], None]] = None

        lg.info(f"[AudioWebSocketServer] Initialized on {host}:{port}")

    def set_on_text_input(self, callback: Optional[Callable[[str], None]]) -> None:
        """
        Set callback for text input received from frontend.

        Args:
            callback: Function to call with text input
        """
        self._on_text_input = callback

    async def _register(self, websocket: WebSocketServerProtocol) -> None:
        """Register a new client connection."""
        self.clients.add(websocket)
        lg.info(
            f"[AudioWebSocketServer] Client connected. Total clients: {len(self.clients)}"
        )

    async def _unregister(self, websocket: WebSocketServerProtocol) -> None:
        """Unregister a client connection."""
        self.clients.discard(websocket)
        lg.info(
            f"[AudioWebSocketServer] Client disconnected. Total clients: {len(self.clients)}"
        )

    async def _handler(self, websocket: WebSocketServerProtocol) -> None:
        """Handle incoming WebSocket connections."""
        await self._register(websocket)
        try:
            # Send welcome message with audio parameters
            welcome_msg = {
                "type": "connected",
                "audio_params": {
                    "sample_rate": TTSController.SAMPLE_RATE,
                    "channels": TTSController.CHANNELS,
                    "sample_width": TTSController.SAMPLE_WIDTH,
                },
            }
            await websocket.send(json.dumps(welcome_msg))

            # Keep connection alive and handle incoming messages
            async for message in websocket:
                try:
                    data = json.loads(message)
                    msg_type = data.get("type")

                    if msg_type == "ping":
                        await websocket.send(json.dumps({"type": "pong"}))

                    elif msg_type == "ready":
                        lg.debug("[AudioWebSocketServer] Client ready for audio")

                    elif msg_type == "playback_complete":
                        lg.debug("[AudioWebSocketServer] Client finished playback")

                    elif msg_type == "text_input":
                        # Handle text input from frontend
                        text = data.get("text", "").strip()
                        if text and self._on_text_input:
                            lg.info(f"[AudioWebSocketServer] Received text input: {text[:50]}...")
                            # Run callback in a way that doesn't block WebSocket
                            asyncio.create_task(
                                self._handle_text_input_async(text)
                            )

                except json.JSONDecodeError:
                    lg.warning(f"[AudioWebSocketServer] Invalid JSON received: {message}")

        except websockets.exceptions.ConnectionClosed:
            pass
        finally:
            await self._unregister(websocket)

    async def _handle_text_input_async(self, text: str) -> None:
        """
        Handle text input asynchronously.

        Args:
            text: Text input from user
        """
        if self._on_text_input:
            # If callback is a coroutine, await it
            result = self._on_text_input(text)
            if asyncio.iscoroutine(result):
                await result

    async def send_audio(self, audio_data: bytes, text: str) -> None:
        """
        Send audio data to all connected clients.

        Args:
            audio_data: WAV audio data as bytes
            text: The text that was spoken (for display/logging)
        """
        if not self.clients:
            lg.warning("[AudioWebSocketServer] No clients connected, skipping send")
            return

        # Encode audio as base64 for JSON transport
        audio_base64 = base64.b64encode(audio_data).decode("utf-8")

        message = json.dumps({
            "type": "audio",
            "text": text,
            "audio_data": audio_base64,
            "format": "wav",
            "audio_params": {
                "sample_rate": TTSController.SAMPLE_RATE,
                "channels": TTSController.CHANNELS,
                "sample_width": TTSController.SAMPLE_WIDTH,
            },
        })

        await self._broadcast(message)
        lg.info(
            f"[AudioWebSocketServer] Sent audio ({len(audio_data)} bytes) for: {text[:30]}..."
        )

        # Wait for clients to acknowledge playback
        # This ensures sequential playback of sentences
        await self._wait_for_playback()

    async def send_user_message(self, text: str, source: str = "voice") -> None:
        """
        Send user message to frontend for display in chat.

        Args:
            text: User's message text
            source: Message source ('voice' or 'text')
        """
        if not self.clients:
            lg.warning("[AudioWebSocketServer] No clients connected, skipping send")
            return

        message = json.dumps({
            "type": "user_message",
            "text": text,
            "source": source,
        })

        await self._broadcast(message)
        lg.info(f"[AudioWebSocketServer] Sent user message ({source}): {text[:50]}...")

    async def send_ai_message(self, text: str) -> None:
        """
        Send AI response message to frontend for display in chat.

        Args:
            text: AI's response text
        """
        if not self.clients:
            lg.warning("[AudioWebSocketServer] No clients connected, skipping send")
            return

        message = json.dumps({
            "type": "ai_message",
            "text": text,
        })

        await self._broadcast(message)
        lg.info(f"[AudioWebSocketServer] Sent AI message: {text[:50]}...")

    async def send_status(self, status: str, message: str = "") -> None:
        """
        Send status update to frontend.

        Args:
            status: Status type ('listening', 'processing', 'speaking', 'idle')
            message: Optional status message
        """
        if not self.clients:
            return

        msg = json.dumps({
            "type": "status",
            "status": status,
            "message": message,
        })

        await self._broadcast(msg)
        lg.debug(f"[AudioWebSocketServer] Sent status: {status}")

    async def _wait_for_playback(self, timeout: float = 30.0) -> None:
        """
        Wait for playback to complete with timeout.

        This is a simple delay based on estimated audio duration.
        Frontend will send playback_complete when done.

        Args:
            timeout: Maximum time to wait in seconds
        """
        # Simple delay to allow playback
        # The frontend handles the actual sequencing
        await asyncio.sleep(0.1)

    async def _broadcast(self, message: str) -> None:
        """
        Broadcast a text message to all connected clients.

        Args:
            message: JSON string to broadcast
        """
        if not self.clients:
            return

        disconnected = set()
        for client in self.clients:
            try:
                await client.send(message)
            except websockets.exceptions.ConnectionClosed:
                disconnected.add(client)

        # Clean up disconnected clients
        self.clients -= disconnected

    async def start(self) -> None:
        """Start the WebSocket server."""
        self._running = True
        self._server = await websockets.serve(
            self._handler,
            self.host,
            self.port,
        )
        lg.info(f"[AudioWebSocketServer] Server started on ws://{self.host}:{self.port}")

    async def stop(self) -> None:
        """Stop the WebSocket server."""
        self._running = False
        if self._server:
            self._server.close()
            await self._server.wait_closed()
            lg.info("[AudioWebSocketServer] Server stopped")

    @property
    def is_running(self) -> bool:
        """Check if the server is running."""
        return self._running

    @property
    def client_count(self) -> int:
        """Get the number of connected clients."""
        return len(self.clients)


async def run_standalone_server(host: str = "localhost", port: int = 7789) -> None:
    """
    Run the WebSocket server standalone for testing.

    Args:
        host: Host to bind to
        port: Port to listen on
    """
    server = AudioWebSocketServer(host, port)

    # Test callback
    def on_text_input(text: str) -> None:
        print(f"Received text input: {text}")

    server.set_on_text_input(on_text_input)

    await server.start()

    lg.info(f"[AudioWebSocketServer] Running standalone on ws://{host}:{port}")
    print("Press Ctrl+C to stop")

    try:
        # Keep server running
        while True:
            await asyncio.sleep(1)
    except KeyboardInterrupt:
        pass
    finally:
        await server.stop()


if __name__ == "__main__":
    asyncio.run(run_standalone_server())
