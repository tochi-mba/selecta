"""A mix is an ordered list of songs, with a seam between each pair that a person can edit.

One mix is current: it's what plays, and it renders first. Every other mix is a draft, which can be
edited just the same without touching what's playing. A draft can also wait in the render line, so
it's ready when it's wanted. Every function here takes `draft`, and without one it means the current
mix.
"""

from __future__ import annotations

import json
import math
import sqlite3
from collections.abc import Callable, Sequence

import numpy as np
import soundfile as sf

from selecta import db
from selecta.analysis.song import load_song
from selecta.config import SAMPLE_RATE, Settings
from selecta.render.engine import SongCache
from selecta.render.setmix import _native, join
from selecta.seams import SeamStore, request_from

Item = tuple[int, str | None, int]
NAME_LIMIT = 60
LAST_DELETED = "last_deleted_draft"


class NoSuchDraft(KeyError):
    """That draft has been deleted or played, perhaps in another tab."""


def _draft_row(conn: sqlite3.Connection, draft: int) -> sqlite3.Row:
    row = conn.execute("SELECT * FROM drafts WHERE id=?", (draft,)).fetchone()
    if row is None:
        raise NoSuchDraft(draft)
    return row


def _stored(row: sqlite3.Row) -> list[Item]:
    return [(item[0], item[1], item[2]) for item in json.loads(row["items"])]


def _rows(conn: sqlite3.Connection, draft: int | None = None) -> list:
    if draft is None:
        return conn.execute(
            "SELECT q.*, s.artist, s.title, s.duration, s.genre, a.bpm, a.camelot "
            "FROM queue q JOIN songs s ON s.id=q.song_id LEFT JOIN analysis a ON a.song_id=s.id "
            "ORDER BY q.position"
        ).fetchall()
    items = _stored(_draft_row(conn, draft))
    if not items:
        return []
    marks = ",".join("?" * len(items))
    known = {
        row["id"]: row
        for row in conn.execute(
            "SELECT s.id, s.artist, s.title, s.duration, s.genre, a.bpm, a.camelot "  # noqa: S608
            f"FROM songs s LEFT JOIN analysis a ON a.song_id=s.id WHERE s.id IN ({marks})",
            [item[0] for item in items],
        )
    }
    # a song that has left the library since just drops out of the draft
    present = [item for item in items if item[0] in known]
    return [
        {**dict(known[song]), "position": index, "song_id": song, "seam": seam, "locked": locked}
        for index, (song, seam, locked) in enumerate(present)
    ]


SHORTEST_STAY = 30.0
SHORTEST_STAY_LATE_ON = 8.0
LAST_EXIT = 12.0
NO_NEED_YET = 45.0  # nothing leaves a song this early, so a seam yet to be made needn't be told


def with_room(
    settings: dict,
    a: int,
    b: int,
    entered: float | None,
    duration: float | None,
    state_of: Callable[[str], dict],
) -> dict:
    """The seam out of song A, given where the seam into A lands. Each seam finds its own way out of
    a song without knowing how the song was entered, so left alone one can start before the other
    has finished, and the song would go right past it. A seam is left as it is if it fits, and asked
    to go later if it doesn't. A place someone chose stays theirs, so that one's only flagged."""
    if entered is None or settings.get("exit_bar") is not None or settings.get("shape"):
        return settings
    wanted = entered + SHORTEST_STAY
    if duration is not None and wanted > duration - LAST_EXIT:
        wanted = entered + SHORTEST_STAY_LATE_ON
        if wanted > duration - LAST_EXIT:
            return settings  # entered right at its end, which nothing later can put right
    if (settings.get("leave_after") or 0.0) >= wanted - 1.0:
        return settings
    state = state_of(request_from(a, b, settings).key)
    status = state.get("status")
    if status == "rendering":
        return settings  # it may well fit, and this comes back round when it's finished
    if status == "ready" and (state.get("a_source_start") or 0.0) >= wanted:
        return settings
    if status != "ready" and wanted <= NO_NEED_YET:
        return settings
    return {**settings, "leave_after": float(math.ceil(wanted))}


