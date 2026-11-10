"""What the emergency controls and staff holds say right now, for the code paths they change.

This module only reads. It has no authorization in it and imports nothing from the admin
commands, so the job store, the AI gateway, uploads and the API middleware can all ask it
"is this paused?" without pulling in the console. Changing a control is `admin.emergency`.

The controls are declarative states (§14), each with a target:

| Control | Target | Where it takes effect |
|---|---|---|
| `uploads.paused` | `*` | Upload planning and part signing refuse (503 `uploads_paused`) |
| `admission.paused` | a pool | `JobStore.admit` refuses new work for that pool |
| `workers.drained` | a pool or `*` | Claims in that pool return nothing; running work finishes |
| `speculative.disabled` | `*` | No speculative claims, and speculative admission refuses |
| `lucy.disabled` | `*` | `ai.gateway.plan_turn` refuses every turn (`lucy_disabled`) |
| `lucy.deployment_disabled` | a deployment id | Routing skips that deployment and falls back |
| `billing.safe_mode` | `*` | Checkout and portal refuse; Stripe events are stored, not applied |
| `app.read_only` | `*` | Every customer write refuses (503 `read_only`); reads still work |
| `signups.disabled` | `*` | Onboarding refuses people without an account (`signups_closed`) |

`EmergencyCache` keeps one process's view for up to `max_age` seconds, so a hot request path
reads the table at most that often. On PostgreSQL every change also sends
`pg_notify('selecta_emergency_controls')` in its own transaction (`notify()`), and each API
instance's cache, subscribed through `persistence.listen.PgListener`, forgets its view the moment
that commits; `max_age` stays as the fallback for a dropped LISTEN connection.
"""

from __future__ import annotations

import threading
import time
from collections.abc import Iterable
from dataclasses import dataclass, field
from enum import StrEnum

import sqlalchemy as sa
from sqlalchemy.engine import Connection, Engine

from selecta.admin.schema import emergency_controls, upload_restrictions, worker_controls
from selecta.persistence import is_postgres

ALL = "*"
CHANNEL = "selecta_emergency_controls"


class Control(StrEnum):
    UPLOADS = "uploads.paused"
    ADMISSION = "admission.paused"
    DRAIN = "workers.drained"
    SPECULATIVE = "speculative.disabled"
    LUCY = "lucy.disabled"
    DEPLOYMENT = "lucy.deployment_disabled"
    BILLING_SAFE_MODE = "billing.safe_mode"
    READ_ONLY = "app.read_only"
    SIGNUPS = "signups.disabled"


# Which controls take a named target (a pool or a deployment) instead of `*`.
TARGETED = frozenset({Control.ADMISSION, Control.DEPLOYMENT})
# `workers.drained` takes either: one pool, or `*` for every pool.
EITHER = frozenset({Control.DRAIN})

DESCRIPTIONS = {
    Control.UPLOADS: "Pause uploads: no new upload plans or part URLs.",
    Control.ADMISSION: "Pause admission for one pool: new jobs for it are refused.",
    Control.DRAIN: "Drain workers: claims stop in the pool (or all pools); running work finishes.",
    Control.SPECULATIVE: "Disable speculative work: none is admitted or claimed.",
    Control.LUCY: "Disable Lucy: every new turn is refused.",
    Control.DEPLOYMENT: "Disable one Lucy deployment: routing falls back past it.",
    Control.BILLING_SAFE_MODE: "Billing safe mode: no checkout or portal; Stripe events are held.",
    Control.READ_ONLY: "Read-only app: customers can read and sign out, nothing else.",
    Control.SIGNUPS: "Disable sign-ups: people without an account can't finish onboarding.",
}


