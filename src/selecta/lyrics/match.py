"""Token-safe, multilingual lyric-link discovery from line-synchronised lyrics."""

from __future__ import annotations

import re
from collections import Counter, defaultdict
from dataclasses import dataclass

from selecta.lyrics.lrclib import Line

TOKEN = re.compile(r"[^\W_]+(?:['’][^\W_]+)?", re.UNICODE)
STOP = {
    "the",
    "a",
    "an",
    "and",
    "or",
    "to",
    "of",
    "in",
    "on",
    "for",
    "i",
    "you",
    "me",
    "my",
    "it",
    "is",
    "we",
}


@dataclass(frozen=True)
class LyricLink:
    song_a: int
    song_b: int
    kind: str
    phrase: str
    line_a: Line
    line_b: Line
    score: float


def normalise(text: str) -> tuple[str, ...]:
    return tuple(x.casefold().replace("’", "'") for x in TOKEN.findall(text))


def discover(lines_by_song: dict[int, list[Line]], limit: int = 5000) -> list[LyricLink]:
    grams: dict[tuple[str, ...], list[tuple[int, Line]]] = defaultdict(list)
    hook_counts: dict[int, Counter] = {}
    for song_id, lines in lines_by_song.items():
        hook_counts[song_id] = Counter(normalise(line.text) for line in lines)
        for line in lines:
            words = normalise(line.text)
            content = [w for w in words if w not in STOP and len(w) > 2]
            for n in (3, 2):
                for i in range(len(words) - n + 1):
                    gram = words[i : i + n]
                    if sum(w not in STOP for w in gram) >= 2:
                        grams[gram].append((song_id, line))
            for word in set(content):
                grams[(word,)].append((song_id, line))
    links: list[LyricLink] = []
    for gram, occurrences in grams.items():
        for i, (a, line_a) in enumerate(occurrences):
            for b, line_b in occurrences[i + 1 :]:
                if a == b:
                    continue
                hooks = (
                    hook_counts[a][normalise(line_a.text)] > 1
                    and hook_counts[b][normalise(line_b.text)] > 1
                )
                kind = (
                    "shared_hook"
                    if hooks
                    else ("shared_phrase" if len(gram) > 1 else "shared_word")
                )
                recognition = min(1.0, 0.45 + 0.2 * len(gram) + (0.2 if hooks else 0))
                intelligibility = min(
                    1.0, 0.55 + 0.08 * min(len(normalise(line_a.text)), len(normalise(line_b.text)))
                )
                links.append(
                    LyricLink(
                        a, b, kind, " ".join(gram), line_a, line_b, recognition * intelligibility
                    )
                )
    links.sort(key=lambda link: -link.score)
    return links[:limit]
