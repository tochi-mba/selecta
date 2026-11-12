"""Library + Lucy (LX) release evidence: performance manifests, review manifests and the gate.

The code half of the LX tasks that only a person can close. It never produces human evidence; it
checks what a person records and refuses anything that is incomplete or unsigned.

* Performance (LX-0342-07, LX-0350-01, LX-0350-08, LX-0365-07): a lab manifest written by
  web/e2e/lx-perf-baseline.e2e.ts holds input-to-stable-result samples for 100, 1,000 and 20,000
  songs on one named device. `perf_problems` refuses an unnamed or loaded machine, a missing size
  or too few samples; `p75` and `thresholds` turn a measured baseline into release budgets (never
  invented field data); `regressions` compares a later run with those budgets.
* Visual and assistive review (LX-0340-08, LX-0352-08, LX-0364-03, LX-0364-08, LX-0365-06): a
  screenshot manifest written by web/e2e/lx-review-shots.e2e.ts. `review_problems` refuses a set
  that misses a route, theme or width, and any shot without a named reviewer, date and verdict.
* Release gate (LX-0365-08): `gate` refuses release while any P0 task is open, with no rollback
  plan, no signed owner, no independent GO from someone other than the owner, or with failing
  performance or review evidence.

    python -m selecta.audit.lx_release_evidence --dry-run   # what the gate refuses today

Read-only: no network, never edits a checklist line.
"""

from __future__ import annotations

import argparse
import json
import math
import re
import sys
from pathlib import Path

CHECKLIST = Path("docs/adr/selecta-library-lucy-experience-implementation-checklist.md")
SIZES = (100, 1000, 20000)
MIN_SAMPLES = 5
# Headroom a release budget allows over the measured p75: 20 percent, and never under 16 ms.
HEADROOM = 1.2
MIN_SLACK_MS = 16.0
ROUTES = ("library", "lucy")
THEMES = ("light", "dark")
WIDTHS = (320, 1440)
VERDICTS = {"pass", "fail"}
DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
SECTION = re.compile(r"^## \[ADR-0(\d{3})\]\([^)]+\) \((P\d);")
TASK = re.compile(r"^- \[( |x)\] \*\*(LX-0\d{3}-0\d)")


def _named(value: object) -> bool:
    """A real name: not empty and not a placeholder such as 'unnamed', '-' or 'TBD'."""
    text = str(value or "").strip().lower()
    return bool(text) and text not in {"-", "unnamed", "unknown", "tbd", "none", "n/a"}


def p75(samples: list[float]) -> float:
    """The 75th percentile by the nearest-rank method (a lab figure, not a field percentile)."""
    if not samples:
        raise ValueError("no samples")
    ordered = sorted(samples)
    return float(ordered[max(0, math.ceil(0.75 * len(ordered)) - 1)])


def perf_problems(manifest: dict) -> list[str]:
    """Why a manifest cannot stand as a named-device lab baseline (empty when it can)."""
    problems: list[str] = []
    device = manifest.get("device") or {}
    if not _named(device.get("name")):
        problems.append("the device has no name")
    if not device.get("unloaded"):
        problems.append("the machine was not recorded as unloaded")
    if not DATE.match(str(manifest.get("date") or "")):
        problems.append("the run has no date")
    if not _named(manifest.get("browser")):
        problems.append("the browser is not named")
    runs = {int(run.get("songs", 0)): run for run in manifest.get("runs", [])}
    for size in SIZES:
        run = runs.get(size)
        if not run:
            problems.append(f"no run for {size} songs")
            continue
        samples = run.get("input_to_stable_ms") or []
        if len(samples) < MIN_SAMPLES:
            problems.append(f"{size} songs: {len(samples)} samples, at least {MIN_SAMPLES} needed")
        if any(not isinstance(s, (int, float)) or s < 0 for s in samples):
            problems.append(f"{size} songs: a sample is not a time")
    audio = manifest.get("unsolicited_sounds")
    if audio is None:
        problems.append("unsolicited sounds were not counted")
    elif audio:
        problems.append(f"browsing started {audio} sound(s) nobody asked for")
    return problems


def thresholds(manifest: dict) -> dict[int, float]:
    """Release budgets from a valid baseline: the measured p75 plus headroom, per size."""
    problems = perf_problems(manifest)
    if problems:
        raise ValueError("not a baseline: " + "; ".join(problems))
    budgets: dict[int, float] = {}
    for run in manifest["runs"]:
        measured = p75(run["input_to_stable_ms"])
        budgets[int(run["songs"])] = round(max(measured * HEADROOM, measured + MIN_SLACK_MS), 1)
    return budgets


