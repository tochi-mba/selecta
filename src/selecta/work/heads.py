"""Keeping `fair_heads` and `lane_clock` in step with the jobs, inside the same transaction.

Every job change that affects a head (queued, dispatched, finished, moved lane) calls one of the
functions here before its transaction commits, so the heads can't drift by design. The reconciler
in `selecta.work.upkeep` recomputes them from `jobs` every minute anyway.

Lock order, which keeps PostgreSQL free of deadlocks: lane clocks first, then job rows, then
heads. A claim takes its own pool's clocks (`lock_lanes`) and then heads and jobs with
`SKIP LOCKED`, so it never waits once it holds anything. Every other transaction that may touch
a head (enqueue, complete and the dependents it releases, fail, cancel, retry, maintenance)
takes every lane clock first (`lock_all_lanes`), before any other row. Clocks are a handful of
rows taken in one fixed order, so no transaction can hold a head while waiting for a clock, and
two of them can never wait on each other's heads.
"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.engine import Connection, Row

from selecta.scheduling import policy
from selecta.scheduling.policy import COMPETING_LANES, LANES, Lane
from selecta.work.catalogue import INTERNAL, POOLS
from selecta.work.schema import fair_heads, lane_clock
from selecta.work.sql import insert_ignore, locked, wake

HEAD_KEYS = ("pool", "lane", "workspace_id")
CLOCK_KEYS = ("pool", "lane")


def _where_head(pool: str, lane: str, workspace_id: str):
    return sa.and_(
        fair_heads.c.pool == pool,
        fair_heads.c.lane == str(lane),
        fair_heads.c.workspace_id == workspace_id,
    )


def _where_clock(pool: str, lane: str):
    return sa.and_(lane_clock.c.pool == pool, lane_clock.c.lane == str(lane))


def read_head(connection: Connection, pool: str, lane: str, workspace_id: str) -> Row | None:
    query = sa.select(fair_heads).where(_where_head(pool, lane, workspace_id))
    return connection.execute(locked(query)).one_or_none()


def ensure_head(connection: Connection, pool: str, lane: str, workspace_id: str, now: float) -> Row:
    """The head, created at V = 0 if it's new, and locked."""
    insert_ignore(
        connection,
        fair_heads,
        {"pool": pool, "lane": str(lane), "workspace_id": workspace_id, "updated_at": now},
        HEAD_KEYS,
    )
    return read_head(connection, pool, lane, workspace_id)


def ensure_clock(connection: Connection, pool: str, lane: str, now: float) -> Row:
    insert_ignore(connection, lane_clock, {"pool": pool, "lane": str(lane), "updated_at": now},
                  CLOCK_KEYS)
    query = sa.select(lane_clock).where(_where_clock(pool, lane))
    return connection.execute(locked(query)).one()


def _update_head(connection: Connection, head: Row, **values) -> None:
    connection.execute(
        fair_heads.update().where(_where_head(head.pool, head.lane, head.workspace_id)).values(
            **values
        )
    )


def _update_clock(connection: Connection, clock: Row, **values) -> None:
    connection.execute(lane_clock.update().where(_where_clock(clock.pool, clock.lane)).values(
        **values
    ))


def backlogged_floor(
    connection: Connection, pool: str, lane: str, exclude: str | None = None
) -> float | None:
    """The smallest V among workspaces with queued work in this pool and lane."""
    query = sa.select(sa.func.min(fair_heads.c.vtime)).where(
        fair_heads.c.pool == pool, fair_heads.c.lane == str(lane), fair_heads.c.queued_count > 0
    )
    if exclude is not None:
        query = query.where(fair_heads.c.workspace_id != exclude)
    return connection.execute(query).scalar()


def backlogged_lanes(connection: Connection, pool: str) -> set[str]:
    """Lanes in this pool where some workspace has queued work."""
    found = set()
    for lane in policy.LANES:
        probe = sa.select(sa.literal(1)).where(
            fair_heads.c.pool == pool, fair_heads.c.lane == str(lane), fair_heads.c.queued_count > 0
        ).limit(1)
        if connection.execute(probe).first() is not None:
            found.add(str(lane))
    return found


def lock_lanes(connection: Connection, pool: str) -> dict[str, float]:
    """Step 1 of a claim: hold the pool's lane clocks (a tiny table) and read their V.

    Every claim ends by charging a lane clock, so claims in one pool queue on these rows anyway.
    Taking them first, in a fixed order, means a claim never holds a workspace head while it
    waits: otherwise concurrent claimers each sit on a head and the next one skips them, so the
    smallest V loses its turn and shares drift towards round robin. It also means a transaction
    that holds a clock and then waits for a head can never be waiting on a claim.
    """
    rows = connection.execute(
        locked(
            sa.select(lane_clock.c.lane, lane_clock.c.vtime)
            .where(lane_clock.c.pool == pool)
            .order_by(lane_clock.c.lane)
        )
    )
    return {row.lane: row.vtime for row in rows}


def create_lanes(connection: Connection, now: float) -> None:
    """Make sure every pool and lane has its clock row, so `lock_all_lanes` always has rows to
    take (a lock on a row that doesn't exist yet orders nothing)."""
    for pool in POOLS:
        if pool == INTERNAL:
            continue
        for lane in LANES:
            insert_ignore(
                connection, lane_clock, {"pool": pool, "lane": str(lane), "updated_at": now},
                CLOCK_KEYS,
            )


