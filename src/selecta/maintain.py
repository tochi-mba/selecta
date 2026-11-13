"""The maintenance service (§4.3): `selecta maintain`, one active copy and one standby.

It runs `work.maintenance.MaintenanceLoop` with every recurring job the cloud needs, so nothing
depends on a cron somebody forgot:

| Task | Every | What it does |
|---|---|---|
| `reaped`, `retried` | 5 s | Lease reaping (which releases or blocks dependents), due retries |
| `reconciled`, `rebased`, `pruned` | 60 s, 60 s, 1 h | Fair-share heads, vtimes, old outbox |
| `actions` | 15 s | Due dangerous actions (`admin.actions.run_due`), fenced by the term |
| `reservations` | 60 s | Reservations whose upload ran out (`quota.expire_reservations`) |
| `lucy_runs` | 60 s | Lucy turns whose server went away (`ai.gateway.sweep_abandoned`) |
| `flag_previews` | 10 min | Ended staff flag previews |
| `admin_metrics` | 30 s | The Overview's aggregates (`admin.read_models.refresh`) |
| `stripe_events` | 60 s | Stored Stripe events, as `billing-maintenance` |
| `stripe_reconcile` | 24 h | The full subscription sweep, as `billing-maintenance --reconcile` |
| `account_deletions` | 60 s | Due account-deletion steps, as `account-deletion-maintenance` |
| `storage_deletions` | 10 min | Mirror tombstones, then purge, as `storage-maintenance` |
| `rooms` | 60 s | End expired rooms and purge guest data |
| `usage_reconcile` | 24 h | Ledger vs rollups and storage; drift becomes an alert, never a fix |
| `derived_eviction` | 10 min | Workspaces over their derived-data budget (`storage.eviction`) |
| `export_expiry` | 1 h | Exports past their plan's retention (`storage.export_expiry`) |
| `autoscale` | 30 s | Size each worker pool and tell the launcher (`work.autoscale_leader`) |
| `dmca_renewal` | 24 h | Owner alert as the DMCA agent's renewal nears (`admin.dmca`) |
| `business.zone_clock` | 30 s | Each venue zone's next opening or closing change |
| `queue_metrics`, `lost_jobs`, `backup_freshness` | 15 s, 10 min, 10 min | The SLO and alert
  series only the leader sees (`observability.leader_metrics`) |

Tasks that need a secret it doesn't have (Stripe, WorkOS, the deletion-ledger bucket, the room
pepper) are left out, and the start-up log names each one and the setting it needs.

Leadership is the advisory lock on a dedicated connection (`work.maintenance.Leadership`), so a
second copy stands by and takes over within a tick of the leader's connection dying. A task that
raises is logged and the others still run. SIGTERM or Ctrl+C stops it at the end of the current
tick and releases the lock, so the standby takes over at once.
"""

from __future__ import annotations

import logging
import os
import signal
import threading
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field

from sqlalchemy.engine import Connection, Engine

from selecta.persistence import make_engine, transaction
from selecta.work.maintenance import Leadership, MaintenanceLoop, Schedule, Task, TermFence
from selecta.work.store import JobStore

log = logging.getLogger(__name__)
DAY_S = 86_400.0


@dataclass
class Plan:
    """The tasks to run, and the ones left out with the reason."""

    tasks: list[Task] = field(default_factory=list)
    disabled: dict[str, str] = field(default_factory=dict)


def _in_transaction(engine: Engine, work: Callable[[Connection], object]):
    def run(fence: TermFence) -> object:
        with transaction(engine) as conn:
            fence.check(conn)
            return work(conn)

    return run


def core_tasks(engine: Engine) -> list[Task]:
    """The tasks that need nothing but the database."""
    from selecta.admin import actions, read_models
    from selecta.ai.gateway import sweep_abandoned
    from selecta.flags.rules import expire_previews
    from selecta.usage.quota import expire_reservations

    return [
        Task("actions", 15.0, actions.maintenance_task(engine)),
        Task("reservations", 60.0, lambda _fence: expire_reservations(engine)),
        Task("lucy_runs", 60.0, _in_transaction(engine, lambda c: len(sweep_abandoned(c)))),
        Task("flag_previews", 600.0, _in_transaction(engine, expire_previews)),
        Task("admin_metrics", 30.0, _in_transaction(engine, read_models.refresh)),
        Task("usage_reconcile", DAY_S, _in_transaction(engine, usage_reconciliation)),
    ]


