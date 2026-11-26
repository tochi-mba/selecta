"""The upload rights statement, for workspaces that are not a business (ADR-0489, plan "two
places" 6c): `GET` and `POST /api/uploads/rights`, behind `cloud.move_to_cloud`.

Before a member's first upload from this device to the cloud library, the member reads one
short statement and confirms it. The confirmation is kept per workspace with the statement's
version, the SHA-256 of its exact words, who confirmed it and when (`rights_schema`). It holds
until the wording changes: a new wording has a new version and a new hash, and every workspace
confirms again. The upload queue on the device asks `GET` and refuses to start until the current
wording is confirmed (web/src/cloud/uploadConsent.ts).

This is the consumer counterpart of the business attestation (`business.upload_rights`, ADR-0449).
A business workspace confirms its own statement for each upload batch and is never asked this
one: `GET` answers that it does not apply and `POST` refuses.

The statement's words were approved by the owner on 2026-11-26. Changing one word means a new
`STATEMENT_VERSION`, so the confirmations already kept no longer count.

Both routes belong to `cloud.move_to_cloud`, which needs the cloud library grant: an account
without it is refused them (403 `flag_off`) by the flag guard before anything here runs. The
account export carries the rows (`export_rows`); account deletion removes them with the rest of
the workspace.
"""

from __future__ import annotations

import hashlib
from collections.abc import Callable
from typing import Any

import sqlalchemy as sa
from fastapi import Depends, FastAPI, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.engine import Connection, Engine

from selecta.billing.schema import insert_ignore
from selecta.identity.tokens import Claims
from selecta.persistence import db_now, new_id, transaction
from selecta.storage.rights_schema import upload_rights

# Approved by the owner on 2026-11-26. A change of wording is a new version.
STATEMENT_VERSION = "2026-11-26"
STATEMENT = (
    "I own these files or have the right to store copies of them for my own use. "
    "I understand SelectaDJ keeps them privately for my account."
)
WORDING_SHA256 = hashlib.sha256(STATEMENT.encode("utf-8")).hexdigest()
BUSINESS = "business"


class AcceptRights(BaseModel):
    """The version and wording hash the member was shown, so a stale page can't confirm words
    it never showed."""

    version: str = Field(min_length=1, max_length=32)
    wording_sha256: str = Field(min_length=64, max_length=64, pattern=r"^[0-9a-f]{64}$")


def applies(kind: str) -> bool:
    """Every workspace but a business one confirms this statement."""
    return kind != BUSINESS


def current(conn: Connection, workspace_id: str) -> dict[str, Any] | None:
    """This workspace's confirmation of the current wording, or None."""
    row = conn.execute(sa.select(upload_rights).where(
        upload_rights.c.workspace_id == workspace_id,
        upload_rights.c.version == STATEMENT_VERSION,
        upload_rights.c.wording_sha256 == WORDING_SHA256,
    )).mappings().first()
    return dict(row) if row else None


def accepted(conn: Connection, workspace_id: str) -> bool:
    return current(conn, workspace_id) is not None


def record(conn: Connection, workspace_id: str, user_id: str, *, now: float) -> bool:
    """Keep the confirmation of the current wording. False when it was already kept."""
    return insert_ignore(conn, upload_rights, {
        "id": new_id(),
        "workspace_id": workspace_id,
        "version": STATEMENT_VERSION,
        "wording_sha256": WORDING_SHA256,
        "user_id": user_id,
        "accepted_at": now,
    }, ("workspace_id", "version", "wording_sha256"))


def state(conn: Connection, workspace_id: str, kind: str) -> dict[str, Any]:
    """What `GET /api/uploads/rights` answers."""
    if not applies(kind):
        return {"applies": False, "reason": "business_statement", "accepted": False,
                "version": None, "statement": None, "wording_sha256": None,
                "accepted_at": None}
    found = current(conn, workspace_id)
    return {"applies": True, "reason": None, "accepted": found is not None,
            "version": STATEMENT_VERSION, "statement": STATEMENT,
            "wording_sha256": WORDING_SHA256,
            "accepted_at": found["accepted_at"] if found else None}


def export_rows(conn: Connection, workspace_id: str) -> list[dict[str, Any]]:
    """Every confirmation this workspace kept, oldest first, for the account export."""
    rows = conn.execute(
        sa.select(upload_rights.c.version, upload_rights.c.wording_sha256,
                  upload_rights.c.user_id, upload_rights.c.accepted_at)
        .where(upload_rights.c.workspace_id == workspace_id)
        .order_by(upload_rights.c.accepted_at, upload_rights.c.id)
    ).mappings().all()
    return [{**dict(row), "statement": STATEMENT if row["wording_sha256"] == WORDING_SHA256
             else None} for row in rows]


def install(app: FastAPI, *, engine: Engine, current_claims: Callable[..., Claims],
            principal_for: Callable[..., Any]) -> None:
    """Add the two routes beside the upload routes (`storage.api.install_routes`), before
    `GET /api/uploads/{session_id}`, so `rights` is never read as an upload's id."""

    def principal(request: Request, claims: Claims):
        return principal_for(engine, claims, request.headers.get("x-workspace-id"))

    @app.get("/api/uploads/rights")
    def upload_rights_state(request: Request,
                            claims: Claims = Depends(current_claims)):  # noqa: B008
        """Whether this workspace confirmed the current upload rights statement, with its words
        and version. A business workspace is told it keeps its own statement."""
        found = principal(request, claims)
        with transaction(engine, found.workspace.id) as conn:
            return state(conn, found.workspace.id, found.workspace.kind)

    @app.post("/api/uploads/rights")
    def accept_upload_rights(body: AcceptRights, request: Request,
                             claims: Claims = Depends(current_claims)):  # noqa: B008
        """Confirm the current upload rights statement for this workspace, once per wording."""
        found = principal(request, claims)
        workspace = found.workspace
        if not applies(workspace.kind):
            raise HTTPException(status_code=403, detail={
                "code": "business_statement",
                "message": "A business confirms its own statement with each upload."})
        if body.version != STATEMENT_VERSION or body.wording_sha256 != WORDING_SHA256:
            raise HTTPException(status_code=409, detail={
                "code": "stale_statement",
                "message": "The statement has changed. Read it again before confirming.",
                "version": STATEMENT_VERSION, "statement": STATEMENT,
                "wording_sha256": WORDING_SHA256})
        with transaction(engine, workspace.id) as conn:
            recorded = record(conn, workspace.id, found.user.id, now=db_now(conn))
            return {**state(conn, workspace.id, workspace.kind), "recorded": recorded}


__all__ = ["STATEMENT", "STATEMENT_VERSION", "WORDING_SHA256", "accepted", "applies",
           "current", "export_rows", "install", "record", "state"]
