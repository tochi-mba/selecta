"""Where Selecta keeps its data, and the limits it works within."""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path

SAMPLE_RATE = 44_100
ANALYSIS_VERSION = 3


def default_home() -> Path:
    """The user's own folder, not AppData: packaged desktop apps quietly redirect AppData to a
    private copy, which split one library into a separate folder for each app that started it."""
    override = os.environ.get("SELECTA_HOME")
    return Path(override) if override else Path.home() / ".selecta"


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

    @property
    def storage_file(self) -> Path:
        return self.home / "storage.json"

    @property
    def effective_cache_cap_bytes(self) -> int:
        try:
            value = json.loads(self.storage_file.read_text("utf-8"))["budget_bytes"]
            return max(512 * 1024**2, int(value))
        except (OSError, KeyError, TypeError, ValueError, json.JSONDecodeError):
            return self.cache_cap_bytes

    def set_storage_budget(self, budget_bytes: int) -> None:
        minimum = 512 * 1024**2
        self.storage_file.write_text(
            json.dumps({"budget_bytes": max(minimum, int(budget_bytes))}, indent=2), "utf-8"
        )

    def ensure_dirs(self) -> None:
        for path in (self.home, self.features_dir, self.models_dir, self.renders_dir):
            path.mkdir(parents=True, exist_ok=True)


def load_settings() -> Settings:
    settings = Settings(home=default_home())
    settings.ensure_dirs()
    return settings