def usage_reconciliation(conn: Connection) -> int:
    """Check the usage ledger (`usage.reconcile`) and raise one alert listing any drift. It
    only reports: which side is wrong is a person's call."""
    from selecta.admin import alerts
    from selecta.usage.reconcile import reconcile

    report = reconcile(conn)
    from selecta.observability import metrics

    metrics.set_gauge("selecta_reconciliation_drift", len(report.drifts), check="usage")
    if not report.ok:
        alerts.raise_alert(
            conn,
            "usage.reconciliation_drift",
            f"Usage reconciliation found {len(report.drifts)} differences.",
            metadata={
                "first": str(report.first),
                "last": str(report.last),
                "drifts": report.lines()[:50],
            },
        )
    return len(report.drifts)


class _DerivedObjects:
    """`storage.eviction.evict`'s object store: deletes in the derived bucket."""

    def __init__(self, client, bucket: str) -> None:
        self.client, self.bucket = client, bucket

    def delete(self, key: str) -> None:
        self.client.delete_object(self.bucket, key)


def _eviction(engine: Engine, env: Mapping[str, str], plan: Plan) -> None:
    try:
        from selecta.storage import eviction
    except ImportError:
        plan.disabled["derived_eviction"] = "storage.eviction isn't installed yet"
        return
    needed = ("SELECTA_R2_ACCOUNT_ID", "SELECTA_R2_ACCESS_KEY_ID", "SELECTA_R2_SECRET_ACCESS_KEY")
    if not all(env.get(name, "").strip() for name in needed):
        plan.disabled["derived_eviction"] = "set " + ", ".join(needed)
        return
    from selecta.storage import api as storage_api

    def sweep(_fence: TermFence) -> object:
        client = storage_api.r2_client()
        try:
            objects = _DerivedObjects(client, storage_api.buckets().derived)
            return [
                eviction.evict(engine, workspace, objects).workspace_id
                for workspace in eviction.over_budget(engine)
            ]
        finally:
            getattr(client, "close", lambda: None)()

    plan.tasks.append(Task("derived_eviction", 600.0, sweep))


def _billing(engine: Engine, env: Mapping[str, str], plan: Plan) -> None:
    from selecta.billing.maintenance import drain_stripe_events, reconcile_stripe_billing
    from selecta.billing.stripe_sync import load_price_map
    from selecta.billing.webhooks import HttpStripeClient

    key = env.get("SELECTA_STRIPE_SECRET_KEY", "").strip()
    prices = load_price_map()
    if not key or not prices:
        for name in ("stripe_events", "stripe_reconcile"):
            plan.disabled[name] = "set SELECTA_STRIPE_SECRET_KEY and SELECTA_STRIPE_PRICES"
        return
    client = HttpStripeClient(key, api_version=env.get("SELECTA_STRIPE_API_VERSION"))
    plan.tasks.append(
        Task("stripe_events", 60.0, lambda _f: drain_stripe_events(engine, client, prices))
    )
    plan.tasks.append(
        Task("stripe_reconcile", DAY_S, lambda _f: reconcile_stripe_billing(engine, client, prices))
    )


def _storage(engine: Engine, env: Mapping[str, str], plan: Plan) -> None:
    bucket = env.get("SELECTA_R2_BUCKET_DELETION_LEDGER", "").strip()
    if not bucket:
        for name in ("storage_deletions", "account_deletions"):
            plan.disabled[name] = "set SELECTA_R2_BUCKET_DELETION_LEDGER"
        return
    from selecta.storage import api as storage_api
    from selecta.storage.maintenance import drain_physical_deletions
    from selecta.storage.offsite_ledger import drain_deletion_mirror

    def storage(_fence: TermFence) -> object:
        client = storage_api.r2_client()
        try:
            mirror = drain_deletion_mirror(engine, client, bucket)
            if mirror.failed or mirror.pending:
                # Never purge an object whose tombstone isn't safely mirrored offsite.
                raise RuntimeError(f"{mirror.failed} tombstones failed to mirror")
            return drain_physical_deletions(engine, client, buckets=storage_api.buckets())
        finally:
            getattr(client, "close", lambda: None)()

    plan.tasks.append(Task("storage_deletions", 600.0, storage))
    _deletions(engine, env, plan, bucket)


