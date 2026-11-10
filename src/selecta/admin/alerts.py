"""Alerts for the people who run Selecta: the durable record of what an Owner must hear about.

A kill switch, an emergency control, a staff member trying to raise their own powers or open a
customer's audio without a grant: each writes one `platform_alerts` row. Sending the email or
push is a notifier's job (it reads this table); the row is what proves the alert happened.

`raise_alert(..., durably=True)` commits at once on PostgreSQL, like a deny's audit row, so an
alert about a refused request survives the request rolling back. Metadata is scrubbed with
`authz.audit.scrub`, so a token or signed URL can't reach an alert either.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

import sqlalchemy as sa
from sqlalchemy.engine import Connection

from selecta.admin.schema import platform_alerts
from selecta.authz import audit
from selecta.persistence import db_now, is_postgres, new_id

ESCALATION = "security.escalation_attempt"
CONTENT_ACCESS = "security.content_access_attempt"
AUDIT_TAMPERING = "security.audit_tampering_attempt"
BULK_EXPORT = "security.bulk_export_attempt"
SELF_APPROVAL = "security.self_approval_attempt"
KILL_SWITCH = "flags.kill_switch"
EMERGENCY = "platform.emergency_control"
REPEAT_INFRINGER = "legal.repeat_infringer"


@dataclass(frozen=True)
class Alert:
    id: str
    created_at: float
    kind: str
    summary: str
    actor_id: str | None
    metadata: dict[str, Any] | None
    acknowledged_at: float | None


def _write(conn: Connection, kind: str, summary: str, actor_id: str | None, metadata) -> str:
    alert_id = new_id()
    conn.execute(
        platform_alerts.insert().values(
            id=alert_id,
            created_at=db_now(conn),
            kind=kind,
            summary=audit.scrub_text(summary),
            actor_id=actor_id,
            metadata=audit.scrub(dict(metadata)) if metadata else None,
        )
    )
    return alert_id


def raise_alert(
    conn: Connection,
    kind: str,
    summary: str,
    *,
    actor_id: str | None = None,
    metadata: Mapping[str, Any] | None = None,
    durably: bool = False,
) -> str:
    """Record an alert and return its id. `durably` survives the caller rolling back."""
    if durably and is_postgres(conn):
        with conn.engine.begin() as own:
            return _write(own, kind, summary, actor_id, metadata)
    return _write(conn, kind, summary, actor_id, metadata)


def recent(conn: Connection, *, limit: int = 50, kind: str | None = None) -> list[Alert]:
    query = sa.select(platform_alerts).order_by(
        platform_alerts.c.created_at.desc(), platform_alerts.c.id.desc()
    )
    if kind is not None:
        query = query.where(platform_alerts.c.kind == kind)
    rows = conn.execute(query.limit(max(1, min(limit, 500)))).mappings()
    return [Alert(**{name: row[name] for name in Alert.__dataclass_fields__}) for row in rows]
