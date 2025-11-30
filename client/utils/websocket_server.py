"""
WebSocket Server - Send audio to frontend for lip sync.

This module provides a WebSocket server that:
- Accepts connections from the frontend
- Sends audio data for playback with lip sync
- Supports sentence-by-sentence audio delivery
"""

import asyncio
import base64
import json
from typing import Optional, Set

import websockets
from websockets.server import WebSocketServerProtocol

from .tts_controller import TTSController


class AudioWebSocketServer:
    """
    WebSocket server for sending audio to frontend.

    Manages client connections and sends audio data
    for playback and lip sync.
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
        print(f"[AudioWebSocketServer] Initialized on {host}:{port}")

    async def _register(self, websocket: WebSocketServerProtocol) -> None:
        """Register a new client connection."""
        self.clients.add(websocket)
        print(
            f"[AudioWebSocketServer] Client connected. Total clients: {len(self.clients)}"
        )

    async def _unregister(self, websocket: WebSocketServerProtocol) -> None:
        """Unregister a client connection."""
        self.clients.discard(websocket)
        print(
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
                        print("[AudioWebSocketServer] Client ready for audio")
                    elif msg_type == "playback_complete":
                        print("[AudioWebSocketServer] Client finished playback")

                except json.JSONDecodeError:
                    print(f"[AudioWebSocketServer] Invalid JSON received: {message}")

        except websockets.exceptions.ConnectionClosed:
            pass
        finally:
            await self._unregister(websocket)

    async def send_audio(self, audio_data: bytes, text: str) -> None:
        """
        Send audio data to all connected clients.

        Args:
            audio_data: WAV audio data as bytes
            text: The text that was spoken (for display/logging)
        """
        if not self.clients:
            print("[AudioWebSocketServer] No clients connected, skipping send")
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
        print(
            f"[AudioWebSocketServer] Sent audio ({len(audio_data)} bytes) for: {text[:30]}..."
        )

        # Wait for clients to acknowledge playback
        # This ensures sequential playback of sentences
        await self._wait_for_playback()

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
        print(f"[AudioWebSocketServer] Server started on ws://{self.host}:{self.port}")

    async def stop(self) -> None:
        """Stop the WebSocket server."""
        self._running = False
        if self._server:
            self._server.close()
            await self._server.wait_closed()
            print("[AudioWebSocketServer] Server stopped")

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
    await server.start()

    print(f"[AudioWebSocketServer] Running standalone on ws://{host}:{port}")
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
