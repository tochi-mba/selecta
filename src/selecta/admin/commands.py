"""Admin commands: every console action is one of these, never a direct row edit (§7.5, ADR-0408).

Each command checks its permission with `authz.check.authorize()` against the resource it
touches, does the work through the same functions customers' requests use (the job lifecycle,
the account suspension, the billing override), and writes one audit row saying what happened.
Run them inside `admin.http.run`, which keeps a refusal's audit row and alerts on attacks.

| Command | Permission | Through |
|---|---|---|
| Retry a job | `jobs.retry` | `work.retrying.retry` |
| Cancel a job | `jobs.cancel` | `work.lifecycle.cancel` |
| Quarantine / release a job | `jobs.cancel` / `jobs.retry` | `work.holds` |
| Drain, pause or resume a worker | `workers.drain` | `admin.schema.worker_controls` |
| Entitlement override | `billing.overrides.create` | `billing.stripe_sync.grant_override` |
| Many overrides at once | dangerous action `billing.overrides.mass` | `execute_mass_override` |
| Suspend / restore an account | `accounts.suspend` / `accounts.restore` | `identity.accounts` |

Job commands take every lane clock first, the lock order the job store uses everywhere, so a
console action can't deadlock against a claim.
"""

from __future__ import annotations

from typing import Any

import sqlalchemy as sa
from sqlalchemy.engine import Connection

from selecta.admin.schema import worker_controls
from selecta.authz import audit, delayed
from selecta.authz.check import Actor, authorize
from selecta.authz.scopes import ResourceRef
from selecta.billing import plans, stripe_sync
from selecta.identity import accounts
from selecta.identity.schema import workspaces
from selecta.persistence import db_now
from selecta.usage import quota
from selecta.work import heads, holds, lifecycle, retrying
from selecta.work.errors import UnknownJob
from selecta.work.model import ACTIVE, Job
from selecta.work.schema import job_attempts, jobs, workers
from selecta.work.state import read_job

MASS_OVERRIDE_THRESHOLD = 10
MAX_OVERRIDE_DAYS = 366


def _need_reason(reason: str) -> str:
    if not reason or not reason.strip():
        raise ValueError("Every admin command needs a reason.")
    return reason.strip()


def _audit(conn: Connection, actor: Actor, action: str, resource: ResourceRef, reason: str,
           **metadata: Any) -> str:
    return audit.record(
        conn,
        actor_id=actor.user_id,
        action=action,
        result=audit.AuditResult.SUCCESS,
        resource_type=resource.type,
        resource_id=resource.id,
        workspace_id=resource.workspace_id,
        reason=reason,
        request_id=actor.request_id,
        metadata=metadata or None,
    )


# --- jobs --------------------------------------------------------------------------------------


def job_workspace(conn: Connection, job_id: str) -> str:
    """Which workspace a job belongs to, so the command's transaction runs as that workspace."""
    found = conn.execute(sa.select(jobs.c.workspace_id).where(jobs.c.id == job_id)).scalar()
    if found is None:
        raise UnknownJob(job_id)
    return found


def _job_resource(job: Job) -> ResourceRef:
    return ResourceRef("job", job.id, job.workspace_id)


def _job(conn: Connection, job_id: str) -> Job:
    job = read_job(conn, job_id)
    if job is None:
        raise UnknownJob(job_id)
    return job


def _lanes(conn: Connection) -> None:
    heads.create_lanes(conn, db_now(conn))
    heads.lock_all_lanes(conn)


def retry_job(conn: Connection, actor: Actor, job_id: str, *, reason: str) -> Job:
    reason = _need_reason(reason)
    _lanes(conn)
    job = _job(conn, job_id)
    authorize(conn, actor, "jobs.retry", _job_resource(job))
    again = retrying.retry(conn, job.workspace_id, job.id, db_now(conn))
    _audit(conn, actor, "admin.job.retry", _job_resource(job), reason, new_job_id=again.id,
           state_before=job.state)
    return again


def cancel_job(conn: Connection, actor: Actor, job_id: str, *, reason: str) -> Job:
    reason = _need_reason(reason)
    _lanes(conn)
    job = _job(conn, job_id)
    authorize(conn, actor, "jobs.cancel", _job_resource(job))
    after = lifecycle.cancel(conn, job.workspace_id, job.id, db_now(conn))
    _audit(conn, actor, "admin.job.cancel", _job_resource(job), reason,
           state_before=job.state, state_after=after.state)
    return after


