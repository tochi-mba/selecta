"""T0278: every Selecta 2.0 task has a linked implementing PR and evidence, never inferred from
docs.

Checks, with no network access and no writes:

- the evidence ledger names the implementing PR, and every checklist section links its ADR file;
- every T task on the checklist has exactly one ledger row, and the ledger has no unknown task;
- a tick and a Done row always agree, both ways, so completion is never read off a document alone;
- every repository file a Done row cites really exists;
- every Done row cites something concrete (a file, a test, a PR, a commit or a CI run), not
prose only.

The last rule is a ratchet: rows recorded in ``PROSE_ONLY`` are known gaps that may only shrink.
Run ``python src/selecta/audit/t_task_evidence.py`` to print the findings.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path

CHECKLIST = "docs/adr/implementation-checklist.md"
LEDGER = "docs/adr/implementation-evidence.md"
IMPLEMENTING_PR = "https://github.com/tochi-mba/selecta/pull/22"

TASK_LINE = re.compile(r"^- \[([ xX])\] (T\d{4})\b")
LEDGER_ROW = re.compile(r"^\|\s*(T\d{4})\b[^|]*\|\s*([^|]+)\|\s*(.*)\|\s*$")
SECTION = re.compile(r"^### (.+)$")
ADR_LINK = re.compile(r"\[ADR-(\d{4})\]\([^)]*?(adr-\d{4}-[\w-]+\.md)\)")
CODE = re.compile(r"`([^`]+)`")
REPO_PATH = re.compile(
    r"[\w.-]+(?:/[\w.-]+)+\.(?:py|ts|tsx|md|json|yml|yaml|css|toml|html|txt|ps1|sh)"
)
CONCRETE = re.compile(
    r"`[^`]+`"  # a file, test name or command
    r"|\]\(https?://[^)]+\)"  # a linked PR, issue or CI run
    r"|#\d+\b"  # a PR number
    r"|\bruns?/?\s*\d{6,}"  # a CI run id
    r"|\b[0-9a-f]{7,40}\b"  # a commit
)
VALID_STATUS = {"Done", "Partly", "Not done", "Needs a person", "Superseded"}

# Done rows whose "How we know" was prose only when T0278 was audited (2026-11-11). Each needs a
# concrete reference added to its own ledger row by that task's owner; this set may only shrink.
PROSE_ONLY = frozenset(
    {
        "T0019", "T0027", "T0040", "T0049", "T0064",
        "T0134", "T0173", "T0240", "T0259", "T0260",
    }
)


@dataclass
class Findings:
    errors: list[str] = field(default_factory=list)
    prose_only: set[str] = field(default_factory=set)


def _cited_file_exists(root: Path, token: str) -> bool:
    for base in ("", "web/", "web/src/"):
        if (root / base / token).exists():
            return True
    return False


def ledger_rows(root: Path) -> dict[str, tuple[str, str]]:
    rows: dict[str, tuple[str, str]] = {}
    for line in (root / LEDGER).read_text(encoding="utf-8").splitlines():
        match = LEDGER_ROW.match(line)
        if match:
            task, status, evidence = match.groups()
            rows.setdefault(task, (status.strip(), evidence.strip()))
            if rows[task] != (status.strip(), evidence.strip()):
                rows[task] = ("duplicate", "")
    return rows


def audit(root: Path) -> Findings:
    found = Findings()
    checklist = (root / CHECKLIST).read_text(encoding="utf-8").splitlines()
    ledger_text = (root / LEDGER).read_text(encoding="utf-8")
    if IMPLEMENTING_PR not in ledger_text.split("\n## ", 1)[0]:
        found.errors.append(f"{LEDGER} does not name the implementing PR {IMPLEMENTING_PR}")

    ticked: dict[str, bool] = {}
    for number, line in enumerate(checklist, 1):
        section = SECTION.match(line)
        if section and "ADR-" in section.group(1):
            link = ADR_LINK.search(section.group(1))
            if not link or not (root / "docs/adr" / link.group(2)).is_file():
                found.errors.append(f"{CHECKLIST}:{number} section links no existing ADR file")
        task = TASK_LINE.match(line)
        if task:
            if task.group(2) in ticked:
                found.errors.append(f"{CHECKLIST}:{number} {task.group(2)} is listed twice")
            ticked[task.group(2)] = task.group(1) in "xX"

    rows = ledger_rows(root)
    for task in sorted(set(ticked) - set(rows)):
        found.errors.append(f"{task} has no row in {LEDGER}")
    for task in sorted(set(rows) - set(ticked)):
        found.errors.append(f"{LEDGER} has a row for {task}, which is not on the checklist")

    for task, (status, evidence) in sorted(rows.items()):
        if status == "duplicate":
            found.errors.append(f"{task} has two different rows in {LEDGER}")
            continue
        if status not in VALID_STATUS:
            found.errors.append(f"{task} has an unknown status {status!r}")
        if task in ticked and ticked[task] != (status == "Done"):
            state = "ticked" if ticked[task] else "unticked"
            found.errors.append(f"{task} is {state} but its ledger status is {status}")
        if status != "Done":
            continue
        for token in CODE.findall(evidence):
            path = token.split("::")[0].split(" ")[0].rstrip(",.;:")
            if REPO_PATH.fullmatch(path) and not _cited_file_exists(root, path):
                found.errors.append(f"{task} cites {path}, which does not exist")
        if not CONCRETE.search(evidence):
            found.prose_only.add(task)

    for task in sorted(found.prose_only - PROSE_ONLY):
        found.errors.append(
            f"{task} is Done with prose-only evidence; cite a file, test, PR, commit or CI run"
        )
    return found


def main() -> int:
    root = Path(__file__).resolve().parents[3]
    found = audit(root)
    for error in found.errors:
        print(f"ERROR: {error}")
    if found.prose_only:
        print(f"Known prose-only Done rows still to link: {', '.join(sorted(found.prose_only))}")
    if found.errors:
        print(f"Failed: {len(found.errors)} T-task evidence error(s).")
        return 1
    print("Every T task has one ledger row, ticks match Done rows and cited files exist.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
