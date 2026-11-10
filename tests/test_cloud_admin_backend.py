"""Focused backend evidence for the admin console and emergency controls."""

from __future__ import annotations

from collections.abc import Iterator

import pytest
import sqlalchemy as sa
from sqlalchemy.engine import Connection
from test_cloud_authz_kit import session, staff

from selecta.admin import commands, emergency, freshness, read_models, state
from selecta.admin.schema import admin_metrics, emergency_controls, platform_alerts, worker_controls
from selecta.authz.schema import audit_events
from selecta.persistence import db_now
from selecta.work.schema import workers


@pytest.fixture
def admin_db(cloud_engine, clock) -> Iterator[Connection]:
    """One isolated transaction on every configured Cloud database."""
    with cloud_engine.begin() as conn:
        yield conn


def test_freshness_hides_old_values_and_handles_clock_skew():
    thresholds = freshness.Thresholds(stale_after_s=10, unknown_after_s=20)

    assert freshness.reading(3, 105, 100, thresholds) == freshness.Reading(
        3, 105, 0, freshness.Freshness.FRESH
    )
    assert freshness.reading(3, 90, 100, thresholds).state is freshness.Freshness.FRESH
    assert freshness.reading(3, 89, 100, thresholds).state is freshness.Freshness.STALE
    assert freshness.reading(3, 79, 100, thresholds) == freshness.Reading(
        None, 79, 21, freshness.Freshness.UNKNOWN
    )
    assert freshness.reading(3, None, 100, thresholds) == freshness.Reading(
        None, None, None, freshness.Freshness.UNKNOWN
    )


def test_overview_replaces_metrics_and_marks_missing_measurements_unknown(admin_db):
    now = db_now(admin_db)
    read_models.report(admin_db, "spend.compute_today_usd", 4.5, {"currency": "USD"}, now)
    read_models.report(admin_db, "spend.compute_today_usd", 7.25, {"currency": "USD"}, now)

    rows = admin_db.execute(
        sa.select(admin_metrics).where(admin_metrics.c.name == "spend.compute_today_usd")
    ).mappings().all()
    assert len(rows) == 1
    assert rows[0]["value"] == 7.25

    overview = read_models.overview(admin_db)
    measured = next(
        metric
        for metric in overview["metrics"]
        if metric["name"] == "spend.compute_today_usd" and metric["labels"]
    )
    missing = next(
        metric
        for metric in overview["metrics"]
        if metric["name"] == "health.stripe_webhooks"
    )
    assert measured["state"] == "fresh" and measured["value"] == 7.25
    assert missing == {
        "name": "health.stripe_webhooks",
        "labels": {},
        "value": None,
        "as_of": None,
        "age_s": None,
        "state": "unknown",
    }


def test_worker_command_uses_a_hold_and_audits_the_change(admin_db):
    actor = session(admin_db, staff(admin_db))
    now = db_now(admin_db)
    admin_db.execute(
        workers.insert().values(
            id="worker-1",
            pool="analysis",
            slots=2,
            worker_class=0,
            capabilities={},
            draining=False,
            registered_at=now,
            last_seen_at=now,
        )
    )

    answer = commands.hold_worker(
        admin_db, actor, "worker-1", "drain", reason="Investigating bad output"
    )
    assert answer == {"worker_id": "worker-1", "hold": "drain", "preempted": []}
    assert admin_db.execute(
        sa.select(worker_controls.c.hold).where(worker_controls.c.worker_id == "worker-1")
    ).scalar_one() == "drain"
    assert admin_db.execute(
        sa.select(workers.c.draining).where(workers.c.id == "worker-1")
    ).scalar_one() is True
    event = admin_db.execute(
        sa.select(audit_events).where(audit_events.c.action == "admin.worker.drain")
    ).mappings().one()
    assert event["actor_id"] == actor.user_id
    assert event["reason"] == "Investigating bad output"

    assert commands.resume_worker(
        admin_db, actor, "worker-1", reason="Output verified"
    ) == {"worker_id": "worker-1", "hold": None}
    assert admin_db.execute(sa.select(worker_controls)).first() is None


def test_emergency_control_engages_once_and_changes_runtime_state(admin_db):
    actor = session(admin_db, staff(admin_db))

    engaged = emergency.engage(
        admin_db, actor, state.Control.UPLOADS, None, reason="Storage incident"
    )
    repeated = emergency.engage(
        admin_db, actor, state.Control.UPLOADS, None, reason="Duplicate request"
    )

    assert engaged == repeated
    assert state.load(admin_db).uploads_paused
    control_count = admin_db.execute(
        sa.select(sa.func.count()).select_from(emergency_controls)
    ).scalar_one()
    assert control_count == 1
    assert admin_db.execute(
        sa.select(sa.func.count()).select_from(audit_events).where(
            audit_events.c.action == "platform.emergency_control.engage"
        )
    ).scalar_one() == 1
    alert = admin_db.execute(sa.select(platform_alerts)).mappings().one()
    assert alert["kind"] == "platform.emergency_control"
    assert alert["metadata"] == {"control": "uploads.paused", "target": "*"}

    listed = next(
        item for item in emergency.listing(admin_db) if item["control"] == "uploads.paused"
    )
    assert listed["targets"] == ["*"]
    assert listed["states"][0]["engaged"] is True


@pytest.mark.parametrize(
    ("control", "target", "message"),
    [
        ("made.up", None, "no emergency control"),
        ("uploads.paused", "analysis", "can't target"),
        ("admission.paused", "made-up", "can't target"),
    ],
)
def test_emergency_control_rejects_unknown_controls_and_targets(
    admin_db, control, target, message
):
    with pytest.raises(ValueError, match=message):
        emergency.checked(admin_db, control, target)
