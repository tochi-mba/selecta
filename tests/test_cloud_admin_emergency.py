"""Emergency controls (ADR-0410 SC-0410-04, §14): each one works where it matters, is audited,
needs `platform.emergency_controls.manage`, and turning it off waits as a dangerous action; once
the release runs, normal behaviour comes back.

Every control is engaged and released through the admin API, as an operator would in a game day.
The release is proposed, refused while its delay runs, made due, and executed.
"""

from __future__ import annotations

import pytest
from cloud_admin_kit import audit_actions, make_due, make_world
from test_cloud_billing_fakes import PRICE_MAP, FakeStripe, event, subscription

from selecta.admin import guard, state
from selecta.ai import registry
from selecta.ai.gateway import TurnRefused, plan_turn
from selecta.ai.registry import DEFAULT_DEPLOYMENTS, RequestClass, Tier
from selecta.ai.spend import PlatformPolicy
from selecta.billing.maintenance import StripeDrainResult, drain_stripe_events
from selecta.billing.webhooks import store_event
from selecta.persistence import transaction
from selecta.scheduling.admission import Verdict
from selecta.scheduling.policy import WorkerCaps
from selecta.work.enqueue import JobSpec


@pytest.fixture
def world(cloud_engine):
    built = make_world(cloud_engine)
    yield built
    built.http.__exit__(None, None, None)


def engage(world, control: str, target: str | None = None, who: str = "owner"):
    return world.post(f"/api/admin/emergency/{control}/engage", who,
                      reason="game day", target=target)


def release(world, control: str, target: str | None = None) -> None:
    """Propose the release, check it waits, make it due, and run it."""
    proposed = world.post(f"/api/admin/emergency/{control}/release", reason="recovered",
                          target=target)
    assert proposed.status_code == 200, proposed.text
    action_id = proposed.json()["action"]["id"]
    early = world.post(f"/api/admin/actions/{action_id}/execute")
    assert (early.status_code, early.json()["detail"]["code"]) == (409, "not_ready")
    make_due(world.engine, action_id)
    done = world.post(f"/api/admin/actions/{action_id}/execute")
    assert done.status_code == 200 and done.json()["ok"], done.text


def current(world) -> state.EmergencyState:
    with world.engine.connect() as conn:
        return state.load(conn)


def test_engaging_needs_the_permission_and_both_directions_are_audited(world):
    refused = engage(world, "app.read_only", who="auditor")
    assert (refused.status_code, refused.json()["detail"]["code"]) == (403, "forbidden")
    assert not current(world).read_only
    denied = audit_actions(world.engine, action="platform.emergency_controls.manage",
                           result="deny")
    assert [row["actor_id"] for row in denied] == [world.users["auditor"]]

    assert engage(world, "app.read_only").status_code == 200
    release(world, "app.read_only")
    rows = audit_actions(world.engine, resource_type="emergency_control")
    events = [row["action"] for row in rows
              if row["action"].startswith("platform.emergency_control.")]
    assert events == ["platform.emergency_control.engage",
                      "platform.emergency_control.release"]
    proposed = audit_actions(world.engine, action="dangerous_action.proposed")
    assert proposed and proposed[0]["metadata"]["kind"] == "platform.emergency_control.disable"


def test_read_only_refuses_customer_writes_but_keeps_reads_sign_out_and_admin(world):
    assert engage(world, "app.read_only").status_code == 200
    write = world.http.put("/api/account/labs/account.labs", headers=world.headers("customer"),
                           json={"enabled": False})
    assert (write.status_code, write.json()["detail"]["code"]) == (503, "read_only")
    assert world.get("/api/account", "customer").status_code == 200
    out = world.post("/api/account/sign-out-everywhere", "customer2")
    assert out.json().get("detail", {}).get("code") != "read_only"
    assert world.get("/api/admin/emergency").status_code == 200
    release(world, "app.read_only")
    again = world.http.put("/api/account/labs/account.labs", headers=world.headers("customer"),
                           json={"enabled": False})
    assert again.status_code != 503


def test_paused_uploads_refuse_new_plans_until_released(world):
    assert engage(world, "uploads.paused").status_code == 200
    plan = world.post("/api/uploads/plan", "customer", files=[{"name": "a.flac", "size": 10}])
    assert (plan.status_code, plan.json()["detail"]["code"]) == (503, "uploads_paused")
    parts = world.post("/api/uploads/some-session/parts", "customer", part_numbers=[1])
    assert parts.json()["detail"]["code"] == "uploads_paused"
    release(world, "uploads.paused")
    plan = world.post("/api/uploads/plan", "customer", files=[{"name": "a.flac", "size": 10}])
    assert plan.json().get("detail", {}).get("code") != "uploads_paused"


def test_closed_sign_ups_refuse_newcomers_but_not_existing_accounts(world):
    assert engage(world, "signups.disabled").status_code == 200
    newcomer = world.post("/api/onboarding/complete", "newcomer", age_confirmed=True)
    assert (newcomer.status_code, newcomer.json()["detail"]["code"]) == (403, "signups_closed")
    existing = world.post("/api/onboarding/complete", "customer", age_confirmed=True)
    assert existing.status_code == 201, existing.text
    release(world, "signups.disabled")
    newcomer = world.post("/api/onboarding/complete", "newcomer", age_confirmed=True)
    assert newcomer.status_code == 201, newcomer.text


