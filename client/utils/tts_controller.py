"""
TTS Controller - Handle GPT-SoVITS API interactions.

This module provides functionality to:
- Set GPT and SoVITS model weights
- Generate audio from text (both streaming and non-streaming)
- Stream audio data for real-time playback
"""

import os
from typing import Generator, Optional
from urllib.parse import urlencode

import requests
from dotenv import load_dotenv
from loguru import logger as lg

from .voice_manager import VoiceConfig

# Load environment variables
load_dotenv()


class TTSController:
    """
    Controller for GPT-SoVITS TTS API.

    Handles all communication with the TTS server including
    weight loading and audio generation.
    """

    # Audio parameters for GPT-SoVITS
    SAMPLE_RATE = 32000
    CHANNELS = 1
    SAMPLE_WIDTH = 2  # 16-bit audio

    def __init__(self, host: Optional[str] = None):
        """
        Initialize the TTS controller.

        Args:
            host: TTS server host URL. If None, uses GPT_SOVITS_HOST env var.
        """
        self.host = host or os.getenv("GPT_SOVITS_HOST", "http://localhost:9880")
        self._current_gpt_weights: Optional[str] = None
        self._current_sovits_weights: Optional[str] = None
        lg.info(f"[TTSController] Initialized with host: {self.host}")

    def set_gpt_weights(self, weights_path: str) -> bool:
        """
        Set GPT model weights on the TTS server.

        Args:
            weights_path: Path to GPT weights file (.ckpt)

        Returns:
            True if successful, False otherwise
        """
        if self._current_gpt_weights == weights_path:
            lg.debug(f"[TTSController] GPT weights already loaded: {weights_path}")
            return True

        url = f"{self.host}/set_gpt_weights"
        params = {"weights_path": weights_path}

        try:
            response = requests.get(url, params=params, timeout=30)
            if response.status_code == 200:
                self._current_gpt_weights = weights_path
                lg.info(f"[TTSController] GPT weights set successfully: {weights_path}")
                return True
            else:
                lg.error(f"[TTSController] Failed to set GPT weights: {response.text}")
                return False
        except requests.RequestException as e:
            lg.error(f"[TTSController] Error setting GPT weights: {e}")
            return False

    def set_sovits_weights(self, weights_path: str) -> bool:
        """
        Set SoVITS model weights on the TTS server.

        Args:
            weights_path: Path to SoVITS weights file (.pth)

        Returns:
            True if successful, False otherwise
        """
        if self._current_sovits_weights == weights_path:
            lg.debug(f"[TTSController] SoVITS weights already loaded: {weights_path}")
            return True

        url = f"{self.host}/set_sovits_weights"
        params = {"weights_path": weights_path}

        try:
            response = requests.get(url, params=params, timeout=30)
            if response.status_code == 200:
                self._current_sovits_weights = weights_path
                lg.info(
                    f"[TTSController] SoVITS weights set successfully: {weights_path}"
                )
                return True
            else:
                lg.error(f"[TTSController] Failed to set SoVITS weights: {response.text}")
                return False
        except requests.RequestException as e:
            lg.error(f"[TTSController] Error setting SoVITS weights: {e}")
            return False

    def load_voice(self, voice_config: VoiceConfig) -> bool:
        """
        Load both GPT and SoVITS weights for a voice.

        Args:
            voice_config: Voice configuration with weight paths

        Returns:
            True if both weights loaded successfully, False otherwise
        """
        lg.info(f"[TTSController] Loading voice: {voice_config.name}")

        gpt_success = self.set_gpt_weights(voice_config.gpt_weights_path)
        if not gpt_success:
            return False

        sovits_success = self.set_sovits_weights(voice_config.sovits_weights_path)
        if not sovits_success:
            return False

        lg.info(f"[TTSController] Voice loaded successfully: {voice_config.name}")
        return True

    def generate_audio(
        self,
        text: str,
        voice_config: VoiceConfig,
        text_lang: str = "zh",
    ) -> Optional[bytes]:
        """
        Generate audio from text (non-streaming).

        Args:
            text: Text to convert to speech
            voice_config: Voice configuration to use
            text_lang: Language of the input text

        Returns:
            Audio data as bytes (WAV format), or None if failed
        """
        params = {
            "text": text,
            "text_lang": text_lang,
            "ref_audio_path": voice_config.ref_audio_path,
            "prompt_text": voice_config.prompt_text,
            "prompt_lang": voice_config.prompt_lang,
        }

        url = f"{self.host}/tts?{urlencode(params)}"

        try:
            lg.info(f"[TTSController] Generating audio for: {text[:50]}...")
            response = requests.get(url, timeout=60)

            if response.status_code == 200:
                lg.info(
                    f"[TTSController] Audio generated successfully ({len(response.content)} bytes)"
                )
                return response.content
            else:
                lg.error(
                    f"[TTSController] TTS request failed: {response.status_code} - {response.text}"
                )
                return None
        except requests.RequestException as e:
            lg.error(f"[TTSController] Error generating audio: {e}")
            return None

    def generate_audio_stream(
        self,
        text: str,
        voice_config: VoiceConfig,
        text_lang: str = "zh",
        chunk_size: int = 1024,
    ) -> Generator[bytes, None, None]:
        """
        Generate audio from text with streaming.

        Yields audio chunks as they become available from the TTS server.

        Args:
            text: Text to convert to speech
            voice_config: Voice configuration to use
            text_lang: Language of the input text
            chunk_size: Size of audio chunks to yield

        Yields:
            Audio data chunks (PCM format in WAV container)
        """
        params = {
            "text": text,
            "text_lang": text_lang,
            "ref_audio_path": voice_config.ref_audio_path,
            "prompt_text": voice_config.prompt_text,
            "prompt_lang": voice_config.prompt_lang,
            "streaming_mode": "true",
            "media_type": "wav",
        }

        url = f"{self.host}/tts"

        try:
            lg.info(f"[TTSController] Starting streaming audio for: {text[:50]}...")

            with requests.get(url, params=params, stream=True, timeout=120) as response:
                response.raise_for_status()
                lg.debug("[TTSController] Stream connection established")

                for chunk in response.iter_content(chunk_size=chunk_size):
                    if chunk:
                        yield chunk

            lg.info("[TTSController] Streaming completed")

        except requests.RequestException as e:
            lg.error(f"[TTSController] Error in streaming audio: {e}")

    def check_connection(self) -> bool:
        """
        Check if the TTS server is reachable.

        Returns:
            True if server responds, False otherwise
        """
        try:
            response = requests.get(self.host, timeout=5)
            return response.status_code in (200, 404)  # Server is up
        except requests.RequestException:
            return False

    def get_audio_params(self) -> dict:
        """
        Get audio parameters for playback configuration.

        Returns:
            Dictionary with sample_rate, channels, and sample_width
        """
        return {
            "sample_rate": self.SAMPLE_RATE,
            "channels": self.CHANNELS,
            "sample_width": self.SAMPLE_WIDTH,
        }
