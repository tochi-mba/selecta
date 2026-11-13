"""Cross-process, device-only resource governor for existing durable DSP workers.

The durable JobStore remains authoritative for job identity, dependencies, retry,
checkpoints, cancellation and publication fencing. This sidecar coordinates bounded
CPU/GPU/memory/scratch budgets ACROSS the analysis, seam and export processes,
without querying hosted storage, plans or daily paid compute quotas.
"""
from __future__ import annotations

import logging
import os
import shutil
import sqlite3
import threading
import time
import uuid
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass, field
from pathlib import Path

import psutil

from .contract import JobPriority, ZoneDemand, priority_for_legacy

log = logging.getLogger(__name__)
LEASE_SECONDS = 30.0
RENEW_SECONDS = 5.0
DEADLINE_GUARD_SECONDS = 2.0


class ReservationAlreadyHeld(RuntimeError):
    """The exact attempt already has a live resource permit in another worker."""


@dataclass(frozen=True)
class DeviceResources:
    cpu_percent: float
    memory_available_mb: int
    disk_free_mb: int
    logical_cores: int
    gpu_free_mb: int | None = None
    thermal_warning: bool = False
    on_low_battery: bool = False


def measure_device(home: Path) -> DeviceResources:
    """Use real OS measurements. Unknown GPU capacity is never treated as infinite."""
    home.mkdir(parents=True, exist_ok=True)
    memory = psutil.virtual_memory()
    try:
        battery = psutil.sensors_battery()
    except (AttributeError, OSError, RuntimeError):
        battery = None
    thermal = False
    try:
        temperatures = psutil.sensors_temperatures()
        thermal = any(
            entry.critical is not None and entry.current >= entry.critical
            for group in temperatures.values() for entry in group
        )
    except (AttributeError, OSError, RuntimeError):
        pass
    gpu_free = None
    # Optional local NVML; do not load a model or spawn a GPU query on the audio thread.
    try:
        import pynvml  # type: ignore[import-not-found]

        pynvml.nvmlInit()
        try:
            count = pynvml.nvmlDeviceGetCount()
            if count:
                gpu_free = min(
                    pynvml.nvmlDeviceGetMemoryInfo(
                        pynvml.nvmlDeviceGetHandleByIndex(index)
                    ).free // (1024 * 1024)
                    for index in range(count)
                )
        finally:
            pynvml.nvmlShutdown()
    except Exception:  # noqa: BLE001 - optional GPU telemetry must fail safely
        pass
    return DeviceResources(
        cpu_percent=psutil.cpu_percent(interval=None),
        memory_available_mb=memory.available // (1024 * 1024),
        disk_free_mb=shutil.disk_usage(home).free // (1024 * 1024),
        logical_cores=max(1, os.cpu_count() or 1),
        gpu_free_mb=gpu_free,
        thermal_warning=thermal,
        on_low_battery=bool(battery and not battery.power_plugged and battery.percent < 20),
    )


@dataclass
class Reservation:
    """Attempt-scoped capacity reservation. Losing it makes the handler give way."""

    governor: LocalResourceGovernor
    attempt_id: str
    token: str
    priority: JobPriority
    _stop: threading.Event = field(default_factory=threading.Event, repr=False)
    _lost: threading.Event = field(default_factory=threading.Event, repr=False)
    _thread: threading.Thread | None = field(default=None, repr=False)

    def start(self) -> Reservation:
        self._thread = threading.Thread(
            target=self._heartbeat, name=f"lf-resource-{self.attempt_id[:8]}", daemon=True
        )
        self._thread.start()
        return self

    def _heartbeat(self) -> None:
        while not self._stop.wait(self.governor.renew_s):
            try:
                if not self.governor._renew(self):
                    self._lost.set()
                    return
            except sqlite3.Error:
                # A transient lock must not silently extend ownership beyond its expiry.
                log.warning("Resource reservation heartbeat failed", exc_info=True)
                self._lost.set()
                return

    def should_yield(self) -> bool:
        return self._lost.is_set() or self.governor.should_yield(self)

    def close(self) -> None:
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=1.0)
        self.governor.release(self)


