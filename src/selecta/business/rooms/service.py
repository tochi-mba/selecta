"""Rooms for Business in one object (ADR-0451).

    zone_rooms = ZoneRooms(engine, pepper, directory=directory, songs=catalogue_source)

Every dependency is a port with a production default (see `ports`): opening hours from BZ-3,
staff presence from `business_staff_presence`, content rules from ADR-0450's engine, audit and
activity from `selecta.business.access.audit`. The clock is injectable, so tests can walk a
simulated week, freeze the screen code or age guests past the purge.

Staff methods take an open connection and a `BusinessActor` that the route has already checked
with `guard.require`; they still refuse a zone outside the actor's organisation. Guest methods
open their own transactions and take the guest's token.
"""

from __future__ import annotations

import time
from collections.abc import Callable

from sqlalchemy.engine import Connection, Engine

from selecta.business.access.directory import Directory
from selecta.business.rooms import ports, settings
from selecta.business.rooms.core import RoomsCore
from selecta.business.rooms.errors import Refused
from selecta.business.rooms.guests import GuestsMixin
from selecta.business.rooms.moderation import ModerationMixin
from selecta.business.rooms.network import JoinGate
from selecta.business.rooms.requests import RequestsMixin
from selecta.rooms import codes, limits


def default_flag_on(flag_id: str) -> bool:
    from selecta import flags

    try:
        return flags.on(flag_id)
    except KeyError:
        return False  # not registered yet: off


class ZoneRooms(RoomsCore, GuestsMixin, RequestsMixin, ModerationMixin):
    def __init__(
        self,
        engine: Engine,
        pepper: bytes,
        *,
        directory: Directory,
        songs=None,
        hours: ports.ZoneHours | None = None,
        presence: ports.StaffPresence | None = None,
        dayparts: ports.Dayparts | None = None,
        playback: ports.ZonePlayback | None = None,
        content: ports.Content | None = None,
        recorder: ports.Recorder | None = None,
        clock: Callable[[], float] = time.time,
        limiter: limits.Limiter | None = None,
        flag_on: Callable[[str], bool] = default_flag_on,
        plan_guest_max: Callable[[Connection, str], int] | None = None,
    ) -> None:
        self.engine = engine
        self.pepper = codes.check_pepper(pepper)
        self.directory = directory
        self.songs = songs or ports.EmptySongs()
        self.hours = hours or ports.DefaultZoneHours(directory)
        self.presence = presence or ports.SqlStaffPresence()
        self.dayparts = dayparts or ports.NoDayparts()
        self.playback = playback or ports.AlwaysPlaying()
        self.content = content or ports.EngineContent()
        self.recorder = recorder or ports.AccessRecorder()
        self.clock = clock
        self.limiter = limiter or limits.Limiter(clock=clock)
        self.gate = JoinGate(self.limiter)
        self.flag_on = flag_on
        self.plan_guest_max = plan_guest_max or (lambda conn, org: settings.PLAN_GUEST_MAX)

    @staticmethod
    def flag_off(flag_id: str) -> Refused:
        return Refused(404, "flag_off", "That isn't available here.")


__all__ = ["ZoneRooms", "default_flag_on"]
