"""Queued work with no worker: the numbers per pool, and one operator alert, never a drop.

To-do T-20261125-2b5e: on staging uploads sat queued with no worker running and nobody heard.
"""

from __future__ import annotations

from types import SimpleNamespace

import pytest
import sqlalchemy as sa

from selecta.admin.schema import platform_alerts
from selecta.persistence import db_now, make_engine, migrate, transaction
from selecta.work import queue_health
from selecta.work.enqueue import JobSpec
from selecta.work.schema import jobs, workers
from selecta.work.store import JobStore


@pytest.fixture
def engine(tmp_path):
    made = make_engine(f"sqlite:///{tmp_path / 'queue.sqlite'}")
    migrate.upgrade(made)
    yield made
    made.dispose()


def queued(engine, job_type: str, waited_s: float) -> str:
    job = JobStore(engine).enqueue(JobSpec("ws1", job_type, input_ref={})).job
    with transaction(engine) as conn:
        conn.execute(jobs.update().where(jobs.c.id == job.id).values(
            queued_at=db_now(conn) - waited_s))
    return job.id


def pool(found: dict, name: str) -> dict:
    return next(item for item in found["pools"] if item["pool"] == name)


def test_the_snapshot_counts_queued_work_its_oldest_wait_and_the_workers_seen(engine):
    queued(engine, "analyse.song", 1200)
    queued(engine, "seam.render", 30)
    retrying = queued(engine, "analyse.song", 10)
    with transaction(engine) as conn:
        now = db_now(conn)
        conn.execute(jobs.update().where(jobs.c.id == retrying).values(
            state="retry_scheduled", not_before=now - 900))
        conn.execute(workers.insert().values(
            id="gone", pool="cpu-light", slots=2, worker_class=0, capabilities={},
            draining=False, registered_at=now - 4000, last_seen_at=now - 3600))
        found = queue_health.snapshot(conn)
    heavy, light = pool(found, "cpu-heavy"), pool(found, "cpu-light")
    assert (heavy["queued"], heavy["retry_scheduled"], heavy["retry_overdue"]) == (2, 1, 1)
    assert heavy["oldest_wait_s"] >= 1200 and heavy["oldest_job_type"] == "analyse.song"
    assert (heavy["workers_seen"], heavy["last_heartbeat_at"], heavy["stuck"]) == (0, None, True)
    assert (light["queued"], light["workers_seen"], light["oldest_wait_s"]) == (0, 0, None)
    assert light["last_heartbeat_age_s"] >= 3600
    assert found["stuck"] is True


def test_a_stuck_pool_raises_one_alert_an_hour_and_nothing_is_dropped(engine):
    job = queued(engine, "analyse.song", 2000)
    queued(engine, "play.proxy", 60)
    assert queue_health.watch(engine) == ["cpu-heavy"]
    assert queue_health.watch(engine) == []
    with engine.connect() as conn:
        rows = conn.execute(sa.select(platform_alerts.c.kind, platform_alerts.c.summary,
                                      platform_alerts.c.metadata)).all()
        state = conn.execute(sa.select(jobs.c.state).where(jobs.c.id == job)).scalar()
    assert [(row.kind, row.metadata["pool"]) for row in rows] == [
        (queue_health.ALERT_KIND, "cpu-heavy")]
    assert "no worker of this pool has ever checked in" in rows[0].summary
    assert state == "queued"
    with engine.connect() as conn:
        later = db_now(conn) + queue_health.ALERT_EVERY_S + 1
    # an hour on, the heavy pool is told again and the light pool's job is now stuck too
    assert queue_health.watch(engine, now=later) == ["cpu-heavy", "cpu-light"]


def test_nothing_alerts_while_work_moves(engine):
    queued(engine, "analyse.song", 60)
    assert queue_health.watch(engine) == []


def test_the_watch_runs_as_a_leader_task():
    from selecta.observability import leader_metrics

    made, _off = leader_metrics.tasks(SimpleNamespace(), {})
    assert "queue_watch" in [task.name for task in made]


def test_the_staff_read_needs_an_admin_session(tmp_path, monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from selecta.identity.tokens import Claims
    from selecta.routes import work_queue

    engine = make_engine(f"sqlite:///{tmp_path / 'route.sqlite'}")
    migrate.upgrade(engine)
    app = FastAPI()
    work_queue.install_routes(app, engine=engine, current_claims=lambda: Claims(
        subject="user_x", issued_at=0, expires_at=4_000_000_000, email="x@example.test",
        email_verified=True))
    answer = TestClient(app).get("/api/admin/work/queue")
    assert answer.status_code == 401
    assert answer.json()["detail"]["code"] == "admin_session_required"
    engine.dispose()
