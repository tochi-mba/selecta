"""Billing tables (ADR-0403): Stripe subscriptions, entitlement snapshots, events, overrides and
checkout consent.

Stripe collects the money and Selecta owns the entitlement. `subscriptions` mirrors what Stripe
last said about each subscription. `entitlement_snapshots` is what that means for a workspace,
written as a new row with a higher version whenever the answer changes, so the history is kept.
Staff overrides sit in their own table and never pretend Stripe charged anyone.

`stripe_events` is platform-wide: an event arrives before anyone knows its workspace. It keeps
only the event's pointers (subscription, customer, charge), since processing re-fetches the
truth from Stripe anyway.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql, sqlite
from sqlalchemy.engine import Connection

from selecta.persistence import Epoch, Id, metadata

Json = sa.JSON().with_variant(postgresql.JSONB(), "postgresql")

subscriptions = sa.Table(
    "subscriptions",
    metadata,
    sa.Column("id", Id, primary_key=True),
    sa.Column("workspace_id", Id, nullable=False, index=True),
    sa.Column("stripe_customer_id", sa.String(255), index=True),
    sa.Column("stripe_subscription_id", sa.String(255), nullable=False, unique=True),
    sa.Column("status", sa.String(32), nullable=False),
    sa.Column("price_id", sa.String(255)),
    sa.Column("current_period_end", Epoch),
    sa.Column("cancel_at_period_end", sa.Boolean, nullable=False),
    sa.Column("past_due_since", Epoch),
    sa.Column("dispute_lost_at", Epoch),
    sa.Column("raw", Json, nullable=False),
    sa.Column("created_at", Epoch, nullable=False),
    sa.Column("updated_at", Epoch, nullable=False),
)

entitlement_snapshots = sa.Table(
    "entitlement_snapshots",
    metadata,
    sa.Column("id", Id, primary_key=True),
    sa.Column("workspace_id", Id, nullable=False, index=True),
    sa.Column("version", sa.Integer, nullable=False),
    sa.Column("plan_id", sa.String(32), nullable=False),
    sa.Column("plan_version", sa.Integer),
    sa.Column("source", sa.String(16), nullable=False),
    sa.Column("reason", sa.String(32), nullable=False),
    sa.Column("stripe_subscription_id", sa.String(255)),
    sa.Column("valid_until", Epoch),
    sa.Column("computed_at", Epoch, nullable=False),
    sa.Column("verified_at", Epoch, nullable=False),
    sa.UniqueConstraint("workspace_id", "version"),
)

stripe_events = sa.Table(
    "stripe_events",
    metadata,
    sa.Column("id", Id, primary_key=True),
    sa.Column("event_id", sa.String(255), nullable=False, unique=True),
    sa.Column("type", sa.String(128), nullable=False),
    sa.Column("livemode", sa.Boolean, nullable=False),
    sa.Column("stripe_created", Epoch),
    sa.Column("refs", Json, nullable=False),
    sa.Column("received_at", Epoch, nullable=False),
    sa.Column("processed_at", Epoch),
    sa.Column("status", sa.String(16), nullable=False),
    sa.Column("attempts", sa.Integer, nullable=False),
    sa.Column("error", sa.Text),
    sa.Index("ix_stripe_events_status_received_at", "status", "received_at"),
)

entitlement_overrides = sa.Table(
    "entitlement_overrides",
    metadata,
    sa.Column("id", Id, primary_key=True),
    sa.Column("workspace_id", Id, nullable=False, index=True),
    sa.Column("plan_id", sa.String(32), nullable=False),
    sa.Column("reason", sa.Text, nullable=False),
    sa.Column("actor", sa.String(256), nullable=False),
    sa.Column("expires_at", Epoch, nullable=False),
    sa.Column("created_at", Epoch, nullable=False),
    sa.Column("revoked_at", Epoch),
    sa.Column("revoked_by", sa.String(256)),
)

checkout_consents = sa.Table(
    "checkout_consents",
    metadata,
    sa.Column("id", Id, primary_key=True),
    sa.Column("workspace_id", Id, nullable=False, index=True),
    sa.Column("user_id", Id, nullable=False),
    sa.Column("consent_text_version", sa.String(64), nullable=False),
    sa.Column("accepted_at", Epoch, nullable=False),
    sa.Column("ip_hash", sa.String(64)),
    sa.Column("checkout_session_id", sa.String(255), index=True),
    sa.Column("stripe_subscription_id", sa.String(255)),
)


def insert_ignore(
    conn: Connection, table: sa.Table, values: Mapping[str, Any], conflict: Sequence[str]
) -> bool:
    """Insert one row unless one with the same `conflict` columns exists. True when inserted.

    `ON CONFLICT DO NOTHING` on both engines, so a duplicate never aborts a PostgreSQL
    transaction the way a caught IntegrityError would.
    """
    if conn.dialect.name == "postgresql":
        statement = postgresql.insert(table)
    elif conn.dialect.name == "sqlite":
        statement = sqlite.insert(table)
    else:
        raise RuntimeError(f"Unsupported database: {conn.dialect.name}")
    statement = statement.values(**values).on_conflict_do_nothing(index_elements=list(conflict))
    return conn.execute(statement).rowcount == 1
