"""Recount every implementation checklist from its own task lines.

Each programme's checklist (`docs/adr/*implementation-checklist.md`) records one task per
checkbox line, and agents keep those lines current. The summary lines at the top of a checklist
used to be edited by hand and went stale. This module counts the task lines and owns one
computed line per checklist, directly under the title:

    **Task status (recounted from the task lines by ...checklist_summary.py`):** 400 tasks: ...

`python src/selecta/audit/checklist_summary.py` prints the counts and exits 1 when any computed
line is missing or disagrees with the lines; `--write` rewrites only those computed lines.
`tests/test_checklist_summary.py` runs the same check, so a header can't go stale silently.

How a line is classified (first rule that applies):

1. Unticked and naming `Superseded by ADR-` anywhere: Superseded.
2. Its status field (`Implementation:`, `Status:` or an S3-style `ID - State.` title) starts with
   a known state: that state. `Partly`, `Specified`, `Not proven` and `Superseded in part` count
   as In progress; `Open` counts as Not started; `Needs a person` is its own state.
3. No recognised state: unticked and naming `Needs a person` is Needs a person; otherwise ticked
   is Implemented and unticked is Not started.

Separately, a line that says `Needs a person` anywhere is counted in "name a person-only step",
and `Verified: Yes` (or `Independently Verified: Yes`) is counted as independently Verified.
Read-only unless `--write` is passed; no network.
"""

from __future__ import annotations

import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

ADR_DIR = Path("docs") / "adr"
STATES = ("Implemented", "In progress", "Not started", "Needs a person", "Superseded")
MARKER = (
    "**Task status (recounted from the task lines by `src/selecta/audit/checklist_summary.py`):**"
)

BOX = re.compile(r"^\s*[-*]\s+\[([ xX])\]\s+(.*)$")
TASK_ID = re.compile(r"\b((?:[A-Z][A-Z0-9]{0,3}-\d{3,4}-\d{2})|(?:[TP]\d{4}))\b")
# Where a line's status is written, most specific first.
STATUS_FIELDS = (
    re.compile(r"\*\*Implementation:\*\*\s*(.*)"),
    re.compile(r"\*\*Implementation:\s*(.*)"),
    re.compile(r"\*\*Status[^*]*:\*\*\s*(?:Implementation:\s*)?(.*)"),
    re.compile(r"(?<![\w*])Implementation:\s*(.*)"),
    re.compile(
        r"^\*\*[A-Z0-9]+-\d{4}-\d{2} - ((?:Implemented|In progress|Not started|Needs a "
        r"person|Superseded)[^*]*)\*\*"
    ),
)
# Leading words of a status field and the state they count as. Order matters.
LEADS = (
    ("superseded in part", "In progress"),
    ("superseded", "Superseded"),
    ("needs a person", "Needs a person"),
    ("not started", "Not started"),
    ("in progress", "In progress"),
    ("implemented", "Implemented"),
    ("partly", "In progress"),
    ("partially", "In progress"),
    ("specified", "In progress"),
    ("not proven", "In progress"),
    ("open", "Not started"),
)
SKIP_LEADS = re.compile(r"^(?:not verified|verified: no|\(?\d{4}-\d{2}-\d{2}\)?)[;:,.]?\s*", re.I)
# Only the line's own Verified field, not prose that mentions the phrase.
VERIFIED_YES = re.compile(r"(?:^|\*\*|; )(?:Independently )?Verified:(?:\*\*)?\s*Yes\b", re.I)
NEEDS_PERSON = re.compile(r"Needs a person", re.I)


@dataclass
class Task:
    task_id: str
    ticked: bool
    state: str
    needs_person: bool
    verified: bool
    line_no: int


