"""Every staff console route the Cloud API mounts, in one call from `api_cloud.create_cloud_app`.

- `admin.routes`: the console itself (and, through it, `routes_console` and `routes_workers`);
- `admin.routes_controls`: emergency controls, flags and takedowns;
- `admin.routes_economics`: unit economics and the step-4 readiness check (BF-0464-04/05,
  BF-0467-04);
- `routes.work_queue`: whether queued work is being picked up, per worker pool
  (`work.queue_health`).

Each keeps its own flag ownership and permission checks; this only gathers the mounting.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from fastapi import FastAPI
from sqlalchemy.engine import Engine

from selecta.admin.state import EmergencyCache
from selecta.identity.tokens import Claims


def install(app: FastAPI, *, engine: Engine, current_claims: Callable[..., Claims],
            emergency_cache: EmergencyCache, rule_cache: Any) -> None:
    from selecta.admin import routes, routes_controls, routes_economics
    from selecta.routes import work_queue

    routes.install_routes(app, engine=engine, current_claims=current_claims,
                          emergency=emergency_cache)
    routes_controls.install_routes(app, engine=engine, current_claims=current_claims,
                                   emergency_cache=emergency_cache, rule_cache=rule_cache)
    routes_economics.install_routes(app, engine=engine, current_claims=current_claims)
    work_queue.install_routes(app, engine=engine, current_claims=current_claims)


__all__ = ["install"]
