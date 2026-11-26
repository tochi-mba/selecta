"""Search lyrics, harmony, melody, DNA-like chroma and rhythmic cousins."""

from __future__ import annotations

import json
import random
import sqlite3
from collections import Counter
from collections.abc import Callable

import numpy as np

from selecta import flags
from selecta.analysis.song import SongInfo
from selecta.discovery.sequence import harmonic_sequence
from selecta.lyrics.lrclib import clean_artist, parse_lrc
from selecta.lyrics.match import LyricLink, SongFacts, discover

COMPARED_PER_SONG = 80
MOST_PER_SONG = 3
"""A song can match many others, and three of them is plenty to hear."""


def spread_out(rows: list[dict], limit: int) -> list[dict]:
    """Best first, but as varied as it can be: a new song and new artist on every row while there
    are any, then songs that have come up once, then whatever's left."""
    chosen: list[dict] = []
    left = list(rows)

    def names(row: dict) -> tuple[str, str]:
        return clean_artist(row["artist_a"]).casefold(), clean_artist(row["artist_b"]).casefold()

    seen_songs: set[int] = set()
    seen_artists: set[str] = set()
    for strict in (True, False):
        later = []
        for row in left:
            if len(chosen) >= limit:
                break
            songs = {row["song_a"], row["song_b"]}
            repeat = bool(songs & seen_songs) or (
                strict and bool(set(names(row)) & seen_artists)
            )
            if repeat:
                later.append(row)
                continue
            chosen.append(row)
            seen_songs |= songs
            seen_artists |= set(names(row))
        left = later
    return [*chosen, *left][:limit]


def _save(conn: sqlite3.Connection, a: int, b: int, kind: str, payload: dict, score: float) -> None:
    conn.execute(
        "INSERT OR IGNORE INTO seam_book(song_a,song_b,kind,payload,score) VALUES(?,?,?,?,?)",
        (a, b, kind, json.dumps(payload), float(score)),
    )


def store_of(conn):
    """The engine store discovery writes through, or None for the old path on `conn`: with
    `core.engine_store` on, on a file past `lib0009discovery`, and only when `conn` has no writes
    pending (a store write would wait behind them). An `EngineStore` is its own answer."""
    from selecta.engine_store import EngineStore

    if isinstance(conn, EngineStore):
        return conn
    if not flags.on("core.engine_store") or conn.in_transaction:
        return None
    from selecta.engine_store import library

    try:
        stamp = library.stamp_of(conn)
        if stamp is None or not library.includes(stamp, "lib0009discovery"):
            return None
        return library.store_of(conn)
    except (library.LibraryNotReady, sqlite3.Error):
        return None


def lyric_links(conn: sqlite3.Connection, limit: int = 200_000) -> list[LyricLink]:
    """Search every song with timed lyrics. Takes seconds, since only line ends and starts link."""
    from selecta.engine_store import library_rows

    with library_rows.reading(conn) as source:
        rows = source.execute(
            "SELECT s.id,s.artist,s.title,s.duration,l.synced FROM songs s "
            "JOIN lyrics l ON l.song_id=s.id "
            "WHERE l.status='synced' AND l.synced IS NOT NULL "
            "AND s.is_music=1 AND s.duplicate_of IS NULL"
        ).fetchall()
    return discover(
        {r["id"]: parse_lrc(r["synced"], r["duration"]) for r in rows},
        limit,
        {r["id"]: SongFacts(r["artist"] or "", r["title"] or "", r["duration"]) for r in rows},
    )


def lyric_search(conn: sqlite3.Connection) -> int:
    links = lyric_links(conn, limit=5000)
    found = [
        (
            link.song_a,
            link.song_b,
            link.kind,
            {
                "phrase": link.phrase,
                "a_at": link.line_a.start,
                "b_at": link.line_b.start,
                "reason": f"Both songs turn on “{link.phrase}”.",
            },
            link.score,
        )
        for link in links
    ]
    store = store_of(conn)
    if store is not None:
        from selecta.engine_store import discovery as stored

        stored.save_links(store, [stored.link(*row) for row in found])
        return len(links)
    for row in found:
        _save(conn, *row)
    conn.commit()
    return len(links)


Keep = Callable[[int, int, str, dict, float], None]
"""Where `audio_links` hands each link it finds: song A, song B, kind, payload, score."""


