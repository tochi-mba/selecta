"""What the host's account has switched on, as their guests see it (ADR-0488).

A guest has no account, so a room offers them a feature only while its flag is on for the
host: the host's plan, staff rules and opt-outs, as `flags.cloud_gate` decides it for the host's
own site. That decision used to be made once per flag on every guest read, two transactions
each. With a handful more features and a room full of phones reading every few seconds, that
is most of the room's database work.

Here every flag a guest page can see is decided together, in one transaction, and remembered
per workspace for five seconds. Five seconds is the bound the flag kill switch already promises
(ADR-0414), so a feature switched off still leaves every guest's phone within that time.

A feature is offered when its flag is on for the host and the host has it on in the room's
settings: `offered` puts the two together.
"""

from __future__ import annotations

import threading
import time
from collections.abc import Callable, Mapping
from types import SimpleNamespace

import sqlalchemy as sa
from sqlalchemy.engine import Engine

from selecta import flags
from selecta.flags import cloud_gate
from selecta.flags.rules import RulesCache
from selecta.identity.accounts import get_user
from selecta.identity.schema import workspaces
from selecta.persistence import transaction
from selecta.rooms.settings import RoomSettings

# The room setting that goes with each feature's flag.
SOCIAL = {
    "keeps": "rooms.keeps",
    "reactions": "rooms.reactions",
    "rounds": "rooms.rounds",
    "dedications": "rooms.dedications",
    "recap": "rooms.recap",
}
GUEST_FLAGS = ("rooms.votes", "rooms.nickname_confirm", "rooms.display", *SOCIAL.values())
# What a paired screen adds, and the feature each belongs to.
SCREEN = {
    "rounds": "screen_rounds",
    "reactions": "screen_reactions",
    "dedications": "screen_dedications",
    "recap": "screen_recap",
}
REMEMBER_SECONDS = 5.0
MAX_REMEMBERED = 5000


class HostFeatures:
    def __init__(
        self,
        engine_of: Callable[[], Engine],
        rules: RulesCache | None,
        *,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.engine_of = engine_of
        self.rules = rules
        self.clock = clock
        self._lock = threading.Lock()
        self._known: dict[str, tuple[float, Mapping[str, bool]]] = {}

    def of(self, workspace_id: str, *, fresh: bool = False) -> Mapping[str, bool]:
        """Every guest-facing flag for this host: flag id to on or off.

        `fresh` decides again now. A guest's own view and every write ask fresh, so a host who
        loses a feature loses it for their guests at once, as before; only the pulse, read by
        every phone every couple of seconds, uses what was decided in the last five."""
        now = self.clock()
        with self._lock:
            known = self._known.get(workspace_id)
            if not fresh and known is not None and known[0] > now:
                return known[1]
        decided = self._decide(workspace_id)
        with self._lock:
            if len(self._known) >= MAX_REMEMBERED:
                for stale in [key for key, value in self._known.items() if value[0] <= now]:
                    del self._known[stale]
                while len(self._known) >= MAX_REMEMBERED:
                    del self._known[next(iter(self._known))]
            self._known[workspace_id] = (now + REMEMBER_SECONDS, decided)
        return decided

    def on(self, workspace_id: str, flag_id: str, *, fresh: bool = False) -> bool:
        return bool(self.of(workspace_id, fresh=fresh).get(flag_id, False))

    def forget(self, workspace_id: str | None = None) -> None:
        with self._lock:
            if workspace_id is None:
                self._known.clear()
            else:
                self._known.pop(workspace_id, None)

    def _decide(self, workspace_id: str) -> Mapping[str, bool]:
        if self.rules is None:
            return {flag_id: flags.on(flag_id) for flag_id in GUEST_FLAGS}
        with transaction(self.engine_of(), workspace_id) as conn:
            owner = conn.execute(
                sa.select(workspaces.c.owner_user_id).where(workspaces.c.id == workspace_id)
            ).scalar()
            user = get_user(conn, owner) if owner else None
            if user is None:
                return dict.fromkeys(GUEST_FLAGS, False)
            host = SimpleNamespace(
                workspace=SimpleNamespace(id=workspace_id), user=user, staff_roles=frozenset()
            )
            return {
                flag_id: bool(cloud_gate.decide(conn, host, flag_id, self.rules).on)
                for flag_id in GUEST_FLAGS
            }


def offered(settings: RoomSettings, decided: Mapping[str, bool]) -> dict[str, bool]:
    """Which of the five the room offers now: the host's flag and the room's own setting."""
    return {
        name: bool(decided.get(flag_id, False)) and bool(getattr(settings, name))
        for name, flag_id in SOCIAL.items()
    }


def on_screen(settings: RoomSettings, features: Mapping[str, bool]) -> dict[str, bool]:
    """Which of them a paired big screen joins in with."""
    return {
        name: bool(features.get(name, False)) and bool(getattr(settings, setting))
        for name, setting in SCREEN.items()
    }


__all__ = ["GUEST_FLAGS", "SCREEN", "SOCIAL", "HostFeatures", "offered", "on_screen"]
