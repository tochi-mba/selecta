"""Licensing, play-log retention, ISRC and business terms routes (ADR-0449), behind
`business.licensing`. Every route acts in the request's business workspace.

- `GET|PUT /api/business/play-log/retention`: how long play logs are kept (3 years by default;
  1 to 3650 days). Everyone who may export reads it; only the owner changes it. The maintenance
  pass deletes rows past it (`licensing_jobs`), nothing else ever deletes a play.
- `GET /api/business/venues/{venue_id}/licence/state`: the playback gate's answer for the venue
  (valid, grace, extended grace, expired), for managers.
- `POST /api/business/venues/{venue_id}/licence/extend`: the owner's one-off grace extension,
  with a reason, audited.
- `PUT /api/business/library/songs/{song_id}/isrc`: enter or correct a track's ISRC by hand,
  audited; exports show the correction and the original stays in the history.
- `GET /api/business/venues/{venue_id}/isrc-coverage`: the share of tracks played there with
  an ISRC.
- `GET /api/business/uploads/statement`, `POST /api/business/uploads/attestation`: the upload
  rights statement and an attested batch for the next N files (`upload_rights`).
- `GET|PUT /api/business/settings/mix-exports`: business mix exports, off by default; on only
  with the owner's setting and the `business.mix_exports` flag (`derived_limits`).
- `GET /api/business/terms` and `POST /api/business/terms/accept`: whether the current business
  terms are accepted; an owner or admin accepts them. Playback never waits on terms.
"""

from __future__ import annotations

from collections.abc import Callable, Iterator
from contextlib import contextmanager
from typing import Any

from fastapi import Depends, FastAPI, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.engine import Connection, Engine

from selecta.business import derived_limits, isrc, licensing, playlog, terms
from selecta.business.commercial_facts import MANAGER_ROLES, FactsSource, SqlFacts
from selecta.business.errors import BusinessError
from selecta.identity.tokens import Claims
from selecta.persistence import db_now, new_id, transaction

NOT_FOUND = {"code": "not_found"}


class RetentionBody(BaseModel):
    days: int = Field(ge=playlog.MIN_RETENTION_DAYS, le=playlog.MAX_RETENTION_DAYS)


class ExtendBody(BaseModel):
    reason: str = Field(min_length=3, max_length=500)
    days: int = Field(default=licensing.GRACE_DAYS, ge=1, le=licensing.MAX_EXTENSION_DAYS)


class AttestBody(BaseModel):
    file_count: int = Field(ge=1, le=1000)
    statement_version: str = Field(min_length=1, max_length=32)
    attested: bool
    venue_id: str | None = Field(default=None, max_length=64)


class MixExportBody(BaseModel):
    enabled: bool


class IsrcBody(BaseModel):
    isrc: str | None = Field(default=None, max_length=32)


def _flag_on(flag: str) -> bool:
    from selecta import flags

    try:
        return flags.on(flag)
    except KeyError:
        return False


def _role(found: Any) -> str:
    role = found.workspace_role
    return str(getattr(role, "value", role))


def _refuse(error: Exception) -> HTTPException:
    if isinstance(error, HTTPException):
        return error
    forbidden = isinstance(error, (licensing.LicensingForbidden, terms.TermsForbidden))
    return HTTPException(status_code=403 if forbidden else 422, detail={
        "code": getattr(error, "code", "refused"), "message": str(error)})


