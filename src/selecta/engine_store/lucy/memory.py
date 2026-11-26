"""Lucy's memory, listening history and permission requests through the store."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

import sqlalchemy as sa

from selecta.engine_store.lucy import Tx
from selecta.engine_store.mixes import now
from selecta.engine_store.schema import listening_events, lucy_memory, lucy_permissions, songs


def song(tx: Tx, song_id: int):
    """The library song's title, artist and genre, or None."""
    return tx.one(
        sa.select(songs.c.title, songs.c.artist, songs.c.genre).where(tx.where(songs, id=song_id))
    )


def record_listening(tx: Tx, song_id: int, session: str, source: str, event: str, heard: float,
                     position: float) -> None:
    tx.insert(listening_events, song_id=song_id, session=session, source=source, event=event,
              heard=heard, position=position, created_at=now())


def player_events(tx: Tx, days: int) -> list:
    """The player's events of the last `days`, as SQLite's `datetime('now', '-N days')` cuts."""
    cutoff = (datetime.now(UTC) - timedelta(days=days)).strftime("%Y-%m-%d %H:%M:%S")
    e = listening_events.c
    return tx.all(
        sa.select(e.song_id, e.event, e.heard).where(
            tx.where(listening_events, source="player"), e.created_at >= cutoff
        )
    )


def listening_total(tx: Tx) -> int:
    return int(tx.scalar(sa.select(sa.func.count()).where(tx.store.mine(listening_events))))


def facts(tx: Tx, conversation: str | None, every_conversation: bool) -> list:
    where = [tx.where(lucy_memory, forgotten=0)]
    if not every_conversation:
        where.append(sa.or_(lucy_memory.c.kind != "session",
                            lucy_memory.c.conversation_id == conversation))
    return tx.all(sa.select(lucy_memory).where(*where)
                  .order_by(lucy_memory.c.kind, lucy_memory.c.updated_at.desc()))


def fact(tx: Tx, fact_id: str, live: bool = False):
    equals: dict[str, Any] = {"id": fact_id}
    if live:
        equals["forgotten"] = 0
    return tx.row(lucy_memory, **equals)


def add_fact(tx: Tx, **values: Any) -> None:
    tx.insert(lucy_memory, **values)


def set_value(tx: Tx, fact_id: str, value: str, stamp: str) -> None:
    tx.update(lucy_memory, {"id": fact_id}, value=value, updated_at=stamp)


def forget(tx: Tx, fact_id: str) -> int:
    return tx.delete(lucy_memory, id=fact_id)


def clear(tx: Tx, kind: str) -> int:
    if kind == "history":
        return tx.delete(listening_events)
    return tx.delete(lucy_memory, kind=kind)


# ---- permission requests


def add_permission(tx: Tx, **values: Any) -> None:
    tx.insert(lucy_permissions, **values)


def permission(tx: Tx, permission_id: str):
    return tx.row(lucy_permissions, id=permission_id)


def pending(tx: Tx, conversation: str) -> list:
    return tx.all(
        sa.select(lucy_permissions)
        .where(tx.where(lucy_permissions, conversation_id=conversation, status="pending"))
        .order_by(lucy_permissions.c.created_at)
    )


def decide(tx: Tx, permission_id: str, status: str, stamp: str, front: list[int]) -> None:
    """The answer, and for analysis allowed, those music songs moved to the front, together."""
    for song_id in front:
        tx.run(
            sa.update(songs)
            .where(tx.where(songs, id=song_id), songs.c.is_music == 1)
            .values(processing_priority=100)
        )
    tx.update(lucy_permissions, {"id": permission_id}, status=status, decided_at=stamp)


__all__ = [
    "add_fact",
    "add_permission",
    "clear",
    "decide",
    "fact",
    "facts",
    "forget",
    "listening_total",
    "pending",
    "permission",
    "player_events",
    "record_listening",
    "set_value",
    "song",
]
