"""Venue hours, programme and offline routes (ADR-0444, ADR-0446) on a small app.

The route modules are installed on a bare FastAPI app with a fake signed-in principal and one
zone, so these tests exercise the routes and their tables without the whole cloud app. The
database clock starts at 2027-01-15 08:00 UTC (a Friday; London is on GMT).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime

import pytest
import sqlalchemy as sa
from fastapi import FastAPI
from fastapi.testclient import TestClient

from selecta.business import zone_clock
from selecta.business.hours_schema import zone_commands, zone_programme_versions
from selecta.identity.tokens import Claims
from selecta.persistence import transaction
from selecta.routes import business_hours, business_zones

WORKSPACE = "ws-venue-1"
VENUE = "venue-1"
ZONE = "zone-bar"
REF = zone_clock.ZoneRef(workspace_id=WORKSPACE, venue_id=VENUE, zone_id=ZONE, tz="Europe/London")
EVERY_DAY = [{"weekday": day, "opens": "10:00", "closes": "23:00"} for day in range(7)]


@dataclass
class _Workspace:
    id: str


@dataclass
class _Principal:
    workspace: _Workspace


def _claims() -> Claims:
    return Claims(subject="user-sam", issued_at=0.0, expires_at=9e12)


@pytest.fixture
def role():
    return {"value": "venue_manager"}


@pytest.fixture
def client(sqlite_engine, clock, monkeypatch, role):
    monkeypatch.setattr(zone_clock, "default_zone_source", lambda _conn: [REF])
    app = FastAPI()

    def principal_for(_engine, _claims, _header):
        return _Principal(_Workspace(WORKSPACE))

    business_hours.install_routes(
        app,
        engine=sqlite_engine,
        current_claims=_claims,
        principal_for=principal_for,
        role_for=lambda *_args: role["value"],
    )
    business_zones.install_routes(
        app, engine=sqlite_engine, current_claims=_claims, principal_for=principal_for
    )
    return TestClient(app)


def put_hours(client, periods=EVERY_DAY):
    return client.put(f"/api/business/venues/{VENUE}/hours", json={"periods": periods})


def test_hours_round_trip_in_the_venue_time_zone(client):
    response = put_hours(client)

    assert response.status_code == 200
    body = response.json()
    assert body["time_zone"] == "Europe/London"
    assert len(body["periods"]) == 7
    assert body["periods"][4]["weekday_name"] == "Friday"


def test_overlapping_periods_are_refused_with_both_named(client):
    periods = [
        {"weekday": 4, "opens": "10:00", "closes": "15:00"},
        {"weekday": 4, "opens": "14:00", "closes": "23:00"},
    ]
    response = put_hours(client, periods)

    assert response.status_code == 400
    message = response.json()["detail"]["message"]
    assert "Friday" in message and "10:00" in message and "14:00" in message


def test_staff_cannot_change_hours(client, role):
    role["value"] = "staff"
    assert put_hours(client).status_code == 403


def test_zone_state_reports_warming_next(client):
    put_hours(client)
    state = client.get(f"/api/business/zones/{ZONE}/state").json()

    assert state["state"] == "closed"
    assert state["next_state"] == "warming"
    assert state["next_change"].startswith("2027-01-15T09:15")


def test_stay_open_late_beyond_the_staff_allowance_is_refused(client, clock, role):
    put_hours(client)
    clock.advance(14 * 3600)  # 22:00, open until 23:00
    role["value"] = "staff"

    refused = client.post(
        f"/api/business/venues/{VENUE}/stay-open-late", json={"minutes": 120}
    )
    allowed = client.post(f"/api/business/venues/{VENUE}/stay-open-late", json={"minutes": 60})

    assert refused.status_code == 400
    assert allowed.status_code == 200
    late = datetime.fromisoformat(allowed.json()["until"])
    assert late == datetime(2027, 1, 16, 0, 0, tzinfo=UTC)
    state = client.get(f"/api/business/zones/{ZONE}/state").json()
    assert state["next_state"] == "closing"
    assert state["next_change"].startswith("2027-01-16T00:00")


def test_close_now_can_be_undone_within_five_minutes(client, clock):
    put_hours(client)
    clock.advance(6 * 3600)  # 14:00, open
    closed = client.post(f"/api/business/venues/{VENUE}/close-now")
    assert closed.status_code == 200
    assert closed.json()["fade_seconds"] == 60

    clock.advance(120)
    undo = client.post(f"/api/business/venues/{VENUE}/close-now/{closed.json()['id']}/undo")

    assert undo.status_code == 200
    assert client.get(f"/api/business/zones/{ZONE}/state").json()["state"] == "open"


def test_close_now_undo_after_five_minutes_is_refused(client, clock):
    put_hours(client)
    clock.advance(6 * 3600)
    closed = client.post(f"/api/business/venues/{VENUE}/close-now").json()
    clock.advance(301)

    undo = client.post(f"/api/business/venues/{VENUE}/close-now/{closed['id']}/undo")

    assert undo.status_code == 400


def test_holiday_suggestions_are_never_applied(client):
    put_hours(client)
    found = client.get(
        f"/api/business/venues/{VENUE}/holiday-suggestions",
        params={"country": "GB", "year": 2027},
    ).json()["suggestions"]

    assert any(item["date"] == "2027-12-25" for item in found)
    assert client.get(f"/api/business/venues/{VENUE}/hours").json()["exceptions"] == []


def test_a_closed_day_exception_moves_the_next_opening(client):
    put_hours(client)
    added = client.post(
        f"/api/business/venues/{VENUE}/hour-exceptions",
        json={"date": "2027-01-15", "closed": True, "note": "Stocktake"},
    )

    assert added.status_code == 200
    state = client.get(f"/api/business/zones/{ZONE}/state").json()
    assert state["next_change"].startswith("2027-01-16T09:15")


BRUNCH = {"start": "10:00", "name": "Brunch calm", "energy": 30, "mix_language": "seamless"}
EVENING = {"start": "18:00", "name": "Evening energy", "arc": [50, 60, 70, 80, 80]}


def test_each_programme_edit_saves_a_new_immutable_version(client, sqlite_engine):
    first = client.put(
        f"/api/business/zones/{ZONE}/programme", json={"weekly": {"4": [BRUNCH]}}
    ).json()
    second = client.put(
        f"/api/business/zones/{ZONE}/programme", json={"weekly": {"4": [BRUNCH, EVENING]}}
    ).json()

    assert first["version_id"] != second["version_id"]
    current = client.get(f"/api/business/zones/{ZONE}/programme").json()
    assert current["version_id"] == second["version_id"]
    with transaction(sqlite_engine, WORKSPACE) as conn:
        rows = conn.execute(sa.select(zone_programme_versions)).mappings().all()
    stored = {row["id"]: row["blocks_json"] for row in rows}
    assert len(stored[first["version_id"]]["weekly"]["4"]) == 1
    assert len(stored[second["version_id"]]["weekly"]["4"]) == 2


def test_a_programme_with_a_bad_mix_language_is_refused(client):
    bad = {**BRUNCH, "mix_language": "chaos"}
    response = client.put(f"/api/business/zones/{ZONE}/programme", json={"weekly": {"4": [bad]}})
    assert response.status_code == 400


def test_the_offline_manifest_carries_the_schedule_and_block_windows(client):
    put_hours(client)
    client.put(
        f"/api/business/zones/{ZONE}/programme", json={"weekly": {"4": [BRUNCH, EVENING]}}
    )

    manifest = client.get(f"/api/business/zones/{ZONE}/offline-manifest").json()

    schedule = manifest["schedule"]
    assert schedule["time_zone"] == "Europe/London"
    first = schedule["periods"][0]
    assert first["opens_at"] == datetime(2027, 1, 15, 10, tzinfo=UTC).timestamp()
    names = [block["name"] for block in schedule["blocks"]][:2]
    assert names == ["Brunch calm", "Evening energy"]
    assert manifest["state"] == "closed"
    assert manifest["segments"] == []


def test_replayed_commands_never_apply_twice(client, clock, sqlite_engine):
    command = {
        "id": "cmd-1",
        "kind": "volume",
        "issued_at": clock.now - 5,
        "payload": {"level": 40},
        "seq": 1,
        "device_id": "remote-1",
    }
    first = client.post(f"/api/business/zones/{ZONE}/commands", json={"commands": [command]})
    again = client.post(f"/api/business/zones/{ZONE}/commands", json={"commands": [command]})

    assert first.status_code == 200
    assert "cmd-1" in again.json()["duplicates"]
    assert again.json()["applied"] == []
    with transaction(sqlite_engine, WORKSPACE) as conn:
        assert conn.execute(sa.select(sa.func.count()).select_from(zone_commands)).scalar() == 1


def test_a_cache_report_is_kept_per_device(client):
    report = {
        "device_id": "kiosk-1",
        "manifest_version": "v1",
        "seconds_ahead": 3600.0,
        "bytes_held": 10,
        "cap_bytes": 100,
    }
    assert client.put(f"/api/business/zones/{ZONE}/cache-report", json=report).status_code == 200
    report["seconds_ahead"] = 7200.0
    assert client.put(f"/api/business/zones/{ZONE}/cache-report", json=report).status_code == 200
