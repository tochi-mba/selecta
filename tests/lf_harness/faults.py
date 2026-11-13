"""Reproducible faults with explicit state and automatic restoration."""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path

from .audio import corrupt_wave
from .fixtures import Device


@contextmanager
def crashed_engine(device: Device) -> Iterator[Device]:
    if device.kind != "engine":
        raise ValueError("controller is not an engine")
    old = device.running
    device.running = False
    try:
        yield device
    finally:
        device.running = old


@contextmanager
def disconnected_drive(device: Device) -> Iterator[Device]:
    old = device.drive_connected
    original = device.source_dir
    unplugged = device.root / "sources.detached"
    if unplugged.exists():
        raise RuntimeError("drive already detached")
    original.rename(unplugged)
    device.drive_connected = False
    try:
        yield device
    finally:
        unplugged.rename(original)
        device.drive_connected = old


@contextmanager
def missing_output(device: Device) -> Iterator[Device]:
    old = device.output_connected
    device.output_connected = False
    try:
        yield device
    finally:
        device.output_connected = old


@contextmanager
def corrupt_media(path: Path) -> Iterator[Path]:
    original = corrupt_wave(path)
    try:
        yield path
    finally:
        path.write_bytes(original)


@dataclass
class DiskBudget:
    capacity_bytes: int
    used_bytes: int = 0

    def write(self, byte_count: int) -> None:
        if byte_count < 0 or self.used_bytes + byte_count > self.capacity_bytes:
            raise OSError(28, "deterministic ENOSPC: local disk full")
        self.used_bytes += byte_count

    def reclaim(self, byte_count: int) -> None:
        if byte_count < 0 or byte_count > self.used_bytes:
            raise ValueError("invalid reclaim amount")
        self.used_bytes -= byte_count


@dataclass
class ResourcePressure:
    cpu_percent: float = 0
    ram_percent: float = 0
    gpu_percent: float = 0
    thermal_throttled: bool = False

    def can_admit(self, *, priority: str, max_utilization_percent: float = 85) -> bool:
        # A harness-defined policy, not production scheduler behaviour.
        if priority not in {"playback", "imminent_transition", "analysis", "stem", "export"}:
            raise ValueError("unknown resource priority")
        if self.thermal_throttled or self.ram_percent > max_utilization_percent:
            return priority == "playback"
        if self.cpu_percent > max_utilization_percent or self.gpu_percent > max_utilization_percent:
            return priority in {"playback", "imminent_transition"}
        return True


def heartbeat_stale(device: Device, now_ms: int, *, maximum_age_ms: int = 60_000) -> bool:
    return now_ms - device.heartbeat_ms > maximum_age_ms or now_ms < device.heartbeat_ms


def power_cycle(device: Device) -> None:
    """Model engine reset, never claim audio resumed without external observation."""
    if device.kind != "engine":
        raise ValueError("only an engine can be power-cycled")
    device.running = False
    device.power_restored = True
    device.running = True
    device.generation += 1
