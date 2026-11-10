"""Cloud-mode HTTP API for identity and account bootstrap.

The local application remains in ``api.py``. This factory deliberately has no local library,
render worker, song watcher, or filesystem mount. Cloud credentials and database access are
configured explicitly; migrations run as a release command rather than at web-process startup.

Identity (onboarding, signing out, deletion, WorkOS webhooks and admin entry) lives in
``selecta.identity.routes``; the WorkOS API key and webhook secret are kept out of ``repr`` so
they can't reach a log line through the settings object. Cloud mode refuses to start without
them: a server that boots and then answers 503 to every sign-up is worse than one that won't.

``RequestMethodMiddleware`` records each request's method so the per-request account check can
let a suspended account read (GET, HEAD) and refuse everything else, in one place.
"""

from __future__ import annotations

import asyncio
import json
import os
import time
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from typing import Protocol
from urllib.parse import urlsplit

import sqlalchemy as sa
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel
from sqlalchemy.engine import Engine
from starlette.middleware.trustedhost import TrustedHostMiddleware

from selecta import flags
from selecta.admin import guard as admin_guard
from selecta.admin import routes as admin_routes
from selecta.admin import routes_controls as admin_control_routes
from selecta.admin.state import EmergencyCache
from selecta.billing import api as billing_api
from selecta.billing import plans, stripe_sync
from selecta.flags import guard as flag_guard
from selecta.flags import rules as flag_rules
from selecta.flags import targeting
from selecta.flags.matching import Context
from selecta.flags.rules import RulesCache
from selecta.identity import routes as identity_routes
from selecta.identity.tokens import (
    Claims,
    JwksUnavailable,
    TokenError,
    TokenExpired,
    authkit_verifier,
)
from selecta.identity.workos import WorkOSClient
from selecta.lucy import cloud_settings as lucy_cloud_settings
from selecta.persistence import db_now, make_engine, transaction
from selecta.persistence.migrate import current as migration_current
from selecta.persistence.migrate import head as migration_head
from selecta.rooms import wiring as rooms_wiring
from selecta.rooms.cloud_ports import RoomPorts
from selecta.routes import cloud_assets as cloud_assets_routes
from selecta.routes import cloud_export as cloud_export_routes
from selecta.routes import cloud_proxy as cloud_proxy_routes
from selecta.storage import api as storage_api
from selecta.storage import playback_api as playback_api
from selecta.usage import meters, quota
from selecta.work.schema import outbox_events


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
    workos_api_key: str = field(default="", repr=False)
    workos_webhook_secret: str = field(default="", repr=False)
    staff_organization_id: str = ""
    # True for settings read from the environment: identity work that needs WorkOS then answers
    # 503 when WorkOS isn't configured, instead of trusting token claims (see identity.routes).
    require_workos: bool = False

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
        api_key = os.environ.get("SELECTA_WORKOS_API_KEY", "").strip()
        webhook_secret = os.environ.get("SELECTA_WORKOS_WEBHOOK_SECRET", "").strip()
        # Name what's missing, never what's set: these values are secrets.
        missing = [
            name
            for name, value in (
                ("SELECTA_WORKOS_API_KEY", api_key),
                ("SELECTA_WORKOS_WEBHOOK_SECRET", webhook_secret),
            )
            if not value
        ]
        if missing:
            raise CloudConfigurationError(
                f"Set {' and '.join(missing)} before starting Cloud mode: onboarding, signing "
                "out everywhere and WorkOS webhooks can't work without them."
            )
        hosts = _csv("SELECTA_ALLOWED_HOSTS")
        origins = _csv("SELECTA_ALLOWED_ORIGINS")
        if not hosts or "*" in hosts or not origins:
            raise CloudConfigurationError(
                "Cloud mode requires explicit, non-wildcard SELECTA_ALLOWED_HOSTS and "
                "SELECTA_ALLOWED_ORIGINS allowlists."
            )
        if any(not _valid_origin(origin) for origin in origins):
            raise CloudConfigurationError(
                "SELECTA_ALLOWED_ORIGINS entries must be HTTPS origins (HTTP is allowed only "
                "for localhost development), without paths or credentials."
            )
        return cls(
            database_url=url,
            workos_client_id=client_id,
            issuer=issuer,
            audience=audience,
            allowed_hosts=hosts,
            allowed_origins=origins,
            workos_api_base=os.environ.get("SELECTA_WORKOS_API_BASE", "https://api.workos.com"),
            workos_api_key=api_key,
            workos_webhook_secret=webhook_secret,
            staff_organization_id=os.environ.get("SELECTA_STAFF_ORGANIZATION_ID", "").strip(),
            require_workos=True,
        )

    def verifier(self) -> Verifier:
        return authkit_verifier(
            self.workos_client_id,
            issuer=self.issuer,
            audience=self.audience,
            api_base=self.workos_api_base,
        )

    def workos_client(self) -> WorkOSClient | None:
        """The WorkOS User Management client, or None when no API key is configured."""
        if not self.workos_api_key:
            return None
        return WorkOSClient(self.workos_api_key, api_base=self.workos_api_base)


