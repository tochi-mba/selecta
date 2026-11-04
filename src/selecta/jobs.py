"""Background work stays polite: playback always comes first."""

from __future__ import annotations

import sys

import psutil


def lower_priority() -> None:
    process = psutil.Process()
    if sys.platform == "win32":
        process.nice(psutil.BELOW_NORMAL_PRIORITY_CLASS)
    else:
        process.nice(10)
