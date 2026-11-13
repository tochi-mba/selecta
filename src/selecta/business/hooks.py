"""Hooks other Business packages plug into when the organisation library changes (ADR-0442).

`on_song_removed` runs inside the deleting transaction after a song of a business workspace is
tombstoned (BZ-0442-06): ADR-0444 (BZ-3) appends a callback that replans each zone whose
uncommitted horizon includes the song. Empty by default, so deletion works without it.
"""

from __future__ import annotations

from collections.abc import Callable

from sqlalchemy.engine import Connection

SongRemoved = Callable[[Connection, str, str], None]
"""`callback(conn, workspace_id, song_id)`."""

on_song_removed: list[SongRemoved] = []


def song_removed(conn: Connection, workspace_id: str, song_id: str) -> None:
    """Tell every registered callback, in registration order."""
    for callback in tuple(on_song_removed):
        callback(conn, workspace_id, song_id)


__all__ = ["SongRemoved", "on_song_removed", "song_removed"]