def chain_with_room(
    chain: Sequence[int],
    seams: Sequence[dict],
    entered: float | None,
    duration_of: Callable[[int], float | None],
    state_of: Callable[[str], dict],
) -> list[dict]:
    """The same, along a run of songs, each seam going by where the one before it lands."""
    settled: list[dict] = []
    for a, b, seam in zip(chain, chain[1:], seams, strict=False):
        settings = with_room(seam, a, b, entered, duration_of(a), state_of)
        settled.append(settings)
        state = state_of(request_from(a, b, settings).key)
        entered = state.get("b_source_end") if state.get("status") == "ready" else None
    return settled


def settle_chain(conn: sqlite3.Connection, store: SeamStore, draft: int | None = None) -> None:
    """Make sure every song in a mix gets played. Everything that reads a mix asks for this, so it
    doesn't matter what changed: an edit, a request joining, or a seam finishing."""
    rows = _rows(conn, draft)
    durations = {row["song_id"]: row["duration"] for row in rows}
    seams = [json.loads(row["seam"] or "{}") for row in rows[1:]]
    chain = [row["song_id"] for row in rows]
    settled = chain_with_room(chain, seams, None, durations.get, store.status)
    for index, (before, after) in enumerate(zip(seams, settled, strict=True), start=1):
        if before is not after:
            set_seam(conn, index, after, draft)


def read_mix(conn: sqlite3.Connection, store: SeamStore, draft: int | None = None) -> list[dict]:
    """The songs in order. Each one after the first carries the seam that leads into it."""
    rows = _rows(conn, draft)
    mix: list[dict] = []
    entered: float | None = 0.0
    for index, row in enumerate(rows):
        item = {
            "position": index,
            "song_id": row["song_id"],
            "artist": row["artist"] or "Unknown artist",
            "title": row["title"] or "Untitled",
            "duration": row["duration"],
            "bpm": row["bpm"],
            "key": row["camelot"],
            "locked": bool(row["locked"]),
            "seam": None,
        }
        if index:
            settings = json.loads(row["seam"] or "{}")
            request = request_from(rows[index - 1]["song_id"], row["song_id"], settings)
            state = store.status(request.key)
            item["seam"] = {"settings": settings, "state": state}
            ready = state.get("status") == "ready"
            leaves = state.get("a_source_start")
            if ready and entered is not None and leaves is not None and leaves < entered:
                item["seam"]["too_soon"] = True
            entered = state.get("b_source_end") if ready else None
        mix.append(item)
    return mix


def write_order(conn: sqlite3.Connection, items: list[Item], draft: int | None = None) -> None:
    """Replace the mix with (song, seam settings, locked) tuples."""
    if draft is not None:
        _draft_row(conn, draft)
        conn.execute(
            "UPDATE drafts SET items=?, updated_at=CURRENT_TIMESTAMP WHERE id=?",
            (json.dumps([list(item) for item in items]), draft),
        )
        conn.commit()
        return
    conn.execute("DELETE FROM queue")
    conn.executemany(
        "INSERT INTO queue(position,song_id,seam,locked) VALUES(?,?,?,?)",
        [(i, song, seam, locked) for i, (song, seam, locked) in enumerate(items)],
    )
    conn.commit()


def _items(conn: sqlite3.Connection, draft: int | None = None) -> list[Item]:
    return [(row["song_id"], row["seam"], row["locked"]) for row in _rows(conn, draft)]


def add_song(
    conn: sqlite3.Connection, song_id: int, position: int | None = None, draft: int | None = None
) -> None:
    items = _items(conn, draft)
    at = len(items) if position is None else max(0, min(position, len(items)))
    items.insert(at, (song_id, None, 0))
    write_order(conn, items, draft)


def remove_at(conn: sqlite3.Connection, position: int, draft: int | None = None) -> None:
    items = _items(conn, draft)
    if 0 <= position < len(items):
        items.pop(position)
        write_order(conn, items, draft)


def move_song(
    conn: sqlite3.Connection, source: int, target: int, draft: int | None = None
) -> None:
    """Move one song. Its old and new neighbours get fresh seams, since those pairs are new."""
    items = _items(conn, draft)
    if not (0 <= source < len(items) and 0 <= target < len(items)) or source == target:
        return
    moving = items.pop(source)
    items.insert(target, (moving[0], None, moving[2]))
    if source < len(items):
        song, _, locked = items[source]
        items[source] = (song, None, locked)
    if target + 1 < len(items):
        song, _, locked = items[target + 1]
        items[target + 1] = (song, None, locked)
    write_order(conn, items, draft)


