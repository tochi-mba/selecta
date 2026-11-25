"""The console's Workers page (doc 07b §7B.4, Workers): hosted processing status and its actions.

Through the real Cloud API with a staff session, as `test_cloud_admin_routes.py` does: the status
read and its verdicts, a section that fails on its own, pausing and resuming a pool (and refusing
to resume a drain engaged from Emergency), retrying failed jobs of a type against the count the
console showed, cancelling long waits as a delayed action, requests to the autoscaler (refused
while it isn't running, then applied by its next pass), the budget's permission, the page's flag,
and the gateway check.
"""

from __future__ import annotations

import time

import pytest
import sqlalchemy as sa
from test_cloud_admin_routes import _staff, admin_world  # noqa: F401 - the shared fixture
from test_cloud_autoscale_leader import POOLS, FakeLauncher

from selecta import flags
from selecta.admin import hosted_status, read_models
from selecta.admin import state as admin_state
from selecta.admin.state import DbWorkControls
from selecta.authz.schema import audit_events, dangerous_actions
from selecta.persistence import transaction
from selecta.scheduling.policy import WorkerCaps
from selecta.work import autoscale_leader
from selecta.work.enqueue import JobSpec
from selecta.work.model import ErrorClass
from selecta.work.store import JobStore


def _status(world, headers=None) -> dict:
    answer = world.http.get("/api/admin/hosted/status", headers=headers or world.headers)
    assert answer.status_code == 200, answer.text
    return answer.json()


def _pool(status: dict, name: str) -> dict:
    return next(p for p in status["pools"] if p["pool"] == name)


def _post(world, path: str, body: dict | None = None, headers=None):
    return world.http.post(path, headers=headers or world.headers,
                           json={"reason": "workers test", **(body or {})})


def test_queued_work_with_no_worker_reads_as_waiting_for_a_worker(admin_world):  # noqa: F811
    for i in range(3):
        admin_world.store.enqueue(JobSpec(admin_world.workspace_id, "analyse.song",
                                          idempotency_key=f"wait-{i}"))
    status = _status(admin_world)
    heavy = _pool(status, "cpu-heavy")
    assert heavy["verdict"]["state"] == "waiting"
    assert heavy["queued"] == 3 and heavy["workers_seen"] == 0
    assert _pool(status, "cpu-light")["verdict"]["state"] == "idle"
    assert status["customers"]["accounts_waiting"] == 1
    assert status["customers"]["songs_waiting"] == 3
    assert status["pieces"]["gateway"]["state"] == "not_configured"
    assert status["pieces"]["autoscaler"]["running"] is False
    assert status["pieces"]["autoscaler"]["token_on_api"] is False
    assert status["cost"]["budget"]["status"] == "unset"
    # Never a secret: the Modal settings are named, their values never appear.
    assert "MODAL_TOKEN_SECRET" in str(status["pieces"]["autoscaler"]["settings"])


def test_verdicts_worst_first():
    numbers = {"recent": [], "queued": 0, "running": 0, "workers_seen": 0}
    assert hosted_status.verdict(numbers, False)["state"] == "idle"
    assert hosted_status.verdict({**numbers, "workers_seen": 1}, False)["state"] == "working"
    assert hosted_status.verdict({**numbers, "queued": 2}, False)["state"] == "waiting"
    failing = {**numbers, "workers_seen": 1, "recent": [{"outcome": "failed"}] * 3}
    assert hosted_status.verdict(failing, False)["state"] == "failing"
    assert hosted_status.verdict(failing, True)["state"] == "paused"


def test_a_section_that_fails_says_so_and_the_rest_still_reads(admin_world, monkeypatch):  # noqa: F811
    def broken(*_args, **_kwargs):
        raise RuntimeError("boom")

    monkeypatch.setattr(hosted_status, "customers", broken)
    status = _status(admin_world)
    assert "Couldn't read customer waits" in status["customers"]["error"]
    assert len(status["pools"]) == 4


