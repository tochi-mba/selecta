"""The owner verification runbook is generated from the checklists and must not drift from them."""

from pathlib import Path

from selecta.audit import owner_runbook as runbook
from selecta.audit.owner_runbook_sittings import OVERRIDES, SITTINGS

ROOT = Path(__file__).resolve().parents[1]
OPEN = (
    "- [ ] **XX-0001-01 - Hear the seam.** **Acceptance:** Smooth. "
    "**Implementation:** Implemented; "
    "Needs a person: a listening check of the seam by ear on the owner's speakers."
)
NVDA = (
    "- [ ] **XX-0001-02 - Read the menu.** **Implementation:** In progress; "
    "Needs a person: an NVDA pass over the menu."
)
TICKED = "- [x] **XX-0001-03 - Done.** Needs a person: was done by the owner."
PLAIN = "- [ ] **XX-0001-04 - Build it.** **Implementation:** Not started."
OLD_STYLE = "- [ ] P0007 - Approve the release. **Status:** Needs a person: owner sign-off."


def _repo(tmp_path: Path, *lines: str) -> Path:
    adr = tmp_path / "docs/adr"
    adr.mkdir(parents=True)
    body = "# Checklist\n\n" + "\n".join(lines) + "\n"
    (adr / "x-implementation-checklist.md").write_text(body, encoding="utf-8")
    (adr / "x-other-notes.md").write_text(NVDA + "\n", encoding="utf-8")
    return tmp_path


def test_only_open_person_tasks_are_collected(tmp_path):
    tasks = runbook.collect(_repo(tmp_path, OPEN, NVDA, TICKED, PLAIN, OLD_STYLE))
    assert [task.task_id for task in tasks] == ["XX-0001-01", "XX-0001-02", "P0007"]
    first = tasks[0]
    assert first.title == "Hear the seam"
    assert first.need.startswith("a listening check of the seam")
    assert first.state == "Implemented"
    assert "**" not in first.need


def test_tasks_land_in_the_right_sitting(tmp_path):
    sittings = {task.task_id: task.sitting for task in runbook.collect(_repo(tmp_path, OPEN, NVDA))}
    assert sittings == {"XX-0001-01": "listening", "XX-0001-02": "screen-reader"}
    assert runbook.classify("ZZ-0001-01", "an owner sign-off") == "sign-off"
    assert runbook.classify("ZZ-0001-02", "user scenarios") != "devices"  # "ios" is a whole word


def test_overrides_point_at_real_sittings():
    slugs = {sitting.slug for sitting in SITTINGS}
    assert set(OVERRIDES.values()) <= slugs
    assert [sitting.number for sitting in SITTINGS] == list(range(1, len(SITTINGS) + 1))
    assert SITTINGS[-1].slug == "sign-off"


def test_every_sitting_has_a_script():
    for sitting in SITTINGS:
        assert sitting.summary and sitting.prepare and sitting.steps, sitting.slug
        assert sitting.passes and sitting.record, sitting.slug


def test_write_then_check_round_trips(tmp_path):
    root = _repo(tmp_path, OPEN, NVDA, OLD_STYLE)
    assert runbook.stale(root)
    runbook.write(root)
    assert runbook.stale(root) == []
    text = (root / "docs/verification/owner-runbook.md").read_text(encoding="utf-8")
    assert "XX-0001-01" in text and "P0007" in text
    tracker = root / "docs/verification/tracker/listening.md"
    assert "| XX-0001-01 | x-implementation-checklist.md |" in tracker.read_text(encoding="utf-8")
    checklist = root / "docs/adr/x-implementation-checklist.md"
    ticked = checklist.read_text(encoding="utf-8").replace("[ ] **XX-0001-01", "[x] **XX-0001-01")
    checklist.write_text(ticked, encoding="utf-8")
    assert "docs/verification/owner-runbook.md" in runbook.stale(root)
    assert runbook.main(["--root", str(root), "--check"]) == 1


def test_every_open_task_appears_once_in_the_runbook():
    tasks = runbook.collect(ROOT)
    ids = [task.task_id for task in tasks]
    assert len(ids) == len(set(ids)), "a task ID appears twice across the checklists"
    files = runbook.expected_files(ROOT)
    trackers = "".join(text for path, text in files.items() if path.parent.name == "tracker")
    for task_id in ids:
        assert f"| {task_id} |" in trackers


def test_generated_runbook_is_current():
    stale = runbook.stale(ROOT)
    assert not stale, f"regenerate with: python -m selecta.audit.owner_runbook --write ({stale})"


def test_no_generated_file_has_an_em_dash():
    for text in runbook.expected_files(ROOT).values():
        assert "—" not in text
