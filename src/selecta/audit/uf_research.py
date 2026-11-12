"""Unified finish (UF) research scoring: the code half of ADR-0367 and UF-0389-04.

The protocol is docs/research/uf-research-protocol.md. This module checks the session records a
facilitator writes and scores them. It never invents a participant or a result: an empty folder,
an unsigned threshold or an unmatched comparison scores nothing and says why.

Records live in docs/research/uf-sessions/*.json, one file per session:

    {"participant": "P01", "cohort": "new-listener", "build": "baseline" | "candidate",
     "date": "2026-12-01", "sample": {...cohort fields...}, "library": "...",
     "device_class": "laptop", "order": ["U1", ..., "U6"],
     "tasks": [{"task": "U1", "outcome": "Done unaided", "errors": [], "seconds": 80,
                "confusion": [], "confidence": 4, "recovered": null}],
     "vocabulary": {"analysed": true, "mix-ready": false, ...}}

    python -m selecta.audit.uf_research            # score docs/research/uf-sessions
"""

from __future__ import annotations

import json
import math
import re
import sys
from pathlib import Path

SESSIONS = Path("docs/research/uf-sessions")
PROTOCOL = Path("docs/research/uf-research-protocol.md")
DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
CODE = re.compile(r"^P\d{2,3}$")  # participant codes, never names

# UF-0367-01: three cohorts, each with the sample details the protocol records
COHORTS: dict[str, tuple[str, ...]] = {
    "new-listener": ("age_band", "music_app", "device", "input"),
    "experienced-editor": ("years", "tools", "device", "input"),
    "assistive-technology": ("at_and_version", "browser", "os", "zoom"),
}
TASKS = ("U1", "U2", "U3", "U4", "U5", "U6")
OUTCOMES = ("Done unaided", "Done with stall", "Gave up", "Wrong result")
SUCCESS = {"Done unaided", "Done with stall"}
# UF-0367-06: the six lifecycle words the explanation exercise codes for
VOCABULARY = ("analysed", "mix-ready", "proposal", "draft", "rendering", "playing")
# UF-0367-08 / UF-0389-04: words a small qualitative report may never use
OVERCLAIMS = re.compile(
    r"statistically|significan(t|ce)|superior(ity)?|p\s*[<=]\s*0?\.\d|\d+\s*% (better|improvement)",
    re.IGNORECASE,
)


def record_problems(record: dict) -> list[str]:
    """Everything wrong with one session record (UF-0367-01 and -03)."""
    who = str(record.get("participant", "?"))
    problems: list[str] = []
    if not CODE.match(who):
        problems.append(f"{who}: participant must be a code like P01, never a name")
    cohort = record.get("cohort")
    if cohort not in COHORTS:
        problems.append(f"{who}: cohort must be one of {', '.join(COHORTS)}")
    else:
        sample = record.get("sample") or {}
        for field in COHORTS[cohort]:
            if not str(sample.get(field, "")).strip():
                problems.append(f"{who}: sample detail {field!r} missing for {cohort}")
    if record.get("build") not in ("baseline", "candidate"):
        problems.append(f"{who}: build must be baseline or candidate")
    if not DATE.match(str(record.get("date", ""))):
        problems.append(f"{who}: date must be YYYY-MM-DD")
    for key in ("library", "device_class"):
        if not str(record.get(key, "")).strip():
            problems.append(f"{who}: {key} missing")
    seen = set()
    for row in record.get("tasks", []):
        task = row.get("task")
        seen.add(task)
        if task not in TASKS:
            problems.append(f"{who}: unknown task {task!r}")
        if row.get("outcome") not in OUTCOMES:
            problems.append(f"{who} {task}: outcome must be one of {', '.join(OUTCOMES)}")
        if not isinstance(row.get("errors"), list):
            problems.append(f"{who} {task}: errors must be a list (empty when none)")
        if not isinstance(row.get("seconds"), (int, float)) or row["seconds"] <= 0:
            problems.append(f"{who} {task}: seconds from card to outcome missing")
        if not isinstance(row.get("confusion"), list):
            problems.append(f"{who} {task}: confusion moments must be a list")
        if row.get("confidence") not in (1, 2, 3, 4, 5):
            problems.append(f"{who} {task}: confidence must be 1 to 5")
        if row.get("errors") and row.get("recovered") not in (True, False):
            problems.append(f"{who} {task}: say whether the error was recovered without help")
    if not seen:
        problems.append(f"{who}: no task rows")
    return problems


