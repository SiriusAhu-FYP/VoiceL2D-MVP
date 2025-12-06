"""
ASR Controller - Handle GLM-ASR API interactions.

This module provides functionality to:
- Convert audio to text using GLM-ASR
- Support both synchronous and streaming transcription
- Handle audio format conversion for API compatibility
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

# Load environment variables
load_dotenv()


class ASRController:
    """
    Controller for GLM-ASR (ZhipuAI) speech-to-text API.

    Handles audio transcription using the GLM-ASR model.
    """

    # API endpoint
    API_URL = "https://open.bigmodel.cn/api/paas/v4/audio/transcriptions"

    # Model name
    MODEL = "glm-asr"

    # Audio parameters
    SAMPLE_RATE = 16000  # Recommended for GLM-ASR
    CHANNELS = 1
    SAMPLE_WIDTH = 2  # 16-bit

    def __init__(self, api_key: Optional[str] = None):
        """
        Initialize the ASR controller.

        Args:
            api_key: ZhipuAI API key. If None, reads from ZHIPU_API_KEY env var.
        """
        self.api_key = api_key or os.getenv("ZHIPU_API_KEY") or os.getenv("API_KEY_ZHIPU")
        if not self.api_key:
            lg.warning(
                "[ASRController] No API key found. "
                "Set ZHIPU_API_KEY environment variable."
            )

        lg.info("[ASRController] Initialized")

    def transcribe(
        self,
        audio_data: np.ndarray,
        sample_rate: int = SAMPLE_RATE,
        temperature: float = 0.7,
    ) -> Optional[str]:
        """
        Transcribe audio data to text.

        Args:
            audio_data: Audio data as int16 numpy array
            sample_rate: Sample rate of audio data
            temperature: Sampling temperature (0.0-1.0)

        Returns:
            Transcribed text, or None if failed
        """
        if not self.api_key:
            lg.error("[ASRController] No API key configured")
            return None

        # Convert audio to WAV bytes
        wav_bytes = self._audio_to_wav(audio_data, sample_rate)

        # Create temporary file for upload
        try:
            with tempfile.NamedTemporaryFile(
                suffix=".wav", delete=False
            ) as temp_file:
                temp_file.write(wav_bytes)
                temp_path = temp_file.name

            # Make API request
            headers = {"Authorization": f"Bearer {self.api_key}"}
            payload = {
                "model": self.MODEL,
                "temperature": str(temperature),
                "stream": "false",
            }

            with open(temp_path, "rb") as audio_file:
                files = {"file": ("audio.wav", audio_file, "audio/wav")}
                response = requests.post(
                    self.API_URL,
                    headers=headers,
                    data=payload,
                    files=files,
                    timeout=60,
                )

            # Clean up temp file
            os.unlink(temp_path)

            # Parse response
            if response.status_code == 200:
                result = response.json()
                text = result.get("text", "")
                lg.info(f"[ASRController] Transcribed: {text[:50]}...")
                return text
            else:
                lg.error(
                    f"[ASRController] API error: {response.status_code} - "
                    f"{response.text}"
                )
                return None

        except requests.RequestException as e:
            lg.error(f"[ASRController] Request failed: {e}")
            return None
        except Exception as e:
            lg.error(f"[ASRController] Error: {e}")
            # Clean up temp file if it exists
            if "temp_path" in locals():
                try:
                    os.unlink(temp_path)
                except Exception:
                    pass
            return None

    def transcribe_file(
        self,
        file_path: str,
        temperature: float = 0.7,
    ) -> Optional[str]:
        """
        Transcribe audio from a file.

        Args:
            file_path: Path to audio file (.wav or .mp3)
            temperature: Sampling temperature (0.0-1.0)

        Returns:
            Transcribed text, or None if failed
        """
        if not self.api_key:
            lg.error("[ASRController] No API key configured")
            return None

        try:
            headers = {"Authorization": f"Bearer {self.api_key}"}
            payload = {
                "model": self.MODEL,
                "temperature": str(temperature),
                "stream": "false",
            }

            with open(file_path, "rb") as audio_file:
                files = {"file": audio_file}
                response = requests.post(
                    self.API_URL,
                    headers=headers,
                    data=payload,
                    files=files,
                    timeout=60,
                )

            if response.status_code == 200:
                result = response.json()
                text = result.get("text", "")
                lg.info(f"[ASRController] Transcribed file: {text[:50]}...")
                return text
            else:
                lg.error(
                    f"[ASRController] API error: {response.status_code} - "
                    f"{response.text}"
                )
                return None

        except requests.RequestException as e:
            lg.error(f"[ASRController] Request failed: {e}")
            return None
        except FileNotFoundError:
            lg.error(f"[ASRController] File not found: {file_path}")
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

    def check_api_key(self) -> bool:
        """
        Check if API key is configured.

        Returns:
            True if API key is set, False otherwise
        """
        return bool(self.api_key)


def test_asr():
    """Test ASR with a sample file."""
    import pathlib

    # Find test audio file
    script_dir = pathlib.Path(__file__).parent.parent.parent
    test_file = script_dir / "asset" / "test_audio.wav"

    if not test_file.exists():
        lg.error(f"Test file not found: {test_file}")
        return

    controller = ASRController()

    if not controller.check_api_key():
        lg.error("API key not configured")
        return

    result = controller.transcribe_file(str(test_file))
    if result:
        print(f"Transcription: {result}")
    else:
        print("Transcription failed")


if __name__ == "__main__":
    test_asr()

