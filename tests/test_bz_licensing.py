"""ADR-0449 BZ-0449-01/02/03: licence attestation, the playback gate and reminders."""

from __future__ import annotations

from datetime import UTC, datetime

import pytest

from selecta.business import licensing as lic
from selecta.business.commercial_audit import audit_rows, notices
from selecta.business.commercial_facts import MemberFacts, OrgFacts, VenueFacts
from selecta.business.commercial_schema import COMMERCIAL_TABLES
from selecta.persistence import make_engine, metadata

DAY = 86400.0
T0 = datetime(2026, 11, 1, 12, 0, tzinfo=UTC).timestamp()

ORG = OrgFacts(
    organisation_id="org1",
    workspace_id="ws1",
    name="Bar Group",
    venues=(VenueFacts("v1", "Soho"), VenueFacts("v2", "Shoreditch")),
    members=(
        MemberFacts("owner1", "owner"),
        MemberFacts("admin1", "admin"),
        MemberFacts("mgr1", "venue_manager", ("v1",)),
        MemberFacts("mgr2", "venue_manager", ("v2",)),
        MemberFacts("staff1", "staff", ("v1",)),
    ),
)


@pytest.fixture()
def conn(tmp_path):
    engine = make_engine(f"sqlite:///{tmp_path}/t.db")
    metadata.create_all(engine, tables=list(COMMERCIAL_TABLES))
    with engine.begin() as connection:
        yield connection


def _record(conn, venue_id="v1", *, expires=T0 + 60 * DAY, number="TML-1", now=T0, **kw):
    args = {
        "territory": "GB", "licence_type": "themusiclicence", "licence_number": number,
        "holder_name": "Bar Group Ltd", "starts_at": T0 - 300 * DAY, "expires_at": expires,
        "rights_attested": True, "actor": "owner1", "now": now,
    }
    args.update(kw)
    return lic.record_licence(conn, ORG, venue_id, **args)


# BZ-0449-01 --------------------------------------------------------------------------------


def test_territory_lists_and_other():
    gb = [t["id"] for t in lic.licence_types("GB")]
    assert gb[:3] == ["themusiclicence", "ppl_produb", "prs_produb"]
    assert {"ascap", "bmi", "sesac", "gmr"} <= {t["id"] for t in lic.licence_types("US")}
    for code, ids in {"DE": {"gema", "gvl"}, "FR": {"sacem", "spre"}, "IE": {"imro", "ppi"},
                      "NL": {"buma", "sena"}, "ES": {"sgae", "agedi"}}.items():
        assert ids <= {t["id"] for t in lic.licence_types(code)}
    assert lic.licence_types("JP")[-1]["id"] == lic.OTHER


def test_record_versions_supersede_and_audit(conn):
    first = _record(conn)
    second = _record(conn, expires=T0 + 400 * DAY, now=T0 + 1)
    history = lic.licence_history(conn, "v1")
    assert [h["version"] for h in history] == [1, 2]
    assert history[0]["superseded_at"] == T0 + 1
    assert history[1]["superseded_at"] is None
    assert lic.current_licence(conn, "v1")["id"] == second["id"]
    assert first["society"] == "PPL PRS"
    rows = audit_rows(conn, "org1", "licence.recorded")
    assert len(rows) == 2 and rows[1]["detail"]["superseded"] == first["id"]


def test_rights_attestation_required(conn):
    with pytest.raises(lic.LicensingError) as err:
        _record(conn, rights_attested=False)
    assert err.value.code == "rights_attestation_required"
    assert lic.current_licence(conn, "v1") is None


def test_other_needs_society_and_review(conn):
    with pytest.raises(lic.LicensingError):
        _record(conn, territory="JP", licence_type="other")
    row = _record(conn, territory="JP", licence_type="other", society="JASRAC")
    assert row["needs_review"] and "other_society" in row["review_reason"]
    with pytest.raises(lic.LicensingError):
        _record(conn, territory="GB", licence_type="ascap")


def test_shared_licence_number_flagged(conn):
    a = _record(conn, "v1", number="SHARED-9")
    assert not a["needs_review"]
    b = _record(conn, "v2", number="SHARED-9")
    assert b["needs_review"] and "shared_licence_number" in b["review_reason"]
    assert lic.current_licence(conn, "v1")["needs_review"]


def test_bad_dates_and_unknown_venue(conn):
    with pytest.raises(lic.LicensingError):
        _record(conn, expires=T0 - 400 * DAY)
    with pytest.raises(lic.LicensingError):
        _record(conn, "nope")


# BZ-0449-02 --------------------------------------------------------------------------------


def test_gate_time_travel(conn):
    assert lic.can_start_scheduled_playback(conn, "v1", T0, False).reason == "no_attestation"
    assert not lic.can_start_scheduled_playback(conn, "v1", T0, False).allowed
    expires = T0 + 10 * DAY
    _record(conn, expires=expires)
    assert lic.can_start_scheduled_playback(conn, "v1", T0, False).reason == "valid"
    grace = lic.can_start_scheduled_playback(conn, ORG.venue("v1"), expires + 13 * DAY, False)
    assert grace.allowed and grace.reason == "grace"
    late = expires + 15 * DAY
    refused = lic.can_start_scheduled_playback(conn, "v1", late, False)
    assert not refused.allowed and refused.reason == "expired"
    playing = lic.can_start_scheduled_playback(conn, "v1", late, True)
    assert playing.allowed and playing.reason == "expired_continue_to_close"


