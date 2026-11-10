"""Admin commands, not edits (ADR-0408 SC-0408-02): each console action is allowed for the right
role, denied (and the deny audited) for the wrong one, audited when it runs, and the dangerous
ones wait as delayed actions.

`test_cloud_admin_routes.py` covers retry, cancel, quarantine, drain and a single override; this
file covers the rest: release, pause and resume, suspend and restore, the mass override, the
quarantine of running work, and the read models' permissions.
"""

from __future__ import annotations

import time

import pytest
import sqlalchemy as sa
from cloud_admin_kit import audit_actions, make_due, make_world

from selecta.billing.schema import entitlement_overrides
from selecta.identity import accounts
from selecta.scheduling.policy import WorkerCaps
from selecta.work.enqueue import JobSpec
from selecta.work.holds import STAFF_HOLD


@pytest.fixture
def world(cloud_engine):
    built = make_world(cloud_engine, staff=("owner", "operator", "support", "auditor"))
    yield built
    built.http.__exit__(None, None, None)


def job_command(world, job_id: str, command: str, who: str = "owner"):
    return world.post(f"/api/admin/jobs/{job_id}/{command}", who, reason=f"{command} test")


def test_quarantine_then_release_puts_a_queued_job_back_in_line(world):
    job = world.store.enqueue(JobSpec(world.workspaces["customer"], "analyse.song")).job
    held = job_command(world, job.id, "quarantine", "operator").json()["job"]
    assert (held["state"], held["error_class"]) == ("blocked", STAFF_HOLD)
    caps = WorkerCaps(pool="cpu-heavy", worker_id="w-1", slots=2)
    assert world.store.claim("cpu-heavy", caps) is None, "a held job is out of line"
    assert job_command(world, job.id, "quarantine", "operator").json()["job"]["state"] == "blocked"
    released = job_command(world, job.id, "release", "operator").json()["job"]
    assert (released["state"], released["error_class"]) == ("queued", None)
    claimed = world.store.claim("cpu-heavy", caps)
    assert claimed is not None and claimed.job.id == job.id
    rows = audit_actions(world.engine, actor_id=world.users["operator"])
    actions = [row["action"] for row in rows if row["action"].startswith("admin.job.")]
    assert actions == ["admin.job.quarantine", "admin.job.quarantine", "admin.job.release"]


def test_quarantining_running_work_asks_it_to_give_way_and_holds_it_after(world):
    job = world.store.enqueue(JobSpec(world.workspaces["customer"], "analyse.song")).job
    caps = WorkerCaps(pool="cpu-heavy", worker_id="w-2", slots=2)
    claim = world.store.claim("cpu-heavy", caps)
    assert claim is not None
    assert job_command(world, job.id, "quarantine").json()["job"]["state"] == "leased"
    beat = world.store.heartbeat(claim.attempt_id, claim.fencing_token)
    assert (beat.cancel_requested, beat.cancel_reason) == (True, "staff_hold")
    after = world.store.release(claim.attempt_id, claim.fencing_token)
    assert (after.state, after.error_class, after.attempt_count) == ("blocked", STAFF_HOLD, 0)


def test_release_refuses_a_job_staff_never_held(world):
    job = world.store.enqueue(JobSpec(world.workspaces["customer"], "analyse.song")).job
    answer = job_command(world, job.id, "release")
    assert (answer.status_code, answer.json()["detail"]["code"]) == (409, "hold_refused")


def test_pause_asks_running_work_to_give_way_and_resume_lifts_the_hold(world):
    world.store.enqueue(JobSpec(world.workspaces["customer"], "analyse.song"))
    caps = WorkerCaps(pool="cpu-heavy", worker_id="w-pause", slots=2)
    world.store.register_worker(caps)
    claim = world.store.claim("cpu-heavy", caps)
    paused = world.post("/api/admin/workers/w-pause/pause", "operator", reason="bad image")
    assert paused.json()["preempted"] == [claim.attempt_id]
    world.store.enqueue(JobSpec(world.workspaces["customer2"], "analyse.song"))
    assert world.store.claim("cpu-heavy", caps) is None, "a held worker claims nothing"
    world.store.register_worker(caps)  # re-registering doesn't lift a staff hold
    assert world.store.claim("cpu-heavy", caps) is None
    assert world.post("/api/admin/workers/w-pause/resume", "operator",
                      reason="fixed").json()["hold"] is None
    assert world.store.claim("cpu-heavy", caps) is not None
    denied = world.post("/api/admin/workers/w-pause/drain", "support", reason="no")
    assert denied.status_code == 403
    assert audit_actions(world.engine, action="workers.drain", result="deny")


