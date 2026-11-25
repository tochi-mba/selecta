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

from selecta.admin import safety
from selecta.admin.schema import worker_controls
from selecta.authz import audit, delayed
from selecta.authz.check import Actor, authorize, ensure_not_own_workspace
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
MASS_OVERRIDE_MAX = 500
# Commands called from code (tests, maintenance) carry no console intent: the change window and
# tier rules still apply, but there is no version to compare.
NO_INTENT = safety.CODE


def job_version(job: Job) -> str:
    return safety.version_of(job.state, job.attempt_count, job.error_class)


def account_version(conn: Connection, user_id: str, workspace_id: str | None) -> str:
    """What an account action depends on: suspension, deletion, plan and live overrides."""
    user = accounts.get_user(conn, user_id)
    parts: list[Any] = [user.suspended_at if user else None, user.deleted_at if user else None]
    if workspace_id:
        from selecta.billing.schema import entitlement_overrides as o

        entitlement = stripe_sync.effective_entitlement(conn, workspace_id)
        live = conn.execute(sa.select(o.c.id).where(
            o.c.workspace_id == workspace_id, o.c.revoked_at.is_(None)).order_by(o.c.id)
        ).scalars().all()
        parts += [entitlement.plan_id, entitlement.source, list(live)]
    return safety.version_of(*parts)


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


def _job(conn: Connection, actor: Actor, job_id: str, permission: str) -> Job:
    """The job, authorized for `permission` on its workspace.

    A missing job is authorized against the bare id first, so only staff who could act on any
    workspace learn that it doesn't exist; everyone else gets the refusal they'd get for a real
    job they can't touch.
    """
    job = read_job(conn, job_id)
    if job is None:
        authorize(conn, actor, permission, ResourceRef("job", job_id))
        raise UnknownJob(job_id)
    authorize(conn, actor, permission, _job_resource(job))
    return job


def _lanes(conn: Connection) -> None:
    heads.create_lanes(conn, db_now(conn))
    heads.lock_all_lanes(conn)


def retry_job(conn: Connection, actor: Actor, job_id: str, *, reason: str,
              intent: safety.Intent = NO_INTENT) -> Job:
    reason = _need_reason(reason)
    _lanes(conn)
    job = _job(conn, actor, job_id, "jobs.retry")
    safety.guard(conn, actor, "job.retry", intent, current_version=job_version(job))
    again = retrying.retry(conn, job.workspace_id, job.id, db_now(conn))
    _audit(conn, actor, "admin.job.retry", _job_resource(job), reason, new_job_id=again.id,
           state_before=job.state)
    return again


def cancel_job(conn: Connection, actor: Actor, job_id: str, *, reason: str,
               intent: safety.Intent = NO_INTENT) -> Job:
    reason = _need_reason(reason)
    _lanes(conn)
    job = _job(conn, actor, job_id, "jobs.cancel")
    safety.guard(conn, actor, "job.cancel", intent, current_version=job_version(job),
                 target=job.id[:8])
    after = lifecycle.cancel(conn, job.workspace_id, job.id, db_now(conn))
    _audit(conn, actor, "admin.job.cancel", _job_resource(job), reason,
           state_before=job.state, state_after=after.state)
    return after


def quarantine_job(conn: Connection, actor: Actor, job_id: str, *, reason: str,
                   intent: safety.Intent = NO_INTENT) -> Job:
    """Hold a job out of line for inspection (`work.holds.hold_for_staff`)."""
    reason = _need_reason(reason)
    _lanes(conn)
    job = _job(conn, actor, job_id, "jobs.cancel")
    safety.guard(conn, actor, "job.quarantine", intent, current_version=job_version(job))
    after = holds.hold_for_staff(conn, job.id, db_now(conn))
    _audit(conn, actor, "admin.job.quarantine", _job_resource(job), reason,
           state_before=job.state, state_after=after.state,
           pending=after.state in {str(s) for s in ACTIVE})
    return after


def release_job(conn: Connection, actor: Actor, job_id: str, *, reason: str,
                intent: safety.Intent = NO_INTENT) -> Job:
    """Put a quarantined job back (`work.holds.release_staff_hold`)."""
    reason = _need_reason(reason)
    _lanes(conn)
    job = _job(conn, actor, job_id, "jobs.retry")
    safety.guard(conn, actor, "job.release", intent, current_version=job_version(job))
    after = holds.release_staff_hold(conn, job.id, db_now(conn))
    _audit(conn, actor, "admin.job.release", _job_resource(job), reason,
           state_before=job.state, state_after=after.state)
    return after


