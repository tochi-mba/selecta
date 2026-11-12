"""Local, bounded music-recording search; never rewrites or coalesces song metadata.

Ranking is for discovery only. The song ID stays authoritative when a recording
is selected, including covers, remixes and multiple editions of the same title.
"""

from __future__ import annotations

import re
import unicodedata
from collections.abc import Callable, Iterable
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
    if text.isascii():
        # the same answer, quicker: plain ASCII has nothing to decompose, fold or translate
        plain = text.lower()
        # letters and digits in single-spaced words, with no credit to rewrite, are already
        # in their compared form; the three rewrites below would hand back the same string
        if (
            plain.replace(" ", "").isalnum()
            and "  " not in plain
            and plain[0] != " "
            and plain[-1] != " "
            and "ft" not in plain
            and "feat" not in plain
        ):
            return plain
    else:
        decomposed = unicodedata.normalize("NFKD", text.casefold()).translate(_UNDECOMPOSED)
        plain = "".join(ch for ch in decomposed if not unicodedata.combining(ch))
    # Keep meaningful remix, live, edit, acoustic and remaster qualifiers intact.
    return _SPACES.sub(" ", _PUNCTUATION.sub(" ", _CREDITS.sub("feat", plain))).strip()


@lru_cache(maxsize=131072)
def _closeness(needle: str, candidate: str) -> float:
    """Return the cached similarity score used by GP-0251-08.

    Repeated words in a 20,000-song library are compared once per search, not per row.
    ``quick_ratio`` avoids a full comparison for names that cannot meet the threshold.
    """
    # A bound on quick_ratio from which characters each side has at all: most names in a large
    # library fail it, so they never build a SequenceMatcher (GP-0258-08 search paging at 20k).
    have, want = set(candidate), set(needle)
    shared = min(
        len(needle) - sum(ch not in have for ch in needle),
        len(candidate) - sum(ch not in want for ch in candidate),
    )
    if 2.0 * shared / (len(needle) + len(candidate)) < 0.84:
        return 0.0
    matcher = SequenceMatcher(None, needle, candidate, autojunk=False)
    return matcher.ratio() if matcher.quick_ratio() >= 0.84 else 0.0


def relevance(query: str, song_id: int, artist: str | None, title: str | None) -> int | None:
    """Smaller is better. Return None rather than guessing at weak matches."""
    return _ranker(query)(song_id, artist, title)


def rank_songs(query: str, songs: Iterable[tuple[int, str | None, str | None]]) -> dict[int, int]:
    """Rank a whole library at once: ``{song id: rank}`` for every (id, artist, title) that
    matches, each rank exactly what ``relevance`` gives that song (MI-0162-04).

    Ranking in one Python pass, rather than asking for it row by row from inside SQL, is what
    makes a 20,000-song search quick; the database then only joins the matches."""
    rank = _ranker(query)
    found: dict[int, int] = {}
    for song_id, artist, title in songs:
        place = rank(song_id, artist, title)
        if place is not None:
            found[song_id] = place
    return found


@lru_cache(maxsize=131072)
def _prepared(title: str, artist: str) -> tuple[str, str, frozenset[str]]:
    """One song's names as search compares them, worked out once per process, not per search:
    the title, the artist and every word of either (MI-0162-04)."""
    name = normalize_music(title)
    creator = normalize_music(artist)
    return name, creator, frozenset((name + " " + creator).split())


@lru_cache(maxsize=64)
def _ranker(query: str) -> Callable[[int, str | None, str | None], int | None]:
    """The rules below, with everything about the query worked out once, so ranking 20,000 songs
    costs a few lookups each (MI-0162-04). The results are exactly those of the rules as written."""
    needle = normalize_music(query)
    if not needle:
        return lambda song_id, artist, title: 100
    # A recording ID is all digits; "100%" means the word 100, not recording 100.
    by_id = query.strip().isdigit()
    # Punctuation is ignored so "ac dc" finds "AC/DC", but a symbol typed straight after the
    # last word still ends that word: "100%" means the whole word "100", not "1000".
    whole_word = bool(_ENDS_IN_A_SYMBOL.search(query))
    spaced = f" {needle} "
    word_start = needle + " "
    # Multi-token queries must match all tokens, avoiding broad single-word
    # matches that bury a version or feature credit under unrelated recordings.
    words = needle.split()
    several = len(words) > 1
    # Approximate matching is deliberately bounded. Short queries and weak
    # matches are not fuzzy-searched; a typo must not silently select a cover.
    size = len(needle)
    fuzzy = 4 <= size <= 72
    shortest, longest = size - 2, size + 2
    close: dict[str, float] = {}
    # MI-0162-04: a library repeats the same words thousands of times, so each distinct word is
    # compared once per search; ``near`` keeps the ones close enough to count (scores >= 0.84).
    # The best of a song's words is then the best of its words in ``near``, as the rule says.
    seen: set[str] = set()
    near: dict[str, float] = {}
    letters = frozenset(needle)

    def closeness(candidate: str) -> float:
        known = close.get(candidate)
        if known is None:
            # nothing in common (a number against a word, say) can't be close: skip the arithmetic
            known = 0.0 if letters.isdisjoint(candidate) else _closeness(needle, candidate)
            close[candidate] = known
        return known

    def starts(text: str) -> bool:
        return (
            text == needle
            or text.startswith(word_start)
            or (not whole_word and text.startswith(needle))
        )

    def contains(text: str) -> bool:
        return spaced in f" {text} " or (not whole_word and needle in text)

    def rank(song_id: int, artist: str | None, title: str | None) -> int | None:
        if by_id and needle == str(song_id):
            return 0
        name, creator, tokens = _prepared(title or "", artist or "")
        # every title or artist match below contains the query, so one test rules them all out
        in_name = needle in name
        in_creator = needle in creator
        if in_name or in_creator:
            if needle == name:
                return 10
            if needle == creator:
                return 20
            if in_name and starts(name):
                return 30
            if in_name and contains(name):
                return 35
            if in_creator and starts(creator):
                return 40
            if in_creator and contains(creator):
                return 45
        if several and all(word in tokens for word in words):
            return 50
        if not fuzzy:
            return None
        best = 0.0
        for candidate in (name, creator):
            if candidate and size - 3 <= len(candidate) <= size + 3:
                best = max(best, closeness(candidate))
        if not seen.issuperset(tokens):
            for token in tokens.difference(seen):
                seen.add(token)
                if shortest <= len(token) <= longest:
                    score = closeness(token)
                    if score >= 0.84:
                        near[token] = score
        if near and not tokens.isdisjoint(near):
            best = max(best, max(near[token] for token in tokens if token in near))
        if best >= 0.84:
            return 60 + int((1.0 - best) * 100)
        return None

    return rank


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
