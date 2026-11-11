"""Every Good and Bad a listener has clicked, wherever it was saved, and what they have in common.

Older versions kept data in a folder that desktop apps redirect, so one person's clicks could end up
in several places. This reads the current folder and any older ones, so nothing is missed when it's
time to learn from them.
"""

from __future__ import annotations

import json
import sqlite3
from collections import defaultdict
from dataclasses import asdict, dataclass
from pathlib import Path

from selecta.analysis.key import camelot_distance
from selecta.homes import DATABASE, old_homes

OVERLAPPING = {
    "bass_swap_blend",
    "filter_sweep",
    "tempo_ramp",
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
    gap: float
    keys: int
    bars: int
    seconds: float
    passed: bool
    grid: float
    note: str
    home: str


def known_homes(current: Path) -> list[Path]:
    """The folder in use, and any older one that might still hold clicks not brought in yet."""
    homes = [current] if (current / DATABASE).is_file() else []
    return [*homes, *old_homes(current)]


def read_rated(home: Path) -> list[Rated]:
    """The rated seams in one data folder, including ones the render cache has since cleared."""
    conn = sqlite3.connect(f"file:{home / 'selecta.sqlite'}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    songs = {
        row["id"]: row
        for row in conn.execute(
            "SELECT s.id,s.artist,s.title,a.bpm,a.camelot,a.grid_confidence "
            "FROM songs s JOIN analysis a ON a.song_id=s.id"
        )
    }
    conn.close()
    states: dict[str, dict] = {}
    for meta in [
        *(home / "renders" / "seams").glob("*/seam.json"),
        *(home / "seam-history").glob("*.json"),
    ]:
        try:
            state = json.loads(meta.read_text("utf-8"))
        except (OSError, ValueError):
            continue
        states.setdefault(state.get("key", str(meta)), state)
    found = []
    for state in states.values():
        if state.get("rating") not in {"good", "bad"}:
            continue
        request = state.get("request") or {}
        a, b = songs.get(request.get("a")), songs.get(request.get("b"))
        if a is None or b is None:
            continue
        found.append(
            Rated(
                a=f"{a['artist'] or '?'} - {a['title'] or '?'}",
                b=f"{b['artist'] or '?'} - {b['title'] or '?'}",
                move=state.get("style") or "?",
                asked=request.get("move") or "?",
                good=state["rating"] == "good",
                gap=abs(a["bpm"] / b["bpm"] - 1.0),
                keys=camelot_distance(a["camelot"], b["camelot"]),
                bars=int(state.get("bars") or 0),
                seconds=float(state.get("duration") or 0.0),
                passed=bool(state.get("passed")),
                grid=min(a["grid_confidence"] or 0.0, b["grid_confidence"] or 0.0),
                note=state.get("note") or "",
                home=str(home),
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
            "bass_swap_blend", "delay_throw", "echo_out", "phrase_roll",
            "tempo_ramp", "vocal_ride", "word_blend", "word_cut",
        ),
        "key distance": ("5 or more", "under 5"),
        "beat grid": ("below 0.8", "0.8 or above"),
        "audit": ("clean", "warned"),
        "overlap length": ("4 bars", "8 bars", "12 bars", "16 bars"),
        "overlap tempo gap": ("within 4%", "within 8%", "over 8%"),
        "phrase roll tempo gap": ("within 10%", "over 10%"),
    }.items():
        for bucket in buckets:
            tables[category][bucket]

    def note(table: str, row: str, item: Rated) -> None:
        tables[table][row][0 if item.good else 1] += 1

    for item in rated:
        note("move", item.move, item)
        note("key distance", "5 or more" if item.keys >= 5 else "under 5", item)
        note("beat grid", "below 0.8" if item.grid < 0.8 else "0.8 or above", item)
        note("audit", "clean" if item.passed else "warned", item)
        if item.move in OVERLAPPING:
            note("overlap length", f"{item.bars} bars", item)
            note("overlap tempo gap", _bucket_gap(item.gap), item)
        if item.move == "phrase_roll":
            note("phrase roll tempo gap", "within 10%" if item.gap <= 0.1 else "over 10%", item)
    return {
        table: {row: (counts[0], counts[1]) for row, counts in sorted(rows.items())}
        for table, rows in tables.items()
    }


def as_dicts(rated: list[Rated]) -> list[dict]:
    return [asdict(item) for item in rated]
