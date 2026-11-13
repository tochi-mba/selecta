"""ADR-0438: interview, incumbent, blind test and pilot tooling, and unit economics."""

from __future__ import annotations

import copy
import itertools
import re
from collections import Counter

import pytest

from selecta.venueops import blind_test, unit_economics
from selecta.venueops.unit_economics import ROOT

DOCS = ROOT / "docs" / "autopilot"


# --- AV-0438-04 unit economics ---------------------------------------------------------------


def test_the_inputs_file_marks_everything_as_assumption_or_unknown():
    inputs = unit_economics.load()
    assert "ASSUMPTIONS TO CONFIRM" in inputs["status"]
    for section, entries in inputs.items():
        if not isinstance(entries, dict):
            continue
        for key, entry in entries.items():
            source = entry["source"].lower()
            assert "assumption" in source or "unknown" in source, f"{section}.{key}"


def test_default_inputs_give_an_honest_incomplete_model():
    result = unit_economics.model(unit_economics.load())
    assert not result.complete
    assert {"licences.music_supply_per_venue_month", "licences.model_licences_per_venue_month",
            "price.per_venue_month"} <= set(result.unknown)
    assert result.lines["compute"] == pytest.approx(180 * 0.15 * 0.05, abs=0.01)
    assert result.lines["licence.music_supply"] is None
    assert result.margin is None
    assert any("not guessed" in note for note in result.notes)


def test_confirmed_inputs_give_a_complete_margin():
    inputs = copy.deepcopy(unit_economics.load())
    for key in inputs["licences"]:
        inputs["licences"][key] = {"value": 10.0, "source": "quote Q-1"}
    inputs["price"]["per_venue_month"] = {"value": 100.0, "source": "decided"}
    result = unit_economics.model(inputs)
    assert result.complete
    assert result.margin == pytest.approx((100 - result.known_cost) / 100, abs=1e-4)
    data = result.as_dict()
    assert data["complete"] and data["gross_margin_on_known_costs"] == result.margin


def test_local_playback_has_no_egress():
    inputs = copy.deepcopy(unit_economics.load())
    inputs["venue"]["streamed_share"]["value"] = 0
    assert unit_economics.model(inputs).lines["egress"] == 0


# --- AV-0438-03 blind test -------------------------------------------------------------------

PLAN = {"selectadj": ["s1", "s2", "s3"], "playlist": ["p1", "p2"], "reference": ["r1"]}


def test_the_plan_is_balanced_and_anonymous():
    sheet, key = blind_test.generate(PLAN, participants=4, repeats=2)
    assert len(sheet) == len(key) == 4 * 2 * 3
    text = str(sheet)
    assert all(c not in text for c in PLAN)  # the listener sheet names no condition
    pairs = Counter(tuple(sorted((k["A"][0], k["B"][0]))) for k in key)
    assert set(pairs.values()) == {8}
    position = Counter(k["A"][0] for k in key)
    shown = Counter(itertools.chain.from_iterable((k["A"][0], k["B"][0]) for k in key))
    for cond in PLAN:
        assert position[cond] * 2 == shown[cond]
    assert len({k["trial"] for k in key}) == len(key)


def test_generation_is_repeatable_and_validates():
    assert blind_test.generate(PLAN, 3) == blind_test.generate(PLAN, 3)
    with pytest.raises(ValueError):
        blind_test.generate({"only": ["x"]}, 3)
    with pytest.raises(ValueError):
        blind_test.generate({"a": ["x"], "b": []}, 3)


def test_scoring_synthetic_responses():
    """Made-up answers to check the arithmetic; these are not participant results."""
    _, key = blind_test.generate({"selectadj": ["s"], "playlist": ["p"]}, 10, repeats=1)
    responses = []
    for row in key:
        a_is_ours = row["A"][0] == "selectadj"
        responses.append({"trial": row["trial"], "prefer": "A" if a_is_ours else "B",
                          "ratings": {"A": {"transition_smoothness": 5 if a_is_ours else 2},
                                      "B": {"transition_smoothness": 2 if a_is_ours else 5}}})
    responses.append({"trial": "ghost", "prefer": "A"})
    result = blind_test.score(key, responses)
    ours = result["conditions"]["selectadj"]
    assert ours["wins"] == 10 and ours["preference_rate"] == 1.0
    assert ours["mean_ratings"]["transition_smoothness"] == 5
    assert result["pairs"][0]["p_value"] == pytest.approx(0.002, abs=1e-3)
    assert result["unknown_trials"] == ["ghost"]


def test_binomial_p_values():
    assert blind_test.binomial_two_sided(5, 10) == 1.0
    assert blind_test.binomial_two_sided(0, 0) == 1.0
    assert blind_test.binomial_two_sided(9, 10) == pytest.approx(0.0215, abs=1e-3)


def test_the_cli_writes_sheet_and_sealed_key(tmp_path):
    plan = tmp_path / "plan.json"
    plan.write_text('{"a": ["1"], "b": ["2"]}', "utf-8")
    assert blind_test.main([str(plan), "--participants", "2", "--out", str(tmp_path)]) == 0
    assert (tmp_path / "participant-sheet.json").is_file()
    assert (tmp_path / "sealed-key.json").is_file()


# --- AV-0438-01, -02, -05 docs ---------------------------------------------------------------


@pytest.mark.parametrize("name", ["operator-interview-guide.md", "incumbent-comparison.md",
                                  "blind-mix-test-protocol.md", "pilot-plan.md"])
def test_market_docs_exist_say_person_step_and_claim_no_results(name):
    text = (DOCS / name).read_text("utf-8")
    assert "—" not in text
    lowered = text.lower()
    assert "person step" in lowered or "to be verified" in lowered
    assert re.search(r"no (interviews|pilot|sessions)|framework and criteria only", lowered)


def test_the_incumbent_comparison_invents_no_prices():
    text = (DOCS / "incumbent-comparison.md").read_text("utf-8")
    assert not re.search(r"[$£€]\s*\d", text)
    assert text.count("to verify") >= 20


def test_the_pilot_plan_requires_rights_and_stop_rules():
    text = (DOCS / "pilot-plan.md").read_text("utf-8")
    assert "ADR-0434" in text and "Stop rules" in text and "emergency Stop" in text
