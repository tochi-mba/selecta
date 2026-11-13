"""Keep all 240 source-level MI states and independent verification distinct."""

from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT / "docs" / "adr"


def read(name: str) -> str:
    return (DOCS / name).read_text(encoding="utf-8")


def statuses() -> dict:
    return json.loads(read("selecta-microinteraction-code-status.json"))


def expected_state(group: dict, number: str) -> str:
    if number in group["implemented"]:
        return "Implemented"
    if number in group["in_progress"]:
        return "In progress"
    return "Not started"


def test_each_mi_has_one_coherent_implementation_and_verification_status():
    data = statuses()
    groups = data["groups"]
    assert len(groups) == 30
    assert re.fullmatch(r"[0-9a-f]{40}", data["implementation_source_head"])

    checklist = read("selecta-microinteraction-implementation-checklist.md")
    ledger = read("selecta-microinteraction-evidence.md")
    checklist_lines = {}
    ledger_lines = {}

    for line in checklist.splitlines():
        match = re.match(r"- \[([ x])\] \*\*(MI-\d{4}-\d{2}) - ", line)
        if match:
            checked, task_id = match.groups()
            assert task_id not in checklist_lines
            checklist_lines[task_id] = (checked == "x", line)

    for line in ledger.splitlines():
        match = re.match(r"\| \[(MI-\d{4}-\d{2})\]\(", line)
        if match:
            task_id = match.group(1)
            assert task_id not in ledger_lines
            ledger_lines[task_id] = line.split("|")

    assert len(checklist_lines) == len(ledger_lines) == 240
    counts = {"Implemented": 0, "In progress": 0, "Not started": 0}

    for adr_number in range(135, 165):
        adr = f"{adr_number:04}"
        group = groups[adr]
        implemented = group["implemented"]
        in_progress = group["in_progress"]
        assert len(set(implemented + in_progress)) == len(implemented + in_progress)
        assert all(re.fullmatch(r"0[1-8]", number) for number in implemented + in_progress)
        assert group["source"]
        assert group["tests"]
        assert all((ROOT / path).is_file() for path in group["source"] + group["tests"])

        not_started = 8 - len(implemented) - len(in_progress)
        count_text = f"{len(implemented)}/8 Implemented, {len(in_progress)}/8 In progress"

        heading = re.search(rf"^## \[ADR-{adr}[^\n]+\n\n([^\n]+)", checklist, flags=re.MULTILINE)
        assert heading, f"missing ADR-{adr} checklist section"
        assert count_text in heading.group(1)

        paths = list(DOCS.glob(f"adr-{adr}-*.md"))
        assert len(paths) == 1
        adr_doc = paths[0].read_text(encoding="utf-8")
        assert (
            f"**Implementation:** {len(implemented)}/8 Implemented, "
            f"{len(in_progress)}/8 In progress, {not_started} Not started"
        ) in adr_doc
        assert "**Independent verification:** No (0/8)." in adr_doc

        for i in range(1, 9):
            number = f"{i:02}"
            task_id = f"MI-{adr}-{number}"
            status = expected_state(group, number)
            counts[status] += 1

            checked, line = checklist_lines[task_id]
            assert checked == (status == "Implemented"), task_id
            assert f"Implementation: {status}; Verified: No;" in line
            assert "owner: Unassigned." in line

            cells = ledger_lines[task_id]
            assert len(cells) == 11
            assert cells[3].strip() == status, task_id
            assert cells[4].strip() == "No"

            adr_entry = next(
                (line for line in adr_doc.splitlines() if f"**{task_id} - " in line),
                None,
            )
            assert adr_entry, task_id
            assert f"Implementation: {status}; Verified: No;" in adr_entry

    assert sum(counts.values()) == 240
    assert counts == {
        "Implemented": 213,
        "In progress": 27,
        "Not started": 0,
    }
    assert len(re.findall(r"^- \[x\] \*\*MI-", checklist, flags=re.MULTILINE)) == 213
    assert "**213/240 source implementation boxes checked" in checklist


def test_release_gate_and_roadmap_do_not_claim_independent_approval():
    release = read("selecta-microinteraction-release-gates.md")
    roadmap = read("selecta-microinteraction-roadmap.md")
    matrix = read("selecta-microinteraction-verification-matrix.md")
    assert "**Current programme verdict: NO-GO" in release
    assert "0 independently Verified" in release
    assert "0/240 Verified" in roadmap
    assert "independently Verified: 0" in matrix
    assert "| **Total** " in roadmap