def test_paused_admission_refuses_new_work_for_that_pool_only(world):
    heavy = JobSpec(world.workspaces["customer"], "analyse.song")
    light = JobSpec(world.workspaces["customer"], "ingest.validate")
    assert engage(world, "admission.paused", "cpu-heavy").status_code == 200
    assert world.store.admit(heavy).verdict is Verdict.REFUSE
    assert world.store.admit(light).creates_job
    release(world, "admission.paused", "cpu-heavy")
    assert world.store.admit(heavy).creates_job


def test_drained_workers_claim_nothing_and_resume_after_release(world):
    job = world.store.enqueue(JobSpec(world.workspaces["customer"], "analyse.song")).job
    caps = WorkerCaps(pool="cpu-heavy", worker_id="worker-drain", slots=2)
    world.store.register_worker(caps)
    assert engage(world, "workers.drained", "*").status_code == 200
    assert world.store.claim("cpu-heavy", caps) is None
    release(world, "workers.drained", "*")
    claimed = world.store.claim("cpu-heavy", caps)
    assert claimed is not None and claimed.job.id == job.id


def test_disabled_speculative_work_is_neither_admitted_nor_claimed(world):
    spec = JobSpec(world.workspaces["customer"], "discover.sweep")
    job = world.store.enqueue(spec).job
    caps = WorkerCaps(pool="cpu-heavy", worker_id="worker-spare", slots=8)
    world.store.register_worker(caps)
    assert engage(world, "speculative.disabled").status_code == 200
    assert world.store.admit(spec).verdict is Verdict.REFUSE
    assert world.store.claim("cpu-heavy", caps) is None
    release(world, "speculative.disabled")
    claimed = world.store.claim("cpu-heavy", caps)
    assert claimed is not None and claimed.job.id == job.id


def _turn(engine, workspace: str):
    policy = PlatformPolicy(daily_cap_usd=25.0, monthly_cap_usd=500.0, alert_percents=())
    with transaction(engine, workspace) as conn:
        return plan_turn(conn, workspace_id=workspace, tier=Tier.PREMIUM,
                         request_class=RequestClass.PLANNING, prompt_version="p1",
                         tool_schema_version="t1", policy=policy)


def test_disabling_lucy_refuses_turns_and_one_deployment_falls_back(world):
    with transaction(world.engine) as conn:
        registry.seed_defaults(conn)
    workspace = world.workspaces["customer"]
    first = _turn(world.engine, workspace)
    chosen = first.deployment.id
    assert chosen in {d.id for d in DEFAULT_DEPLOYMENTS}

    assert engage(world, "lucy.deployment_disabled", chosen).status_code == 200
    fallback = _turn(world.engine, "w-fallback")
    assert fallback.deployment.id != chosen
    assert (chosen, "disabled") in fallback.skipped
    release(world, "lucy.deployment_disabled", chosen)
    assert _turn(world.engine, "w-back").deployment.id == chosen

    assert engage(world, "lucy.disabled").status_code == 200
    with pytest.raises(TurnRefused) as refused:
        _turn(world.engine, "w-off")
    assert refused.value.code == "lucy_disabled"
    release(world, "lucy.disabled")
    assert _turn(world.engine, "w-on").deployment.id == chosen


def test_billing_safe_mode_stops_checkout_and_holds_stripe_events(world):
    assert engage(world, "billing.safe_mode").status_code == 200
    checkout = world.http.post("/api/billing/checkout", headers={
        **world.headers("customer"), "Idempotency-Key": "k1"}, json={})
    assert (checkout.status_code, checkout.json()["detail"]["code"]) == (503,
                                                                         "billing_safe_mode")
    stripe = FakeStripe()
    stripe.put(subscription(price="price_premium_month"))
    with transaction(world.engine) as conn:
        store_event(conn, event("evt_safe", "invoice.paid",
                                {"object": "invoice", "subscription": "sub_1"}))
    assert drain_stripe_events(world.engine, stripe, PRICE_MAP) == StripeDrainResult()
    release(world, "billing.safe_mode")
    assert drain_stripe_events(world.engine, stripe, PRICE_MAP).processed == 1


def test_unknown_controls_and_targets_are_refused_with_a_reason(world):
    assert engage(world, "app.everything").json()["detail"]["code"] == "invalid_request"
    assert engage(world, "admission.paused", "no-such-pool").status_code == 400


@pytest.mark.parametrize(
    ("controls", "method", "path", "code"),
    [
        ({("app.read_only", "*")}, "POST", "/api/billing/portal", "read_only"),
        ({("app.read_only", "*")}, "POST", "/api/webhooks/stripe", None),
        ({("app.read_only", "*")}, "GET", "/api/account", None),
        ({("uploads.paused", "*")}, "POST", "/api/uploads/s1/complete", None),
        ({("billing.safe_mode", "*")}, "POST", "/api/billing/portal", "billing_safe_mode"),
        (set(), "POST", "/api/uploads/plan", None),
    ],
)
def test_the_request_guard_decides_by_control_method_and_path(controls, method, path, code):
    answer = guard.refusal_for(state.EmergencyState(frozenset(controls)), method, path)
    assert (None if answer is None else answer.status_code) == (None if code is None else 503)
    if code is not None:
        assert code.encode() in answer.body
