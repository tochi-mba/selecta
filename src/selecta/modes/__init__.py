"""Runtime modes: local and cloud from one codebase (ADR-0392).

`SELECTA_MODE=local|cloud` picks the mode when a process starts; local is the default, so the app
on someone's own computer behaves exactly as it always has. The mode decides which adapters are
built (database, artifact storage, identity, where jobs run, Lucy's routing, network posture);
the engine itself (analysis, planner, render, seams, mix, Lucy's tools) is the same in both.

Features that only make sense in one mode say so in the flag registry's `modes` field, and
`available_in_mode` reads it, so mode checks don't end up as scattered `if` statements.

Importing this package reads constants and nothing else: no adapter is built, no environment
variable is read, until something asks.
"""

from __future__ import annotations

from selecta.modes.adapters import AdapterError, forget, get, register, registered, unregister
from selecta.modes.core import (
    ALL_MODES,
    DEFAULT,
    ENV,
    Mode,
    ModeError,
    WrongMode,
    available_in_mode,
    current_mode,
    parse_mode,
    require_mode,
)

__all__ = [
    "ALL_MODES",
    "DEFAULT",
    "ENV",
    "AdapterError",
    "Mode",
    "ModeError",
    "WrongMode",
    "available_in_mode",
    "current_mode",
    "forget",
    "get",
    "parse_mode",
    "register",
    "registered",
    "require_mode",
    "unregister",
]
