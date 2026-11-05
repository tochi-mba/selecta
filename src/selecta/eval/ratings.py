"""Balanced hidden-method stimuli and honest bad-transition reporting."""

from __future__ import annotations

import random
import sqlite3
from collections import defaultdict


def save_rating(
    conn: sqlite3.Connection, a: int, b: int, method: str, rating: int, tags: list[str]
) -> None:
    if rating not in range(1, 6):
        raise ValueError("rating must be 1..5")
    conn.execute(
        "INSERT INTO ratings(song_a,song_b,method,rating,tags) VALUES(?,?,?,?,json(?))",
        (a, b, method, rating, str(tags).replace("'", '"')),
    )
    conn.commit()


def results(conn: sqlite3.Connection) -> dict[str, dict[str, float]]:
    grouped: dict[str, list[int]] = defaultdict(list)
    for row in conn.execute("SELECT method,rating FROM ratings"):
        grouped[row["method"]].append(row["rating"])
    return {
        method: {
            "n": len(values),
            "mean": sum(values) / len(values),
            "bad_rate": sum(v <= 2 for v in values) / len(values),
        }
        for method, values in grouped.items()
    }


def randomised(items: list[dict], seed: int = 7) -> list[dict]:
    hidden = [dict(item, method_hidden=True) for item in items]
    random.Random(seed).shuffle(hidden)
    return hidden
