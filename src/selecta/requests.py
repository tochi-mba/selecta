"""Find future slots for audience requests without forcing an unsuitable handover."""

from __future__ import annotations

import json
import sqlite3
from collections.abc import Callable, Iterable, Sequence
from dataclasses import dataclass

from selecta import db


class PlacementChanged(ValueError):
    """A prepared request no longer matches the live mix; leave it waiting."""


def custom_seam(raw: str | None) -> bool:
    """Did a person choose this transition, so a request shouldn't replace it? Leaving it on Auto
    isn't choosing, whatever else is saved with it, and neither is a seam a request added."""
    if not raw:
        return False
    try:
        settings = json.loads(raw)
    except ValueError:
        return False
    if not settings or settings.get("soft") or settings.get("from_request"):
        return False
    return settings.get("move", "auto") != "auto"


def initialise(conn: sqlite3.Connection) -> None:
    conn.execute("""CREATE TABLE IF NOT EXISTS song_requests (
        id INTEGER PRIMARY KEY,
        song_id INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'waiting',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )""")
    conn.execute("""CREATE UNIQUE INDEX IF NOT EXISTS one_waiting_request_per_song
        ON song_requests(song_id) WHERE status='waiting' """)
    conn.execute("""CREATE TABLE IF NOT EXISTS request_bridge_approvals (
        request_id INTEGER PRIMARY KEY, signature TEXT NOT NULL
    )""")
    conn.execute("""CREATE TABLE IF NOT EXISTS request_marks (
        song_id INTEGER PRIMARY KEY, kind TEXT NOT NULL, for_song INTEGER
    )""")
    conn.execute("""CREATE TABLE IF NOT EXISTS request_routes (
        request_id INTEGER PRIMARY KEY, songs TEXT NOT NULL
    )""")


def choose_bridge(
    conn: sqlite3.Connection, request_id: int, allow: bool, songs: Sequence[int] | None = None
) -> bool:
    """Say whether this request may use an extra song to get into the mix. It's a yes or no for the
    request, because the spot can change as the mix moves on, and being asked again each time isn't
    what anyone who answered wants. Naming the songs holds it to those: nobody who agreed to one
    bridge should hear a different one join without being asked."""
    initialise(conn)
    with conn:
        waiting = conn.execute(
            "SELECT 1 FROM song_requests WHERE id=? AND status='waiting'", (request_id,)
        ).fetchone()
        if waiting is None:
            return False
        conn.execute(
            "INSERT OR REPLACE INTO request_bridge_approvals VALUES(?,?)",
            (request_id, "yes" if allow else "no"),
        )
        conn.execute("DELETE FROM request_routes WHERE request_id=?", (request_id,))
        if allow and songs:
            conn.execute(
                "INSERT INTO request_routes VALUES(?,?)", (request_id, json.dumps(list(songs)))
            )
    return True


def chosen_route(conn: sqlite3.Connection, request_id: int) -> list[int] | None:
    """The exact songs someone agreed to for this request, in playing order, if they did."""
    initialise(conn)
    row = conn.execute(
        "SELECT songs FROM request_routes WHERE request_id=?", (request_id,)
    ).fetchone()
    return json.loads(row[0]) if row else None


def songs_in_chosen_routes(conn: sqlite3.Connection, leaving_out: int | None = None) -> set[int]:
    """Every song someone has agreed to use, for any request still waiting."""
    initialise(conn)
    rows = conn.execute(
        "SELECT r.request_id,r.songs FROM request_routes r JOIN song_requests q "
        "ON q.id=r.request_id WHERE q.status='waiting'"
    ).fetchall()
    return {
        song for row in rows if row[0] != leaving_out for song in json.loads(row[1])
    }


def bridge_choice(conn: sqlite3.Connection, request_id: int) -> bool | None:
    """Yes, no, or not asked yet. Anything but a no from before counts as a yes."""
    initialise(conn)
    row = conn.execute(
        "SELECT a.signature FROM request_bridge_approvals a JOIN song_requests r "
        "ON r.id=a.request_id WHERE a.request_id=? AND r.status='waiting'",
        (request_id,),
    ).fetchone()
    return None if row is None else row[0] != "no"


def mark_added(conn: sqlite3.Connection, request_id: int, song_id: int) -> None:
    """A person put a requested song in the mix themselves, so it's no longer waiting."""
    initialise(conn)
    with conn:
        conn.execute("UPDATE song_requests SET status='scheduled' WHERE id=?", (request_id,))
        conn.execute(
            "INSERT OR REPLACE INTO request_marks(song_id,kind,for_song) VALUES(?,?,NULL)",
            (song_id, "requested"),
        )


