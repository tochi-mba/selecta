"""UI/UX polish programme ADR-0033: the baseline, inventory, state register, task scripts and
decision/implementation separation are documented, and every test they cite exists."""

from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
COMPLETION = ROOT / "docs/adr/completion"


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def cited_files(text: str) -> set[str]:
    return set(re.findall(r"`(web/(?:src|e2e)/[\w./-]+\.(?:tsx?|e2e\.ts))`", text))


def section(text: str, heading: str) -> str:
    start = text.index(heading)
    following = text.find("\n## ", start + len(heading))
    return text[start: following if following >= 0 else None]


def test_p0001_baseline_support_boundary_and_kinds_of_evidence() -> None:
    text = read(COMPLETION / "baseline.md")
    assert re.search(r"\| UI/UX polish \| P0001–P0143 \| `fe785ec` \|", text)
    support = section(text, "## Support boundary")
    for row in ("| OS |", "| Browser |", "| Installed app |", "| Devices |"):
        assert row in support, row
    kinds = section(text, "## Kinds of evidence")
    for kind in ("| Source |", "| Rendered capture |", "| Audible |", "| Human judgement |"):
        assert kind in kinds, kind


def test_p0002_inventory_covers_special_entry_states_with_real_tests() -> None:
    text = read(COMPLETION / "route-state-register.md")
    special = section(text, "## Special entry states")
    for state in ("First launch", "Missing route", "Missing draft", "Second tab", "Server away"):
        assert f"| {state}" in special, state
    for heading in ("## Routes and destinations", "## Overlays and always-on surfaces"):
        assert heading in text
    for path in cited_files(special):
        assert (ROOT / path).is_file(), path


def test_p0003_state_matrix_explains_every_state_and_not_applicable_cell() -> None:
    matrix = section(read(COMPLETION / "route-state-register.md"), "## State matrix")
    header = next(line for line in matrix.splitlines() if line.startswith("| Surface |"))
    assert [cell.strip() for cell in header.strip("|").split("|")] == [
        "Surface", "Initial / loading", "Empty", "Partial", "Refreshing", "Saving",
        "Failed", "Offline", "Unavailable", "Recovery",
    ]
    rows = [line for line in matrix.splitlines() if line.startswith("| ") and not line.startswith(("| Surface", "|---"))]
    assert len(rows) >= 11
    for row in rows:
        cells = [cell.strip() for cell in row.strip("|").split("|")]
        assert len(cells) == 10, row
        for cell in cells:
            assert cell not in {"", "-", "n/a"}, f"unexplained cell in {cells[0]}"
    assert '"Populated"' in matrix and '"Success"' in matrix


def test_p0006_task_scripts_for_listener_creator_and_expert_editor() -> None:
    text = read(COMPLETION / "journeys.md")
    for role in ("## Casual listener", "## Mix creator", "## Expert editor"):
        part = section(text, role)
        assert "| Step | Action | Can go wrong | Recovery | Walked by |" in part, role
    assert "selecta-3-baseline.md#task-scripts" in text
    assert "## Task scripts" in read(ROOT / "docs/adr/selecta-3-baseline.md")


def test_p0008_decision_and_implementation_status_are_separate() -> None:
    for number in range(33, 47):
        adr = next((ROOT / "docs/adr").glob(f"adr-00{number}-polish-*.md"))
        text = read(adr)
        assert re.search(r"^- \*\*Decision status:\*\* ", text, re.M), adr.name
        assert re.search(r"^- \*\*Implementation status:\*\* ", text, re.M), adr.name
        assert "| Date | Decision status | Implementation status | Evidence |" in text, adr.name
    checklist = read(ROOT / "docs/adr/polish-implementation-checklist.md")
    assert "owner has now authorized implementation on PR #23" in checklist