OnboardingRequest = identity_routes.OnboardingRequest


class LabPreference(BaseModel):
    enabled: bool


class RequestMethodMiddleware:
    """Record the request's HTTP method for the account check (see `identity.routes`)."""

    def __init__(self, app) -> None:
        self.app = app

    async def __call__(self, scope, receive, send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        token = identity_routes.REQUEST_METHOD.set(scope["method"])
        try:
            await self.app(scope, receive, send)
        finally:
            identity_routes.REQUEST_METHOD.reset(token)


def _csv(name: str) -> tuple[str, ...]:
    return tuple(part.strip() for part in os.environ.get(name, "").split(",") if part.strip())


def _valid_origin(value: str) -> bool:
    parsed = urlsplit(value)
    loopback = parsed.hostname in {"localhost", "127.0.0.1", "::1"}
    return (
        (parsed.scheme == "https" or (parsed.scheme == "http" and loopback))
        and bool(parsed.netloc)
        and parsed.username is None
        and parsed.password is None
        and parsed.path == ""
        and not parsed.query
        and not parsed.fragment
    )


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
    except TokenExpired as error:
        raise HTTPException(
            status_code=401,
            detail={"code": "token_expired", "message": "Sign in again to continue."},
            headers={"WWW-Authenticate": "Bearer"},
        ) from error
    except JwksUnavailable as error:
        raise HTTPException(
            status_code=503,
            detail={
                "code": "identity_unavailable",
                "message": "Sign-in is temporarily unavailable.",
            },
        ) from error
    except TokenError as error:
        raise HTTPException(
            status_code=401,
            detail={"code": "token_invalid", "message": "Sign in again to continue."},
            headers={"WWW-Authenticate": "Bearer"},
        ) from error


# The per-request account check (§7A.3), shared with every package's routes as `principal_for`.
_principal = identity_routes.principal_or_refusal


def create_cloud_app(
    settings: CloudSettings | None = None,
    *,
    engine: Engine | None = None,
    verifier: Verifier | None = None,
    workos: WorkOSClient | None = None,
    room_ports: RoomPorts | None = None,
) -> FastAPI:
    """Create the cloud API without starting any local-mode threads or touching local music.

    `workos` is the WorkOS User Management client; tests pass one over `httpx.MockTransport`.
    Without one, a client is built from the settings' API key when there is one.
    """
    settings = settings or CloudSettings.from_environment()
    plans.validate_catalogue()
    owns_engine = engine is None
    engine = engine or make_engine(settings.database_url)
    verifier = verifier or settings.verifier()
    owns_workos = workos is None
    workos = workos or settings.workos_client()

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        yield
        if owns_workos and workos is not None:
            workos.close()
        if owns_engine:
            engine.dispose()

    app = FastAPI(title="Selecta Cloud API", docs_url="/api/docs", lifespan=lifespan)
    app.state.runtime_mode = "cloud"
    app.state.database_engine = engine
    app.state.token_verifier = verifier
    app.state.workos = workos
    rule_cache = RulesCache(engine, max_age=5.0)
    app.state.flag_rules = rule_cache
    flags.effective()
    flag_guard.install(app, strict=True)
    emergency_cache = EmergencyCache(engine)
    app.state.emergency_controls = emergency_cache
    admin_guard.install(app, emergency_cache)
    app.add_middleware(RequestMethodMiddleware)

    app.add_middleware(TrustedHostMiddleware, allowed_hosts=list(settings.allowed_hosts))
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.allowed_origins),
        allow_credentials=True,
        allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=[
            "Authorization",
            "Content-Type",
            "Idempotency-Key",
            "Last-Event-ID",
            "X-Workspace-ID",
            "X-Operation-ID",
            "X-Admin-Session",
        ],
        expose_headers=["X-Request-ID"],
        max_age=600,
    )

    def current_claims(request: Request) -> Claims:
        return _bearer(request, verifier)

    def rule_snapshot():
        rule_cache.refresh_if_stale()
        return rule_cache.snapshot

    def feature_context(principal, plan, now: float) -> Context:
        age_days = max(0.0, (now - principal.user.created_at) / 86_400)
        return Context(
            environment=os.environ.get("SELECTA_ENV", "production"),
            mode="cloud",
            workspace_id=principal.workspace.id,
            user_id=principal.user.id,
            plan=plan.id,
            plan_version=plan.version,
            staff_roles=frozenset(role.value for role in principal.staff_roles),
            account_age_days=age_days,
        )

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

    @app.get("/api/events")
    async def events_stream(
        request: Request,
        after: int = 0,
        claims: Claims = Depends(current_claims),
    ):
        """Stream this workspace's durable outbox events; reconnect with Last-Event-ID."""
        if after < 0:
            raise HTTPException(status_code=400, detail={"code": "invalid_event_cursor"})
        principal = _principal(engine, claims, request.headers.get("x-workspace-id"))
        cursor_header = request.headers.get("last-event-id")
        if cursor_header:
            try:
                after = max(after, int(cursor_header))
            except ValueError as error:
                raise HTTPException(
                    status_code=400, detail={"code": "invalid_event_cursor"}
                ) from error
        workspace_id = principal.workspace.id

        def fetch(cursor: int):
            with transaction(engine, workspace_id) as connection:
                rows = connection.execute(
                    sa.select(
                        outbox_events.c.id,
                        outbox_events.c.topic,
                        outbox_events.c.payload,
                    )
                    .where(outbox_events.c.workspace_id == workspace_id)
                    .where(outbox_events.c.id > cursor)
                    .order_by(outbox_events.c.id)
                    .limit(100)
                )
                return [dict(row._mapping) for row in rows]

        async def frames():
            cursor = after
            heartbeat_at = time.monotonic()
            deadline = time.monotonic() + 600
            while time.monotonic() < deadline and time.time() < claims.expires_at:
                if await request.is_disconnected():
                    break
                batch = await asyncio.to_thread(fetch, cursor)
                for row in batch:
                    cursor = row["id"]
                    frame = {
                        "id": cursor,
                        "topic": row["topic"],
                        "payload": row["payload"],
                    }
                    yield (
                        f"id: {cursor}\nevent: selecta\ndata: "
                        f"{json.dumps(frame, separators=(',', ':'), default=str)}\n\n"
                    )
                now = time.monotonic()
                if now - heartbeat_at >= 20:
                    yield ": keep-alive\n\n"
                    heartbeat_at = now
                await asyncio.sleep(0.5 if batch else 2.0)

        return StreamingResponse(
            frames(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache, no-transform",
                "X-Accel-Buffering": "no",
            },
        )

    @app.get("/api/account")
    def get_account(
        request: Request,
        claims: Claims = Depends(current_claims),
    ):
        snapshot = rule_snapshot()
        workspace_id = request.headers.get("x-workspace-id")
        principal = _principal(engine, claims, workspace_id)
        with transaction(engine, principal.workspace.id) as conn:
            entitlement = stripe_sync.effective_entitlement(conn, principal.workspace.id)
            plan = plans.plan_for(entitlement.plan_id, entitlement.plan_version)
            storage = quota.usage(conn, principal.workspace.id)
            usage = meters.meters(conn, principal.workspace.id, plan, principal.user.timezone)
            now = db_now(conn)
            preferences = flag_rules.user_preferences(conn, principal.user.id)
            decisions = targeting.decide_all(
                feature_context(principal, plan, now),
                build_states=flags.effective(),
                rules=snapshot,
                entitled=plan.flags,
                plan_gated=plans.plan_gated_flags(),
                user_prefs=preferences,
                now=now,
                lock_plans=plans.unlocking_plans(),
            )
        return {
            "user": {
                "id": principal.user.id,
                "email": principal.user.email,
                "email_verified": principal.user.email_verified,
                "suspended": principal.user.suspended_at is not None,
                # Staff see a link to the admin console; the console itself checks everything.
                "staff": principal.is_staff,
                "timezone": principal.user.timezone,
            },
            "workspace": {
                "id": principal.workspace.id,
                "name": principal.workspace.name,
                "role": principal.workspace_role.value,
            },
            "entitlement": {
                "plan": plan.id,
                "plan_label": plan.label,
                "plan_version": plan.version,
                "source": entitlement.source,
                "snapshot_version": entitlement.snapshot_version,
                "storage_limit_bytes": storage.limit_bytes,
                "storage_used_bytes": storage.used_bytes,
                "storage_state": storage.state.value,
            },
            "usage": usage,
            "billing": {
                "consent_version": os.environ.get("SELECTA_CHECKOUT_CONSENT_VERSION", "").strip(),
            },
            "lucy": {"tier": meters.lucy_tier(plan)},
            "features": decisions.snapshot(),
            "feature_locks": dict(decisions.locks),
            "feature_rule_version": decisions.version,
        }

    @app.get("/api/account/labs")
    def get_labs(
        request: Request,
        claims: Claims = Depends(current_claims),
    ):
        snapshot = rule_snapshot()
        principal = _principal(engine, claims, request.headers.get("x-workspace-id"))
        with transaction(engine, principal.workspace.id) as conn:
            entitlement = stripe_sync.effective_entitlement(conn, principal.workspace.id)
            plan = plans.plan_for(entitlement.plan_id, entitlement.plan_version)
            preferences = flag_rules.user_preferences(conn, principal.user.id)
            now = db_now(conn)
            beta_preferences = {
                flag_id: True for flag_id, flag in flags.registry().items() if flag.kind == "beta"
            }
            available = []
            for flag_id, flag in flags.registry().items():
                if flag.kind != "beta" or "cloud" not in flag.modes:
                    continue
                decision = targeting.decide(
                    flag_id,
                    feature_context(principal, plan, now),
                    build_states=flags.effective(),
                    rules=snapshot,
                    entitled=plan.flags,
                    plan_gated=plans.plan_gated_flags(),
                    user_prefs=preferences | beta_preferences,
                    now=now,
                )
                if decision.on:
                    available.append(
                        {
                            "id": flag_id,
                            "label": flag.label,
                            "about": flag.about,
                            "enabled": preferences.get(flag_id) is True,
                        }
                    )
        return {"flags": available, "version": snapshot.version}

    @app.put("/api/account/labs/{flag_id}")
    def update_lab(
        flag_id: str,
        body: LabPreference,
        request: Request,
        claims: Claims = Depends(current_claims),
    ):
        snapshot = rule_snapshot()
        principal = _principal(engine, claims, request.headers.get("x-workspace-id"))
        with transaction(engine, principal.workspace.id) as conn:
            entitlement = stripe_sync.effective_entitlement(conn, principal.workspace.id)
            plan = plans.plan_for(entitlement.plan_id, entitlement.plan_version)
            preferences = flag_rules.user_preferences(conn, principal.user.id)
            now = db_now(conn)
            if body.enabled:
                decision = targeting.decide(
                    flag_id,
                    feature_context(principal, plan, now),
                    build_states=flags.effective(),
                    rules=snapshot,
                    entitled=plan.flags,
                    plan_gated=plans.plan_gated_flags(),
                    user_prefs=preferences | {flag_id: True},
                    now=now,
                )
                if not decision.on:
                    raise HTTPException(
                        status_code=403,
                        detail={"code": "feature_unavailable", "reason": decision.reason},
                    )
            try:
                flag_rules.set_user_preference(
                    conn,
                    principal.user.id,
                    flag_id,
                    body.enabled,
                    entitled=plan.flags,
                    plan_gated=plans.plan_gated_flags(),
                )
            except flag_rules.RuleError as error:
                raise HTTPException(
                    status_code=400,
                    detail={"code": "invalid_lab_choice", "problems": error.problems},
                ) from error
        return {"id": flag_id, "enabled": body.enabled}

    identity_routes.install_routes(
        app,
        engine=engine,
        current_claims=current_claims,
        workos=workos,
        webhook_secret=settings.workos_webhook_secret,
        staff_organization_id=settings.staff_organization_id,
        require_workos=settings.require_workos,
    )
    billing_api.install_routes(
        app,
        engine=engine,
        allowed_origins=settings.allowed_origins,
        current_claims=current_claims,
        principal_for=_principal,
    )
    storage_api.install_routes(
        app,
        engine=engine,
        current_claims=current_claims,
        principal_for=_principal,
    )
    cloud_assets_routes.install_routes(
        app,
        engine=engine,
        current_claims=current_claims,
        principal_for=_principal,
    )
    playback_api.install_routes(
        app,
        engine=engine,
        current_claims=current_claims,
        principal_for=_principal,
        object_client_factory=storage_api.r2_client,
        buckets=storage_api.buckets(),
    )
    cloud_export_routes.install_routes(
        app,
        engine=engine,
        current_claims=current_claims,
        principal_for=_principal,
        object_client_factory=storage_api.r2_client,
        buckets=storage_api.buckets(),
    )

    lucy_cloud_settings.install_routes(
        app, engine=engine, current_claims=current_claims, principal_for=_principal
    )
    cloud_proxy_routes.install_routes(
        app, engine=engine, current_claims=current_claims, principal_for=_principal,
        object_client_factory=storage_api.r2_client, buckets=storage_api.buckets(),
    )

    # Devices, the playback session, Rooms, guests and displays (ADR-0415, ADR-0416). Tests and
    # the browser-test server pass `room_ports` with a song library; see `rooms.cloud_ports`.
    rooms_wiring.install(
        app, engine=engine, current_claims=current_claims, principal_for=_principal,
        rules=rule_cache, allowed_origins=settings.allowed_origins, ports=room_ports,
    )

    admin_routes.install_routes(
        app,
        engine=engine,
        current_claims=current_claims,
        emergency=emergency_cache,
    )
    admin_control_routes.install_routes(
        app,
        engine=engine,
        current_claims=current_claims,
        emergency_cache=emergency_cache,
        rule_cache=rule_cache,
    )

    flag_guard.assert_cloud_api_routes_owned(app)

    return app


__all__ = [
    "CloudConfigurationError",
    "CloudSettings",
    "RequestMethodMiddleware",
    "create_cloud_app",
]