def add_request(conn: sqlite3.Connection, song_id: int) -> int:
    """Persist intent even before analysis is ready; repeated taps return the same request."""
    row = conn.execute("SELECT is_music,duplicate_of FROM songs WHERE id=?", (song_id,)).fetchone()
    if row is None or not row[0] or row[1] is not None:
        raise ValueError("Choose a music track that is still in your library")
    initialise(conn)
    waiting_itself = conn.execute(
        "SELECT 1 FROM song_requests WHERE song_id=? AND status='waiting'", (song_id,)
    ).fetchone()
    if not waiting_itself and song_id in songs_in_chosen_routes(conn):
        raise ValueError("That song is already on its way as a bridge, so it’s coming anyway.")
    with conn:
        conn.execute("INSERT OR IGNORE INTO song_requests(song_id) VALUES(?)", (song_id,))
        return conn.execute(
            "SELECT id FROM song_requests WHERE song_id=? AND status='waiting'", (song_id,)
        ).fetchone()[0]


def cancel_request(conn: sqlite3.Connection, request_id: int) -> bool:
    """Cancel waiting intent only; this never removes music that is already scheduled."""
    initialise(conn)
    with conn:
        return (
            conn.execute(
                "UPDATE song_requests SET status='cancelled' WHERE id=? AND status='waiting'",
                (request_id,),
            ).rowcount
            > 0
        )


def read_requests(conn: sqlite3.Connection) -> list[dict]:
    initialise(conn)
    rows = conn.execute("""SELECT r.id,r.song_id,r.status,r.created_at,s.title,s.artist,
        CASE WHEN s.is_music=1 AND s.duplicate_of IS NULL THEN 1 ELSE 0 END available
        FROM song_requests r LEFT JOIN songs s ON s.id=r.song_id
        WHERE r.status='waiting' ORDER BY r.id""")
    names = [column[0] for column in rows.description]
    return [dict(zip(names, row, strict=True)) for row in rows]


def marks_for(conn: sqlite3.Connection, song_ids: Sequence[int]) -> dict[int, dict]:
    """Which songs in the current mix a request put there. A mark belongs to that song being in the
    mix, so it goes when the song leaves, and the same song in a later mix isn't called a request.
    It's kept by song, so it survives the song being moved or its seam being changed."""
    initialise(conn)
    rows = conn.execute(
        "SELECT m.song_id,m.kind,m.for_song,s.title FROM request_marks m "
        "LEFT JOIN songs s ON s.id=m.for_song"
    ).fetchall()
    present = set(song_ids)
    gone = [row[0] for row in rows if row[0] not in present]
    if gone:
        with conn:
            conn.executemany("DELETE FROM request_marks WHERE song_id=?", [(s,) for s in gone])
    return {
        row[0]: {"kind": row[1], "for": row[3]} if row[1] == "bridge" else {"kind": row[1]}
        for row in rows
        if row[0] in present
    }


@dataclass(frozen=True)
class Slot:
    position: int
    songs: tuple[int, ...]
    bridges: tuple[int, ...] = ()