def regressions(budgets: dict[int, float], later: dict) -> list[str]:
    """Sizes whose later p75 is over budget (or missing), to optimise before release."""
    found: list[str] = []
    runs = {int(run["songs"]): run for run in later.get("runs", [])}
    for size, budget in sorted(budgets.items()):
        run = runs.get(size)
        if not run or not run.get("input_to_stable_ms"):
            found.append(f"{size} songs: not measured")
            continue
        measured = p75(run["input_to_stable_ms"])
        if measured > budget:
            found.append(f"{size} songs: p75 {measured:.1f} ms over the {budget:.1f} ms budget")
    return found


def required_shots() -> set[tuple[str, str, int]]:
    """Every route in both themes at the narrow and wide widths."""
    return {(r, t, w) for r in ROUTES for t in THEMES for w in WIDTHS}


def review_problems(manifest: dict) -> list[str]:
    """Why a screenshot review manifest is not signed evidence (empty when it is)."""
    problems: list[str] = []
    shots = manifest.get("shots") or []
    seen = {(s.get("route"), s.get("theme"), int(s.get("width", 0))) for s in shots}
    for route, theme, width in sorted(required_shots() - seen):
        problems.append(f"no {route} shot in {theme} at {width}px")
    if not manifest.get("zoom_400"):
        problems.append("no 400% zoom shots")
    for shot in shots:
        name = shot.get("file") or "a shot"
        if not _named(shot.get("reviewer")):
            problems.append(f"{name}: no named reviewer")
        if not DATE.match(str(shot.get("review_date") or "")):
            problems.append(f"{name}: no review date")
        if shot.get("verdict") not in VERDICTS:
            problems.append(f"{name}: no pass or fail verdict")
        elif shot["verdict"] == "fail":
            problems.append(f"{name}: the reviewer failed it")
    at = manifest.get("assistive") or []
    if not any(_named(s.get("reader")) and _named(s.get("reviewer")) for s in at):
        problems.append("no named screen-reader session")
    if not any(_named(s.get("device")) for s in manifest.get("devices", [])):
        problems.append("no real-device screenshots")
    return problems


def open_p0_tasks(checklist: str) -> list[str]:
    """Unticked tasks in P0 ADR sections of the LX checklist."""
    priority = None
    found: list[str] = []
    for line in checklist.splitlines():
        head = SECTION.match(line)
        if head:
            priority = head.group(2)
            continue
        task = TASK.match(line)
        if task and priority == "P0" and task.group(1) == " ":
            found.append(task.group(2))
    return found


def gate(decision: dict, checklist: str, perf: dict | None, review: dict | None) -> list[str]:
    """Every reason the release must be refused; release may go ahead only when this is empty."""
    refusals: list[str] = []
    p0 = open_p0_tasks(checklist)
    if p0:
        refusals.append(f"{len(p0)} P0 task(s) open, first {p0[0]}")
    if not str(decision.get("rollback_plan") or "").strip():
        refusals.append("no rollback plan")
    owner = decision.get("owner") or {}
    if not _named(owner.get("name")) or not DATE.match(str(owner.get("signed") or "")):
        refusals.append("the owner has not signed with a date")
    reviewer = decision.get("independent") or {}
    if not _named(reviewer.get("name")) or not DATE.match(str(reviewer.get("date") or "")):
        refusals.append("no dated independent reviewer")
    elif str(reviewer.get("name")).strip().lower() == str(owner.get("name") or "").strip().lower():
        refusals.append("the independent reviewer is the owner")
    if reviewer.get("verdict") != "GO":
        refusals.append(f"independent verdict is {reviewer.get('verdict') or 'missing'}, not GO")
    if perf is None:
        refusals.append("no performance manifest")
    else:
        refusals += [f"performance: {p}" for p in perf_problems(perf)]
    if review is None:
        refusals.append("no review manifest")
    else:
        refusals += [f"review: {p}" for p in review_problems(review)]
    return refusals


def _load(path: str | None) -> dict | None:
    return json.loads(Path(path).read_text(encoding="utf-8")) if path else None


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--dry-run", action="store_true", help="print what the gate refuses")
    parser.add_argument("--decision", help="release decision JSON")
    parser.add_argument("--perf", help="performance manifest JSON")
    parser.add_argument("--review", help="review manifest JSON")
    args = parser.parse_args(argv)
    refusals = gate(
        _load(args.decision) or {},
        CHECKLIST.read_text(encoding="utf-8"),
        _load(args.perf),
        _load(args.review),
    )
    for reason in refusals:
        print(f"REFUSED: {reason}")
    if not refusals:
        print("GO: every LX release condition is met")
    return 0 if args.dry_run or not refusals else 1


if __name__ == "__main__":
    sys.exit(main())
