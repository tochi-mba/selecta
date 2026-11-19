"""The grandfather population, its grant rules and their audit (ADR-0465, BF-0465-01).

ADR-0465 grants `cloud.hosted_media` to every workspace that ever completed an upload, by
ADR-0414 targeting rules created and verified before `cloud.local_first` defaults on
(docs/operations/bf-rollout-runbook.md, steps 2 to 4; `flags.flip_guard` re-checks the result).

- **Detection.** The `assets` table is the source of truth: `storage.uploads` inserts a row only
  when an upload is accepted, and no code path hard-deletes one (deletion sets `deleted_at` and
  the physical purge acts on objects, not rows). Soft-deleted rows count: a workspace that
  uploaded and later deleted everything still used hosted media and keeps its grant.
- **Rules.** `build_grandfather_rules` produces the runbook's order: WORKSPACES grants (`on:
  true`, chunked under `MAX_IDS`), then USERS grants for named individual exceptions, then the
  trailing catch-all off rule (a percentage rule at 0 percent, no segment conditions), which is
  exactly what `flip_guard._is_catch_all_off` recognises.
- **Audit.** `audit_grandfather_rules` evaluates the rules layer per detected workspace in
  order, first answer wins, an enabled kill switch wins everywhere (as `flags.targeting` does),
  so a grant placed below the catch-all, shadowed by an earlier off rule or killed is reported
  as missing, not as granted. `complete` means no detected workspace is missing its grant; ids
  granted beyond the population are listed as `stale_grants` but do not fail the audit, because
  ADR-0456 lets the owner grant hosted media to accounts that never uploaded. The projection
  holds ids, counts and times only: never asset names, object keys or audio metadata.

Nothing here writes flags: operators save the built rules through the reviewed flag-change path
with an author and a reason, and record `[grandfather-verified]` only once the audit is complete.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

import sqlalchemy as sa
from sqlalchemy.engine import Connection

from selecta import flags
from selecta.flags.matching import MAX_IDS, Context, Rule, RuleKind
from selecta.identity.schema import workspaces
from selecta.persistence import db_now
from selecta.storage.schema import assets

HOSTED_MEDIA = "cloud.hosted_media"
# The runbook's catch-all salt (step 3). Keep it stable: changing it reshuffles any later
# nonzero percentage of the grant.
GRANDFATHER_SALT = "bf-local-first"
CATCH_ALL_NOTE = "catch-all off: hosted media is grant-only below this line"


@dataclass(frozen=True)
class DetectedWorkspace:
    """One workspace the detection query returned: ids, counts and times only."""

    workspace_id: str
    owner_user_id: str | None
    uploaded_assets: int
    deleted_assets: int
    first_upload_at: float
    last_upload_at: float


@dataclass(frozen=True)
class GrandfatherWorkspace:
    workspace_id: str
    uploaded_assets: int
    deleted_assets: int
    first_upload_at: float
    last_upload_at: float
    granted: bool
    decided_by: str

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
        """Every detected workspace answers on at the rules layer (runbook step 4)."""
        return not self.missing

    def as_dict(self) -> dict[str, Any]:
        """The admin and runbook view. Ids, counts and times only."""
        return {
            "complete": self.complete,
            "counts": {
                "detected": len(self.workspaces),
                "granted": len(self.workspaces) - len(self.missing),
                "missing": len(self.missing),
                "stale_grants": len(self.stale_grants),
            },
            "missing": list(self.missing),
            "stale_grants": list(self.stale_grants),
            "workspaces": [
                {
                    "workspace_id": row.workspace_id,
                    "uploaded_assets": row.uploaded_assets,
                    "deleted_assets": row.deleted_assets,
                    "first_upload_at": row.first_upload_at,
                    "last_upload_at": row.last_upload_at,
                    "granted": row.granted,
                    "decided_by": row.decided_by,
                    "reason": row.reason,
                }
                for row in self.workspaces
            ],
        }


def detected_workspaces(conn: Connection) -> tuple[DetectedWorkspace, ...]:
    """Every workspace that ever completed an upload, soft-deleted assets included, ordered by
    workspace id. Run it in a system transaction (no workspace scope), or row-level security
    narrows it to one workspace on PostgreSQL."""
    deleted = sa.func.sum(sa.case((assets.c.deleted_at.is_not(None), 1), else_=0))
    rows = conn.execute(
        sa.select(
            assets.c.workspace_id,
            workspaces.c.owner_user_id,
            sa.func.count(assets.c.id).label("uploaded_assets"),
            deleted.label("deleted_assets"),
            sa.func.min(assets.c.created_at).label("first_upload_at"),
            sa.func.max(assets.c.created_at).label("last_upload_at"),
        )
        .select_from(assets.outerjoin(workspaces, workspaces.c.id == assets.c.workspace_id))
        .group_by(assets.c.workspace_id, workspaces.c.owner_user_id)
        .order_by(assets.c.workspace_id)
    )
    return tuple(
        DetectedWorkspace(
            workspace_id=str(row.workspace_id),
            owner_user_id=None if row.owner_user_id is None else str(row.owner_user_id),
            uploaded_assets=int(row.uploaded_assets),
            deleted_assets=int(row.deleted_assets or 0),
            first_upload_at=float(row.first_upload_at),
            last_upload_at=float(row.last_upload_at),
        )
        for row in rows
    )


def _granted_workspace_ids(rules: Sequence[Rule]) -> set[str]:
    """Ids named by enabled, well-formed WORKSPACES grants with `on: true`."""
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


def _rules_verdict(
    rules: Sequence[Rule], flag: flags.Flag, context: Context, now: float
) -> tuple[bool, str]:
    """The rules layer for one context, as `flags.targeting` evaluates it, minus staff previews
    (a preview is staff QA, never a grant)."""
    if any(rule.enabled and rule.kind == RuleKind.KILL_SWITCH for rule in rules):
        return False, "kill switch"
    for position, rule in enumerate(rules, start=1):
        if not rule.enabled or rule.matcher is None:
            continue
        verdict = rule.matcher(flag, context, now)
        if verdict is not None:
            return verdict, f"rule {position} ({rule.kind})"
    return True, "no rule matched"


def audit_grandfather_rules(
    conn: Connection, rules: Sequence[Rule], *, now: float | None = None
) -> GrandfatherAudit:
    """Compare the detected population with stored or proposed `cloud.hosted_media` rules.

    Each workspace is evaluated with its id and its owner's user id, so USERS exceptions for the
    owner count. Segment-conditioned rules see no plan or country and do not match here."""
    rules = tuple(rules)
    flag = flags.registry()[HOSTED_MEDIA]
    moment = db_now(conn) if now is None else now
    detected = detected_workspaces(conn)
    rows = []
    for found in detected:
        context = Context(
            mode="cloud", workspace_id=found.workspace_id, user_id=found.owner_user_id
        )
        granted, decided_by = _rules_verdict(rules, flag, context, moment)
        rows.append(
            GrandfatherWorkspace(
                workspace_id=found.workspace_id,
                uploaded_assets=found.uploaded_assets,
                deleted_assets=found.deleted_assets,
                first_upload_at=found.first_upload_at,
                last_upload_at=found.last_upload_at,
                granted=granted,
                decided_by=decided_by,
            )
        )
    wanted = {found.workspace_id for found in detected}
    stale = tuple(sorted(_granted_workspace_ids(rules) - wanted))
    return GrandfatherAudit(tuple(rows), stale)


def _clean_ids(values: Sequence[str], label: str) -> list[str]:
    ids = [str(item).strip() for item in values]
    if any(not item for item in ids):
        raise ValueError(f"grandfather {label} ids must be non-empty")
    if len(set(ids)) != len(ids):
        raise ValueError(f"grandfather {label} ids must be unique")
    return sorted(ids)


def _chunks(kind: RuleKind, ids: list[str], note: str) -> list[Rule]:
    return [
        Rule(kind, {"ids": ids[start : start + MAX_IDS], "on": True, "note": note})
        for start in range(0, len(ids), MAX_IDS)
    ]


def build_grandfather_rules(
    workspace_ids: Sequence[str],
    *,
    user_ids: Sequence[str] = (),
    salt: str = GRANDFATHER_SALT,
    note: str = "grandfathered: completed uploads",
) -> tuple[Rule, ...]:
    """The runbook's rule list: WORKSPACES grants (sorted, chunked under `MAX_IDS`), USERS
    grants for the individual exceptions the audit names, then the trailing catch-all off rule.

    `note` should name the detection query's date. Empty or duplicate ids are refused rather
    than silently changing the audited population. An empty population yields the catch-all
    alone, which the flip guard refuses (no grant), as it should until someone has uploaded."""
    grants = _chunks(RuleKind.WORKSPACES, _clean_ids(workspace_ids, "workspace"), note)
    grants += _chunks(RuleKind.USERS, _clean_ids(user_ids, "user"), note)
    catch_all = Rule(RuleKind.PERCENTAGE, {"percent": 0, "salt": salt, "note": CATCH_ALL_NOTE})
    return (*grants, catch_all)


__all__ = [
    "CATCH_ALL_NOTE",
    "GRANDFATHER_SALT",
    "DetectedWorkspace",
    "GrandfatherAudit",
    "GrandfatherWorkspace",
    "audit_grandfather_rules",
    "build_grandfather_rules",
    "detected_workspaces",
]
