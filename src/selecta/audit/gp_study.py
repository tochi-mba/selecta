"""Gap polish study scorer: turns a facilitator's result sheet into honest per-cohort counts.

The protocol is docs/research/gp-research-protocol.md. Each GP study that only people can run
(GP-0248-08, GP-0249-08 and so on) has its cohorts, task cards and measures listed in STUDIES.
A facilitator records one row per participant per task in a CSV with the columns in FIELDS;
this module checks the sheet and reports counts, a 95% Wilson interval, median times and
wrong-scope changes per cohort and session, never pooled across cohorts.

    python src/selecta/audit/gp_study.py results.csv --study GP-0248-08 \
        [--threshold 0.9 --signed-by NAME]

It never draws a conclusion without a threshold signed before the study, and never claims one
version is better: it says whether each cohort met the signed threshold and shows the counts.
Read-only: it reads the one CSV it is given, writes nothing and uses no network.
"""

from __future__ import annotations

import argparse
import csv
import math
import re
import statistics
import sys
from dataclasses import dataclass
from pathlib import Path

FIELDS = (
    "study",
    "participant",
    "cohort",
    "session",
    "task",
    "outcome",
    "seconds",
    "wrong_scope",
    "rating",
    "predicted",
)
REQUIRED = ("study", "participant", "cohort", "session", "task", "outcome")
PARTICIPANT = re.compile(r"^P\d{2,3}$")
SESSIONS = ("baseline", "candidate", "visit-1", "visit-2")
TASK_OUTCOMES = ("done_unaided", "done_with_stall", "gave_up", "wrong_result")
ANSWER_OUTCOMES = ("correct", "incorrect", "unsure")
SUCCESS = ("done_unaided", "correct")


@dataclass(frozen=True)
class Study:
    """One person-run GP study: who takes part, which cards they get, how a task ends."""

    title: str
    cohorts: tuple[str, ...]
    tasks: tuple[str, ...]
    outcomes: tuple[str, ...] = TASK_OUTCOMES


STUDIES: dict[str, Study] = {
    "GP-0248-08": Study(
        "First-glance title readability",
        ("listeners",),
        ("R1", "R2", "R3"),
        ANSWER_OUTCOMES,
    ),
    "GP-0249-08": Study("Control discovery time", ("listeners", "djs"), ("D1", "D2", "D3", "D4")),
    "GP-0250-08": Study("Seam selection and audition", ("creators",), ("S1", "S2", "S3")),
    "GP-0255-08": Study("Return to the intended task", ("listeners", "creators"), ("T1", "T2")),
    "GP-0256-08": Study("First-time advanced tasks", ("novices",), ("A1", "A2", "A3")),
    "GP-0257-08": Study("Sustained-session comfort", ("listeners", "djs"), ("C1",)),
    "GP-0258-01": Study(
        "Demand for multi-song operations",
        ("listeners", "creators"),
        ("B1", "B2"),
        ANSWER_OUTCOMES,
    ),
    "GP-0259-08": Study("Predicted versus actual satisfaction", ("listeners",), ("E1", "E2")),
    "GP-0260-08": Study("Discovery to Create handoff", ("creators",), ("H1", "H2")),
    "GP-0261-08": Study("Studio novice and expert editing", ("novices", "experts"), ("ST1", "ST2")),
    "GP-0262-08": Study(
        "Guaranteed versus tentative requests",
        ("listeners",),
        ("Q1", "Q2", "Q3", "Q4"),
        ANSWER_OUTCOMES,
    ),
    "GP-0263-08": Study("Nondeveloper fault recovery", ("nondevelopers",), ("F1", "F2", "F3")),
}


class SheetError(ValueError):
    """The result sheet cannot be scored as it stands."""


def _number(row: dict[str, str], key: str, low: float, high: float | None) -> float | None:
    raw = (row.get(key) or "").strip()
    if not raw:
        return None
    try:
        value = float(raw)
    except ValueError as error:
        raise SheetError(f"{key} must be a number, not {raw!r}") from error
    if value < low or (high is not None and value > high):
        raise SheetError(f"{key} {value} is out of range")
    return value


def validate(rows: list[dict[str, str]], study_id: str) -> list[dict[str, str]]:
    """The rows of one study, checked. Raises SheetError naming the first problem."""
    if study_id not in STUDIES:
        raise SheetError(f"unknown study {study_id}")
    study = STUDIES[study_id]
    kept = []
    seen: set[tuple[str, str, str]] = set()
    for number, row in enumerate(rows, start=2):
        extra = set(row) - set(FIELDS)
        if extra:
            raise SheetError(f"column {sorted(extra)[0]!r} is not allowed (participant privacy)")
        if (row.get("study") or "").strip() != study_id:
            continue
        where = f"row {number}"
        for key in REQUIRED:
            if not (row.get(key) or "").strip():
                raise SheetError(f"{where}: {key} is empty")
        if not PARTICIPANT.match(row["participant"].strip()):
            raise SheetError(f"{where}: participant must be a code like P01, never a name")
        if row["cohort"] not in study.cohorts:
            raise SheetError(f"{where}: cohort {row['cohort']!r} is not in this study")
        if row["session"] not in SESSIONS:
            raise SheetError(f"{where}: session {row['session']!r} is not recognised")
        if row["task"] not in study.tasks:
            raise SheetError(f"{where}: task {row['task']!r} is not a card of this study")
        if row["outcome"] not in study.outcomes:
            raise SheetError(f"{where}: outcome {row['outcome']!r} is not allowed here")
        _number(row, "seconds", 0, None)
        _number(row, "rating", 1, 5)
        _number(row, "predicted", 1, 5)
        if (row.get("wrong_scope") or "0").strip() not in ("0", "1"):
            raise SheetError(f"{where}: wrong_scope is 0 or 1")
        key = (row["participant"], row["session"], row["task"])
        if key in seen:
            raise SheetError(f"{where}: {key} is recorded twice")
        seen.add(key)
        kept.append(row)
    return kept


