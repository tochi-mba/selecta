"""Shared fixtures for the Rooms for Business tests (ADR-0451). Holds no tests itself.

The content engine is planted through a checker injected into `ZoneRooms` (the content
service's `check` / `filter_allowed` shape), using the real `SongFacts` and `Decision`: blocked
songs, explicit songs and songs outside the zone's BPM range are refused.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import pytest
import sqlalchemy as sa

from selecta.authz.schema import audit_events
from selecta.business.access import BusinessActor
from selecta.business.access.directory import StaticDirectory, VenueRef, ZoneRef
from selecta.business.content.engine import Decision, SongFacts
from selecta.business.people.schema import business_activity
from selecta.business.rooms.schema import TABLES
from selecta.business.rooms.service import ZoneRooms
from selecta.persistence import make_engine, metadata, transaction

PEPPER = b"business-rooms-test-pepper-0123456789"
ORG, WS = "org-1", "ws-1"
VENUE, BAR, TERRACE = "venue-1", "zone-bar", "zone-terrace"
OTHER_ORG, OTHER_VENUE, OTHER_ZONE = "org-2", "venue-2", "zone-other"
START = datetime(2026, 10, 19, 18, 0, tzinfo=ZoneInfo("Europe/London")).timestamp()  # Monday


class Clock:
    def __init__(self, at: float = START) -> None:
        self.now = at

    def __call__(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds


class WeekHours:
    """Open 17:00 to 02:00 local (over midnight) every day but one closed weekday (Tuesday by
    default). `late_until` keeps it open past the close, like staying open late."""

    def __init__(self, tz: str = "Europe/London", opens: int = 17, closes: int = 2,
                 closed_weekday: int = 1) -> None:
        self.tz = ZoneInfo(tz)
        self.opens, self.closes, self.closed_weekday = opens, closes, closed_weekday
        self.late_until: datetime | None = None

    def _open_local(self, local: datetime) -> bool:
        if local.hour >= self.opens:
            return local.weekday() != self.closed_weekday
        if local.hour < self.closes:
            return (local - timedelta(days=1)).weekday() != self.closed_weekday
        return False

    def is_open(self, conn, zone_id, at: datetime) -> bool:
        if self.late_until is not None and at < self.late_until:
            return True
        return self._open_local(at.astimezone(self.tz))

    def next_open(self, conn, zone_id, at: datetime) -> datetime | None:
        if self.is_open(conn, zone_id, at):
            return at
        local = at.astimezone(self.tz)
        for days in range(0, 8):
            day = (local + timedelta(days=days)).date()
            candidate = datetime(day.year, day.month, day.day, self.opens, tzinfo=self.tz)
            if candidate > local and candidate.weekday() != self.closed_weekday:
                return candidate
        return None


class AlwaysOpen:
    def is_open(self, conn, zone_id, at):
        return True

    def next_open(self, conn, zone_id, at):
        return at


class Songs:
    def __init__(self, songs: list[SongFacts]) -> None:
        self.songs = {s.song_id: s for s in songs}

    def facts(self, conn, workspace_id, song_ids):
        return {i: self.songs[i] for i in song_ids if i in self.songs}

    def search(self, conn, workspace_id, query, limit):
        q = query.lower()
        return [s for s in self.songs.values() if q in s.title.lower()][:limit]


class PlantedContent:
    """Refuses blocked ids, explicit songs and BPM outside `bpm_range`."""

    def __init__(self) -> None:
        self.blocked: set[str] = set()
        self.bpm_range = (60.0, 140.0)
        self.version = 1

    def check(self, conn, zone_id, song, at, *, directory):
        if song.song_id in self.blocked or song.never_play:
            return Decision(False, "blocklist", None, self.version)
        if song.explicit == "explicit":
            return Decision(False, "explicit", None, self.version)
        if song.bpm is not None and not self.bpm_range[0] <= song.bpm <= self.bpm_range[1]:
            return Decision(False, "bpm", None, self.version)
        return Decision(True, None, None, self.version)

    def filter_allowed(self, conn, zone_id, songs, at, *, directory):
        return [s for s in songs if self.check(conn, zone_id, s, at, directory=directory).allowed]


def library() -> list[SongFacts]:
    songs = [SongFacts(song_id=f"s{i}", title=f"Song {i}", artist=f"Artist {i}", bpm=120.0,
                       explicit="clean") for i in range(1, 60)]
    songs += [
        SongFacts(song_id="blocked", title="Song Blocked", artist="X", bpm=120.0),
        SongFacts(song_id="explicit", title="Song Explicit", artist="X", bpm=120.0,
                  explicit="explicit"),
        SongFacts(song_id="fast", title="Song Fast", artist="X", bpm=175.0),
    ]
    return songs


def directory() -> StaticDirectory:
    return StaticDirectory(
        venues=[VenueRef(VENUE, ORG, WS, "The Crown"),
                VenueRef(OTHER_VENUE, OTHER_ORG, "ws-2", "Elsewhere")],
        zones=[ZoneRef(BAR, VENUE, ORG, WS, "Bar"), ZoneRef(TERRACE, VENUE, ORG, WS, "Terrace"),
               ZoneRef(OTHER_ZONE, OTHER_VENUE, OTHER_ORG, "ws-2", "Lounge")],
    )


def manager() -> BusinessActor:
    return BusinessActor(kind="person", id="user-manager", organisation_id=ORG, workspace_id=WS,
                         venue_roles={VENUE: "venue_manager"}, display_name="Maya")


def staff() -> BusinessActor:
    return BusinessActor(kind="person", id="user-staff", organisation_id=ORG, workspace_id=WS,
                         venue_roles={VENUE: "staff"}, display_name="Sam")


def tablet() -> BusinessActor:
    return BusinessActor(kind="device", id="dev-tablet", organisation_id=ORG, workspace_id=WS,
                         device_id="dev-tablet", device_kind="shared_tablet",
                         device_venue_id=VENUE, display_name="Bar tablet")


def kiosk() -> BusinessActor:
    return BusinessActor(kind="device", id="dev-kiosk", organisation_id=ORG, workspace_id=WS,
                         device_id="dev-kiosk", device_kind="kiosk", device_venue_id=VENUE,
                         device_zone_id=BAR, display_name="Bar player")


class Flags:
    def __init__(self, off: set[str] | None = None) -> None:
        self.off = off or set()

    def __call__(self, flag_id: str) -> bool:
        return flag_id not in self.off


@pytest.fixture
def engine(tmp_path):
    built = make_engine(f"sqlite:///{tmp_path / 'rooms.sqlite'}")
    metadata.create_all(built, tables=[*TABLES, business_activity, audit_events])
    yield built
    built.dispose()


@pytest.fixture
def clock():
    return Clock()


@pytest.fixture
def content():
    return PlantedContent()


@pytest.fixture
def make(engine, clock, content):
    def build(**overrides) -> ZoneRooms:
        options = dict(directory=directory(), songs=Songs(library()), hours=AlwaysOpen(),
                       content=content, clock=clock, flag_on=Flags())
        options.update(overrides)
        return ZoneRooms(engine, PEPPER, **options)

    return build


def code_of(svc: ZoneRooms, zone_id: str = BAR) -> str:
    with transaction(svc.engine) as conn:
        row = svc.ensure_room(conn, svc.directory.zone(conn, zone_id))
        return svc.code_of(row)


def seen(svc: ZoneRooms, actor: BusinessActor | None = None, zone_id: str = BAR) -> list:
    with transaction(svc.engine) as conn:
        return svc.queue(conn, actor or staff(), zone_id)


def configure(svc: ZoneRooms, changes: dict, zone_id: str = BAR) -> dict:
    with transaction(svc.engine) as conn:
        return svc.update_settings(conn, manager(), zone_id, changes)


def activity_kinds(engine) -> list[str]:
    with engine.connect() as conn:
        return list(conn.execute(sa.select(business_activity.c.kind)).scalars())


def audit_actions(engine) -> list[str]:
    with engine.connect() as conn:
        return list(conn.execute(sa.select(audit_events.c.action)).scalars())
