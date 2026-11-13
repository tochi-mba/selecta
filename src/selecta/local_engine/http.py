"""Installable engine's guarded ASGI factory; not a cloud route."""

from __future__ import annotations

from selecta.local_engine import MIN_PROTOCOL_VERSION, PROTOCOL_VERSION
from selecta.local_engine.capabilities import capability_report
from selecta.local_engine.config import load_config, state_directory
from selecta.local_engine.discovery import installation_id
from selecta.local_engine.security import LoopbackGuard


def application():
    """Wrap the existing standalone Python DSP API, preserving its native algorithms."""
    from selecta.api import serve

    directory = state_directory()
    config = load_config(directory)
    app = serve()
    identifier = installation_id(directory)

    @app.get("/api/local-engine/health", include_in_schema=False)
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

    @app.get("/api/local-engine/capabilities", include_in_schema=False)
    def capabilities():
        return capability_report()

    return LoopbackGuard(app, port=config.port, state_dir=directory)
