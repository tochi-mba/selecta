"""Copyright notices: log them, act on them, and enforce the repeat-infringer policy (§12.3).

**Logging.** `log_notice()` records a notice as received, with the time it arrived and the time
it must be decided by (`RESPONSE_HOURS` later: "expeditious action" under the UK hosting
defence). The notice names one asset in one workspace. Complainant details are kept as given;
nothing secret belongs in them, and they're scrubbed like audit text anyway.

**Acting.** `act_on_notice()` accepts a notice as valid: the asset is hidden at once and its
deletion workflow starts through `storage.deletion.tombstone` (the bytes go back to the quota,
the object is purged after the recovery window, and a restore can't bring it back).
`reject_notice()` records a notice found invalid. Each step is audited.

**Repeat infringers.** When a workspace reaches `REPEAT_INFRINGER_NOTICES` valid notices
(configurable with `SELECTA_REPEAT_INFRINGER_NOTICES`, three by default), its uploads are
suspended (`upload_restrictions`), an Owner is alerted, and the restriction is audited. The rest
of the account keeps working: the person can still play and export what they have. Lifting the
restriction is a separate, audited decision.

Permissions: `legal.takedowns.read` to see notices, `legal.takedowns.manage` for everything else.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any

import sqlalchemy as sa
from sqlalchemy.engine import Connection

from selecta.admin import alerts
from selecta.admin.schema import takedown_notices, upload_restrictions
from selecta.authz import audit
from selecta.authz.check import Actor, authorize
from selecta.authz.scopes import ResourceRef
from selecta.persistence import db_now, new_id
from selecta.storage import deletion
from selecta.storage.schema import assets
from selecta.usage import quota

RESPONSE_HOURS = 24
DEFAULT_REPEAT_NOTICES = 3


def repeat_threshold() -> int:
    raw = os.environ.get("SELECTA_REPEAT_INFRINGER_NOTICES", "").strip()
    if not raw:
        return DEFAULT_REPEAT_NOTICES
    value = int(raw)
    if value < 1:
        raise ValueError("SELECTA_REPEAT_INFRINGER_NOTICES must be at least 1")
    return value


@dataclass(frozen=True)
class Notice:
    id: str
    workspace_id: str
    asset_id: str
    received_at: float
    due_by: float
    complainant: str
    work: str
    logged_by: str
    status: str
    decided_at: float | None
    decided_by: str | None
    decision_reason: str | None
    deletion_id: str | None

    def to_dict(self, now: float) -> dict[str, Any]:
        out = dict(vars(self))
        out["overdue"] = self.status == "received" and now > self.due_by
        return out


class _QuotaRelease:
    @staticmethod
    def release_committed(conn: Connection, workspace_id: str, size: int, ref: str) -> None:
        quota.release_deleted(conn, workspace_id, size, ref=ref)


def _resource(workspace_id: str, notice_id: str | None = None) -> ResourceRef:
    return ResourceRef("takedown_notice", notice_id, workspace_id)


def _get(conn: Connection, notice_id: str) -> Notice:
    row = (
        conn.execute(sa.select(takedown_notices).where(takedown_notices.c.id == notice_id))
        .mappings()
        .first()
    )
    if row is None:
        raise LookupError(f"There's no notice {notice_id!r}.")
    return Notice(**dict(row))


def notice_workspace(conn: Connection, notice_id: str) -> str | None:
    """Which workspace a notice belongs to, so deciding it runs as that workspace; None when
    there's no such notice (the decision then refuses it as usual)."""
    return conn.execute(
        sa.select(takedown_notices.c.workspace_id).where(takedown_notices.c.id == notice_id)
    ).scalar()


def _audit(
    conn: Connection,
    actor_id: str,
    action: str,
    workspace_id: str,
    notice_id: str | None,
    reason: str | None,
    request_id: str | None = None,
    **metadata: Any,
) -> None:
    audit.record(
        conn,
        actor_id=actor_id,
        action=action,
        result=audit.AuditResult.SUCCESS,
        resource_type="takedown_notice",
        resource_id=notice_id,
        workspace_id=workspace_id,
        reason=reason,
        request_id=request_id,
        metadata=metadata or None,
    )


def log_notice(
    conn: Connection,
    actor: Actor,
    *,
    workspace_id: str,
    asset_id: str,
    complainant: str,
    work: str,
    received_at: float | None = None,
) -> Notice:
    """Record a notice as it arrived. `received_at` defaults to now and can't be in the future."""
    if not complainant.strip() or not work.strip():
        raise ValueError("A notice needs the complainant and the work it concerns.")
    authorize(conn, actor, "legal.takedowns.manage", _resource(workspace_id))
    found = conn.execute(
        sa.select(assets.c.id).where(assets.c.id == asset_id, assets.c.workspace_id == workspace_id)
    ).first()
    if found is None:
        raise LookupError("There's no such asset in that workspace.")
    now = db_now(conn)
    received = now if received_at is None else min(float(received_at), now)
    notice_id = new_id()
    conn.execute(
        takedown_notices.insert().values(
            id=notice_id,
            workspace_id=workspace_id,
            asset_id=asset_id,
            received_at=received,
            due_by=received + RESPONSE_HOURS * 3600,
            complainant=audit.scrub_text(complainant.strip()),
            work=audit.scrub_text(work.strip()),
            logged_by=actor.user_id,
            status="received",
        )
    )
    _audit(
        conn,
        actor.user_id,
        "legal.takedown.logged",
        workspace_id,
        notice_id,
        None,
        actor.request_id,
        asset_id=asset_id,
        received_at=received,
    )
    return _get(conn, notice_id)