# --- workers -----------------------------------------------------------------------------------

WORKER_HOLDS = ("drain", "pause")


def hold_worker(
    conn: Connection, actor: Actor, worker_id: str, hold: str, *, reason: str,
    intent: safety.Intent = NO_INTENT,
) -> dict[str, Any]:
    """Drain (finish running work, claim nothing new) or pause (also ask running work to give
    way) one worker. The hold outlives the worker re-registering."""
    reason = _need_reason(reason)
    if hold not in WORKER_HOLDS:
        raise ValueError(f"A worker can be held as {' or '.join(WORKER_HOLDS)}, not {hold!r}.")
    resource = ResourceRef("worker", worker_id)
    authorize(conn, actor, "workers.drain", resource)
    safety.guard(conn, actor, f"worker.{hold}", intent)
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


def resume_worker(conn: Connection, actor: Actor, worker_id: str, *, reason: str,
                  intent: safety.Intent = NO_INTENT) -> dict:
    reason = _need_reason(reason)
    resource = ResourceRef("worker", worker_id)
    authorize(conn, actor, "workers.drain", resource)
    safety.guard(conn, actor, "worker.resume", intent)
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
    expires_at: float, intent: safety.Intent = NO_INTENT,
) -> dict[str, Any]:
    """One workspace's plan, overridden until `expires_at`, with a reason (never via Stripe)."""
    reason = _need_reason(reason)
    resource = ResourceRef("workspace", workspace_id, workspace_id)
    authorize(conn, actor, "billing.overrides.create", resource)
    ensure_not_own_workspace(conn, actor, "billing.overrides.create", [workspace_id])
    _check_override(conn, workspace_id, plan_id, expires_at)
    owner = conn.execute(sa.select(workspaces.c.owner_user_id).where(
        workspaces.c.id == workspace_id)).scalar()
    safety.guard(conn, actor, "override.grant", intent,
                 current_version=account_version(conn, owner, workspace_id) if owner else None)
    override_id = _apply_override(conn, workspace_id, plan_id, reason, actor.user_id, expires_at)
    _audit(conn, actor, "admin.override.grant", resource, reason, override_id=override_id,
           plan_id=plan_id, expires_at=expires_at)
    return {"override_id": override_id, "workspace_id": workspace_id, "plan_id": plan_id,
            "expires_at": expires_at}


def set_lucy_multiplier(
    conn: Connection, actor: Actor, *, workspace_id: str, reason: str,
    multiplier_milli: int | None,
) -> dict[str, Any]:
    """Change a workspace's allowance factor without discarding its usage."""
    from selecta.ai import usage_units
    from selecta.ai.usage_schema import lucy_usage_state

    reason = _need_reason(reason)
    resource = ResourceRef("workspace", workspace_id, workspace_id)
    permission = "billing.overrides.create"
    authorize(conn, actor, permission, resource)
    ensure_not_own_workspace(conn, actor, permission, [workspace_id])
    if multiplier_milli is not None and not 0 <= multiplier_milli <= 100_000:
        raise ValueError("The Lucy multiplier must be between 0 and 100,000 thousandths.")
    if conn.scalar(sa.select(workspaces.c.id).where(workspaces.c.id == workspace_id)) is None:
        raise LookupError(f"There's no workspace {workspace_id!r}.")

    now = db_now(conn)
    plan_id = stripe_sync.effective_entitlement(conn, workspace_id, now).plan_id
    usage_units.ensure_state(conn, workspace_id, plan_id=plan_id, now=now)
    usage_units.roll(conn, workspace_id, plan_id=plan_id, now=now)
    scope = lucy_usage_state.c.workspace_id == workspace_id
    row = conn.execute(sa.select(lucy_usage_state).where(scope).with_for_update()).one()
    target = usage_units.targets(
        row.plan_id, catalogue_version=row.catalogue_version,
        override_multiplier_milli=multiplier_milli,
    )
    conn.execute(lucy_usage_state.update().where(scope).values(
        override_multiplier_milli=multiplier_milli,
        week_limit=target.week_limit,
        session_limit=target.session_limit if row.session_limit is not None else None,
        updated_at=now,
    ))
    _audit(
        conn, actor, "admin.lucy.multiplier", resource, reason,
        before_multiplier_milli=row.override_multiplier_milli, multiplier_milli=multiplier_milli,
    )
    return {"workspace_id": workspace_id, "multiplier_milli": multiplier_milli}


