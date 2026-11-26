"""Find future slots for audience requests without forcing an unsuitable handover.

Every function that reads or writes takes the library connection, a `Mixes`
(`engine_store.mixes`) when it is part of a larger mix edit, or, in Cloud, an `EngineStore`.
With `core.engine_store` on (and the file past `lib0008requests`), or in Cloud, it is one
transaction through `engine_store.requests.StoreRequests`; a `StoreMixes` passed in shares its
transaction, so a request and the mix edit it makes land together. Off, the `_sqlite_` functions
run the very statements they always ran. A connection with uncommitted writes stays on them.
"""

from __future__ import annotations

import contextlib
import json
import sqlite3
from collections.abc import Callable, Iterable, Iterator, Sequence
from dataclasses import dataclass
from typing import Any

from selecta import db, flags
from selecta.engine_store.requests import StoreRequests

UNDO_KEPT = 20  # what the request insertion has always kept of the mix's Undo


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


DDL = (
    """CREATE TABLE IF NOT EXISTS song_requests (
        id INTEGER PRIMARY KEY,
        song_id INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'waiting',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )""",
    """CREATE UNIQUE INDEX IF NOT EXISTS one_waiting_request_per_song
        ON song_requests(song_id) WHERE status='waiting' """,
    """CREATE TABLE IF NOT EXISTS request_bridge_approvals (
        request_id INTEGER PRIMARY KEY, signature TEXT NOT NULL
    )""",
    """CREATE TABLE IF NOT EXISTS request_marks (
        song_id INTEGER PRIMARY KEY, kind TEXT NOT NULL, for_song INTEGER
    )""",
    """CREATE TABLE IF NOT EXISTS request_routes (
        request_id INTEGER PRIMARY KEY, songs TEXT NOT NULL
    )""",
)


def initialise(conn: sqlite3.Connection) -> None:
    """Make the request tables if they aren't there. With `core.engine_store` on, the library
    migration `lib0008requests` has made them, so nothing is created at run time."""
    if flags.on("core.engine_store") and _made_by_the_migration(conn):
        return
    for statement in DDL:
        conn.execute(statement)


def _made_by_the_migration(conn: sqlite3.Connection) -> bool:
    from selecta.engine_store import library

    stamp = library.stamp_of(conn)
    return stamp is not None and library.includes(stamp, "lib0008requests")


def _raw(conn: Any) -> sqlite3.Connection:
    """The library connection under a `SqliteMixes`, or the connection itself."""
    return getattr(conn, "conn", conn)


def _store_of(conn: sqlite3.Connection):
    if not flags.on("core.engine_store") or conn.in_transaction:
        return None
    from selecta.engine_store import library

    try:
        if not _made_by_the_migration(conn):
            return None
        return library.store_of(conn)
    except (library.LibraryNotReady, sqlite3.Error):
        return None


@contextlib.contextmanager
def _opened(conn: Any, *, write: bool) -> Iterator[StoreRequests | None]:
    """The request tables for one whole operation: a `StoreRequests`, or None for the old path
    on `_raw(conn)`. A `StoreMixes` or `StoreRequests` passes its own transaction through."""
    from selecta.engine_store import EngineStore
    from selecta.engine_store.mixes import Mixes, StoreMixes

    if isinstance(conn, StoreRequests):
        yield conn
        return
    if isinstance(conn, StoreMixes):
        yield StoreRequests(conn.connection, conn.store)
        return
    if isinstance(conn, EngineStore):
        store = conn
    elif isinstance(conn, Mixes):
        store = None  # the old path's `SqliteMixes`: its connection, statement for statement
    else:
        store = _store_of(conn)
    if store is None:
        yield None
        return
    with store.write() if write else store.read() as connection:
        yield StoreRequests(connection, store)


def _chosen(rows: Iterable[tuple[int, str]], leaving_out: int | None) -> set[int]:
    return {song for row in rows if row[0] != leaving_out for song in json.loads(row[1])}