def replace_at(
    conn: sqlite3.Connection, position: int, song_id: int, draft: int | None = None
) -> None:
    """Swap one song for another. Both seams touching it get reset, since both pairs are new."""
    items = _items(conn, draft)
    if not 0 <= position < len(items):
        return
    items[position] = (song_id, None, items[position][2])
    if position + 1 < len(items):
        song, _, locked = items[position + 1]
        items[position + 1] = (song, None, locked)
    write_order(conn, items, draft)


def set_seam(
    conn: sqlite3.Connection, position: int, seam: dict, draft: int | None = None
) -> None:
    cleaned = {key: value for key, value in seam.items() if value not in (None, "")}
    if draft is None:
        conn.execute("UPDATE queue SET seam=? WHERE position=?", (json.dumps(cleaned), position))
        conn.commit()
        return
    items = _items(conn, draft)
    if 0 <= position < len(items):
        song, _, locked = items[position]
        items[position] = (song, json.dumps(cleaned), locked)
        write_order(conn, items, draft)


def toggle_lock(conn: sqlite3.Connection, position: int, draft: int | None = None) -> None:
    if draft is None:
        conn.execute("UPDATE queue SET locked=1-locked WHERE position=?", (position,))
        conn.commit()
        return
    items = _items(conn, draft)
    if 0 <= position < len(items):
        song, seam, locked = items[position]
        items[position] = (song, seam, 1 - locked)
        write_order(conn, items, draft)


def merge_with_locks(
    conn: sqlite3.Connection,
    planned: list[int],
    seams: dict[int, dict] | None = None,
    draft: int | None = None,
) -> None:
    """Install a new plan, keeping every locked song at its place, with its seam.

    `seams` gives the settings for the seam leading into a song, by song, as the plan intended it.
    """
    seams = seams or {}
    locked = {
        row["position"]: (row["song_id"], row["seam"])
        for row in _rows(conn, draft)
        if row["locked"]
    }
    held = {song for song, _ in locked.values()}
    free = [song for song in planned if song not in held]
    size = max(len(free) + len(locked), (max(locked) + 1) if locked else 0)
    items: list[Item] = []
    for position in range(size):
        if position in locked:
            song, seam = locked[position]
            items.append((song, seam, 1))
        elif free:
            song = free.pop(0)
            items.append((song, json.dumps(seams[song]) if song in seams else None, 0))
    write_order(conn, items, draft)


def export_mix(
    conn: sqlite3.Connection,
    settings: Settings,
    store: SeamStore,
    destination,
    draft: int | None = None,
) -> dict:
    """Join every song and finished seam in the mix into one file."""
    mix = read_mix(conn, store, draft)
    if len(mix) < 2:
        raise ValueError("A mix needs at least two songs.")
    missing = [item for item in mix[1:] if item["seam"]["state"].get("status") != "ready"]
    if missing:
        raise ValueError(f"{len(missing)} seams still need rendering.")
    cache = SongCache(capacity=3)
    parts: list[np.ndarray] = []
    position = 0.0
    for index, item in enumerate(mix):
        song = load_song(conn, settings, item["song_id"])
        after = mix[index + 1]["seam"]["state"] if index + 1 < len(mix) else None
        end = after["a_source_start"] if after else song.duration
        if end <= position:
            raise ValueError(
                f"The seam out of {song.title} starts before the seam into it has finished. "
                "Pick a later place to leave it, or an earlier place to bring it in."
            )
        parts.append(_native(cache, song, position, end))
        if after:
            clip, _ = sf.read(store.folder(after["key"]) / "clip.flac", dtype="float32")
            parts.append(clip)
            position = after["b_source_end"]
    audio = join(parts)
    destination.parent.mkdir(parents=True, exist_ok=True)
    sf.write(destination, audio, SAMPLE_RATE, subtype="PCM_16")
    return {"seconds": audio.shape[0] / SAMPLE_RATE, "name": destination.name}


UNDO_DEPTH = 20


def _history(conn: sqlite3.Connection, draft: int | None) -> list[dict]:
    if draft is None:
        return db.preference(conn, "mix_undo", [])
    return json.loads(_draft_row(conn, draft)["history"])


def _set_history(conn: sqlite3.Connection, history: list[dict], draft: int | None) -> None:
    if draft is None:
        db.set_preference(conn, "mix_undo", history)
        return
    conn.execute("UPDATE drafts SET history=? WHERE id=?", (json.dumps(history), draft))
    conn.commit()