def install_routes(
    app: FastAPI, *, engine: Engine, current_claims: Callable[..., Claims],
    principal_for: Callable[..., Any], facts: FactsSource | None = None,
) -> None:
    facts_source: FactsSource = facts or SqlFacts()

    @contextmanager
    def member(
        request: Request, claims: Claims, roles: frozenset[str] = MANAGER_ROLES,
    ) -> Iterator[tuple[Connection, Any, Any, float]]:
        found = principal_for(engine, claims, request.headers.get("x-workspace-id"))
        if found.workspace.kind != "business":
            raise HTTPException(status_code=404, detail=dict(NOT_FOUND))
        if _role(found) not in roles:
            raise HTTPException(status_code=403, detail={"code": "forbidden"})
        try:
            with transaction(engine, found.workspace.id) as conn:
                org = facts_source.organisation(conn, found.workspace.id)
                if org is None:
                    raise HTTPException(status_code=404, detail=dict(NOT_FOUND))
                yield conn, org, found, float(db_now(conn))
        except (BusinessError, ValueError, HTTPException) as error:
            raise _refuse(error) from error

    def venue_of(org: Any, venue_id: str) -> Any:
        venue = org.venue(venue_id)
        if venue is None:
            raise HTTPException(status_code=404, detail=dict(NOT_FOUND))
        return venue

    @app.get("/api/business/play-log/retention")
    def retention(request: Request, claims: Claims = Depends(current_claims)):  # noqa: B008
        with member(request, claims) as (conn, org, _found, _now):
            return {"days": playlog.retention_days(conn, org.organisation_id),
                    "default_days": playlog.DEFAULT_RETENTION_DAYS}

    @app.put("/api/business/play-log/retention")
    def set_retention(
        body: RetentionBody, request: Request, claims: Claims = Depends(current_claims),  # noqa: B008
    ):
        with member(request, claims, frozenset({"owner"})) as (conn, org, found, now):
            return {"days": playlog.set_retention_days(conn, org, body.days,
                                                       actor=found.user.id, now=now)}

    @app.get("/api/business/venues/{venue_id}/licence/state")
    def licence_state(
        venue_id: str, request: Request, claims: Claims = Depends(current_claims),  # noqa: B008
    ):
        with member(request, claims) as (conn, org, _found, now):
            venue_of(org, venue_id)
            return licensing.licence_state(conn, venue_id, now).to_dict()

    @app.post("/api/business/venues/{venue_id}/licence/extend")
    def extend(
        venue_id: str, body: ExtendBody, request: Request,
        claims: Claims = Depends(current_claims),  # noqa: B008
    ):
        with member(request, claims, frozenset({"owner"})) as (conn, org, found, now):
            venue_of(org, venue_id)
            made = licensing.extend_grace_once(conn, org, venue_id, actor_user_id=found.user.id,
                                               reason=body.reason, now=now, days=body.days)
        return {"extended_until": made["extended_until"]}

    @app.put("/api/business/library/songs/{song_id}/isrc")
    def set_isrc(
        song_id: str, body: IsrcBody, request: Request,
        claims: Claims = Depends(current_claims),  # noqa: B008
    ):
        with member(request, claims, frozenset({"owner", "admin"})) as (conn, org, found, now):
            isrc.set_manual(conn, workspace_id=org.workspace_id,
                            organisation_id=org.organisation_id, track_id=song_id,
                            isrc=body.isrc, actor=found.user.id, now=now)
            current = isrc.current_isrc(conn, org.workspace_id, song_id)
        return {"song_id": song_id, "isrc": current}

    @app.get("/api/business/venues/{venue_id}/isrc-coverage")
    def isrc_coverage(
        venue_id: str, request: Request, claims: Claims = Depends(current_claims),  # noqa: B008
    ):
        with member(request, claims) as (conn, org, _found, _now):
            venue_of(org, venue_id)
            return isrc.coverage(conn, org.workspace_id, org.organisation_id,
                                 venue_id).to_dict()

    @app.get("/api/business/uploads/statement")
    def upload_statement(request: Request, claims: Claims = Depends(current_claims)):  # noqa: B008
        with member(request, claims, frozenset({"owner", "admin", "venue_manager"})):
            return {"statement": terms.UPLOAD_STATEMENT,
                    "statement_version": terms.CURRENT_UPLOAD_STATEMENT_VERSION}

    @app.post("/api/business/uploads/attestation", status_code=201)
    def attest_upload(
        body: AttestBody, request: Request, claims: Claims = Depends(current_claims),  # noqa: B008
    ):
        uploaders = frozenset({"owner", "admin", "venue_manager"})
        with member(request, claims, uploaders) as (conn, org, found, now):
            made = terms.record_upload_attestation(
                conn, org, new_id(), found.user.id, body.file_count, body.statement_version,
                now=now, attested=body.attested, venue_id=body.venue_id or "")
        return {"batch_id": made["batch_id"], "file_count": made["file_count"]}

    @app.get("/api/business/settings/mix-exports")
    def mix_exports(request: Request, claims: Claims = Depends(current_claims)):  # noqa: B008
        with member(request, claims) as (conn, org, _found, _now):
            decision = derived_limits.mix_export_decision(conn, org.organisation_id, _flag_on)
        return {"allowed": decision.allowed, "reason": decision.reason}

    @app.put("/api/business/settings/mix-exports")
    def set_mix_exports(
        body: MixExportBody, request: Request, claims: Claims = Depends(current_claims),  # noqa: B008
    ):
        with member(request, claims, frozenset({"owner"})) as (conn, org, found, now):
            derived_limits.set_mix_exports(conn, org, body.enabled, actor=found.user.id, now=now)
            decision = derived_limits.mix_export_decision(conn, org.organisation_id, _flag_on)
        return {"allowed": decision.allowed, "reason": decision.reason}

    @app.get("/api/business/terms")
    def terms_access(request: Request, claims: Claims = Depends(current_claims)):  # noqa: B008
        everyone = frozenset({"owner", "admin", "venue_manager", "staff", "viewer"})
        with member(request, claims, everyone) as (conn, org, found, _now):
            answer = terms.access(conn, org.organisation_id).to_dict()
            answer["can_accept"] = _role(found) in terms.ACCEPTING_ROLES
        return answer

    @app.post("/api/business/terms/accept")
    def accept_terms(request: Request, claims: Claims = Depends(current_claims)):  # noqa: B008
        with member(request, claims, frozenset(terms.ACCEPTING_ROLES)) as (
                conn, org, found, now):
            terms.accept(conn, org, terms.CURRENT_BUSINESS_TERMS_VERSION, found.user.id,
                         "sign_in", None, now=now)
            return terms.access(conn, org.organisation_id).to_dict()


__all__ = ["install_routes"]
