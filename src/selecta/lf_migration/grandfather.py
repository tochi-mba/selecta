"""Auditable grandfather population for hosted-media coexistence (BF-0465-01).

The assets table is the source of truth: a row exists only after an upload completed, and a
soft-deleted row still proves that the workspace used hosted media.  These helpers deliberately
do not mutate flags.  They produce the exact WORKSPACES rules an operator may review and an audit
that the flip guard/runbook can record before saving them.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

import sqlalchemy as sa
from sqlalchemy.engine import Connection

from selecta.flags.matching import MAX_IDS, Rule, RuleKind
from selecta.storage.schema import assets


@dataclass(frozen=True)
class GrandfatherWorkspace:
    workspace_id: str
    uploaded_assets: int
    first_upload_at: float
    last_upload_at: float
    granted: bool

    @property
    def reason(self) -> str:
        return "completed_upload" if self.granted else "completed_upload_missing_grant"


@dataclass(frozen=True)
class GrandfatherAudit:
    workspaces: tuple[GrandfatherWorkspace, ...]
    stale_grants: tuple[str, ...]

    @property
    def missing(self) -> tuple[str, ...]:
        return tuple(row.workspace_id for row in self.workspaces if not row.granted)

    @property
    def complete(self) -> bool:
        # Exact population equality is the cutover contract. A stale grant is as much an audit
        # failure as a missing one: it would quietly preserve hosted writes for an account that
        # the completed-upload query did not select.
        return not self.missing and not self.stale_grants

    def as_dict(self) -> dict[str, Any]:
        """Stable admin/runbook view of the audited population and its reasons.

        Keeping this projection beside the query prevents an operator-facing view from silently
        inventing a different definition of "grandfathered". It intentionally contains ids and
        counts only, never asset names, object keys or audio metadata.
        """
        return {
            "complete": self.complete,
            "missing": list(self.missing),
            "stale_grants": list(self.stale_grants),
            "workspaces": [
                {
                    "workspace_id": row.workspace_id,
                    "uploaded_assets": row.uploaded_assets,
                    "first_upload_at": row.first_upload_at,
                    "last_upload_at": row.last_upload_at,
                    "granted": row.granted,
                    "reason": row.reason,
                }
                for row in self.workspaces
            ],
        }


def detected_workspaces(conn: Connection) -> tuple[tuple[str, int, float, float], ...]:
    """Every workspace that ever completed an upload, deterministically ordered."""
    rows = conn.execute(
        sa.select(
            assets.c.workspace_id,
            sa.func.count(assets.c.id).label("uploaded_assets"),
            sa.func.min(assets.c.created_at).label("first_upload_at"),
            sa.func.max(assets.c.created_at).label("last_upload_at"),
        )
        .group_by(assets.c.workspace_id)
        .order_by(assets.c.workspace_id)
    )
    return tuple(
        (
            str(row.workspace_id),
            int(row.uploaded_assets),
            float(row.first_upload_at),
            float(row.last_upload_at),
        )
        for row in rows
    )


def _granted_workspace_ids(rules: Sequence[Rule]) -> set[str]:
    granted: set[str] = set()
    for rule in rules:
        if (
            rule.enabled
            and not rule.problems
            and rule.kind == RuleKind.WORKSPACES
            and rule.params.get("on") is True
        ):
            granted.update(str(item) for item in rule.params.get("ids", ()))
    return granted


def audit_grandfather_rules(conn: Connection, rules: Sequence[Rule]) -> GrandfatherAudit:
    """Compare the source-of-truth population with proposed/stored hosted-media rules."""
    detected = detected_workspaces(conn)
    wanted = {workspace_id for workspace_id, *_ in detected}
    granted = _granted_workspace_ids(rules)
    rows = tuple(
        GrandfatherWorkspace(workspace_id, count, first, last, workspace_id in granted)
        for workspace_id, count, first, last in detected
    )
    return GrandfatherAudit(rows, tuple(sorted(granted - wanted)))


def build_grandfather_rules(
    workspace_ids: Sequence[str],
    *,
    salt: str = "bf-local-first",
    note: str = "grandfathered completed uploads",
) -> tuple[Rule, ...]:
    """Build reviewed grant chunks followed by the mandatory catch-all-off rule.

    Empty/duplicate ids are refused rather than silently changing the audited population.
    """
    ids = [str(item).strip() for item in workspace_ids]
    if any(not item for item in ids):
        raise ValueError("grandfather workspace ids must be non-empty")
    if len(set(ids)) != len(ids):
        raise ValueError("grandfather workspace ids must be unique")
    ordered = sorted(ids)
    grants = [
        Rule(
            RuleKind.WORKSPACES, {"ids": ordered[index : index + MAX_IDS], "on": True, "note": note}
        )
        for index in range(0, len(ordered), MAX_IDS)
    ]
    catch_all = Rule(
        RuleKind.PERCENTAGE,
        {"percent": 0, "salt": salt, "note": "catch-all off: hosted media is grant-only"},
    )
    return tuple([*grants, catch_all])


__all__ = [
    "GrandfatherAudit",
    "GrandfatherWorkspace",
    "audit_grandfather_rules",
    "build_grandfather_rules",
    "detected_workspaces",
]
