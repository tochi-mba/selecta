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
import logging
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

from selecta import flags, ratelimit
from selecta.admin import guard as admin_guard
from selecta.admin import wiring as admin_wiring
from selecta.admin.state import EmergencyCache
from selecta.autopilot import routes_autopilot as autopilot_routes
from selecta.billing import api as billing_api
from selecta.billing import plans, standing, stripe_sync
from selecta.business import admin_routes as business_admin_routes
from selecta.business import billing_routes as business_billing_routes
from selecta.business import controls_wiring as business_controls
from selecta.business import entitlement_routes as business_entitlement_routes
from selecta.business import library_copy as business_library_copy
from selecta.business import licensing_routes as business_licensing_routes
from selecta.business import playlog_routes as business_playlog_routes
from selecta.business import rollout_routes as business_rollout_routes
from selecta.business import routes as business_org_routes
from selecta.business import start_routes as business_start_routes
from selecta.business import workspace_routes as business_workspace_routes
from selecta.business import zone_speaker_routes as business_zone_speaker_routes
from selecta.business.people import routes as business_people_routes
from selecta.catalog import routes as catalog_routes
from selecta.devstack import guard as dev_guard
from selecta.flags import cloud_gate, targeting
from selecta.flags import guard as flag_guard
from selecta.flags import rules as flag_rules
from selecta.flags.matching import Context
from selecta.flags.rules import RulesCache
from selecta.identity import accounts as identity_accounts
from selecta.identity import routes as identity_routes
from selecta.identity.tokens import (
    Claims,
    JwksUnavailable,
    TokenError,
    TokenExpired,
    WrongIssuer,
    authkit_verifier,
)
from selecta.identity.workos import WorkOSClient
from selecta.local_media import api as local_media_routes
from selecta.local_media import links as local_links_routes
from selecta.local_media import recipe_api as local_recipe_routes
from selecta.lucy import cloud_routes as lucy_cloud_routes
from selecta.lucy import cloud_settings as lucy_cloud_settings
from selecta.observability import errors, metrics, tracing
from selecta.persistence import db_now, make_engine, transaction
from selecta.persistence.listen import PgListener
from selecta.persistence.migrate import current as migration_current
from selecta.persistence.migrate import head as migration_head
from selecta.playback import api as device_playback_routes
from selecta.playback.zones import SQL_ZONES
from selecta.rooms import wiring as rooms_wiring
from selecta.rooms.cloud_ports import OutboxPlaybackEvents, RoomPorts, browser_first_ports
from selecta.routes import business_hours as business_hours_routes
from selecta.routes import business_kiosk as business_kiosk_routes
from selecta.routes import business_zones as business_zones_routes
from selecta.routes import cloud_assets as cloud_assets_routes
from selecta.routes import cloud_export as cloud_export_routes
from selecta.routes import cloud_mixes as cloud_mix_routes
from selecta.routes import cloud_proxy as cloud_proxy_routes
from selecta.routes import local_first_labs as local_first_labs_routes
from selecta.storage import api as storage_api
from selecta.storage import playback_api as playback_api
from selecta.usage import meters, quota
from selecta.work.fanout import OutboxFanout
from selecta.work.schema import outbox_events

log = logging.getLogger(__name__)


class CloudConfigurationError(RuntimeError):
    """Required cloud settings are missing or unsafe for the selected runtime mode."""


class Verifier(Protocol):
    def verify(self, token: str) -> Claims: ...