def choose_bridge(
    conn: Any, request_id: int, allow: bool, songs: Sequence[int] | None = None
) -> bool:
    """Say whether this request may use an extra song to get into the mix. It's a yes or no for the
    request, because the spot can change as the mix moves on, and being asked again each time isn't
    what anyone who answered wants. Naming the songs holds it to those: nobody who agreed to one
    bridge should hear a different one join without being asked."""
    with _opened(conn, write=True) as found:
        if found is not None:
            if found.waiting_song(request_id) is None:
                return False
            found.set_choice(request_id, allow, songs)
            return True
    return _sqlite_choose_bridge(_raw(conn), request_id, allow, songs)


def _sqlite_choose_bridge(
    conn: sqlite3.Connection, request_id: int, allow: bool, songs: Sequence[int] | None
) -> bool:
    initialise(conn)
    with conn:
        waiting = conn.execute(
            "SELECT 1 FROM song_requests WHERE id=? AND status='waiting'", (request_id,)
        ).fetchone()
        if waiting is None:
            return False
        # columns named: an adopted table has `workspace_id` too (`lib0008requests`)
        conn.execute(
            "INSERT OR REPLACE INTO request_bridge_approvals(request_id,signature) VALUES(?,?)",
            (request_id, "yes" if allow else "no"),
        )
        conn.execute("DELETE FROM request_routes WHERE request_id=?", (request_id,))
        if allow and songs:
            conn.execute(
                "INSERT INTO request_routes(request_id,songs) VALUES(?,?)",
                (request_id, json.dumps(list(songs))),
            )
    return True


def chosen_route(conn: Any, request_id: int) -> list[int] | None:
    """The exact songs someone agreed to for this request, in playing order, if they did."""
    with _opened(conn, write=False) as found:
        if found is not None:
            return found.route(request_id)
    conn = _raw(conn)
    initialise(conn)
    row = conn.execute(
        "SELECT songs FROM request_routes WHERE request_id=?", (request_id,)
    ).fetchone()
    return json.loads(row[0]) if row else None


def songs_in_chosen_routes(conn: Any, leaving_out: int | None = None) -> set[int]:
    """Every song someone has agreed to use, for any request still waiting."""
    with _opened(conn, write=False) as found:
        if found is not None:
            return _chosen(found.waiting_routes(), leaving_out)
    return _sqlite_chosen_songs(_raw(conn), leaving_out)


def _sqlite_chosen_songs(conn: sqlite3.Connection, leaving_out: int | None) -> set[int]:
    initialise(conn)
    rows = conn.execute(
        "SELECT r.request_id,r.songs FROM request_routes r JOIN song_requests q "
        "ON q.id=r.request_id WHERE q.status='waiting'"
    ).fetchall()
    return _chosen(rows, leaving_out)


def bridge_choice(conn: Any, request_id: int) -> bool | None:
    """Yes, no, or not asked yet. Anything but a no from before counts as a yes."""
    with _opened(conn, write=False) as found:
        if found is not None:
            signature = found.choice(request_id)
            return None if signature is None else signature != "no"
    conn = _raw(conn)
    initialise(conn)
    row = conn.execute(
        "SELECT a.signature FROM request_bridge_approvals a JOIN song_requests r "
        "ON r.id=a.request_id WHERE a.request_id=? AND r.status='waiting'",
        (request_id,),
    ).fetchone()
    return None if row is None else row[0] != "no"


def mark_added(conn: Any, request_id: int, song_id: int) -> None:
    """A person put a requested song in the mix themselves, so it's no longer waiting. Given the
    `Mixes` that added it, it is part of that edit's one transaction."""
    with _opened(conn, write=True) as found:
        if found is not None:
            found.schedule(request_id)
            found.mark(song_id, "requested")
            return
    conn = _raw(conn)
    initialise(conn)
    with conn:
        conn.execute("UPDATE song_requests SET status='scheduled' WHERE id=?", (request_id,))
        conn.execute(
            "INSERT OR REPLACE INTO request_marks(song_id,kind,for_song) VALUES(?,?,NULL)",
            (song_id, "requested"),
        )


NOT_IN_LIBRARY = "Choose a music track that is still in your library"
ALREADY_A_BRIDGE = "That song is already on its way as a bridge, so it’s coming anyway."