def audio_search(
    conn: sqlite3.Connection,
    songs: list[SongInfo],
    limit: int = 1000,
    before_pair: Callable[[], None] | None = None,
    seed: int | None = None,
) -> int:
    """Find ordered harmonic candidates and coarse tonal-profile cousins.

    Averaging chroma across a whole track discards the order of notes. It can support a
    broad tonal resemblance, but cannot establish that two songs share a melody.

    On the old path every link is inserted on `conn` and committed once at the end. Through the
    engine store they are saved `discovery.BATCH` at a time, each batch its own short write.
    """
    if limit <= 0:
        return 0
    store = store_of(conn)
    if store is None:
        found = audio_links(songs, limit, lambda *row: _save(conn, *row), before_pair, seed)
        conn.commit()
        return found
    from selecta.engine_store import discovery as stored

    pending: list = []

    def keep(a: int, b: int, kind: str, payload: dict, score: float) -> None:
        pending.append(stored.link(a, b, kind, payload, score))
        if len(pending) >= stored.BATCH:
            stored.save_links(store, pending)
            pending.clear()

    found = audio_links(songs, limit, keep, before_pair, seed)
    stored.save_links(store, pending)
    return found


def audio_links(
    songs: list[SongInfo],
    limit: int,
    keep: Keep,
    before_pair: Callable[[], None] | None = None,
    seed: int | None = None,
) -> int:
    """The search itself: hands each link found to `keep` and returns how many it found. It
    reads and writes nothing, so the sweep can write a pair's links with its compared mark."""
    if limit <= 0:
        return 0
    found = 0
    # Walking the library in order spent every search on the first few songs, so one song's name
    # filled the whole list. Each song now gets its turn, against a random sample of the others.
    rng = random.Random(seed)
    usable = [index for index, song in enumerate(songs) if song.chroma_bars is not None]
    order = list(usable)
    rng.shuffle(order)
    compared: set[tuple[int, int]] = set()
    matches: Counter[int] = Counter()
    partners = {}
    for i in order:
        others = [j for j in usable if j != i]
        rng.shuffle(others)
        partners[i] = others[:COMPARED_PER_SONG]
    # one comparison per song, round and round, so stopping early still leaves everyone a turn
    pairs = [
        (i, partners[i][turn])
        for turn in range(COMPARED_PER_SONG)
        for i in order
        if turn < len(partners[i])
    ]
    sequences = cousins = 0
    for i, j in pairs:
        pair = (min(i, j), max(i, j))
        if pair in compared:
            continue
        compared.add(pair)
        a, b = songs[pair[0]], songs[pair[1]]
        if clean_artist(a.artist).casefold() == clean_artist(b.artist).casefold():
            continue
        pa = a.chroma_bars.mean(axis=0)
        pa /= np.linalg.norm(pa) + 1e-9
        if before_pair is not None:
            before_pair()
        full = max(matches[pair[0]], matches[pair[1]]) >= MOST_PER_SONG
        sequence = None if full else harmonic_sequence(a.chroma_bars, b.chroma_bars)
        if sequence is not None:
            a_bar, b_bar = sequence["a_bar"], sequence["b_bar"]
            if a_bar >= len(a.bar_times) or b_bar >= len(b.bar_times):
                sequence = None
        if sequence is not None:
            sequence["a_at"] = float(a.bar_times[sequence["a_bar"]])
            sequence["b_at"] = float(b.bar_times[sequence["b_bar"]])
            for prefix, song in (("a", a), ("b", b)):
                end_bar = sequence[f"{prefix}_bar"] + sequence["bars"]
                sequence[f"{prefix}_end"] = float(
                    song.bar_times[end_bar] if end_bar < len(song.bar_times) else song.duration
                )
            keep(
                a.id,
                b.id,
                "harmonic_sequence_candidate",
                sequence,
                sequence["similarity"],
            )
            matches.update(pair)
            found += 1
            sequences += 1
            if sequences >= limit:
                return found
        pb = b.chroma_bars.mean(axis=0)
        pb /= np.linalg.norm(pb) + 1e-9
        rotations = [float(np.dot(pa, np.roll(pb, shift))) for shift in range(12)]
        similarity = max(rotations)
        if similarity > 0.93 and cousins < limit:
            transpose = rotations.index(similarity)
            keep(
                a.id,
                b.id,
                "tonal_profile_cousin",
                {
                    "transpose": transpose,
                    "method": "whole_track_mean_chroma",
                    "reason": (
                        "Their average pitch-class profiles are similar; note order is "
                        "not compared, so this is not a same-melody claim."
                    ),
                },
                similarity,
            )
            cousins += 1
            found += 1
            if found >= limit and not sequences:
                break
    return found
