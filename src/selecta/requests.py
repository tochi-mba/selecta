"""Find future slots for audience requests without forcing an unsuitable handover."""

from __future__ import annotations

import sqlite3
from collections.abc import Callable, Iterable, Sequence
from dataclasses import dataclass


def initialise(conn: sqlite3.Connection) -> None:
    conn.execute('''CREATE TABLE IF NOT EXISTS song_requests (
        id INTEGER PRIMARY KEY,
        song_id INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'waiting',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )''')
    conn.execute('''CREATE UNIQUE INDEX IF NOT EXISTS one_waiting_request_per_song
        ON song_requests(song_id) WHERE status='waiting' ''')


def add_request(conn: sqlite3.Connection, song_id: int) -> int:
    """Persist intent even before analysis is ready; repeated taps return the same request."""
    row = conn.execute(
        'SELECT is_music,duplicate_of FROM songs WHERE id=?', (song_id,)
    ).fetchone()
    if row is None or not row[0] or row[1] is not None:
        raise ValueError('Choose a music track that is still in your library')
    initialise(conn)
    with conn:
        conn.execute(
            "INSERT OR IGNORE INTO song_requests(song_id) VALUES(?)", (song_id,)
        )
        return conn.execute(
            "SELECT id FROM song_requests WHERE song_id=? AND status='waiting'", (song_id,)
        ).fetchone()[0]


def cancel_request(conn: sqlite3.Connection, request_id: int) -> bool:
    """Cancel waiting intent only; this never removes music that is already scheduled."""
    initialise(conn)
    with conn:
        return conn.execute(
            "UPDATE song_requests SET status='cancelled' WHERE id=? AND status='waiting'",
            (request_id,),
        ).rowcount > 0


def read_requests(conn: sqlite3.Connection) -> list[dict]:
    initialise(conn)
    rows = conn.execute('''SELECT r.id,r.song_id,r.status,r.created_at,s.title,s.artist,
        CASE WHEN s.is_music=1 AND s.duplicate_of IS NULL THEN 1 ELSE 0 END available
        FROM song_requests r LEFT JOIN songs s ON s.id=r.song_id
        WHERE r.status='waiting' ORDER BY r.id''')
    names = [column[0] for column in rows.description]
    return [dict(zip(names, row, strict=True)) for row in rows]


@dataclass(frozen=True)
class Slot:
    position: int
    songs: tuple[int, ...]
    bridges: tuple[int, ...] = ()


def find_slot(
    order: Sequence[int],
    requested: int,
    protected_through: int,
    fits: Callable[[int, int], bool],
    *,
    locked: Iterable[int] = (),
    custom_seams: Iterable[int] = (),
    bridge_songs: Iterable[int] = (),
) -> Slot | None:
    """Prefer the earliest direct fit; only then propose one extra bridge song.

    A lock holds its absolute position, so insertion must follow the last locked song.
    A custom incoming seam cannot be replaced by an automatic request. Both new edges must
    fit, including the return to the planned set. A bridge is a proposal, never consent.
    The caller supplies musical feasibility and must revalidate playback before committing.
    """
    if not order or requested in order or protected_through < 0:
        return None
    first = max(protected_through + 1, max(locked, default=-1) + 1, 1)
    preserved = set(custom_seams)
    positions = [position for position in range(first, len(order) + 1) if position not in preserved]

    def works(position: int, songs: tuple[int, ...]) -> bool:
        chain = (order[position - 1], *songs, *order[position:position + 1])
        return all(fits(a, b) for a, b in zip(chain, chain[1:], strict=False))

    for position in positions:
        if works(position, (requested,)):
            return Slot(position, (requested,))
    candidates = sorted(set(bridge_songs) - set(order) - {requested})
    for position in positions:
        for bridge in candidates:
            for songs in ((bridge, requested), (requested, bridge)):
                if works(position, songs):
                    return Slot(position, songs, (bridge,))
    return None


def fit_requests(
    order: Sequence[int],
    requests: Iterable[tuple[int, int]],
    protected_through: int,
    fits: Callable[[int, int], bool],
    **options,
) -> list[tuple[int, Slot | None]]:
    """Evaluate every request independently; a waiting request cannot block later ones.

    These are proposals against one snapshot, not a batch of compatible mutations. Apply at
    most one, then recompute against the resulting order before considering another.
    """
    return [
        (request_id, find_slot(order, song_id, protected_through, fits, **options))
        for request_id, song_id in requests
    ]
