"""Listening history and taste memory, with evidence and the person in control (ADR-0316, 0310).

Four layers are kept apart: live facts (read fresh from the library and player each time),
taste (explicit rules the person stated, and patterns inferred from real listening with their
counts and confidence), conversation-only notes, and proposal versions (in proposals.py).

History collection is off until the person turns it on. Only the authoritative player counts:
previews, seam auditions and the Studio never do. Clearing is real deletion.
"""

from __future__ import annotations

import json
import sqlite3
from collections import Counter
from typing import Any

from selecta.lucy import settings as lucy_settings
from selecta.lucy.ids import new_id, now_iso

EVENTS = {"start", "complete", "skip"}
MEANINGFUL_SECONDS = 30.0
KINDS = {"explicit", "inferred", "session"}
MAX_FACT_TEXT = 300


def history_enabled(conn: sqlite3.Connection) -> bool:
    return bool(lucy_settings.get(conn)["phases"]["memory"])


def record_listening(
    conn: sqlite3.Connection,
    song_id: int,
    session: str,
    source: str,
    event: str,
    heard: float,
    position: float,
) -> bool:
    """One real listening fact from the player, or nothing when collection is off."""
    if source != "player" or event not in EVENTS or not history_enabled(conn):
        return False
    if not (0 <= heard < 86400 and 0 <= position < 86400) or len(session) > 80:
        raise ValueError("Listening times must be real numbers of seconds.")
    if conn.execute("SELECT 1 FROM songs WHERE id=?", (song_id,)).fetchone() is None:
        raise KeyError(song_id)
    conn.execute(
        "INSERT INTO listening_events(song_id,session,source,event,heard,position) "
        "VALUES(?,?,?,?,?,?)",
        (song_id, session, source, event, float(heard), float(position)),
    )
    conn.commit()
    return True


def play_counts(conn: sqlite3.Connection, days: int) -> dict[int, dict[str, int]]:
    """Starts, meaningful listens (30 s or more, or played through) and quick skips per song."""
    rows = conn.execute(
        "SELECT song_id, event, heard FROM listening_events WHERE source='player' AND "
        "created_at >= datetime('now', ?)",
        (f"-{int(days)} days",),
    ).fetchall()
    counts: dict[int, Counter] = {}
    for row in rows:
        tally = counts.setdefault(row["song_id"], Counter())
        if row["event"] == "start":
            tally["starts"] += 1
        elif row["event"] == "complete":
            tally["completes"] += 1
        elif row["heard"] >= MEANINGFUL_SECONDS:
            tally["completes"] += 1
        else:
            tally["skips"] += 1
    return {song: dict(tally) for song, tally in counts.items()}


def most_played(conn: sqlite3.Connection, days: int = 90, limit: int = 10) -> dict:
    """Only from persisted events, with counts and the period they cover (LU-316-04)."""
    counts = play_counts(conn, days)
    ranked = sorted(
        counts.items(),
        key=lambda item: (-item[1].get("completes", 0), -item[1].get("starts", 0), item[0]),
    )
    top = []
    for song_id, tally in ranked[: max(1, min(limit, 50))]:
        row = conn.execute("SELECT title, artist FROM songs WHERE id=?", (song_id,)).fetchone()
        if row is None:
            continue
        top.append(
            {
                "song_id": song_id,
                "title": row["title"] or "Untitled",
                "artist": row["artist"] or "",
                "plays": tally.get("starts", 0),
                "completes": tally.get("completes", 0),
                "skips": tally.get("skips", 0),
            }
        )
    total = conn.execute("SELECT COUNT(*) FROM listening_events").fetchone()[0]
    return {"top": top, "events": int(total), "period": f"last {days} days" if total else None}


def _fact(row: sqlite3.Row) -> dict:
    value = json.loads(row["value"])
    return {
        "id": row["id"],
        "kind": row["kind"],
        "subject": row["subject"],
        "value": value,
        "label": f"{row['subject']}: {value}" if not isinstance(value, str) else value,
        "source": json.loads(row["source"]),
        "confidence": row["confidence"],
        "conversation_id": row["conversation_id"],
        "updated_at": row["updated_at"],
    }


def facts(conn: sqlite3.Connection, conversation: str | None = None) -> list[dict]:
    rows = conn.execute(
        "SELECT * FROM lucy_memory WHERE forgotten=0 AND (kind!='session' OR conversation_id=?) "
        "ORDER BY kind, updated_at DESC",
        (conversation,),
    ).fetchall()
    return [_fact(row) for row in rows]


