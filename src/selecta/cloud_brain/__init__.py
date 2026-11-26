"""The brain in Cloud (ADR-0479, phase 4): song facts in, planning decisions out.

A signed-in device saves the facts it measured for the account's songs (`facts_routes`), and the
planner core runs over those facts to answer what Desktop's planner answers: the ranked ways from
one song into the next with their scripts, the repair rule's next step, the order of a mix and
the idea cards (`planning_routes`). A studio reports the seams it rendered, the member rates
them, and the planner learns from both (`seams_routes`). The account's mixes and drafts answer
the Desktop's own mix routes (`mixes_routes`, also behind `cloud.account_mixes`; see
docs/engineering/engine-store-mixes.md). A studio renders and audits; nothing
here hears audio. Every route needs the `cloud.brain` flag (refused as `flag_off` while it is
off; the seam verdict and ratings routes also keep their Desktop owners) and works in the
caller's own workspace through the engine store, whatever `core.engine_store` says: that flag
guards how Desktop opens its library file. See docs/engineering/cloud-planning.md and
docs/engineering/engine-store-seams.md.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from fastapi import FastAPI
from sqlalchemy.engine import Engine

from selecta.identity.tokens import Claims
from selecta.storage.artifacts import Buckets, R2ArtifactStore
from selecta.storage.objects import ObjectClient

FLAG = "cloud.brain"


def install_routes(
    app: FastAPI,
    *,
    engine: Engine,
    current_claims: Callable[..., Claims],
    principal_for: Callable[..., Any],
    object_client_factory: Callable[[], ObjectClient],
    buckets: Buckets,
    rules: Any = None,
) -> None:
    """Mount the song facts, planning and seam routes, with features read and written through
    the Cloud's own artifact store (the private derived bucket, keyed by workspace). `rules` is
    the flag rules cache, for the seam routes a Desktop flag owns (`seams_routes`)."""
    from selecta.cloud_brain import facts_routes, mixes_routes, planning_routes, seams_routes

    def artifacts() -> R2ArtifactStore:
        return R2ArtifactStore(object_client_factory(), buckets)

    for routes in (facts_routes, planning_routes):
        routes.install(
            app,
            engine=engine,
            current_claims=current_claims,
            principal_for=principal_for,
            artifacts=artifacts,
        )
    for routes in (seams_routes, mixes_routes):
        routes.install(
            app,
            engine=engine,
            current_claims=current_claims,
            principal_for=principal_for,
            rules=rules,
        )


__all__ = ["FLAG", "install_routes"]