def add_request(conn: Any, song_id: int) -> int:
    """Persist intent even before analysis is ready; repeated taps return the same request."""
    with _opened(conn, write=True) as found:
        if found is not None:
            if song_id not in found.usable([song_id]):
                raise ValueError(NOT_IN_LIBRARY)
            waiting = found.waiting_for(song_id)
            if waiting is None and song_id in _chosen(found.waiting_routes(), None):
                raise ValueError(ALREADY_A_BRIDGE)
            return found.add(song_id)
    conn = _raw(conn)
    row = conn.execute("SELECT is_music,duplicate_of FROM songs WHERE id=?", (song_id,)).fetchone()
    if row is None or not row[0] or row[1] is not None:
        raise ValueError(NOT_IN_LIBRARY)
    initialise(conn)
    waiting_itself = conn.execute(
        "SELECT 1 FROM song_requests WHERE song_id=? AND status='waiting'", (song_id,)
    ).fetchone()
    if not waiting_itself and song_id in _sqlite_chosen_songs(conn, None):
        raise ValueError(ALREADY_A_BRIDGE)
    with conn:
        conn.execute("INSERT OR IGNORE INTO song_requests(song_id) VALUES(?)", (song_id,))
        return conn.execute(
            "SELECT id FROM song_requests WHERE song_id=? AND status='waiting'", (song_id,)
        ).fetchone()[0]


def cancel_request(conn: Any, request_id: int) -> bool:
    """Cancel waiting intent only; this never removes music that is already scheduled."""
    with _opened(conn, write=True) as found:
        if found is not None:
            return found.cancel(request_id)
    conn = _raw(conn)
    initialise(conn)
    with conn:
        return (
            conn.execute(
                "UPDATE song_requests SET status='cancelled' WHERE id=? AND status='waiting'",
                (request_id,),
            ).rowcount
            > 0
        )


def read_requests(conn: Any) -> list[dict]:
    with _opened(conn, write=False) as found:
        if found is not None:
            return found.waiting_rows()
    conn = _raw(conn)
    initialise(conn)
    rows = conn.execute("""SELECT r.id,r.song_id,r.status,r.created_at,s.title,s.artist,
        CASE WHEN s.is_music=1 AND s.duplicate_of IS NULL THEN 1 ELSE 0 END available
        FROM song_requests r LEFT JOIN songs s ON s.id=r.song_id
        WHERE r.status='waiting' ORDER BY r.id""")
    names = [column[0] for column in rows.description]
    return [dict(zip(names, row, strict=True)) for row in rows]


def marks_for(conn: Any, song_ids: Sequence[int]) -> dict[int, dict]:
    """Which songs in the current mix a request put there. A mark belongs to that song being in the
    mix, so it goes when the song leaves, and the same song in a later mix isn't called a request.
    It's kept by song, so it survives the song being moved or its seam being changed."""
    rows = None
    with _opened(conn, write=False) as found:
        if found is not None:
            rows = found.marks()
    present = set(song_ids)
    if rows is not None:
        gone = [row[0] for row in rows if row[0] not in present]
        if gone:
            # a look, and a write only when a mark must go
            with _opened(conn, write=True) as found:
                if found is not None:
                    found.drop_marks(gone)
    else:
        raw = _raw(conn)
        initialise(raw)
        rows = raw.execute(
            "SELECT m.song_id,m.kind,m.for_song,s.title FROM request_marks m "
            "LEFT JOIN songs s ON s.id=m.for_song"
        ).fetchall()
        gone = [row[0] for row in rows if row[0] not in present]
        if gone:
            with raw:
                raw.executemany("DELETE FROM request_marks WHERE song_id=?", [(s,) for s in gone])
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


