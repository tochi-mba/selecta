"""The content control feature flags, read in one place.

A flag that isn't registered yet reads as off, so the engine refuses rather than plays.
"""

from __future__ import annotations

from selecta import flags

ENGINE = "business.content_controls"
BULK = "business.content_controls.bulk"
LYRICS_HINT = "business.content_controls.lyrics_hint"
ALL = (ENGINE, BULK, LYRICS_HINT)


def on(flag_id: str) -> bool:
    try:
        return flags.on(flag_id)
    except KeyError:
        return False


__all__ = ["ALL", "BULK", "ENGINE", "LYRICS_HINT", "on"]
