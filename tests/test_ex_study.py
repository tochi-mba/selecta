"""EX-0118-05 and EX-0133-01: the study tool counterbalances orders and scores only what a
person observed, keeping design hypotheses apart and refusing untrustworthy sessions."""

from collections import Counter

import pytest

from selecta.audit import ex_study


def session(who: str, order: list[str], results: dict[str, bool], **extra) -> dict:
    record = {
        "participant": who,
        "consent": True,
        "coached": False,
        "sha": "abc1234",
        "order": order,
        "tasks": [
            {"condition": c, "task": "pick a mix", "completed": ok, "confident": ok, "notes": []}
            for c, ok in results.items()
        ],
    }
    record.update(extra)
    return record


@pytest.mark.parametrize("conditions", [["a", "b"], ["a", "b", "c"], ["a", "b", "c", "d"]])
def test_every_condition_appears_in_every_position_equally_often(conditions):
    rows = 2 * len(conditions) if len(conditions) % 2 else len(conditions)
    orders = ex_study.balanced_orders(conditions, rows)
    for position in range(len(conditions)):
        counts = Counter(order[position] for order in orders)
        assert set(counts.values()) == {rows // len(conditions)}
    assert all(sorted(order) == sorted(conditions) for order in orders)


def test_orders_refuse_a_single_or_repeated_condition():
    with pytest.raises(ValueError):
        ex_study.balanced_orders(["a"], 4)
    with pytest.raises(ValueError):
        ex_study.balanced_orders(["a", "a"], 4)


def test_counts_are_raw_numerators_and_denominators_with_order_effects():
    sessions = [
        session("P1", ["base", "new"], {"base": False, "new": True}),
        session("P2", ["new", "base"], {"new": True, "base": True}),
    ]
    report = ex_study.score(sessions)
    assert report.success == {"base": [1, 2], "new": [2, 2]}
    assert report.confident == {"base": [1, 2], "new": [2, 2]}
    assert report.by_position == {1: [1, 2], 2: [2, 2]}
    assert "too few participants" in report.verdict("base")


def test_better_than_baseline_is_only_said_with_enough_participants():
    sessions = [
        session(f"P{i}", ["base", "new"], {"base": i % 2 == 0, "new": True})
        for i in range(ex_study.MIN_PARTICIPANTS)
    ]
    verdict = ex_study.score(sessions).verdict("base")
    assert "new: 5/5 succeeded, higher than base 3/5" in verdict


def test_observed_errors_stay_apart_from_design_hypotheses():
    record = session("P1", ["base", "new"], {"base": False})
    record["tasks"][0]["notes"] = [
        {"kind": "observed", "text": "pressed Save draft and looked for the music"},
        {"kind": "hypothesis", "text": "Save draft may look primary"},
    ]
    report = ex_study.score([record])
    assert report.observed == [
        "P1 / base / pick a mix: pressed Save draft and looked for the music"
    ]
    assert report.hypotheses == ["P1 / base / pick a mix: Save draft may look primary"]
    text = ex_study.render(report, "base")
    assert text.index("## Observed") < text.index("pressed Save") < text.index("## Design")


@pytest.mark.parametrize(
    ("change", "reason"),
    [
        ({"participant": ""}, "names no participant"),
        ({"consent": False}, "no recorded consent"),
        ({"coached": True}, "uncoached"),
        ({"sha": ""}, "no exact SHA"),
    ],
)
def test_an_untrustworthy_session_is_rejected_not_counted(change, reason):
    report = ex_study.score([session("P1", ["base", "new"], {"base": True}, **change)])
    assert report.success == {}
    assert reason in report.rejected[0]


def test_a_note_that_is_neither_observed_nor_hypothesis_rejects_the_session():
    record = session("P1", ["base", "new"], {"base": True})
    record["tasks"][0]["notes"] = [{"kind": "finding", "text": "cards are better"}]
    report = ex_study.score([record])
    assert report.success == {} and "neither observed nor hypothesis" in report.rejected[0]


def test_the_template_scores_cleanly_and_the_tool_claims_nothing_by_itself(capsys):
    report = ex_study.score([ex_study.TEMPLATE])
    assert report.rejected == [] and report.success == {"baseline-cards": [1, 1]}
    assert ex_study.main(["orders", "4", "baseline-cards", "new-cards"]) == 0
    assert "P04: new-cards -> baseline-cards" in capsys.readouterr().out
