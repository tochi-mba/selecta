"""Persistent set state and one-tap steering for the browser app."""

from __future__ import annotations

import sqlite3
from dataclasses import asdict, dataclass

from selecta import db


@dataclass
class Steering:
    energy: int = 0
    wordplay: str = "sometimes"
    flash: str = "balanced"
    target: str | None = None
    length_mode: str = "party"


def get_steering(conn: sqlite3.Connection) -> Steering:
    raw = db.preference(conn, "steering", {})
    return Steering(**{k: v for k, v in raw.items() if k in Steering.__annotations__})


def steer(conn: sqlite3.Connection, action: str, value: str | int | None = None) -> Steering:
    state = get_steering(conn)
    if action == "more":
        state.energy = min(2, state.energy + 1)
    elif action == "less":
        state.energy = max(-2, state.energy - 1)
    elif action == "wordplay":
        state.wordplay = str(value or "sometimes")
    elif action == "flash":
        state.flash = str(value or "balanced")
    elif action == "take_me_to":
        state.target = str(value) if value else None
    elif action == "length_mode":
        state.length_mode = str(value or "party")
    elif action != "undo":
        raise ValueError(f"unknown steering action: {action}")
    db.set_preference(conn, "steering", asdict(state))
    return state


def queue(conn: sqlite3.Connection) -> list[dict]:
    rows = conn.execute(
        "SELECT q.*, s.artist, s.title, s.duration FROM queue q "
        "JOIN songs s ON s.id=q.song_id ORDER BY position"
    ).fetchall()
    return [dict(row) for row in rows]
