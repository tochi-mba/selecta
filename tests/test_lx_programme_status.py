"""The Library + Lucy (LX) programme's own bookkeeping (ADR-0365, LX-0365-01 to -04).

Every ADR from 0340 to 0365 owns eight unique LX tasks with acceptance and verification, every
link resolves, every task carries its evidence fields, and the checklist, the ADRs, the evidence
ledger and the status JSON all say the same thing about each task. Nothing is ever recorded as
independently verified without a named reviewer and a date, and a decision only leaves Proposed
with a dated owner rationale.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ADR_DIR = ROOT / "docs" / "adr"
CHECKLIST = ADR_DIR / "selecta-library-lucy-experience-implementation-checklist.md"
LEDGER = ADR_DIR / "selecta-library-lucy-experience-implementation-evidence.md"
STATUS = ADR_DIR / "selecta-library-lucy-experience-code-status.json"
NUMBERS = range(340, 366)
STATES = {"Not started", "In progress", "Implemented"}

SECTION = re.compile(r"^## \[ADR-0(\d{3})\]\((adr-0\d{3}-[a-z0-9-]+\.md)\)")
CHECK_LINE = re.compile(
    r"^- \[( |x)\] \*\*(LX-0(\d{3})-0[1-8]) - [^*]+\*\* \*\*Acceptance:\*\* .+? "
    r"\*\*Verification:\*\* .+? \*\*Implementation:\*\* ([^;]+); \*\*Independently Verified:\*\* "
    r"(Yes|No); \*\*Owner:\*\* [^;]+; \*\*Implementing PR/SHA:\*\* [^;]+; "
    # ticked lines also cite Evidence:, which checklist_evidence.py requires
    r"(?:\*\*Evidence:\*\* .+?; )?\*\*Evidence/reviewer:\*\* .+$"
)
ADR_LINE = re.compile(
    r"^\d\. \*\*(LX-0\d{3}-0[1-8]) - [^*]+\*\* \*\*Acceptance:\*\* .+? "
    r"\*\*Required verification:\*\* .+? "
    r"\*\*Implementation:\*\* ([^;]+); \*\*Independently Verified:\*\* (Yes|No);"
)
LEDGER_ROW = re.compile(
    r"^\| (LX-0(\d{3})-0[1-8]) \| \[ADR-0\d{3}\]\(([^)]+)\) \|([^|]*)\|([^|]*)\|([^|]*)\|"
)


def checklist_tasks() -> dict[str, dict]:
    tasks: dict[str, dict] = {}
    section = None
    for line in CHECKLIST.read_text(encoding="utf-8").splitlines():
        head = SECTION.match(line)
        if head:
            section = int(head.group(1))
            continue
        if line.startswith("- ["):
            match = CHECK_LINE.match(line)
            assert match, f"malformed LX checklist line: {line[:90]}"
            ticked, task, number, state, verified = match.groups()
            assert int(number) == section, f"{task} sits under ADR-0{section}"
            assert task not in tasks, f"{task} is listed twice"
            tasks[task] = {
                "ticked": ticked == "x",
                "implementation": state.strip(),
                "verified": verified == "Yes",
                "line": line,
            }
    return tasks


def adr_file(number: int) -> Path:
    found = sorted(ADR_DIR.glob(f"adr-0{number}-*.md"))
    assert len(found) == 1, f"ADR-0{number} should be exactly one file, found {found}"
    return found[0]


def test_every_adr_owns_eight_unique_tasks_and_every_link_resolves():
    tasks = checklist_tasks()
    assert len(tasks) == 208
    sections = [SECTION.match(line) for line in CHECKLIST.read_text(encoding="utf-8").splitlines()]
    linked = [match.group(2) for match in sections if match]
    assert [int(name[5:8]) for name in linked] == list(NUMBERS)
    for name in linked:
        assert (ADR_DIR / name).is_file(), name
    for number in NUMBERS:
        ids = sorted(task for task in tasks if task.startswith(f"LX-0{number}-"))
        assert ids == [f"LX-0{number}-0{n}" for n in range(1, 9)]
        text = adr_file(number).read_text(encoding="utf-8")
        for link in re.findall(r"\]\(([^)#]+\.(?:md|json))\)", text):
            assert (ADR_DIR / link).is_file(), f"ADR-0{number} links to missing {link}"


def test_every_task_carries_owner_pr_evidence_and_reviewer_fields():
    tasks = checklist_tasks()
    rows = [LEDGER_ROW.match(line) for line in LEDGER.read_text(encoding="utf-8").splitlines()]
    rows = [row for row in rows if row]
    assert sorted(row.group(1) for row in rows) == sorted(tasks)
    for line in LEDGER.read_text(encoding="utf-8").splitlines():
        if LEDGER_ROW.match(line):
            assert line.count("|") == 10, f"ledger row needs nine columns: {line[:60]}"
    data = json.loads(STATUS.read_text(encoding="utf-8"))
    fields = {
        "id",
        "title",
        "implementation",
        "independently_verified",
        "owner",
        "implementing_pr",
        "implementing_sha",
        "evidence",
        "reviewer",
        "review_date",
        "platform",
    }
    for adr in data["adrs"]:
        for task in adr["tasks"]:
            assert fields <= set(task), task["id"]


def test_decisions_stay_proposed_until_an_owner_records_a_dated_rationale():
    data = json.loads(STATUS.read_text(encoding="utf-8"))
    decided = {adr["number"]: adr["decision"] for adr in data["adrs"]}
    assert sorted(decided) == list(NUMBERS)
    for number in NUMBERS:
        line = next(
            line
            for line in adr_file(number).read_text(encoding="utf-8").splitlines()
            if line.startswith("- **Decision:**")
        )
        word = re.match(r"- \*\*Decision:\*\* (\w+)", line).group(1)
        assert word == decided[number], f"ADR-0{number} says {word}, JSON says {decided[number]}"
        if word != "Proposed":
            assert word in {"Accepted", "Rejected", "Superseded"}
            assert re.search(r"\d{4}-\d{2}-\d{2}", line) and re.search(r"[Oo]wner", line), (
                f"ADR-0{number} left Proposed without a dated owner rationale"
            )
    summary = data["decision_summary"]
    for word in ("Proposed", "Accepted", "Rejected", "Superseded"):
        assert summary[word] == sum(1 for value in decided.values() if value == word)


def test_checklist_adrs_ledger_and_json_agree_on_every_task():
    tasks = checklist_tasks()
    adr_lines: dict[str, tuple[str, bool]] = {}
    for number in NUMBERS:
        for line in adr_file(number).read_text(encoding="utf-8").splitlines():
            match = ADR_LINE.match(line)
            if match:
                adr_lines[match.group(1)] = (match.group(2).strip(), match.group(3) == "Yes")
    assert sorted(adr_lines) == sorted(tasks)
    ledger: dict[str, tuple[str, bool]] = {}
    for line in LEDGER.read_text(encoding="utf-8").splitlines():
        match = LEDGER_ROW.match(line)
        if match:
            ledger[match.group(1)] = (match.group(5).strip(), match.group(6).strip() == "Yes")
    data = json.loads(STATUS.read_text(encoding="utf-8"))
    recorded = {task["id"]: task for adr in data["adrs"] for task in adr["tasks"]}
    assert sorted(recorded) == sorted(tasks)
    for task, seen in tasks.items():
        state = seen["implementation"]
        assert state in STATES, f"{task}: unknown implementation state {state!r}"
        assert adr_lines[task] == (state, seen["verified"]), f"{task}: ADR disagrees with checklist"
        assert ledger[task] == (state, seen["verified"]), f"{task}: ledger disagrees with checklist"
        assert recorded[task]["implementation"] == state, f"{task}: JSON disagrees with checklist"
        assert recorded[task]["independently_verified"] == seen["verified"], task
        # A tick means implemented with evidence; it never stands for independent verification.
        if seen["ticked"]:
            assert state == "Implemented", f"{task} is ticked but {state}"
            assert recorded[task]["evidence"], f"{task} is ticked with no evidence in the JSON"
        if seen["verified"]:
            assert recorded[task]["reviewer"] and recorded[task]["review_date"], (
                f"{task} is verified with no named reviewer and date"
            )
    impl = data["implementation_summary"]
    assert impl["Not_started"] == sum(
        1 for t in tasks.values() if t["implementation"] == "Not started"
    )
    assert impl["In_progress"] == sum(
        1 for t in tasks.values() if t["implementation"] == "In progress"
    )
    assert impl["Implemented"] == sum(
        1 for t in tasks.values() if t["implementation"] == "Implemented"
    )
    verified = data["independent_verification_summary"]
    assert verified["Yes"] == sum(1 for t in tasks.values() if t["verified"])
    assert verified["No"] == sum(1 for t in tasks.values() if not t["verified"])


def test_every_lx_adr_names_its_historical_owners_and_real_source_touchpoints():
    """LX-0365-05: the crosswalk names older owners for every LX ADR.

    It names the decisions that own related
    behaviour and the source files it touches. Every named ADR and file exists, so no older owner or
    existing code can be overridden without the crosswalk pointing at it."""
    overlap = (ADR_DIR / "selecta-library-lucy-experience-overlap-and-parity.md").read_text(
        encoding="utf-8"
    )
    rows = {
        int(match.group(1)): (match.group(2), match.group(3))
        for match in re.finditer(
            r"^\| \[ADR-0(\d{3})\]\([^)]+\) \| ([^|]+) \| ([^|]+) \|$", overlap, re.M
        )
    }
    assert sorted(rows) == list(NUMBERS)
    for number, (owners, sources) in rows.items():
        named = re.findall(r"ADR-(\d{4})", owners)
        assert named, f"ADR-0{number} names no historical owner"
        for owner in named:
            assert sorted(ADR_DIR.glob(f"adr-{owner}-*.md")), f"ADR-0{number}: ADR-{owner} missing"
        for path in re.findall(r"`([^`]+)`", sources):
            assert (ROOT / path).exists(), f"ADR-0{number}: {path} does not exist"
