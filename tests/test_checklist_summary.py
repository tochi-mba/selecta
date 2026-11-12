"""Every checklist's computed status line agrees with its own task lines.

See src/selecta/audit/checklist_summary.py. When this fails, a task line moved but the header
did not: run `python src/selecta/audit/checklist_summary.py --write` and commit the result.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from selecta.audit.checklist_summary import MARKER, check, checklists, classify, summarise

ROOT = Path(__file__).resolve().parents[1]


def test_every_checklist_header_matches_its_task_lines():
    errors = check(ROOT)
    assert not errors, "\n".join(errors)


def test_every_checklist_is_counted_and_has_tasks():
    paths = checklists(ROOT)
    assert len(paths) >= 14
    for path in paths:
        summary = summarise(path)
        assert summary.tasks, f"{path.name}: no task lines found"
        ids = [task.task_id for task in summary.tasks]
        assert len(ids) == len(set(ids)), f"{path.name}: a task ID is listed twice"


@pytest.mark.parametrize(
    ("line", "ticked", "state"),
    [
        (
            "**FP-0264-01 - X.** **Implementation:** Implemented; **Verified:** No",
            False,
            "Implemented",
        ),
        (
            "**SF-0198-02 - X.** **Implementation:** Not started; Needs a person: a study",
            False,
            "Not started",
        ),
        (
            "**CI-0165-02 - X.** **Implementation:** Needs a person: design specimens",
            False,
            "Needs a person",
        ),
        ("**MI-0135-01 - X.** **Implementation: In progress; Verified: No", False, "In progress"),
        (
            "**SC-0391-05 - X.** Required verification: Doc. Implementation: Not started.",
            False,
            "Not started",
        ),
        (
            "**S3-0047-03 - Needs a person.** Publish a contract. "
            "**Status:** Needs a person: owner",
            False,
            "Needs a person",
        ),
        (
            "**S31-0078-06 - X.** **Status (2026-11-10):** Not Verified. "
            "**Needs a person:** run it",
            False,
            "Needs a person",
        ),
        (
            "**S31-0078-01 - X.** **Status (2026-11-10):** Implemented (automated), not Verified.",
            False,
            "Implemented",
        ),
        (
            "**EX-0126-05 - X.** **Implementation: Superseded in part; Verified: No",
            False,
            "In progress",
        ),
        (
            "**EX-0134-04 - X.** **Implementation: Not started;** Superseded by ADR-0391: cloud",
            False,
            "Superseded",
        ),
        ("P0004 - X. **Status:** Open: needs a full run", False, "Not started"),
        ("P0019 - X. **Status:** Partly proven: half of it", False, "In progress"),
        ("T0002 - Inventory every existing feature.", True, "Implemented"),
        ("T0001 - Pin the pre-redesign main SHA.", False, "Not started"),
    ],
)
def test_classify_reads_each_programme_format(line, ticked, state):
    assert classify(line, ticked) == state


def test_the_computed_line_names_every_state():
    summary = summarise(checklists(ROOT)[0])
    line = summary.line()
    assert line.startswith(MARKER)
    for word in (
        "Implemented",
        "In progress",
        "Not started",
        "Needs a person",
        "Superseded",
        "ticked",
        "independently Verified",
    ):
        assert word in line
