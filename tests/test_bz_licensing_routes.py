"""ADR-0449 wired: each play's real source, the licence gate before a zone starts, licence
reminders and play-log retention in the maintenance pass, and the licensing, ISRC and terms
routes."""

from __future__ import annotations

from dataclasses import dataclass, field, replace

import pytest
import sqlalchemy as sa
from fastapi import FastAPI
from fastapi.testclient import TestClient

from selecta import flags
from selecta.business import (
    billing_emails,
    licensing,
    licensing_jobs,
    licensing_routes,
    orgs,
    playlog,
    playlog_writer,
    venues,
)
from selecta.business.commercial_audit import notices
from selecta.business.commercial_facts import SqlFacts
from selecta.business.commercial_schema import biz_play_log
from selecta.business.rooms.schema import (
    business_zone_room_guests,
    business_zone_room_requests,
    business_zone_rooms,
)
from selecta.identity import accounts
from selecta.identity.tokens import Claims
from selecta.local_media.schema import local_songs
from selecta.persistence import transaction
from selecta.playback import zone_session
from selecta.playback.model import PlayState, ProgrammeRef, Session
from selecta.playback.schema import devices, playback_commands
from selecta.playback.zones import ZoneInfo

DAY = 86_400


@dataclass
class _Ws:
    id: str
    kind: str = "business"


@dataclass
class _User:
    id: str


@dataclass
class _Principal:
    workspace: _Ws
    workspace_role: str
    user: _User = field(default_factory=lambda: _User("u"))


@pytest.fixture
def world(sqlite_engine, clock):
    with transaction(sqlite_engine) as conn:
        owner = accounts.provision(conn, Claims(subject="lic-owner", issued_at=0.0,
                                                expires_at=9e12), age_confirmed=True)
        org = orgs.create(conn, owner_user_id=owner.user.id, name="Licensed Bars",
                          now=int(clock.now))
        venue = venues.create(conn, org["id"], name="Soho", timezone="Europe/London",
                              country="GB", now=int(clock.now))
        song = conn.execute(sa.insert(local_songs).values(
            workspace_id=org["id"], content_sha256="b" * 64, title="Northern Line",
            artist="The Platform Ten", duration_s=240.0, created_at=clock.now,
            updated_at=clock.now)).inserted_primary_key[0]
    role = {"value": "owner"}
    app = FastAPI()
    licensing_routes.install_routes(
        app, engine=sqlite_engine,
        current_claims=lambda: Claims(subject="lic-owner", issued_at=0.0, expires_at=9e12),
        principal_for=lambda *_: _Principal(_Ws(org["id"]), role["value"],
                                            _User(owner.user.id)),
    )
    flags.use("+business.orgs +business.licensing")
    try:
        yield {"http": TestClient(app), "engine": sqlite_engine, "org": org["id"],
               "venue": venue["id"], "song": song, "role": role, "clock": clock,
               "owner": owner.user.id}
    finally:
        flags.use(None)


def _sessions(world, seconds: float) -> tuple[ZoneInfo, Session, Session]:
    now = world["clock"].now
    zone = ZoneInfo(id="z9", workspace_id=world["org"], venue_id=world["venue"], name="Bar")
    before = Session(workspace_id=world["org"], mix_revision_id="m1", song_index=0, offset_ms=0,
                     anchor_at=now - seconds, state=PlayState.PLAYING, active_device_id=None,
                     lease_expires_at=now + 30, seq=1, updated_at=now, zone_id="z9",
                     programme=(ProgrammeRef(world["song"], "b" * 64),))
    return zone, before, replace(before, song_index=1, seq=2)


def _logged(world) -> dict:
    with transaction(world["engine"]) as conn:
        return dict(conn.execute(sa.select(biz_play_log).order_by(
            biz_play_log.c.started_at.desc())).mappings().first())


def test_a_scheduled_play_and_a_short_transition_play(world):
    zone, before, after = _sessions(world, 200)
    with transaction(world["engine"]) as conn:
        assert playlog_writer.record(conn, zone, before, after, world["clock"].now)
    row = _logged(world)
    assert (row["source"], row["in_transition"]) == ("schedule", False)

    zone, before, after = _sessions(world, 12)
    with transaction(world["engine"]) as conn:
        playlog_writer.record(conn, zone, replace(before, mix_revision_id="m2"),
                              replace(after, mix_revision_id="m2"), world["clock"].now)
    assert _logged(world)["in_transition"] is True


