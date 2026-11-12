"""MI-0162-04: Library search over 20,000 songs is quick, and quick without changing a result.

The faster search ranks the whole library in one Python pass (``rank_songs``) and lets SQLite join
only the matches, and it skips rewriting names that are already plain. These tests hold it to the
rules as first written (kept verbatim below as the reference) on awkward names and many queries,
and time a cold and a warm search over a generated 20,000-song library with a generous bound.
"""

from __future__ import annotations

import random
import re
import time
import unicodedata
from difflib import SequenceMatcher

from fastapi.testclient import TestClient

from selecta import db
from selecta.api import create_app
from selecta.config import Settings
from selecta.library.relevance import normalize_music, rank_songs, relevance

# ---- the reference: the search rules as written before any speed work (GP-0251) ----
_SPACES = re.compile(r"\s+")
_PUNCTUATION = re.compile(r"[^\w]+", re.UNICODE)
_CREDITS = re.compile(r"\b(?:feat(?:uring)?|ft)\b", re.IGNORECASE)
_ENDS_IN_A_SYMBOL = re.compile(r"[^\w\s]\s*$", re.UNICODE)
_UNDECOMPOSED = str.maketrans(
    {"ø": "o", "æ": "ae", "œ": "oe", "ł": "l", "đ": "d", "ð": "d", "þ": "th", "ı": "i", "ŋ": "n"}
)


def _normalize(text: str) -> str:
    decomposed = unicodedata.normalize("NFKD", text.casefold()).translate(_UNDECOMPOSED)
    plain = "".join(ch for ch in decomposed if not unicodedata.combining(ch))
    return _SPACES.sub(" ", _PUNCTUATION.sub(" ", _CREDITS.sub("feat", plain))).strip()


def _closeness(needle: str, candidate: str) -> float:
    matcher = SequenceMatcher(None, needle, candidate, autojunk=False)
    return matcher.ratio() if matcher.quick_ratio() >= 0.84 else 0.0


