"""Where an organisation's setup checklist stands, and its business details (ADR-0453 D6).

One row per organisation (migration bz0453setup01). `progress` is the checklist the onboarding
page reads back after a refresh (`done`, `skipped`, `current`, `venue_id`, `draft`); `details`
holds the business details step (country, billing email, VAT and PO numbers) until the billing
profile (ADR-0447) takes them over. Tenant data: forced `workspace_isolation` on PostgreSQL.
"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from selecta.persistence import Epoch, Id, metadata

Json = sa.JSON().with_variant(postgresql.JSONB(), "postgresql")

business_setup = sa.Table(
    "business_setup",
    metadata,
    sa.Column("workspace_id", Id, primary_key=True),
    sa.Column("organisation_id", Id, nullable=False),
    sa.Column("progress", Json, nullable=False),
    sa.Column("details", Json, nullable=False),
    sa.Column("updated_at", Epoch, nullable=False),
    sa.Column("updated_by", Id),
)

ALL_TABLES = [business_setup]
