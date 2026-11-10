"""UF-0389-07: the four Unified finish status records must agree, task by task.

The checklist, each ADR file, the evidence ledger and the status JSON all carry a UF task's
implementation and independent-verification status. A task may only move when all four move
together, a checkbox may only be ticked for an Implemented task with cited evidence, and
independent verification needs a named reviewer in the JSON. Read-only: no writes, no network.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

ADR_DIR = "docs/adr"
CHECKLIST = "selecta-unified-finish-implementation-checklist.md"
LEDGER = "selecta-unified-finish-implementation-evidence.md"
STATUS = "selecta-unified-finish-code-status.json"
STATES = ("Not started", "In progress", "Implemented")
TASK = re.compile(r"\*\*(UF-\d{4}-\d{2})\b")
IMPL = re.compile(r"\*\*Implementation:\*\*\s*(Not started|In progress|Implemented)")
VERIFIED = re.compile(r"\*\*Independently Verified:\*\*\s*(Yes|No)")


def _line_status(line: str) -> tuple[str | None, str | None]:
    impl = IMPL.search(line)
    verified = VERIFIED.search(line)
    return (impl.group(1) if impl else None, verified.group(1) if verified else None)


def validate(root: Path) -> list[str]:
    """Return every disagreement between the four UF records (empty when they agree)."""
    adr = root / ADR_DIR
    paths = [adr / CHECKLIST, adr / LEDGER, adr / STATUS]
    missing = [str(path.relative_to(root)) for path in paths if not path.is_file()]
    if missing:
        return [f"missing UF record {name}" for name in missing]
    errors: list[str] = []

    checklist: dict[str, tuple[str | None, str | None, bool, str]] = {}
    for line in (adr / CHECKLIST).read_text(encoding="utf-8").splitlines():
        box = re.match(r"^\s*[-*]\s+\[([ xX])\]\s+", line)
        task = TASK.search(line)
        if box and task:
            impl, verified = _line_status(line)
            checklist[task.group(1)] = (impl, verified, box.group(1) != " ", line)

    adrs: dict[str, tuple[str | None, str | None]] = {}
    for path in sorted(adr.glob("adr-03[6-8][0-9]-*.md")):
        for line in path.read_text(encoding="utf-8").splitlines():
            task = re.match(r"^\d+\.\s+\*\*(UF-\d{4}-\d{2})\b", line)
            if task:
                adrs[task.group(1)] = _line_status(line)

    ledger: dict[str, tuple[str, str]] = {}
    for line in (adr / LEDGER).read_text(encoding="utf-8").splitlines():
        row = re.match(r"^\|\s*(UF-\d{4}-\d{2})\s*\|", line)
        if row:
            cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
            if len(cells) < 5:
                errors.append(f"{row.group(1)}: ledger row has too few columns")
                continue
            ledger[row.group(1)] = (cells[3], cells[4])

    try:
        data = json.loads((adr / STATUS).read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        return [f"{STATUS} is not valid JSON: {error}"]
    tasks = {task["id"]: task for item in data.get("adrs", []) for task in item.get("tasks", [])}

    ids = sorted(set(checklist) | set(adrs) | set(ledger) | set(tasks))
    for task_id in ids:
        where = {
            "checklist": checklist.get(task_id, (None, None))[:2],
            "ADR": adrs.get(task_id, (None, None)),
            "ledger": ledger.get(task_id, (None, None)),
        }
        record = tasks.get(task_id)
        where["JSON"] = (
            (record.get("implementation"), "Yes" if record.get("independently_verified") else "No")
            if record else (None, None)
        )
        for name, (impl, verified) in where.items():
            if impl is None:
                errors.append(f"{task_id}: missing from the {name}")
            elif impl not in STATES:
                errors.append(f"{task_id}: unknown implementation state {impl!r} in the {name}")
        impls = {name: value[0] for name, value in where.items() if value[0] is not None}
        if len(set(impls.values())) > 1:
            errors.append(f"{task_id}: implementation differs: " + ", ".join(f"{k}={v}" for k, v in impls.items()))
        verifieds = {name: value[1] for name, value in where.items() if value[1] is not None}
        if len(set(verifieds.values())) > 1:
            errors.append(f"{task_id}: independent verification differs: " + ", ".join(f"{k}={v}" for k, v in verifieds.items()))
        if task_id in checklist:
            impl, _, ticked, line = checklist[task_id]
            if ticked and impl != "Implemented":
                errors.append(f"{task_id}: ticked in the checklist but implementation is {impl}")
            if ticked and not re.search(r"\*\*Evidence:\*\*\s*\S", line):
                errors.append(f"{task_id}: ticked in the checklist without an Evidence field")
        if record and record.get("independently_verified") and not (record.get("reviewer") and record.get("review_date")):
            errors.append(f"{task_id}: independently verified in JSON without a named reviewer and date")

    summary = data.get("implementation_summary", {})
    counted = {state.replace(" ", "_"): 0 for state in STATES}
    for record in tasks.values():
        key = str(record.get("implementation", "")).replace(" ", "_")
        if key in counted:
            counted[key] += 1
    if summary and summary != counted:
        errors.append(f"implementation_summary {summary} does not match the tasks {counted}")
    return errors


def main() -> int:
    root = Path(__file__).resolve().parents[3]
    errors = validate(root)
    for error in errors:
        print(f"ERROR: {error}")
    print(f"Failed: {len(errors)} UF status disagreement(s)." if errors else "UF status records agree.")
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
