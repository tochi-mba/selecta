"""Guarded installable engine ASGI factory; no modification to legacy API routes."""

from __future__ import annotations

from fastapi import FastAPI

from selecta.local_engine import MIN_PROTOCOL_VERSION, PROTOCOL_VERSION
from selecta.local_engine.capabilities import capability_report
from selecta.local_engine.config import EngineConfig, load_config, state_directory
from selecta.local_engine.discovery import installation_id
from selecta.local_engine.security import LoopbackGuard


def guarded_application(legacy_app, *, directory, config: EngineConfig):
    """Route engine endpoints BEFORE the legacy root static mount.

    The standalone create_app() can mount "/" last. Registering additional
    FastAPI routes after that mount makes them unreachable. An ASGI router
    keeps local engine metadata separate while delegating all existing
    routes and static content intact.
    """
    meta = FastAPI(openapi_url=None, docs_url=None, redoc_url=None)
    identifier = installation_id(directory)

    @meta.get("/api/local-engine/health")
    def health():
        report = capability_report()
        return {
            "service": "selecta-local-engine",
            "installation_id": identifier,
            "protocol_min": MIN_PROTOCOL_VERSION,
            "protocol_max": PROTOCOL_VERSION,
            "api_ready": True,
            "audio_ready": report["ready_for_audio"],
            "output_state": report["output"]["state"],
        }

    @meta.get("/api/local-engine/capabilities")
    def capabilities():
        return capability_report()

    class Dispatch:
        async def __call__(self, scope, receive, send):
            if (
                scope["type"] == "http"
                and scope.get("path") in (
                    "/api/local-engine/health", "/api/local-engine/capabilities"
                )
            ):
                await meta(scope, receive, send)
            else:
                await legacy_app(scope, receive, send)

    return LoopbackGuard(Dispatch(), port=config.port, state_dir=directory)


def application():
    """Run Selecta's existing API in user-controlled local mode."""
    from selecta.api import serve

    directory = state_directory()
    config = load_config(directory)
    return guarded_application(serve(), directory=directory, config=config)