def test_pause_stops_claims_and_resume_undoes_it(admin_world):  # noqa: F811
    # The store as the worker gateway builds it: it reads the emergency controls on each claim.
    store = JobStore(admin_world.engine, controls=DbWorkControls())
    store.enqueue(JobSpec(admin_world.workspace_id, "analyse.song"))
    paused = _post(admin_world, "/api/admin/hosted/pools/cpu-heavy/pause")
    assert paused.status_code == 200, paused.text
    assert store.claim("cpu-heavy", WorkerCaps(pool="cpu-heavy", worker_id="w-1")) is None
    assert _pool(_status(admin_world), "cpu-heavy")["verdict"]["state"] == "paused"
    resumed = _post(admin_world, "/api/admin/hosted/pools/cpu-heavy/resume")
    assert resumed.status_code == 200, resumed.text
    assert store.claim("cpu-heavy", WorkerCaps(pool="cpu-heavy", worker_id="w-1")) is not None
    with admin_world.engine.connect() as conn:
        done = set(conn.execute(sa.select(audit_events.c.action).where(
            audit_events.c.action.like("admin.pool.%"))).scalars())
    assert done == {"admin.pool.pause", "admin.pool.resume"}


def test_a_drain_from_emergency_is_not_resumed_from_the_workers_page(admin_world):  # noqa: F811
    engaged = _post(admin_world, "/api/admin/emergency/workers.drained/engage",
                    {"target": "cpu-heavy", "confirm": "workers.drained"})
    assert engaged.status_code < 300, engaged.text
    status = _status(admin_world)
    assert _pool(status, "cpu-heavy")["paused"]["from_page"] is False
    answer = _post(admin_world, "/api/admin/hosted/pools/cpu-heavy/resume")
    assert (answer.status_code, answer.json()["detail"]["code"]) == (409, "emergency_drain")


def test_retry_failed_jobs_of_a_type_needs_the_count_it_showed(admin_world):  # noqa: F811
    store = admin_world.store
    job = store.enqueue(JobSpec(admin_world.workspace_id, "analyse.song")).job
    claim = store.claim("cpu-heavy", WorkerCaps(pool="cpu-heavy", worker_id="w-2"))
    assert claim is not None and claim.job.id == job.id
    store.fail(claim.attempt_id, claim.fencing_token, ErrorClass.INPUT_INVALID, "bad")
    preview = admin_world.http.get("/api/admin/hosted/preview", headers=admin_world.headers,
                                   params={"kind": "retry_failed", "type": "analyse.song"})
    assert preview.status_code == 200, preview.text
    found = preview.json()
    assert found["count"] == 1 and found["accounts"] == 1
    stale = _post(admin_world, "/api/admin/hosted/jobs/retry-failed",
                  {"type": "analyse.song", "version": "not-the-count", "read_at": time.time()})
    assert (stale.status_code, stale.json()["detail"]["code"]) == (409, "record_changed")
    done = _post(admin_world, "/api/admin/hosted/jobs/retry-failed",
                 {"type": "analyse.song", "version": found["version"], "read_at": time.time()})
    assert done.status_code == 200, done.text
    assert done.json()["retried"] == 1


def test_cancelling_long_waits_is_a_delayed_action_confirmed_by_the_count(admin_world):  # noqa: F811
    from selecta.work.schema import jobs

    job = admin_world.store.enqueue(JobSpec(admin_world.workspace_id, "analyse.song")).job
    with transaction(admin_world.engine) as conn:
        conn.execute(jobs.update().where(jobs.c.id == job.id).values(
            queued_at=time.time() - 30 * 3600, created_at=time.time() - 30 * 3600))
    found = admin_world.http.get("/api/admin/hosted/preview", headers=admin_world.headers,
                                 params={"kind": "expire_queued", "hours": 24}).json()
    assert found["count"] == 1
    body = {"hours": 24, "version": found["version"], "read_at": time.time()}
    wrong = _post(admin_world, "/api/admin/hosted/jobs/expire-queued", {**body, "confirm": "9"})
    assert (wrong.status_code, wrong.json()["detail"]["code"]) == (400, "confirm_mismatch")
    queued = _post(admin_world, "/api/admin/hosted/jobs/expire-queued", {**body, "confirm": "1"})
    assert queued.status_code == 202, queued.text
    with admin_world.engine.connect() as conn:
        kinds = conn.execute(sa.select(dangerous_actions.c.action)).scalars().all()
        state = conn.execute(sa.select(jobs.c.state).where(jobs.c.id == job.id)).scalar()
    assert "jobs.expire_queued" in kinds
    assert state == "queued"  # nothing happens until the delay has passed