def _deletions(engine: Engine, env: Mapping[str, str], plan: Plan, bucket: str) -> None:
    stripe_key = env.get("SELECTA_STRIPE_SECRET_KEY", "").strip()
    workos_key = env.get("SELECTA_WORKOS_API_KEY", "").strip()
    if not stripe_key or not workos_key:
        plan.disabled["account_deletions"] = (
            "set SELECTA_STRIPE_SECRET_KEY and SELECTA_WORKOS_API_KEY"
        )
        return
    from selecta.billing.stripe_sync import load_price_map
    from selecta.billing.webhooks import HttpStripeClient
    from selecta.identity.deletion import run_once
    from selecta.identity.deletion_effects import AccountDeletionEffects, HttpWorkOSUserDeleter
    from selecta.identity.deletion_ledger import R2DeletionLedgerWriter
    from selecta.storage import api as storage_api

    def deletions(_fence: TermFence, limit: int = 50) -> int:
        client = storage_api.r2_client()
        try:
            effects = AccountDeletionEffects(
                engine,
                JobStore(engine),
                HttpStripeClient(stripe_key, api_version=env.get("SELECTA_STRIPE_API_VERSION")),
                client,
                price_map=load_price_map(),
                ledger_writer=R2DeletionLedgerWriter(client, bucket),
                identity=HttpWorkOSUserDeleter(
                    workos_key,
                    api_base=env.get("SELECTA_WORKOS_API_BASE", "https://api.workos.com"),
                ),
                buckets=storage_api.buckets(),
            )
            steps = 0
            while steps < limit and run_once(engine, "maintenance-service", effects):
                steps += 1
            return steps
        finally:
            getattr(client, "close", lambda: None)()

    plan.tasks.append(Task("account_deletions", 60.0, deletions))


def _rooms(engine: Engine, env: Mapping[str, str], plan: Plan) -> None:
    from selecta.rooms import codes
    from selecta.rooms.wiring import PEPPER_ENV

    pepper = env.get(PEPPER_ENV, "").strip().encode()
    if len(pepper) < codes.MIN_PEPPER_BYTES:
        plan.disabled["rooms"] = f"set {PEPPER_ENV}"
        return
    from selecta.rooms.cloud_ports import CloudPlans, CloudSpeakers, OutboxRoomEvents, RoomPorts
    from selecta.rooms.purge import purge_guest_data
    from selecta.rooms.service import Rooms

    ports = RoomPorts()
    rooms = Rooms(
        engine,
        pepper,
        catalog=ports.catalog,
        planner=ports.planner,
        plans=CloudPlans(engine),
        speakers=CloudSpeakers(engine),
        now_playing=ports.now_playing,
        events=OutboxRoomEvents(),
    )

    def sweep(_fence: TermFence) -> object:
        ended = rooms.expire_rooms()
        purge_guest_data(rooms)
        return len(ended)

    plan.tasks.append(Task("rooms", 60.0, sweep))


def _flag_on(flag_id: str) -> bool:
    from selecta import flags

    try:
        return flags.on(flag_id)
    except KeyError:
        return False


def _export_expiry(engine: Engine, env: Mapping[str, str], plan: Plan) -> None:
    """Exports past their plan's retention; their derived objects go too when R2 is set."""
    from selecta.storage import export_expiry

    needed = ("SELECTA_R2_ACCOUNT_ID", "SELECTA_R2_ACCESS_KEY_ID", "SELECTA_R2_SECRET_ACCESS_KEY")
    has_r2 = all(env.get(name, "").strip() for name in needed)

    def sweep(_fence: TermFence) -> object:
        if not _flag_on(export_expiry.FLAG):
            return 0
        if not has_r2:
            return len(export_expiry.expire_exports(engine))
        from selecta.storage import api as storage_api

        client = storage_api.r2_client()
        try:
            objects = _DerivedObjects(client, storage_api.buckets().derived)
            return len(export_expiry.expire_exports(engine, objects.delete))
        finally:
            getattr(client, "close", lambda: None)()

    plan.tasks.append(Task("export_expiry", 3_600.0, sweep))


def _autoscale(engine: Engine, env: Mapping[str, str], plan: Plan) -> None:
    from selecta.work import autoscale_leader

    task = autoscale_leader.maintenance_task(engine, env)
    if isinstance(task, str):
        plan.disabled["autoscale"] = task
    else:
        plan.tasks.append(task)