@dataclass(frozen=True)
class EmergencyState:
    """Every engaged control as `(control, target)` pairs. Empty means normal operation."""

    engaged: frozenset[tuple[str, str]] = field(default_factory=frozenset)

    def on(self, control: Control | str, target: str = ALL) -> bool:
        return (str(control), target) in self.engaged

    def targets(self, control: Control | str) -> frozenset[str]:
        name = str(control)
        return frozenset(target for kind, target in self.engaged if kind == name)

    @property
    def uploads_paused(self) -> bool:
        return self.on(Control.UPLOADS)

    @property
    def read_only(self) -> bool:
        return self.on(Control.READ_ONLY)

    @property
    def billing_safe_mode(self) -> bool:
        return self.on(Control.BILLING_SAFE_MODE)

    @property
    def signups_disabled(self) -> bool:
        return self.on(Control.SIGNUPS)

    @property
    def speculative_disabled(self) -> bool:
        return self.on(Control.SPECULATIVE)

    @property
    def lucy_disabled(self) -> bool:
        return self.on(Control.LUCY)

    def admission_paused(self, pool: str) -> bool:
        return self.on(Control.ADMISSION, pool)

    def drained(self, pool: str) -> bool:
        return self.on(Control.DRAIN, pool) or self.on(Control.DRAIN, ALL)

    def disabled_deployments(self) -> frozenset[str]:
        return self.targets(Control.DEPLOYMENT)


NORMAL = EmergencyState()


def load(conn: Connection) -> EmergencyState:
    rows = conn.execute(
        sa.select(emergency_controls.c.control, emergency_controls.c.target).where(
            emergency_controls.c.engaged.is_(True)
        )
    )
    return EmergencyState(frozenset((row.control, row.target) for row in rows))


def notify(conn: Connection) -> None:
    """Tell every instance the controls changed. Delivered only if this transaction commits."""
    if is_postgres(conn):
        conn.execute(sa.text("SELECT pg_notify(:channel, '')"), {"channel": CHANNEL})


def worker_hold(conn: Connection, worker_id: str | None) -> str | None:
    """`drain` or `pause` when staff hold this worker, else None."""
    if worker_id is None:
        return None
    return conn.execute(
        sa.select(worker_controls.c.hold).where(worker_controls.c.worker_id == worker_id)
    ).scalar_one_or_none()


def uploads_restricted(conn: Connection, workspace_id: str) -> bool:
    """Whether this workspace's uploads are suspended (for example, repeat infringement)."""
    row = conn.execute(
        sa.select(upload_restrictions.c.workspace_id).where(
            upload_restrictions.c.workspace_id == workspace_id,
            upload_restrictions.c.lifted_at.is_(None),
        )
    ).first()
    return row is not None


class EmergencyCache:
    """One process's view of the controls, re-read from the database at most every `max_age`."""

    def __init__(self, engine: Engine, max_age: float = 2.0) -> None:
        self.engine = engine
        self.max_age = max_age
        self._state = NORMAL
        self._read_at = float("-inf")
        self._lock = threading.Lock()

    def state(self) -> EmergencyState:
        with self._lock:
            if time.monotonic() - self._read_at < self.max_age:
                return self._state
        with self.engine.connect() as conn:
            fresh = load(conn)
        with self._lock:
            self._state, self._read_at = fresh, time.monotonic()
        return fresh

    def invalidate(self) -> None:
        with self._lock:
            self._read_at = float("-inf")

    def listen(self, listener) -> None:
        """Forget the cached view whenever `listener` hears a change, and after each
        (re)connect, since changes made while it was away weren't heard."""
        listener.subscribe(CHANNEL, lambda _payload: self.invalidate())


class DbWorkControls:
    """The job store's view of the controls (`work.ports.WorkControls`), read in its transaction."""

    def claim_block(self, connection: Connection, pool: str, worker_id: str | None) -> str | None:
        if load(connection).drained(pool):
            return "pool drained"
        hold = worker_hold(connection, worker_id)
        return f"worker held ({hold})" if hold else None

    def speculative_off(self, connection: Connection) -> bool:
        return load(connection).speculative_disabled

    def admission_block(self, connection: Connection, pool: str, lane: str) -> str | None:
        state = load(connection)
        if state.admission_paused(pool):
            return "admission paused"
        if lane == "speculative" and state.speculative_disabled:
            return "speculative work disabled"
        return None


def known_targets(control: Control, pools: Iterable[str], deployments: Iterable[str]) -> set[str]:
    """The targets a control accepts, given the real pools and deployments."""
    if control in TARGETED:
        return set(pools) if control is Control.ADMISSION else set(deployments)
    if control in EITHER:
        return {ALL, *pools}
    return {ALL}