def test_autoscaler_requests_need_a_running_autoscaler_and_are_applied_by_its_pass(admin_world):  # noqa: F811
    refused = _post(admin_world, "/api/admin/hosted/pools/cpu-heavy/start-test")
    assert (refused.status_code, refused.json()["detail"]["code"]) == (
        409, "autoscaler_not_running")
    launcher = FakeLauncher()
    autoscale_leader.tick(admin_world.engine, POOLS, launcher, autoscale_leader.SpendMeter())
    assert _status(admin_world)["pieces"]["autoscaler"]["running"] is True
    started = _post(admin_world, "/api/admin/hosted/pools/cpu-heavy/start-test")
    assert started.status_code == 200, started.text
    with admin_world.engine.connect() as conn:
        assert admin_state.scale_requests(conn, time.time()) == {"cpu-heavy": 1}
    launcher.scaled.clear()
    autoscale_leader.tick(admin_world.engine, POOLS, launcher, autoscale_leader.SpendMeter())
    assert ("cpu-heavy", 1, False) in launcher.scaled
    released = _post(admin_world, "/api/admin/hosted/pools/cpu-heavy/release")
    assert released.status_code == 200, released.text
    with admin_world.engine.connect() as conn:
        assert admin_state.scale_requests(conn, time.time()) == {}


def test_the_budget_needs_a_billing_permission(admin_world):  # noqa: F811
    body = {"monthly_usd": 50, "warn_percent": 75}
    denied = admin_world.http.put("/api/admin/hosted/budget", headers=admin_world.denied_headers,
                                  json={"reason": "test", **body})
    assert (denied.status_code, denied.json()["detail"]["permission"]) == (
        403, "billing.subscriptions.manage")
    version = _status(admin_world)["cost"]["budget"]["version"]
    saved = admin_world.http.put("/api/admin/hosted/budget", headers=admin_world.headers,
                                 json={"reason": "beta limit", "version": version,
                                       "read_at": time.time(), **body})
    assert saved.status_code == 200, saved.text
    budget = _status(admin_world)["cost"]["budget"]
    assert (budget["monthly_usd"], budget["warn_percent"], budget["status"]) == (50, 75, "ok")


def test_support_reads_the_page_but_cannot_pause_a_pool(admin_world):  # noqa: F811
    claims = admin_world.tokens.add("support", "staff-support", session_id="support-session")
    with transaction(admin_world.engine) as conn:
        _, session = _staff(conn, claims, "support")
    headers = {"Authorization": "Bearer support", "X-Admin-Session": session}
    assert len(_status(admin_world, headers)["pools"]) == 4
    answer = _post(admin_world, "/api/admin/hosted/pools/cpu-heavy/pause", headers=headers)
    assert (answer.status_code, answer.json()["detail"]["permission"]) == (403, "workers.drain")


def test_the_page_is_off_with_its_flag(admin_world):  # noqa: F811
    try:
        flags.use("-admin.workers")
        off = admin_world.http.get("/api/admin/hosted/status", headers=admin_world.headers)
        assert (off.status_code, off.json()["code"]) == (403, "flag_off")
    finally:
        flags.use(None)


class _Reply:
    def __init__(self, status: int, body: dict):
        self.status_code, self._body = status, body

    def json(self):
        return self._body


@pytest.mark.parametrize(("reply", "state"), [
    (_Reply(200, {"status": "ready", "schema": "abc"}), "ok"),
    (_Reply(200, {"status": "ready", "schema": "old"}), "schema_mismatch"),
    (_Reply(503, {"detail": {"code": "migrations_pending"}}), "not_ready"),
])
def test_the_gateway_check_compares_its_schema_with_the_api(reply, state):
    assert hosted_status.check_gateway("https://gw.test", "abc", lambda *_a, **_k: reply)[
        "state"] == state


def test_an_unreachable_gateway_says_so():
    def down(*_args, **_kwargs):
        raise OSError("refused")

    assert hosted_status.check_gateway("https://gw.test", "abc", down)["state"] == "unreachable"


def test_the_autoscaler_pass_reports_that_it_ran(cloud_engine):
    autoscale_leader.tick(cloud_engine, POOLS, FakeLauncher(), autoscale_leader.SpendMeter())
    with cloud_engine.connect() as conn:
        names = {m["name"] for m in read_models.overview(conn)["metrics"]
                 if m["state"] != "unknown"}
    assert {"health.modal", "autoscale.workers"} <= names


def test_delayed_console_actions_record_their_audit_row(admin_world):  # noqa: F811
    """Make Owner once failed with a TypeError: its audit row named the delayed action with a
    keyword `safety.record` already takes positionally. Found while building Workers."""
    from selecta.identity.schema import users

    with admin_world.engine.connect() as conn:
        customer = conn.execute(sa.select(users.c.id).where(
            users.c.email == "customer@example.test")).scalar()
    answer = _post(admin_world, "/api/admin/staff/owners",
                   {"user_id": customer, "confirm": "customer@example.test"})
    assert answer.status_code == 202, answer.text
