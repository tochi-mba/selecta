"""The "Worth checking" list (ADR-0450, BZ-0450-05).

Songs whose available lyrics contain words on a review list are listed for a person to check.
This never sets a flag: a false "clean" is the worst error a venue can suffer, so a hint only
ever asks. Songs with no lyrics, or lyrics in a language the list doesn't cover, are reported as
not checked (never as fine).
"""

from __future__ import annotations

import re
from collections.abc import Iterable, Mapping

from selecta.business.content.engine import SongFacts
from selecta.business.content.names import normalise

REVIEW_WORDS_EN = frozenset({
    "fuck", "fucking", "fucked", "motherfucker", "shit", "bitch", "bitches", "cunt", "dick",
    "pussy", "cock", "whore", "slut", "nigga", "faggot", "bastard", "asshole", "cocaine",
    "molly", "blunt",
})
_ENGLISH_COMMON = frozenset({
    "the", "and", "you", "i", "me", "my", "to", "a", "it", "in", "is", "on", "we", "your",
    "that", "of", "for", "love", "all", "be", "so", "with", "this", "just", "can", "do",
})
_TOKEN = re.compile(r"[\w']+", re.UNICODE)
MIN_TOKENS_FOR_LANGUAGE = 8


def _tokens(text: str) -> list[str]:
    return _TOKEN.findall(normalise(text).replace("'", ""))


def looks_english(tokens: list[str]) -> bool:
    if len(tokens) < MIN_TOKENS_FOR_LANGUAGE:
        return True
    common = sum(1 for token in tokens if token in _ENGLISH_COMMON)
    return common / len(tokens) >= 0.05


def worth_checking(
    items: Iterable[tuple[SongFacts, str | None, str | None]], *,
    flags: Mapping[str, str] | None = None, words: Iterable[str] | None = None,
    word_lists: Mapping[str, Iterable[str]] | None = None,
) -> dict[str, list[dict]]:
    """`items` are (song, lyrics or None, language code or None)."""
    flags = flags or {}
    english = frozenset(normalise(w) for w in (words or REVIEW_WORDS_EN))
    lists = {lang.casefold()[:2]: frozenset(normalise(w) for w in found)
             for lang, found in (word_lists or {}).items()}
    lists.setdefault("en", english)
    listed, unchecked = [], []
    for song, lyrics, language in items:
        flag = flags.get(song.song_id, song.explicit)
        base = {"song_id": song.song_id, "title": song.title, "artist": song.artist,
                "explicit": flag}
        if not lyrics or not lyrics.strip():
            unchecked.append({**base, "why": "no_lyrics"})
            continue
        tokens = _tokens(lyrics)
        code = (language or "").casefold()[:2] or ("en" if looks_english(tokens) else "")
        review = lists.get(code)
        if review is None:
            unchecked.append({**base, "why": "other_language", "language": language or None})
            continue
        hits = sorted({token for token in tokens if token in review})
        if hits:
            listed.append({**base, "words": hits, "count": len(hits)})
    listed.sort(key=lambda item: (-item["count"], item["artist"].casefold(), item["title"]))
    return {"worth_checking": listed, "not_checked": unchecked}


__all__ = ["REVIEW_WORDS_EN", "looks_english", "worth_checking"]
