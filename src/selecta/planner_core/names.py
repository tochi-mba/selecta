"""Who a song is by, as the planner compares it. Plain text rules, so every studio agrees."""

from __future__ import annotations

import re

ARTIST_SPLIT = re.compile(
    r"\s*(,|&|;|/|\bfeat\.?\b|\bft\.?\b|\bfeaturing\b|\bx\b|\band\b)\s*", re.IGNORECASE
)
"""Where one credited artist ends and the next begins. The library scan splits on the same rule."""


def clean_artist(artist: str | None) -> str:
    return ARTIST_SPLIT.split(artist or "")[0].strip()