@dataclass
class Summary:
    path: Path
    tasks: list[Task] = field(default_factory=list)

    def count(self, state: str) -> int:
        return sum(1 for task in self.tasks if task.state == state)

    @property
    def ticked(self) -> int:
        return sum(1 for task in self.tasks if task.ticked)

    @property
    def needs_person(self) -> int:
        return sum(1 for task in self.tasks if task.needs_person)

    @property
    def verified(self) -> int:
        return sum(1 for task in self.tasks if task.verified)

    def line(self) -> str:
        states = ", ".join(f"{self.count(state)} {state}" for state in STATES)
        return (
            f"{MARKER} {len(self.tasks)} tasks: {states}. {self.needs_person} name a "
            f"person-only step. {self.ticked} ticked. {self.verified} independently Verified."
        )


def classify(text: str, ticked: bool) -> str:
    """Return the state a task line counts as (see the module docstring)."""
    if not ticked and "Superseded by ADR-" in text:
        return "Superseded"
    for pattern in STATUS_FIELDS:
        match = pattern.search(text)
        if not match:
            continue
        value = match.group(1).strip().lstrip("*").strip()
        for _ in range(3):
            stripped = SKIP_LEADS.sub("", value, count=1).lstrip("* ")
            if stripped == value:
                break
            value = stripped
        lower = value.lower()
        for lead, state in LEADS:
            if lower.startswith(lead):
                return state
    if not ticked and NEEDS_PERSON.search(text):
        return "Needs a person"
    return "Implemented" if ticked else "Not started"


def is_task_line(text: str) -> bool:
    head = text[:80]
    return bool(TASK_ID.search(head))


def summarise(path: Path) -> Summary:
    summary = Summary(path)
    for number, raw in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        box = BOX.match(raw)
        if not box or not is_task_line(box.group(2)):
            continue
        text = box.group(2)
        ticked = box.group(1) != " "
        summary.tasks.append(
            Task(
                task_id=TASK_ID.search(text[:80]).group(1),
                ticked=ticked,
                state=classify(text, ticked),
                needs_person=bool(NEEDS_PERSON.search(text)),
                verified=bool(VERIFIED_YES.search(text)),
                line_no=number,
            )
        )
    return summary


def checklists(root: Path) -> list[Path]:
    return sorted((root / ADR_DIR).glob("*implementation-checklist.md"))


README = ADR_DIR / "README.md"
TABLE_START = "<!-- checklist-summary:start (written by checklist_summary.py --write) -->"
TABLE_END = "<!-- checklist-summary:end -->"
# Checklist file -> programme name shown in the README table.
PROGRAMMES = {
    "implementation-checklist.md": "Selecta 2.0 (T)",
    "polish-implementation-checklist.md": "UI/UX polish (P)",
    "selecta-3-implementation-checklist.md": "Selecta 3.0 (S3)",
    "selecta-3-1-implementation-checklist.md": "Selecta 3.1 (S31)",
    "selecta-4-implementation-checklist.md": "Selecta 4.0 (S4)",
    "selecta-experience-implementation-checklist.md": "Experience-first (EX)",
    "selecta-microinteraction-implementation-checklist.md": "Microinteraction (MI)",
    "selecta-creative-interface-implementation-checklist.md": "Creative interface (CI)",
    "selecta-flow-implementation-checklist.md": "Flow (SF)",
    "selecta-gap-polish-implementation-checklist.md": "Gap polish (GP)",
    "selecta-final-polish-implementation-checklist.md": "Final polish (FP)",
    "selecta-measured-micro-polish-implementation-checklist.md": "Measured micro-polish (MP)",
    "selecta-library-lucy-experience-implementation-checklist.md": "Library + Lucy (LX)",
    "selecta-unified-finish-implementation-checklist.md": "Unified finish (UF)",
    "selecta-cloud-implementation-checklist.md": "Selecta Cloud (SC)",
}


