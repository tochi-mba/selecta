"""The account's measured songs as the idea cards read them: no stored arrays (T-20261126-6e24).

The Desktop's idea cards (`planner_core.vibes.candidate_vibes` and `describe`) and an idea's
choice of songs (`eligible`, `Vibe.belongs`) read each song's numbers only: tempo, key, energy,
length, title and its timed lyrics. Its per-bar arrays are read only to plan the transitions of a
build. So the cards are made here over every measured song a browser names, from one read of the
store, without opening a single features file; a build then loads the arrays of the songs that
suit the idea best, at most `planning.MAX_ORDER_SONGS`, as the Desktop's beam looks at a bounded
number of songs per step (`planner_core.beam.LOOK_PER_STEP`).
"""

from __future__ import annotations

import dataclasses

import numpy as np
import sqlalchemy as sa

from selecta.analysis.song import RHYTHM_ARRAYS, SONG_ARRAYS, SongInfo, build_song
from selecta.engine_store import EngineStore
from selecta.engine_store.schema import song_overrides

MOST_NAMED = 5_000
"""Song ids a browser may name for the cards or a build: ids only, read in one pass."""
CHUNK = 500  # ids per store query

_EMPTY = {name: np.zeros(0, dtype=np.float32) for name in (*SONG_ARRAYS, *RHYTHM_ARRAYS)}


def summaries(store: EngineStore, song_ids: list[int]) -> list[SongInfo]:
    """Each measured song among these, in the order asked, with its numbers and lyrics and the
    member's tempo and key, and empty arrays: for the idea cards and choosing songs, never for
    planning a transition."""
    from selecta.engine_store import songs as stored

    wanted = list(dict.fromkeys(int(song_id) for song_id in song_ids))
    where = stored._songs(store)
    rows: dict[int, dict] = {}
    lyrics: dict[int, dict] = {}
    corrections: dict[int, dict] = {}
    with store.read() as connection:
        for start in range(0, len(wanted), CHUNK):
            part = wanted[start : start + CHUNK]
            query = stored._facts_query(store).where(where.id.in_(part))
            for row in connection.execute(query).mappings():
                rows[int(row["id"])] = dict(row)
            table = where.lyrics
            for row in connection.execute(
                sa.select(table.c.song_id, table.c.status, table.c.synced).where(
                    store.mine(table), table.c.song_id.in_(part)
                )
            ).mappings():
                lyrics[int(row["song_id"])] = dict(row)
            for row in connection.execute(
                sa.select(song_overrides.c.song_id, song_overrides.c.bpm, song_overrides.c.camelot)
                .where(store.mine(song_overrides), song_overrides.c.song_id.in_(part))
            ).mappings():
                corrections[int(row["song_id"])] = dict(row)
    found = []
    for song_id in wanted:
        row = rows.get(song_id)
        if row is None or row["duration"] is None:
            continue
        features = {**_EMPTY, "bar_starts": np.zeros(0, dtype=np.int64)}
        # sections are placed on the bars, which are not read here; no card reads them
        info = build_song({**row, "sections": "[]"}, features, lyrics.get(song_id), None)
        corrected = corrections.get(song_id)
        if corrected is not None:
            info = dataclasses.replace(
                info,
                bpm=corrected["bpm"] or info.bpm,
                camelot=corrected["camelot"] or info.camelot,
            )
        found.append(info)
    return found


__all__ = ["MOST_NAMED", "summaries"]
