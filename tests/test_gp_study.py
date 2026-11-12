"""The gap polish study scorer: checks result sheets and reports counts without overclaiming."""

import csv

import pytest

from selecta.audit import gp_study as g


def row(participant="P01", cohort="listeners", session="candidate", task="T1", **extra):
    base = {
        "study": "GP-0255-08",
        "participant": participant,
        "cohort": cohort,
        "session": session,
        "task": task,
        "outcome": "done_unaided",
        "seconds": "40",
        "wrong_scope": "0",
        "rating": "",
        "predicted": "",
    }
    base.update(extra)
    return base


def five(cohort="listeners", start=1, **extra):
    return [row(f"P{n:02d}", cohort, **extra) for n in range(start, start + 5)]


def test_every_person_run_gp_study_has_cards_and_cohorts() -> None:
    adrs = (248, 249, 250, 255, 256, 257, 259, 260, 261, 262, 263)
    expected = {f"GP-0{adr}-08" for adr in adrs} | {"GP-0258-01"}
    assert set(g.STUDIES) == expected
    for study in g.STUDIES.values():
        assert study.cohorts and study.tasks


@pytest.mark.parametrize(
    "bad, message",
    [
        ({"participant": "Ann"}, "never a name"),
        ({"cohort": "djs"}, "cohort"),
        ({"task": "Z9"}, "not a card"),
        ({"outcome": "correct"}, "outcome"),
        ({"session": "later"}, "session"),
        ({"rating": "9"}, "out of range"),
        ({"seconds": "soon"}, "number"),
        ({"wrong_scope": "yes"}, "wrong_scope"),
        ({"email": "a@b.c"}, "not allowed"),
    ],
)
def test_a_bad_sheet_is_refused_with_its_reason(bad, message) -> None:
    with pytest.raises(g.SheetError, match=message):
        g.validate([row(**bad)], "GP-0255-08")


def test_a_task_recorded_twice_is_refused() -> None:
    with pytest.raises(g.SheetError, match="twice"):
        g.validate([row(), row()], "GP-0255-08")


def test_rows_for_other_studies_are_left_out() -> None:
    other = row(study="GP-0263-08", cohort="nondevelopers", task="F1")
    assert g.validate([row(), other], "GP-0255-08") == [row()]


def test_cohorts_and_sessions_are_never_pooled() -> None:
    rows = five() + five("creators", 6, outcome="gave_up") + five(session="visit-1")
    cells = {(c.cohort, c.session): c for c in g.summarise(rows, "GP-0255-08")}
    assert set(cells) == {
        ("listeners", "candidate"),
        ("listeners", "visit-1"),
        ("creators", "candidate"),
    }
    assert cells["listeners", "candidate"].successes == 5
    assert cells["creators", "candidate"].successes == 0
    assert cells["listeners", "candidate"].median_seconds == 40


def test_wilson_interval_is_honest_for_small_samples() -> None:
    low, high = g.wilson(9, 10)
    assert 0.55 < low < 0.6 and 0.98 < high <= 1
    assert g.wilson(0, 0) == (0.0, 1.0)


def test_no_conclusion_without_a_signed_threshold_or_enough_people() -> None:
    text = g.report(five(), "GP-0255-08")
    assert "No conclusion: no threshold was signed" in text
    text = g.report(five()[:3], "GP-0255-08", 0.8, "Owner")
    assert "only 3 people" in text
    assert "Met the 80% threshold signed by Owner" in g.report(five(), "GP-0255-08", 0.8, "Owner")


def test_one_wrong_scope_change_means_the_threshold_is_not_met() -> None:
    rows = five()
    rows[0]["wrong_scope"] = "1"
    text = g.report(rows, "GP-0255-08", 0.8, "Owner")
    assert "wrong-scope changes 1" in text and "Not met" in text


def test_predicted_versus_actual_gap_is_reported() -> None:
    rows = [
        row(f"P0{n}", study="GP-0259-08", task="E1", predicted="5", rating="3") for n in range(1, 6)
    ]
    assert "mean predicted-versus-actual gap 2.0" in g.report(rows, "GP-0259-08")


def test_an_empty_sheet_says_there_is_no_result_and_nothing_claims_better() -> None:
    assert "there is no result yet" in g.report([], "GP-0248-08")
    text = g.report(five(), "GP-0255-08", 0.8, "Owner")
    assert "no version is claimed to be better" in text
    assert chr(0x2014) not in text


def test_the_command_line_reads_a_sheet_and_refuses_a_bad_one(tmp_path, capsys) -> None:
    sheet = tmp_path / "results.csv"
    with sheet.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=g.FIELDS)
        writer.writeheader()
        writer.writerows(five())
    assert g.main([str(sheet), "--study", "GP-0255-08"]) == 0
    assert "5 of 5 tasks succeeded" in capsys.readouterr().out
    with sheet.open("a", newline="", encoding="utf-8") as handle:
        csv.DictWriter(handle, fieldnames=g.FIELDS).writerow(row(participant="Bob"))
    assert g.main([str(sheet), "--study", "GP-0255-08"]) == 1
