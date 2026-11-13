"""Name matching for blocklists: one normalised form for artists, albums and tags (ADR-0450).

"Beyonce", "Beyoncé" and "BEYONCÉ feat. Jay-Z" all carry the credit `beyonce`. A song's credit
list is its whole normalised artist plus every featured or joined credit, so blocking an artist
also blocks the songs they are featured on. Results are cached: a venue library repeats artists.
"""

from __future__ import annotations

import re
import unicodedata
from functools import lru_cache

_PUNCT = re.compile(r"[^\w\s]", re.UNICODE)
_CREDIT_SPLIT = re.compile(
    r"\s+(?:feat\.?|ft\.?|featuring|x|vs\.?)\s+|\s*(?:&|,|;|\+|/)\s*", re.IGNORECASE
)
_BRACKETS = str.maketrans({"(": " ", ")": " ", "[": " ", "]": " ", "{": " ", "}": " "})


@lru_cache(maxsize=262_144)
def normalise(text: str | None) -> str:
    """Casefold, strip accents and punctuation, collapse spaces."""
    if not text:
        return ""
    decomposed = unicodedata.normalize("NFKD", text)
    stripped = "".join(char for char in decomposed if not unicodedata.combining(char))
    return " ".join(_PUNCT.sub(" ", stripped.casefold()).split())


@lru_cache(maxsize=262_144)
def credits(artist: str | None) -> tuple[str, ...]:
    """The whole normalised artist, then each credit split on feat./ft./&/x/commas."""
    if not artist:
        return ()
    whole = normalise(artist)
    parts = [normalise(part) for part in _CREDIT_SPLIT.split(artist.translate(_BRACKETS))]
    return tuple(dict.fromkeys(name for name in (whole, *parts) if name))


def matches_artist(blocked: str, artist: str | None) -> bool:
    return normalise(blocked) in credits(artist)


def artist_variants(blocked: str, artists: list[str]) -> list[str]:
    """Every distinct artist spelling in `artists` that an artist entry for `blocked` matches."""
    target = normalise(blocked)
    found = [name for name in dict.fromkeys(artists) if target and target in credits(name)]
    return sorted(found, key=str.casefold)


__all__ = ["artist_variants", "credits", "matches_artist", "normalise"]
