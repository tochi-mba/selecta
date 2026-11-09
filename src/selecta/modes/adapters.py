"""The adapter registry: one name, one factory per mode, built only for the mode that's running.

Each concern that differs between the modes (the database, artifact storage, identity, where jobs
run, Lucy's routing) registers a factory for each mode under one name, for example
`register("artifacts", Mode.CLOUD, make_r2_store)`. `get("artifacts")` builds the current mode's
adapter the first time it's asked for and hands back the same one after that. The other mode's
factory is never called, so a mode can't run the other's startup side effects by accident.

Registering is cheap and does nothing but remember the factory. Nothing is registered at import.
"""

from __future__ import annotations

import re
import threading
from collections.abc import Callable
from typing import Any

from selecta.modes.core import Mode, current_mode, parse_mode

Factory = Callable[[], Any]

NAME = re.compile(r"^[a-z][a-z0-9_.]*$")

_lock = threading.RLock()
_factories: dict[tuple[str, Mode], Factory] = {}
_built: dict[tuple[str, Mode], Any] = {}


class AdapterError(LookupError):
    """An adapter that isn't registered for the mode that asked for it, or registered twice."""


def register(name: str, mode: str | Mode, factory: Factory, *, replace: bool = False) -> None:
    """Remember how to build `name` in `mode`. Registering the same pair twice is a mistake
    unless `replace` says it's meant (tests swapping in a fake, for example)."""
    if not NAME.match(name):
        raise AdapterError(f"Adapter names are lower case words joined by dots or _: {name!r}")
    if not callable(factory):
        raise AdapterError(f"The factory for {name!r} isn't callable.")
    key = (name, parse_mode(mode))
    with _lock:
        if key in _factories and not replace:
            raise AdapterError(f"{name!r} already has a {key[1].value} adapter.")
        _factories[key] = factory
        _built.pop(key, None)


def get(name: str) -> Any:
    """The adapter for `name` in this process's mode, built on first use and kept."""
    key = (name, current_mode())
    with _lock:
        if key in _built:
            return _built[key]
        factory = _factories.get(key)
        if factory is None:
            others = [mode.value for (n, mode) in _factories if n == name]
            where = f" It's registered for {', '.join(others)} only." if others else ""
            raise AdapterError(f"There's no {key[1].value} adapter called {name!r}.{where}")
        adapter = factory()
        _built[key] = adapter
        return adapter


def registered(name: str) -> tuple[Mode, ...]:
    """The modes `name` has an adapter for."""
    with _lock:
        return tuple(mode for (n, mode) in _factories if n == name)


def forget(name: str | None = None) -> None:
    """Drop built adapters (all, or just `name`) so the next `get` builds afresh. For tests and
    for a clean shutdown; factories stay registered."""
    with _lock:
        for key in [k for k in _built if name is None or k[0] == name]:
            del _built[key]


def unregister(name: str | None = None) -> None:
    """Forget factories as well as built adapters. For tests only."""
    with _lock:
        for key in [k for k in _factories if name is None or k[0] == name]:
            del _factories[key]
        forget(name)