def test_suspend_and_restore_go_through_the_account_service(world):
    target = world.users["customer"]
    denied = world.post(f"/api/admin/accounts/{target}/suspend", "support", reason="spam")
    assert (denied.status_code, denied.json()["detail"]["code"]) == (403, "forbidden")
    assert audit_actions(world.engine, action="accounts.suspend", result="deny")

    assert world.post(f"/api/admin/accounts/{target}/suspend", reason="abuse").status_code == 200
    with world.engine.connect() as conn:
        assert accounts.get_user(conn, target).suspended_at is not None
    write = world.http.put("/api/account/labs/account.labs", headers=world.headers("customer"),
                           json={"enabled": False})
    assert write.json()["detail"]["code"] == "account_suspended"
    assert world.post(f"/api/admin/accounts/{target}/restore", reason="appeal").status_code == 200
    with world.engine.connect() as conn:
        assert accounts.get_user(conn, target).suspended_at is None
    events = [row["action"] for row in audit_actions(world.engine, resource_id=target)]
    assert "account.suspended" in events and "account.restored" in events
    own = world.post(f"/api/admin/accounts/{world.users['owner']}/suspend", reason="oops")
    assert own.status_code == 400


def test_an_override_needs_a_reason_and_a_bounded_expiry(world):
    workspace = world.workspaces["customer"]
    too_long = world.post("/api/admin/overrides", workspace_id=workspace, plan_id="premium",
                          reason="gift", expires_at=time.time() + 400 * 86_400)
    past = world.post("/api/admin/overrides", workspace_id=workspace, plan_id="premium",
                      reason="gift", expires_at=time.time() - 10)
    unknown = world.post("/api/admin/overrides", workspace_id=workspace, plan_id="platinum",
                         reason="gift", expires_at=time.time() + 86_400)
    assert [a.status_code for a in (too_long, past, unknown)] == [400, 400, 400]
    denied = world.post("/api/admin/overrides", "operator", workspace_id=workspace,
                        plan_id="premium", reason="gift", expires_at=time.time() + 86_400)
    assert denied.status_code == 403
    account = world.get("/api/account", "customer").json()
    assert account["entitlement"]["plan"] == "free"


def test_a_mass_override_waits_as_a_dangerous_action(world):
    targets = [world.workspaces["customer"], world.workspaces["customer2"]]
    proposed = world.post("/api/admin/overrides/mass", workspace_ids=targets, plan_id="premium",
                          reason="outage credit", expires_at=time.time() + 7 * 86_400)
    assert proposed.status_code == 202, proposed.text
    action_id = proposed.json()["action"]["id"]
    with world.engine.connect() as conn:
        assert conn.execute(sa.select(sa.func.count()).select_from(
            entitlement_overrides)).scalar_one() == 0
    early = world.post(f"/api/admin/actions/{action_id}/execute")
    assert early.json()["detail"]["code"] == "not_ready"
    make_due(world.engine, action_id)
    done = world.post(f"/api/admin/actions/{action_id}/execute")
    assert done.json()["ok"] is True, done.text
    assert world.get("/api/account", "customer2").json()["entitlement"]["plan"] == "premium"
    assert audit_actions(world.engine, action="admin.override.mass_grant")


def test_read_models_check_their_permission_and_audit_the_deny(world):
    assert world.get("/api/admin/accounts", "auditor").status_code == 403
    assert world.get("/api/admin/security", "support").status_code == 403
    assert world.get("/api/admin/ai", "support").status_code == 403
    assert world.get("/api/admin/jobs", "support").status_code == 200
    me = world.get("/api/admin/me", "support").json()
    assert "jobs.retry" in me["permissions"] and "jobs.cancel" not in me["permissions"]
    denied = {row["action"] for row in audit_actions(world.engine, result="deny")}
    assert {"accounts.list", "security.audit.read", "models.read"} <= denied