def add_fact(
    conn: sqlite3.Connection,
    subject: str,
    value: Any,
    kind: str = "explicit",
    source: dict | None = None,
    confidence: float | None = None,
    conversation: str | None = None,
) -> dict:
    if kind not in KINDS:
        raise ValueError(kind)
    subject = " ".join(str(subject).split())[:80]
    if isinstance(value, str):
        value = value.strip()[:MAX_FACT_TEXT]
    if not subject or value in ("", None):
        raise ValueError("A memory needs something to remember.")
    fact = new_id("memory")
    stamp = now_iso()
    conn.execute(
        "INSERT INTO lucy_memory(id,kind,subject,value,source,confidence,conversation_id,"
        "created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)",
        (
            fact,
            kind,
            subject,
            json.dumps(value),
            json.dumps(source or {}),
            confidence,
            conversation if kind == "session" else None,
            stamp,
            stamp,
        ),
    )
    conn.commit()
    return _fact(conn.execute("SELECT * FROM lucy_memory WHERE id=?", (fact,)).fetchone())


def update_fact(conn: sqlite3.Connection, fact: str, value: Any) -> dict:
    row = conn.execute("SELECT * FROM lucy_memory WHERE id=? AND forgotten=0", (fact,)).fetchone()
    if row is None:
        raise KeyError(fact)
    if row["kind"] != "explicit":
        raise ValueError("Only things you told Lucy can be edited; learned ones can be forgotten.")
    if isinstance(value, str):
        value = value.strip()[:MAX_FACT_TEXT]
    conn.execute(
        "UPDATE lucy_memory SET value=?, updated_at=? WHERE id=?",
        (json.dumps(value), now_iso(), fact),
    )
    conn.commit()
    return _fact(conn.execute("SELECT * FROM lucy_memory WHERE id=?", (fact,)).fetchone())


def forget_fact(conn: sqlite3.Connection, fact: str) -> None:
    found = conn.execute("DELETE FROM lucy_memory WHERE id=?", (fact,)).rowcount
    conn.commit()
    if not found:
        raise KeyError(fact)


def clear(conn: sqlite3.Connection, kind: str) -> int:
    if kind == "history":
        removed = conn.execute("DELETE FROM listening_events").rowcount
    elif kind in {"inferred", "explicit"}:
        removed = conn.execute("DELETE FROM lucy_memory WHERE kind=?", (kind,)).rowcount
    else:
        raise ValueError(kind)
    conn.commit()
    return int(removed)


def infer(conn: sqlite3.Connection, seam_memory: Any = None) -> list[dict]:
    """Recompute learned taste from real evidence, with sample sizes; replaces old inferences.

    Rated transitions are directed, and say only what was liked; they never claim a clip is
    ready now (LU-316-05)."""
    conn.execute("DELETE FROM lucy_memory WHERE kind='inferred'")
    learned: list[tuple[str, Any, dict, float]] = []
    if history_enabled(conn):
        counts = play_counts(conn, 180)
        listened = sum(tally.get("completes", 0) for tally in counts.values())
        if listened >= 10:
            genres: Counter[str] = Counter()
            for song_id, tally in counts.items():
                row = conn.execute("SELECT genre FROM songs WHERE id=?", (song_id,)).fetchone()
                if row and row["genre"]:
                    genres[row["genre"]] += tally.get("completes", 0)
            for genre, heard in genres.most_common(3):
                share = heard / listened
                if share >= 0.15:
                    learned.append(
                        (
                            "Often listens to",
                            genre,
                            {"listens": heard, "of": listened, "window": "180 days"},
                            round(min(0.95, share * (1 - 1 / (listened ** 0.5))), 2),
                        )
                    )
    if seam_memory is not None:
        good, bad = seam_memory.good_moves, seam_memory.bad_moves
        for move in sorted(set(good) | set(bad)):
            liked, disliked = good[move], bad[move]
            rated = liked + disliked
            if rated >= 3:
                learned.append(
                    (
                        "Rated transitions",
                        f"{move.replace('_', ' ')}: {liked} good of {rated}",
                        {"good": liked, "bad": disliked, "directed": True},
                        round(abs(liked - disliked) / (rated + 2), 2),
                    )
                )
    for subject, value, source, confidence in learned:
        add_fact(conn, subject, value, "inferred", source, confidence)
    conn.commit()
    return [fact for fact in facts(conn) if fact["kind"] == "inferred"]


def provider_receives(conn: sqlite3.Connection) -> list[str]:
    """Exactly what a remote provider would be sent, in plain words (LU-316-07, LU-330-07)."""
    config = lucy_settings.get(conn)
    if not config["provider"]["remote"]:
        return ["Nothing: the built-in Lucy runs on this computer and sends no data anywhere."]
    sent = [
        "What you type to Lucy, and Lucy's replies in this conversation",
        "Titles, artists, tempo, key and energy of songs Lucy looks up or proposes",
        "Counts and statuses of transitions (never the audio)",
        "The rules of the current proposal",
    ]
    if config["privacy"]["share_history"]:
        sent.append("A short summary of your most-played songs (titles and counts)")
    if config["privacy"]["share_lyrics"]:
        sent.append("Short lyric phrases used for word links")
    sent.append("Never: file paths, audio, API keys, or your whole library list")
    return sent