def _reference(query: str, song_id: int, artist: str | None, title: str | None) -> int | None:
    needle = _normalize(query)
    if not needle:
        return 100
    if query.strip().isdigit() and needle == str(song_id):
        return 0
    name = _normalize(title or "")
    creator = _normalize(artist or "")
    if needle == name:
        return 10
    if needle == creator:
        return 20
    whole_word = bool(_ENDS_IN_A_SYMBOL.search(query))

    def starts(text: str) -> bool:
        return (
            text == needle
            or text.startswith(needle + " ")
            or (not whole_word and text.startswith(needle))
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
    words = needle.split()
    tokens = set((name + " " + creator).split())
    if len(words) > 1 and all(word in tokens for word in words):
        return 50
    if len(needle) < 4 or len(needle) > 72:
        return None
    candidates = [name, creator]
    candidates.extend(token for token in tokens if abs(len(token) - len(needle)) <= 2)
    best = max(
        (
            _closeness(needle, candidate)
            for candidate in candidates
            if candidate and abs(len(candidate) - len(needle)) <= 3
        ),
        default=0.0,
    )
    if best >= 0.84:
        return 60 + int((1.0 - best) * 100)
    return None


# ---- awkward names and queries ----
_WORDS = [
    "Golden", "golden", "Goldn", "River", "Rivers", "Ørsted", "Łódź", "Beyoncé", "AC/DC", "ACDC",
    "feat.", "ft", "Featuring", "left", "soft", "100%", "1000", "Hey!", "Heyday", "Love", "Lovers",
    "  ", "-", "Remix", "(Live)", "café", "Cafe", "Naïve", "über", "Straße", "Ⅷ", "ﬁre", "fire",
    "Signal", "Signals", "Smith", "Smithers", "a_b", "Mötley", "Crüe", "Sigur", "Rós", "Ægis",
]
_QUERIES = [
    "golden", "goldn", "gold", "river", "rivr", "orsted", "lodz", "beyonce", "ac dc", "acdc!",
    "feat", "ft", "100%", "100", "hey!", "love!", "lov", "remix", "live", "cafe", "naive", "fire",
    "signal", "signl", "smith!", "motley crue", "sigur ros", "aegis", "golden river", "x", "",
    "  ", "12", "7", "straße", "strasse", "fi", "a_b", "golden 3", "artist 5", "ab",
]


def _library(size: int, seed: int) -> list[tuple[int, str | None, str | None]]:
    rng = random.Random(seed)
    songs: list[tuple[int, str | None, str | None]] = []
    for song_id in range(1, size + 1):
        title = " ".join(rng.choice(_WORDS) for _ in range(rng.randint(1, 4)))
        if rng.random() < 0.3:
            title += f" {song_id}"
        artist = " ".join(rng.choice(_WORDS) for _ in range(rng.randint(0, 3)))
        songs.append((song_id, rng.choice([artist, None, f"Artist {song_id % 7}"]), title or None))
    return songs


def test_mi_0162_04_plain_names_normalise_exactly_as_before():
    rng = random.Random(7)
    texts = [" ".join(rng.choice(_WORDS) for _ in range(rng.randint(0, 5))) for _ in range(3000)]
    texts += ["", " ", "a", "A b", "ft", "Left Soft", "feat x", "x  y", " x", "x ", "a_b", "Ab1 2"]
    for text in texts:
        assert normalize_music(text) == _normalize(text), text


def test_mi_0162_04_every_rank_is_the_rank_the_rules_give():
    songs = _library(1500, seed=162)
    for query in _QUERIES:
        expected = {
            song_id: rank
            for song_id, artist, title in songs
            if (rank := _reference(query, song_id, artist, title)) is not None
        }
        assert rank_songs(query, songs) == expected, query
        for song_id, artist, title in songs[:200]:
            assert relevance(query, song_id, artist, title) == _reference(
                query, song_id, artist, title
            )


def _big_library(tmp_path, songs: int = 20000) -> TestClient:
    connection = db.connect(Settings(tmp_path).db_path)
    adjectives = ["Golden", "Quiet", "Electric", "Paper", "Velvet", "Burning", "Silver", "Distant"]
    nouns = ["River", "Summer", "Signal", "Avenue", "Echo", "Horizon", "Garden", "Mirror"]
    connection.executemany(
        "INSERT INTO songs(id,path,folder,size,mtime,duration,artist,title,is_music) "
        "VALUES(?,?,'f',1,1.0,200.0,?,?,1)",
        [
            (
                number + 1,
                f"extra-{number:05d}.flac",
                f"Artist {number % 700}",
                f"{adjectives[number % 8]} {nouns[(number // 8) % 8]} {number}",
            )
            for number in range(songs)
        ],
    )
    connection.commit()
    connection.close()
    return TestClient(create_app(Settings(tmp_path), tmp_path / "no-web"))


def test_mi_0162_04_searching_twenty_thousand_songs_is_quick_and_unchanged(tmp_path):
    client = _big_library(tmp_path)
    client.get("/api/library", params={"state": "all"})  # the Library opens before anyone types

    timings: dict[str, float] = {}
    answers: dict[str, dict] = {}
    for query in ["golden", "golden", "goldn", "silver river", "artist 5", "zzz"]:
        started = time.perf_counter()
        answer = client.get("/api/library", params={"q": query, "state": "all", "limit": 100})
        timings.setdefault(query, time.perf_counter() - started)
        assert answer.status_code == 200
        answers[query] = answer.json()
    print("MI-0162-04 search ms:", {query: round(t * 1000) for query, t in timings.items()})

    # the same matches, in the same order, as the rules give for this library
    connection = db.connect(Settings(tmp_path).db_path)
    rows = [tuple(row) for row in connection.execute("SELECT id,artist,title FROM songs")]
    connection.close()
    for query in ["golden", "goldn", "silver river"]:
        ranked = sorted(
            (rank, song_id)
            for song_id, artist, title in rows
            if (rank := _reference(query, song_id, artist, title)) is not None
        )
        assert answers[query]["total"] == len(ranked)
        assert [song["id"] for song in answers[query]["songs"]] == [i for _, i in ranked[:100]]
    assert answers["golden"]["total"] == 2500
    assert answers["zzz"]["total"] == 0

    # generous: a shared, loaded 4-core laptop answered the first search in about 0.6 s and later
    # ones in about 0.3 s, against 1.5 to 1.7 s before (MI-0162-04 bench, q=golden)
    assert timings["golden"] < 4.0
    assert max(t for query, t in timings.items() if query != "golden") < 3.0