def lock_all_lanes(connection: Connection) -> None:
    """The first lock of every transaction that may change a head (see the module notes)."""
    connection.execute(
        locked(sa.select(lane_clock.c.pool).order_by(lane_clock.c.pool, lane_clock.c.lane))
    ).all()


def lane_vtimes(connection: Connection, pool: str) -> dict[str, float]:
    rows = connection.execute(
        sa.select(lane_clock.c.lane, lane_clock.c.vtime).where(lane_clock.c.pool == pool)
    )
    return {row.lane: row.vtime for row in rows}


def pool_busy(connection: Connection, pool: str) -> int:
    """Attempts running in a pool, by the heads' counts."""
    total = connection.execute(
        sa.select(sa.func.sum(fair_heads.c.running_count)).where(fair_heads.c.pool == pool)
    ).scalar()
    return int(total or 0)


def job_queued(
    connection: Connection, pool: str, lane: str, workspace_id: str, est_cost_s: float, now: float
) -> None:
    """A job became queued. A head that starts waiting again gets `V = max(V, G)`, and so does
    its lane's clock when the whole lane starts waiting again."""
    head = ensure_head(connection, pool, lane, workspace_id, now)
    values = {
        "queued_count": head.queued_count + 1,
        "queued_est_s": head.queued_est_s + est_cost_s,
        "updated_at": now,
    }
    if head.queued_count <= 0:
        floor = backlogged_floor(connection, pool, lane, exclude=workspace_id)
        lane_was_idle = floor is None
        clock = ensure_clock(connection, pool, lane, now) if lane_was_idle else None
        if lane_was_idle:
            floor = clock.floor_vtime
        values["vtime"] = policy.backlogged_vtime(head.vtime, floor)
        values["waiting_since"] = now
        if lane_was_idle and Lane(lane) in COMPETING_LANES:
            _lane_starts_waiting(connection, clock, now)
    _update_head(connection, head, **values)
    wake(connection, pool)


def _lane_starts_waiting(connection: Connection, clock: Row, now: float) -> None:
    others = [
        other
        for other in COMPETING_LANES
        if other != clock.lane and backlogged_floor(connection, clock.pool, other) is not None
    ]
    if not others:
        return
    vtimes = lane_vtimes(connection, clock.pool)
    floor = policy.lane_floor((vtimes.get(str(other), 0.0) for other in others), clock.vtime)
    _update_clock(
        connection, clock, vtime=policy.backlogged_vtime(clock.vtime, floor), updated_at=now
    )


def job_unqueued(
    connection: Connection, pool: str, lane: str, workspace_id: str, est_cost_s: float, now: float
) -> None:
    """A queued job left the queue without being dispatched (cancelled, moved lane, waiting)."""
    head = read_head(connection, pool, lane, workspace_id)
    if head is None:
        return
    queued = max(head.queued_count - 1, 0)
    _update_head(
        connection,
        head,
        queued_count=queued,
        queued_est_s=max(head.queued_est_s - est_cost_s, 0.0) if queued else 0.0,
        waiting_since=head.waiting_since if queued else None,
        updated_at=now,
    )


def job_dispatched(
    connection: Connection,
    head: Row,
    est_cost_s: float,
    weight: float,
    lane_weight: float,
    now: float,
) -> None:
    """A claim took one of this (locked) head's jobs: charge V and the lane's clock."""
    queued = max(head.queued_count - 1, 0)
    _update_head(
        connection,
        head,
        queued_count=queued,
        queued_est_s=max(head.queued_est_s - est_cost_s, 0.0) if queued else 0.0,
        running_count=head.running_count + 1,
        vtime=policy.charge(head.vtime, est_cost_s, weight),
        waiting_since=now if queued else None,
        updated_at=now,
    )
    clock = ensure_clock(connection, head.pool, head.lane, now)
    values = {"floor_vtime": max(clock.floor_vtime, head.vtime), "updated_at": now}
    if Lane(head.lane) in COMPETING_LANES:
        values["vtime"] = policy.charge(clock.vtime, est_cost_s, lane_weight)
    _update_clock(connection, clock, **values)


def job_finished(
    connection: Connection,
    pool: str,
    lane: str,
    workspace_id: str,
    *,
    est_cost_s: float,
    actual_cost_s: float,
    weight: float,
    lane_weight: float,
    clamp_s: float,
    now: float,
) -> None:
    """An attempt ended, however it ended: free its slot and correct V by what it really cost."""
    head = ensure_head(connection, pool, lane, workspace_id, now)
    _update_head(
        connection,
        head,
        running_count=max(head.running_count - 1, 0),
        vtime=policy.corrected(head.vtime, est_cost_s, actual_cost_s, weight, clamp_s),
        updated_at=now,
    )
    if Lane(lane) in COMPETING_LANES:
        clock = ensure_clock(connection, pool, lane, now)
        _update_clock(
            connection,
            clock,
            vtime=policy.corrected(clock.vtime, est_cost_s, actual_cost_s, lane_weight, clamp_s),
            updated_at=now,
        )
