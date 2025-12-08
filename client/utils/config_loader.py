"""
Config Loader - Load configuration from root config.toml.

Uses the toml library (personal preference over stdlib tomllib).
"""

from pathlib import Path
from typing import Any, Optional

import toml
from loguru import logger as lg


class ConfigLoader:
    """
    Loader for configuration from config.toml and charas.toml.

    Provides typed access to configuration values with defaults.
    """

    _instance: Optional["ConfigLoader"] = None
    _config: dict[str, Any] = {}
    _charas_config: dict[str, Any] = {}
    _project_root: Optional[Path] = None

    def __new__(cls) -> "ConfigLoader":
        """Singleton pattern to ensure config is loaded once."""
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._load_config()
            cls._instance._load_charas_config()
        return cls._instance

    def _load_config(self) -> None:
        """Load configuration from config.toml."""
        # Look for config.toml in project root
        self._project_root = Path(__file__).parent.parent.parent
        config_path = self._project_root / "config.toml"

        if not config_path.exists():
            lg.warning(f"[Config] config.toml not found at {config_path}")
            self._config = {}
            return

        try:
            self._config = toml.load(config_path)
            lg.debug(f"[Config] Loaded from {config_path}")
        except toml.TomlDecodeError as e:
            lg.error(f"[Config] Failed to parse config.toml: {e}")
            self._config = {}

    def _load_charas_config(self) -> None:
        """Load character configuration from charas.toml."""
        if self._project_root is None:
            self._project_root = Path(__file__).parent.parent.parent

        charas_path = self._project_root / "charas.toml"

        if not charas_path.exists():
            lg.warning(f"[Config] charas.toml not found at {charas_path}")
            self._charas_config = {}
            return

        try:
            self._charas_config = toml.load(charas_path)
            lg.debug(f"[Config] Loaded charas from {charas_path}")
        except toml.TomlDecodeError as e:
            lg.error(f"[Config] Failed to parse charas.toml: {e}")
            self._charas_config = {}

    @property
    def project_root(self) -> Path:
        """Get the project root path."""
        if self._project_root is None:
            self._project_root = Path(__file__).parent.parent.parent
        return self._project_root

    def get(self, *keys: str, default: Any = None) -> Any:
        """
        Get a configuration value by nested keys.

        Args:
            *keys: Nested keys to access (e.g., "llm", "model")
            default: Default value if key not found

        Returns:
            Configuration value or default
        """
        value = self._config
        for key in keys:
            if isinstance(value, dict) and key in value:
                value = value[key]
            else:
                return default
        return value

    # LLM Configuration
    @property
    def llm_base_url(self) -> str:
        return self.get(
            "llm", "base_url", default="https://open.bigmodel.cn/api/paas/v4/"
        )

    @property
    def llm_model(self) -> str:
        return self.get("llm", "model", default="glm-4-flash")

    # ASR Configuration
    @property
    def asr_api_url(self) -> str:
        return self.get(
            "asr",
            "api_url",
            default="https://api.siliconflow.cn/v1/audio/transcriptions",
        )

    @property
    def asr_api_model(self) -> str:
        return self.get("asr", "api_model", default="FunAudioLLM/SenseVoiceSmall")

    @property
    def asr_local_model(self) -> str:
        return self.get("asr", "local_model", default="base")

    @property
    def asr_local_language(self) -> str:
        return self.get("asr", "local_language", default="zh")

    # MCP Configuration
    @property
    def mcp_server_url(self) -> str:
        return self.get("mcp", "server_url", default="http://localhost:8848/mcp")

    # WebSocket Configuration
    @property
    def websocket_host(self) -> str:
        return self.get("websocket", "host", default="localhost")

    @property
    def websocket_port(self) -> int:
        return self.get("websocket", "port", default=7789)

    # VAD Configuration
    @property
    def vad_aggressiveness(self) -> int:
        return self.get("vad", "aggressiveness", default=2)

    @property
    def vad_silence_threshold(self) -> float:
        return self.get("vad", "silence_threshold", default=0.8)

    @property
    def vad_min_speech_duration(self) -> float:
        return self.get("vad", "min_speech_duration", default=1.0)

    # Audio Configuration
    @property
    def audio_sample_rate(self) -> int:
        return self.get("audio", "sample_rate", default=48000)

    @property
    def audio_channels(self) -> int:
        return self.get("audio", "channels", default=1)

    @property
    def audio_block_size(self) -> int:
        return self.get("audio", "block_size", default=480)

    @property
    def audio_lock_buffer(self) -> float:
        return self.get("audio", "lock_buffer_seconds", default=2.0)

    # Character Profiles (from charas.toml)
    def get_characters(self) -> dict[str, dict]:
        """Get all character profiles from charas.toml."""
        return self._charas_config.get("characters", {})

    def get_character(self, name: str) -> Optional[dict]:
        """
        Get a specific character profile.

        Args:
            name: Character name (e.g., "Paimon")

        Returns:
            Character config dict or None if not found
        """
        characters = self.get_characters()
        return characters.get(name)

    def reload_charas_config(self) -> None:
        """Reload character configuration from charas.toml."""
        self._load_charas_config()
        lg.info("[Config] Character configuration reloaded")


# Global config instance
config = ConfigLoader()
