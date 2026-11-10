"""Local, bounded music-recording search; never rewrites or coalesces song metadata.

Ranking is for discovery only. The song ID stays authoritative when a recording
is selected, including covers, remixes and multiple editions of the same title.
"""
from __future__ import annotations

import re
import unicodedata
from collections import Counter
from difflib import SequenceMatcher
from functools import lru_cache

_SPACES = re.compile(r"\s+")
_PUNCTUATION = re.compile(r"[^\w]+", re.UNICODE)
_CREDITS = re.compile(r"\b(?:feat(?:uring)?|ft)\b", re.IGNORECASE)
_ENDS_IN_A_SYMBOL = re.compile(r"[^\w\s]\s*$", re.UNICODE)
# GP-0251-02: letters that NFKD leaves whole, so "orsted" still finds "Ørsted" and "lodz" finds
# "Łódź". Comparison only: the stored and displayed name is never rewritten.
_UNDECOMPOSED = str.maketrans(
    {"ø": "o", "æ": "ae", "œ": "oe", "ł": "l", "đ": "d", "ð": "d", "þ": "th", "ı": "i", "ŋ": "n"}
)


@lru_cache(maxsize=131072)
def normalize_music(text: str) -> str:
    """Case- and accent-insensitive comparison, not a display transformation."""
    decomposed = unicodedata.normalize("NFKD", text.casefold()).translate(_UNDECOMPOSED)
    plain = "".join(ch for ch in decomposed if not unicodedata.combining(ch))
    # Keep meaningful remix, live, edit, acoustic and remaster qualifiers intact.
    return _SPACES.sub(" ", _PUNCTUATION.sub(" ", _CREDITS.sub("feat", plain))).strip()


@lru_cache(maxsize=64)
def _letters(needle: str) -> Counter:
    return Counter(needle)


def relevance(query: str, song_id: int, artist: str | None, title: str | None) -> int | None:
    """Smaller is better. Return None rather than guessing at weak matches."""
    needle = normalize_music(query)
    if not needle:
        return 100
    # A recording ID is all digits; "100%" means the word 100, not recording 100.
    if query.strip().isdigit() and needle == str(song_id):
        return 0
    name = normalize_music(title or "")
    creator = normalize_music(artist or "")
    if needle == name:
        return 10
    if needle == creator:
        return 20
    # Punctuation is ignored so "ac dc" finds "AC/DC", but a symbol typed straight after the
    # last word still ends that word: "100%" means the whole word "100", not "1000".
    whole_word = bool(_ENDS_IN_A_SYMBOL.search(query))

    def starts(text: str) -> bool:
        return text == needle or text.startswith(needle + " ") or (
            not whole_word and text.startswith(needle)
        )

    def contains(text: str) -> bool:
        return f" {needle} " in f" {text} " or (not whole_word and needle in text)

    if starts(name):
        return 30
    if contains(name):
        return 35
    if starts(creator):
        return 40
    if contains(creator):
        return 45
    # Multi-token queries must match all tokens, avoiding broad single-word
    # matches that bury a version or feature credit under unrelated recordings.
    words = needle.split()
    tokens = set((name + " " + creator).split())
    if len(words) > 1 and all(word in tokens for word in words):
        return 50
    # Approximate matching is deliberately bounded. Short queries and weak
    # matches are not fuzzy-searched; a typo must not silently select a cover.
    if len(needle) < 4 or len(needle) > 72:
        return None
    candidates = [name, creator]
    candidates.extend(token for token in tokens if abs(len(token) - len(needle)) <= 2)
    best = 0.0
    letters = _letters(needle)
    for candidate in candidates:
        if not candidate or abs(len(candidate) - len(needle)) > 3:
            continue
        # GP-0251-08: twice the shared letters over both lengths is an upper bound on ratio(), so
        # the full comparison only runs for names that could pass. Same results, far less work on
        # 20,000 songs.
        shared = sum((Counter(candidate) & letters).values())
        if 2 * shared < 0.84 * (len(needle) + len(candidate)):
            continue
        best = max(best, SequenceMatcher(None, needle, candidate, autojunk=False).ratio())
    if best >= 0.84:
        return 60 + int((1.0 - best) * 100)
    return None


def match_label(rank: int | None) -> str | None:
    """Explain approximate results; never imply two recordings are identical."""
    if rank is None:
        return None
    if rank == 0:
        return "Recording ID"
    if rank == 10:
        return "Exact title"
    if rank == 20:
        return "Exact artist"
    if rank < 40:
        return "Title match"
    if rank < 50:
        return "Artist match"
    if rank < 60:
        return "Title and artist words"
    return "Approximate match - check the recording"
