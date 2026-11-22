"""The signed-in person's user id from their sign-in claims, for `guard.actor_for`.

A token's `subject` is the sign-in provider's id, not SelectaDJ's user id; membership rows
name the user id. Content controls and Rooms for Business resolve it here (a subject with no
user row is passed through unchanged, which is how the route tests plant their people).
"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.engine import Connection


def user_id_for(conn: Connection, claims) -> str:
    from selecta.identity.schema import users

    try:
        with conn.begin_nested():
            found = conn.execute(sa.select(users.c.id).where(
                users.c.auth_subject == claims.subject, users.c.deleted_at.is_(None))).scalar()
    except sa.exc.SQLAlchemyError:
        found = None
    return found or claims.subject


__all__ = ["user_id_for"]