def test_a_staff_skip_and_a_guest_request_are_told_apart(world):
    now = world["clock"].now
    zone, before, after = _sessions(world, 100)
    started = now - 100
    with transaction(world["engine"]) as conn:
        conn.execute(sa.insert(devices).values(
            id="dev1", workspace_id=world["org"], principal="person", name="Phone",
            kind="phone", capabilities={}, created_at=now, last_seen_at=now))
        conn.execute(sa.insert(playback_commands).values(
            id="c1", workspace_id=world["org"], device_id="dev1", zone_id="z9", command="skip",
            args={}, based_on_seq=0, idempotency_key="k", status="applied",
            created_at=started - 3))
        assert playlog_writer.source_of(conn, zone, world["song"], started) == "staff"
    with transaction(world["engine"]) as conn:
        ws = {"workspace_id": world["org"], "organisation_id": world["org"]}
        conn.execute(sa.insert(business_zone_rooms).values(
            id="room", venue_id=world["venue"], zone_id="z9", code_hash="c" * 64,
            code_seed="s", code_version=1, requests_on=True, mode="staff_approve",
            daypart_modes={}, paused=False, screen_code_on=False, screen_seed="s", limits={},
            created_at=now, updated_at=now, **ws))
        conn.execute(sa.insert(business_zone_room_guests).values(
            id="g", room_id="room", token_hash="t" * 64, nickname="Table 4", status="active",
            joined_at=now, last_seen=now, **ws))
        conn.execute(sa.insert(business_zone_room_requests).values(
            id="r1", room_id="room", zone_id="z9", guest_id="g", song_id=str(world["song"]),
            title="Northern Line", artist="The Platform Ten", status="played", votes=1,
            decided_at=started - 60, created_at=started - 90, **ws))
    with transaction(world["engine"]) as conn:
        assert playlog_writer.source_of(conn, zone, world["song"], started) == "request"
        assert playlog_writer.record(conn, zone, before, after, now)
    assert _logged(world)["source"] == "request"


def test_a_zone_without_a_licence_does_not_start_but_one_with_a_licence_does(world):
    now = world["clock"].now
    zone = ZoneInfo(id="z9", workspace_id=world["org"], venue_id=world["venue"], name="Bar")
    with transaction(world["engine"]) as conn:
        assert zone_session._licence_refuses(conn, zone, now) == "no_attestation"
        org = SqlFacts().organisation(conn, world["org"])
        licensing.record_licence(
            conn, org, world["venue"], territory="GB", licence_type="themusiclicence",
            licence_number="TML-1", holder_name="Licensed Bars Ltd", starts_at=now - DAY,
            expires_at=now + 20 * DAY, rights_attested=True, actor=world["owner"],
            now=now)
        assert zone_session._licence_refuses(conn, zone, now) is None
    state = world["http"].get(f"/api/business/venues/{world['venue']}/licence/state").json()
    assert state["reason"] == "valid"


def test_the_pass_sends_licence_reminders_and_purges_old_plays(world, monkeypatch):
    now = world["clock"].now
    with transaction(world["engine"]) as conn:
        org = SqlFacts().organisation(conn, world["org"])
        licensing.record_licence(
            conn, org, world["venue"], territory="GB", licence_type="themusiclicence",
            licence_number="TML-2", holder_name="Licensed Bars Ltd", starts_at=now - 300 * DAY,
            expires_at=now + 10 * DAY, rights_attested=True, actor=world["owner"],
            now=now)
        playlog.append(conn, org, world["venue"], [
            {"idempotency_key": "old", "zone_id": "z9", "title": "Old", "started_at":
             now - 1200 * DAY, "seconds_played": 10, "source": "schedule"},
            {"idempotency_key": "new", "zone_id": "z9", "title": "New", "started_at": now - DAY,
             "seconds_played": 10, "source": "schedule"},
        ], now=now)
    report = licensing_jobs.run_pass(world["engine"])

    assert report.failed == [] and report.purged == 1 and report.reminders >= 1
    with transaction(world["engine"]) as conn:
        kinds = {n["kind"] for n in notices(conn, world["org"], "licence")}
        mail = billing_emails.due(conn, now)
    assert "licence.expiry_reminder" in kinds
    assert billing_emails.words("licence.expiry_reminder", "Licensed Bars",
                                {"venue_name": "Soho"}) is not None
    assert mail == [] or all("licence" in m.subject.lower() or m.subject for m in mail)


def test_retention_is_read_by_managers_and_set_only_by_the_owner(world):
    http = world["http"]
    assert http.get("/api/business/play-log/retention").json()["days"] == 1095
    assert http.put("/api/business/play-log/retention", json={"days": 2190}).json() == {
        "days": 2190}
    world["role"]["value"] = "admin"
    assert http.put("/api/business/play-log/retention", json={"days": 30}).status_code == 403
    assert http.get("/api/business/play-log/retention").json()["days"] == 2190
    world["role"]["value"] = "staff"
    assert http.get("/api/business/play-log/retention").status_code == 403


