"""ADR-0449 BZ-0449-05/06: append-only play log, offline sync, retention and CSV export."""

from __future__ import annotations

import csv
import io
import random
from datetime import UTC, datetime

import pytest
import sqlalchemy as sa

from selecta.business import isrc as isrc_mod
from selecta.business import playlog
from selecta.business.commercial_facts import MemberFacts, OrgFacts, VenueFacts
from selecta.business.commercial_schema import COMMERCIAL_TABLES, biz_play_log
from selecta.persistence import make_engine, metadata

DAY = 86400.0
T0 = datetime(2026, 7, 1, 19, 0, tzinfo=UTC).timestamp()

ORG = OrgFacts(
    organisation_id="org1",
    workspace_id="ws1",
    name="Bar Group",
    venues=(VenueFacts("v1", "Soho", time_zone="Europe/London"),
            VenueFacts("v2", "Brooklyn", time_zone="America/New_York")),
    members=(MemberFacts("owner1", "owner"), MemberFacts("mgr1", "venue_manager", ("v1",))),
)


@pytest.fixture()
def conn(tmp_path):
    engine = make_engine(f"sqlite:///{tmp_path}/t.db")
    metadata.create_all(engine, tables=list(COMMERCIAL_TABLES))
    with engine.begin() as connection:
        yield connection


def _entry(n, **kw):
    e = {
        "idempotency_key": f"k{n}", "zone_id": "z1", "track_id": f"t{n % 3}",
        "title": f"Song {n % 3}", "artist": "Artist", "album": "Album", "isrc": None,
        "label": "Label", "started_at": T0 + n * 200, "seconds_played": 180.5,
        "source": "schedule", "in_transition": False, "device_id": "d1", "device_seq": n,
    }
    e.update(kw)
    return e


def _all(conn):
    return [dict(r) for r in conn.execute(
        sa.select(biz_play_log).order_by(biz_play_log.c.started_at)).mappings()]


def test_append_stores_every_field_with_local_time(conn):
    result = playlog.append(conn, ORG, "v1", [_entry(1, isrc="gb-abc-26-00001",
                                                     in_transition=True)], now=T0 + 999)
    assert result.inserted == 1
    row = _all(conn)[0]
    assert row["isrc"] == "GBABC2600001"
    assert row["started_local"] == "2026-07-01T20:03:20+01:00"
    assert row["venue_tz"] == "Europe/London"
    assert row["in_transition"] is True and row["source"] == "schedule"
    assert row["seconds_played"] == 180.5 and row["zone_id"] == "z1"
    assert row["device_id"] == "d1" and row["device_seq"] == 1 and row["synced_at"] == T0 + 999


def test_guest_identity_never_stored(conn):
    result = playlog.append(conn, ORG, "v1", [_entry(
        1, source="request", guest_name="Alice", guest_email="a@example.com", requester_id="g1",
    )], now=T0)
    assert {"guest_name", "guest_email", "requester_id"} <= result.dropped_fields
    row = _all(conn)[0]
    assert row["source"] == "request"
    assert "Alice" not in str(row) and "a@example.com" not in str(row)


def test_bad_source_refused(conn):
    with pytest.raises(playlog.PlayLogError):
        playlog.append(conn, ORG, "v1", [_entry(1, source="guest")], now=T0)


def test_duplicates_dropped(conn):
    playlog.append(conn, ORG, "v1", [_entry(1), _entry(2)], now=T0)
    again = playlog.append(conn, ORG, "v1", [_entry(2), _entry(3)], now=T0)
    assert (again.inserted, again.duplicates) == (1, 1)
    assert len(_all(conn)) == 3


def test_offline_six_hours_sync_in_order(conn):
    # A kiosk offline for 6 hours: 108 plays of 200 s, delivered shuffled and partly twice.
    entries = [_entry(n) for n in range(108)]
    assert entries[-1]["started_at"] - entries[0]["started_at"] < 6 * 3600
    delivered = entries + entries[:20]
    random.Random(7).shuffle(delivered)
    result = playlog.sync_batch(conn, ORG, "v1", delivered, now=T0 + 7 * 3600)
    assert (result.inserted, result.duplicates) == (108, 20)
    stored = conn.execute(
        # SQLite rowid is insertion order (ids from new_id are not ordered within a millisecond).
        sa.select(biz_play_log.c.device_seq).order_by(sa.literal_column("rowid"))
    ).scalars().all()
    assert stored == list(range(108))


