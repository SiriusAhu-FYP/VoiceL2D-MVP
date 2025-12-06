"""
ASR Local Controller - Faster-Whisper local implementation.

This module provides ASR functionality using Faster-Whisper for local
speech-to-text processing. Supports GPU acceleration when available.

Requires optional dependencies: `uv sync --extra local-asr`
"""

import io
import os
import tempfile
import wave
from typing import Optional

import numpy as np
from dotenv import load_dotenv
from loguru import logger as lg

from .asr_base import ASRBase

# Load environment variables
load_dotenv()


class ASRLocalController(ASRBase):
    """
    ASR controller using Faster-Whisper for local transcription.

    This implementation runs entirely locally without network access.
    Automatically uses GPU if available, falls back to CPU otherwise.

    Configuration via environment variables:
    - WHISPER_MODEL: Model size (tiny, base, small, medium, large-v3)
    - WHISPER_LANGUAGE: Language code (e.g., 'zh', 'en') or empty for auto
    """

    # Model cache (singleton pattern for efficiency)
    _model = None
    _model_name = None

    def __init__(
        self,
        model_name: Optional[str] = None,
        language: Optional[str] = None,
    ):
        """
        Initialize the local ASR controller.

        Args:
            model_name: Whisper model name. If None, reads from WHISPER_MODEL env.
            language: Target language code. If None, reads from WHISPER_LANGUAGE env.
        """
        self.model_name = model_name or os.getenv("WHISPER_MODEL", "base")
        self.language = language or os.getenv("WHISPER_LANGUAGE", "zh") or None

        # Determine device and compute type
        self.device, self.compute_type = self._detect_device()

        lg.info(
            f"[ASRLocalController] Initialized with model={self.model_name}, "
            f"device={self.device}, compute_type={self.compute_type}, "
            f"language={self.language or 'auto'}"
        )

    def _detect_device(self) -> tuple[str, str]:
        """
        Detect available device and appropriate compute type.

        Returns:
            Tuple of (device, compute_type)
        """
        try:
            import torch

            if torch.cuda.is_available():
                lg.info("[ASRLocalController] CUDA GPU detected")
                return "cuda", "float16"
            else:
                lg.info("[ASRLocalController] No GPU, using CPU")
                return "cpu", "int8"
        except ImportError:
            lg.warning("[ASRLocalController] PyTorch not installed, using CPU")
            return "cpu", "int8"

    def _load_model(self):
        """Load the Whisper model (lazy loading with caching)."""
        # Check if model is already loaded with same name
        if (
            ASRLocalController._model is not None
            and ASRLocalController._model_name == self.model_name
        ):
            return ASRLocalController._model

        try:
            from faster_whisper import WhisperModel

            lg.info(
                f"[ASRLocalController] Loading Faster-Whisper model: {self.model_name}"
            )
            lg.info(
                f"[ASRLocalController] Device: {self.device}, "
                f"Compute type: {self.compute_type}"
            )

            model = WhisperModel(
                self.model_name,
                device=self.device,
                compute_type=self.compute_type,
            )

            # Cache the model
            ASRLocalController._model = model
            ASRLocalController._model_name = self.model_name

            lg.info("[ASRLocalController] Model loaded successfully")
            return model

        except ImportError:
            lg.error(
                "[ASRLocalController] faster-whisper not installed. "
                "Run: uv sync --extra local-asr"
            )
            raise
        except Exception as e:
            lg.error(f"[ASRLocalController] Failed to load model: {e}")
            raise

    @property
    def name(self) -> str:
        """Get implementation name."""
        return f"Faster-Whisper Local ({self.model_name}, {self.device})"

    def is_available(self) -> bool:
        """Check if faster-whisper is installed."""
        try:
            import faster_whisper  # noqa: F401

            return True
        except ImportError:
            return False

    def transcribe(
        self,
        audio_data: np.ndarray,
        sample_rate: int = ASRBase.SAMPLE_RATE,
    ) -> Optional[str]:
        """
        Transcribe audio data to text using local Whisper model.

        Args:
            audio_data: Audio data as int16 numpy array
            sample_rate: Sample rate of audio data

        Returns:
            Transcribed text, or None if failed
        """
        if not self.is_available():
            lg.error(
                "[ASRLocalController] faster-whisper not available. "
                "Run: uv sync --extra local-asr"
            )
            return None

        try:
            # Convert to WAV and save to temp file
            wav_bytes = self._audio_to_wav(audio_data, sample_rate)

            with tempfile.NamedTemporaryFile(
                suffix=".wav", delete=False
            ) as temp_file:
                temp_file.write(wav_bytes)
                temp_path = temp_file.name

            try:
                result = self._transcribe_file_internal(temp_path)
                return result
            finally:
                # Clean up temp file
                os.unlink(temp_path)

        except Exception as e:
            lg.error(f"[ASRLocalController] Transcription error: {e}")
            return None

    def transcribe_file(self, file_path: str) -> Optional[str]:
        """
        Transcribe audio from a file using local Whisper model.

        Args:
            file_path: Path to audio file

        Returns:
            Transcribed text, or None if failed
        """
        if not self.is_available():
            lg.error(
                "[ASRLocalController] faster-whisper not available. "
                "Run: uv sync --extra local-asr"
            )
            return None

        if not os.path.exists(file_path):
            lg.error(f"[ASRLocalController] File not found: {file_path}")
            return None

        return self._transcribe_file_internal(file_path)

    def _transcribe_file_internal(self, file_path: str) -> Optional[str]:
        """
        Internal method to transcribe a file.

        Args:
            file_path: Path to audio file

        Returns:
            Transcribed text, or None if failed
        """
        try:
            model = self._load_model()

            # Transcribe with VAD filtering
            segments, info = model.transcribe(
                file_path,
                language=self.language,
                vad_filter=True,
                vad_parameters={
                    "min_silence_duration_ms": 500,
                    "threshold": 0.5,
                },
            )

            # Collect all segments
            transcript_parts = []
            for segment in segments:
                transcript_parts.append(segment.text)

            transcript = "".join(transcript_parts).strip()

            # Log language detection info
            if info.language_probability > 0.5:
                lang_info = f"{info.language} ({info.language_probability:.0%})"
            else:
                lang_info = f"{info.language} (low confidence)"

            if transcript:
                lg.info(
                    f"[ASRLocalController] Transcribed ({lang_info}): "
                    f"{transcript[:50]}..."
                )

            return transcript if transcript else None

        except Exception as e:
            lg.error(f"[ASRLocalController] Transcription error: {e}")
            import traceback

            traceback.print_exc()
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

