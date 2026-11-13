"""How the organisation names a member in its library (ADR-0442 BZ-0442-05, ADR-0452).

Uploads record `assets.uploaded_by`. A person who has left the organisation keeps their uploads
in its library but is shown as "Former member", never by their name or email.
"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.engine import Connection

from selecta.business import orgs
from selecta.identity.schema import users

FORMER_MEMBER = "Former member"


def uploader_label(conn: Connection, workspace_id: str, user_id: str | None) -> str:
    """The member's display name or email, or "Former member" once they are no longer one."""
    if not user_id or not orgs.is_member(conn, workspace_id, user_id):
        return FORMER_MEMBER
    row = conn.execute(sa.select(users).where(users.c.id == user_id)).mappings().first()
    if row is None:
        return FORMER_MEMBER
    for column in ("display_name", "name", "email"):
        value = row.get(column)
        if value:
            return str(value)
    return FORMER_MEMBER


__all__ = ["FORMER_MEMBER", "uploader_label"]