def wilson(successes: int, n: int, z: float = 1.96) -> tuple[float, float]:
    """95% Wilson interval, so small cohorts report a range rather than a bare percentage."""
    if n == 0:
        return (0.0, 0.0)
    p = successes / n
    centre = (p + z * z / (2 * n)) / (1 + z * z / n)
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / (1 + z * z / n)
    return (round(max(0.0, centre - half), 3), round(min(1.0, centre + half), 3))


def cohort_summary(records: list[dict], build: str) -> dict[str, dict]:
    """Per-cohort success, never pooled (UF-0367-01/03)."""
    out: dict[str, dict] = {}
    for cohort in COHORTS:
        rows = [
            row
            for record in records
            if record.get("cohort") == cohort and record.get("build") == build
            for row in record.get("tasks", [])
        ]
        done = sum(1 for row in rows if row.get("outcome") in SUCCESS)
        people = {
            r["participant"]
            for r in records
            if r.get("cohort") == cohort and r.get("build") == build
        }
        out[cohort] = {
            "participants": len(people),
            "attempts": len(rows),
            "successes": done,
            "interval": wilson(done, len(rows)),
            "errors": sum(len(row.get("errors", [])) for row in rows),
            "recovered": sum(1 for row in rows if row.get("recovered") is True),
        }
    return out


def threshold_problems(signoff: dict | None, records: list[dict]) -> list[str]:
    """UF-0367-04: a named person signs the per-cohort threshold before any candidate session."""
    if not signoff or not str(signoff.get("signed_by", "")).strip(" -"):
        return ["threshold not signed by a named owner"]
    date = str(signoff.get("date", ""))
    if not DATE.match(date):
        return ["threshold sign-off has no date"]
    first = min((r["date"] for r in records if r.get("build") == "candidate"), default=None)
    if first and first < date:
        return [f"threshold signed {date}, after the first candidate session {first}"]
    return []


def matching_problems(records: list[dict]) -> list[str]:
    """UF-0367-05: baseline and candidate use the same cards, library, device class and order."""

    def shape(build: str) -> set[tuple]:
        return {
            (
                tuple(r.get("order", [])),
                r.get("library"),
                r.get("device_class"),
                tuple(sorted(row["task"] for row in r.get("tasks", []))),
            )
            for r in records
            if r.get("build") == build
        }

    baseline, candidate = shape("baseline"), shape("candidate")
    if not baseline or not candidate:
        return ["comparison needs both baseline and candidate sessions"]
    if baseline != candidate:
        return ["baseline and candidate differ in cards, library, device class or task order"]
    return []


def vocabulary_summary(records: list[dict]) -> dict[str, dict[str, int]]:
    """UF-0367-06: per cohort, how many people told each lifecycle word apart, unprompted."""
    out = {cohort: {word: 0 for word in VOCABULARY} for cohort in COHORTS}
    for record in records:
        coded = record.get("vocabulary") or {}
        for word in VOCABULARY:
            if coded.get(word) is True and record.get("cohort") in out:
                out[record["cohort"]][word] += 1
    return out


def report_problems(text: str, records: list[dict]) -> list[str]:
    """UF-0367-08 / UF-0389-04: a results report states sample sizes and never overclaims."""
    problems = [f"overclaim: {m.group(0)!r}" for m in OVERCLAIMS.finditer(text)]
    if "sample" not in text.lower():
        problems.append("report does not state its sample-size caveats")
    for cohort, row in cohort_summary(records, "candidate").items():
        if row["participants"] and f"{row['successes']} of {row['attempts']}" not in text:
            problems.append(f"{cohort}: report must give the count as 'N of M', not only a %")
    if not re.search(r"reviewed by\s+\S", text, re.IGNORECASE):
        problems.append("report has no researcher review line ('Reviewed by <name>')")
    return problems


def load(folder: Path) -> list[dict]:
    if not folder.is_dir():
        return []
    return [json.loads(path.read_text(encoding="utf-8")) for path in sorted(folder.glob("*.json"))]


def main(argv: list[str] | None = None) -> int:
    root = Path(__file__).resolve().parents[3]
    records = load(root / SESSIONS)
    if not records:
        print("No UF research sessions recorded: nothing to score (no result is claimed).")
        return 0
    problems = [p for record in records for p in record_problems(record)]
    for problem in problems:
        print(f"ERROR: {problem}")
    for build in ("baseline", "candidate"):
        print(build, json.dumps(cohort_summary(records, build)))
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
