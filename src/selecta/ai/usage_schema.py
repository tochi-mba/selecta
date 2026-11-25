"""Lucy's usage allowance tables (ADR-0481, ADR-0482, ADR-0486, ADR-0487).

Every amount is a whole number of usage units. One unit is a millionth of a US dollar of model
cost, so amounts are `BigInteger` and are never rounded the way a float would be.

All three tables are tenant data: each row belongs to one workspace, and none names a person.

- `lucy_usage_state` is one row per workspace: its week, its rolling session window, and what is
  used and reserved in each. Limits are checked and reserved in that single row.
- `lucy_usage_ledger` is one row per Lucy run: what the run reserved, what it was charged, and
  the week and session it counted against. `run_id` is unique, so a run is charged once.
- `lucy_usage_packs` is one row per prepaid pack of extra usage. `payment_id` is unique, so a
  replayed payment webhook credits a pack once.

`run_id` and `answered_deployment_id` hold ids of `ai_runs` and `model_deployments` rows without
a foreign key, as the other gateway tables do.
"""

from __future__ import annotations

import sqlalchemy as sa

from selecta.ai.schema import insert_ignore
from selecta.persistence import Epoch, Id, metadata

Units = sa.BigInteger

lucy_usage_state = sa.Table(
    "lucy_usage_state",
    metadata,
    sa.Column("id", Id, primary_key=True),
    sa.Column("workspace_id", Id, nullable=False, unique=True),
    # The week starts at `anchor_hour` on `anchor_weekday` (0 is Monday) in `time_zone`.
    sa.Column("time_zone", sa.String(64), nullable=False),
    sa.Column("anchor_weekday", sa.SmallInteger, nullable=False),
    sa.Column("anchor_hour", sa.SmallInteger, nullable=False),
    sa.Column("plan_id", sa.String(16), nullable=False),
    sa.Column("catalogue_version", sa.Integer, nullable=False),
    sa.Column("week_seq", sa.Integer, nullable=False),
    sa.Column("week_started_at", Epoch, nullable=False),
    sa.Column("week_ends_at", Epoch, nullable=False),
    sa.Column("week_limit", Units, nullable=False),
    sa.Column("week_used", Units, nullable=False, server_default="0"),
    sa.Column("week_reserved", Units, nullable=False, server_default="0"),
    sa.Column("session_seq", sa.Integer, nullable=False, server_default="0"),
    sa.Column("session_ends_at", Epoch),
    # Null means no session window, as for a venue pool.
    sa.Column("session_limit", Units),
    sa.Column("session_used", Units, nullable=False, server_default="0"),
    sa.Column("session_reserved", Units, nullable=False, server_default="0"),
    sa.Column("session_notice_seq", sa.Integer),
    sa.Column("eligible_at", Epoch),
    sa.Column("cutover_at", Epoch),
    sa.Column("enforced_since", Epoch),
    sa.Column("notice_sent_at", Epoch),
    sa.Column("extra_confirmed_week_seq", sa.Integer),
    # A per-account override of the plan's multiplier, in thousandths (ADR-0485). Null means
    # no override; 0 means Lucy is off for this account.
    sa.Column("override_multiplier_milli", sa.Integer),
    sa.Column("created_at", Epoch, nullable=False),
    sa.Column("updated_at", Epoch, nullable=False),
)

lucy_usage_ledger = sa.Table(
    "lucy_usage_ledger",
    metadata,
    sa.Column("id", Id, primary_key=True),
    sa.Column("workspace_id", Id, nullable=False),
    sa.Column("run_id", Id, nullable=False, unique=True),
    # "shadow" or "enforced".
    sa.Column("mode", sa.String(8), nullable=False),
    # "plan", "venue" or "extra".
    sa.Column("pool", sa.String(8), nullable=False),
    sa.Column("tier", sa.String(16), nullable=False),
    sa.Column("catalogue_version", sa.Integer, nullable=False),
    sa.Column("week_seq", sa.Integer, nullable=False),
    sa.Column("session_seq", sa.Integer),
    sa.Column("week_ends_at", Epoch, nullable=False),
    sa.Column("session_ends_at", Epoch),
    sa.Column("reserved_units", Units, nullable=False, server_default="0"),
    # Null until the run is settled.
    sa.Column("charged_units", Units),
    sa.Column("cause", sa.String(16)),
    sa.Column("answered_deployment_id", Id),
    sa.Column("outcome", sa.String(16)),
    sa.Column("created_at", Epoch, nullable=False),
    sa.Column("settled_at", Epoch),
    sa.Index("ix_lucy_usage_ledger_workspace_id_created_at", "workspace_id", "created_at"),
)

lucy_usage_packs = sa.Table(
    "lucy_usage_packs",
    metadata,
    sa.Column("id", Id, primary_key=True),
    sa.Column("workspace_id", Id, nullable=False),
    # The payment provider's id for this purchase.
    sa.Column("payment_id", sa.String(128), nullable=False, unique=True),
    sa.Column("units", Units, nullable=False),
    sa.Column("remaining_units", Units, nullable=False),
    sa.Column("bought_at", Epoch, nullable=False),
    sa.Column("expires_at", Epoch, nullable=False),
    sa.Column("refunded_at", Epoch),
    sa.Column("created_at", Epoch, nullable=False),
    sa.Index("ix_lucy_usage_packs_workspace_id_expires_at", "workspace_id", "expires_at"),
)

ALL_TABLES = (lucy_usage_state, lucy_usage_ledger, lucy_usage_packs)

__all__ = [
    "ALL_TABLES",
    "insert_ignore",
    "lucy_usage_ledger",
    "lucy_usage_packs",
    "lucy_usage_state",
]
