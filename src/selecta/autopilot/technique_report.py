"""What was asked for, what actually played, and how it measured (ADR-0427, AV-0427-03 and
AV-0427-05).

`measure_audio(samples, rate)` reads rendered or captured audio and reports:

- sample peak and true peak in dBFS (true peak read at four times the rate with soxr, the same
  way `render.dsp.true_peaks` does), with clipping counted as samples at or above full scale
  and flagged when the true peak passes `audit.checks.TRUE_PEAK_LIMIT_DB`;
- gaps: every stretch of at least `GAP_SECONDS` whose 10 ms windows all sit under
  `GAP_FLOOR_DB`, as (start, end) seconds. A gap is what a room hears as the music stopping.

`TechniqueReport` keeps one `TransitionRecord` per transition: the requested technique, what the
ladder chose, what the player says was audible, why they differ, and the measurement. The
audible technique is whatever the playback side reports; this module never guesses it, and a
record with no report yet says `audible: null` rather than assuming the plan played.
"""

from __future__ import annotations

import threading
from collections.abc import Mapping
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from typing import Any

import numpy as np
import soxr

from selecta.audit.checks import TRUE_PEAK_LIMIT_DB
from selecta.autopilot.fallback import Decision

GAP_FLOOR_DB = -60.0
GAP_SECONDS = 0.25
WINDOW_SECONDS = 0.01
FULL_SCALE = 0.999


@dataclass(frozen=True)
class AudioMeasure:
    seconds: float
    peak_dbfs: float
    true_peak_dbfs: float
    clipped_samples: int
    clips: bool
    gaps: tuple[tuple[float, float], ...]

    @property
    def clean(self) -> bool:
        return not self.clips and not self.gaps

    def to_dict(self) -> dict[str, Any]:
        out = asdict(self)
        out["gaps"] = [list(g) for g in self.gaps]
        out["clean"] = self.clean
        return out


def _db(value: float) -> float:
    return 20.0 * float(np.log10(max(value, 1e-9)))


def _frames(samples: np.ndarray) -> np.ndarray:
    audio = np.asarray(samples, dtype=np.float32)
    if audio.ndim == 1:
        audio = audio[:, None]
    return audio


def find_gaps(
    samples: np.ndarray,
    rate: int,
    floor_db: float = GAP_FLOOR_DB,
    min_seconds: float = GAP_SECONDS,
) -> list[tuple[float, float]]:
    audio = _frames(samples)
    hop = max(1, int(rate * WINDOW_SECONDS))
    count = audio.shape[0] // hop
    if count == 0:
        return []
    windows = audio[: count * hop].reshape(count, hop, audio.shape[1])
    rms = np.sqrt(np.mean(windows.astype(np.float64) ** 2, axis=(1, 2)))
    quiet = 20.0 * np.log10(np.maximum(rms, 1e-12)) < floor_db
    gaps: list[tuple[float, float]] = []
    start = None
    for index, is_quiet in enumerate([*quiet.tolist(), False]):
        if is_quiet and start is None:
            start = index
        elif not is_quiet and start is not None:
            if (index - start) * hop / rate >= min_seconds:
                gaps.append((round(start * hop / rate, 3), round(index * hop / rate, 3)))
            start = None
    return gaps


def measure_audio(samples: np.ndarray, rate: int) -> AudioMeasure:
    audio = _frames(samples)
    if audio.shape[0] == 0:
        return AudioMeasure(0.0, -180.0, -180.0, 0, False, ((0.0, 0.0),))
    peak = float(np.max(np.abs(audio)))
    fine = soxr.resample(audio, rate, rate * 4, quality="HQ")
    true_peak = max(peak, float(np.max(np.abs(fine))) if fine.size else 0.0)
    clipped = int(np.count_nonzero(np.abs(audio) >= FULL_SCALE))
    true_peak_db = _db(true_peak)
    return AudioMeasure(
        seconds=round(audio.shape[0] / rate, 3),
        peak_dbfs=round(_db(peak), 3),
        true_peak_dbfs=round(true_peak_db, 3),
        clipped_samples=clipped,
        clips=clipped > 0 or true_peak_db > TRUE_PEAK_LIMIT_DB,
        gaps=tuple(find_gaps(audio, rate)),
    )


@dataclass
class TransitionRecord:
    id: str
    from_track: str
    to_track: str | None
    requested: str
    chosen: str
    chosen_reason: list[str]
    audible: str | None = None
    audible_reason: str | None = None
    overrode_manual: bool = False
    measure: AudioMeasure | None = None
    at: datetime = field(default_factory=lambda: datetime.now(UTC))

    @property
    def matches(self) -> bool | None:
        return None if self.audible is None else self.audible == self.requested

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "from_track": self.from_track,
            "to_track": self.to_track,
            "requested": self.requested,
            "chosen": self.chosen,
            "chosen_reason": self.chosen_reason,
            "audible": self.audible,
            "audible_reason": self.audible_reason,
            "matches": self.matches,
            "overrode_manual": self.overrode_manual,
            "measure": self.measure.to_dict() if self.measure else None,
            "at": self.at.isoformat(),
        }


class TechniqueReport:
    """Every transition of a night, per workspace and session. In memory; thread-safe."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._records: dict[tuple[str, str], list[TransitionRecord]] = {}

    def planned(self, workspace: str, session_id: str, from_track: str,
                decision: Decision) -> TransitionRecord:
        reasons = [
            f"{step.technique}: {', '.join(step.failed)}" for step in decision.steps if step.failed
        ]
        with self._lock:
            records = self._records.setdefault((workspace, session_id), [])
            record = TransitionRecord(
                id=f"x{len(records) + 1}",
                from_track=from_track,
                to_track=decision.target,
                requested=decision.planned,
                chosen=decision.technique,
                chosen_reason=reasons,
                overrode_manual=decision.overrode_manual,
            )
            records.append(record)
            return record

    def played(
        self,
        workspace: str,
        session_id: str,
        record_id: str,
        audible: str,
        reason: str | None = None,
        measure: AudioMeasure | None = None,
    ) -> TransitionRecord:
        with self._lock:
            for record in self._records.get((workspace, session_id), ()):
                if record.id == record_id:
                    record.audible = audible
                    if audible != record.chosen and not reason:
                        reason = f"the player reported {audible}, not the planned {record.chosen}"
                    elif audible != record.requested and not reason:
                        reason = "; ".join(record.chosen_reason) or "fell back"
                    record.audible_reason = reason
                    record.measure = measure
                    return record
        raise KeyError(record_id)

    def records(self, workspace: str, session_id: str) -> list[TransitionRecord]:
        with self._lock:
            return list(self._records.get((workspace, session_id), ()))

    def summary(self, workspace: str, session_id: str) -> Mapping[str, Any]:
        records = self.records(workspace, session_id)
        heard = [r for r in records if r.audible is not None]
        return {
            "transitions": len(records),
            "reported": len(heard),
            "as_requested": sum(1 for r in heard if r.matches),
            "fell_back": sum(1 for r in heard if not r.matches),
            "clipped": sum(1 for r in heard if r.measure and r.measure.clips),
            "with_gaps": sum(1 for r in heard if r.measure and r.measure.gaps),
            "records": [r.to_dict() for r in records],
        }


__all__ = [
    "AudioMeasure",
    "TechniqueReport",
    "TransitionRecord",
    "find_gaps",
    "measure_audio",
]
