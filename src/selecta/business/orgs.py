"""Organisations: workspaces of kind `business` (ADR-0442, BZ-0442-01).

Connection-first: the caller owns the transaction. An organisation is created in a system
transaction (no workspace set yet); later reads run inside the organisation's own transaction.
"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.engine import Connection

from selecta.business.errors import NotFound
from selecta.identity.schema import workspace_members, workspaces
from selecta.persistence import new_id

BUSINESS = "business"
OWNER = "owner"
MEMBER = "business_member"

_KIND_ORDER = {"personal": 0}


def _org(row) -> dict:
    return {
        "id": row["id"],
        "name": row["name"],
        "kind": row["kind"],
        "legal_name": row["legal_name"],
        "pilot_until": row["pilot_until"],
    }


def create(
    conn: Connection,
    *,
    owner_user_id: str,
    name: str,
    legal_name: str | None = None,
    pilot_until: int | None = None,
    now: int,
) -> dict:
    """A new organisation workspace with its owner as the `owner` member."""
    name = (name or "").strip()
    if not name:
        raise ValueError("an organisation needs a name")
    workspace_id = new_id()
    conn.execute(
        workspaces.insert().values(
            id=workspace_id,
            name=name,
            kind=BUSINESS,
            owner_user_id=owner_user_id,
            created_at=now,
            legal_name=legal_name,
            pilot_until=pilot_until,
        )
    )
    conn.execute(
        workspace_members.insert().values(
            workspace_id=workspace_id, user_id=owner_user_id, role=OWNER, created_at=now
        )
    )
    return {
        "id": workspace_id,
        "name": name,
        "kind": BUSINESS,
        "legal_name": legal_name,
        "pilot_until": pilot_until,
    }


def get(conn: Connection, workspace_id: str) -> dict:
    """The organisation, or NotFound when the workspace is missing or not a business."""
    row = (
        conn.execute(
            sa.select(workspaces).where(
                workspaces.c.id == workspace_id, workspaces.c.kind == BUSINESS
            )
        )
        .mappings()
        .first()
    )
    if row is None:
        raise NotFound("organisation not found")
    return _org(row)


def add_member(conn: Connection, workspace_id: str, user_id: str, *, now: int) -> None:
    """Make `user_id` a member of the organisation. Idempotent: an existing member is kept."""
    get(conn, workspace_id)
    if is_member(conn, workspace_id, user_id):
        return
    conn.execute(
        workspace_members.insert().values(
            workspace_id=workspace_id, user_id=user_id, role=MEMBER, created_at=now
        )
    )


def is_member(conn: Connection, workspace_id: str, user_id: str) -> bool:
    found = conn.execute(
        sa.select(workspace_members.c.user_id).where(
            workspace_members.c.workspace_id == workspace_id,
            workspace_members.c.user_id == user_id,
        )
    ).first()
    return found is not None


def list_for_user(conn: Connection, user_id: str) -> list[dict]:
    """Every workspace the person belongs to: personal first, then the others by name."""
    rows = conn.execute(
        sa.select(
            workspaces.c.id,
            workspaces.c.name,
            workspaces.c.kind,
            workspaces.c.pilot_until,
            workspace_members.c.role,
        )
        .join(workspace_members, workspace_members.c.workspace_id == workspaces.c.id)
        .where(workspace_members.c.user_id == user_id)
    ).mappings()
    items = [
        {
            "id": row["id"],
            "name": row["name"],
            "kind": row["kind"],
            "role": row["role"],
            "pilot_until": row["pilot_until"],
        }
        for row in rows
    ]
    items.sort(key=lambda w: (_KIND_ORDER.get(w["kind"], 1), w["name"].casefold(), w["id"]))
    return items
