"""Cloud-mode HTTP API for identity and account bootstrap.

The local application remains in ``api.py``. This factory deliberately has no local library,
render worker, song watcher, or filesystem mount. Cloud credentials and database access are
configured explicitly; migrations run as a release command rather than at web-process startup.
"""

from __future__ import annotations

import os
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import Protocol

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy.engine import Engine
from starlette.middleware.trustedhost import TrustedHostMiddleware

from selecta import flags
from selecta.billing import plans, stripe_sync
from selecta.flags import guard as flag_guard
from selecta.identity import accounts
from selecta.identity.tokens import (
    Claims,
    JwksUnavailable,
    TokenError,
    authkit_verifier,
)
from selecta.persistence import make_engine
from selecta.persistence.migrate import current as migration_current
from selecta.persistence.migrate import head as migration_head
from selecta.persistence import transaction
from selecta.usage import quota


class CloudConfigurationError(RuntimeError):
    """Required cloud settings are missing or unsafe for the selected runtime mode."""


class Verifier(Protocol):
    def verify(self, token: str) -> Claims: ...


@dataclass(frozen=True)
class CloudSettings:
    database_url: str
    workos_client_id: str
    issuer: str
    audience: str
    allowed_hosts: tuple[str, ...]
    allowed_origins: tuple[str, ...]
    workos_api_base: str = "https://api.workos.com"

    @classmethod
    def from_environment(cls) -> CloudSettings:
        """Load production configuration and refuse to boot with a local or incomplete setup."""
        url = os.environ.get("SELECTA_DATABASE_URL", "").strip()
        if not url.startswith(("postgresql://", "postgresql+psycopg://")):
            raise CloudConfigurationError(
                "Cloud mode requires SELECTA_DATABASE_URL to be a PostgreSQL URL."
            )
        client_id = os.environ.get("SELECTA_WORKOS_CLIENT_ID", "").strip()
        issuer = os.environ.get("SELECTA_AUTH_ISSUER", "").strip()
        audience = os.environ.get("SELECTA_AUTH_AUDIENCE", "").strip()
        if not all((client_id, issuer, audience)):
            raise CloudConfigurationError(
                "Set SELECTA_WORKOS_CLIENT_ID, SELECTA_AUTH_ISSUER and "
                "SELECTA_AUTH_AUDIENCE before starting Cloud mode."
            )
        hosts = _csv("SELECTA_ALLOWED_HOSTS")
        origins = _csv("SELECTA_ALLOWED_ORIGINS")
        if not hosts or not origins:
            raise CloudConfigurationError(
                "Cloud mode requires non-empty SELECTA_ALLOWED_HOSTS and "
                "SELECTA_ALLOWED_ORIGINS allowlists."
            )
        return cls(
            database_url=url,
            workos_client_id=client_id,
            issuer=issuer,
            audience=audience,
            allowed_hosts=hosts,
            allowed_origins=origins,
            workos_api_base=os.environ.get("SELECTA_WORKOS_API_BASE", "https://api.workos.com"),
        )

    def verifier(self) -> Verifier:
        return authkit_verifier(
            self.workos_client_id,
            issuer=self.issuer,
            audience=self.audience,
            api_base=self.workos_api_base,
        )


class OnboardingRequest(BaseModel):
    age_confirmed: bool = Field(
        description="The signed-in person confirms they meet the minimum account age."
    )
    timezone: str = "UTC"


def _csv(name: str) -> tuple[str, ...]:
    return tuple(part.strip() for part in os.environ.get(name, "").split(",") if part.strip())


def _bearer(request: Request, verifier: Verifier) -> Claims:
    value = request.headers.get("authorization", "")
    scheme, _, token = value.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise HTTPException(
            status_code=401,
            detail={"code": "authentication_required", "message": "Sign in to continue."},
            headers={"WWW-Authenticate": "Bearer"},
        )
    try:
        return verifier.verify(token.strip())
    except JwksUnavailable as error:
        raise HTTPException(
            status_code=503,
            detail={"code": "identity_unavailable", "message": "Sign-in is temporarily unavailable."},
        ) from error
    except TokenError as error:
        raise HTTPException(
            status_code=401,
            detail={"code": "invalid_session", "message": "Sign in again to continue."},
            headers={"WWW-Authenticate": "Bearer"},
        ) from error


def _principal(engine: Engine, claims: Claims, workspace_id: str | None = None):
    with transaction(engine) as conn:
        try:
            principal = accounts.resolve_principal(conn, claims, workspace_id)
        except accounts.SessionRevoked as error:
            raise HTTPException(status_code=401, detail={"code": "session_revoked"}) from error
        except accounts.NotProvisioned as error:
            raise HTTPException(
                status_code=409,
                detail={"code": "onboarding_required", "message": "Finish account setup first."},
            ) from error
        except accounts.AccountDeleted as error:
            raise HTTPException(status_code=403, detail={"code": "account_deleted"}) from error
        except accounts.NotAMember as error:
            raise HTTPException(status_code=404, detail={"code": "workspace_not_found"}) from error
        return principal


