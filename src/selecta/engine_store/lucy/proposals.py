"""Lucy's proposals, their immutable revisions, approvals and commit records through the store."""

from __future__ import annotations

from typing import Any

import sqlalchemy as sa

from selecta.engine_store.lucy import Tx
from selecta.engine_store.schema import (
    drafts,
    lucy_approvals,
    lucy_commits,
    lucy_conversations,
    lucy_proposals,
    lucy_revisions,
)
from selecta.lucy import ids


def proposal_of(tx: Tx, conversation: str) -> tuple[bool, str | None]:
    """Whether the conversation is there, and its proposal if it has one."""
    found = tx.row(lucy_conversations, id=conversation)
    return (found is not None, found["proposal_id"] if found is not None else None)


def ensure(tx: Tx, conversation: str) -> str:
    """`proposals.ensure_proposal` for a conversation that has none yet."""
    proposal = ids.new_id("proposal")
    stamp = ids.now_iso()
    tx.insert(lucy_proposals, id=proposal, conversation_id=conversation, created_at=stamp,
              updated_at=stamp)
    tx.update(lucy_conversations, {"id": conversation}, proposal_id=proposal)
    return proposal


def proposal(tx: Tx, proposal_id: str):
    return tx.row(lucy_proposals, id=proposal_id)


def revision(tx: Tx, revision_id: str):
    return tx.row(lucy_revisions, id=revision_id)


def next_number(tx: Tx, proposal_id: str) -> int:
    top = tx.scalar(
        sa.select(sa.func.max(lucy_revisions.c.number)).where(
            tx.where(lucy_revisions, proposal_id=proposal_id)
        )
    )
    return int(top or 0) + 1


def add_revision(tx: Tx, **values: Any) -> None:
    tx.insert(lucy_revisions, **values)


def make_current(tx: Tx, proposal_id: str, revision_id: str) -> None:
    tx.update(lucy_proposals, {"id": proposal_id}, current_revision=revision_id,
              updated_at=ids.now_iso())


def revisions(tx: Tx, proposal_id: str) -> list:
    return tx.all(
        sa.select(lucy_revisions)
        .where(tx.where(lucy_revisions, proposal_id=proposal_id))
        .order_by(lucy_revisions.c.number.desc())
    )


def current_snapshots(tx: Tx) -> list:
    """Each proposal's current snapshot and when the proposal last changed (`pinned_keys`)."""
    p, r = lucy_proposals, lucy_revisions
    joined = p.join(r, sa.and_(r.c.id == p.c.current_revision,
                               r.c.workspace_id == p.c.workspace_id))
    return tx.all(sa.select(r.c.snapshot, p.c.updated_at).select_from(joined)
                  .where(tx.store.mine(p)))


# ---- approvals and commits


def add_approval(tx: Tx, token: str, revision_id: str, digest: str, action: str,
                 expires: int) -> None:
    tx.insert(lucy_approvals, token=token, revision_id=revision_id, hash=digest, action=action,
              expires_at=expires, created_at=ids.now_iso())


def approval(tx: Tx, token: str):
    return tx.row(lucy_approvals, token=token)


def claim(tx: Tx, token: str) -> bool:
    """Use an approval once: False when it was already used."""
    return tx.update(lucy_approvals, {"token": token, "used": 0}, used=1) > 0


def commit_row(tx: Tx, key: str):
    return tx.row(lucy_commits, idempotency_key=key)


def add_commit(tx: Tx, key: str, revision_id: str, digest: str, action: str, created: str,
               status: str, draft: int | None, result: str) -> None:
    tx.insert(lucy_commits, idempotency_key=key, revision_id=revision_id, hash=digest,
              action=action, status=status, draft_id=draft, result=result, created_at=created,
              updated_at=ids.now_iso())


def finish_commit(tx: Tx, key: str, status: str, draft: int | None, result: str) -> None:
    tx.update(lucy_commits, {"idempotency_key": key}, status=status, draft_id=draft,
              result=result, updated_at=ids.now_iso())


def draft_with(tx: Tx, items: str):
    """The newest draft holding exactly these items, for a commit left pending by a crash."""
    return tx.one(
        sa.select(drafts.c.id, drafts.c.name)
        .where(tx.where(drafts, items=items))
        .order_by(drafts.c.id.desc())
        .limit(1)
    )


def set_ready_only(tx: Tx, draft: int, ready_only: bool) -> None:
    tx.update(drafts, {"id": draft}, ready_only=1 if ready_only else 0)


__all__ = [
    "add_approval",
    "add_commit",
    "add_revision",
    "approval",
    "claim",
    "commit_row",
    "current_snapshots",
    "draft_with",
    "ensure",
    "finish_commit",
    "make_current",
    "next_number",
    "proposal",
    "proposal_of",
    "revision",
    "revisions",
    "set_ready_only",
]
