"""The maintenance leader: one process reaps leases, reconciles heads and rebases virtual times.

On PostgreSQL the leader holds a session-level advisory lock on a dedicated direct connection
(session locks don't survive a transaction-mode pooler, so it can't come from the pool). If that
connection drops, the lock is released and a standby takes over, while the old process may still
be part-way through a task. So every acquisition bumps a term number in `leader_terms`, and every
maintenance transaction first checks that its term is still the current one: a task started under
an older term stops when it sees a newer one.

On SQLite there is one process: it is always the leader, but it still takes a term, so a restart
fences anything the previous run left half done.
"""

from __future__ import annotations

import hashlib
import logging
import os
import socket
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass, field

import sqlalchemy as sa
from sqlalchemy.engine import Connection, Engine

from selecta.persistence import db_now, transaction
from selecta.work.errors import LostLeadership
from selecta.work.schema import leader_terms
from selecta.work.sql import insert_ignore
from selecta.work.store import JobStore

log = logging.getLogger(__name__)
NAME = "maintenance"


def advisory_key(name: str) -> int:
    """A stable signed 64-bit key for `pg_try_advisory_lock`, from the leadership's name."""
    digest = hashlib.sha256(f"selecta:{name}".encode()).digest()
    return int.from_bytes(digest[:8], "big", signed=True)


@dataclass(frozen=True)
class TermFence:
    """Raises `LostLeadership` inside a transaction once a newer term exists."""

    name: str
    term: int

    def check(self, connection: Connection) -> None:
        current = connection.execute(
            sa.select(leader_terms.c.term).where(leader_terms.c.name == self.name)
        ).scalar()
        if current != self.term:
            raise LostLeadership(f"Maintenance term {self.term} has been replaced by {current}.")


class Leadership:
    """Who runs maintenance. `acquire()` returns the new term, or None if another process leads."""

    def __init__(
        self,
        engine: Engine,
        *,
        name: str = NAME,
        lock_connection: Connection | None = None,
        holder: str | None = None,
    ):
        self.engine = engine
        self.name = name
        self.lock_connection = lock_connection
        self.holder = holder or f"{socket.gethostname()}:{os.getpid()}"
        self.term: int | None = None
        self.postgres = engine.dialect.name == "postgresql"
        if self.postgres and lock_connection is None:
            raise ValueError("On PostgreSQL, pass a dedicated direct connection for the lock.")

    def acquire(self) -> int | None:
        if self.term is not None and self.is_current():
            return self.term
        self.term = None
        if self.postgres and not self._try_lock():
            return None
        with transaction(self.engine) as connection:
            now = db_now(connection)
            insert_ignore(connection, leader_terms, {"name": self.name, "term": 0}, ("name",))
            connection.execute(
                leader_terms.update()
                .where(leader_terms.c.name == self.name)
                .values(
                    term=leader_terms.c.term + 1,
                    holder=self.holder,
                    acquired_at=now,
                    renewed_at=now,
                )
            )
            self.term = connection.execute(
                sa.select(leader_terms.c.term).where(leader_terms.c.name == self.name)
            ).scalar_one()
        log.info("Maintenance leader %s took term %s", self.holder, self.term)
        return self.term

    def _try_lock(self) -> bool:
        connection = self.lock_connection
        got = connection.execute(
            sa.text("SELECT pg_try_advisory_lock(:key)"), {"key": advisory_key(self.name)}
        ).scalar()
        connection.commit()  # the lock belongs to the session, not this transaction
        return bool(got)

    def is_current(self) -> bool:
        """Still the leader: the lock connection is alive and no newer term exists."""
        if self.term is None:
            return False
        if self.postgres:
            try:
                self.lock_connection.execute(sa.text("SELECT 1"))
                self.lock_connection.commit()
            except Exception:  # noqa: BLE001 - any failure means the session (and lock) is gone
                self.term = None
                return False
        try:
            with transaction(self.engine) as connection:
                TermFence(self.name, self.term).check(connection)
                connection.execute(
                    leader_terms.update()
                    .where(leader_terms.c.name == self.name, leader_terms.c.term == self.term)
                    .values(renewed_at=db_now(connection))
                )
        except LostLeadership:
            self.term = None
            return False
        return True

    def fence(self) -> TermFence:
        if self.term is None:
            raise LostLeadership("This process isn't the maintenance leader.")
        return TermFence(self.name, self.term)

    def release(self) -> None:
        if self.postgres and self.term is not None:
            try:
                self.lock_connection.execute(
                    sa.text("SELECT pg_advisory_unlock(:key)"), {"key": advisory_key(self.name)}
                )
                self.lock_connection.commit()
            except Exception:  # noqa: BLE001 - a dropped connection has released it already
                pass
        self.term = None


