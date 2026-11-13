"""The gap polish research protocol scripts every person-run GP study and device run sheet.

It is a protocol only: no session result is recorded. The study IDs, cohorts and task cards
must match what src/selecta/audit/gp_study.py will accept, so a sheet filled from the protocol
can be scored."""

from pathlib import Path

from selecta.audit import gp_study

DOC = (Path(__file__).resolve().parents[1] / "docs/research/gp-research-protocol.md").read_text(
    encoding="utf-8"
)
SHEETS = ("GP-0252-08", "GP-0253-08", "GP-0254-05", "GP-0254-08", "GP-0257-04")


def section(task: str) -> str:
    start = DOC.index(f"({task})")
    end = DOC.find("\n## ", start)
    return DOC[start : end if end != -1 else len(DOC)]


def test_every_study_has_its_cards_and_cohorts_in_the_protocol() -> None:
    for task_id, study in gp_study.STUDIES.items():
        text = section(task_id)
        for cohort in study.cohorts:
            assert f"`{cohort}`" in text, (task_id, cohort)
        for card in study.tasks:
            assert f"| {card} |" in text or f"task, {card}" in text, (task_id, card)


def test_every_device_task_has_a_run_sheet_with_reviewer_and_date() -> None:
    for task_id in SHEETS:
        text = section(task_id)
        assert "| Reviewer | Date |" in text, task_id


def test_sheet_columns_and_outcomes_match_the_scorer() -> None:
    assert ", ".join(gp_study.FIELDS) in DOC.replace("\n  ", " ")
    for outcome in gp_study.TASK_OUTCOMES + gp_study.ANSWER_OUTCOMES:
        assert f"`{outcome}`" in DOC


def test_threshold_is_signed_before_any_session_and_no_result_is_claimed() -> None:
    assert "| Study | Signed by | Date |" in DOC
    assert "It is not a result" in DOC
    assert "never pooled" in DOC
    assert "2956bc47fd735339e7216e03d27817fb3a31e92b" in DOC
    assert chr(0x2014) not in DOC