def _dmca(engine: Engine, env: Mapping[str, str], plan: Plan) -> None:
    from selecta.admin import dmca

    registered = dmca.configured(env)
    if isinstance(registered, str):
        plan.disabled["dmca_renewal"] = registered
        return

    def check(_fence: TermFence) -> object:
        if not _flag_on(dmca.FLAG):
            return None
        with transaction(engine) as conn:
            return dmca.remind(conn, registered)

    plan.tasks.append(Task("dmca_renewal", DAY_S, check))


def _business_hours(engine: Engine, plan: Plan) -> None:
    """Venue zone clocks (ADR-0444), only while `business.schedules` is on."""
    from selecta.business import zone_clock

    def run(fence: TermFence) -> object:
        if not _flag_on(zone_clock.FLAG):
            return None
        return zone_clock.tick(engine, fence)

    plan.tasks.append(Task(zone_clock.TASK_NAME, zone_clock.EVERY_S, run))


def cloud_plan(engine: Engine, env: Mapping[str, str] | None = None) -> Plan:
    """Every recurring cloud task this environment can run."""
    env = os.environ if env is None else env
    plan = Plan(core_tasks(engine))
    _billing(engine, env, plan)
    _storage(engine, env, plan)
    _rooms(engine, env, plan)
    _eviction(engine, env, plan)
    _export_expiry(engine, env, plan)
    _autoscale(engine, env, plan)
    _dmca(engine, env, plan)
    _business_hours(engine, plan)
    from selecta.observability import leader_metrics

    made, off = leader_metrics.tasks(engine, env)
    plan.tasks += made
    plan.disabled.update(off)
    return plan


class Service:
    """One copy of the maintenance service. `run()` blocks until `stop()` or a signal."""

    def __init__(
        self,
        engine: Engine,
        lock_connection: Connection | None,
        plan: Plan,
        *,
        schedule: Schedule | None = None,
        tick_s: float = 1.0,
        holder: str | None = None,
    ) -> None:
        self.engine = engine
        self.plan = plan
        self.loop = MaintenanceLoop(
            JobStore(engine),
            Leadership(engine, lock_connection=lock_connection, holder=holder),
            schedule,
            tasks=plan.tasks,
            tick_s=tick_s,
        )
        self.stopping = threading.Event()

    def stop(self, *_args: object) -> None:
        self.stopping.set()

    def install_signal_handlers(self) -> None:
        """SIGTERM (what the host sends on deploy) and Ctrl+C stop at the end of the tick."""
        signal.signal(signal.SIGINT, self.stop)
        signal.signal(signal.SIGTERM, self.stop)

    def run(self, ticks: int | None = None) -> None:
        for name, reason in sorted(self.plan.disabled.items()):
            log.warning("Maintenance task %s is off: %s", name, reason)
        log.info("Maintenance service running: %s", ", ".join(t.name for t in self.plan.tasks))
        done = 0
        try:
            while not self.stopping.is_set() and (ticks is None or done < ticks):
                try:
                    self.loop.run_once()
                except Exception:  # noqa: BLE001 - a database blip mustn't end the service
                    log.exception("A maintenance tick failed")
                done += 1
                self.stopping.wait(self.loop.tick_s)
        finally:
            self.loop.leadership.release()
            log.info("Maintenance service stopped")


def database_url(env: Mapping[str, str] | None = None) -> str:
    """The maintenance role's direct URL. Session advisory locks don't survive a
    transaction-mode pooler, so prefer `SELECTA_MAINTENANCE_DATABASE_URL` when one is in front."""
    env = os.environ if env is None else env
    url = (
        env.get("SELECTA_MAINTENANCE_DATABASE_URL") or env.get("SELECTA_DATABASE_URL") or ""
    ).strip()
    if not url.startswith(("postgresql://", "postgresql+psycopg://")):
        raise ValueError(
            "Set SELECTA_DATABASE_URL (or SELECTA_MAINTENANCE_DATABASE_URL) to the "
            "Cloud PostgreSQL database."
        )
    return url


def main(tick_s: float = 1.0) -> None:
    """`selecta maintain`: build everything from the environment and run until stopped."""
    from selecta.observability import errors, metrics

    errors.configure_from_environment("maintenance")
    metrics.configure_from_environment("maintenance")
    engine = make_engine(database_url())
    lock = engine.connect()
    service = Service(engine, lock, cloud_plan(engine), tick_s=tick_s)
    service.install_signal_handlers()
    try:
        service.run()
    finally:
        lock.close()
        engine.dispose()


__all__ = ["Plan", "Service", "cloud_plan", "core_tasks", "database_url", "main"]
