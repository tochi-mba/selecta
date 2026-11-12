"""Library + Lucy (LX) study kit: the scripts and scoring for the LX user studies.

Nineteen LX tasks close only after a study with real people (LX-0341-08, -0343-08 ... -0363-08).
This module is the code half: one protocol per task (route, made-up library from
tests/e2e_server.py, who takes part, the uncoached prompts and what counts as success), a checker
for the session records a facilitator writes, and a scorer that compares timed tasks with the
baseline. It never invents a participant or a result; an empty or unsigned record scores nothing.

    python -m selecta.audit.lx_study_kit --write   # regenerate docs/verification/lx-study-kit.md
    python -m selecta.audit.lx_study_kit --check   # exit 1 when that page is out of date
"""

from __future__ import annotations

import argparse
import re
import statistics
import sys
from dataclasses import dataclass
from pathlib import Path

OUT = Path("docs/verification/lx-study-kit.md")
FIXTURE = "tests/e2e_server.py made-up library (python tests/e2e_server.py <port>)"
DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
CODE = re.compile(r"^P\d{2,3}$")  # participant codes, never names
GROUPS = {"novice", "expert"}


@dataclass(frozen=True)
class Study:
    """One uncoached study protocol for one LX task."""

    task: str
    title: str
    route: str
    groups: tuple[str, ...]
    prompts: tuple[str, ...]
    success: str
    timed: bool = False
    mobile: bool = False


def _s(task, title, route, prompts, success, groups=("novice", "expert"), **kw) -> Study:
    return Study(task, title, route, groups, tuple(prompts), success, **kw)


STUDIES: tuple[Study, ...] = (
    _s(
        "LX-0341-08",
        "Overview value",
        "/library",
        [
            "Without help, say what each count at the top means.",
            "Find the song 'Same Name' by its second artist.",
        ],
        "Every count explained correctly; retrieval no slower than baseline.",
        timed=True,
    ),
    _s(
        "LX-0343-08",
        "Musical refinement",
        "/library",
        ["Find a ready song with a slow tempo.", "Find any song by its title."],
        "Experts faster than baseline; novices no slower; no hidden step needed.",
        timed=True,
    ),
    _s(
        "LX-0344-08",
        "Scan efficiency",
        "/library",
        ["In light theme find the set-aside talk.", "In dark theme find the broken file."],
        "Both themes match or beat baseline for both groups.",
        timed=True,
    ),
    _s(
        "LX-0345-08",
        "Discovery benefit",
        "/library (Card view)",
        ["Browse and pick two songs you have not heard of.", "Then find recording 10."],
        "More unfamiliar songs opened than in List view; retrieval no slower.",
        timed=True,
    ),
    _s(
        "LX-0346-08",
        "Novice meaning",
        "/library",
        ["Before pressing each row action, say what it will do."],
        "Every prediction matches what happens.",
        groups=("novice",),
    ),
    _s(
        "LX-0347-08",
        "Selection confidence",
        "/library",
        [
            "Select three songs, say how many are selected and what Set aside would change.",
            "Undo or cancel before anything changes.",
        ],
        "Scope stated correctly and cancelled with nothing changed.",
        groups=("novice",),
    ),
    _s(
        "LX-0348-08",
        "Inspector confidence",
        "/library?song=10",
        [
            "Explain which tempo is active and which was measured.",
            "Correct the tempo, then put it back.",
        ],
        "Active versus measured explained before applying; restore done unaided.",
    ),
    _s(
        "LX-0351-08",
        "Mobile journey",
        "/library on a phone, one hand",
        ["Search for a song, open that exact recording and add it to a mix."],
        "Done one-handed with no desktop step.",
        timed=True,
        mobile=True,
    ),
    _s(
        "LX-0353-08",
        "Decision confidence",
        "/mixes",
        ["You want music now: pick a way in.", "You want to plan a set: pick a way in."],
        "Each person picks the way in that fits the stated outcome.",
    ),
    _s(
        "LX-0354-08",
        "Creation continuity",
        "/mixes",
        ["Choose a mood, carry it to Lucy, then to the editor, with music playing."],
        "No lost context and no sound that was not asked for.",
    ),
    _s(
        "LX-0355-08",
        "Creator workspace",
        "/mixes/lucy/<id>",
        ["Describe the current proposal.", "Ask Lucy for a change and say what changed."],
        "Both groups explain the proposal while revising.",
        timed=True,
    ),
    _s(
        "LX-0356-08",
        "Response comprehension",
        "/mixes/lucy/<id>",
        ["Summarise what Lucy did and what is still unbuilt."],
        "Both parts summarised correctly without coaching.",
    ),
    _s(
        "LX-0357-08",
        "Touch and AT parity",
        "/mixes/lucy/<id> at 320px",
        ["Ask, edit the request, send, then stop, one-handed and with TalkBack or VoiceOver."],
        "Whole task done with touch and with a screen reader.",
        mobile=True,
    ),
    _s(
        "LX-0358-08",
        "Working-state trust",
        "/mixes/lucy/<id>",
        ["After a mixed run, say what happened and whether anything was saved or played."],
        "Predictions match the run log.",
    ),
    _s(
        "LX-0359-08",
        "Readiness understanding",
        "/mixes/lucy/<id>",
        ["Say whether this plan is unbuilt, saved or fully playable."],
        "State named correctly without reading code-like labels.",
    ),
    _s(
        "LX-0360-08",
        "Musical flow",
        "/mixes/lucy/<id>",
        ["Describe the opening, build and close.", "Point to the seam that sounds wrong."],
        "Shape described and the problem seam located.",
        timed=True,
    ),
    _s(
        "LX-0361-08",
        "Revision decisions",
        "/mixes/lucy/<id>",
        ["Compare two versions, choose one and say what happens before you commit."],
        "Intended version chosen; consequences stated before commit.",
    ),
    _s(
        "LX-0362-08",
        "Informed consent",
        "/mixes/lucy/<id> with music playing",
        ["Say what Save and Save and play each do, then stop or cancel."],
        "Effects predicted; stop or cancel leaves the player untouched.",
    ),
    _s(
        "LX-0363-08",
        "Recovery confidence",
        "/mixes/lucy/<id> after closing the tab",
        ["Come back, find the last proposal and say what was saved."],
        "Last proposal found and saved state stated correctly.",
    ),
)
BY_TASK = {study.task: study for study in STUDIES}


