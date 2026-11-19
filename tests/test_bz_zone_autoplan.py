"""Live zones plan from their dayparts (ADR-0444 BZ-0444-08 to -11) and the kiosk closing mode.

A real organisation with one venue open 10:00 to 23:00, a zone with a programme (a calm brunch
block, then an energetic evening block) and a playing zone session. The library is a made-up
set of 30 analysed songs from calm to energetic, all allowed. The database clock starts at
2027-01-15 08:00 UTC, a Friday; London is on GMT.
"""

from __future__ import annotations

from dataclasses import dataclass

import pytest
import sqlalchemy as sa

from selecta import flags
from selecta.business import dayparts, orgs, venues, zone_autoplan, zone_clock, zones
from selecta.business.content.engine import SongFacts
from selecta.business.hours_schema import (
    venue_closing_modes,
    venue_hours,
    zone_plan_states,
    zone_programme_versions,
    zone_programmes,
)
from selecta.identity.schema import users
from selecta.persistence import transaction
from selecta.playback.schema import playback_sessions
from selecta.playback.store import load_session
from selecta.storage.keys import original_key
from selecta.storage.schema import assets

OWNER = "user-owner"
BRUNCH = {"start": "10:00", "name": "Brunch calm", "energy": 20}
EVENING = {"start": "18:00", "name": "Evening energy", "energy": 85}
SONGS = [SongFacts(song_id=f"song-{i:02d}", title=f"Song {i}", artist="Band", energy=i / 29,
                   length_s=200.0) for i in range(30)]


@dataclass
class Library:
    songs: list

    def all(self, _conn, _workspace_id):
        return list(self.songs)

    def local_id(self, _conn, _workspace_id, song_id):
        return int(song_id.split("-")[1]) + 1


@pytest.fixture(autouse=True)
def flags_on():
    flags.use("+business.orgs,+business.schedules")
    yield
    flags.use(None)


@pytest.fixture
def world(sqlite_engine, clock):
    with transaction(sqlite_engine) as conn:
        conn.execute(users.insert().values(
            id=OWNER, auth_subject="auth|owner", email="owner@example.test",
            email_verified=True, timezone="UTC", age_confirmed=True, created_at=0.0))
        org = orgs.create(conn, owner_user_id=OWNER, name="The Crown Group", now=1)["id"]
    with transaction(sqlite_engine, org) as conn:
        venue = venues.create(conn, org, name="Camden", timezone="Europe/London",
                              country="GB", now=1)["id"]
        zone = zones.create(conn, org, venue, name="Bar", now=1)["id"]
        for day in range(7):
            conn.execute(venue_hours.insert().values(
                id=f"h-{day}", workspace_id=org, venue_id=venue, weekday=day,
                opens="10:00", closes="23:00", all_day=False))
        programme = dayparts.Programme.from_dict({"weekly": {"4": [BRUNCH, EVENING]}})
        conn.execute(zone_programme_versions.insert().values(
            id="v1", workspace_id=org, zone_id=zone, blocks_json=programme.to_dict(),
            created_by=OWNER, created_at=1))
        conn.execute(zone_programmes.insert().values(
            zone_id=zone, workspace_id=org, venue_id=venue, current_version_id="v1",
            updated_at=1))
        conn.execute(playback_sessions.insert().values(
            id="s1", workspace_id=org, zone_id=zone, state="playing", song_index=0,
            offset_ms=0, seq=0, fence=0, updated_at=1))
        for song in SONGS:
            number = int(song.song_id.split("-")[1])
            conn.execute(assets.insert().values(
                id=song.song_id, workspace_id=org, original_key=original_key(org, song.song_id),
                size=1000, sha256=f"{number:064d}", format="mp3", created_at=1))
    return {"org": org, "venue": venue, "zone": zone}


def _ref(world, mode="natural"):
    return zone_clock.ZoneRef(workspace_id=world["org"], venue_id=world["venue"],
                              zone_id=world["zone"], tz="Europe/London", closing_mode=mode)


def _plan(sqlite_engine, world, clock):
    with transaction(sqlite_engine, world["org"]) as conn:
        done = zone_autoplan.plan_zone(conn, _ref(world), clock.time(),
                                       songs_source=Library(SONGS), allow=lambda s, _at: s)
        session = load_session(conn, world["org"], world["zone"])
        state = conn.execute(sa.select(zone_plan_states)).mappings().first()
    return done, session, state


def test_a_closed_zone_is_not_planned(sqlite_engine, world, clock):
    done, session, _ = _plan(sqlite_engine, world, clock)
    assert done["skipped"] == "closed"
    assert not session.programme


def test_an_open_zone_plans_four_hours_from_its_block_at_the_blocks_energy(
    sqlite_engine, world, clock
):
    clock.advance(2.5 * 3600)  # 10:30, Brunch calm
    done, session, state = _plan(sqlite_engine, world, clock)

    assert done["planned"] >= 4 * 3600 / 200 - 1
    first = session.programme[0].song_id - 1  # local id back to song number
    assert SONGS[first].energy <= 0.3  # calm songs for a calm block
    assert state["plan_json"]["version_id"] == "v1"
    assert state["plan_json"]["block"] == "Brunch calm"
    assert session.seq == 1