def test_expiry_during_service_never_stops(conn):
    expires = T0 + DAY
    _record(conn, expires=expires)
    assert lic.can_start_scheduled_playback(conn, "v1", expires + 60, True).allowed
    assert lic.can_start_scheduled_playback(conn, "v1", expires + 30 * DAY, True).allowed


def test_not_started_refused(conn):
    _record(conn, starts_at=T0 + DAY, expires=T0 + 400 * DAY)
    assert lic.can_start_scheduled_playback(conn, "v1", T0, False).reason == "not_started"


def test_owner_extension_once_and_audited(conn):
    expires = T0 + DAY
    _record(conn, expires=expires)
    with pytest.raises(lic.LicensingForbidden):
        lic.extend_grace_once(conn, ORG, "v1", actor_user_id="admin1", reason="x", now=T0)
    with pytest.raises(lic.LicensingError):
        lic.extend_grace_once(conn, ORG, "v1", actor_user_id="owner1", reason=" ", now=T0)
    ext = lic.extend_grace_once(conn, ORG, "v1", actor_user_id="owner1",
                                reason="Renewal in post", now=expires + 10 * DAY, days=10)
    assert ext["extended_until"] == expires + 24 * DAY
    at = expires + 20 * DAY
    decision = lic.can_start_scheduled_playback(conn, "v1", at, False)
    assert decision.allowed and decision.reason == "extended_grace"
    assert not lic.can_start_scheduled_playback(conn, "v1", expires + 25 * DAY, False).allowed
    with pytest.raises(lic.LicensingError) as err:
        lic.extend_grace_once(conn, ORG, "v1", actor_user_id="owner1", reason="again", now=at)
    assert err.value.code == "extension_used"
    assert len(audit_rows(conn, "org1", "licence.grace_extended")) == 1


def test_renewal_restores_gate(conn):
    expires = T0 + DAY
    _record(conn, expires=expires)
    late = expires + 20 * DAY
    assert not lic.can_start_scheduled_playback(conn, "v1", late, False).allowed
    _record(conn, expires=late + 365 * DAY, now=late)
    assert lic.can_start_scheduled_playback(conn, "v1", late, False).reason == "valid"


# BZ-0449-03 --------------------------------------------------------------------------------


def _kinds(conn):
    return [(n["kind"], n["cycle_key"], n["channel"]) for n in notices(conn, "org1", "licence")]


def test_reminders_30_14_3_and_daily_grace(conn):
    expires = T0 + 40 * DAY
    _record(conn, expires=expires)
    assert lic.reminders_tick(conn, ORG, T0) == []
    for days in (30, 14, 3):
        created = lic.reminders_tick(conn, ORG, expires - days * DAY + 60)
        assert {c["channel"] for c in created} == {"email", "in_app"}
        assert all(f":d{days}" in c["cycle_key"] for c in created)
        # A second tick in the same window sends nothing.
        assert lic.reminders_tick(conn, ORG, expires - days * DAY + 120) == []
    grace_days = set()
    for day in range(14):
        created = lic.reminders_tick(conn, ORG, expires + day * DAY + 3600)
        assert len(created) == 2
        grace_days.add(created[0]["cycle_key"])
        assert lic.reminders_tick(conn, ORG, expires + day * DAY + 7200) == []
    assert len(grace_days) == 14
    kinds = [k for k, _, _ in _kinds(conn)]
    assert kinds.count("licence.expiry_reminder") == 6
    assert kinds.count("licence.grace_reminder") == 28


def test_reminder_audience_is_owner_admins_and_that_venues_manager(conn):
    expires = T0 + 2 * DAY
    _record(conn, "v1", expires=expires)
    created = lic.reminders_tick(conn, ORG, T0)
    audience = set(created[0]["audience"])
    assert audience == {"owner1", "admin1", "mgr1"}
    in_app = [n for n in notices(conn, "org1", "licence") if n["channel"] == "in_app"]
    assert in_app and set(in_app[0]["detail"]["device_kinds"]) == set(lic.MANAGER_DEVICE_KINDS)


def test_banners_only_for_managers_on_manager_devices(conn):
    expires = T0 + 5 * DAY
    _record(conn, expires=expires)
    banners = lic.licence_banners(conn, "v1", role="venue_manager", device_kind="manager",
                                  now=T0)
    assert banners and banners[0]["kind"] == "licence_expiring"
    for device in ("kiosk", "customer_display"):
        assert lic.licence_banners(conn, "v1", role="owner", device_kind=device, now=T0) == []
    assert lic.licence_banners(conn, "v1", role="staff", device_kind="manager", now=T0) == []
    assert lic.licence_banners(conn, "v1", role="owner", device_kind="web",
                               now=expires + DAY)[0]["kind"] == "licence_grace"
    assert lic.licence_banners(conn, "v2", role="owner", device_kind="web",
                               now=T0)[0]["kind"] == "licence_missing"


def test_explainer_is_plain_and_not_legal_advice():
    text = str(lic.LICENSING_EXPLAINER)
    assert "TheMusicLicence" in text and "ASCAP" in text and "GEMA" in text
    assert "does not give legal advice" in lic.LICENSING_EXPLAINER["disclaimer"]
    assert "SelectaDJ" in lic.NOT_LEGAL_ADVICE
    for territory in lic.LICENSING_EXPLAINER["territories"]:
        for link in territory["links"]:
            assert link["url"].startswith("https://")
    assert "—" not in text