def set_lucy_cutover(
    conn: Connection, actor: Actor, *, workspace_id: str, reason: str, when: str,
) -> dict[str, Any]:
    """Switch one workspace to the session and week allowance now, or take its switch away
    (ADR-0487 rules 6 and 7). The workspace still needs the `lucy.usage_windows` grant."""
    from selecta.ai import usage_rollout

    reason = _need_reason(reason)
    if when not in {"now", "cancel"}:
        raise ValueError("Say 'now' to switch the workspace or 'cancel' to take the switch away.")
    resource = ResourceRef("workspace", workspace_id, workspace_id)
    permission = "billing.overrides.create"
    authorize(conn, actor, permission, resource)
    if conn.scalar(sa.select(workspaces.c.id).where(workspaces.c.id == workspace_id)) is None:
        raise LookupError(f"There's no workspace {workspace_id!r}.")
    now = db_now(conn)
    if when == "now":
        usage_rollout.switch_now(conn, workspace_id, now)
        changed = True
    else:
        changed = usage_rollout.cancel(conn, workspace_id, now)
    _audit(conn, actor, "admin.lucy.cutover", resource, reason, when=when, changed=changed)
    return {"workspace_id": workspace_id, "when": when, "changed": changed}


def revoke_override(conn: Connection, actor: Actor, override_id: str, *, reason: str,
                    intent: safety.Intent = NO_INTENT) -> dict:
    reason = _need_reason(reason)
    from selecta.billing.schema import entitlement_overrides as t

    workspace_id = conn.execute(sa.select(t.c.workspace_id).where(t.c.id == override_id)).scalar()
    if workspace_id is None:
        authorize(conn, actor, "billing.overrides.create", ResourceRef("entitlement_override",
                                                                       override_id))
        raise LookupError(f"There's no override {override_id!r}.")
    resource = ResourceRef("workspace", workspace_id, workspace_id)
    authorize(conn, actor, "billing.overrides.create", resource)
    ensure_not_own_workspace(conn, actor, "billing.overrides.create", [workspace_id])
    safety.guard(conn, actor, "override.revoke", intent)
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
    intent: safety.Intent | None = None,
) -> delayed.DangerousAction:
    """Overrides for many workspaces at once are a dangerous action: they wait (§7.4). From the
    console they also need the dry run's digest as the version and the count typed back."""
    reason = _need_reason(reason)
    unique = sorted(set(workspace_ids))
    if len(unique) < 2:
        raise ValueError("A mass override names at least two workspaces.")
    if len(unique) > MASS_OVERRIDE_MAX:
        raise ValueError(f"A mass override names at most {MASS_OVERRIDE_MAX} workspaces a run.")
    # Checked before the workspaces are looked up, so they reveal nothing to anyone else.
    authorize(conn, actor, delayed.RULES[delayed.ActionKind.MASS_ENTITLEMENT_OVERRIDE].propose,
              ResourceRef("entitlement_overrides", None))
    ensure_not_own_workspace(conn, actor, "billing.overrides.create", unique)
    for workspace_id in unique:
        _check_override(conn, workspace_id, plan_id, expires_at)
    if intent is not None:
        if intent.version is None:
            from selecta.admin.http import CommandRefused

            raise CommandRefused(409, "dry_run_required", "Run the dry run first.")
        safety.guard(conn, actor, "override.mass", intent,
                     current_version=mass_digest(unique, plan_id, expires_at),
                     target=str(len(unique)))
    return delayed.propose(
        conn, actor, delayed.ActionKind.MASS_ENTITLEMENT_OVERRIDE,
        {"workspace_ids": unique, "plan_id": plan_id, "expires_at": expires_at},
        reason=reason, resource=ResourceRef("entitlement_overrides", None), notifier=notifier,
    )


def mass_digest(workspace_ids: list[str], plan_id: str, expires_at: float) -> str:
    return safety.version_of(sorted(set(workspace_ids)), plan_id, round(expires_at))