def test_energy_ramps_toward_the_next_block_without_a_hard_cut():
    from datetime import UTC, datetime

    programme = dayparts.Programme.from_dict({"weekly": {"4": [BRUNCH, EVENING]}})
    start = datetime(2027, 1, 15, 10, tzinfo=UTC)
    end = datetime(2027, 1, 15, 23, tzinfo=UTC)
    windows = dayparts.block_windows(programme, start, end, start.date(), UTC)
    picks = zone_autoplan.plan_songs(windows, SONGS, datetime(2027, 1, 15, 17, tzinfo=UTC)
                                     .timestamp(), datetime(2027, 1, 15, 19, tzinfo=UTC)
                                     .timestamp())
    targets = [target for _song, target, _block in picks]

    assert targets[0] == pytest.approx(0.2)
    assert targets[-1] == pytest.approx(0.85)
    assert targets == sorted(targets)  # monotone: the lead-in ramps, it never jumps back
    steps = [b - a for a, b in zip(targets, targets[1:], strict=False)]
    assert max(steps) < 0.65  # no single jump from the calm level to the evening level


def test_the_committed_window_is_kept_when_the_programme_changes(sqlite_engine, world, clock):
    clock.advance(2.5 * 3600)
    _done, before, _ = _plan(sqlite_engine, world, clock)
    with transaction(sqlite_engine, world["org"]) as conn:
        louder = dayparts.Programme.from_dict(
            {"weekly": {"4": [{**BRUNCH, "energy": 90}, EVENING]}})
        conn.execute(zone_programme_versions.insert().values(
            id="v2", workspace_id=world["org"], zone_id=world["zone"],
            blocks_json=louder.to_dict(), created_by=OWNER, created_at=2))
        conn.execute(sa.update(zone_programmes).values(current_version_id="v2"))
    done, after, state = _plan(sqlite_engine, world, clock)

    assert done["replanned"] is True
    assert after.programme[:3] == before.programme[:3]  # playing song and the next two
    fourth = after.programme[3].song_id - 1
    assert SONGS[fourth].energy >= 0.7
    assert state["plan_json"]["version_id"] == "v2"


def test_bigger_raises_the_plan_and_decays_over_three_songs(sqlite_engine, world, clock):
    clock.advance(2.5 * 3600)
    _plan(sqlite_engine, world, clock)
    with transaction(sqlite_engine, world["org"]) as conn:
        offset = zone_autoplan.press(conn, world["org"], world["zone"], "bigger", clock.time())
    _done, _session, state = _plan(sqlite_engine, world, clock)
    assert offset == 1.0
    assert state["plan_json"]["offset"] == 1.0
    assert state["plan_json"]["targets"][0] > 0.2

    with transaction(sqlite_engine, world["org"]) as conn:  # three songs play
        conn.execute(sa.update(playback_sessions).values(song_index=3))
    _done, _session, state = _plan(sqlite_engine, world, clock)
    assert state["plan_json"]["offset"] == 0.0
    assert state["steering_json"]["songs_since"] == 3


def test_an_hours_edit_marks_the_zone_for_a_replan(sqlite_engine, world, clock):
    clock.advance(2.5 * 3600)
    _plan(sqlite_engine, world, clock)
    with transaction(sqlite_engine, world["org"]) as conn:
        zone_autoplan.mark_dirty(conn, world["org"], [world["zone"]], clock.time())
        assert conn.execute(sa.select(zone_plan_states.c.dirty)).scalar() is True
    done, _session, state = _plan(sqlite_engine, world, clock)
    assert done["replanned"] is True and state["dirty"] is False


def test_the_maintenance_pass_plans_every_zone(sqlite_engine, world, clock, monkeypatch):
    clock.advance(2.5 * 3600)
    from selecta.business.content import library, service

    monkeypatch.setattr(library.SqlSongFacts, "all", lambda self, conn, ws: list(SONGS))
    monkeypatch.setattr(library.SqlSongFacts, "local_id",
                        lambda self, conn, ws, song_id: int(song_id.split("-")[1]) + 1)
    monkeypatch.setattr(service, "filter_allowed", lambda conn, zone, songs, at, **_k: songs)
    done = zone_autoplan.tick(sqlite_engine)
    assert done["zones"] == 1 and done["failed"] == 0 and done["planned"] > 0


def test_the_closing_mode_reaches_the_zone_clock(sqlite_engine, world, clock):
    with transaction(sqlite_engine, world["org"]) as conn:
        assert zone_clock.default_zone_source(conn)[0].closing_mode == "natural"
        conn.execute(venue_closing_modes.insert().values(
            venue_id=world["venue"], workspace_id=world["org"], closing_mode="exact",
            updated_by=OWNER, updated_at=1))
        ref = zone_clock.default_zone_source(conn)[0]
    assert ref.closing_mode == "exact"
    clock.advance(15 * 3600 - 10)  # 22:59:50
    with transaction(sqlite_engine, world["org"]) as conn:
        state = zone_clock.compute(conn, ref, clock.time())
    assert state.state == "closing"  # exact: the fade ends at 23:00
