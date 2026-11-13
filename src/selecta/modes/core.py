"""Runtime selectors. Legacy SELECTA_MODE remains independent of local-engine topology."""

from __future__ import annotations

import os
from dataclasses import dataclass
from enum import StrEnum

ENV = "SELECTA_MODE"


class Mode(StrEnum):
    LOCAL = "local"
    CLOUD = "cloud"


DEFAULT = Mode.LOCAL
ALL_MODES = tuple(mode.value for mode in Mode)


class ModeError(ValueError):
    """An invalid mode or topology dimension."""


class WrongMode(RuntimeError):
    """A feature requiring one legacy process mode ran in the other."""

    def __init__(self, needed: Mode, current: Mode) -> None:
        self.needed = needed
        self.current = current
        super().__init__(
            f"This needs {ENV}={needed.value}, but Selecta is running in {current.value}."
        )


def parse_mode(value: str | Mode) -> Mode:
    if isinstance(value, Mode):
        return value
    text = str(value).strip().lower()
    try:
        return Mode(text)
    except ValueError:
        choices = " or ".join(ALL_MODES)
        raise ModeError(f"{ENV} is {value!r}, which isn't a mode. Use {choices}.") from None


def current_mode() -> Mode:
    raw = os.environ.get(ENV, "")
    return parse_mode(raw) if raw.strip() else DEFAULT


def require_mode(mode: str | Mode) -> None:
    needed = parse_mode(mode)
    current = current_mode()
    if current is not needed:
        raise WrongMode(needed, current)


def available_in_mode(flag_id: str, mode: str | Mode | None = None) -> bool:
    """Legacy flag compatibility; availability is not audio-output readiness."""
    from selecta import flags

    flag = flags.registry().get(flag_id)
    if flag is None:
        raise KeyError(f"There's no flag called {flag_id!r}.")
    wanted = parse_mode(mode) if mode is not None else current_mode()
    modes = getattr(flag, "modes", ALL_MODES)
    return wanted.value in {str(getattr(m, "value", m)) for m in modes}


class WorkspaceKind(StrEnum):
    STANDALONE = "standalone"
    PERSONAL = "personal"
    ORGANISATION = "organisation"


class EngineRole(StrEnum):
    LOCAL_ENGINE = "local_engine"
    CONTROLLER_ONLY = "controller_only"


class Connectivity(StrEnum):
    ONLINE = "online"
    DEGRADED = "degraded"
    OFFLINE = "offline"
    UNKNOWN = "unknown"


@dataclass(frozen=True)
class RuntimeTopology:
    """Four orthogonal axes; never infer playability from Mode.CLOUD."""

    mode: Mode
    workspace: WorkspaceKind
    role: EngineRole
    connectivity: Connectivity

    @property
    def may_execute_local_audio(self) -> bool:
        return self.mode is Mode.LOCAL and self.role is EngineRole.LOCAL_ENGINE


def _dimension(enum_type, env: str, default):
    value = os.getenv(env, "").strip().lower()
    try:
        return enum_type(value) if value else default
    except ValueError:
        raise ModeError(
            f"{env}={value!r} is invalid; use {', '.join(item.value for item in enum_type)}."
        ) from None


def runtime_topology() -> RuntimeTopology:
    """Legacy local defaults to account-free standalone and an offline-capable engine."""
    mode = current_mode()
    workspace = _dimension(
        WorkspaceKind, "SELECTA_WORKSPACE_KIND",
        WorkspaceKind.STANDALONE if mode is Mode.LOCAL else WorkspaceKind.PERSONAL,
    )
    role = _dimension(
        EngineRole, "SELECTA_ENGINE_ROLE",
        EngineRole.LOCAL_ENGINE if mode is Mode.LOCAL else EngineRole.CONTROLLER_ONLY,
    )
    connectivity = _dimension(
        Connectivity, "SELECTA_CONNECTIVITY",
        Connectivity.OFFLINE if workspace is WorkspaceKind.STANDALONE
        else Connectivity.UNKNOWN,
    )
    if mode is Mode.CLOUD and role is EngineRole.LOCAL_ENGINE:
        raise ModeError("A hosted cloud process cannot claim the local audio-executor role.")
    if mode is Mode.CLOUD and workspace is WorkspaceKind.STANDALONE:
        raise ModeError("Standalone workspaces run in SELECTA_MODE=local.")
    return RuntimeTopology(mode, workspace, role, connectivity)
