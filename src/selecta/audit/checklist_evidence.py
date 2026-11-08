"""Reject checked implementation tasks that lack traceable evidence.

The historical T-series checklist stores its evidence in a separate table; newer
checklists generally place evidence on the checkbox line itself. Both formats are
supported, without treating an implementation tick as independent verification.
"""

from __future__ import annotations

import re
from pathlib import Path

CHECKED = re.compile(r"^\s*[-*]\s+\[[xX]\]\s+(?:\*\*)?([A-Z][A-Z0-9]*(?:-\d+)*)(?=\s|\b)")
LEGACY_ROW = re.compile(
    r"^\|\s*(T\d{4})\b[^|]*\|\s*([^|]+)\|\s*([^|]+)\|"
)
INLINE_EVIDENCE = re.compile(r"\bevidence:\s*(.*)", re.IGNORECASE)
AFTER_EVIDENCE = re.compile(
    r";\s*(?:independent\b|owner\s*:|verified\s*:|implementation\s*:)",
    re.IGNORECASE,
)
NO_EVIDENCE = {"", "-", "—", "none", "n/a", "not started", "pending", "tbd", "todo"}


def meaningful_evidence(value: str) -> bool:
    """A bare label, dash or status placeholder is not evidence."""
    cleaned = value.strip().strip("*").strip().rstrip(".").strip()
    return cleaned.casefold() not in NO_EVIDENCE


def legacy_evidence(root: Path) -> dict[str, tuple[str, str]]:
    path = root / "docs/adr/implementation-evidence.md"
    if not path.is_file():
        return {}
    rows: dict[str, tuple[str, str]] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        match = LEGACY_ROW.match(line)
        if match:
            task_id, status, evidence = match.groups()
            rows[task_id] = (status.strip(), evidence.strip())
    return rows


def inline_evidence(line: str) -> str | None:
    match = INLINE_EVIDENCE.search(line)
    if not match:
        return None
    return AFTER_EVIDENCE.split(match.group(1), maxsplit=1)[0].strip().strip("*").strip()


def validate(root: Path) -> list[str]:
    """Return human-readable errors; no write operations or network access."""
    checklists = sorted((root / "docs/adr").glob("*implementation-checklist.md"))
    if not checklists:
        return ["No implementation checklists found in docs/adr"]

    historical = legacy_evidence(root)
    seen: dict[str, str] = {}
    errors: list[str] = []
    for path in checklists:
        for lineno, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            if not re.match(r"^\s*[-*]\s+\[[xX]\]", line):
                continue
            location = f"{path.relative_to(root)}:{lineno}"
            match = CHECKED.match(line)
            if not match:
                errors.append(f"{location}: checked item has no recognizable task ID")
                continue
            task_id = match.group(1)
            if task_id in seen:
                errors.append(f"{location}: duplicate checked task {task_id} (also {seen[task_id]})")
            seen[task_id] = location

            if re.fullmatch(r"T\d{4}", task_id):
                status, evidence = historical.get(task_id, ("", ""))
                if status.casefold() != "done" or not meaningful_evidence(evidence):
                    errors.append(
                        f"{location}: {task_id} needs a Done row with evidence "
                        "in docs/adr/implementation-evidence.md"
                    )
                continue

            evidence = inline_evidence(line)
            if evidence is None or not meaningful_evidence(evidence):
                errors.append(
                    f"{location}: {task_id} is checked without cited implementation "
                    "evidence (add an evidence: reference)"
                )
    return errors


def main() -> int:
    root = Path(__file__).resolve().parents[3]
    errors = validate(root)
    if errors:
        for error in errors:
            print(f"ERROR: {error}")
        print(f"Failed: {len(errors)} checklist evidence error(s).")
        return 1
    print("Checked implementation tasks all have recorded evidence.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
