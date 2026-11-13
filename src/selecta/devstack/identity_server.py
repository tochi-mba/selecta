"""ASGI factory for the loopback-only WorkOS-compatible development identity provider."""

from __future__ import annotations

from selecta.devstack import guard
from selecta.devstack.identity import IdentityConfig, create_identity_app
from selecta.devstack.settings import CLIENT_ID, DevSettings


def application():
    guard.require_development()
    settings = DevSettings.from_environment()
    return create_identity_app(
        IdentityConfig(
            folder=settings.identity_folder,
            base_url=settings.identity_url,
            client_id=CLIENT_ID,
            site_origins=settings.site_origins,
            webhook_url=f"{settings.api_url}/api/webhooks/workos",
            webhook_secret=settings.secret("workos-webhook"),
        ),
    )


__all__ = ["application"]
