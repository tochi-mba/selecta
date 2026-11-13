"""Put the BZ-5 business routes into the cloud app: content controls and Rooms for Business.

ADR-0452's people routes (roles, SSO, offboarding, audit) are wired by their own package.

`api_cloud.create_cloud_app` calls `install` once. Every route refuses with 404 `flag_off` while
its `business.*` flag is off, and every flag defaults off (ADR-0441: built, not sold). Venue and
zone lookups read BZ-1's tables through `SqlDirectory`; tests pass their own directory.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from fastapi import FastAPI
from sqlalchemy.engine import Engine

from selecta.business.access.directory import Directory, SqlDirectory
from selecta.identity.tokens import Claims


def install(
    app: FastAPI,
    *,
    engine: Engine,
    current_claims: Callable[..., Claims],
    principal_for: Callable[..., Any],
    directory: Directory | None = None,
) -> None:
    from selecta.business.content import api as content_api
    from selecta.business.rooms import api as rooms_api

    directory = directory or SqlDirectory()
    app.state.business_directory = directory
    for module in (content_api, rooms_api):
        module.install_routes(
            app,
            engine=engine,
            current_claims=current_claims,
            principal_for=principal_for,
            directory=directory,
        )


__all__ = ["install"]
