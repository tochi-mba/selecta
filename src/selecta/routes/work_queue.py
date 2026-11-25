"""Staff read of whether queued work is being picked up (`selecta.work.queue_health`).

`GET /api/admin/work/queue` belongs to the `admin.console` flag like every staff route: the
caller needs a privileged staff session (`admin.http.staff_actor`) and the `workers.read`
permission, the same as the console's worker list. It reads platform-wide counts only (no
workspace ids, no song names, no customer data), and changes nothing. Its answer is
`queue_health.snapshot`'s, plus the `work.queue_stuck` alerts raised in the last day.
"""

from __future__ import annotations

from collections.abc import Callable

import sqlalchemy as sa
from fastapi import Depends, FastAPI, Request
from sqlalchemy.engine import Connection, Engine

from selecta.identity.tokens import Claims

DAY_S = 86_400.0


def install_routes(app: FastAPI, *, engine: Engine,
                   current_claims: Callable[..., Claims]) -> None:
    @app.get("/api/admin/work/queue")
    def work_queue(request: Request, claims: Claims = Depends(current_claims)):  # noqa: B008
        from selecta.admin import http
        from selecta.admin.schema import platform_alerts
        from selecta.authz.check import authorize
        from selecta.persistence import db_now
        from selecta.work import queue_health

        actor = http.staff_actor(engine, request, claims)

        def read(conn: Connection) -> dict:
            authorize(conn, actor, "workers.read")
            found = queue_health.snapshot(conn)
            rows = conn.execute(
                sa.select(platform_alerts.c.id, platform_alerts.c.created_at,
                          platform_alerts.c.summary, platform_alerts.c.metadata,
                          platform_alerts.c.acknowledged_at)
                .where(platform_alerts.c.kind == queue_health.ALERT_KIND,
                       platform_alerts.c.created_at >= db_now(conn) - DAY_S)
                .order_by(platform_alerts.c.created_at.desc()).limit(50)).mappings()
            found["alerts"] = [
                {"id": row["id"], "created_at": row["created_at"], "summary": row["summary"],
                 "pool": (row["metadata"] or {}).get("pool"),
                 "acknowledged_at": row["acknowledged_at"]} for row in rows]
            return found

        return http.run(engine, actor, read)


__all__ = ["install_routes"]
