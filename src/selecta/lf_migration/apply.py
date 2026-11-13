"""Opt-in, version-fenced adapter driver for Agent 04 canonical recipe writes.

No SQL DML is implemented here. A production Agent 04 writer must explicitly
implement this port, including row-level security, atomic upsert, immutable
revision preservation and compensation. The default run path only plans.
"""
from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Protocol

from .backfill import LocalPlanJournal, MigrationConflict, SIDECAR_SCHEMA


class RecipeProjectionWriter(Protocol):
    @property
    def recipe_schema(self) -> str:
        """Exact canonical recipe schema supported by the writer."""

    def upsert_sidecar(
        self,
        workspace_id: str,
        legacy_revision_id: str,
        sidecar: Mapping[str, Any],
        *,
        idempotency_key: str,
    ) -> None:
        """Perform an atomic idempotent upsert, never overwrite legacy history."""

    def rollback_sidecar(
        self,
        workspace_id: str,
        legacy_revision_id: str,
        *,
        idempotency_key: str,
    ) -> None:
        """Remove only this migration's projection, NEVER the old revision."""


def _validate(
    journal: LocalPlanJournal, plan_id: str, writer: RecipeProjectionWriter,
    expected_recipe_schema: str,
) -> dict[str, Any]:
    record = journal.read(plan_id)
    if record is None:
        raise MigrationConflict("prepare the plan before attempting application")
    if record["state"] == "rolled_back":
        raise MigrationConflict("rolled-back plan cannot be applied")
    if record["plan"]["schema"] != SIDECAR_SCHEMA:
        raise MigrationConflict("invalid sidecar contract")
    if not expected_recipe_schema or writer.recipe_schema != expected_recipe_schema:
        raise MigrationConflict("Agent 04 recipe schema mismatch; refusing writes")
    return record


def apply_prepared_plan(
    journal: LocalPlanJournal,
    plan_id: str,
    writer: RecipeProjectionWriter,
    *,
    expected_recipe_schema: str,
    approved: bool = False,
) -> dict[str, Any]:
    """Explicitly approved application through an injected, version-fenced writer.

    A crash after upsert but before journal checkpoint is handled by replaying
    the same idempotency key. The writer MUST enforce append-only legacy
    revisions and the intended tenant within one transaction. If any upsert
    fails, the journal retains progress and untouched references.
    """
    if not approved:
        raise PermissionError("backfill writes are disabled without explicit approval")
    record = _validate(journal, plan_id, writer, expected_recipe_schema)
    for projection in record["plan"]["revisions"]:
        revision = projection["legacy_revision_id"]
        if revision in record["completed"]:
            continue
        writer.upsert_sidecar(
            record["plan"]["workspace_id"],
            revision,
            projection,
            idempotency_key=f"{plan_id}:{revision}",
        )
        record = journal.checkpoint(plan_id, revision, approved=True)
    return record


def rollback_prepared_plan(
    journal: LocalPlanJournal,
    plan_id: str,
    writer: RecipeProjectionWriter,
    *,
    expected_recipe_schema: str,
    approved: bool = False,
) -> dict[str, Any]:
    """Compensate projections only; local music and legacy history are untouched.

    If compensation fails midway, the journal remains resumable with the list
    of projections not yet compensated. Completion marks the plan rolled back.
    """
    if not approved:
        raise PermissionError("rollback is disabled without explicit approval")
    record = _validate(journal, plan_id, writer, expected_recipe_schema)
    for revision in list(reversed(record["completed"])):
        writer.rollback_sidecar(
            record["plan"]["workspace_id"],
            revision,
            idempotency_key=f"{plan_id}:{revision}",
        )
        record["completed"].remove(revision)
        record["state"] = "in_progress"
        journal._atomic(journal._path(plan_id), record)
    return journal.rollback(plan_id, approved=True)