def create_cloud_app(
    settings: CloudSettings | None = None,
    *,
    engine: Engine | None = None,
    verifier: Verifier | None = None,
) -> FastAPI:
    """Create the cloud API without starting any local-mode threads or touching local music."""
    settings = settings or CloudSettings.from_environment()
    owns_engine = engine is None
    engine = engine or make_engine(settings.database_url)
    verifier = verifier or settings.verifier()

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        yield
        if owns_engine:
            engine.dispose()

    app = FastAPI(title="Selecta Cloud API", docs_url="/api/docs", lifespan=lifespan)
    app.state.runtime_mode = "cloud"
    app.state.database_engine = engine
    app.state.token_verifier = verifier
    flags.effective()
    flag_guard.install(app)

    app.add_middleware(TrustedHostMiddleware, allowed_hosts=list(settings.allowed_hosts))
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.allowed_origins),
        allow_credentials=True,
        allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "X-Workspace-ID", "X-Operation-ID"],
        expose_headers=["X-Request-ID"],
        max_age=600,
    )

    def current_claims(request: Request) -> Claims:
        return _bearer(request, verifier)

    @app.get("/api/status")
    def status() -> dict[str, str]:
        return {"service": "selecta", "mode": "cloud", "status": "ok"}

    @app.get("/api/ready")
    def ready():
        try:
            with engine.connect() as connection:
                connection.exec_driver_sql("SELECT 1")
            expected, applied = migration_head(), migration_current(engine)
        except Exception:
            return JSONResponse({"status": "not_ready", "reason": "database_unavailable"}, 503)
        if expected is None or applied != expected:
            return JSONResponse(
                {"status": "not_ready", "reason": "migrations_pending"}, status_code=503
            )
        return {"status": "ready", "schema": applied}

    @app.post("/api/onboarding/complete", status_code=201)
    def complete_onboarding(
        body: OnboardingRequest, claims: Claims = Depends(current_claims)
    ):
        if body.age_confirmed is not True:
            raise HTTPException(
                status_code=400,
                detail={"code": "age_confirmation_required", "minimum_age": 13},
            )
        with transaction(engine) as conn:
            try:
                provisioned = accounts.provision(
                    conn, claims, age_confirmed=True, timezone=body.timezone
                )
                free = plans.plan_for(plans.DEFAULT_PLAN)
                quota.set_limit(conn, provisioned.workspace.id, free)
            except accounts.AgeConfirmationRequired as error:
                raise HTTPException(status_code=400, detail={"code": "age_confirmation_required"}) from error
            except ValueError as error:
                raise HTTPException(status_code=400, detail={"code": "invalid_timezone"}) from error
        return {
            "user_id": provisioned.user.id,
            "workspace_id": provisioned.workspace.id,
            "plan": "free",
            "created": provisioned.created,
        }

    @app.get("/api/account")
    def get_account(
        request: Request,
        claims: Claims = Depends(current_claims),
    ):
        workspace_id = request.headers.get("x-workspace-id")
        principal = _principal(engine, claims, workspace_id)
        with transaction(engine, principal.workspace.id) as conn:
            entitlement = stripe_sync.effective_entitlement(conn, principal.workspace.id)
            plan = plans.plan_for(entitlement.plan_id, entitlement.plan_version)
            storage = quota.usage(conn, principal.workspace.id)
        return {
            "user": {
                "id": principal.user.id,
                "email": principal.user.email,
                "email_verified": principal.user.email_verified,
                "timezone": principal.user.timezone,
            },
            "workspace": {
                "id": principal.workspace.id,
                "name": principal.workspace.name,
                "role": principal.workspace_role.value,
            },
            "entitlement": {
                "plan": plan.id,
                "plan_version": plan.version,
                "source": entitlement.source,
                "storage_limit_bytes": storage.limit_bytes,
                "storage_used_bytes": storage.used_bytes,
                "storage_state": storage.state.value,
            },
        }

    @app.post("/api/account/sign-out-everywhere")
    def sign_out_everywhere(claims: Claims = Depends(current_claims)):
        principal = _principal(engine, claims)
        with transaction(engine) as conn:
            revoked_before = accounts.revoke_sessions(
                conn, principal.user.id, actor_id=principal.user.id
            )
        return {"revoked_before": revoked_before, "message": "Other sessions will expire shortly."}

    return app


__all__ = ["CloudConfigurationError", "CloudSettings", "create_cloud_app"]
