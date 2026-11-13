"""Restricted, crash-safe local engine configuration and private state."""

from __future__ import annotations

import json
import os
import secrets
import sys
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

CONFIG_VERSION = 1
DEFAULT_PORT = 8768


class EngineConfigError(ValueError):
    pass


def state_directory(platform: str | None = None, home: Path | None = None) -> Path:
    """Stable engine state, deliberately separate from legacy SELECTA_HOME music."""
    platform = platform or sys.platform
    home = home or Path.home()
    override = os.environ.get("SELECTA_ENGINE_STATE_DIR", "")
    if override:
        return Path(override).expanduser().resolve()
    if platform == "win32":
        return Path(os.environ.get("LOCALAPPDATA", str(home / "AppData" / "Local"))) / (
            "Selecta/Engine"
        )
    if platform == "darwin":
        return home / "Library/Application Support/Selecta/Engine"
    xdg = os.environ.get("XDG_STATE_HOME", "")
    return (Path(xdg) if xdg else home / ".local/state") / "selecta/engine"


def ensure_private(directory: Path) -> Path:
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    if directory.is_symlink():
        raise EngineConfigError("The engine state directory may not be a symlink.")
    if os.name != "nt":
        directory.chmod(0o700)
    return directory


def atomic_json(path: Path, data: dict[str, Any]) -> None:
    ensure_private(path.parent)
    if path.is_symlink():
        raise EngineConfigError("Refusing to replace a symlinked state file.")
    temporary = path.with_name(f".{path.name}.{secrets.token_hex(8)}.tmp")
    try:
        with temporary.open("x", encoding="utf-8") as stream:
            if os.name != "nt":
                os.chmod(temporary, 0o600)
            json.dump(data, stream, sort_keys=True, indent=2)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


@dataclass(frozen=True)
class EngineConfig:
    version: int = CONFIG_VERSION
    port: int = DEFAULT_PORT
    restart_limit: int = 5
    startup_timeout_seconds: int = 120
    workspace: str = "standalone"

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> EngineConfig:
        if not isinstance(data, dict) or set(data) - set(cls.__dataclass_fields__):
            raise EngineConfigError("Unrecognised engine settings.")
        if type(data.get("version", CONFIG_VERSION)) is not int or data.get(
            "version", CONFIG_VERSION
        ) != CONFIG_VERSION:
            raise EngineConfigError("Unsupported engine configuration version.")
        options = cls(**data)
        if type(options.port) is not int or not 1024 <= options.port <= 65535:
            raise EngineConfigError("The local engine port must be 1024-65535.")
        if type(options.restart_limit) is not int or not 0 <= options.restart_limit <= 30:
            raise EngineConfigError("restart_limit must be between 0 and 30.")
        if (
            type(options.startup_timeout_seconds) is not int
            or not 5 <= options.startup_timeout_seconds <= 600
        ):
            raise EngineConfigError("startup_timeout_seconds must be 5-600.")
        if options.workspace not in ("standalone", "personal", "organisation"):
            raise EngineConfigError("Unknown workspace kind.")
        return options


def load_config(directory: Path, *, recover: bool = True) -> EngineConfig:
    ensure_private(directory)
    path = directory / "engine.json"
    if not path.exists():
        config = EngineConfig()
        atomic_json(path, asdict(config))
        return config
    try:
        if path.is_symlink() or path.stat().st_size > 16_384:
            raise EngineConfigError("Unsafe or oversized configuration.")
        data = json.loads(path.read_text(encoding="utf-8"))
        return EngineConfig.from_dict(data)
    except (OSError, ValueError, TypeError, EngineConfigError) as exc:
        if not recover:
            raise EngineConfigError(f"Invalid configuration: {type(exc).__name__}") from exc
        # Preserve damaged configuration for inspection, never execute its contents.
        backup = directory / f"engine.corrupt.{time.time_ns()}.json"
        path.replace(backup)
        config = EngineConfig()
        atomic_json(path, asdict(config))
        return config


def save_config(directory: Path, config: EngineConfig) -> None:
    EngineConfig.from_dict(asdict(config))
    atomic_json(directory / "engine.json", asdict(config))


def rotate_access(directory: Path) -> str:
    """Revokes existing headless clients. Never write tokens to diagnostics."""
    token = secrets.token_urlsafe(32)
    atomic_json(directory / "access.json", {"version": 1, "token": token})
    return token


def access_token(directory: Path) -> str:
    path = directory / "access.json"
    if not path.exists():
        return rotate_access(directory)
    if path.is_symlink():
        raise EngineConfigError("Symlinked access credentials are forbidden.")
    data = json.loads(path.read_text("utf-8"))
    token = data.get("token")
    if data.get("version") != 1 or not isinstance(token, str) or len(token) < 32:
        raise EngineConfigError("Invalid local access token; rotate from local CLI.")
    return token
