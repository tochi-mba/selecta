"""Where Selecta keeps its data, and the limits it works within."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

SAMPLE_RATE = 44_100
ANALYSIS_VERSION = 3


def default_home() -> Path:
    override = os.environ.get("SELECTA_HOME")
    if override:
        return Path(override)
    local = os.environ.get("LOCALAPPDATA")
    return Path(local) / "selecta" if local else Path.home() / ".selecta"


@dataclass(frozen=True)
class Settings:
    home: Path
    cache_cap_bytes: int = 5 * 1024**3
    beat_model: str = "small0"
    beat_model_fallback: str = "final0"

    @property
    def db_path(self) -> Path:
        return self.home / "selecta.sqlite"

    @property
    def features_dir(self) -> Path:
        return self.home / "features"

    @property
    def models_dir(self) -> Path:
        return self.home / "models"

    @property
    def renders_dir(self) -> Path:
        return self.home / "renders"

    def ensure_dirs(self) -> None:
        for path in (self.home, self.features_dir, self.models_dir, self.renders_dir):
            path.mkdir(parents=True, exist_ok=True)


def load_settings() -> Settings:
    settings = Settings(home=default_home())
    settings.ensure_dirs()
    return settings
