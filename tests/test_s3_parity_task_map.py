"""S3-0047-02: every unverified T and P task is mapped to the S3 decisions that own it.

docs/adr/selecta-3-parity-matrix.md 'Unverified T and P tasks -> S3 decisions' lists each older section
with its unchecked task IDs and S3 ADRs. A task that is still unchecked must appear in the row for its
own section, every S3 link must point at a real S3 ADR (0047 to 0077), and the mapping claims nothing
complete (no checkboxes, no 'Verified').
"""

from __future__ import annotations

import re
from pathlib import Path

ADR = Path(__file__).resolve().parent.parent / "docs" / "adr"
MATRIX = ADR / "selecta-3-parity-matrix.md"
CHECKLISTS = {"T": "implementation-checklist.md", "P": "polish-implementation-checklist.md"}


def _section_key(heading: str) -> str:
    found = re.search(r"ADR-(\d{4})", heading)
    return f"ADR-{found.group(1)}" if found else heading[4:].strip()


def _unchecked(name: str) -> dict[str, list[str]]:
    sections: dict[str, list[str]] = {}
    key = None
    for line in (ADR / name).read_text(encoding="utf-8").splitlines():
        if line.startswith("### "):
            key = _section_key(line)
            sections.setdefault(key, [])
        found = re.match(r"- \[ \] (?:\*\*)?([TP]\d{4})", line)
        if found and key:
            sections[key].append(found.group(1))
    return {key: ids for key, ids in sections.items() if ids}


def _rows() -> list[list[str]]:
    text = MATRIX.read_text(encoding="utf-8")
    block = text.split("## Unverified T and P tasks -> S3 decisions", 1)[1].split("\n## ", 1)[0]
    return [
        [cell.strip() for cell in line.strip().strip("|").split("|")]
        for line in block.splitlines()
        if re.match(r"\| [TP] \|", line)
    ]


def test_every_unchecked_older_task_is_mapped_under_its_own_section():
    rows = _rows()
    assert rows, "the mapping table is missing"
    for programme, checklist in CHECKLISTS.items():
        for key, ids in _unchecked(checklist).items():
            matching = [row for row in rows if row[0] == programme and row[1].startswith(key)]
            assert len(matching) == 1, f"{programme} section {key} has no single row"
            listed = set(re.findall(r"[TP]\d{4}", matching[0][2]))
            missing = sorted(set(ids) - listed)
            assert not missing, f"{key}: unmapped unverified tasks {missing}"


def test_each_task_is_mapped_once_to_real_s3_decisions_and_claims_nothing_complete():
    seen: list[str] = []
    for row in _rows():
        seen += re.findall(r"[TP]\d{4}", row[2])
        links = re.findall(r"\[(\d{4})\]\((adr-\d{4}-[^)]+\.md)\)", row[3])
        assert links, f"{row[1]} maps to no S3 decision"
        for number, target in links:
            assert 47 <= int(number) <= 77, f"{row[1]} maps outside S3: {number}"
            assert target.startswith(f"adr-{number}-") and (ADR / target).exists(), target
    assert len(seen) == len(set(seen)), "a task is mapped in two rows"
    block = MATRIX.read_text(encoding="utf-8").split("## Unverified T and P tasks", 1)[1].split("\n## ", 1)[0]
    assert "[x]" not in block and "Verified" not in block
