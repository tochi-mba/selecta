"""Dangerous actions run on the maintenance leader's tick, and emergency controls reach every
instance at once (ADR-0401 SC-0401-03, ADR-0410 SC-0410-04).

- A due action runs exactly once even with two maintenance contenders on PostgreSQL, and not at
  all before it's due. A leader whose term was replaced runs nothing.
- Engaging read-only on API instance A is enforced on instance B within a second, through
  PostgreSQL NOTIFY, although B's cache would otherwise keep its old view for a minute.
"""

from __future__ import annotations

import dataclasses
import threading
import time

import pytest
import sqlalchemy as sa
from cloud_admin_kit import make_due, make_world
from cloud_helpers import cloud_settings
from fastapi.testclient import TestClient
from test_cloud_authz_kit import session, staff

from selecta.admin import actions, emergency
from selecta.admin import state as emergency_state
from selecta.api_cloud import create_cloud_app
from selecta.authz import delayed
from selecta.authz.schema import audit_events
from selecta.persistence import transaction
from selecta.work.errors import LostLeadership
from selecta.work.maintenance import Leadership, MaintenanceLoop, Schedule
from selecta.work.store import JobStore


def _release_proposed(engine) -> str:
    """An engaged read-only control with its release proposed (and so waiting)."""
    with transaction(engine) as conn:
        owner = staff(conn)
        actor = session(conn, owner)
        emergency.engage(conn, actor, "app.read_only", None, reason="drill")
        return emergency.propose_release(conn, actor, "app.read_only", None,
                                         reason="recovered").id


def _status(engine, action_id: str) -> str:
    with transaction(engine) as conn:
        return delayed.get(conn, action_id).status.value


def _executions(engine, action_id: str) -> int:
    with engine.connect() as conn:
        return conn.execute(sa.select(sa.func.count()).where(
            audit_events.c.action == "dangerous_action.executed",
            audit_events.c.approval_id == action_id)).scalar_one()


def _loop(engine, lock) -> MaintenanceLoop:
    return MaintenanceLoop(
        JobStore(engine), Leadership(engine, lock_connection=lock),
        Schedule(actions_s=0.0), due_actions=actions.maintenance_task(engine))


def test_a_due_action_runs_once_with_two_maintenance_contenders(postgres_engine):
    action_id = _release_proposed(postgres_engine)
    locks = [postgres_engine.connect(), postgres_engine.connect()]
    try:
        loops = [_loop(postgres_engine, lock) for lock in locks]
        for loop in loops:
            loop.run_once()
        assert _status(postgres_engine, action_id) == "pending", "not before it's due"

        make_due(postgres_engine, action_id)
        barrier = threading.Barrier(2)
        results: list[dict] = []

        def tick(loop: MaintenanceLoop) -> None:
            barrier.wait()
            for _ in range(3):
                results.append(loop.run_once())

        threads = [threading.Thread(target=tick, args=(loop,)) for loop in loops]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(30)
        ran = [item for result in results for item in result.get("actions", [])]
        assert [item["id"] for item in ran] == [action_id]
        assert _status(postgres_engine, action_id) == "executed"
        assert _executions(postgres_engine, action_id) == 1
        with postgres_engine.connect() as conn:
            assert not emergency_state.load(conn).read_only
        for loop in loops:
            loop.leadership.release()
    finally:
        for lock in locks:
            lock.close()


def test_a_replaced_leader_runs_no_actions(sqlite_engine, clock):
    action_id = _release_proposed(sqlite_engine)
    clock.advance(delayed.DELAY_SECONDS + 1)
    old = Leadership(sqlite_engine, holder="old")
    old.acquire()
    stale = old.fence()
    Leadership(sqlite_engine, holder="new").acquire()
    with pytest.raises(LostLeadership):
        actions.run_due(sqlite_engine, stale)
    assert _status(sqlite_engine, action_id) == "pending"


def test_the_loop_runs_a_due_action_on_sqlite_too(sqlite_engine, clock):
    action_id = _release_proposed(sqlite_engine)
    loop = MaintenanceLoop(JobStore(sqlite_engine), Leadership(sqlite_engine),
                           Schedule(actions_s=0.0),
                           due_actions=actions.maintenance_task(sqlite_engine))
    assert loop.run_once()["actions"] == []
    clock.advance(delayed.DELAY_SECONDS + 1)
    assert [item["id"] for item in loop.run_once()["actions"]] == [action_id]
    assert loop.run_once()["actions"] == []
    assert _executions(sqlite_engine, action_id) == 1


def test_read_only_engaged_on_one_instance_is_enforced_on_another_within_a_second(
    postgres_engine,
):
    world = make_world(postgres_engine)
    settings = dataclasses.replace(cloud_settings(), staff_organization_id="staff-org")
    other = create_cloud_app(settings, engine=postgres_engine,
                             verifier=world.http.app.state.token_verifier)
    other.state.emergency_controls.max_age = 60.0  # only the NOTIFY can make B notice in time
    try:
        with TestClient(other) as b:
            assert other.state.event_fanout.listener.listening.wait(10)
            write = {"headers": world.headers("customer"), "json": {"enabled": False}}
            assert b.put("/api/account/labs/account.labs", **write).status_code != 503
            engaged = world.post("/api/admin/emergency/app.read_only/engage",
                                 reason="incident", target=None)
            assert engaged.status_code == 200, engaged.text
            started, answer = time.monotonic(), None
            while time.monotonic() - started < 1.0:
                answer = b.put("/api/account/labs/account.labs", **write)
                if answer.status_code == 503:
                    break
                time.sleep(0.05)
            assert answer is not None and answer.status_code == 503, "B never saw the change"
            assert answer.json()["detail"]["code"] == "read_only"
            assert time.monotonic() - started < 1.0
    finally:
        world.http.__exit__(None, None, None)