def remember(conn: sqlite3.Connection, label: str, draft: int | None = None) -> None:
    """Keep the mix as it is now, so this next change can be undone. Selecta never asks "are you
    sure?", it just lets you take things back."""
    history = _history(conn, draft)
    history.append(
        {
            "label": label,
            "name": mix_name(conn, draft),
            "items": [list(item) for item in _items(conn, draft)],
        }
    )
    _set_history(conn, history[-UNDO_DEPTH:], draft)


def can_undo(conn: sqlite3.Connection, draft: int | None = None) -> bool:
    return bool(_history(conn, draft))


def undo(conn: sqlite3.Connection, draft: int | None = None) -> str | None:
    """Put the last remembered mix back, and say what was undone."""
    history = _history(conn, draft)
    if not history:
        return None
    last = history.pop()
    _set_history(conn, history, draft)
    if last.get("swap"):
        _undo_swap(conn, last)
    write_order(conn, [tuple(item) for item in last["items"]], draft)
    set_mix_name(conn, last["name"], draft)
    return last["label"]


def mix_name(conn: sqlite3.Connection, draft: int | None = None) -> str:
    if draft is not None:
        return _draft_row(conn, draft)["name"]
    return db.preference(conn, "mix_name", "Your mix")


def set_mix_name(conn: sqlite3.Connection, name: str, draft: int | None = None) -> None:
    if draft is not None:
        conn.execute(
            "UPDATE drafts SET name=?, updated_at=CURRENT_TIMESTAMP WHERE id=?", (name, draft)
        )
        conn.commit()
        return
    db.set_preference(conn, "mix_name", name)


# ---- drafts


def all_drafts(conn: sqlite3.Connection) -> list[sqlite3.Row]:
    """Whatever's in the render line first, in its order, then the most recently changed."""
    return conn.execute(
        "SELECT * FROM drafts ORDER BY line IS NULL, line, updated_at DESC, id DESC"
    ).fetchall()


def _clean_name(name: str) -> str:
    return " ".join(name.split())[:NAME_LIMIT].strip()


def unique_name(conn: sqlite3.Connection, wanted: str, ignoring: int | None = None) -> str:
    """Names can't be confused with each other: a second one gets a number."""
    taken = {
        row["name"].casefold()
        for row in conn.execute("SELECT id,name FROM drafts").fetchall()
        if row["id"] != ignoring
    }
    if wanted.casefold() not in taken:
        return wanted
    number = 2
    while f"{wanted} {number}".casefold() in taken:
        number += 1
    return f"{wanted} {number}"


def _first_free_name(conn: sqlite3.Connection) -> str:
    taken = {row["name"].casefold() for row in conn.execute("SELECT name FROM drafts").fetchall()}
    number = 1
    while f"draft {number}" in taken:
        number += 1
    return f"Draft {number}"


def create_draft(
    conn: sqlite3.Connection, name: str | None = None, items: list[Item] | None = None
) -> int:
    """A new draft, always under a name of its own. With no name or songs, an empty draft that's
    already there is used rather than making another, so they can't pile up."""
    clean = _clean_name(name or "")
    if not clean and not items:
        for row in all_drafts(conn):
            if not _stored(row):
                return row["id"]
    chosen = unique_name(conn, clean) if clean else _first_free_name(conn)
    cursor = conn.execute(
        "INSERT INTO drafts(name,items) VALUES(?,?)",
        (chosen, json.dumps([list(item) for item in items or []])),
    )
    conn.commit()
    return int(cursor.lastrowid)


def copy_current(conn: sqlite3.Connection, name: str | None = None) -> int:
    """Keep the current mix as it is now, as a draft of its own."""
    return create_draft(conn, name or mix_name(conn), _items(conn))


def duplicate_draft(conn: sqlite3.Connection, draft: int) -> int:
    row = _draft_row(conn, draft)
    return create_draft(conn, f"{row['name']} copy", _stored(row))


def rename_draft(conn: sqlite3.Connection, draft: int, name: str) -> str:
    """Rename it, keeping the old name if there's nothing to go on."""
    current = _draft_row(conn, draft)["name"]
    clean = _clean_name(name)
    if not clean or clean == current:
        return current
    chosen = unique_name(conn, clean, ignoring=draft)
    set_mix_name(conn, chosen, draft)
    return chosen