@dataclass
class Schedule:
    """How often each task runs, in seconds."""

    reap_s: float = 5.0
    reconcile_s: float = 60.0
    rebase_s: float = 60.0
    prune_s: float = 3_600.0
    actions_s: float = 15.0
    """How often due dangerous actions run (`due_actions`), well inside their 15-minute delay."""
    preempt_s: float = 5.0
    pools: tuple[str, ...] = ()
    """Pools to check for preemption each tick. Empty: leave preemption to the runners."""
    last: dict[str, float] = field(default_factory=dict)


class MaintenanceLoop:
    """Runs the maintenance tasks on a thread while this process leads.

    Every task is idempotent and term-fenced. Head differences found by the reconciler go to
    `on_differences`, which the cloud wires to an alert: the heads should never drift.
    """

    def __init__(
        self,
        store: JobStore,
        leadership: Leadership,
        schedule: Schedule | None = None,
        *,
        on_differences: Callable[[list], None] | None = None,
        due_actions: Callable[[TermFence], list] | None = None,
        tick_s: float = 1.0,
    ):
        self.store = store
        self.leadership = leadership
        self.schedule = schedule or Schedule()
        self.on_differences = on_differences
        self.due_actions = due_actions
        """Runs due dangerous actions under the term fence; the cloud passes
        `selecta.admin.actions.maintenance_task(engine)`. Local mode has none."""
        self.tick_s = tick_s
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    def _due(self, task: str, every: float, moment: float) -> bool:
        last = self.schedule.last.get(task)
        if last is not None and moment - last < every:
            return False
        self.schedule.last[task] = moment
        return True

    def run_once(self, moment: float | None = None) -> dict[str, object]:
        """Run whichever tasks are due. Returns what each did, for logs and tests."""
        moment = time.monotonic() if moment is None else moment
        if self.leadership.acquire() is None:
            return {}
        fence = self.leadership.fence()
        done: dict[str, object] = {}
        try:
            if self._due("reap", self.schedule.reap_s, moment):
                done["reaped"] = self.store.reap_expired(fence)
                done["retried"] = self.store.promote_due_retries(fence)
            if self._due("preempt", self.schedule.preempt_s, moment):
                done["preempted"] = [
                    target
                    for pool in self.schedule.pools
                    if (target := self.store.request_preemption(pool)) is not None
                ]
            if self._due("reconcile", self.schedule.reconcile_s, moment):
                differences = self.store.reconcile_heads(fence)
                done["reconciled"] = differences
                if differences:
                    log.warning("fair_heads drifted: %s", differences)
                    if self.on_differences is not None:
                        self.on_differences(differences)
            if self._due("rebase", self.schedule.rebase_s, moment):
                done["rebased"] = self.store.rebase_vtimes(fence)
            if self._due("prune", self.schedule.prune_s, moment):
                done["pruned"] = self.store.prune_outbox(fence=fence)
            if self.due_actions is not None and self._due("actions", self.schedule.actions_s,
                                                          moment):
                done["actions"] = self.due_actions(fence)
        except LostLeadership:
            log.info("Maintenance term %s ended; standing by.", fence.term)
            self.leadership.term = None
        return done

    def _run(self) -> None:
        while not self._stop.is_set():
            try:
                self.run_once()
            except Exception:  # noqa: BLE001 - maintenance must keep going after a bad tick
                log.exception("A maintenance tick failed")
            self._stop.wait(self.tick_s)

    def start(self) -> None:
        if self._thread is None or not self._thread.is_alive():
            self._stop.clear()
            self._thread = threading.Thread(target=self._run, name="selecta-maintenance",
                                            daemon=True)
            self._thread.start()

    def stop(self, timeout: float | None = 10.0) -> None:
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout)
        self.leadership.release()

