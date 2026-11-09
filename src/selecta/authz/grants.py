"""Support content access: the only way a staff member may listen to a customer's audio.

No role includes `storage.content.read`. A staff member working a support case asks for access
with `request_content_access()`, naming the case and the customer's recorded consent. That is a
dangerous action: it waits 15 minutes with the owner notified (one operator), or needs a second
person's approval (two or more). When it runs, `issue_grant()` writes a grant for that staff
member, that workspace and that case, ending after at most four hours.

`authz.check.authorize(..., "storage.content.read", resource)` then allows reads of that
workspace's audio until the grant ends or is revoked, and audits every one.
"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.engine import Connection

from selecta.authz import audit, delayed
from selecta.authz.check import AccessGrant, Actor, authorize
from selecta.authz.errors import ActionNotFound
from selecta.authz.schema import access_grants
from selecta.authz.scopes import ResourceRef
from selecta.persistence import db_now, new_id

DEFAULT_MINUTES = 60
MAX_MINUTES = 240
RESOURCE_TYPE = "workspace_content"


def _validated(workspace_id: str, support_case_id: str, consent_ref: str, minutes: int) -> dict:
    if not workspace_id or not support_case_id:
        raise ValueError("content access needs a workspace and a support case")
    if not consent_ref or not consent_ref.strip():
        raise ValueError("content access needs the customer's consent reference")
    if not isinstance(minutes, int) or isinstance(minutes, bool) or not 1 <= minutes <= MAX_MINUTES:
        raise ValueError(f"minutes must be a whole number from 1 to {MAX_MINUTES}")
    return {
        "workspace_id": workspace_id,
        "support_case_id": support_case_id,
        "consent_ref": consent_ref.strip(),
        "minutes": minutes,
    }


def content_resource(workspace_id: str, support_case_id: str | None = None) -> ResourceRef:
    return ResourceRef(RESOURCE_TYPE, workspace_id, workspace_id, support_case_id)


def request_content_access(
    conn: Connection,
    actor: Actor,
    *,
    workspace_id: str,
    support_case_id: str,
    consent_ref: str,
    reason: str,
    minutes: int = DEFAULT_MINUTES,
    notifier: delayed.Notifier | None = None,
) -> delayed.DangerousAction:
    """Propose a grant for the actor themselves. It runs through the delayed-action rules."""
    payload = _validated(workspace_id, support_case_id, consent_ref, minutes)
    return delayed.propose(
        conn,
        actor,
        delayed.ActionKind.CONTENT_ACCESS_GRANT,
        payload,
        reason=reason,
        resource=content_resource(workspace_id, support_case_id),
        notifier=notifier,
    )


def issue_grant(conn: Connection, action: delayed.DangerousAction) -> AccessGrant:
    """The executor for a content access action: writes the grant for the proposer."""
    if action.kind is not delayed.ActionKind.CONTENT_ACCESS_GRANT:
        raise ValueError(f"not a content access action: {action.kind}")
    p = action.payload
    payload = _validated(p["workspace_id"], p["support_case_id"], p["consent_ref"], p["minutes"])
    if (
        payload["workspace_id"] != action.resource.workspace_id
        or payload["support_case_id"] != action.resource.support_case_id
    ):
        raise ValueError("the payload and the action's resource disagree")

    now = db_now(conn)
    grant_id = new_id()
    conn.execute(
        access_grants.insert().values(
            id=grant_id,
            staff_user_id=action.proposer_id,
            workspace_id=payload["workspace_id"],
            support_case_id=payload["support_case_id"],
            consent_ref=payload["consent_ref"],
            reason=action.reason,
            issued_by=action.proposer_id,
            approved_by=action.approver_id,
            approval_id=action.id,
            created_at=now,
            expires_at=now + payload["minutes"] * 60,
        )
    )
    grant = get_grant(conn, grant_id)
    audit.record(
        conn,
        actor_id=action.proposer_id,
        action="support.content_access.granted",
        result=audit.AuditResult.SUCCESS,
        resource_type=RESOURCE_TYPE,
        resource_id=grant.workspace_id,
        workspace_id=grant.workspace_id,
        reason=action.reason,
        approval_id=action.id,
        metadata={
            "grant_id": grant.id,
            "support_case_id": grant.support_case_id,
            "consent_ref": grant.consent_ref,
            "expires_at": grant.expires_at,
            "approved_by": grant.approved_by,
        },
    )
    return grant


def get_grant(conn: Connection, grant_id: str) -> AccessGrant:
    row = (
        conn.execute(sa.select(access_grants).where(access_grants.c.id == grant_id))
        .mappings()
        .first()
    )
    if row is None:
        raise ActionNotFound(f"no access grant {grant_id}")
    return AccessGrant.from_row(row)


def list_grants(
    conn: Connection, *, workspace_id: str | None = None, active_only: bool = True
) -> list[AccessGrant]:
    """Grants for the Security page, or for showing a customer who could hear their audio."""
    g = access_grants
    query = sa.select(g).order_by(g.c.created_at.desc(), g.c.id)
    if workspace_id is not None:
        query = query.where(g.c.workspace_id == workspace_id)
    if active_only:
        query = query.where(g.c.revoked_at.is_(None), g.c.expires_at > db_now(conn))
    return [AccessGrant.from_row(row) for row in conn.execute(query).mappings()]


def revoke_grant(conn: Connection, actor: Actor, grant_id: str, *, reason: str) -> AccessGrant:
    """End a grant early. Its holder may always; others need the approving permission."""
    grant = get_grant(conn, grant_id)
    if grant.revoked_at is not None:
        return grant
    resource = content_resource(grant.workspace_id, grant.support_case_id)
    if actor.user_id != grant.staff_user_id:
        authorize(conn, actor, "support.content_access.approve", resource)
    conn.execute(
        access_grants.update()
        .where(access_grants.c.id == grant.id)
        .values(revoked_at=db_now(conn), revoked_by=actor.user_id)
    )
    audit.record(
        conn,
        actor_id=actor.user_id,
        action="support.content_access.revoked",
        result=audit.AuditResult.SUCCESS,
        resource_type=RESOURCE_TYPE,
        resource_id=grant.workspace_id,
        workspace_id=grant.workspace_id,
        reason=reason,
        request_id=actor.request_id,
        approval_id=grant.approval_id,
        metadata={"grant_id": grant.id, "support_case_id": grant.support_case_id},
    )
    return get_grant(conn, grant.id)
