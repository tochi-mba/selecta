"""The ratings slice: the listening-test ratings, read and written only through an `EngineStore`.

These are the 1 to 5 ratings `eval.ratings` records for a hidden method between two songs, the
rows the backup counts and a relink reports. The Good and Bad a listener clicks on a seam are a
different thing: they live in the seam's record (`seam.json`, `seam-history/`), which ADR-0479
moves with the seams slice, not here.
"""

from __future__ import annotations

import json
from collections import defaultdict
from collections.abc import Collection
from datetime import UTC, datetime

import sqlalchemy as sa

from selecta.engine_store import EngineStore, insert_returning_id
from selecta.engine_store.schema import ratings


def _now() -> str:
    # the format SQLite's CURRENT_TIMESTAMP gave every older row, so old and new sort together
    return datetime.now(UTC).strftime("%Y-%m-%d %H:%M:%S")


def save(
    store: EngineStore,
    a: int,
    b: int,
    method: str,
    rating: int,
    tags: list[str],
    seam_id: int | None = None,
) -> int:
    """Record one rating; returns its id."""
    if rating not in range(1, 6):
        raise ValueError("rating must be 1..5")
    with store.write() as connection:
        return int(
            insert_returning_id(
                connection,
                ratings,
                {
                    "workspace_id": store.workspace_id,
                    "seam_id": seam_id,
                    "song_a": a,
                    "song_b": b,
                    "method": method,
                    "rating": rating,
                    "tags": json.dumps(list(tags)),
                    "created_at": _now(),
                },
            )
        )


def results(store: EngineStore) -> dict[str, dict[str, float]]:
    """Each method's count, mean and share of ratings of 2 or less."""
    grouped: dict[str, list[int]] = defaultdict(list)
    with store.read() as connection:
        for method, rating in connection.execute(
            sa.select(ratings.c.method, ratings.c.rating)
            .where(store.mine(ratings))
            .order_by(ratings.c.id)
        ):
            grouped[method].append(rating)
    return {
        method: {
            "n": len(values),
            "mean": sum(values) / len(values),
            "bad_rate": sum(v <= 2 for v in values) / len(values),
        }
        for method, values in grouped.items()
    }


def every(store: EngineStore) -> list[dict]:
    """Every rating in this workspace, oldest first, with its tags as a list."""
    with store.read() as connection:
        rows = connection.execute(
            sa.select(ratings).where(store.mine(ratings)).order_by(ratings.c.id)
        ).mappings()
        return [dict(row, tags=json.loads(row["tags"] or "[]")) for row in rows]


def count(store: EngineStore) -> int:
    with store.read() as connection:
        return int(
            connection.execute(
                sa.select(sa.func.count()).select_from(ratings).where(store.mine(ratings))
            ).scalar_one()
        )


def count_touching(store: EngineStore, song_ids: Collection[int]) -> int:
    """How many ratings name any of these songs, on either side."""
    if not song_ids:
        return 0
    ids = sorted(song_ids)
    with store.read() as connection:
        return int(
            connection.execute(
                sa.select(sa.func.count())
                .select_from(ratings)
                .where(
                    store.mine(ratings),
                    sa.or_(ratings.c.song_a.in_(ids), ratings.c.song_b.in_(ids)),
                )
            ).scalar_one()
        )


__all__ = ["count", "count_touching", "every", "results", "save"]
