"""SF-0239-01: every Flow task maps to its automated evidence and names its independent gap.

The crosswalk is the Flow checklist plus its evidence ledger. This holds them to it:
- every SF task appears once in the checklist, once in the ledger and once in its own ADR file;
- a ticked task names the files that prove it, and each one exists;
- every task keeps a separate Verified field, so an automated pass never stands in for an
  independent review;
- an open task says what it is waiting on (a person, a browser run, a supersession or the work
  still to do), never a bare "Not started".
"""

from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ADR = ROOT / "docs" / "adr"
CHECKLIST = ADR / "selecta-flow-implementation-checklist.md"
LEDGER = ADR / "selecta-flow-implementation-evidence.md"

TASK = re.compile(r"^- \[( |x)\] \*\*(SF-\d{4}-\d{2}) - ")
FILE = re.compile(r"`((?:web|tests|src|docs|\.github)/[^`\s']+?\.[a-z]{2,4})(?:::[^`]*)?`")


def _tasks() -> dict[str, tuple[bool, str]]:
    tasks: dict[str, tuple[bool, str]] = {}
    for line in CHECKLIST.read_text(encoding="utf-8").splitlines():
        match = TASK.match(line)
        if match:
            assert match.group(2) not in tasks, f"{match.group(2)} appears twice"
            tasks[match.group(2)] = (match.group(1) == "x", line)
    return tasks


def _ledger() -> dict[str, list[str]]:
    rows: dict[str, list[str]] = {}
    for line in LEDGER.read_text(encoding="utf-8").splitlines():
        if line.startswith("| SF-"):
            cells = [cell.strip() for cell in line.strip("|").split("|")]
            assert cells[0] not in rows, f"{cells[0]} has two ledger rows"
            rows[cells[0]] = cells
    return rows


def _field(line: str, name: str) -> str:
    match = re.search(rf"\*\*{name}:\*\* (.*?)(?:; \*\*|\.?$)", line)
    return match.group(1).strip() if match else ""


def test_the_checklist_has_all_four_hundred_flow_tasks() -> None:
    tasks = _tasks()
    assert len(tasks) == 400
    adrs = {task[3:7] for task in tasks}
    assert adrs == {f"{n:04d}" for n in range(198, 248)}


def test_every_task_has_one_ledger_row_and_one_adr_line() -> None:
    tasks, rows = _tasks(), _ledger()
    assert set(rows) == set(tasks)
    for task in tasks:
        adr = task[3:7]
        assert f"[ADR-{adr}](adr-{adr}-" in rows[task][1], f"{task} points at the wrong ADR"
        (path,) = ADR.glob(f"adr-{adr}-*.md")
        assert f"**{task} - " in path.read_text(encoding="utf-8"), f"{task} missing in {path.name}"


def test_every_ticked_task_names_files_that_prove_it_and_they_exist() -> None:
    for task, (ticked, line) in _tasks().items():
        if not ticked:
            continue
        evidence = _field(line, "Evidence")
        assert evidence and evidence != "-", f"{task} is ticked without evidence"
        cited = FILE.findall(evidence)
        assert cited, f"{task} names no file in its evidence"
        for path in cited:
            assert (ROOT / path).exists(), f"{task} cites {path}, which does not exist"


def test_every_task_keeps_the_independent_gap_apart() -> None:
    rows = _ledger()
    for task, (_ticked, line) in _tasks().items():
        assert _field(line, "Verified"), f"{task} has no Verified field"
        assert rows[task][3], f"{task} has no Independently Verified cell in the ledger"


def test_every_open_task_says_what_it_is_waiting_on() -> None:
    bare = [
        task
        for task, (ticked, line) in _tasks().items()
        if not ticked and _field(line, "Implementation") in {"Not started", "In progress", ""}
    ]
    assert not bare, f"open tasks that do not say what they wait on: {bare}"
