"""
Character Manager - Handle character configuration and switching.

This module manages character profiles from charas.toml,
including persona prompts and TTS voice configurations.
"""

from dataclasses import dataclass
from typing import Optional

from loguru import logger as lg

from .config_loader import config


@dataclass
class VoiceConfig:
    """Configuration for a character's TTS voice."""

    gpt_weights_path: str
    sovits_weights_path: str
    ref_audio_path: str
    prompt_text: str
    prompt_lang: str


@dataclass
class CharacterConfig:
    """Configuration for a single character."""

    id: str  # Character ID (e.g., "Paimon")
    name: str  # Display name (e.g., "派蒙")
    prompt_path: str  # Path to prompt file
    voice: VoiceConfig  # Voice configuration


class CharacterManager:
    """
    Manager for character profiles loaded from charas.toml.

    Handles loading, switching, and managing character configurations
    including their prompts and voice settings.
    """

    def __init__(self):
        """Initialize the character manager."""
        self.characters: dict[str, CharacterConfig] = {}
        self.current_character: Optional[str] = None
        self._current_prompt: str = ""
        self._load_characters()

    def _load_characters(self) -> None:
        """Load character configurations from charas.toml."""
        characters_data = config.get_characters()

        for char_id, char_data in characters_data.items():
            voice_data = char_data.get("voice", {})
            voice_config = VoiceConfig(
                gpt_weights_path=voice_data.get("gpt_weights_path", ""),
                sovits_weights_path=voice_data.get("sovits_weights_path", ""),
                ref_audio_path=voice_data.get("ref_audio_path", ""),
                prompt_text=voice_data.get("prompt_text", ""),
                prompt_lang=voice_data.get("prompt_lang", "zh"),
            )

            self.characters[char_id] = CharacterConfig(
                id=char_id,
                name=char_data.get("name", char_id),
                prompt_path=char_data.get("prompt_path", ""),
                voice=voice_config,
            )

        lg.info(
            f"[CharacterManager] Loaded {len(self.characters)} characters: "
            f"{list(self.characters.keys())}"
        )

        # Set first character as default if available
        if self.characters:
            first_char = next(iter(self.characters.keys()))
            self.switch_character(first_char)

    def _load_prompt_file(self, prompt_path: str) -> str:
        """
        Load prompt content from file.

        Args:
            prompt_path: Relative path to prompt file from project root

        Returns:
            Prompt content string, or empty string if not found
        """
        full_path = config.project_root / prompt_path

        if not full_path.exists():
            lg.warning(f"[CharacterManager] Prompt file not found: {full_path}")
            return ""

        try:
            with open(full_path, "r", encoding="utf-8") as f:
                content = f.read().strip()
                lg.debug(f"[CharacterManager] Loaded prompt from {full_path}")
                return content
        except Exception as e:
            lg.error(f"[CharacterManager] Failed to load prompt: {e}")
            return ""

    def list_characters(self) -> list[str]:
        """
        List all available character IDs.

        Returns:
            List of character IDs
        """
        return list(self.characters.keys())

    def get_character(self, char_id: str) -> Optional[CharacterConfig]:
        """
        Get configuration for a specific character.

        Args:
            char_id: Character ID (e.g., "Paimon")

        Returns:
            CharacterConfig if found, None otherwise
        """
        return self.characters.get(char_id)

    def get_current_character(self) -> Optional[CharacterConfig]:
        """
        Get the currently selected character configuration.

        Returns:
            Current CharacterConfig if set, None otherwise
        """
        if self.current_character:
            return self.characters.get(self.current_character)
        return None

    def get_current_prompt(self) -> str:
        """
        Get the current character's system prompt.

        Returns:
            System prompt string
        """
        return self._current_prompt

    def get_current_voice(self) -> Optional[VoiceConfig]:
        """
        Get the current character's voice configuration.

        Returns:
            VoiceConfig if current character is set, None otherwise
        """
        char = self.get_current_character()
        if char:
            return char.voice
        return None

    def switch_character(self, char_id: str) -> bool:
        """
        Switch to a different character.

        This updates the current character, loads their prompt,
        and prepares their voice configuration.

        Args:
            char_id: Character ID to switch to

        Returns:
            True if switch was successful, False otherwise
        """
        if char_id not in self.characters:
            lg.warning(f"[CharacterManager] Character not found: {char_id}")
            return False

        char = self.characters[char_id]
        self.current_character = char_id

        # Load the character's prompt
        self._current_prompt = self._load_prompt_file(char.prompt_path)

        lg.info(f"[CharacterManager] Switched to character: {char.name} ({char_id})")
        return True

    def refresh_prompt(self) -> bool:
        """
        Reload the current character's prompt from file.

        Useful for hot-reloading prompt changes without restarting.

        Returns:
            True if refresh was successful, False otherwise
        """
        if not self.current_character:
            lg.warning("[CharacterManager] No character selected to refresh")
            return False

        char = self.characters.get(self.current_character)
        if not char:
            return False

        self._current_prompt = self._load_prompt_file(char.prompt_path)
        lg.info(f"[CharacterManager] Refreshed prompt for: {char.name}")
        return True

    def reload_characters(self) -> None:
        """
        Reload all character configurations from charas.toml.

        This also reloads the charas.toml file itself.
        """
        config.reload_charas_config()
        current = self.current_character
        self.characters.clear()
        self._load_characters()

        # Try to restore current character, or use first available
        if current and current in self.characters:
            self.switch_character(current)
        elif self.characters:
            self.switch_character(next(iter(self.characters.keys())))

        lg.info("[CharacterManager] Characters reloaded")

    def get_character_info(self, char_id: str) -> Optional[dict]:
        """
        Get character information as a dictionary (for API responses).

        Args:
            char_id: Character ID

        Returns:
            Dictionary with character info, or None if not found
        """
        char = self.get_character(char_id)
        if char:
            return {
                "id": char.id,
                "name": char.name,
                "prompt_text": char.voice.prompt_text,  # TTS reference text
                "is_current": char_id == self.current_character,
            }
        return None

    def get_all_characters_info(self) -> list[dict]:
        """
        Get information for all characters (for API responses).

        Returns:
            List of character info dictionaries
        """
        return [
            info
            for char_id in self.characters
            if (info := self.get_character_info(char_id)) is not None
        ]
