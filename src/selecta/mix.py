"""A mix is an ordered list of songs, with a seam between each pair that a person can edit."""

from __future__ import annotations

import json
import sqlite3

import numpy as np
import soundfile as sf

from selecta.analysis.song import load_song
from selecta.config import SAMPLE_RATE, Settings
from selecta.render.engine import SongCache
from selecta.render.setmix import _native, join
from selecta.seams import SeamStore, request_from


def _rows(conn: sqlite3.Connection) -> list[sqlite3.Row]:
    return conn.execute(
        "SELECT q.*, s.artist, s.title, s.duration, s.genre, a.bpm, a.camelot "
        "FROM queue q JOIN songs s ON s.id=q.song_id LEFT JOIN analysis a ON a.song_id=s.id "
        "ORDER BY q.position"
    ).fetchall()


def read_mix(conn: sqlite3.Connection, store: SeamStore) -> list[dict]:
    """The songs in order. Each one after the first carries the seam that leads into it."""
    rows = _rows(conn)
    mix: list[dict] = []
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
            item["seam"] = {"settings": settings, "state": store.status(request.key)}
        mix.append(item)
    return mix


def write_order(conn: sqlite3.Connection, items: list[tuple[int, str | None, int]]) -> None:
    """Replace the mix with (song, seam settings, locked) tuples."""
    conn.execute("DELETE FROM queue")
    conn.executemany(
        "INSERT INTO queue(position,song_id,seam,locked) VALUES(?,?,?,?)",
        [(i, song, seam, locked) for i, (song, seam, locked) in enumerate(items)],
    )
    conn.commit()


def _items(conn: sqlite3.Connection) -> list[tuple[int, str | None, int]]:
    return [(row["song_id"], row["seam"], row["locked"]) for row in _rows(conn)]


def add_song(conn: sqlite3.Connection, song_id: int, position: int | None = None) -> None:
    items = _items(conn)
    at = len(items) if position is None else max(0, min(position, len(items)))
    items.insert(at, (song_id, None, 0))
    write_order(conn, items)


def remove_at(conn: sqlite3.Connection, position: int) -> None:
    items = _items(conn)
    if 0 <= position < len(items):
        items.pop(position)
        write_order(conn, items)


def move_song(conn: sqlite3.Connection, source: int, target: int) -> None:
    """Move one song. Its old and new neighbours get fresh seams, since those pairs are new."""
    items = _items(conn)
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
    write_order(conn, items)


def replace_at(conn: sqlite3.Connection, position: int, song_id: int) -> None:
    """Swap one song for another. Both seams touching it get reset, since both pairs are new."""
    items = _items(conn)
    if not 0 <= position < len(items):
        return
    items[position] = (song_id, None, items[position][2])
    if position + 1 < len(items):
        song, _, locked = items[position + 1]
        items[position + 1] = (song, None, locked)
    write_order(conn, items)


def set_seam(conn: sqlite3.Connection, position: int, seam: dict) -> None:
    cleaned = {key: value for key, value in seam.items() if value not in (None, "")}
    conn.execute("UPDATE queue SET seam=? WHERE position=?", (json.dumps(cleaned), position))
    conn.commit()


def toggle_lock(conn: sqlite3.Connection, position: int) -> None:
    conn.execute("UPDATE queue SET locked=1-locked WHERE position=?", (position,))
    conn.commit()


def merge_with_locks(
    conn: sqlite3.Connection, planned: list[int], seams: dict[int, dict] | None = None
) -> None:
    """Install a new plan, keeping every locked song at its place, with its seam.

    `seams` gives the settings for the seam leading into a song, by song, as the plan intended it.
    """
    seams = seams or {}
    locked = {
        row["position"]: (row["song_id"], row["seam"]) for row in _rows(conn) if row["locked"]
    }
    held = {song for song, _ in locked.values()}
    free = [song for song in planned if song not in held]
    size = max(len(free) + len(locked), (max(locked) + 1) if locked else 0)
    items: list[tuple[int, str | None, int]] = []
    for position in range(size):
        if position in locked:
            song, seam = locked[position]
            items.append((song, seam, 1))
        elif free:
            song = free.pop(0)
            items.append((song, json.dumps(seams[song]) if song in seams else None, 0))
    write_order(conn, items)


def export_mix(conn: sqlite3.Connection, settings: Settings, store: SeamStore, destination) -> dict:
    """Join every song and finished seam in the mix into one file."""
    mix = read_mix(conn, store)
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
