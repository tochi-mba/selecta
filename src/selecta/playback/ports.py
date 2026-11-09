"""How playback talks to the rest of Selecta without importing it.

`PlaybackEvents` is how state changes reach every device: it's called inside the same transaction
as the change, so an outbox writer can add its row there and nothing is announced that didn't
happen. `MixControl` carries out the commands that change the mix itself (steering, reordering,
approving a request); the session only records the new revision those return.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any, Protocol

from sqlalchemy.engine import Connection

# Event kinds, as the site's event stream sees them.
STATE = "playback.state"
MOVED = "playback.moved"
COMMAND = "playback.command"
STOPPED = "playback.stopped"
SIGNED_OUT = "device.signed_out"


class PlaybackEvents(Protocol):
    def publish(
        self, conn: Connection, workspace_id: str, kind: str, payload: Mapping[str, Any]
    ) -> None: ...


class NoEvents:
    """Tells nobody. The default until the outbox is wired in."""

    def publish(
        self, conn: Connection, workspace_id: str, kind: str, payload: Mapping[str, Any]
    ) -> None:
        return None


NO_EVENTS = NoEvents()


@dataclass(frozen=True)
class MixChange:
    """What a mix command changed: a new revision, and the song now playing in it if it moved."""

    mix_revision_id: str | None = None
    song_index: int | None = None


class MixControl(Protocol):
    def steer(self, workspace_id: str, direction: str) -> MixChange | None: ...

    def reorder(self, workspace_id: str, args: Mapping[str, Any]) -> MixChange | None: ...

    def approve_request(self, workspace_id: str, request_id: str) -> MixChange | None: ...
