"""Every Good and Bad a listener has clicked, wherever it was saved, and what they have in common.

Older versions kept data in a folder that desktop apps redirect, so one person's clicks could end up
in several places. This reads the current folder and any older ones, so nothing is missed when it's
time to learn from them.
"""

from __future__ import annotations

import json
import sqlite3
from collections import defaultdict
from collections.abc import Iterable, Mapping
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

from selecta.analysis.key import camelot_distance
from selecta.homes import DATABASE, old_homes

OVERLAPPING = {
    "bass_swap_blend",
    "filter_sweep",
    "tempo_ramp",
    "loop_room",
    "tempo_bridge",
    "vocal_ride",
    "word_blend",
    "word_exchange",
    "stem_intertwine",
}


@dataclass(frozen=True)
class Rated:
    a: str
    b: str
    move: str
    asked: str
    good: bool
    gap: float | None  # None when either song has no measured tempo
    keys: int | None  # None when either song has no detected key
    bars: int
    seconds: float
    passed: bool
    grid: float
    note: str
    home: str
    folded_gap: float | None = None  # the gap after half and double time, where recorded
    energy_step: float | None = None  # B's landing energy minus A's exit energy
    entry_section: str | None = None  # what B's landing was: chorus, verse, instrumental...


def known_homes(current: Path) -> list[Path]:
    """The folder in use, and any older one that might still hold clicks not brought in yet."""
    homes = [current] if (current / DATABASE).is_file() else []
    return [*homes, *old_homes(current)]


# r8d: every seam record read before, by the file's modified time and size. The page reads them
# all each time it opens, and almost none change between visits, so only new or changed ones are
# parsed again. Bounded by how many records there are on this PC.
_RECORDS: dict[Path, tuple[tuple[int, int], dict]] = {}


def _record(meta: Path) -> dict | None:
    try:
        facts = meta.stat()
        stamp = (facts.st_mtime_ns, facts.st_size)
        known = _RECORDS.get(meta)
        if known is not None and known[0] == stamp:
            return known[1]
        state = json.loads(meta.read_text("utf-8"))
    except (OSError, ValueError):
        _RECORDS.pop(meta, None)
        return None
    if not isinstance(state, dict):
        return None
    _RECORDS[meta] = (stamp, state)
    return state