def test_deleted_track_keeps_copied_metadata(conn):
    playlog.append(conn, ORG, "v1", [_entry(1, track_id="gone", title="Kept Title")], now=T0)
    # There is no track table here at all: the row stands on its copied metadata.
    out = playlog.export_csv(conn, ORG, "v1", T0, T0 + DAY, "owner")
    assert "Kept Title" in out


def test_retention_default_and_purge(conn):
    assert playlog.retention_days(conn, "org1") == 1095
    now = T0 + 1100 * DAY
    playlog.append(conn, ORG, "v1", [_entry(1), _entry(2, started_at=now - 10 * DAY)], now=now)
    assert playlog.purge_expired(conn, "org1", now) == 1
    assert [r["idempotency_key"] for r in _all(conn)] == ["k2"]
    playlog.set_retention_days(conn, ORG, 5, actor="owner1", now=now)
    assert playlog.retention_days(conn, "org1") == 5
    assert playlog.purge_expired(conn, "org1", now) == 1
    with pytest.raises(playlog.PlayLogError):
        playlog.set_retention_days(conn, ORG, 0, actor="owner1", now=now)


def _parse(text):
    lines = list(csv.reader(io.StringIO(text)))
    split = lines.index(["Totals per track"])
    return lines[0], lines[1:split - 1], lines[split + 1], lines[split + 2:]


def test_export_matches_log_with_totals(conn):
    entries = [_entry(n, seconds_played=100.25 + n) for n in range(6)]
    entries.append(_entry(99, venue_ignored=True, started_at=T0 + 2 * DAY))
    playlog.append(conn, ORG, "v1", entries, now=T0)
    playlog.append(conn, ORG, "v2", [_entry(50)], now=T0)
    header, plays, totals_header, totals = _parse(
        playlog.export_csv(conn, ORG, "v1", T0, T0 + DAY, "owner"))
    assert tuple(header) == playlog.ROW_HEADER
    assert len(plays) == 6
    assert [p[9] for p in plays] == [f"{100.25 + n:.3f}" for n in range(6)]
    assert plays[0][0] == "2026-07-01T19:00:00Z"
    assert tuple(totals_header) == playlog.TOTALS_HEADER
    by_title = {t[0]: t for t in totals}
    assert int(by_title["Song 0"][5]) == 2
    assert by_title["Song 0"][6] == f"{100.25 + 103.25:.3f}"
    assert sum(int(t[5]) for t in totals) == len(plays)


def test_export_applies_isrc_correction_and_keeps_original(conn):
    playlog.append(conn, ORG, "v1", [_entry(0, isrc="GBAAA2600001")], now=T0)
    isrc_mod.set_manual(conn, workspace_id="ws1", organisation_id="org1", track_id="t0",
                        isrc="GB-BBB-26-00002", actor="owner1", now=T0 + 1,
                        logged_isrc="GBAAA2600001")
    _, plays, _, totals = _parse(playlog.export_csv(conn, ORG, "v1", T0, T0 + DAY, "owner"))
    assert plays[0][7] == "GBBBB2600002" and totals[0][3] == "GBBBB2600002"
    assert _all(conn)[0]["isrc"] == "GBAAA2600001"
    history = isrc_mod.edit_history(conn, "ws1", "t0")
    assert history[0]["old_isrc"] == "GBAAA2600001"


def test_export_roles(conn):
    playlog.append(conn, ORG, "v1", [_entry(1)], now=T0)
    for role in ("owner", "admin"):
        assert playlog.export_csv(conn, ORG, "v1", T0, T0 + DAY, role)
    assert playlog.export_csv(conn, ORG, "v1", T0, T0 + DAY, "venue_manager", venue_ids=["v1"])
    with pytest.raises(playlog.PlayLogForbidden):
        playlog.export_csv(conn, ORG, "v2", T0, T0 + DAY, "venue_manager", venue_ids=["v1"])
    for role in ("staff", "kiosk", "guest"):
        with pytest.raises(playlog.PlayLogForbidden):
            playlog.export_csv(conn, ORG, "v1", T0, T0 + DAY, role)


def test_export_is_csv_injection_safe(conn):
    playlog.append(conn, ORG, "v1", [_entry(1, title="=HYPERLINK(\"x\")", artist="+1",
                                            album="-x", label="@SUM(A1)")], now=T0)
    _, plays, _, totals = _parse(playlog.export_csv(conn, ORG, "v1", T0, T0 + DAY, "owner"))
    assert plays[0][4].startswith("'=") and plays[0][5] == "'+1"
    assert plays[0][6] == "'-x" and plays[0][8] == "'@SUM(A1)"
    assert totals[0][0].startswith("'=")
    assert playlog.safe_cell("plain") == "plain"
