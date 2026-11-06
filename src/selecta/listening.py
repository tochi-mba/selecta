"""Persistent paired trials. Condition identities stay outside listener-facing records."""

from __future__ import annotations

import json
import random
import sqlite3
import uuid

import numpy as np
import pyloudnorm as pyln


def prepare_comparison(
    first: np.ndarray, second: np.ndarray, sample_rate: int, target_lufs: float = -18.0
) -> tuple[np.ndarray, np.ndarray, dict]:
    """Match excerpt loudness at a shared peak-safe target; never time-stretch a trial.

    Caller must establish matching source cues and context before using these arrays.
    This checks audio integrity and length, not musical equivalence of those cues.
    """
    clips = [np.asarray(clip, dtype=float) for clip in (first, second)]
    if sample_rate <= 0 or not np.isfinite(target_lufs):
        raise ValueError("A valid sample rate and loudness target are required")
    if clips[0].shape != clips[1].shape:
        raise ValueError("Comparison clips must have identical duration and channel layout")
    for clip in clips:
        if clip.ndim != 2 or clip.shape[1] != 2 or len(clip) < sample_rate:
            raise ValueError("Use stereo excerpts at least one second long")
        if not np.isfinite(clip).all() or np.max(np.abs(clip)) > 1:
            raise ValueError("Comparison audio contains non-finite or out-of-range samples")
    meter = pyln.Meter(sample_rate)
    loudness = [float(meter.integrated_loudness(clip)) for clip in clips]
    if not all(np.isfinite(value) for value in loudness):
        raise ValueError("Silent excerpts cannot be loudness matched")
    peak_db = [float(20 * np.log10(np.max(np.abs(clip)))) for clip in clips]
    target = min(
        target_lufs, *(level - peak - 1 for level, peak in zip(loudness, peak_db, strict=True))
    )
    matched = [
        clip * 10 ** ((target - level) / 20) for clip, level in zip(clips, loudness, strict=True)
    ]
    return (
        matched[0],
        matched[1],
        {
            "sample_rate": sample_rate,
            "frames": len(clips[0]),
            "original_lufs": loudness,
            "target_lufs": target,
            "sample_peak_ceiling_db": -1.0,
        },
    )


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
