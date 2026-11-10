"""every artifact records its checksum and provenance: both columns become NOT NULL

Revision ID: a3f8d2c61b97
Revises: 7c1e9a4b2f30
Create Date: 2026-11-10

Every artifact row records the SHA-256 of its bytes and the inputs, versions, model checkpoints
and settings hash it was made from (ADR-0397, SC-0397-03; docs/saas/10-audio-engine-in-cloud.md
§10.6). The shape is checked by `selecta.work.provenance` on every publish and complete path; this
migration makes the database refuse a row without either.

Existing rows: the only producer so far is `play.proxy`, which always sent a checksum (the cloud
output check refuses an output without one) and a flat provenance object
(`source_sha256`, `sample_rate`, `proxy_version`, `codec`, `bits`). Those rows are rewritten into
the shared shape here; their input hashes and keys are untouched, since the input hash is still
the hash of that flat object. A row with no checksum, or with a provenance this migration can't
rewrite, can't have been made by any shipped producer, and nothing could say what made it, so
the upgrade stops and names how many there are instead of inventing a history for them.

Downgrade only lets the columns hold NULL again; rows keep the shared shape, which the earlier
code stored and read as opaque JSON.
"""

import hashlib
import json
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "a3f8d2c61b97"
down_revision: str | Sequence[str] | None = "7c1e9a4b2f30"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

FLAT_PLAYBACK = {"source_sha256", "sample_rate", "proxy_version", "codec", "bits"}
SHARED = {"inputs", "versions", "settings_hash"}


def _json() -> sa.types.TypeEngine:
    from sqlalchemy.dialects import postgresql

    return sa.JSON().with_variant(postgresql.JSONB(), "postgresql")


def _rewritten(value: dict) -> dict:
    """The shared shape for a flat `play.proxy` provenance (as `work.provenance.build` makes)."""
    settings = {"sample_rate": value["sample_rate"], "codec": value["codec"], "bits": value["bits"]}
    text = json.dumps(settings, sort_keys=True, separators=(",", ":"))
    return {
        "inputs": {"source": value["source_sha256"]},
        "versions": {"proxy": value["proxy_version"]},
        "settings": settings,
        "settings_hash": hashlib.sha256(text.encode()).hexdigest(),
    }


def upgrade() -> None:
    connection = op.get_bind()
    table = sa.table(
        "artifacts",
        sa.column("id", sa.String),
        sa.column("checksum", sa.String),
        sa.column("provenance", _json()),
    )
    unknown = 0
    for row in connection.execute(sa.select(table.c.id, table.c.checksum, table.c.provenance)):
        value = row.provenance
        if isinstance(value, dict) and set(value) == FLAT_PLAYBACK:
            connection.execute(
                table.update().where(table.c.id == row.id).values(provenance=_rewritten(value))
            )
        elif not row.checksum or not isinstance(value, dict) or not SHARED <= set(value):
            unknown += 1
    if unknown:
        raise RuntimeError(
            f"{unknown} artifact rows have no checksum or no provenance Selecta can read. Nothing "
            "shipped writes such rows; find what made them before upgrading (see this migration)."
        )
    with op.batch_alter_table("artifacts") as batch:
        batch.alter_column("checksum", existing_type=sa.String(length=128), nullable=False)
        batch.alter_column("provenance", existing_type=_json(), nullable=False)


def downgrade() -> None:
    with op.batch_alter_table("artifacts") as batch:
        batch.alter_column("provenance", existing_type=_json(), nullable=True)
        batch.alter_column("checksum", existing_type=sa.String(length=128), nullable=True)