def _pending(conn: Connection, actor: Actor, notice_id: str) -> Notice:
    try:
        notice = _get(conn, notice_id)
    except LookupError:
        # Only staff who handle notices learn that this one doesn't exist.
        authorize(conn, actor, "legal.takedowns.manage", ResourceRef("takedown_notice", notice_id))
        raise
    authorize(conn, actor, "legal.takedowns.manage", _resource(notice.workspace_id, notice.id))
    if notice.status != "received":
        raise ValueError(f"The notice was already {notice.status}.")
    return notice


def valid_count(conn: Connection, workspace_id: str) -> int:
    return int(
        conn.execute(
            sa.select(sa.func.count()).where(
                takedown_notices.c.workspace_id == workspace_id,
                takedown_notices.c.status == "actioned",
            )
        ).scalar_one()
    )


def act_on_notice(conn: Connection, actor: Actor, notice_id: str, *, reason: str) -> dict[str, Any]:
    """Accept a notice: hide the asset, start its deletion, and apply the repeat policy."""
    if not reason or not reason.strip():
        raise ValueError("Say why the notice is valid.")
    notice = _pending(conn, actor, notice_id)
    tomb = deletion.tombstone(
        conn,
        notice.workspace_id,
        deletion.DeletionKind.SONG,
        notice.asset_id,
        quota=_QuotaRelease(),
    )
    now = db_now(conn)
    conn.execute(
        takedown_notices.update()
        .where(takedown_notices.c.id == notice.id)
        .values(
            status="actioned",
            decided_at=now,
            decided_by=actor.user_id,
            decision_reason=reason.strip(),
            deletion_id=tomb.deletion.id,
        )
    )
    _audit(
        conn,
        actor.user_id,
        "legal.takedown.actioned",
        notice.workspace_id,
        notice.id,
        reason,
        actor.request_id,
        asset_id=notice.asset_id,
        deletion_id=tomb.deletion.id,
        within_target=now <= notice.due_by,
        response_s=now - notice.received_at,
    )
    count = valid_count(conn, notice.workspace_id)
    restricted = False
    if count >= repeat_threshold():
        restricted = restrict_uploads(
            conn,
            actor.user_id,
            notice.workspace_id,
            reason=f"repeat infringer: {count} valid notices",
        )
    return {
        "notice": _get(conn, notice.id).to_dict(now),
        "valid_notices": count,
        "uploads_restricted": restricted or is_restricted(conn, notice.workspace_id),
    }


def reject_notice(conn: Connection, actor: Actor, notice_id: str, *, reason: str) -> Notice:
    if not reason or not reason.strip():
        raise ValueError("Say why the notice isn't valid.")
    notice = _pending(conn, actor, notice_id)
    conn.execute(
        takedown_notices.update()
        .where(takedown_notices.c.id == notice.id)
        .values(
            status="rejected",
            decided_at=db_now(conn),
            decided_by=actor.user_id,
            decision_reason=reason.strip(),
        )
    )
    _audit(
        conn,
        actor.user_id,
        "legal.takedown.rejected",
        notice.workspace_id,
        notice.id,
        reason,
        actor.request_id,
    )
    return _get(conn, notice.id)


def is_restricted(conn: Connection, workspace_id: str) -> bool:
    return (
        conn.execute(
            sa.select(upload_restrictions.c.workspace_id).where(
                upload_restrictions.c.workspace_id == workspace_id,
                upload_restrictions.c.lifted_at.is_(None),
            )
        ).first()
        is not None
    )


def restrict_uploads(conn: Connection, actor_id: str, workspace_id: str, *, reason: str) -> bool:
    """Suspend a workspace's uploads. False when they already were."""
    if is_restricted(conn, workspace_id):
        return False
    now = db_now(conn)
    conn.execute(
        upload_restrictions.delete().where(upload_restrictions.c.workspace_id == workspace_id)
    )
    conn.execute(
        upload_restrictions.insert().values(
            workspace_id=workspace_id, reason=reason, restricted_at=now, restricted_by=actor_id
        )
    )
    _audit(conn, actor_id, "legal.uploads.restricted", workspace_id, None, reason)
    alerts.raise_alert(
        conn,
        alerts.REPEAT_INFRINGER,
        f"Uploads suspended for workspace {workspace_id}: {reason}",
        actor_id=actor_id,
        metadata={"workspace_id": workspace_id},
    )
    return True


def lift_restriction(conn: Connection, actor: Actor, workspace_id: str, *, reason: str) -> bool:
    if not reason or not reason.strip():
        raise ValueError("Say why the restriction is lifted.")
    authorize(conn, actor, "legal.takedowns.manage", _resource(workspace_id))
    changed = conn.execute(
        upload_restrictions.update()
        .where(
            upload_restrictions.c.workspace_id == workspace_id,
            upload_restrictions.c.lifted_at.is_(None),
        )
        .values(lifted_at=db_now(conn), lifted_by=actor.user_id)
    ).rowcount
    _audit(
        conn,
        actor.user_id,
        "legal.uploads.restriction_lifted",
        workspace_id,
        None,
        reason,
        actor.request_id,
        changed=bool(changed),
    )
    return bool(changed)


def listing(
    conn: Connection, actor: Actor, *, status: str | None = None, limit: int = 100
) -> list[dict[str, Any]]:
    authorize(conn, actor, "legal.takedowns.read")
    query = sa.select(takedown_notices).order_by(takedown_notices.c.received_at.desc())
    if status:
        query = query.where(takedown_notices.c.status == status)
    now = db_now(conn)
    rows = conn.execute(query.limit(max(1, min(limit, 200)))).mappings()
    return [Notice(**dict(row)).to_dict(now) for row in rows]
