"""The Desktop side of gate calibration: rated seams read from a SelectaDJ home, and the small
file that applies a fit (docs/engineering/calibration.md).

`rated_seams` only reads. It never opens the database (a read-only SQLite open can still leave
files behind on a live library) and never looks in other folders, so it sees exactly one home.
The fitting itself is `planner_core.calibrate`, which takes plain records and reads nothing.
`calibration.json` is written only by `selecta calibrate --apply --yes` and removed by `--reset`;
the planner core never reads it. `desktop_gates` loads it for the Desktop's seam planning, and
only with `planner.calibrated_gates` on. Cloud planning passes no gates, so it keeps today's.
"""

from __future__ import annotations

import datetime as dt
import json
import os
import tempfile
from dataclasses import dataclass, field
from pathlib import Path

from selecta import flags
from selecta.planner_core.calibrate import GateFit, evidence, overrides_from
from selecta.planner_core.fit import Gates

CALIBRATION_FILE = "calibration.json"
CALIBRATION_VERSION = 1


@dataclass
class Collected:
    records: list[dict] = field(default_factory=list)
    """Rated seams as plain data, one per seam key."""
    files: int = 0
    unreadable: int = 0
    unrated: int = 0
    without_facts: int = 0
    """Rated seams from before records kept the pair's facts: counted, never fitted on."""

    def span(self) -> tuple[str, str] | None:
        stamps = sorted(r["rated_at"] for r in self.records if r.get("rated_at"))
        if not stamps:
            return None
        def day(stamp: float) -> str:
            return dt.datetime.fromtimestamp(stamp, dt.UTC).strftime("%Y-%m-%d")

        return day(stamps[0]), day(stamps[-1])


def _read(path: Path) -> dict | None:
    try:
        state = json.loads(path.read_text("utf-8"))
    except (OSError, ValueError):
        return None
    return state if isinstance(state, dict) else None


def rated_seams(home: Path) -> Collected:
    """Every rated seam in `home`: the render cache's records and the history that outlives
    them, one per seam key, the cache's copy first. Reads only."""
    found = Collected()
    seen: dict[str, dict] = {}
    paths = [
        *sorted((home / "renders" / "seams").glob("*/seam.json")),
        *sorted((home / "seam-history").glob("*.json")),
    ]
    for path in paths:
        found.files += 1
        state = _read(path)
        if state is None:
            found.unreadable += 1
            continue
        seen.setdefault(str(state.get("key") or path), state)
    for state in seen.values():
        rating = state.get("rating")
        if rating not in ("good", "bad"):
            found.unrated += 1
            continue
        pair = state.get("pair")
        if not isinstance(pair, dict):
            found.without_facts += 1
            pair = {}
        rated_at = state.get("rated_at")
        found.records.append(
            {
                "key": state.get("key"),
                "move": state.get("style"),
                "bars": state.get("bars") or 0,
                "fell_back": bool(state.get("fell_back")),
                "verdict": rating,
                "rated_at": rated_at if isinstance(rated_at, (int, float)) else None,
                "pair": pair,
            }
        )
    return found


def calibration_path(home: Path) -> Path:
    return home / CALIBRATION_FILE


def load_overrides(home: Path) -> dict[str, float] | None:
    """The applied gates in `home`'s calibration file, or None without a usable one."""
    state = _read(calibration_path(home))
    if state is None or state.get("version") != CALIBRATION_VERSION:
        return None
    gates = state.get("gates")
    if not isinstance(gates, dict):
        return None
    found = {}
    for name, change in gates.items():
        if isinstance(change, dict) and isinstance(change.get("new"), (int, float)):
            found[name] = change["new"]
    return found or None


def write_calibration(home: Path, fits: list[GateFit], collected: Collected) -> dict:
    """Write the gates the fits move, with the date, the counts behind each and the old value.
    Written whole and swapped in, so a half-written file never reaches the planner."""
    moved = overrides_from(fits)
    by_name = {fit.name: fit for fit in fits}
    state = {
        "version": CALIBRATION_VERSION,
        "applied_at": dt.datetime.now(dt.UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "rated_seams": len(collected.records),
        "rated_between": list(collected.span() or ()),
        "gates": {
            name: {"old": by_name[name].current, "new": new, "evidence": evidence(by_name[name])}
            for name, new in moved.items()
        },
    }
    target = calibration_path(home)
    with tempfile.NamedTemporaryFile(
        "w", encoding="utf-8", dir=home, suffix=".tmp", delete=False
    ) as stream:
        json.dump(state, stream, indent=1)
        temporary = Path(stream.name)
    try:
        os.replace(temporary, target)
    finally:
        temporary.unlink(missing_ok=True)
    return state


def reset(home: Path) -> bool:
    """Remove the calibration file; True if there was one."""
    path = calibration_path(home)
    if not path.exists():
        return False
    path.unlink()
    return True


_LOADED: dict[Path, tuple[tuple[int, int], dict[str, float] | None]] = {}


def desktop_gates(home: Path | None = None) -> Gates | None:
    """The gates the Desktop's seam planning passes to the planner core: None (today's) with
    `planner.calibrated_gates` off, which reads no file at all, or without a calibration."""
    if not flags.on("planner.calibrated_gates"):
        return None
    from selecta.config import default_home

    path = calibration_path(home or default_home())
    try:
        facts = path.stat()
    except OSError:
        return None
    stamp = (facts.st_mtime_ns, facts.st_size)
    known = _LOADED.get(path)
    if known is None or known[0] != stamp:
        known = (stamp, load_overrides(path.parent))
        _LOADED[path] = known
    return Gates.with_overrides(known[1]) if known[1] else None