def _as_saved(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "name": row["name"],
        "items": row["items"],
        "history": row["history"],
        "line": row["line"],
    }


def _put_back(conn: sqlite3.Connection, saved: dict) -> None:
    conn.execute(
        "INSERT OR REPLACE INTO drafts(id,name,items,history,line) VALUES(?,?,?,?,?)",
        (saved["id"], saved["name"], saved["items"], saved["history"], None),
    )
    if saved["line"] is not None:
        order = line_order(conn)
        order.insert(min(saved["line"], len(order)), saved["id"])
        _set_line(conn, order)
    conn.commit()


def delete_draft(conn: sqlite3.Connection, draft: int) -> str:
    """Delete a draft and keep it aside, so it can be taken back."""
    row = _draft_row(conn, draft)
    db.set_preference(conn, LAST_DELETED, _as_saved(row))
    conn.execute("DELETE FROM drafts WHERE id=?", (draft,))
    _set_line(conn, line_order(conn))
    conn.commit()
    return row["name"]


def restore_draft(conn: sqlite3.Connection) -> int | None:
    saved = db.preference(conn, LAST_DELETED, None)
    if not saved:
        return None
    saved["name"] = unique_name(conn, saved["name"])
    _put_back(conn, saved)
    db.set_preference(conn, LAST_DELETED, None)
    return saved["id"]


def play_draft(conn: sqlite3.Connection, draft: int) -> str:
    """Make a draft the current mix. The two trade places, so there's only ever one copy of a mix
    and nothing is lost: what was current becomes a draft, unless a draft already has those songs,
    and undoing puts everything back."""
    row = _draft_row(conn, draft)
    before, before_name = _items(conn), mix_name(conn)
    coming_in = _items(conn, draft)
    saved = _as_saved(row)
    conn.execute("DELETE FROM drafts WHERE id=?", (draft,))
    _set_line(conn, line_order(conn))
    kept = None
    if before:
        same = json.dumps([list(item) for item in before])
        if not any(other["items"] == same for other in all_drafts(conn)):
            kept = create_draft(conn, before_name, before)
    history = _history(conn, None)
    history.append(
        {
            "label": f"playing {row['name']}",
            "name": before_name,
            "items": [list(item) for item in before],
            "swap": {"kept": kept, "draft": saved},
        }
    )
    _set_history(conn, history[-UNDO_DEPTH:], None)
    write_order(conn, coming_in)
    set_mix_name(conn, row["name"])
    return row["name"]


def _undo_swap(conn: sqlite3.Connection, last: dict) -> None:
    kept = last["swap"]["kept"]
    if kept is not None:
        row = conn.execute("SELECT items FROM drafts WHERE id=?", (kept,)).fetchone()
        # if it has been changed since, those changes are worth more than a tidy list
        if row is not None and json.loads(row["items"]) == last["items"]:
            conn.execute("DELETE FROM drafts WHERE id=?", (kept,))
    saved = dict(last["swap"]["draft"])
    saved["name"] = unique_name(conn, saved["name"])
    _put_back(conn, saved)


# ---- the render line: mixes to render once the current mix is done, in this order


def line_order(conn: sqlite3.Connection) -> list[int]:
    return [
        row["id"]
        for row in conn.execute(
            "SELECT id FROM drafts WHERE line IS NOT NULL ORDER BY line, id"
        ).fetchall()
    ]


def _set_line(conn: sqlite3.Connection, order: list[int]) -> None:
    conn.execute("UPDATE drafts SET line=NULL")
    conn.executemany("UPDATE drafts SET line=? WHERE id=?", [(i, d) for i, d in enumerate(order)])
    conn.commit()


def join_line(conn: sqlite3.Connection, draft: int) -> None:
    _draft_row(conn, draft)
    order = line_order(conn)
    if draft not in order:
        _set_line(conn, [*order, draft])


def leave_line(conn: sqlite3.Connection, draft: int) -> None:
    _set_line(conn, [other for other in line_order(conn) if other != draft])


def move_in_line(conn: sqlite3.Connection, draft: int, step: int) -> None:
    order = line_order(conn)
    if draft not in order:
        return
    at = order.index(draft)
    to = max(0, min(at + (1 if step > 0 else -1), len(order) - 1))
    order[at], order[to] = order[to], order[at]
    _set_line(conn, order)
