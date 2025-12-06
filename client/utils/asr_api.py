"""
ASR API Controller - SiliconCloud API implementation.

This module provides ASR functionality using SiliconCloud's SenseVoice API.
Requires network access and a valid API key.
"""

import io
import os
import tempfile
import wave
from typing import Optional

import numpy as np
import requests
from dotenv import load_dotenv
from loguru import logger as lg

from .asr_base import ASRBase

# Load environment variables
load_dotenv()


class ASRApiController(ASRBase):
    """
    ASR controller using SiliconCloud (SenseVoice) API.

    This implementation sends audio to SiliconCloud's cloud API for transcription.
    Requires SILICONCLOUD_API_KEY environment variable.
    """

    # API endpoint
    API_URL = "https://api.siliconflow.cn/v1/audio/transcriptions"

    # Model name
    MODEL = "FunAudioLLM/SenseVoiceSmall"

    def __init__(self, api_key: Optional[str] = None):
        """
        Initialize the API ASR controller.

        Args:
            api_key: SiliconCloud API key. If None, reads from environment.
        """
        self.api_key = (
            api_key
            or os.getenv("SILICONCLOUD_API_KEY")
            or os.getenv("SILICONFLOW_API_KEY")  # Backward compatibility
        )
        if not self.api_key:
            lg.warning(
                "[ASRApiController] No API key found. "
                "Set SILICONCLOUD_API_KEY environment variable."
            )
        else:
            lg.info("[ASRApiController] Initialized with SiliconCloud SenseVoice API")

    @property
    def name(self) -> str:
        """Get implementation name."""
        return "SiliconCloud SenseVoice API"

    def is_available(self) -> bool:
        """Check if API key is configured."""
        return bool(self.api_key)

    def transcribe(
        self,
        audio_data: np.ndarray,
        sample_rate: int = ASRBase.SAMPLE_RATE,
    ) -> Optional[str]:
        """
        Transcribe audio data to text using SiliconCloud API.

        Args:
            audio_data: Audio data as int16 numpy array
            sample_rate: Sample rate of audio data

        Returns:
            Transcribed text, or None if failed
        """
        if not self.api_key:
            lg.error("[ASRApiController] No API key configured")
            return None

        # Convert audio to WAV bytes
        wav_bytes = self._audio_to_wav(audio_data, sample_rate)

        # Create temporary file for upload
        try:
            with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as temp_file:
                temp_file.write(wav_bytes)
                temp_path = temp_file.name

            # Make API request
            headers = {"Authorization": f"Bearer {self.api_key}"}
            data = {"model": self.MODEL}

            with open(temp_path, "rb") as audio_file:
                files = {"file": ("audio.wav", audio_file, "audio/wav")}
                response = requests.post(
                    self.API_URL,
                    headers=headers,
                    data=data,
                    files=files,
                    timeout=30,
                )

            # Clean up temp file
            os.unlink(temp_path)

            # Parse response
            if response.status_code == 200:
                result = response.json()
                text = result.get("text", "")
                if text:
                    lg.info(f"[ASRApiController] Transcribed: {text[:50]}...")
                return text
            else:
                lg.error(
                    f"[ASRApiController] API error: {response.status_code} - "
                    f"{response.text}"
                )
                return None

        except requests.RequestException as e:
            lg.error(f"[ASRApiController] Request failed: {e}")
            return None
        except Exception as e:
            lg.error(f"[ASRApiController] Error: {e}")
            # Clean up temp file if it exists
            if "temp_path" in locals():
                try:
                    os.unlink(temp_path)
                except Exception:
                    pass
            return None

    def transcribe_file(self, file_path: str) -> Optional[str]:
        """
        Transcribe audio from a file using SiliconCloud API.

        Args:
            file_path: Path to audio file (.wav or .mp3)

        Returns:
            Transcribed text, or None if failed
        """
        if not self.api_key:
            lg.error("[ASRApiController] No API key configured")
            return None

        try:
            headers = {"Authorization": f"Bearer {self.api_key}"}
            data = {"model": self.MODEL}

            with open(file_path, "rb") as audio_file:
                files = {"file": (os.path.basename(file_path), audio_file, "audio/wav")}
                response = requests.post(
                    self.API_URL,
                    headers=headers,
                    data=data,
                    files=files,
                    timeout=30,
                )

            if response.status_code == 200:
                result = response.json()
                text = result.get("text", "")
                if text:
                    lg.info(f"[ASRApiController] Transcribed file: {text[:50]}...")
                return text
            else:
                lg.error(
                    f"[ASRApiController] API error: {response.status_code} - "
                    f"{response.text}"
                )
                return None

        except requests.RequestException as e:
            lg.error(f"[ASRApiController] Request failed: {e}")
            return None
        except FileNotFoundError:
            lg.error(f"[ASRApiController] File not found: {file_path}")
            return None

    def _audio_to_wav(
        self,
        audio_data: np.ndarray,
        sample_rate: int,
    ) -> bytes:
        """
        Convert numpy audio array to WAV bytes.

        Args:
            audio_data: Audio data as int16 numpy array
            sample_rate: Sample rate in Hz

        Returns:
            WAV file data as bytes
        """
        buffer = io.BytesIO()

        with wave.open(buffer, "wb") as wav_file:
            wav_file.setnchannels(self.CHANNELS)
            wav_file.setsampwidth(self.SAMPLE_WIDTH)
            wav_file.setframerate(sample_rate)

            # Ensure int16 format
            if audio_data.dtype != np.int16:
                audio_data = audio_data.astype(np.int16)

            wav_file.writeframes(audio_data.tobytes())

        buffer.seek(0)
        return buffer.read()