def quarantine_job(conn: Connection, actor: Actor, job_id: str, *, reason: str) -> Job:
    """Hold a job out of line for inspection (`work.holds.hold_for_staff`)."""
    reason = _need_reason(reason)
    _lanes(conn)
    job = _job(conn, job_id)
    authorize(conn, actor, "jobs.cancel", _job_resource(job))
    after = holds.hold_for_staff(conn, job.id, db_now(conn))
    _audit(conn, actor, "admin.job.quarantine", _job_resource(job), reason,
           state_before=job.state, state_after=after.state,
           pending=after.state in {str(s) for s in ACTIVE})
    return after


def release_job(conn: Connection, actor: Actor, job_id: str, *, reason: str) -> Job:
    """Put a quarantined job back (`work.holds.release_staff_hold`)."""
    reason = _need_reason(reason)
    _lanes(conn)
    job = _job(conn, job_id)
    authorize(conn, actor, "jobs.retry", _job_resource(job))
    after = holds.release_staff_hold(conn, job.id, db_now(conn))
    _audit(conn, actor, "admin.job.release", _job_resource(job), reason,
           state_before=job.state, state_after=after.state)
    return after


# --- workers -----------------------------------------------------------------------------------

WORKER_HOLDS = ("drain", "pause")


def hold_worker(
    conn: Connection, actor: Actor, worker_id: str, hold: str, *, reason: str
) -> dict[str, Any]:
    """Drain (finish running work, claim nothing new) or pause (also ask running work to give
    way) one worker. The hold outlives the worker re-registering."""
    reason = _need_reason(reason)
    if hold not in WORKER_HOLDS:
        raise ValueError(f"A worker can be held as {' or '.join(WORKER_HOLDS)}, not {hold!r}.")
    resource = ResourceRef("worker", worker_id)
    authorize(conn, actor, "workers.drain", resource)
    found = conn.execute(sa.select(workers.c.id).where(workers.c.id == worker_id)).first()
    if found is None:
        raise LookupError(f"There's no worker {worker_id!r}.")
    now = db_now(conn)
    conn.execute(worker_controls.delete().where(worker_controls.c.worker_id == worker_id))
    conn.execute(
        worker_controls.insert().values(
            worker_id=worker_id, hold=hold, reason=reason, set_by=actor.user_id, set_at=now
        )
    )
    conn.execute(workers.update().where(workers.c.id == worker_id).values(draining=True))
    preempted: list[str] = []
    if hold == "pause":
        live = conn.execute(
            sa.select(job_attempts.c.id).where(
                job_attempts.c.worker_id == worker_id, job_attempts.c.outcome.is_(None)
            )
        ).scalars()
        preempted = [aid for aid in live if lifecycle.request_preemption(conn, aid, now)]
    _audit(conn, actor, f"admin.worker.{hold}", resource, reason, preempted=preempted)
    return {"worker_id": worker_id, "hold": hold, "preempted": preempted}


def resume_worker(conn: Connection, actor: Actor, worker_id: str, *, reason: str) -> dict:
    reason = _need_reason(reason)
    resource = ResourceRef("worker", worker_id)
    authorize(conn, actor, "workers.drain", resource)
    conn.execute(worker_controls.delete().where(worker_controls.c.worker_id == worker_id))
    conn.execute(workers.update().where(workers.c.id == worker_id).values(draining=False))
    _audit(conn, actor, "admin.worker.resume", resource, reason)
    return {"worker_id": worker_id, "hold": None}


# --- entitlement overrides ---------------------------------------------------------------------


def _check_override(conn: Connection, workspace_id: str, plan_id: str, expires_at: float) -> None:
    if plan_id not in stripe_sync.PLAN_RANK:
        raise ValueError(f"Unknown plan {plan_id!r}.")
    found = conn.execute(sa.select(workspaces.c.id).where(workspaces.c.id == workspace_id)).first()
    if found is None:
        raise LookupError(f"There's no workspace {workspace_id!r}.")
    now = db_now(conn)
    if expires_at <= now:
        raise ValueError("An override must expire in the future.")
    if expires_at > now + MAX_OVERRIDE_DAYS * 86_400:
        raise ValueError(f"An override can last at most {MAX_OVERRIDE_DAYS} days.")


def _apply_override(conn: Connection, workspace_id: str, plan_id: str, reason: str,
                    actor_id: str, expires_at: float) -> str:
    override_id = stripe_sync.grant_override(
        conn, workspace_id=workspace_id, plan_id=plan_id, reason=reason, actor=actor_id,
        expires_at=expires_at,
    )
    entitlement = stripe_sync.effective_entitlement(conn, workspace_id)
    quota.set_limit(conn, workspace_id, plans.plan_for(entitlement.plan_id,
                                                       entitlement.plan_version))
    return override_id


