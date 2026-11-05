"""Search lyrics, harmony, melody, DNA-like chroma and rhythmic cousins."""

from __future__ import annotations

import json
import sqlite3

import numpy as np

from selecta.analysis.song import SongInfo
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


def audio_search(conn: sqlite3.Connection, songs: list[SongInfo], limit: int = 1000) -> int:
    found = 0
    for i, a in enumerate(songs):
        if a.chroma_bars is None:
            continue
        pa = a.chroma_bars.mean(axis=0)
        pa /= np.linalg.norm(pa) + 1e-9
        for b in songs[i + 1 :]:
            if b.chroma_bars is None:
                continue
            pb = b.chroma_bars.mean(axis=0)
            pb /= np.linalg.norm(pb) + 1e-9
            rotations = [float(np.dot(pa, np.roll(pb, shift))) for shift in range(12)]
            similarity = max(rotations)
            if similarity > 0.93:
                kind = "same_melody" if rotations.index(similarity) else "harmonic_cousin"
                _save(
                    conn,
                    a.id,
                    b.id,
                    kind,
                    {
                        "transpose": rotations.index(similarity),
                        "reason": "Their bar-level pitch shapes closely match.",
                    },
                    similarity,
                )
                found += 1
                if found >= limit:
                    conn.commit()
                    return found
    conn.commit()
    return found
