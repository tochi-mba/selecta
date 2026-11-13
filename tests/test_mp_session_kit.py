"""The MP person-step session kit (src/selecta/audit/mp_session_kit.py) stays whole and honest."""

from __future__ import annotations

import re
from pathlib import Path

from selecta.audit import mp_session_kit as kit_mod
from selecta.audit.checklist_summary import summarise

ROOT = Path(__file__).resolve().parent.parent
CHECKLIST = ROOT / "docs/adr/selecta-measured-micro-polish-implementation-checklist.md"
KEPT_ELSEWHERE = {"MP-0272-08", "MP-0274-08"}
SHA = "0" * 40


def kit() -> dict:
    return kit_mod.load_kit()


def test_every_open_mp_person_task_has_a_session() -> None:
    tasks = summarise(CHECKLIST).tasks
    open_person = {t.task_id for t in tasks if t.needs_person and not t.ticked} - KEPT_ELSEWHERE
    listed = {task["id"] for task in kit()["tasks"]}
    assert open_person - listed == set()
    assert listed <= {t.task_id for t in tasks}


def test_every_precheck_exists_and_every_route_is_inventoried() -> None:
    assert kit_mod.problems(kit(), {"records": []}) == []


def test_study_sessions_give_uncoached_wording() -> None:
    for task in kit()["tasks"]:
        if task["sitting"] == "study":
            assert any('"' in step for step in task["steps"]), task["id"]


def test_the_page_is_up_to_date() -> None:
    assert kit_mod.main(["--check"]) == 0


def test_a_sign_off_needs_a_named_human_a_date_a_full_sha_and_an_outcome() -> None:
    good = {
        "task": "MP-0299-08",
        "person": "A. Reviewer",
        "role": "owner",
        "date": "2026-11-12",
        "commit": SHA,
        "outcome": "GO",
    }
    assert kit_mod.problems(kit(), {"records": [good]}) == []
    for bad in (
        {"person": "Claude"},
        {"person": "Codex agent"},
        {"commit": "abc1234"},
        {"date": "12/11/2026"},
        {"outcome": "maybe"},
        {"task": "MP-0101-01"},
    ):
        assert kit_mod.problems(kit(), {"records": [good | bad]}), bad


def test_the_recorded_sign_offs_are_valid() -> None:
    import json

    signoffs = json.loads(kit_mod.SIGNOFFS.read_text(encoding="utf-8"))
    assert kit_mod.problems(kit(), signoffs) == []


def test_release_sheet_counts_open_p0_and_p1_from_the_register() -> None:
    register = kit_mod.defects()
    by_id = {d.id: d for d in register}
    assert by_id["D-01"].severity == "P0" and not by_id["D-01"].open
    page = kit_mod.render(kit(), {"records": []}, register)
    open_p0 = sum(1 for d in register if d.severity == "P0" and d.open)
    assert f"Open P0 in the register: {open_p0} " in page
    reopened = [kit_mod.Defect("D-99", "P0", "k", "320", "a", "b", "open")]
    assert "Open P0 in the register: 1 (D-99)" in kit_mod.render(kit(), {"records": []}, reopened)


def test_the_regression_gate_covers_its_five_categories_with_real_prechecks() -> None:
    gate_task = next(t for t in kit()["tasks"] if t["id"] == "MP-0298-08")
    files = {file for file, _ in gate_task["prechecks"]}
    assert set(kit_mod.GATE.values()) <= files
    assert len(kit_mod.GATE) == 5


def test_no_em_dashes() -> None:
    for path in (kit_mod.KIT, kit_mod.PAGE, kit_mod.SIGNOFFS):
        assert not re.search("—", path.read_text(encoding="utf-8")), path