def wilson(successes: int, total: int, z: float = 1.96) -> tuple[float, float]:
    """The 95% Wilson score interval for a proportion; (0, 1) when nothing was measured."""
    if total == 0:
        return 0.0, 1.0
    p = successes / total
    centre = p + z * z / (2 * total)
    spread = z * math.sqrt(p * (1 - p) / total + z * z / (4 * total * total))
    scale = 1 + z * z / total
    return max(0.0, (centre - spread) / scale), min(1.0, (centre + spread) / scale)


@dataclass(frozen=True)
class Cell:
    """What one cohort did in one session of one study."""

    cohort: str
    session: str
    people: int
    tasks: int
    successes: int
    interval: tuple[float, float]
    median_seconds: float | None
    wrong_scope: int
    mean_rating: float | None
    mean_gap: float | None


def summarise(rows: list[dict[str, str]], study_id: str) -> list[Cell]:
    """One cell per cohort and session, from validated rows; cohorts are never pooled."""
    rows = validate(rows, study_id)
    cells = []
    for cohort in STUDIES[study_id].cohorts:
        for session in SESSIONS:
            group = [r for r in rows if r["cohort"] == cohort and r["session"] == session]
            if not group:
                continue
            wins = sum(1 for r in group if r["outcome"] in SUCCESS)
            times = [float(r["seconds"]) for r in group if (r.get("seconds") or "").strip()]
            ratings = [float(r["rating"]) for r in group if (r.get("rating") or "").strip()]
            gaps = [
                abs(float(r["predicted"]) - float(r["rating"]))
                for r in group
                if (r.get("predicted") or "").strip() and (r.get("rating") or "").strip()
            ]
            cells.append(
                Cell(
                    cohort=cohort,
                    session=session,
                    people=len({r["participant"] for r in group}),
                    tasks=len(group),
                    successes=wins,
                    interval=wilson(wins, len(group)),
                    median_seconds=statistics.median(times) if times else None,
                    wrong_scope=sum(1 for r in group if (r.get("wrong_scope") or "0") == "1"),
                    mean_rating=statistics.fmean(ratings) if ratings else None,
                    mean_gap=statistics.fmean(gaps) if gaps else None,
                )
            )
    return cells


def verdict(cell: Cell, threshold: float | None, signed_by: str | None) -> str:
    """Whether a cohort met the threshold signed before the study, or why nothing is said."""
    if threshold is None or not (signed_by or "").strip():
        return "No conclusion: no threshold was signed before the study"
    if cell.people < 5:
        return f"No conclusion: only {cell.people} people (at least 5 per cohort)"
    met = cell.successes / cell.tasks >= threshold and cell.wrong_scope == 0
    return f"{'Met' if met else 'Not met'} the {threshold:.0%} threshold signed by {signed_by}"


def report(rows: list[dict[str, str]], study_id: str, threshold=None, signed_by=None) -> str:
    """A plain-text report: counts first, intervals, then the signed-threshold verdict."""
    study = STUDIES[study_id]
    lines = [f"{study_id} {study.title}"]
    cells = summarise(rows, study_id)
    if not cells:
        return "\n".join(lines + ["No sessions recorded: there is no result yet."])
    for cell in cells:
        low, high = cell.interval
        part = (
            f"{cell.cohort} / {cell.session}: {cell.successes} of {cell.tasks} tasks succeeded "
            f"({cell.people} people; 95% interval {low:.0%} to {high:.0%})"
        )
        if cell.median_seconds is not None:
            part += f"; median {cell.median_seconds:.0f} s"
        part += f"; wrong-scope changes {cell.wrong_scope}"
        if cell.mean_rating is not None:
            part += f"; mean rating {cell.mean_rating:.1f} of 5"
        if cell.mean_gap is not None:
            part += f"; mean predicted-versus-actual gap {cell.mean_gap:.1f}"
        lines.append(part + ". " + verdict(cell, threshold, signed_by) + ".")
    lines.append("Cohorts are reported separately; no version is claimed to be better.")
    return "\n".join(lines)


def read(path: Path) -> list[dict[str, str]]:
    with path.open(newline="", encoding="utf-8") as handle:
        return [dict(row) for row in csv.DictReader(handle)]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("sheet", type=Path)
    parser.add_argument("--study", required=True, choices=sorted(STUDIES))
    parser.add_argument("--threshold", type=float)
    parser.add_argument("--signed-by")
    args = parser.parse_args(argv)
    try:
        print(report(read(args.sheet), args.study, args.threshold, args.signed_by))
    except SheetError as error:
        print(f"Cannot score this sheet: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
