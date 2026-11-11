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
    return text[start : following if following >= 0 else None]


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
        "Surface",
        "Initial / loading",
        "Empty",
        "Partial",
        "Refreshing",
        "Saving",
        "Failed",
        "Offline",
        "Unavailable",
        "Recovery",
    ]
    rows = [
        line
        for line in matrix.splitlines()
        if line.startswith("| ") and not line.startswith(("| Surface", "|---"))
    ]
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


ADR = ROOT / "docs/adr"
P_IDS = {f"P{number:04d}" for number in range(1, 144)}


def table_rows(text: str, first: str) -> list[list[str]]:
    """Cells of the markdown table rows whose first cell matches ``first``."""
    rows = []
    for line in text.splitlines():
        if not line.startswith("| "):
            continue
        cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
        if re.fullmatch(first, cells[0]):
            rows.append(cells)
    return rows


def expand(ids: str) -> set[str]:
    """`P0032-P0034, P0036` -> {P0032, P0033, P0034, P0036}."""
    found: set[str] = set()
    for start, end in re.findall(r"P(\d{4})(?:\s*[-–]\s*P(\d{4}))?", ids):
        found |= {f"P{number:04d}" for number in range(int(start), int(end or start) + 1)}
    return found


def test_p0005_every_open_t_task_and_parity_row_maps_to_real_p_tasks() -> None:
    mapping = read(COMPLETION / "t-to-p-map.md")
    assert "## Counting rule (no double counting)" in mapping
    assert "never ticks the T task" in mapping
    t_rows = table_rows(section(mapping, "## Unfinished T tasks"), r"T\d{4}")
    mapped = [cells[0] for cells in t_rows]
    assert len(mapped) == len(set(mapped)), "a T task is mapped twice"
    open_t = re.findall(r"^- \[ \] (T\d{4})\b", read(ADR / "implementation-checklist.md"), re.M)
    assert open_t, "no open T tasks found"
    assert set(open_t) <= set(mapped), sorted(set(open_t) - set(mapped))
    for cells in t_rows:
        assert len(cells) == 4, cells
        assert cells[2] == "None" or expand(cells[2]) <= P_IDS and expand(cells[2]), cells
        assert cells[3], cells
    parity = read(ADR / "feature-parity.md")
    capabilities = [
        cells[0] for cells in table_rows(parity.split("## Critical invariants")[0], r"[^-].*")
    ][1:]
    assert len(capabilities) >= 18
    rows = {
        cells[0]: cells[1]
        for cells in table_rows(section(mapping, "## Feature-parity rows"), r".+")
    }
    for capability in capabilities:
        assert capability in rows, capability
        assert expand(rows[capability]) and expand(rows[capability]) <= P_IDS, capability


def test_p0007_findings_register_classifies_every_finding() -> None:
    ledger = read(ADR / "polish-implementation-evidence.md")
    register = section(ledger, "## P0007 findings register")
    findings = table_rows(register, r"PF-\d{2}")
    assert len(findings) >= 15
    assert len({cells[0] for cells in findings}) == len(findings)
    severities = {cells[1] for cells in findings}
    assert severities == {"P0", "P1", "P2"}, severities
    for cells in findings:
        assert len(cells) == 8, cells[0]
        ident, _severity, location, finding, impact, check, status, tasks = cells
        for value in (location, finding, impact, status):
            assert value and value != "-", ident
        cited = re.findall(r"`((?:web|tests|docs)/[\w./-]+)`", check)
        assert cited, f"{ident} has no runnable acceptance check"
        assert all((ROOT / path).exists() for path in cited), (ident, cited)
        assert expand(tasks) and expand(tasks) <= P_IDS, ident
        assert re.match(r"(Open|Resolved|Built)", status), ident


def test_p0009_every_task_has_an_evidence_entry_and_ticks_match_it() -> None:
    ledger = read(ADR / "polish-implementation-evidence.md")
    header = ledger.split("## Evidence boundary")[0]
    assert "PR #23" in header and "feat/finish-checklists" in header
    entries: dict[str, str] = {}
    for cells in table_rows(ledger, r"P\d{4}.*"):
        assert len(cells) >= 5, cells[0]
        assert cells[1], f"{cells[0]} has no status"
        for task in expand(cells[0]):
            entries[task] = cells[1]
    assert P_IDS <= set(entries), sorted(P_IDS - set(entries))
    checklist = read(ADR / "polish-implementation-checklist.md")
    lines = re.findall(r"^- \[([ x])\] (P\d{4}) ", checklist, re.M)
    assert {task for _, task in lines} == P_IDS
    for box, task in lines:
        status = entries[task]
        if box == "x":
            assert re.match(r"(Implemented|Verified)", status), (task, status)
        else:
            # an open ledger entry never sits beside a ticked box, and a partial task stays unticked
            assert not status.startswith("Verified (automated)") or "Needs" in status, (
                task,
                status,
            )
