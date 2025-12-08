"""
ASR Base - Abstract base class for ASR implementations.

This module defines the common interface for all ASR implementations,
allowing seamless switching between API and local modes.
"""

from abc import ABC, abstractmethod
from typing import Optional

import numpy as np


class ASRBase(ABC):
    """
    Abstract base class for ASR (Automatic Speech Recognition) controllers.

    All ASR implementations (API, local) must inherit from this class
    and implement the required methods.
    """

    # Common audio parameters
    SAMPLE_RATE = 16000
    CHANNELS = 1
    SAMPLE_WIDTH = 2  # 16-bit

    @abstractmethod
    def transcribe(
        self,
        audio_data: np.ndarray,
        sample_rate: int = SAMPLE_RATE,
    ) -> Optional[str]:
        """
        Transcribe audio data to text.

        Args:
            audio_data: Audio data as int16 numpy array
            sample_rate: Sample rate of audio data

        Returns:
            Transcribed text, or None if failed
        """
        pass

    @abstractmethod
    def transcribe_file(self, file_path: str) -> Optional[str]:
        """
        Transcribe audio from a file.

        Args:
            file_path: Path to audio file (.wav or .mp3)

        Returns:
            Transcribed text, or None if failed
        """
        pass

    @abstractmethod
    def is_available(self) -> bool:
        """
        Check if this ASR implementation is available and properly configured.

        Returns:
            True if available, False otherwise
        """
        pass

    @property
    @abstractmethod
    def name(self) -> str:
        """
        Get the name of this ASR implementation.

        Returns:
            Implementation name (e.g., "GLM-ASR API", "Faster-Whisper Local")
        """
        pass

