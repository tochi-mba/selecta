"""Making the very first Owner, once, from an operator's shell (doc 07 §7.4, doc 07b).

Every later Owner goes through `assignments.propose_owner()`: a dangerous action that waits 15
minutes or needs a second approver. The first one can't, because nobody holds the permission to
propose it. `first_owner()` is the only way in:

- it finds the SelectaDJ account by its sign-in email (the person must have signed in once);
- it refuses when any active Owner exists, so it can't be used to add a second one quietly;
- it refuses a suspended or deleted account;
- it takes a database lock first on PostgreSQL, so two shells racing can't both succeed;
- `bootstrap_owner()` writes the assignment, revokes the person's sessions and audits
  `role.assigned` with the issuer `bootstrap`; this adds an `admin.owner.bootstrap` audit row
  saying where it came from, and raises a platform alert so a later Owner can see it happened.

It returns the user id and nothing else, so a shell log never holds more than that.
"""

from __future__ import annotations

import platform

import sqlalchemy as sa
from sqlalchemy.engine import Engine

from selecta.admin import alerts
from selecta.authz import audit
from selecta.authz.assignments import BOOTSTRAP_ISSUER, bootstrap_owner
from selecta.authz.check import platform_owners
from selecta.identity.schema import users
from selecta.persistence import transaction

LOCK_KEY = 7_407_001  # pg_advisory_xact_lock key for the first-Owner bootstrap


class BootstrapRefused(Exception):
    """The first Owner can't be made as asked. The message is safe to print."""


def first_owner(engine: Engine, email: str, *, reason: str, via: str = "cli") -> str:
    """Make the account signed in as `email` the first Owner. Returns its user id."""
    wanted = email.strip()
    if not wanted or "@" not in wanted:
        raise BootstrapRefused("Give the email address the person signs in with.")
    if len(reason.strip()) < 10:
        raise BootstrapRefused("Give a reason of at least 10 characters; it goes in the audit log.")
    with transaction(engine) as conn:
        if conn.dialect.name == "postgresql":
            conn.execute(sa.text("SELECT pg_advisory_xact_lock(:key)"), {"key": LOCK_KEY})
        if platform_owners(conn):
            raise BootstrapRefused(
                "An Owner already exists. Make another through the console "
                "(Security, Staff, Make Owner), which waits 15 minutes."
            )
        rows = conn.execute(
            sa.select(users.c.id, users.c.suspended_at).where(
                sa.func.lower(users.c.email) == wanted.lower(), users.c.deleted_at.is_(None)
            )
        ).all()
        if not rows:
            raise BootstrapRefused(
                "No SelectaDJ account uses that email. Sign in to the site once first."
            )
        if len(rows) > 1:
            raise BootstrapRefused("More than one account uses that email; ask an engineer.")
        user_id, suspended_at = rows[0]
        if suspended_at is not None:
            raise BootstrapRefused("That account is suspended; restore it first.")
        made = bootstrap_owner(conn, user_id, reason=reason.strip())
        audit.record(
            conn,
            actor_id=BOOTSTRAP_ISSUER,
            action="admin.owner.bootstrap",
            result=audit.AuditResult.SUCCESS,
            resource_type="role_assignment",
            resource_id=user_id,
            reason=reason.strip(),
            metadata={"assignment_id": made.id, "via": via, "host": platform.node()[:64]},
        )
        alerts.raise_alert(
            conn,
            alerts.OWNER_BOOTSTRAPPED,
            f"The first Owner was made from {via} for user {user_id}.",
            actor_id=user_id,
            metadata={"assignment_id": made.id, "via": via},
        )
        return user_id


__all__ = ["BootstrapRefused", "first_owner"]
