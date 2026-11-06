"""Resumable exhaustive harmonic discovery, including remembered non-matches."""

from __future__ import annotations

import hashlib
import json
import sqlite3
from collections.abc import Callable
from itertools import combinations

import numpy as np

from selecta.analysis.song import SongInfo
from selecta.discovery.search import audio_search

VERSION = 1


def fingerprint(song: SongInfo) -> str:
    digest = hashlib.sha256()
    digest.update(json.dumps([VERSION, song.artist, song.duration]).encode())
    for source in (song.chroma_bars, song.bar_times):
        values = np.asarray(source, dtype='<f8')
        digest.update(str(values.shape).encode())
        digest.update(values.tobytes())
    return digest.hexdigest()


def sweep(
    conn: sqlite3.Connection,
    songs: list[SongInfo],
    pair_limit: int = 1000,
    before_pair: Callable[[], None] | None = None,
) -> dict[str, int]:
    """Check up to pair_limit previously unchecked pairs; rerun to continue.

    Each result commits separately. An interruption before recording a pair may repeat that pair,
    but never marks unfinished work complete. Feature or matcher-version changes invalidate it.
    The ordinary audition list still selects diverse candidates from all stored matches.
    """
    if pair_limit < 1:
        raise ValueError('pair_limit must be positive')
    conn.execute('''CREATE TABLE IF NOT EXISTS discovery_comparisons (
        song_a INTEGER NOT NULL, song_b INTEGER NOT NULL,
        fingerprint_a TEXT NOT NULL, fingerprint_b TEXT NOT NULL,
        PRIMARY KEY(song_a, song_b)
    )''')
    usable = sorted((s for s in songs if s.chroma_bars is not None), key=lambda s: s.id)
    signatures = {s.id: fingerprint(s) for s in usable}
    known = {
        (row[0], row[1]): (row[2], row[3])
        for row in conn.execute('SELECT * FROM discovery_comparisons')
    }
    checked = cached = remaining = added = 0
    for a, b in combinations(usable, 2):
        signature = (signatures[a.id], signatures[b.id])
        if known.get((a.id, b.id)) == signature:
            cached += 1
            continue
        if checked >= pair_limit:
            remaining += 1
            continue
        if before_pair is not None:
            before_pair()
        initial = conn.execute('SELECT COUNT(*) FROM seam_book').fetchone()[0]
        audio_search(conn, [a, b], limit=2, seed=0)
        added += conn.execute('SELECT COUNT(*) FROM seam_book').fetchone()[0] - initial
        conn.execute(
            'INSERT OR REPLACE INTO discovery_comparisons VALUES(?,?,?,?)',
            (a.id, b.id, *signature),
        )
        conn.commit()
        checked += 1
    return dict(checked=checked, cached=cached, remaining=remaining, added=added)
