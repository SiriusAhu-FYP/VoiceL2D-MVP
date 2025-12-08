"""
ASR Controller - Factory for creating ASR implementations.

This module provides a factory function to create the appropriate ASR
controller based on the ASR_MODE environment variable.

Usage:
    from utils import create_asr_controller
    asr = create_asr_controller()  # Automatically selects based on ASR_MODE
"""

import os
from typing import Optional

from dotenv import load_dotenv
from loguru import logger as lg

from .asr_base import ASRBase

# Load environment variables
load_dotenv()


def create_asr_controller(mode: Optional[str] = None) -> ASRBase:
    """
    Factory function to create an ASR controller.

    Creates either an API-based or local ASR controller based on
    the ASR_MODE environment variable or the mode parameter.

    Args:
        mode: ASR mode ('api' or 'local'). If None, reads from ASR_MODE env.

    Returns:
        An ASR controller instance (either ASRApiController or ASRLocalController)

    Raises:
        ValueError: If the specified mode is invalid
        ImportError: If local mode dependencies are not installed
    """
    # Determine mode
    asr_mode = (mode or os.getenv("ASR_MODE", "api")).lower().strip()

    lg.info(f"[ASRController] Creating ASR controller with mode: {asr_mode}")

    if asr_mode == "api":
        from .asr_api import ASRApiController

        controller = ASRApiController()

        if not controller.is_available():
            lg.warning(
                "[ASRController] API mode selected but no API key configured. "
                "Set SILICONCLOUD_API_KEY environment variable."
            )

        return controller

    elif asr_mode == "local":
        try:
            from .asr_local import ASRLocalController

            controller = ASRLocalController()

            if not controller.is_available():
                lg.error(
                    "[ASRController] Local mode selected but faster-whisper "
                    "is not installed. Run: uv sync --extra local-asr"
                )
                # Fall back to API mode
                lg.warning("[ASRController] Falling back to API mode")
                from .asr_api import ASRApiController

                return ASRApiController()

            return controller

        except ImportError as e:
            lg.error(f"[ASRController] Failed to import local ASR: {e}")
            lg.warning("[ASRController] Falling back to API mode")
            from .asr_api import ASRApiController

            return ASRApiController()

    else:
        raise ValueError(f"Invalid ASR_MODE: '{asr_mode}'. Must be 'api' or 'local'.")


# Backwards compatibility: export ASRController as alias
# This allows existing code using `from utils import ASRController` to work
class ASRController(ASRBase):
    """
    Backwards-compatible ASR controller wrapper.

    This class wraps the factory-created controller for compatibility
    with existing code that imports ASRController directly.

    Prefer using create_asr_controller() for new code.
    """

    def __init__(self, mode: Optional[str] = None):
        """
        Initialize the ASR controller.

        Args:
            mode: ASR mode ('api' or 'local'). If None, reads from ASR_MODE env.
        """
        self._controller = create_asr_controller(mode)

    @property
    def name(self) -> str:
        """Get implementation name."""
        return self._controller.name

    def is_available(self) -> bool:
        """Check if controller is available."""
        return self._controller.is_available()

    def transcribe(self, audio_data, sample_rate: int = ASRBase.SAMPLE_RATE):
        """Transcribe audio data."""
        return self._controller.transcribe(audio_data, sample_rate)

    def transcribe_file(self, file_path: str):
        """Transcribe audio file."""
        return self._controller.transcribe_file(file_path)
