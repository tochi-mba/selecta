"""T0269: audit every Selecta 2.0 ADR's acceptance criteria against linked CI/QA proof.

For each of ADR-0001 to ADR-0032 this reads the ADR's own acceptance criterion (its "Required tests
and edge cases" list), the checklist tasks that implement it and each task's ledger row, and says
whether every task is proven. The gate: an ADR is Verified only when every one of its tasks is
ticked with a Done row citing concrete proof (see ``t_task_evidence``), never from docs alone.

``python src/selecta/audit/adr_acceptance.py`` checks the gate; ``--write`` regenerates
``docs/adr/selecta-2-acceptance-audit.md`` from the live checklist and ledger.
"""

from __future__ import annotations

import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

from selecta.audit.t_task_evidence import CHECKLIST, CONCRETE, ledger_rows

AUDIT_DOC = "docs/adr/selecta-2-acceptance-audit.md"
FIRST, LAST = 1, 32
SECTION = re.compile(r"^### (.+)$")
ADR_IN_SECTION = re.compile(r"\[ADR-(\d{4})\]")
TASK_LINE = re.compile(r"^- \[([ xX])\] (T\d{4})\b")
STATUS = re.compile(r"^- \*\*Implementation status:\*\* ([A-Za-z ]+?)\s*(?:\(|;|$)", re.MULTILINE)

# The three late sections carry no ADR link; they belong to the testing and release ADRs.
UNLINKED_SECTIONS = {
    "Cross-feature integration scenarios": 30,
    "Full quality and acceptance gates": 29,
    "Controlled release and rollback": 30,
}


@dataclass
class AdrAudit:
    number: int
    file: str
    status: str
    criteria: list[str]
    tasks: list[tuple[str, bool, str, str]] = field(default_factory=list)

    @property
    def proven(self) -> list[str]:
        return [
            task
            for task, ticked, status, evidence in self.tasks
            if ticked and status == "Done" and CONCRETE.search(evidence)
        ]

    @property
    def open(self) -> list[str]:
        return [task for task, *_ in self.tasks if task not in self.proven]

    @property
    def may_be_verified(self) -> bool:
        return bool(self.tasks) and not self.open


def adr_files(root: Path) -> dict[int, Path]:
    found = {}
    for path in sorted((root / "docs/adr").glob("adr-00*.md")):
        number = int(path.name[4:8])
        if FIRST <= number <= LAST:
            found[number] = path
    return found


def criteria(text: str) -> list[str]:
    lines, inside = [], False
    for line in text.splitlines():
        if line.startswith("## "):
            inside = line.startswith("## Required tests")
        elif inside and line.startswith("- "):
            lines.append(line[2:].strip())
    return lines


def collect(root: Path) -> dict[int, AdrAudit]:
    audits = {}
    for number, path in adr_files(root).items():
        text = path.read_text(encoding="utf-8")
        status = STATUS.search(text)
        audits[number] = AdrAudit(
            number, path.name, status.group(1) if status else "unknown", criteria(text)
        )
    rows = ledger_rows(root)
    current: int | None = None
    for line in (root / CHECKLIST).read_text(encoding="utf-8").splitlines():
        heading = SECTION.match(line)
        if heading:
            title = heading.group(1).strip()
            linked = ADR_IN_SECTION.search(title)
            current = int(linked.group(1)) if linked else UNLINKED_SECTIONS.get(title)
            continue
        task = TASK_LINE.match(line)
        if task and current in audits:
            status, evidence = rows.get(task.group(2), ("missing", ""))
            audits[current].tasks.append(
                (task.group(2), task.group(1) in "xX", status, evidence)
            )
    return audits


def gate(audits: dict[int, AdrAudit]) -> list[str]:
    errors = []
    for number in range(FIRST, LAST + 1):
        adr = audits.get(number)
        if adr is None:
            errors.append(f"ADR-{number:04d} has no file in docs/adr")
            continue
        if not adr.criteria:
            errors.append(f"ADR-{number:04d} states no acceptance criteria (Required tests)")
        if not adr.tasks:
            errors.append(f"ADR-{number:04d} has no checklist tasks to prove it")
        if adr.status == "Verified" and not adr.may_be_verified:
            errors.append(
                f"ADR-{number:04d} is marked Verified but lacks linked proof for "
                + ", ".join(adr.open)
            )
    return errors


def render(audits: dict[int, AdrAudit], date: str) -> str:
    out = [
        "# Selecta 2.0: ADR acceptance audit",
        "",
        f"- **Task:** T0269 ([checklist](implementation-checklist.md)); generated {date} by "
        "`src/selecta/audit/adr_acceptance.py --write` from the checklist and "
        "[implementation-evidence.md](implementation-evidence.md).",
        "- **Gate:** `tests/test_adr_acceptance_audit.py` refuses any ADR-0001 to ADR-0032 marked "
        "Verified while a task of its own lacks a ticked Done row citing concrete proof.",
        "- **Rule:** each ADR's acceptance criterion is proven through the tasks that implement "
        "it. The proof for a task is its row in the evidence ledger; a docs-only row never counts.",
        "- **Necessary, not sufficient:** every task proven lets an ADR be reviewed for Verified; "
        "its own browser, accessibility, audio and human checks still decide it.",
        "",
        "| ADR | Status | Proven | Still open | Every task proven |",
        "|---|---|---|---|---|",
    ]
    for adr in audits.values():
        out.append(
            f"| [ADR-{adr.number:04d}]({adr.file}) | {adr.status} | "
            f"{len(adr.proven)} of {len(adr.tasks)} | {', '.join(adr.open) or 'none'} | "
            f"{'yes' if adr.may_be_verified else 'no'} |"
        )
    for adr in audits.values():
        out += ["", f"## [ADR-{adr.number:04d}]({adr.file})", "", "Acceptance criteria:", ""]
        out += [f"- {line}" for line in adr.criteria]
        out += ["", "| Task | Ticked | Ledger status | Proof |", "|---|---|---|---|"]
        for task, ticked, status, evidence in adr.tasks:
            proof = evidence.replace("|", "/") if CONCRETE.search(evidence) else "none linked"
            if status != "Done":
                proof = "open"
            out.append(f"| {task} | {'yes' if ticked else 'no'} | {status} | {proof} |")
    return "\n".join(out) + "\n"


def main(argv: list[str]) -> int:
    root = Path(__file__).resolve().parents[3]
    audits = collect(root)
    if "--write" in argv:
        date = next((arg.split("=", 1)[1] for arg in argv if arg.startswith("--date=")), "")
        (root / AUDIT_DOC).write_text(render(audits, date or "today"), encoding="utf-8")
    errors = gate(audits)
    for error in errors:
        print(f"ERROR: {error}")
    ready = [f"ADR-{a.number:04d}" for a in audits.values() if a.may_be_verified]
    print(f"Every task proven (may be reviewed for Verified): {', '.join(ready) or 'none'}")
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