def readme_table(root: Path) -> list[str]:
    """The README's current-status table, one row per checklist, in programme order."""
    paths = {path.name: path for path in checklists(root)}
    order = [name for name in PROGRAMMES if name in paths]
    order += sorted(name for name in paths if name not in PROGRAMMES)
    rows = [
        TABLE_START,
        "| Programme | Tasks | Implemented | In progress | Not started | Needs a person "
        "| Superseded | Ticked | Independently Verified |",
        "|---|---:|---:|---:|---:|---:|---:|---:|---:|",
    ]
    for name in order:
        summary = summarise(paths[name])
        cells = [f"[{PROGRAMMES.get(name, name)}]({name})", str(len(summary.tasks))]
        cells += [str(summary.count(state)) for state in STATES]
        cells += [str(summary.ticked), str(summary.verified)]
        rows.append("| " + " | ".join(cells) + " |")
    rows.append(TABLE_END)
    return rows


def _table_span(lines: list[str]) -> tuple[int, int] | None:
    start = next((i for i, ln in enumerate(lines) if ln.strip() == TABLE_START), None)
    end = next((i for i, ln in enumerate(lines) if ln.strip() == TABLE_END), None)
    if start is None or end is None or end < start:
        return None
    return start, end


def check(root: Path) -> list[str]:
    """Return one error per checklist whose computed line is missing or stale."""
    errors: list[str] = []
    readme = root / README
    if readme.is_file():
        lines = readme.read_text(encoding="utf-8").splitlines()
        span = _table_span(lines)
        if span is None:
            errors.append(f"{README.as_posix()}: no computed status table; run with --write")
        elif lines[span[0] : span[1] + 1] != readme_table(root):
            errors.append(f"{README.as_posix()}: stale status table; run with --write")
    for path in checklists(root):
        summary = summarise(path)
        expected = summary.line()
        found = [ln for ln in path.read_text(encoding="utf-8").splitlines() if MARKER in ln]
        name = path.relative_to(root).as_posix()
        if not found:
            errors.append(f"{name}: no computed task-status line; run with --write")
        elif len(found) > 1:
            errors.append(f"{name}: {len(found)} computed task-status lines, expected one")
        elif found[0].strip() != expected:
            errors.append(
                f"{name}: stale task-status line\n  found:    {found[0].strip()}"
                f"\n  expected: {expected}"
            )
    return errors


def write(root: Path) -> list[Path]:
    """Insert or refresh the computed line in every checklist; return the files changed."""
    changed: list[Path] = []
    for path in checklists(root):
        text = path.read_text(encoding="utf-8")
        lines = text.splitlines()
        expected = summarise(path).line()
        index = next((i for i, ln in enumerate(lines) if MARKER in ln), None)
        if index is not None:
            if lines[index] == expected:
                continue
            lines[index] = expected
        else:
            title = next(i for i, ln in enumerate(lines) if ln.startswith("# "))
            lines[title + 1 : title + 1] = ["", expected]
        path.write_text("\n".join(lines) + ("\n" if text.endswith("\n") else ""), "utf-8")
        changed.append(path)
    readme = root / README
    if readme.is_file():
        text = readme.read_text(encoding="utf-8")
        lines = text.splitlines()
        table = readme_table(root)
        span = _table_span(lines)
        if span is None:
            lines[0:0] = [
                "# Current task status of every programme",
                "",
                "Recounted from each checklist's own task lines by "
                "`src/selecta/audit/checklist_summary.py`; `tests/test_checklist_summary.py` "
                "fails when this table is stale. Status lines further down are dated snapshots.",
                "",
                *table,
                "",
                "---",
                "",
            ]
        elif lines[span[0] : span[1] + 1] != table:
            lines[span[0] : span[1] + 1] = table
        else:
            return changed
        readme.write_text("\n".join(lines) + ("\n" if text.endswith("\n") else ""), "utf-8")
        changed.append(readme)
    return changed


def main(argv: list[str]) -> int:
    root = Path(__file__).resolve().parents[3]
    if "--write" in argv:
        for path in write(root):
            print(f"updated {path.relative_to(root).as_posix()}")
    for path in checklists(root):
        print(f"{path.name}: {summarise(path).line().removeprefix(MARKER).strip()}")
    errors = check(root)
    for error in errors:
        print(f"ERROR: {error}")
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
