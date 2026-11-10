"""Shared setup for the authorization tests: staff users, assignments, sessions, grants, audit rows.

This module holds no tests. The other `test_cloud_authz_*` files import its fixtures and helpers.

- `db` is one transaction on each database (SQLite, and PostgreSQL in CI), with database time
  frozen on SQLite. Tests on it build times from `db_now(conn)`, so they hold on both clocks.
- `sdb` is SQLite only, for tests that move the clock (`clock.advance`).
- Rows are inserted directly (`give`, `add_grant`) so a test sets up exactly the state it needs;
  the functions under test write through the real code paths.
"""

from __future__ import annotations

import dataclasses
from collections.abc import Iterator
from typing import Any

import pytest
import sqlalchemy as sa
from sqlalchemy.engine import Connection, RowMapping

from selecta.authz.check import STAFF_SESSION_SECONDS, Actor
from selecta.authz.roles import StaffRole
from selecta.authz.schema import access_grants, audit_events, role_assignments
from selecta.authz.scopes import ResourceRef, Scope
from selecta.identity.schema import session_revocations, users
from selecta.persistence import db_now, new_id


@pytest.fixture
def db(cloud_engine, clock) -> Iterator[Connection]:
    """One transaction, committed at the end, on SQLite (frozen time) and on PostgreSQL in CI."""
    with cloud_engine.begin() as conn:
        yield conn


@pytest.fixture
def sdb(sqlite_engine, clock) -> Iterator[Connection]:
    """One SQLite transaction whose time moves only with `clock.advance()`."""
    with sqlite_engine.begin() as conn:
        yield conn


def add_user(conn: Connection, *, deleted: bool = False) -> str:
    user_id = new_id()
    now = db_now(conn)
    conn.execute(
        users.insert().values(
            id=user_id,
            auth_subject=f"test|{user_id}",
            email=f"{user_id}@example.test",
            email_verified=True,
            timezone="UTC",
            age_confirmed=True,
            created_at=now,
            deleted_at=now if deleted else None,
        )
    )
    return user_id


def delete_user(conn: Connection, user_id: str) -> None:
    conn.execute(users.update().where(users.c.id == user_id).values(deleted_at=db_now(conn)))


def give(
    conn: Connection,
    user_id: str,
    role: StaffRole | str,
    scope: Scope | None = None,
    *,
    expires_at: float | None = None,
    revoked_at: float | None = None,
    scope_type: str | None = None,
    scope_id: str | None = None,
) -> str:
    """Insert one assignment row directly. `scope_type`/`scope_id` write raw, unchecked values."""
    scope = scope or Scope.platform()
    assignment_id = new_id()
    conn.execute(
        role_assignments.insert().values(
            id=assignment_id,
            user_id=user_id,
            role=str(role),
            scope_type=scope_type or scope.type,
            scope_id=scope_id if scope_id is not None else scope.id,
            issued_by="setup",
            reason="test setup",
            created_at=db_now(conn),
            expires_at=expires_at,
            revoked_at=revoked_at,
        )
    )
    return assignment_id


def staff(conn: Connection, role: StaffRole = StaffRole.OWNER, scope: Scope | None = None) -> str:
    """A live user holding `role` at `scope` (platform-wide by default)."""
    user_id = add_user(conn)
    give(conn, user_id, role, scope)
    return user_id


def session(
    conn: Connection,
    user_id: str,
    *,
    mfa_age: float = 0.0,
    age: float = 0.0,
    **overrides: Any,
) -> Actor:
    """A valid one-hour staff session that started `age` seconds ago, MFA `mfa_age` seconds ago."""
    now = db_now(conn)
    issued = now - age
    actor = Actor(
        user_id=user_id,
        staff_session_id=f"staff-session-{user_id}",
        mfa_at=now - mfa_age,
        privileged_until=issued + STAFF_SESSION_SECONDS,
        session_issued_at=issued,
        request_id=f"request-{user_id}",
    )
    return dataclasses.replace(actor, **overrides)


def revoke_before(conn: Connection, user_id: str, when: float) -> None:
    """Set the user's "sign out everywhere" cut-off directly."""
    t = session_revocations
    updated = conn.execute(t.update().where(t.c.user_id == user_id).values(revoked_before=when))
    if updated.rowcount == 0:
        conn.execute(t.insert().values(user_id=user_id, revoked_before=when))


def revoked_before(conn: Connection, user_id: str) -> float | None:
    t = session_revocations
    return conn.execute(
        sa.select(t.c.revoked_before).where(t.c.user_id == user_id)
    ).scalar_one_or_none()


def add_grant(
    conn: Connection,
    staff_user_id: str,
    workspace_id: str,
    support_case_id: str,
    *,
    expires_in: float = 3600.0,
    revoked: bool = False,
) -> str:
    grant_id = new_id()
    now = db_now(conn)
    conn.execute(
        access_grants.insert().values(
            id=grant_id,
            staff_user_id=staff_user_id,
            workspace_id=workspace_id,
            support_case_id=support_case_id,
            consent_ref="consent-1",
            reason="test setup",
            issued_by=staff_user_id,
            approved_by=None,
            approval_id=None,
            created_at=now,
            expires_at=now + expires_in,
            revoked_at=now if revoked else None,
        )
    )
    return grant_id


def audit_rows(conn: Connection, **where: Any) -> list[RowMapping]:
    """Audit rows matching every `column=value` given."""
    query = sa.select(audit_events).order_by(audit_events.c.created_at, audit_events.c.id)
    for column, value in where.items():
        query = query.where(audit_events.c[column] == value)
    return list(conn.execute(query).mappings())


def workspace_ref(workspace_id: str, case_id: str | None = None) -> ResourceRef:
    return ResourceRef("workspace", workspace_id, workspace_id, case_id)


def case_ref(case_id: str, workspace_id: str | None = None) -> ResourceRef:
    return ResourceRef("support_case", case_id, workspace_id, case_id)


class RecordingNotifier:
    """Keeps every (event, action id) a delayed action reports, in order."""

    def __init__(self) -> None:
        self.events: list[tuple[str, str]] = []

    def notify(self, conn: Connection, event: str, action: Any) -> None:
        self.events.append((event, action.id))
