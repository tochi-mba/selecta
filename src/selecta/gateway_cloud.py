"""Standalone Cloud worker gateway application factory.

The gateway shares the Cloud database and storage adapters, but has its own process and host
allowlist. It does not load WorkOS or customer API configuration and never starts local workers.
"""

from __future__ import annotations

import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from sqlalchemy.engine import Engine
from starlette.middleware.trustedhost import TrustedHostMiddleware

from selecta.admin.state import DbWorkControls
from selecta.billing.plans import validate_catalogue
from selecta.flags.rules import RulesCache
from selecta.observability import errors, metrics, tracing
from selecta.persistence import make_engine
from selecta.persistence.listen import PgListener
from selecta.persistence.migrate import current as migration_current
from selecta.persistence.migrate import head as migration_head
from selecta.work import cloud_ports, gateway_api
from selecta.work.store import JobStore


class GatewayConfigurationError(RuntimeError):
    """The isolated worker gateway lacks a required deployment setting."""


def _csv(name: str) -> tuple[str, ...]:
    return tuple(value.strip() for value in os.environ.get(name, "").split(",") if value.strip())


def create_gateway_app(*, engine: Engine | None = None) -> FastAPI:
    """Build a production worker gateway with scoped tokens and signed R2 object URLs."""
    validate_catalogue()
    database_url = os.environ.get("SELECTA_GATEWAY_DATABASE_URL") or os.environ.get(
        "SELECTA_DATABASE_URL", ""
    )
    if not database_url.startswith(("postgresql://", "postgresql+psycopg://")):
        raise GatewayConfigurationError("The worker gateway requires a PostgreSQL database URL.")
    allowed_hosts = _csv("SELECTA_GATEWAY_ALLOWED_HOSTS")
    if not allowed_hosts or "*" in allowed_hosts:
        raise GatewayConfigurationError(
            "Set SELECTA_GATEWAY_ALLOWED_HOSTS to explicit gateway hostnames."
        )
    token_secret = os.environ.get("SELECTA_WORKER_TOKEN_SECRET", "")
    bootstrap_token = os.environ.get("SELECTA_WORKER_BOOTSTRAP_TOKEN", "")
    if len(token_secret.encode()) < 32 or len(bootstrap_token.encode()) < 32:
        raise GatewayConfigurationError(
            "Worker token and bootstrap secrets must each contain at least 32 bytes."
        )

    owns_engine = engine is None
    engine = engine or make_engine(database_url, pool_pre_ping=True)

    rules = RulesCache(engine, max_age=5.0)
    # Rule changes reach the gateway's claim checks on commit, not on the next 5 s check.
    listener = PgListener.for_engine(engine)
    if listener is not None:
        rules.listen(listener)

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        if listener is not None:
            listener.start()
        yield
        if listener is not None:
            listener.stop()
        if owns_engine:
            engine.dispose()

    app = FastAPI(
        title="SelectaDJ Worker Gateway", docs_url=None, redoc_url=None, lifespan=lifespan
    )
    app.state.database_engine = engine
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=list(allowed_hosts))
    tracing.install(app, "gateway")
    tracing.configure_from_environment("gateway")
    errors.configure_from_environment("gateway")
    metrics.configure_from_environment("gateway")
    app.state.flag_rules = rules
    store = JobStore(
        engine,
        entitlements=cloud_ports.CloudJobEntitlements(engine),
        flags=cloud_ports.CloudJobFlags(engine, rules),
        verifier=cloud_ports.R2OutputVerifier(),
        controls=DbWorkControls(),
    )
    store.trace_service = "gateway"
    app.state.job_store = store
    gateway_api.install_routes(
        app,
        store=store,
        token_secret=token_secret,
        bootstrap_token=bootstrap_token,
        sign_inputs=cloud_ports.signed_inputs,
        output_prefix_for=cloud_ports.output_prefix,
        sign_outputs=lambda attempt, names: cloud_ports.signed_outputs(store, attempt, names),
    )

    @app.get("/api/status")
    def status():
        return {"service": "worker-gateway", "status": "ok"}

    @app.get("/api/ready")
    def ready():
        try:
            current = migration_current(engine)
            head = migration_head()
        except Exception as error:
            raise HTTPException(status_code=503, detail={"code": "database_unavailable"}) from error
        if current != head:
            raise HTTPException(
                status_code=503,
                detail={"code": "migrations_pending", "current": current, "head": head},
            )
        return {"service": "worker-gateway", "status": "ready", "schema": current}

    return app


__all__ = ["GatewayConfigurationError", "create_gateway_app"]