def grant_override(
    conn: Connection, actor: Actor, *, workspace_id: str, plan_id: str, reason: str,
    expires_at: float,
) -> dict[str, Any]:
    """One workspace's plan, overridden until `expires_at`, with a reason (never via Stripe)."""
    reason = _need_reason(reason)
    resource = ResourceRef("workspace", workspace_id, workspace_id)
    authorize(conn, actor, "billing.overrides.create", resource)
    _check_override(conn, workspace_id, plan_id, expires_at)
    override_id = _apply_override(conn, workspace_id, plan_id, reason, actor.user_id, expires_at)
    _audit(conn, actor, "admin.override.grant", resource, reason, override_id=override_id,
           plan_id=plan_id, expires_at=expires_at)
    return {"override_id": override_id, "workspace_id": workspace_id, "plan_id": plan_id,
            "expires_at": expires_at}


def revoke_override(conn: Connection, actor: Actor, override_id: str, *, reason: str) -> dict:
    reason = _need_reason(reason)
    from selecta.billing.schema import entitlement_overrides as t

    workspace_id = conn.execute(sa.select(t.c.workspace_id).where(t.c.id == override_id)).scalar()
    if workspace_id is None:
        raise LookupError(f"There's no override {override_id!r}.")
    resource = ResourceRef("workspace", workspace_id, workspace_id)
    authorize(conn, actor, "billing.overrides.create", resource)
    changed = stripe_sync.revoke_override(conn, override_id, actor.user_id)
    entitlement = stripe_sync.effective_entitlement(conn, workspace_id)
    quota.set_limit(conn, workspace_id, plans.plan_for(entitlement.plan_id,
                                                       entitlement.plan_version))
    _audit(conn, actor, "admin.override.revoke", resource, reason, override_id=override_id,
           changed=changed)
    return {"override_id": override_id, "revoked": changed}


def propose_mass_override(
    conn: Connection, actor: Actor, *, workspace_ids: list[str], plan_id: str, reason: str,
    expires_at: float, notifier: delayed.Notifier | None = None,
) -> delayed.DangerousAction:
    """Overrides for many workspaces at once are a dangerous action: they wait (§7.4)."""
    reason = _need_reason(reason)
    unique = sorted(set(workspace_ids))
    if len(unique) < 2:
        raise ValueError("A mass override names at least two workspaces.")
    for workspace_id in unique:
        _check_override(conn, workspace_id, plan_id, expires_at)
    return delayed.propose(
        conn, actor, delayed.ActionKind.MASS_ENTITLEMENT_OVERRIDE,
        {"workspace_ids": unique, "plan_id": plan_id, "expires_at": expires_at},
        reason=reason, resource=ResourceRef("entitlement_overrides", None), notifier=notifier,
    )


def execute_mass_override(conn: Connection, action: delayed.DangerousAction) -> dict:
    if action.kind is not delayed.ActionKind.MASS_ENTITLEMENT_OVERRIDE:
        raise ValueError(f"not a mass override: {action.kind}")
    payload = action.payload
    granted = [
        _apply_override(conn, workspace_id, payload["plan_id"], action.reason,
                        action.proposer_id, payload["expires_at"])
        for workspace_id in payload["workspace_ids"]
    ]
    audit.record(
        conn, actor_id=action.proposer_id, action="admin.override.mass_grant",
        result=audit.AuditResult.SUCCESS, resource_type="entitlement_overrides",
        reason=action.reason, approval_id=action.id,
        metadata={"count": len(granted), "plan_id": payload["plan_id"]},
    )
    return {"override_ids": granted}


# --- accounts ----------------------------------------------------------------------------------


def _account_resource(conn: Connection, user_id: str) -> ResourceRef:
    user = accounts.get_user(conn, user_id)
    if user is None:
        raise LookupError(f"There's no account {user_id!r}.")
    workspace_id = conn.execute(
        sa.select(workspaces.c.id).where(
            workspaces.c.owner_user_id == user_id, workspaces.c.kind == "personal"
        )
    ).scalar()
    return ResourceRef("user", user_id, workspace_id)


def suspend_account(conn: Connection, actor: Actor, user_id: str, *, reason: str) -> dict:
    reason = _need_reason(reason)
    if user_id == actor.user_id:
        raise ValueError("Staff can't suspend their own account.")
    resource = _account_resource(conn, user_id)
    authorize(conn, actor, "accounts.suspend", resource)
    suspended_at = accounts.suspend(conn, user_id, actor_id=actor.user_id, reason=reason)
    return {"user_id": user_id, "suspended_at": suspended_at}


def restore_account(conn: Connection, actor: Actor, user_id: str, *, reason: str) -> dict:
    reason = _need_reason(reason)
    resource = _account_resource(conn, user_id)
    authorize(conn, actor, "accounts.restore", resource)
    accounts.lift_suspension(conn, user_id, actor_id=actor.user_id, reason=reason)
    return {"user_id": user_id, "suspended_at": None}
