"""Search lyrics, harmony, melody, DNA-like chroma and rhythmic cousins."""

from __future__ import annotations

import json
import sqlite3
from collections.abc import Callable

import numpy as np

from selecta.analysis.song import SongInfo
from selecta.discovery.sequence import harmonic_sequence
from selecta.lyrics.lrclib import parse_lrc
from selecta.lyrics.match import LyricLink, SongFacts, discover


def _save(conn: sqlite3.Connection, a: int, b: int, kind: str, payload: dict, score: float) -> None:
    conn.execute(
        "INSERT OR IGNORE INTO seam_book(song_a,song_b,kind,payload,score) VALUES(?,?,?,?,?)",
        (a, b, kind, json.dumps(payload), float(score)),
    )


def lyric_links(conn: sqlite3.Connection, limit: int = 200_000) -> list[LyricLink]:
    """Search every song with timed lyrics. Takes seconds, since only line ends and starts link."""
    rows = conn.execute(
        "SELECT s.id,s.artist,s.title,s.duration,l.synced FROM songs s "
        "JOIN lyrics l ON l.song_id=s.id "
        "WHERE l.status='synced' AND s.is_music=1 AND s.duplicate_of IS NULL"
    ).fetchall()
    return discover(
        {r["id"]: parse_lrc(r["synced"], r["duration"]) for r in rows},
        limit,
        {r["id"]: SongFacts(r["artist"] or "", r["title"] or "", r["duration"]) for r in rows},
    )


def lyric_search(conn: sqlite3.Connection) -> int:
    links = lyric_links(conn, limit=5000)
    for link in links:
        _save(
            conn,
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
    conn.commit()
    return len(links)


def audio_search(
    conn: sqlite3.Connection,
    songs: list[SongInfo],
    limit: int = 1000,
    before_pair: Callable[[], None] | None = None,
) -> int:
    """Find ordered harmonic candidates and coarse tonal-profile cousins.

    Averaging chroma across a whole track discards the order of notes. It can support a
    broad tonal resemblance, but cannot establish that two songs share a melody.
    """
    if limit <= 0:
        return 0
    found = 0
    for i, a in enumerate(songs):
        if a.chroma_bars is None:
            continue
        pa = a.chroma_bars.mean(axis=0)
        pa /= np.linalg.norm(pa) + 1e-9
        for b in songs[i + 1 :]:
            if b.chroma_bars is None:
                continue
            if before_pair is not None:
                before_pair()
            sequence = harmonic_sequence(a.chroma_bars, b.chroma_bars)
            if sequence is not None:
                a_bar, b_bar = sequence["a_bar"], sequence["b_bar"]
                if a_bar >= len(a.bar_times) or b_bar >= len(b.bar_times):
                    sequence = None
            if sequence is not None:
                sequence["a_at"] = float(a.bar_times[sequence["a_bar"]])
                sequence["b_at"] = float(b.bar_times[sequence["b_bar"]])
                _save(
                    conn,
                    a.id,
                    b.id,
                    "harmonic_sequence_candidate",
                    sequence,
                    sequence["similarity"],
                )
                found += 1
                if found >= limit:
                    conn.commit()
                    return found
            pb = b.chroma_bars.mean(axis=0)
            pb /= np.linalg.norm(pb) + 1e-9
            rotations = [float(np.dot(pa, np.roll(pb, shift))) for shift in range(12)]
            similarity = max(rotations)
            if similarity > 0.93:
                transpose = rotations.index(similarity)
                _save(
                    conn,
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
                found += 1
                if found >= limit:
                    conn.commit()
                    return found
    conn.commit()
    return found
