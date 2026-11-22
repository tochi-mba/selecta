"""Licensing edge cases (ADR-0454 "Licensing", BZ-0454-04) against the real licensing gate,
reminders and play-log export (ADR-0449)."""

from __future__ import annotations

import csv
import io
import tracemalloc
from datetime import UTC, datetime

import pytest
import sqlalchemy as sa

from selecta.business import licensing as lic
from selecta.business import playlog
from selecta.business.commercial_audit import notices
from selecta.business.commercial_facts import MemberFacts, OrgFacts, VenueFacts
from selecta.business.commercial_schema import COMMERCIAL_TABLES, biz_play_log
from selecta.persistence import make_engine, metadata

DAY = 86_400.0
T0 = datetime(2026, 11, 1, 12, tzinfo=UTC).timestamp()
ORG = OrgFacts("org1", "ws1", "Bar Group", (VenueFacts("v1", "Soho"),),
               (MemberFacts("owner1", "owner"), MemberFacts("mgr1", "venue_manager", ("v1",))))


@pytest.fixture()
def conn(tmp_path):
    engine = make_engine(f"sqlite:///{tmp_path}/t.db")
    metadata.create_all(engine, tables=list(COMMERCIAL_TABLES))
    with engine.begin() as connection:
        yield connection


def _record(conn, *, expires: float, now: float = T0) -> None:
    lic.record_licence(conn, ORG, "v1", territory="GB", licence_type="themusiclicence",
                       licence_number="TML-1", holder_name="Bar Group Ltd",
                       starts_at=T0 - 300 * DAY, expires_at=expires, rights_attested=True,
                       actor="owner1", now=now)


def test_unattested_venue_cannot_auto_start(conn):
    decision = lic.can_start_scheduled_playback(conn, "v1", T0, False)
    assert not decision.allowed and decision.reason == "no_attestation"
    _record(conn, expires=T0 + 100 * DAY)
    assert lic.can_start_scheduled_playback(conn, "v1", T0, False).allowed


def test_licence_reminders_at_30_14_and_3_days(conn):
    expires = T0 + 40 * DAY
    _record(conn, expires=expires)
    sent_days = []
    for day in range(40, 0, -1):
        for created in lic.reminders_tick(conn, ORG, expires - day * DAY + 60):
            sent_days.append((day, created["channel"]))
    assert sorted({day for day, _channel in sent_days}) == [3, 14, 30]
    assert sorted(sent_days) == sorted((d, ch) for d in (3, 14, 30) for ch in ("email", "in_app"))
    assert all(n["kind"] == "licence.expiry_reminder" for n in notices(conn, "org1", "licence"))


def test_expired_licence_never_stops_mid_service_and_blocks_the_opening_after_its_grace(conn):
    expires = T0 + DAY
    _record(conn, expires=expires)
    after_grace = expires + (lic.GRACE_DAYS + 1) * DAY
    playing = lic.can_start_scheduled_playback(conn, "v1", after_grace, True)
    assert playing.allowed and playing.reason == "expired_continue_to_close"
    in_grace = lic.can_start_scheduled_playback(conn, "v1", expires + 2 * DAY, False)
    assert in_grace.allowed and in_grace.reason == "grace"
    next_opening = lic.can_start_scheduled_playback(conn, "v1", after_grace, False)
    assert not next_opening.allowed and next_opening.reason == "expired"


def _rows(conn, count: int, start: int = 0) -> None:
    conn.execute(sa.insert(biz_play_log), [{
        "id": f"p{n}", "workspace_id": "ws1", "organisation_id": "org1", "venue_id": "v1",
        "zone_id": "z1", "idempotency_key": f"k{n}", "track_id": f"t{n % 50}",
        "title": f"Song {n % 50}", "artist": "Artist", "album": "Album", "isrc": "GBAAA2600001",
        "label": "Label", "started_at": T0 + n * 30, "started_local": "2026-11-01T12:00",
        "venue_tz": "Europe/London", "seconds_played": 180.5, "source": "schedule",
        "in_transition": False, "device_id": "d1", "device_seq": n, "recorded_at": T0,
        "synced_at": T0} for n in range(start, start + count)])


def test_play_log_export_has_licensing_columns(conn):
    _rows(conn, 5)
    text = playlog.export_csv(conn, ORG, "v1", T0, T0 + DAY, "owner")
    header = next(csv.reader(io.StringIO(text)))
    for column in ("started_at_utc", "started_local", "venue_tz", "title", "artist", "isrc",
                   "label", "seconds_played", "source"):
        assert column in header
    assert "Totals per track" in text
    with pytest.raises(playlog.PlayLogForbidden):
        playlog.export_csv(conn, ORG, "v1", T0, T0 + DAY, "staff")


def _peak_export(conn, end: float) -> tuple[int, int]:
    tracemalloc.start()
    rows = 0
    try:
        for chunk in playlog.iter_export_csv(conn, ORG, "v1", T0, end, "owner", batch=500):
            rows += chunk.count("\r\n")
        _current, peak = tracemalloc.get_traced_memory()
    finally:
        tracemalloc.stop()
    return rows, peak


def test_play_log_export_of_a_month_streams_in_bounded_memory(conn):
    """ADR-0454 ST8 scaled down: 4x the rows must not cost anywhere near 4x the memory. A
    month at one venue is about 16,000 plays; here 6,000 against 24,000."""
    _rows(conn, 6_000)
    small_rows, small_peak = _peak_export(conn, T0 + 6_000 * 30)
    _rows(conn, 18_000, start=6_000)
    big_rows, big_peak = _peak_export(conn, T0 + 24_000 * 30)
    assert big_rows > 3.9 * small_rows
    assert big_peak < 1.5 * small_peak, (small_peak, big_peak)
    assert "".join(playlog.iter_export_csv(conn, ORG, "v1", T0, T0 + DAY, "owner")) == (
        playlog.export_csv(conn, ORG, "v1", T0, T0 + DAY, "owner"))
