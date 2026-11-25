"""Balanced hidden-method stimuli and honest bad-transition reporting.

With `core.engine_store` on, ratings go through the engine store on the same library file
(`engine_store.ratings`); off, they use the connection directly, as they always have.
"""

from __future__ import annotations

import sqlite3
from collections import defaultdict

from selecta import flags


def save_rating(
    conn: sqlite3.Connection, a: int, b: int, method: str, rating: int, tags: list[str]
) -> None:
    if rating not in range(1, 6):
        raise ValueError("rating must be 1..5")
    if flags.on("core.engine_store"):
        from selecta.engine_store import library
        from selecta.engine_store import ratings as stored

        # the raw insert below committed the caller's pending writes too; keep that, and keep
        # the store's write from waiting behind the caller's own lock
        if conn.in_transaction:
            conn.commit()
        stored.save(library.store_of(conn), a, b, method, rating, tags)
        return
    conn.execute(
        "INSERT INTO ratings(song_a,song_b,method,rating,tags) VALUES(?,?,?,?,json(?))",
        (a, b, method, rating, str(tags).replace("'", '"')),
    )
    conn.commit()


def results(conn: sqlite3.Connection) -> dict[str, dict[str, float]]:
    if flags.on("core.engine_store"):
        from selecta.engine_store import library
        from selecta.engine_store import ratings as stored

        return stored.results(library.store_of(conn))
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
