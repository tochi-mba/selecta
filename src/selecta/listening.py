"""Persistent paired trials. Condition identities stay outside listener-facing records."""

from __future__ import annotations

import json
import random
import sqlite3
import uuid


def initialise(conn: sqlite3.Connection) -> None:
    conn.execute(
        "CREATE TABLE IF NOT EXISTS listening_trials ("
        "id TEXT PRIMARY KEY, study TEXT NOT NULL, pair TEXT NOT NULL, "
        "mapping TEXT NOT NULL, seed INTEGER NOT NULL)"
    )
    conn.execute(
        "CREATE TABLE IF NOT EXISTS listening_responses ("
        "trial TEXT NOT NULL REFERENCES listening_trials(id), listener TEXT NOT NULL, "
        "choice TEXT NOT NULL, setup TEXT NOT NULL, updated_at TEXT DEFAULT CURRENT_TIMESTAMP, "
        "PRIMARY KEY(trial,listener))"
    )
    conn.commit()


def create_trials(conn: sqlite3.Connection, study: str, pairs: list[dict], seed: int) -> list[str]:
    """Each pair supplies a stable pair ID and two distinct rendered condition IDs.

    Rendering, equal-context and loudness checks must precede registration. This
    module randomizes identities; it does not assert those audio checks happened.
    """
    if not study.strip() or not pairs:
        raise ValueError("A study needs a name and at least one pair")
    for pair in pairs:
        if not pair.get("pair") or len(pair.get("conditions", [])) != 2:
            raise ValueError("Each trial needs a pair ID and two conditions")
        if len(set(pair["conditions"])) != 2:
            raise ValueError("The two rendered conditions must be distinct")
    initialise(conn)
    rng = random.Random(seed)
    ids = []
    with conn:
        for pair in pairs:
            conditions = list(pair["conditions"])
            rng.shuffle(conditions)
            trial = uuid.uuid4().hex
            conn.execute(
                "INSERT INTO listening_trials VALUES(?,?,?,?,?)",
                (
                    trial,
                    study,
                    pair["pair"],
                    json.dumps(dict(zip(("a", "b"), conditions, strict=True))),
                    seed,
                ),
            )
            ids.append(trial)
    return ids


def public_trials(conn: sqlite3.Connection, study: str) -> list[dict]:
    """Expose opaque trial IDs and A/B handles, never pair or condition metadata."""
    initialise(conn)
    return [
        {"id": row[0], "options": ["a", "b"]}
        for row in conn.execute(
            "SELECT id FROM listening_trials WHERE study=? ORDER BY rowid", (study,)
        )
    ]


def respond(conn: sqlite3.Connection, trial: str, listener: str, choice: str, setup: str) -> None:
    if choice not in {"a", "b", "tie", "cannot_judge"}:
        raise ValueError("Choose a, b, tie, or cannot_judge")
    if not listener.strip() or not setup.strip():
        raise ValueError("A listener ID and listening setup are required")
    initialise(conn)
    if conn.execute("SELECT 1 FROM listening_trials WHERE id=?", (trial,)).fetchone() is None:
        raise ValueError("Unknown listening trial")
    with conn:
        conn.execute(
            "INSERT INTO listening_responses(trial,listener,choice,setup) VALUES(?,?,?,?) "
            "ON CONFLICT(trial,listener) DO UPDATE SET "
            "choice=excluded.choice,setup=excluded.setup, "
            "updated_at=CURRENT_TIMESTAMP",
            (trial, listener, choice, setup),
        )
