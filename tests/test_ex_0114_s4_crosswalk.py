"""EX-0114-02: the S4/EX crosswalk in selecta-experience-status-reconciliation.md matches the task
lines it summarises, so PR #29's claims stay separated from what each S4 task line records.

Every S4 task carries its own Implementation status and evidence; this keeps the per-ADR row of
the reconciliation table equal to a recount of those lines (state counts and Verified), and the
Experience row equal to a recount of the EX checklist. Owner review of the crosswalk against one
exact SHA is a person's step and is not claimed here."""

import re
from collections import Counter
from pathlib import Path

from selecta.audit.checklist_summary import summarise

ADR = Path(__file__).resolve().parents[1] / "docs/adr"
S4 = ADR / "selecta-4-implementation-checklist.md"
EX = ADR / "selecta-experience-implementation-checklist.md"
RECON = (ADR / "selecta-experience-status-reconciliation.md").read_text(encoding="utf-8")
ROW = re.compile(
    r"^\| (0(?:089|09\d|1[01]\d)) \| [^|]+ \| (\d+) unchecked \| ([^|]+) \| (\d+)/(\d+) \|$"
)
STATES = ("Implemented", "In progress", "Not started", "Superseded")


def recorded_rows() -> dict[str, tuple[int, Counter, int]]:
    rows = {}
    for line in RECON.splitlines():
        match = ROW.match(line.strip())
        if not match:
            continue
        adr, total, states, verified, _ = match.groups()
        counts = Counter()
        for part in re.sub(r"\(.*?\)", "", states).split(","):
            number, _, state = part.strip().partition(" ")
            counts[state] = int(number)
        rows[adr] = (int(total), counts, int(verified))
    return rows


def test_every_s4_task_line_carries_its_own_status():
    tasks = summarise(S4).tasks
    assert len(tasks) == 250
    assert all(task.state in STATES for task in tasks)


def test_each_adr_row_matches_a_recount_of_its_s4_lines():
    rows = recorded_rows()
    assert sorted(rows) == [f"0{n:03d}" for n in range(89, 114)]
    by_adr: dict[str, list] = {}
    for task in summarise(S4).tasks:
        by_adr.setdefault(task.task_id.split("-")[1], []).append(task)
    for adr, (total, counts, verified) in rows.items():
        tasks = by_adr[adr]
        assert total == len(tasks), adr
        assert counts == Counter(task.state for task in tasks), adr
        assert verified == sum(task.verified for task in tasks), adr


def test_programme_rows_match_both_checklists():
    s4, ex = summarise(S4), summarise(EX)
    s4_text = ", ".join(f"{s4.count(s)} {s}" for s in STATES[:3])
    assert f"{s4_text}, {s4.verified} Verified; 250 unchecked" in RECON
    ex_text = ", ".join(f"{ex.count(s)} {s}" for s in STATES)
    assert f"{ex_text}, {ex.verified} Verified" in RECON