def insert_ready(
    conn: sqlite3.Connection,
    request_id: int,
    slot: Slot,
    expected: Sequence[tuple[int, str | None, int]],
    protected_through: int,
    seams: Sequence[dict],
    *,
    approved_bridges: tuple[int, ...] = (),
) -> None:
    """Atomically insert a pre-rendered placement against an exact mix snapshot.

    The caller owns playback freshness and verifies every supplied seam's readiness and audit.
    This guard preserves queue/history/request consistency, including concurrent cancellation.
    """
    initialise(conn)
    if conn.in_transaction:
        raise ValueError("Request insertion needs its own transaction")
    conn.execute("BEGIN IMMEDIATE")
    try:
        current = [
            tuple(row)
            for row in conn.execute("SELECT song_id,seam,locked FROM queue ORDER BY position")
        ]
        request = conn.execute(
            "SELECT song_id FROM song_requests WHERE id=? AND status='waiting'", (request_id,)
        ).fetchone()
        if current != list(expected) or request is None:
            raise PlacementChanged("The mix or request changed. Finding another place.")
        position = slot.position
        if not current or not 0 <= protected_through < position <= len(current):
            raise PlacementChanged("That place is already protected for playback.")
        if any(item[2] for item in current[position:]):
            raise PlacementChanged("That would move a locked song.")
        if slot.bridges != approved_bridges:
            raise PlacementChanged("Approve these bridge songs before adding them.")
        if (
            slot.songs.count(request[0]) != 1
            or len(set(slot.songs)) != len(slot.songs)
            or set(slot.songs) != {request[0], *slot.bridges}
            or set(slot.songs) & {item[0] for item in current}
        ):
            raise PlacementChanged("The proposed songs no longer match this request.")
        for song_id in slot.songs:
            row = conn.execute(
                "SELECT is_music,duplicate_of FROM songs WHERE id=?", (song_id,)
            ).fetchone()
            if row is None or not row[0] or row[1] is not None:
                raise PlacementChanged("A requested song is no longer available.")
        if len(seams) != len(slot.songs) + int(position < len(current)):
            raise ValueError("Every changed handover needs a prepared seam")
        if position < len(current) and custom_seam(current[position][1]):
            raise PlacementChanged("That would replace a chosen transition.")
        history = db.preference(conn, "mix_undo", [])
        history.append(
            dict(
                label="adding a request",
                name=db.preference(conn, "mix_name", "Your mix"),
                items=[list(item) for item in current],
            )
        )
        conn.execute(
            "INSERT INTO preferences(key,value) VALUES(?,?) "
            "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            ("mix_undo", json.dumps(history[-20:])),
        )
        incoming = [(song, json.dumps(seams[i]), 0) for i, song in enumerate(slot.songs)]
        tail = current[position:]
        if tail:
            tail[0] = (tail[0][0], json.dumps(seams[-1]), tail[0][2])
        conn.execute("DELETE FROM queue")
        conn.executemany(
            "INSERT INTO queue(position,song_id,seam,locked) VALUES(?,?,?,?)",
            [(i, *item) for i, item in enumerate(current[:position] + incoming + tail)],
        )
        conn.execute("UPDATE song_requests SET status='scheduled' WHERE id=?", (request_id,))
        conn.execute(
            "INSERT OR REPLACE INTO request_marks(song_id,kind,for_song) VALUES(?,?,NULL)",
            (request[0], "requested"),
        )
        conn.executemany(
            "INSERT OR REPLACE INTO request_marks(song_id,kind,for_song) VALUES(?,?,?)",
            [(bridge, "bridge", request[0]) for bridge in slot.bridges],
        )
        conn.commit()
    except BaseException:
        conn.rollback()
        raise


def open_spots(
    order: Sequence[int],
    protected_through: int,
    *,
    locked: Iterable[int] = (),
    custom_seams: Iterable[int] = (),
    taken: Iterable[int] = (),
) -> list[int]:
    """Where a song could still go, earliest first. A lock holds its absolute position, so a song
    has to go after the last locked one. A chosen transition can't be replaced by an automatic one,
    and a spot another request is on its way into belongs to that request."""
    first = max(protected_through + 1, max(locked, default=-1) + 1, 1)
    closed = {*custom_seams, *taken}
    return [position for position in range(first, len(order) + 1) if position not in closed]


def find_slot(
    order: Sequence[int],
    requested: int,
    protected_through: int,
    fits: Callable[[int, int], bool],
    *,
    locked: Iterable[int] = (),
    custom_seams: Iterable[int] = (),
    bridge_songs: Iterable[int] = (),
    taken: Iterable[int] = (),
    route: Sequence[int] | None = None,
) -> Slot | None:
    """Prefer the earliest direct fit; only then propose one extra bridge song.

    Both new edges must fit, including the return to the planned set. A bridge is a proposal,
    never consent. With `route`, it's those exact songs in that order or nothing. The caller
    supplies musical feasibility and must revalidate playback before committing.
    """
    if not order or requested in order or protected_through < 0:
        return None
    positions = open_spots(
        order, protected_through, locked=locked, custom_seams=custom_seams, taken=taken
    )

    def works(position: int, songs: tuple[int, ...]) -> bool:
        chain = (order[position - 1], *songs, *order[position : position + 1])
        return all(fits(a, b) for a, b in zip(chain, chain[1:], strict=False))

    if route is not None:
        songs = tuple(route)
        extra = tuple(song for song in songs if song != requested)
        for position in positions:
            if works(position, songs):
                return Slot(position, songs, extra)
        return None
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