def mass_override_dry_run(
    conn: Connection, actor: Actor, *, workspace_ids: list[str], plan_id: str, expires_at: float,
) -> dict[str, Any]:
    """What a mass override would do, changing nothing: the count, a sample, what each gets,
    and the digest the real run must quote."""
    unique = sorted(set(workspace_ids))
    authorize(conn, actor, "billing.overrides.create", ResourceRef("entitlement_overrides", None))
    problems: list[str] = []
    sample = []
    for workspace_id in unique[:MASS_OVERRIDE_MAX]:
        try:
            _check_override(conn, workspace_id, plan_id, expires_at)
        except (ValueError, LookupError) as problem:
            problems.append(f"{workspace_id}: {problem}")
            continue
        if len(sample) < 5:
            now_plan = stripe_sync.effective_entitlement(conn, workspace_id).plan_id
            sample.append({"workspace_id": workspace_id, "plan_now": now_plan,
                           "plan_after": plan_id})
    return {"count": len(unique), "max": MASS_OVERRIDE_MAX,
            "too_many": len(unique) > MASS_OVERRIDE_MAX, "sample": sample,
            "problems": problems[:20], "plan_id": plan_id, "expires_at": expires_at,
            "digest": mass_digest(unique, plan_id, expires_at)}


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


def _account_resource(
    conn: Connection, actor: Actor, user_id: str, permission: str
) -> ResourceRef:
    """The account as a resource, authorized for `permission`; a missing one is authorized
    against the bare id first, so only staff who may act on any account learn it's missing."""
    user = accounts.get_user(conn, user_id)
    if user is None:
        authorize(conn, actor, permission, ResourceRef("user", user_id))
        raise LookupError(f"There's no account {user_id!r}.")
    workspace_id = conn.execute(
        sa.select(workspaces.c.id).where(
            workspaces.c.owner_user_id == user_id, workspaces.c.kind == "personal"
        )
    ).scalar()
    resource = ResourceRef("user", user_id, workspace_id)
    authorize(conn, actor, permission, resource)
    return resource


def _not_own_account(conn: Connection, actor: Actor, user_id: str, permission: str,
                     workspace_id: str | None) -> None:
    if user_id == actor.user_id:
        audit.record_durably(
            conn, actor_id=actor.user_id, action=permission, result=audit.AuditResult.DENY,
            resource_type="user", resource_id=user_id, reason="acting on the actor's own account",
            request_id=actor.request_id)
        from selecta.authz.errors import SelfApproval

        raise SelfApproval("Staff can't do this to their own account.")
    if workspace_id:
        ensure_not_own_workspace(conn, actor, permission, [workspace_id])


def suspend_account(conn: Connection, actor: Actor, user_id: str, *, reason: str,
                    intent: safety.Intent = NO_INTENT) -> dict:
    reason = _need_reason(reason)
    resource = _account_resource(conn, actor, user_id, "accounts.suspend")
    _not_own_account(conn, actor, user_id, "accounts.suspend", resource.workspace_id)
    user = accounts.get_user(conn, user_id)
    safety.guard(conn, actor, "account.suspend", intent,
                 current_version=account_version(conn, user_id, resource.workspace_id),
                 target=user.email if user else None)
    suspended_at = accounts.suspend(conn, user_id, actor_id=actor.user_id, reason=reason)
    safety.record(conn, actor, "account.suspend", resource_type="user", resource_id=user_id,
                  workspace_id=resource.workspace_id, reason=reason)
    return {"user_id": user_id, "suspended_at": suspended_at}


def restore_account(conn: Connection, actor: Actor, user_id: str, *, reason: str,
                    intent: safety.Intent = NO_INTENT) -> dict:
    reason = _need_reason(reason)
    resource = _account_resource(conn, actor, user_id, "accounts.restore")
    _not_own_account(conn, actor, user_id, "accounts.restore", resource.workspace_id)
    safety.guard(conn, actor, "account.restore", intent,
                 current_version=account_version(conn, user_id, resource.workspace_id))
    accounts.lift_suspension(conn, user_id, actor_id=actor.user_id, reason=reason)
    safety.record(conn, actor, "account.restore", resource_type="user", resource_id=user_id,
                  workspace_id=resource.workspace_id, reason=reason)
    return {"user_id": user_id, "suspended_at": None}