class LocalResourceGovernor:
    """SQLite BEGIN IMMEDIATE makes admission atomic across independent worker processes.

    No hosted media capability, remote egress or plan lookups are reachable here.
    Active zones remain protected until the playback owner *explicitly* clears them;
    a disconnected controller must not make a physical output look idle.
    """

    def __init__(
        self,
        home: Path,
        *,
        sampler: Callable[[Path], DeviceResources] = measure_device,
        max_heavy_workers: int = 2,
        lease_s: float = LEASE_SECONDS,
        renew_s: float = RENEW_SECONDS,
        clock: Callable[[], float] = time.time,
    ) -> None:
        if max_heavy_workers < 1 or lease_s <= 0 or not 0 < renew_s < lease_s:
            raise ValueError("Invalid resource governor worker or lease limits.")
        self.home = Path(home)
        self.home.mkdir(parents=True, exist_ok=True)
        self.path = self.home / "lf-resources.sqlite"
        self.sampler = sampler
        self.max_heavy_workers = max_heavy_workers
        self.lease_s = lease_s
        self.renew_s = renew_s
        self.clock = clock
        with self._db() as conn:
            conn.execute(
                "CREATE TABLE IF NOT EXISTS permits ("
                "attempt_id TEXT PRIMARY KEY, token TEXT NOT NULL, priority INTEGER NOT NULL,"
                "memory_mb INTEGER NOT NULL, scratch_mb INTEGER NOT NULL,"
                "gpu_mb INTEGER NOT NULL, zone_id TEXT, expires_at REAL NOT NULL)"
            )
            conn.execute(
                "CREATE TABLE IF NOT EXISTS zones ("
                "zone_id TEXT PRIMARY KEY, active INTEGER NOT NULL,"
                "deadline_at REAL, changed_at REAL NOT NULL)"
            )

    @contextmanager
    def _db(self) -> Iterator[sqlite3.Connection]:
        # sqlite3.Connection.__exit__ commits but does not close the connection.
        # Explicit close releases Windows filesystem handles promptly.
        connection = sqlite3.connect(str(self.path), timeout=5.0)
        try:
            with connection:
                yield connection
        finally:
            connection.close()

    def observe_zone(self, demand: ZoneDemand) -> None:
        """Agent 09 calls this on output start/stop/deadline updates."""
        if not demand.zone_id:
            raise ValueError("A zone needs an ID.")
        with self._db() as conn:
            conn.execute(
                "INSERT INTO zones (zone_id,active,deadline_at,changed_at)"
                " VALUES (?,?,?,?) ON CONFLICT(zone_id) DO UPDATE SET"
                " active=excluded.active,deadline_at=excluded.deadline_at,"
                " changed_at=excluded.changed_at",
                (demand.zone_id, int(demand.active), demand.deadline_at, self.clock()),
            )

    def _zones(self, conn: sqlite3.Connection) -> tuple[int, bool]:
        rows = conn.execute(
            "SELECT deadline_at FROM zones WHERE active=1"
        ).fetchall()
        now = self.clock()
        imminent = any(
            deadline is None or deadline - now <= DEADLINE_GUARD_SECONDS
            for (deadline,) in rows
        )
        return len(rows), imminent

    @staticmethod
    def _needs(job) -> tuple[JobPriority, int, int, int, str | None]:
        priority = priority_for_legacy(
            str(job.type),
            int(getattr(job, "base_urgency", 4) or 0),
            str(getattr(job, "lane", "")),
        )
        defaults = {"analyse.song": 1024, "seam.render": 768, "export.render": 512}
        memory = max(0, int(getattr(job, "memory_mb", 0) or defaults.get(str(job.type), 64)))
        scratch = max(0, int(getattr(job, "scratch_mb", 0) or 0))
        gpu = max(0, int(getattr(job, "gpu_memory_mb", 0) or 0))
        zone = getattr(job, "zone_id", None)
        return priority, memory, scratch, gpu, zone

    def _safe(
        self,
        conn: sqlite3.Connection,
        priority: JobPriority,
        memory: int,
        scratch: int,
        gpu: int,
        resources: DeviceResources,
        *,
        excluding: str = "",
    ) -> bool:
        zones, imminent = self._zones(conn)
        if priority == JobPriority.ACTIVE_PLAYBACK:
            return True  # real-time executor must never queue behind offline DSP
        rows = conn.execute(
            "SELECT priority,memory_mb,scratch_mb,gpu_mb FROM permits"
            " WHERE expires_at > ? AND attempt_id != ?",
            (self.clock(), excluding),
        ).fetchall()
        current_memory = sum(int(row[1]) for row in rows)
        current_scratch = sum(int(row[2]) for row in rows)
        current_gpu = sum(int(row[3]) for row in rows)
        # Preserve one core when an output is active; an otherwise-idle
        # single-core device may still analyse its library.
        if zones:
            # Imminent transitions may use the spare output-adjacent core;
            # background jobs must leave another core for the OS.
            reserve_for_os = 0 if priority <= JobPriority.IMMINENT_TRANSITION else 1
            spare = max(0, resources.logical_cores - zones - reserve_for_os)
        else:
            spare = max(1, resources.logical_cores - 1)
        capacity = min(self.max_heavy_workers, spare)
        if len(rows) >= capacity:
            return False
        if resources.disk_free_mb < scratch + current_scratch + 256:
            return False
        if resources.memory_available_mb < memory + current_memory + 256:
            return False
        if gpu and (
            resources.gpu_free_mb is None or resources.gpu_free_mb < gpu + current_gpu
        ):
            return False
        if resources.thermal_warning or resources.on_low_battery:
            return priority <= JobPriority.IMMINENT_TRANSITION
        if imminent and priority > JobPriority.IMMINENT_TRANSITION:
            return False
        if resources.cpu_percent >= 90 and priority > JobPriority.IMMINENT_TRANSITION:
            return False
        if resources.cpu_percent >= 75 and priority >= JobPriority.ANALYSIS:
            return False
        return True

    def reserve(self, job, attempt_id: str) -> Reservation | None:
        """Return None for backpressure. Caller RELEASES the durable claim, not fails it."""
        priority, memory, scratch, gpu, zone = self._needs(job)
        token = uuid.uuid4().hex
        resources = self.sampler(self.home)
        now = self.clock()
        with self._db() as conn:
            conn.execute("BEGIN IMMEDIATE")
            conn.execute("DELETE FROM permits WHERE expires_at <= ?", (now,))
            existing = conn.execute(
                "SELECT token,priority FROM permits WHERE attempt_id=?", (attempt_id,)
            ).fetchone()
            if existing:
                # Duplicate delivery of the *same* attempt must not execute twice.
                # It may be retried once this holder expires after a process crash.
                raise ReservationAlreadyHeld(attempt_id)
            if not self._safe(conn, priority, memory, scratch, gpu, resources):
                return None
            conn.execute(
                "INSERT INTO permits VALUES (?,?,?,?,?,?,?,?)",
                (
                    attempt_id, token, int(priority), memory, scratch, gpu, zone,
                    now + self.lease_s,
                ),
            )
        return Reservation(self, attempt_id, token, priority).start()

    def _renew(self, permit: Reservation) -> bool:
        with self._db() as conn:
            updated = conn.execute(
                "UPDATE permits SET expires_at=? WHERE attempt_id=? AND token=?"
                " AND expires_at > ?",
                (self.clock() + self.lease_s, permit.attempt_id,
                 permit.token, self.clock()),
            )
            return updated.rowcount == 1

    def release(self, permit: Reservation) -> None:
        with self._db() as conn:
            conn.execute(
                "DELETE FROM permits WHERE attempt_id=? AND token=?",
                (permit.attempt_id, permit.token),
            )

    def should_yield(self, permit: Reservation) -> bool:
        """Cooperative stop when an output needs headroom or a resource is exhausted."""
        if permit.priority <= JobPriority.IMMINENT_TRANSITION:
            return False
        resources = self.sampler(self.home)
        with self._db() as conn:
            owns = conn.execute(
                "SELECT 1 FROM permits WHERE attempt_id=? AND token=? AND expires_at > ?",
                (permit.attempt_id, permit.token, self.clock()),
            ).fetchone()
            if not owns:
                return True
            zones, imminent = self._zones(conn)
        if imminent:
            return True
        if resources.thermal_warning or resources.on_low_battery:
            return True
        if resources.cpu_percent >= 95 or resources.memory_available_mb < 256:
            return True
        if resources.disk_free_mb < 256:
            return True
        return zones >= resources.logical_cores
