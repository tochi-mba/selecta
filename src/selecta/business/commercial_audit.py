"""Shared writes for BZ-4: the commercial audit trail and idempotent notices.

`audit` appends one row to `biz_commercial_audit`. `notice` records a reminder, warning or alert
once per (organisation, venue, kind, cycle_key): calling it again returns False and sends nothing,
so maintenance passes can run as often as they like. Delivery (email, in-app) reads
`biz_notices`; in-app notices go to manager devices only, never to a customer-facing display.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from typing import Any

import sqlalchemy as sa
from sqlalchemy.engine import Connection

from selecta.billing.schema import insert_ignore
from selecta.business.commercial_schema import biz_commercial_audit, biz_notices
from selecta.persistence import new_id

CHANNELS = ("email", "in_app")


def audit(
    conn: Connection,
    *,
    workspace_id: str,
    organisation_id: str,
    action: str,
    actor: str,
    now: float,
    venue_id: str = "",
    detail: Mapping[str, Any] | None = None,
) -> str:
    row_id = new_id()
    conn.execute(
        sa.insert(biz_commercial_audit).values(
            id=row_id,
            workspace_id=workspace_id,
            organisation_id=organisation_id,
            venue_id=venue_id,
            action=action,
            actor=actor,
            detail=dict(detail or {}),
            created_at=now,
        )
    )
    return row_id


def audit_rows(conn: Connection, organisation_id: str, action: str | None = None) -> list[dict]:
    query = sa.select(biz_commercial_audit).where(
        biz_commercial_audit.c.organisation_id == organisation_id
    )
    if action:
        query = query.where(biz_commercial_audit.c.action == action)
    return [dict(r) for r in conn.execute(query.order_by(biz_commercial_audit.c.created_at))
            .mappings()]


def notice(
    conn: Connection,
    *,
    workspace_id: str,
    organisation_id: str,
    kind: str,
    cycle_key: str,
    channel: str,
    audience: Iterable[str],
    due_at: float,
    now: float,
    venue_id: str = "",
    detail: Mapping[str, Any] | None = None,
) -> bool:
    """Record a notice once. True when this call created it (so the caller should send it)."""
    if channel not in CHANNELS:
        raise ValueError(f"Unknown notice channel: {channel}")
    return insert_ignore(
        conn,
        biz_notices,
        {
            "id": new_id(),
            "workspace_id": workspace_id,
            "organisation_id": organisation_id,
            "venue_id": venue_id,
            "kind": kind,
            # One row per channel: the same reminder by email and in-app are two notices.
            "cycle_key": f"{cycle_key}:{channel}",
            "channel": channel,
            "audience": sorted(set(audience)),
            "detail": dict(detail or {}),
            "due_at": due_at,
            "created_at": now,
        },
        ("organisation_id", "venue_id", "kind", "cycle_key"),
    )


def notices(conn: Connection, organisation_id: str, kind_prefix: str = "") -> list[dict]:
    query = sa.select(biz_notices).where(biz_notices.c.organisation_id == organisation_id)
    if kind_prefix:
        query = query.where(biz_notices.c.kind.startswith(kind_prefix))
    return [dict(r) for r in conn.execute(query.order_by(biz_notices.c.due_at)).mappings()]
