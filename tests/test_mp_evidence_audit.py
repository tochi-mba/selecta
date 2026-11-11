"""MP-0299-07: evidence consistency in the measured micro-polish checklist.

Every checked MP task names an implementing PR or SHA and concrete evidence, and a task may only say
Independently Verified: Yes with a named reviewer that is not the implementation evidence. Whether
that reviewer's proof is truly independent is for a person to judge; this keeps the record honest.
"""

from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CHECKLIST = ROOT / "docs/adr/selecta-measured-micro-polish-implementation-checklist.md"
TASK = re.compile(r"^- \[(?P<mark>[ xX])\] \*\*(?P<id>MP-\d{4}-\d{2})\b")


def field(line: str, name: str) -> str | None:
    match = re.search(rf"\*\*{re.escape(name)}:\*\*\s*(.*?)(?:;\s*\*\*|$)", line)
    return match.group(1).strip().rstrip(".") if match else None


def tasks() -> list[tuple[str, bool, str]]:
    found = []
    for line in CHECKLIST.read_text(encoding="utf-8").splitlines():
        match = TASK.match(line)
        if match:
            found.append((match.group("id"), match.group("mark") != " ", line))
    return found


def test_every_mp_task_is_listed_once() -> None:
    ids = [task_id for task_id, _, _ in tasks()]
    assert len(ids) == 224
    assert len(set(ids)) == len(ids)


def test_checked_tasks_name_an_implementing_change_and_evidence() -> None:
    problems = []
    for task_id, checked, line in tasks():
        if not checked:
            continue
        sha = field(line, "Implementing PR/SHA")
        evidence = field(line, "Evidence")
        if not sha or sha == "-":
            problems.append(f"{task_id}: no implementing PR/SHA")
        if not evidence or evidence == "-":
            problems.append(f"{task_id}: no evidence")
        if field(line, "Implementation") != "Implemented":
            problems.append(f"{task_id}: checked but Implementation is not Implemented")
    assert problems == []


def test_verified_only_with_a_named_separate_reviewer() -> None:
    problems = []
    for task_id, _, line in tasks():
        verified = field(line, "Independently Verified")
        reviewer = field(line, "Evidence/reviewer") or ""
        if verified == "Yes" and (not reviewer or re.search(r"independent reviewer -$", reviewer)):
            problems.append(f"{task_id}: verified with no named reviewer")
        if verified not in {"Yes", "No"}:
            problems.append(f"{task_id}: Independently Verified is {verified!r}")
    assert problems == []
