"""EX-0114-02: the S4/EX crosswalk in selecta-experience-status-reconciliation.md matches the task
lines it summarises, so PR #29's claims stay separated from what each S4 task line records.

Every S4 task carries its own Implementation status and evidence; `selecta.audit.ex_crosswalk`
recounts each ADR row and both programme rows from the lines. When S4 or EX lines change, run
`python -m selecta.audit.ex_crosswalk --write`. Owner review of the crosswalk against one exact
SHA is a person's step and is not claimed here."""

from selecta.audit import ex_crosswalk
from selecta.audit.checklist_summary import summarise


def test_every_s4_task_line_carries_its_own_status():
    tasks = summarise(ex_crosswalk.S4).tasks
    assert len(tasks) == 250
    assert all(task.state in ex_crosswalk.STATES for task in tasks)


def test_the_crosswalk_has_a_row_for_every_s4_adr_and_both_programmes():
    text = ex_crosswalk.RECON.read_text(encoding="utf-8")
    adrs = [match.group(2) for match in ex_crosswalk.ROW.finditer(text)]
    assert adrs == [f"0{n:03d}" for n in range(89, 114)]
    assert ex_crosswalk.S4_PROGRAMME.search(text) and ex_crosswalk.EX_PROGRAMME.search(text)


def test_each_row_matches_a_recount_of_the_task_lines():
    stale = ex_crosswalk.check()
    assert not stale, f"run python -m selecta.audit.ex_crosswalk --write: {stale}"


def test_a_wrong_count_is_caught(monkeypatch, tmp_path):
    text = ex_crosswalk.RECON.read_text(encoding="utf-8")
    first = next(ex_crosswalk.ROW.finditer(text))
    broken = text.replace(
        first.group(0), first.group(0).replace("unchecked |", "unchecked | 9 Implemented,", 1)
    )
    copy = tmp_path / "recon.md"
    copy.write_text(broken, encoding="utf-8")
    monkeypatch.setattr(ex_crosswalk, "RECON", copy)
    assert ex_crosswalk.check()