def placed(
    current: list[tuple],
    requested: int | None,
    slot: Slot,
    expected: Sequence[tuple[int, str | None, int]],
    protected_through: int,
    seams: Sequence[dict],
    approved_bridges: tuple[int, ...],
    usable: Callable[[Sequence[int]], bool],
) -> list[tuple]:
    """The mix with this request's songs in it, or why it can't be: every check `insert_ready`
    makes, in its order, on either path. `usable` says whether all these songs may play."""
    if current != list(expected) or requested is None:
        raise PlacementChanged("The mix or request changed. Finding another place.")
    position = slot.position
    if not current or not 0 <= protected_through < position <= len(current):
        raise PlacementChanged("That place is already protected for playback.")
    if any(item[2] for item in current[position:]):
        raise PlacementChanged("That would move a locked song.")
    if slot.bridges != approved_bridges:
        raise PlacementChanged("Approve these bridge songs before adding them.")
    if (
        slot.songs.count(requested) != 1
        or len(set(slot.songs)) != len(slot.songs)
        or set(slot.songs) != {requested, *slot.bridges}
        or set(slot.songs) & {item[0] for item in current}
    ):
        raise PlacementChanged("The proposed songs no longer match this request.")
    if not usable(slot.songs):
        raise PlacementChanged("A requested song is no longer available.")
    if len(seams) != len(slot.songs) + int(position < len(current)):
        raise ValueError("Every changed handover needs a prepared seam")
    if position < len(current) and custom_seam(current[position][1]):
        raise PlacementChanged("That would replace a chosen transition.")
    incoming = [(song, json.dumps(seams[i]), 0) for i, song in enumerate(slot.songs)]
    tail = current[position:]
    if tail:
        tail[0] = (tail[0][0], json.dumps(seams[-1]), tail[0][2])
    return current[:position] + incoming + tail


def _undo_entry(current: list[tuple], name: str) -> dict:
    return dict(label="adding a request", name=name, items=[list(item) for item in current])


def insert_ready(
    conn: Any,
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
    On the store, the queue, its Undo, the request and its marks are one write transaction.
    """
    if isinstance(conn, sqlite3.Connection) and conn.in_transaction:
        raise ValueError("Request insertion needs its own transaction")
    with _opened(conn, write=True) as found:
        if found is not None:
            from selecta.engine_store.mixes import StoreMixes

            mixes = StoreMixes(found.connection, found.store)
            current = found.queue_items()
            requested = found.waiting_song(request_id)
            items = placed(
                current, requested, slot, expected, protected_through, seams,
                approved_bridges, lambda songs: set(songs) <= found.usable(songs),
            )  # fmt: skip
            history = mixes.preference("mix_undo", [])
            history.append(_undo_entry(current, mixes.preference("mix_name", "Your mix")))
            mixes.set_preference("mix_undo", history[-UNDO_KEPT:])
            mixes.write_queue(items)
            found.schedule(request_id)
            found.mark(requested, "requested")
            for bridge in slot.bridges:
                found.mark(bridge, "bridge", requested)
            return
    _sqlite_insert_ready(
        _raw(conn), request_id, slot, expected, protected_through, seams, approved_bridges
    )


def _sqlite_insert_ready(
    conn: sqlite3.Connection,
    request_id: int,
    slot: Slot,
    expected: Sequence[tuple[int, str | None, int]],
    protected_through: int,
    seams: Sequence[dict],
    approved_bridges: tuple[int, ...],
) -> None:
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

        def usable(songs: Sequence[int]) -> bool:
            for song_id in songs:
                row = conn.execute(
                    "SELECT is_music,duplicate_of FROM songs WHERE id=?", (song_id,)
                ).fetchone()
                if row is None or not row[0] or row[1] is not None:
                    return False
            return True

        requested = None if request is None else request[0]
        items = placed(
            current, requested, slot, expected, protected_through, seams, approved_bridges, usable
        )
        history = db.preference(conn, "mix_undo", [])
        history.append(_undo_entry(current, db.preference(conn, "mix_name", "Your mix")))
        conn.execute(
            "INSERT INTO preferences(key,value) VALUES(?,?) "
            "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            ("mix_undo", json.dumps(history[-UNDO_KEPT:])),
        )
        conn.execute("DELETE FROM queue")
        conn.executemany(
            "INSERT INTO queue(position,song_id,seam,locked) VALUES(?,?,?,?)",
            [(i, *item) for i, item in enumerate(items)],
        )
        conn.execute("UPDATE song_requests SET status='scheduled' WHERE id=?", (request_id,))
        conn.execute(
            "INSERT OR REPLACE INTO request_marks(song_id,kind,for_song) VALUES(?,?,NULL)",
            (requested, "requested"),
        )
        conn.executemany(
            "INSERT OR REPLACE INTO request_marks(song_id,kind,for_song) VALUES(?,?,?)",
            [(bridge, "bridge", requested) for bridge in slot.bridges],
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