def read_rated(home: Path) -> list[Rated]:
    """The rated seams in one data folder, including ones the render cache has since cleared."""
    from selecta.engine_store import library_rows

    conn = sqlite3.connect(f"file:{home / 'selecta.sqlite'}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    with library_rows.reading(conn) as source:
        songs = {
            row["id"]: row
            for row in source.execute(
                # a person's own tempo and key corrections are the truth about a song, so they
                # count here too; reading the raw analysis used to report the wrong gap
                "SELECT s.id, s.artist, s.title, COALESCE(o.bpm, a.bpm) AS bpm, "
                "COALESCE(o.camelot, a.camelot) AS camelot, a.grid_confidence "
                "FROM songs s JOIN analysis a ON a.song_id=s.id "
                "LEFT JOIN song_overrides o ON o.song_id=s.id"
            )
        }
    conn.close()
    states: dict[str, dict] = {}
    for meta in [
        *(home / "renders" / "seams").glob("*/seam.json"),
        *(home / "seam-history").glob("*.json"),
    ]:
        state = _record(meta)
        if state is not None:
            states.setdefault(state.get("key", str(meta)), state)
    return rated_from(states.values(), songs, str(home))


def rated_from(states: Iterable[dict], songs: Mapping[int, Any], home: str) -> list[Rated]:
    """The rated seams among these records. `songs` maps a song id to its `artist`, `title`,
    `bpm`, `camelot` and `grid_confidence` (a listener's corrections already applied). Cloud
    passes its workspace's seam records and catalogue songs (`cloud_brain.seams_routes`)."""
    found = []
    for state in states:
        if state.get("rating") not in {"good", "bad"}:
            continue
        request = state.get("request") or {}
        a, b = songs.get(request.get("a")), songs.get(request.get("b"))
        if a is None or b is None:
            continue
        # measurements stored with the seam beat a fresh database join: they say what was true
        # when the listener heard it, and they survive later corrections and re-analysis
        pair = state.get("pair") or {}
        found.append(
            Rated(
                a=f"{a['artist'] or '?'} - {a['title'] or '?'}",
                b=f"{b['artist'] or '?'} - {b['title'] or '?'}",
                move=state.get("style") or "?",
                asked=request.get("move") or "?",
                good=state["rating"] == "good",
                # a song with no measured tempo (or 0) has no gap to report, rather than a crash
                gap=pair.get(
                    "gap", abs(a["bpm"] / b["bpm"] - 1.0) if a["bpm"] and b["bpm"] else None
                ),
                keys=pair.get(
                    "keys",
                    camelot_distance(a["camelot"], b["camelot"])
                    if a["camelot"] and b["camelot"]
                    else None,
                ),
                bars=int(state.get("bars") or 0),
                seconds=float(state.get("duration") or 0.0),
                passed=bool(state.get("passed")),
                grid=pair.get(
                    "grid", min(a["grid_confidence"] or 0.0, b["grid_confidence"] or 0.0)
                ),
                note=state.get("note") or "",
                home=home,
                folded_gap=pair.get("folded_gap"),
                energy_step=pair.get("energy_step"),
                entry_section=pair.get("entry_section"),
            )
        )
    return found


def all_rated(homes: list[Path]) -> list[Rated]:
    """Everything rated, counting a seam once even if a folder was copied from another. Library
    ids can differ between folders, so a seam is known by its song names and move."""
    found: dict[tuple[str, str, str], Rated] = {}
    for home in homes:
        for item in read_rated(home):
            found.setdefault((item.a, item.b, item.move), item)
    return list(found.values())


def _bucket_gap(gap: float) -> str:
    return "within 4%" if gap <= 0.04 else "within 8%" if gap <= 0.08 else "over 8%"


def patterns(rated: list[Rated]) -> dict[str, dict[str, tuple[int, int]]]:
    """Good and bad counts for each thing worth comparing. It reports, and never fills a gap."""
    tables: dict[str, dict[str, list[int]]] = defaultdict(lambda: defaultdict(lambda: [0, 0]))
    # Preserve the response contract even before any ratings exist: categories can
    # have no rows, but old clients still expect all category keys.
    # Publish the established schema with zero counts until ratings arrive.
    # This preserves older clients' key/row shapes without inventing observations.
    for category, buckets in {
        "move": (
            "bass_swap_blend",
            "delay_throw",
            "echo_out",
            "phrase_roll",
            "tempo_ramp",
            "vocal_ride",
            "word_blend",
            "word_cut",
        ),
        "key distance": ("5 or more", "under 5"),
        "beat grid": ("below 0.8", "0.8 or above"),
        "audit": ("clean", "warned"),
        "overlap length": ("4 bars", "8 bars", "12 bars", "16 bars"),
        "overlap tempo gap": ("within 4%", "within 8%", "over 8%"),
        "phrase roll tempo gap": ("within 10%", "over 10%"),
        "energy step": ("lift", "level", "drop"),
        "landing": ("chorus", "verse", "instrumental", "elsewhere"),
    }.items():
        for bucket in buckets:
            tables[category][bucket]

    def note(table: str, row: str, item: Rated) -> None:
        tables[table][row][0 if item.good else 1] += 1

    for item in rated:
        note("move", item.move, item)
        if item.keys is not None:
            note("key distance", "5 or more" if item.keys >= 5 else "under 5", item)
        note("beat grid", "below 0.8" if item.grid < 0.8 else "0.8 or above", item)
        note("audit", "clean" if item.passed else "warned", item)
        if item.move in OVERLAPPING:
            note("overlap length", f"{item.bars} bars", item)
            if item.gap is not None:
                note("overlap tempo gap", _bucket_gap(item.gap), item)
        if item.move == "phrase_roll" and item.gap is not None:
            note("phrase roll tempo gap", "within 10%" if item.gap <= 0.1 else "over 10%", item)
        if item.energy_step is not None:
            lifted, dropped = item.energy_step > 0.05, item.energy_step < -0.05
            note("energy step", "lift" if lifted else "drop" if dropped else "level", item)
        if item.entry_section is not None:
            landing = (
                item.entry_section
                if item.entry_section in {"chorus", "verse", "instrumental"}
                else "elsewhere"
            )
            note("landing", landing, item)
    return {
        table: {row: (counts[0], counts[1]) for row, counts in sorted(rows.items())}
        for table, rows in tables.items()
    }


def as_dicts(rated: list[Rated]) -> list[dict]:
    return [asdict(item) for item in rated]