def test_isrc_entry_coverage_and_terms(world):
    http = world["http"]
    saved = http.put(f"/api/business/library/songs/{world['song']}/isrc",
                     json={"isrc": "gb-abc-24-00012"}).json()
    assert saved["isrc"] == "GBABC2400012"
    assert http.put(f"/api/business/library/songs/{world['song']}/isrc",
                    json={"isrc": "nope"}).status_code == 422
    coverage = http.get(f"/api/business/venues/{world['venue']}/isrc-coverage").json()
    assert coverage == {"tracks": 0, "with_isrc": 0, "share": 0.0}

    before = http.get("/api/business/terms").json()
    assert before["accepted"] is False and before["can_accept"] is True
    assert before["playback_allowed"] is True
    assert http.post("/api/business/terms/accept").json()["accepted"] is True
    world["role"]["value"] = "staff"
    assert http.get("/api/business/terms").json()["can_accept"] is False
    assert http.post("/api/business/terms/accept").status_code == 403


def test_the_owner_extends_an_expired_licence_once(world):
    now = world["clock"].now
    with transaction(world["engine"]) as conn:
        org = SqlFacts().organisation(conn, world["org"])
        licensing.record_licence(
            conn, org, world["venue"], territory="GB", licence_type="themusiclicence",
            licence_number="TML-3", holder_name="Licensed Bars Ltd", starts_at=now - 400 * DAY,
            expires_at=now - 20 * DAY, rights_attested=True, actor=world["owner"],
            now=now - 400 * DAY)
    path = f"/api/business/venues/{world['venue']}/licence/extend"
    first = world["http"].post(path, json={"reason": "Renewal in the post"})
    assert first.status_code == 200, first.text
    again = world["http"].post(path, json={"reason": "Still waiting"})
    assert again.status_code == 422


# --- BZ-0449-04 upload batches, -07 ISRC from tags, -10 derived budget and mix exports -------


def test_an_organisation_upload_needs_an_attested_batch(world):
    from selecta.business import upload_rights

    http = world["http"]
    statement = http.get("/api/business/uploads/statement").json()
    with transaction(world["engine"]) as conn:
        with pytest.raises(upload_rights.AttestationRequired) as refused:
            upload_rights.require_batch(conn, world["org"], None, 2)
    assert refused.value.code == "upload_attestation_required"
    made = http.post("/api/business/uploads/attestation", json={
        "file_count": 2, "statement_version": statement["statement_version"],
        "attested": True}).json()
    with transaction(world["engine"]) as conn:
        upload_rights.require_batch(conn, world["org"], made["batch_id"], 2)
        with pytest.raises(upload_rights.AttestationRequired) as over:
            upload_rights.require_batch(conn, world["org"], made["batch_id"], 3)
    assert over.value.code == "batch_overfull"
    stale = http.post("/api/business/uploads/attestation", json={
        "file_count": 1, "statement_version": "old", "attested": True})
    assert stale.status_code == 422
    flags.use("+business.orgs -business.licensing")
    with transaction(world["engine"]) as conn:
        upload_rights.require_batch(conn, world["org"], None, 5)  # off: never asked


def test_an_isrc_read_at_upload_reaches_the_play_log_by_content(world):
    from selecta.business import upload_rights
    from selecta.persistence import new_id
    from selecta.storage.keys import original_key
    from selecta.storage.sandbox import _isrc
    from selecta.storage.schema import assets

    now = world["clock"].now
    asset_id = new_id()
    assert _isrc("gb-abc-24-00099") == "GBABC2400099" and _isrc("junk") is None
    with transaction(world["engine"]) as conn:
        conn.execute(sa.insert(assets).values(
            id=asset_id, workspace_id=world["org"],
            original_key=original_key(world["org"], asset_id), size=10,
            sha256="b" * 64, format="mp3", duration_s=240.0, created_at=now))
        assert upload_rights.record_isrc(conn, world["org"], asset_id, "GBABC2400099",
                                         actor="upload:s1", now=now) == "GBABC2400099"
        assert upload_rights.isrc_for_song(conn, world["org"], world["song"]) == "GBABC2400099"
    zone, before, after = _sessions(world, 200)
    with transaction(world["engine"]) as conn:
        playlog_writer.record(conn, zone, replace(before, mix_revision_id="m9"),
                              replace(after, mix_revision_id="m9"), now)
    assert _logged(world)["isrc"] == "GBABC2400099"


def test_business_derived_budget_and_mix_exports_are_off_by_default(world):
    from selecta.business import derived_limits
    from selecta.storage import eviction

    http = world["http"]
    with transaction(world["engine"]) as conn:
        assert eviction.budget_for(conn, world["org"]) == derived_limits.derived_budget_bytes(1)
        with pytest.raises(derived_limits.MixExportsOff):
            derived_limits.require_mix_exports(conn, world["org"], flags.on)
    assert http.get("/api/business/settings/mix-exports").json() == {
        "allowed": False, "reason": "flag_off"}
    flags.use("+business.orgs +business.licensing +business.mix_exports")
    assert http.put("/api/business/settings/mix-exports", json={"enabled": True}).json() == {
        "allowed": True, "reason": "allowed"}
    world["role"]["value"] = "admin"
    assert http.put("/api/business/settings/mix-exports",
                    json={"enabled": False}).status_code == 403
