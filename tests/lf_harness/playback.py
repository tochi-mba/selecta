"""Speaker overlap oracle and *simulated* takeover failure scripts.

A pure simulation must never be reported as measured hardware audio evidence.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

EvidenceKind = Literal["simulation", "process", "measured_physical_output"]


@dataclass(frozen=True)
class PlaybackObservation:
    device_id: str
    zone_id: str
    physical_output_id: str
    start_ms: int
    end_ms: int
    generation: int
    kind: EvidenceKind = "simulation"
    measurement_reference: str | None = None

    def __post_init__(self) -> None:
        if self.end_ms <= self.start_ms or self.generation < 0:
            raise ValueError("invalid playback interval")
        if self.kind == "measured_physical_output" and not self.measurement_reference:
            raise ValueError("measured output requires real evidence reference")
        if self.kind != "measured_physical_output" and self.measurement_reference:
            raise ValueError("simulation/process cannot carry a physical audio proof reference")


@dataclass
class OutputSafetyMonitor:
    observations: list[PlaybackObservation] = field(default_factory=list)

    def add(self, observation: PlaybackObservation) -> None:
        self.observations.append(observation)

    def assert_no_double_audio(self, *, scope: Literal["speaker", "zone", "both"] = "both") -> None:
        """Check actual *observed intervals*, not booleans or cloud ACKs.

        Cross-device same-zone overlap and exclusive physical output overlap are unsafe.
        Adjacent intervals are safe. Same-device repeat reports of the same interval are
        still flagged; callers should deduplicate measured samples before asserting.
        """
        if scope not in {"speaker", "zone", "both"}:
            raise ValueError("invalid scope")
        for i, a in enumerate(self.observations):
            for b in self.observations[i + 1 :]:
                if a.start_ms >= b.end_ms or b.start_ms >= a.end_ms:
                    continue
                same_output = a.physical_output_id == b.physical_output_id
                same_zone = a.zone_id == b.zone_id
                if (scope in ("speaker", "both") and same_output) or (
                    scope in ("zone", "both") and same_zone and a.device_id != b.device_id
                ):
                    raise AssertionError(
                        f"unsafe overlap: {a.device_id}/{a.zone_id} and "
                        f"{b.device_id}/{b.zone_id} [{max(a.start_ms, b.start_ms)}, "
                        f"{min(a.end_ms, b.end_ms)})"
                    )

    def assert_physically_verified(self, *, required_outputs: set[str]) -> None:
        for output in required_outputs:
            measured = [
                o
                for o in self.observations
                if o.physical_output_id == output and o.kind == "measured_physical_output"
            ]
            if not measured:
                raise AssertionError(f"UNVERIFIED_PHYSICAL_OUTPUT: {output}")
        self.assert_no_double_audio()


@dataclass(frozen=True)
class TakeoverDecision:
    accepted: bool
    reason: str
    new_generation: int
    simulated: bool = True


@dataclass
class TakeoverScenario:
    """Reference safety *oracle*, never a substitute for integration test adapter."""

    active_device: str
    generation: int = 7
    partitioned_devices: set[str] = field(default_factory=set)
    prepared_devices: set[str] = field(default_factory=set)
    stopped_devices: set[str] = field(default_factory=set)
    attempted_ids: dict[str, TakeoverDecision] = field(default_factory=dict)

    def prepare(self, target: str, *, media_ready: bool, output_ready: bool) -> bool:
        if media_ready and output_ready:
            self.prepared_devices.add(target)
            return True
        return False

    def attempt(
        self, *, operation_id: str, target: str, expected_generation: int, released_old: bool
    ) -> TakeoverDecision:
        if operation_id in self.attempted_ids:
            return self.attempted_ids[operation_id]
        if expected_generation != self.generation:
            result = TakeoverDecision(False, "stale_generation", self.generation)
        elif target not in self.prepared_devices:
            result = TakeoverDecision(False, "preflight_required", self.generation)
        elif self.active_device in self.partitioned_devices:
            result = TakeoverDecision(False, "unsafe_old_speaker_partition", self.generation)
        elif not released_old:
            result = TakeoverDecision(False, "old_speaker_not_confirmed_released", self.generation)
        else:
            self.stopped_devices.add(self.active_device)
            self.active_device = target
            self.generation += 1
            result = TakeoverDecision(True, "applied_simulation_only", self.generation)
        self.attempted_ids[operation_id] = result
        return result