@dataclass(frozen=True)
class CloudSettings:
    database_url: str
    workos_client_id: str
    issuer: str
    audience: str | None
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
        # The local identity provider of `dev.cmd cloud` can never sign anyone in to a deployment.
        identity_problem = dev_guard.production_identity_problem()
        if identity_problem:
            raise CloudConfigurationError(identity_problem)
        url = os.environ.get("SELECTA_DATABASE_URL", "").strip()
        if not url.startswith(("postgresql://", "postgresql+psycopg://")):
            raise CloudConfigurationError(
                "Cloud mode requires SELECTA_DATABASE_URL to be a PostgreSQL URL."
            )
        client_id = os.environ.get("SELECTA_WORKOS_CLIENT_ID", "").strip()
        issuer = os.environ.get("SELECTA_AUTH_ISSUER", "").strip()
        audience = os.environ.get("SELECTA_AUTH_AUDIENCE", "").strip()
        if not all((client_id, issuer)):
            raise CloudConfigurationError(
                "Set SELECTA_WORKOS_CLIENT_ID and SELECTA_AUTH_ISSUER before starting Cloud mode."
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
            audience=audience or None,
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
        # Keep the response deliberately generic, but leave operators enough information to
        # distinguish an issuer/audience configuration mistake from a bad signature. Never log
        # the credential or exception text: both can contain attacker-controlled material.
        if isinstance(error, WrongIssuer) and error.observed is not None:
            # The issuer comes from a token whose signature already verified, so it names
            # what to set SELECTA_AUTH_ISSUER to. Quoted and capped, never the token itself.
            log.warning(
                "AuthKit token rejected: WrongIssuer (token iss %r)", error.observed[:120]
            )
        else:
            log.warning("AuthKit token rejected: %s", type(error).__name__)
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
    room_ports = room_ports or browser_first_ports(engine)  # catalogue, planner, now playing

    # One LISTEN connection per instance wakes event streams and reloads flag rules the moment
    # another instance commits (ADR-0407, ADR-0414). None on SQLite, which keeps polling.
    listener = PgListener.for_engine(engine)
    fanout = OutboxFanout(listener)

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        fanout.start()
        yield
        fanout.stop()
        if owns_workos and workos is not None:
            workos.close()
        if owns_engine:
            engine.dispose()

    app = FastAPI(title="SelectaDJ API", docs_url="/api/docs", lifespan=lifespan)
    app.state.runtime_mode = "cloud"
    app.state.database_engine = engine
    app.state.token_verifier = verifier
    app.state.workos = workos
    rule_cache = RulesCache(engine, max_age=5.0)
    app.state.flag_rules = rule_cache
    app.state.event_fanout = fanout
    if listener is not None:
        rule_cache.listen(listener)
        # After the cache has reloaded (callbacks run in order), wake every event stream so each
        # tells its page `flags.changed` at once (ADR-0414: kill switch within 5 s).
        listener.subscribe(flag_rules.CHANNEL, fanout.notify)
    flags.effective()

    # Per-account (ADR-0414): rules and plans gate routes with 403 `flag_off` or
    # `plan_required`. The build guard runs first; core/staff and unauthenticated
    # guest/webhook requests bypass account gating. Rooms and playback self-gate
    # in their routers, preserving reads such as a downgraded host's existing room.
    self_gated = ("rooms", "devices")

    # A self-gated route (rooms and playback heartbeats, device polling) is refused or allowed
    # by its own handler, so this middleware only needs the metrics cohort for it. Deciding that
    # cohort costs a principal lookup and a transaction, which such routes previously never paid,
    # so the answer is remembered briefly per credential pair. Gated routes never use this cache:
    # `cloud_gate.require` still runs on every request, keeping the 5 s kill-switch contract.
    cohort_cache: dict[tuple[str, str], tuple[str, float]] = {}
    cohort_cache_ttl = 30.0

    def _cohort_remembered(key: tuple[str, str]) -> str | None:
        kept = cohort_cache.get(key)
        if kept is None or time.monotonic() - kept[1] >= cohort_cache_ttl:
            return None
        return kept[0]

    def _remember_cohort(key: tuple[str, str], cohort: str) -> None:
        if len(cohort_cache) > 4096:
            now = time.monotonic()
            for stale in [k for k, (_, at) in cohort_cache.items() if now - at >= cohort_cache_ttl]:
                cohort_cache.pop(stale, None)
            if len(cohort_cache) > 4096:
                cohort_cache.clear()
        cohort_cache[key] = (cohort, time.monotonic())

    @app.middleware("http")
    async def account_feature_flags(request: Request, call_next):
        if not request.url.path.startswith("/api/") or not request.headers.get("authorization"):
            return await call_next(request)
        flag_id = flag_guard.owner_of(request.app, request.scope)
        flag = flags.registry().get(flag_id) if flag_id else None
        route_is_self_gated = (
            flag is None
            or flag.core
            or flag_rules.is_untargetable(flag_id)
            or flag_id.split(".")[0] in self_gated
        )

        cohort_key = (
            request.headers.get("authorization", ""),
            request.headers.get("x-workspace-id") or "",
        )
        if route_is_self_gated:
            remembered = _cohort_remembered(cohort_key)
            if remembered is not None:
                request.state.local_first_cohort = remembered
                return await call_next(request)

        def check() -> tuple[str, HTTPException | None]:
            principal = _principal(
                engine,
                _bearer(request, verifier),
                request.headers.get("x-workspace-id"),
                allow_suspended=True,
            )
            with transaction(engine, principal.workspace.id) as conn:
                # The same live decision drives the per-cohort request metric. This keeps the
                # rollout dashboard tied to actual account targeting instead of browser claims,
                # request parameters or an inferred account identity.
                local_first = cloud_gate.decide(
                    conn, principal, "cloud.local_first", rule_cache
                ).on
                cohort = "browser_first" if local_first else "hosted"
                if route_is_self_gated:
                    return cohort, None
                try:
                    cloud_gate.require(conn, principal, flag_id, rule_cache)
                except HTTPException as refused:
                    return cohort, refused
                return cohort, None

        try:
            cohort, refused = await asyncio.to_thread(check)
            request.state.local_first_cohort = cohort
            _remember_cohort(cohort_key, cohort)
            if refused is not None:
                detail = refused.detail if isinstance(refused.detail, dict) else {}
                return JSONResponse({"detail": detail}, status_code=refused.status_code)
        except HTTPException as refused:
            detail = refused.detail if isinstance(refused.detail, dict) else {}
            if refused.status_code == 403 and detail.get("code") in {"flag_off", "plan_required"}:
                return JSONResponse({"detail": detail}, status_code=403)
        return await call_next(request)

    @app.middleware("http")
    async def browser_first_cohort_metrics(request: Request, call_next):
        """Record only low-cardinality request outcomes for the rollout cohort dashboard.

        Workspace and user ids, paths and query strings are deliberately excluded. Requests which
        cannot be tied to a signed-in account stay in the `unknown` cohort and are excluded from
        the browser-first versus hosted comparison.
        """
        if not request.url.path.startswith("/api/"):
            return await call_next(request)

        def record(status_code: int) -> None:
            cohort = getattr(request.state, "local_first_cohort", "unknown")
            status_class = f"{status_code // 100}xx" if 100 <= status_code < 600 else "unknown"
            metrics.add(
                "selecta_api_requests_total", cohort=cohort, status_class=status_class
            )

        try:
            response = await call_next(request)
        except Exception:
            record(500)
            raise
        record(response.status_code)
        return response

    flag_guard.install(app, strict=True)
    emergency_cache = EmergencyCache(engine)
    app.state.emergency_controls = emergency_cache
    if listener is not None:
        emergency_cache.listen(listener)
    admin_guard.install(app, emergency_cache)
    ratelimit.install_guards(app)  # rate limits (§12.1), then replayed keyed writes
    app.add_middleware(RequestMethodMiddleware)
    # One server span per request; job spans link to it (ADR-0410).
    tracing.install(app, "api")
    for observer in (tracing, errors, metrics):
        observer.configure_from_environment("api")

    app.add_middleware(TrustedHostMiddleware, allowed_hosts=list(settings.allowed_hosts))
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.allowed_origins),
        allow_credentials=True,
        # Every method a route is served with, PUT included: test_cloud_account_meters checks it.
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=(
            "Authorization Content-Type Idempotency-Key Last-Event-ID "
            "X-Workspace-ID X-Operation-ID X-Admin-Session X-Upload-Batch"
        ).split(),
        expose_headers=["X-Request-ID", "Retry-After"],
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
                    # Walk commit order (`seq`), so an event whose transaction committed after a
                    # later one's is never skipped; the SSE id is that `seq`.
                    sa.select(
                        outbox_events.c.seq.label("id"),
                        outbox_events.c.topic,
                        outbox_events.c.payload,
                    )
                    .where(outbox_events.c.workspace_id == workspace_id)
                    .where(outbox_events.c.seq > cursor)
                    .order_by(outbox_events.c.seq)
                    .limit(100)
                )
                batch = [dict(row._mapping) for row in rows]
                # ADR-0443 BZ-0443-09: a person scoped to some venues never hears another
                # venue's zone events; hidden rows still move the replay cursor.
                from selecta.business.event_scope import zone_filter

                sees = zone_filter(connection, workspace_id, principal.user.id)
                for row in batch:
                    row["hidden"] = not sees(row["payload"])
            # The rules version too, so the stream can say when this page's flags may have changed.
            return batch, rule_snapshot().version

        def still_signed_in() -> bool:
            """Re-run the per-request check on every wake-up, so an open stream ends as soon as
            its session is revoked ("sign out everywhere", a password reset, a WorkOS revocation),
            the account starts deleting, or the person leaves the workspace (SC-0400-08)."""
            with transaction(engine) as connection:
                try:
                    identity_accounts.resolve_principal(
                        connection, claims, workspace_id, allow_suspended=True
                    )
                except identity_accounts.IdentityError:
                    return False
            return True

        async def frames():
            cursor = after
            heartbeat_at = time.monotonic()
            deadline = time.monotonic() + 600
            rules_seen: int | None = None
            checked = False  # the request itself was just checked
            while time.monotonic() < deadline and time.time() < claims.expires_at:
                if await request.is_disconnected():
                    break
                waiter = fanout.arm()
                if checked and not await asyncio.to_thread(still_signed_in):
                    # No id, so the replay cursor stays put; the page asks /api/account, hears
                    # `session_revoked` and shows "You were signed out".
                    ended = {"topic": "session.revoked", "payload": {}}
                    data = json.dumps(ended, separators=(",", ":"))
                    yield f"event: selecta\ndata: {data}\n\n"
                    break
                checked = True
                batch, rules_version = await asyncio.to_thread(fetch, cursor)
                if rules_seen is not None and rules_version != rules_seen:
                    # The flag rules changed: the page asks /api/account for its own decisions.
                    # No id, so it never moves the replay cursor, and no rules: they stay here.
                    changed = {"topic": "flags.changed", "payload": {"version": rules_version}}
                    data = json.dumps(changed, separators=(",", ":"))
                    yield f"event: selecta\ndata: {data}\n\n"
                rules_seen = rules_version
                for row in batch:
                    cursor = row["id"]
                    if row.get("hidden"):
                        continue
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
                if len(batch) >= 100:
                    await fanout.wait(waiter, 0)
                else:
                    # Check revoked sessions promptly, even while PostgreSQL LISTEN is live.
                    await fanout.wait(waiter, min(fanout.poll_s(), 2.0))

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
        principal = _principal(engine, claims, request.headers.get("x-workspace-id"))
        with transaction(engine, principal.workspace.id) as conn:
            entitlement = stripe_sync.effective_entitlement(conn, principal.workspace.id)
            plan = plans.plan_for(entitlement.plan_id, entitlement.plan_version)
            storage = quota.usage(conn, principal.workspace.id)
            now = db_now(conn)
            billing_now = standing.for_account(conn, principal, entitlement, now)
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
            # The meter and the shell read one hosted decision (BF-0456-06, BF-0464-02).
            hosted = decisions.snapshot().get("cloud.hosted_media") is not False
            usage = meters.meters(
                conn,
                principal.workspace.id,
                plan,
                principal.user.timezone,
                hosted_media_granted=hosted,
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
                "checkout_available": billing_api.checkout_available(),
                "standing": billing_now,
            },
            "lucy": {"tier": meters.lucy_tier(plan)},
            "features": decisions.snapshot(),
            # BF-0455-03: the decided Cloud experience, so the web shell renders from one answer.
            "experience": {
                "local_first": decisions.snapshot().get("cloud.local_first") is not False,
                "hosted": hosted,
            },
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
    # Cloud mixes in the shared mix contract (ADR-0418); refused while cloud.mix_create is off.
    cloud_mix_routes.install_routes(
        app, engine=engine, current_claims=current_claims, principal_for=_principal
    )
    # The metadata-only song catalogue (ADR-0458); refused while cloud.local_media is off.
    local_media_routes.install_routes(
        app, engine=engine, current_claims=current_claims, principal_for=_principal
    )
    # Portable recipes over that catalogue (BF-0462-05); refused while cloud.local_media is off.
    local_recipe_routes.install_routes(
        app, engine=engine, current_claims=current_claims, principal_for=_principal
    )
    # Word connections over that catalogue's cached LRCLIB lyrics; refused while
    # discover.word_links is off (dark in Cloud until lyrics.display is cleared, SC-0406-03).
    local_links_routes.install_routes(
        app, engine=engine, current_claims=current_claims, principal_for=_principal
    )
    business_org_routes.install_routes(
        app, engine=engine, current_claims=current_claims, principal_for=_principal,
        rules=rule_cache,
    )
    # ADR-0452 people and invitations, the workspace overview and setup (ADR-0453 D2/D6).
    business_people_routes.install_routes(
        app, engine=engine, current_claims=current_claims, principal_for=_principal,
        rules=rule_cache,
    )
    business_workspace_routes.install_routes(
        app, engine=engine, current_claims=current_claims, principal_for=_principal
    )
    business_start_routes.install_routes(  # ADR-0453 S1: /business/start's pilot contact form
        app, engine=engine, current_claims=current_claims, principal_for=_principal
    )
    business_library_copy.install_routes(  # ADR-0453 D6 step 6: copy, never move
        app, engine=engine, current_claims=current_claims, principal_for=_principal
    )
    # Play here (ADR-0443): what a staff browser plays once it holds a zone's lease.
    business_zone_speaker_routes.install_routes(
        app, engine=engine, current_claims=current_claims, principal_for=_principal,
        presign=business_kiosk_routes.storage_presign(storage_api.r2_client, storage_api.buckets()),
    )
    for business_routes in (business_hours_routes, business_zones_routes):
        business_routes.install_routes(
            app, engine=engine, current_claims=current_claims, principal_for=_principal
        )
    # Kiosk players (ADR-0445); refused while business.kiosk is off.
    business_kiosk_routes.install_routes(
        app, engine=engine, current_claims=current_claims, principal_for=_principal,
        pepper=room_ports.pepper or rooms_wiring.pepper_from_environment(),
        presign=business_kiosk_routes.storage_presign(storage_api.r2_client, storage_api.buckets()),
    )
    business_controls.install(  # ADR-0450 content controls and ADR-0451 Rooms for Business
        app, engine=engine, current_claims=current_claims, principal_for=_principal,
        pepper=room_ports.pepper,
    )
    playback_api.install_routes(
        app,
        engine=engine,
        current_claims=current_claims,
        principal_for=_principal,
        object_client_factory=storage_api.r2_client,
        buckets=storage_api.buckets(),
    )
    # Browser devices and fenced playback sessions (ADR-0461). This is distinct from the
    # storage playback-URL routes above: it owns device registration, leases, commands and zones.
    device_playback_routes.install_routes(
        app,
        engine=engine,
        current_claims=current_claims,
        principal_for=_principal,
        rules=rule_cache,
        events=OutboxPlaybackEvents(),
        zones=SQL_ZONES,
    )
    cloud_export_routes.install_routes(
        app,
        engine=engine,
        current_claims=current_claims,
        principal_for=_principal,
        object_client_factory=storage_api.r2_client,
        buckets=storage_api.buckets(),
    )

    for cloud_routes in (lucy_cloud_settings, lucy_cloud_routes, catalog_routes):  # +ADR-0478
        cloud_routes.install_routes(
            app, engine=engine, current_claims=current_claims, principal_for=_principal
        )
    # Autopilot venue mode and venue policy (ADR-0424, ADR-0425); refused while the flags are off.
    autopilot_routes.install_routes(
        app, engine=engine, current_claims=current_claims, principal_for=_principal
    )
    cloud_proxy_routes.install_routes(
        app, engine=engine, current_claims=current_claims, principal_for=_principal,
        object_client_factory=storage_api.r2_client, buckets=storage_api.buckets(),
    )

    # Rooms, guests and displays (ADR-0415, ADR-0416). Tests and
    # the browser-test server pass `room_ports` with a song library; see `rooms.cloud_ports`.
    rooms_wiring.install(
        app, engine=engine, current_claims=current_claims, principal_for=_principal,
        rules=rule_cache, allowed_origins=settings.allowed_origins, ports=room_ports,
    )

    business_admin_routes.install_routes(
        app, engine=engine, current_claims=current_claims,
    )
    # Business billing (ADR-0447); refused while business.billing is off, Stripe test mode only.
    business_billing_routes.install_routes(
        app, engine=engine, current_claims=current_claims, principal_for=_principal,
        allowed_origins=settings.allowed_origins,
    )
    # Usage meters, continuity and SLO credits (ADR-0448), behind business.entitlements.
    business_entitlement_routes.install_routes(
        app, engine=engine, current_claims=current_claims, principal_for=_principal
    )
    # Play-log export for licensing returns (ADR-0449); refused while business.licensing is off.
    business_playlog_routes.install_routes(
        app, engine=engine, current_claims=current_claims, principal_for=_principal
    )
    business_licensing_routes.install_routes(
        app, engine=engine, current_claims=current_claims, principal_for=_principal
    )
    # The staff console, its controls, unit economics and the work queue read (admin.wiring).
    admin_wiring.install(app, engine=engine, current_claims=current_claims,
                         emergency_cache=emergency_cache, rule_cache=rule_cache)
    # Business pricing behind business.signups, and the release-gate readout (BZ-0441, BZ-0454).
    business_rollout_routes.install_routes(
        app, engine=engine, current_claims=current_claims, principal_for=_principal,
        rules=rule_cache,
    )
    # The Labs opening for browser-first Cloud (BF-0467-05).
    local_first_labs_routes.install_routes(
        app, engine=engine, current_claims=current_claims, principal_for=_principal,
        rules=rule_cache,
    )

    flag_guard.assert_cloud_api_routes_owned(app)

    return app


__all__ = [
    "CloudConfigurationError",
    "CloudSettings",
    "RequestMethodMiddleware",
    "create_cloud_app",
]
