"""Which runtime mode this process is in, and what each mode can offer.

`SELECTA_MODE` is read every time it's asked for rather than cached, so tests can switch it with
an environment patch. Nothing here runs at import.
"""

from __future__ import annotations

import os
from enum import StrEnum

ENV = "SELECTA_MODE"


class Mode(StrEnum):
    LOCAL = "local"
    CLOUD = "cloud"


DEFAULT = Mode.LOCAL
ALL_MODES = tuple(mode.value for mode in Mode)


class ModeError(ValueError):
    """A mode setting that isn't one of the modes, said with the choices that would work."""


class WrongMode(RuntimeError):
    """Something that belongs to one mode was asked for while running in the other."""

    def __init__(self, needed: Mode, current: Mode) -> None:
        self.needed = needed
        self.current = current
        super().__init__(f"This needs {ENV}={needed.value}, but Selecta is running in {current.value}.")


def parse_mode(value: str | Mode) -> Mode:
    """`Mode` from text such as `"cloud"`. Case and surrounding spaces don't matter."""
    if isinstance(value, Mode):
        return value
    text = str(value).strip().lower()
    try:
        return Mode(text)
    except ValueError:
        choices = " or ".join(ALL_MODES)
        raise ModeError(f"{ENV} is {value!r}, which isn't a mode. Use {choices}.") from None


def current_mode() -> Mode:
    """This process's mode: `SELECTA_MODE`, or local when it isn't set or is blank."""
    raw = os.environ.get(ENV, "")
    if not raw.strip():
        return DEFAULT
    return parse_mode(raw)


def require_mode(mode: str | Mode) -> None:
    """Stop with `WrongMode` unless this process runs in `mode`."""
    needed = parse_mode(mode)
    current = current_mode()
    if current is not needed:
        raise WrongMode(needed, current)


def available_in_mode(flag_id: str, mode: str | Mode | None = None) -> bool:
    """Whether a feature can be offered in `mode` (default: this process's mode).

    The flag registry says which modes each feature works in; a flag that doesn't say works in
    both. This only answers the mode question: whether the flag is turned on is `flags.on`.
    """
    from selecta import flags

    flag = flags.registry().get(flag_id)
    if flag is None:
        raise KeyError(f"There's no flag called {flag_id!r}.")
    wanted = parse_mode(mode) if mode is not None else current_mode()
    modes = getattr(flag, "modes", ALL_MODES)
    return wanted.value in {str(getattr(m, "value", m)) for m in modes}
