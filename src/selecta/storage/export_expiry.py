"""Finished exports expire when their plan's retention runs out (ADR-0397, SC-0397-05).

R2 lifecycle rules match by prefix only, so the bucket rule can only expire exports at the longest
plan's retention (90 days). This sweep applies each workspace's own plan: Free keeps an export 7
days, Standard 30 and Premium 90 (`billing.plans.Plan.export_retention_days`), read from the
workspace's newest entitlement snapshot (Free when it has none).

An export is an `artifacts` row of kind `export`. For each one past its retention the sweep, in
one transaction per workspace, deletes the row and its revision links and writes an `export`
tombstone (`storage.deletion.tombstone`) that gives its bytes back to the quota at once; the
physical deletion drain then erases the exports-bucket copy after the recovery window. The derived
objects the row named go after the commit, as `storage.eviction` does: a crash in between leaves
an orphaned object, never a row pointing at nothing. The maintenance leader runs it hourly
(`selecta maintain`, task `export_expiry`), behind the `cloud.export_expiry` flag.

Kept exports count against storage (ADR-0402: "Storage counts originals and kept exports only").
`charge_export` adds an export's bytes to committed usage when the job store writes its row
(`work.artifacts.write`), with a storage ledger entry whose ref is `export:{id}:...`. Expiry gives
back exactly what those entries charged (`charged`), never the row's size: an export made before
exports were charged releases nothing, so committed bytes never drop below what is stored.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass

import sqlalchemy as sa
from sqlalchemy.engine import Connection, Engine

from selecta import persistence
from selecta.billing.plans import UnknownPlan, plan_for
from selecta.storage.deletion import DeletionKind, tombstone
from selecta.usage import ledger, quota
from selecta.usage.schema import usage_ledger
from selecta.work.schema import artifacts, revision_artifacts

FLAG = "cloud.export_expiry"
DAY_S = 86_400.0
EXPORT_KIND = "export"


@dataclass(frozen=True)
class Expired:
    workspace_id: str
    export_id: str
    plan_id: str
    retention_days: int
    bytes_released: int


class _QuotaRelease:
    @staticmethod
    def release_committed(conn: Connection, workspace_id: str, size: int, ref: str) -> None:
        quota.release_deleted(conn, workspace_id, size, ref=ref)


def _charge_ref(export_id: str) -> str:
    return f"export:{export_id}:"


def charged(conn: Connection, workspace_id: str, export_id: str) -> int:
    """The bytes this export has been charged to the workspace's storage, net."""
    total = conn.execute(
        sa.select(sa.func.sum(usage_ledger.c.amount)).where(
            usage_ledger.c.workspace_id == workspace_id,
            usage_ledger.c.kind == ledger.Kind.STORAGE_BYTES.value,
            usage_ledger.c.ref.startswith(_charge_ref(export_id), autoescape=True),
        )
    ).scalar()
    return max(0, int(total or 0))


def charge_export(conn: Connection, workspace_id: str, export_id: str, size_bytes: int) -> int:
    """Charge a kept export's bytes to storage, or the difference when it was published again.
    Returns the change in committed bytes."""
    change = max(0, int(size_bytes or 0)) - charged(conn, workspace_id, export_id)
    if change == 0:
        return 0
    ref = _charge_ref(export_id) + persistence.new_id()
    if change < 0:
        quota.release_deleted(conn, workspace_id, -change, ref=ref)
        return change
    held = quota._locked(conn, workspace_id)
    quota._store(conn, held, committed=held.committed_bytes + change)
    ledger.record(conn, workspace_id, ledger.Kind.STORAGE_BYTES, change, ref=ref)
    return change


def retention_days(conn: Connection, workspace_id: str) -> tuple[str, int] | None:
    """The workspace's plan and how long it keeps exports; None when the plan is unknown (then
    nothing is deleted: keeping an export too long is safer than deleting one too soon)."""
    from selecta.billing.stripe_sync import current_snapshot

    snapshot = current_snapshot(conn, workspace_id)
    try:
        plan = (
            plan_for(None)
            if snapshot is None
            else plan_for(snapshot.plan_id, snapshot.plan_version)
        )
    except UnknownPlan:
        return None
    return plan.id, plan.export_retention_days


def _workspaces_with_exports(engine: Engine, before: float) -> list[str]:
    """Workspaces with an export at least as old as the shortest retention could allow."""
    with persistence.transaction(engine) as conn:
        return sorted(
            conn.execute(
                sa.select(artifacts.c.workspace_id)
                .distinct()
                .where(artifacts.c.kind == EXPORT_KIND, artifacts.c.created_at <= before)
            ).scalars()
        )


def expire_workspace(
    engine: Engine, workspace_id: str, now: float | None = None
) -> tuple[list[Expired], list[str]]:
    """Expire one workspace's overdue exports; returns them and the object keys to delete."""
    with persistence.transaction(engine, workspace_id) as conn:
        moment = persistence.db_now(conn) if now is None else now
        found = retention_days(conn, workspace_id)
        if found is None:
            return [], []
        plan_id, days = found
        rows = conn.execute(
            sa.select(artifacts.c.id, artifacts.c["keys"], artifacts.c.size_bytes)
            .where(
                artifacts.c.workspace_id == workspace_id,
                artifacts.c.kind == EXPORT_KIND,
                artifacts.c.created_at <= moment - days * DAY_S,
            )
            .order_by(artifacts.c.created_at, artifacts.c.id)
            .with_for_update()
        ).all()
        expired: list[Expired] = []
        keys: list[str] = []
        for row in rows:
            made = tombstone(
                conn,
                workspace_id,
                DeletionKind.EXPORT,
                row.id,
                # What it was charged, never more: committed bytes can't drop below the
                # originals and exports still stored.
                size=charged(conn, workspace_id, row.id),
                quota=_QuotaRelease(),
            )
            expired.append(Expired(workspace_id, row.id, plan_id, days, made.bytes_to_release))
            stored = row._mapping["keys"]
            keys += stored if isinstance(stored, list) else [stored]
        if rows:
            ids = [row.id for row in rows]
            conn.execute(
                revision_artifacts.delete().where(
                    revision_artifacts.c.workspace_id == workspace_id,
                    revision_artifacts.c.artifact_id.in_(ids),
                )
            )
            conn.execute(artifacts.delete().where(artifacts.c.id.in_(ids)))
    return expired, keys


def expire_exports(
    engine: Engine,
    delete_object: Callable[[str], None] | None = None,
    *,
    now: float | None = None,
) -> list[Expired]:
    """Every workspace's overdue exports, one transaction each. `delete_object` removes a
    derived object after its row has gone; without one the garbage collector finds them."""
    with persistence.transaction(engine) as conn:
        moment = persistence.db_now(conn) if now is None else now
    from selecta.billing.plans import current_plans

    shortest = min(plan.export_retention_days for plan in current_plans())
    done: list[Expired] = []
    for workspace_id in _workspaces_with_exports(engine, moment - shortest * DAY_S):
        expired, keys = expire_workspace(engine, workspace_id, moment)
        done += expired
        for key in keys:
            if delete_object is not None:
                delete_object(key)
    return done


__all__ = ["DAY_S", "FLAG", "Expired", "expire_exports", "expire_workspace", "retention_days"]
