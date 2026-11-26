"""The Desktop side of gate calibration: rated seams read from a SelectaDJ home, and the small
file that applies a fit (docs/engineering/calibration.md).

`rated_seams` only reads, and never looks in other folders, so it sees exactly one home. With
`core.engine_store` off it never opens the database (a read-only SQLite open can still leave
files behind on a live library); on, it reads the library's seam tables, as the app does.
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

import sqlalchemy as sa

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
    grades: list[dict] = field(default_factory=list)
    """Listening-study grades (1 to 5) given to a rendered seam, each with its seam key
    (`engine_store.listening.seam_grades`). Counted beside the clicks; the gates fit on clicks."""

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


def _from_store(home: Path) -> list[dict] | None:
    """With `core.engine_store` on, every seam's record from the library's seam tables (the
    import copied the files in; docs/engineering/engine-store-seams.md); else None, and the files
    are read as before. A library without the tables also reads the files."""
    library_file = home / "selecta.sqlite"
    if not flags.on("core.engine_store") or not library_file.is_file():
        return None
    from selecta.engine_store import library
    from selecta.engine_store import seams as stored

    try:
        with library.engine_for(library_file).connect() as connection:
            if library.VERSION_TABLE not in sa.inspect(connection).get_table_names():
                return None
        return stored.records(library.store_for(library_file))
    except sa.exc.SQLAlchemyError:
        return None


def _grades_from_store(home: Path) -> list[dict]:
    """The study's grades joined to seams, read only with `core.engine_store` on and only from a
    library past `lib0010listening`; otherwise none."""
    from selecta.engine_store import library
    from selecta.engine_store import listening as study

    library_file = home / "selecta.sqlite"
    try:
        with library.engine_for(library_file).connect() as connection:
            stamp = connection.execute(
                sa.text(f"SELECT version_num FROM {library.VERSION_TABLE}")  # noqa: S608
            ).scalar()
        if stamp is None or not library.includes(stamp, "lib0010listening"):
            return []
        return study.seam_grades(library.store_for(library_file))
    except sa.exc.SQLAlchemyError:
        return []


def rated_seams(home: Path) -> Collected:
    """Every rated seam in `home`: the render cache's records and the history that outlives
    them, one per seam key, the cache's copy first. Reads only."""
    found = Collected()
    seen: dict[str, dict] = {}
    stored = _from_store(home)
    paths = [] if stored is not None else [
        *sorted((home / "renders" / "seams").glob("*/seam.json")),
        *sorted((home / "seam-history").glob("*.json")),
    ]
    for state in stored or []:
        found.files += 1
        seen.setdefault(str(state.get("key")), state)
    if stored is not None:
        found.grades = _grades_from_store(home)
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
