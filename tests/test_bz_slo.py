"""ADR-0448 BZ-0448-09: business SLO from synthetic heartbeats and play logs, and credits."""

from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

import pytest
import sqlalchemy as sa

from selecta.business import slo
from selecta.business.commercial_audit import audit_rows
from selecta.business.commercial_facts import FixedHours, OrgFacts, VenueFacts
from selecta.business.commercial_schema import (
    COMMERCIAL_TABLES,
    biz_credit_proposals,
    biz_play_log,
    biz_slo_months,
)
from selecta.persistence import make_engine, metadata

LONDON = ZoneInfo("Europe/London")
NOW = datetime(2026, 12, 1, 6, 0, tzinfo=LONDON).timestamp()
ORG = OrgFacts("org1", "ws-org", "Acme", (VenueFacts("v1", "Bar"), VenueFacts("v2", "Cafe")))


@pytest.fixture
def engine(tmp_path):
    engine = make_engine(f"sqlite:///{tmp_path}/t.db")
    metadata.create_all(engine, tables=list(COMMERCIAL_TABLES))
    return engine


def minutes(n: int, start: float = 0.0) -> list[int]:
    return [int(start) + 60 * i for i in range(n)]


def test_minutes_are_classified_from_heartbeats_and_play_logs():
    sched = minutes(6)
    beats = {
        0: slo.Heartbeat(playing=True),
        60: slo.Heartbeat(playing=False),
        120: slo.Heartbeat(playing=True, online=False),
        180: slo.Heartbeat(playing=False, online=False),
    }
    counts = slo.classify(sched, beats, played={240})
    assert counts == {"playing": 2, "silent": 2, "unknown": 1, "excluded": 1, "scheduled": 6}


def test_power_cut_minutes_are_unknown_not_uptime():
    sched = minutes(10_000)
    beats = {m: slo.Heartbeat(playing=True) for m in sched[:9_000]}
    result = slo.measure("v1", "z1", "2026-11", sched, beats, set(), [])
    assert result.unknown == 1_000 and result.playing == 9_000
    assert result.continuity == 1.0
    assert result.readiness is None


def test_continuity_and_readiness_against_targets():
    sched = minutes(10_000)
    beats = {m: slo.Heartbeat(playing=i >= 25) for i, m in enumerate(sched)}
    ready = [slo.Transition(needed_at=1000.0 * i, ready_at=1000.0 * i - 61) for i in range(199)]
    late = [slo.Transition(needed_at=5000.0, ready_at=4950.0)]
    result = slo.measure("v1", "z1", "2026-11", sched, beats, set(), ready + late)
    assert result.continuity == pytest.approx(0.9975)
    assert result.readiness == pytest.approx(0.995)
    assert slo.credit_percent(result.continuity, result.readiness) == 10


@pytest.mark.parametrize(
    ("continuity", "percent"),
    [(0.999, 0), (0.9985, 0), (0.998, 10), (0.9975, 10), (0.997, 20), (0.99, 50), (0.5, 50)],
)
def test_credit_is_ten_percent_per_full_tenth_below_target_capped_at_fifty(continuity, percent):
    assert slo.credit_percent(continuity, None) == percent


def test_scheduled_minutes_follow_opening_hours():
    venue = VenueFacts("v1", "Bar")
    hours = FixedHours(daily={"v1": ("09:00", "17:00")})
    start, end = slo.month_bounds("Europe/London", "2026-11")
    sched = slo.scheduled_minutes(hours, None, venue, start, end)
    assert len(sched) == 30 * 8 * 60
    assert slo.scheduled_minutes(FixedHours(), None, venue, start, end) == []


def test_play_log_rows_become_played_minutes(engine):
    base = datetime(2026, 11, 2, 10, 0, tzinfo=LONDON).timestamp()
    with engine.begin() as conn:
        conn.execute(sa.insert(biz_play_log).values(
            id="p1", workspace_id="ws-org", organisation_id="org1", venue_id="v1",
            zone_id="z1", idempotency_key="k1", title="Song", artist="Artist",
            started_at=base, started_local="2026-11-02T10:00", venue_tz="Europe/London",
            seconds_played=150.0, source="schedule", in_transition=False,
            recorded_at=base, synced_at=base,
        ))
        played = slo.played_minutes(conn, "z1", base - 3600, base + 3600)
    assert played == {int(base), int(base) + 60, int(base) + 120}


def test_months_are_upserted_and_credits_proposed_for_staff_approval(engine):
    sched = minutes(10_000)
    bad = {m: slo.Heartbeat(playing=i >= 30) for i, m in enumerate(sched)}
    good = {m: slo.Heartbeat(playing=True) for m in sched}
    with engine.begin() as conn:
        slo.save_month(conn, ORG, slo.measure("v1", "z1", "2026-11", sched, good, set(), []), NOW)
        slo.save_month(conn, ORG, slo.measure("v1", "z1", "2026-11", sched, bad, set(), []), NOW)
        slo.save_month(conn, ORG, slo.measure("v1", "z2", "2026-11", sched, good, set(), []), NOW)
        slo.save_month(conn, ORG, slo.measure("v2", "z3", "2026-11", sched, good, set(), []), NOW)
        rows = slo.months(conn, "org1", "2026-11")
        assert len(rows) == 3
        z1 = next(r for r in rows if r["zone_id"] == "z1")
        assert z1["silent_minutes"] == 30 and z1["continuity"] == pytest.approx(0.997)

        proposals = slo.propose_credits(conn, ORG, "2026-11", {"v1": 50_000, "v2": 50_000}, NOW)
        assert [(p["venue_id"], p["percent"], p["amount_minor"], p["state"])
                for p in proposals] == [("v1", 20, 10_000, "proposed")]
        again = slo.propose_credits(conn, ORG, "2026-11", {"v1": 50_000}, NOW)
        assert len(again) == 1
        count = conn.execute(sa.select(sa.func.count()).select_from(biz_credit_proposals))
        assert count.scalar() == 1

        decided = slo.approve_credit(conn, ORG, proposals[0]["id"], actor="staff@rex", now=NOW,
                                     stripe_credit_note_id="cn_1")
        assert decided["state"] == "approved" and decided["decided_by"] == "staff@rex"
        with pytest.raises(slo.CreditDecisionError):
            slo.reject_credit(conn, ORG, proposals[0]["id"], actor="staff@rex", now=NOW)
        actions = [r["action"] for r in audit_rows(conn, "org1")]
        assert actions == ["slo.credit_proposed", "slo.credit_approved"]
        assert conn.execute(sa.select(sa.func.count()).select_from(biz_slo_months)).scalar() == 3


def test_rejecting_a_credit_is_audited(engine):
    sched = minutes(1_000)
    bad = {m: slo.Heartbeat(playing=i >= 100) for i, m in enumerate(sched)}
    with engine.begin() as conn:
        slo.save_month(conn, ORG, slo.measure("v1", "z1", "2026-10", sched, bad, set(), []), NOW)
        (proposal,) = slo.propose_credits(conn, ORG, "2026-10", {"v1": 50_000}, NOW)
        assert proposal["percent"] == 50
        rejected = slo.reject_credit(conn, ORG, proposal["id"], actor="staff@rex", now=NOW)
        assert rejected["state"] == "rejected"
        assert audit_rows(conn, "org1", "slo.credit_rejected")