def record_problems(record: dict) -> list[str]:
    """Why a facilitator's session record cannot count (empty when it can)."""
    problems: list[str] = []
    study = BY_TASK.get(record.get("task", ""))
    if not study:
        return [f"unknown study task {record.get('task')!r}"]
    if not str(record.get("facilitator") or "").strip():
        problems.append("no named facilitator")
    if not DATE.match(str(record.get("date") or "")):
        problems.append("no session date")
    if not CODE.match(str(record.get("participant") or "")):
        problems.append("participant must be a code such as P01, never a name")
    if record.get("group") not in study.groups:
        problems.append(f"group must be one of {', '.join(study.groups)}")
    if record.get("coached"):
        problems.append("a coached session does not count")
    outcomes = record.get("outcomes") or []
    if len(outcomes) != len(study.prompts):
        problems.append(f"{len(outcomes)} outcomes for {len(study.prompts)} prompts")
    for outcome in outcomes:
        if not isinstance(outcome.get("success"), bool):
            problems.append("every outcome needs success true or false")
        if study.timed and not isinstance(outcome.get("seconds"), (int, float)):
            problems.append("a timed study needs seconds on every outcome")
    return problems


def score(task: str, records: list[dict], baseline_seconds: float | None = None) -> dict:
    """Pool the valid sessions for one task: success rate, median time and the baseline verdict."""
    study = BY_TASK[task]
    valid = [r for r in records if r.get("task") == task and not record_problems(r)]
    groups = {g: [r for r in valid if r["group"] == g] for g in study.groups}
    outcomes = [o for r in valid for o in r["outcomes"]]
    result: dict = {
        "task": task,
        "sessions": len(valid),
        "rejected": sum(1 for r in records if r.get("task") == task) - len(valid),
        "groups": {g: len(rs) for g, rs in groups.items()},
        "success_rate": (sum(o["success"] for o in outcomes) / len(outcomes)) if outcomes else None,
        "median_seconds": None,
        "versus_baseline": None,
        "enough": bool(valid) and all(groups.values()),
    }
    if study.timed and outcomes:
        median = statistics.median(o["seconds"] for o in outcomes)
        result["median_seconds"] = median
        if baseline_seconds:
            result["versus_baseline"] = (
                "faster"
                if median < baseline_seconds * 0.95
                else "matched"
                if median <= baseline_seconds * 1.05
                else "slower"
            )
    return result


def render() -> str:
    lines = [
        "# LX study kit",
        "",
        "Generated by `python -m selecta.audit.lx_study_kit --write`; do not edit by hand.",
        "",
        f"Fixture for every study: {FIXTURE}. Sessions are uncoached; record participants as",
        "codes (P01, P02), never names. One JSON record per participant and study:",
        '`{"task", "facilitator", "date", "participant", "group", "coached": false,',
        '"outcomes": [{"success", "seconds"}]}`. `score()` drops any record that fails',
        "`record_problems()`, so nothing unsigned or coached is ever counted.",
        "",
    ]
    for study in STUDIES:
        lines += [
            f"## {study.task} - {study.title}",
            "",
            f"- Route: {study.route}" + (" (real phone)" if study.mobile else ""),
            f"- Who: {' and '.join(study.groups)}"
            + ("; timed against baseline" if study.timed else ""),
        ]
        lines += [f"- Prompt {n}: {p}" for n, p in enumerate(study.prompts, 1)]
        lines += [f"- Success: {study.success}", ""]
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--write", action="store_true")
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args(argv)
    text = render()
    if args.write:
        OUT.write_text(text, encoding="utf-8", newline="\n")
        return 0
    if args.check:
        current = OUT.read_text(encoding="utf-8") if OUT.exists() else ""
        if current != text:
            print(f"{OUT} is out of date; run with --write")
            return 1
        return 0
    print(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
