"""
Voice Manager - Handle voice configuration and switching.

This module manages voice profiles from config.toml, allowing
dynamic switching between different TTS voices.
"""

import tomllib
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

from loguru import logger as lg


@dataclass
class VoiceConfig:
    """Configuration for a single voice profile."""

    name: str
    gpt_weights_path: str
    sovits_weights_path: str
    ref_audio_path: str
    prompt_text: str
    prompt_lang: str


class VoiceManager:
    """
    Manager for voice profiles loaded from config.toml.
    
    Handles loading, listing, and retrieving voice configurations
    for the TTS system.
    """

    def __init__(self, config_path: Optional[Path] = None):
        """
        Initialize the voice manager.
        
        Args:
            config_path: Path to config.toml. If None, uses default location.
        """
        if config_path is None:
            config_path = Path(__file__).parent / "config.toml"
        
        self.config_path = config_path
        self.voices: dict[str, VoiceConfig] = {}
        self.current_voice: Optional[str] = None
        self._load_config()

    def _load_config(self) -> None:
        """Load voice configurations from TOML file."""
        try:
            with open(self.config_path, "rb") as f:
                config_data = tomllib.load(f)
            
            for voice_name, voice_data in config_data.items():
                self.voices[voice_name] = VoiceConfig(
                    name=voice_name,
                    gpt_weights_path=voice_data.get("gpt_weights_path", ""),
                    sovits_weights_path=voice_data.get("sovits_weights_path", ""),
                    ref_audio_path=voice_data.get("ref_audio_path", ""),
                    prompt_text=voice_data.get("prompt_text", ""),
                    prompt_lang=voice_data.get("prompt_lang", "zh"),
                )
            
            lg.info(f"[VoiceManager] Loaded {len(self.voices)} voice profiles: {list(self.voices.keys())}")
            
            # Set first voice as default if available
            if self.voices:
                self.current_voice = next(iter(self.voices.keys()))
                lg.info(f"[VoiceManager] Default voice set to: {self.current_voice}")
                
        except FileNotFoundError:
            lg.warning(f"[VoiceManager] Warning: config.toml not found at {self.config_path}")
        except tomllib.TOMLDecodeError as e:
            lg.error(f"[VoiceManager] Error parsing config.toml: {e}")

    def list_voices(self) -> list[str]:
        """
        List all available voice names.
        
        Returns:
            List of voice profile names
        """
        return list(self.voices.keys())

    def get_voice(self, voice_name: str) -> Optional[VoiceConfig]:
        """
        Get configuration for a specific voice.
        
        Args:
            voice_name: Name of the voice profile
            
        Returns:
            VoiceConfig if found, None otherwise
        """
        return self.voices.get(voice_name)

    def get_current_voice(self) -> Optional[VoiceConfig]:
        """
        Get the currently selected voice configuration.
        
        Returns:
            Current VoiceConfig if set, None otherwise
        """
        if self.current_voice:
            return self.voices.get(self.current_voice)
        return None

    def set_current_voice(self, voice_name: str) -> bool:
        """
        Set the current voice by name.
        
        Args:
            voice_name: Name of the voice to select
            
        Returns:
            True if voice was found and set, False otherwise
        """
        if voice_name in self.voices:
            self.current_voice = voice_name
            lg.info(f"[VoiceManager] Switched to voice: {voice_name}")
            return True
        else:
            lg.warning(f"[VoiceManager] Voice not found: {voice_name}")
            lg.debug(f"[VoiceManager] Available voices: {list(self.voices.keys())}")
            return False

    def get_voice_info(self, voice_name: str) -> Optional[dict]:
        """
        Get voice information as a dictionary.
        
        Args:
            voice_name: Name of the voice profile
            
        Returns:
            Dictionary with voice info, or None if not found
        """
        voice = self.get_voice(voice_name)
        if voice:
            return {
                "name": voice.name,
                "gpt_weights_path": voice.gpt_weights_path,
                "sovits_weights_path": voice.sovits_weights_path,
                "ref_audio_path": voice.ref_audio_path,
                "prompt_text": voice.prompt_text,
                "prompt_lang": voice.prompt_lang,
            }
        return None




