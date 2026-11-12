"""LX person-step tooling: perf and review manifests, the release gate and the study kit.

Code half of LX-0342-07, LX-0350-01, LX-0350-08, LX-0365-06/07/08, LX-0340-08, LX-0352-08,
LX-0364-03/08 and the nineteen LX study tasks. Nothing here stands for human evidence: every test
proves the tooling refuses incomplete or unsigned records.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from selecta.audit import lx_release_evidence as ev
from selecta.audit import lx_study_kit as kit

ROOT = Path(__file__).resolve().parents[1]
CHECKLIST = (ROOT / ev.CHECKLIST).read_text(encoding="utf-8")


def perf(**over):
    manifest = {
        "date": "2026-11-12",
        "browser": "msedge 130",
        "device": {"name": "Lab desktop A", "unloaded": True},
        "runs": [
            {"songs": s, "input_to_stable_ms": [40, 50, 60, 70, 80, 90, 100]} for s in ev.SIZES
        ],
        "unsolicited_sounds": 0,
    }
    manifest.update(over)
    return manifest


def signed_review():
    shots = [
        {
            "file": f"{r}-{t}-{w}.png",
            "route": r,
            "theme": t,
            "width": w,
            "reviewer": "A. Reviewer",
            "review_date": "2026-11-12",
            "verdict": "pass",
        }
        for r, t, w in sorted(ev.required_shots())
    ]
    return {
        "zoom_400": True,
        "shots": shots,
        "assistive": [{"reader": "NVDA", "reviewer": "B. Reviewer", "date": "2026-11-12"}],
        "devices": [{"device": "Pixel 8", "file": "pixel.png"}],
    }


def test_p75_is_nearest_rank():
    assert ev.p75([10, 20, 30, 40]) == 30
    assert ev.p75([5]) == 5
    with pytest.raises(ValueError):
        ev.p75([])


def test_a_valid_named_unloaded_run_is_a_baseline():
    assert ev.perf_problems(perf()) == []


@pytest.mark.parametrize(
    ("change", "reason"),
    [
        ({"device": {"name": "", "unloaded": True}}, "no name"),
        ({"device": {"name": "unnamed", "unloaded": True}}, "no name"),
        ({"device": {"name": "Lab", "unloaded": False}}, "unloaded"),
        ({"date": ""}, "no date"),
        ({"runs": []}, "no run for 100"),
        ({"unsolicited_sounds": 1}, "nobody asked for"),
        ({"unsolicited_sounds": None}, "not counted"),
    ],
)
def test_lx_0350_01_an_unnamed_loaded_or_partial_run_is_refused(change, reason):
    problems = ev.perf_problems(perf(**change))
    assert any(reason in p for p in problems), problems


def test_lx_0350_01_too_few_samples_is_refused():
    manifest = perf()
    manifest["runs"][2]["input_to_stable_ms"] = [1, 2]
    assert any("20000 songs: 2 samples" in p for p in ev.perf_problems(manifest))


def test_lx_0350_08_budgets_come_from_the_measured_baseline_only():
    budgets = ev.thresholds(perf())
    assert budgets == {100: 108.0, 1000: 108.0, 20000: 108.0}  # p75 90 ms, +20% = 108
    with pytest.raises(ValueError, match="not a baseline"):
        ev.thresholds(perf(device={"name": "", "unloaded": False}))


def test_lx_0342_07_a_later_run_over_budget_is_a_regression():
    budgets = ev.thresholds(perf())
    assert ev.regressions(budgets, perf()) == []
    slow = perf()
    slow["runs"][2]["input_to_stable_ms"] = [200] * 7
    slow["runs"] = slow["runs"][1:]
    found = ev.regressions(budgets, slow)
    assert found[0] == "100 songs: not measured"
    assert "20000 songs: p75 200.0 ms over" in found[1]


def test_lx_0365_06_a_fully_signed_review_passes():
    assert ev.review_problems(signed_review()) == []


def test_lx_0365_06_missing_shots_and_unsigned_shots_are_refused():
    review = signed_review()
    review["shots"] = [s for s in review["shots"] if s["theme"] != "dark"]
    review["shots"][0]["reviewer"] = ""
    review["shots"][1]["verdict"] = "fail"
    review["zoom_400"] = False
    review["assistive"] = []
    review["devices"] = []
    problems = ev.review_problems(review)
    for reason in (
        "no library shot in dark at 320px",
        "no named reviewer",
        "failed it",
        "400% zoom",
        "screen-reader",
        "real-device",
    ):
        assert any(reason in p for p in problems), (reason, problems)


def test_lx_0365_06_the_unsigned_manifest_the_shot_spec_writes_is_refused():
    blank = signed_review()
    for shot in blank["shots"]:
        shot.update(reviewer="", review_date="", verdict="")
    blank["assistive"] = []
    assert len(ev.review_problems(blank)) >= len(blank["shots"])


def decision():
    return {
        "rollback_plan": "Turn the LX flags off and redeploy the previous tag.",
        "owner": {"name": "Owner Person", "signed": "2026-11-12"},
        "independent": {"name": "Other Person", "date": "2026-11-12", "verdict": "GO"},
    }


def test_lx_0365_08_gate_dry_run_goes_only_when_everything_is_met():
    assert ev.gate(decision(), "", perf(), signed_review()) == []


@pytest.mark.parametrize(
    ("edit", "reason"),
    [
        (lambda d: d.update(rollback_plan=""), "no rollback plan"),
        (lambda d: d["owner"].update(signed=""), "owner has not signed"),
        (lambda d: d["independent"].update(name="Owner Person"), "is the owner"),
        (lambda d: d["independent"].update(verdict="NO-GO"), "not GO"),
        (lambda d: d.pop("independent"), "no dated independent reviewer"),
    ],
)
def test_lx_0365_08_gate_refusal_cases(edit, reason):
    made = decision()
    edit(made)
    refusals = ev.gate(made, "", perf(), signed_review())
    assert any(reason in r for r in refusals), refusals


def test_lx_0365_08_gate_refuses_open_p0_and_missing_evidence():
    refusals = ev.gate(decision(), CHECKLIST, None, None)
    assert any("P0 task(s) open" in r for r in refusals)
    assert "no performance manifest" in refusals and "no review manifest" in refusals
    assert ev.gate(decision(), "", perf(unsolicited_sounds=2), signed_review())[0].startswith(
        "performance:"
    )


def test_open_p0_tasks_reads_only_p0_sections():
    text = (
        "## [ADR-0340](a.md) (P0; x)\n- [ ] **LX-0340-01 - a\n- [x] **LX-0340-02 - b\n"
        "## [ADR-0341](b.md) (P1; y)\n- [ ] **LX-0341-01 - c\n"
    )
    assert ev.open_p0_tasks(text) == ["LX-0340-01"]
    assert "LX-0340-08" in ev.open_p0_tasks(CHECKLIST)


def test_the_gate_dry_run_today_refuses_release():
    assert ev.main(["--dry-run"]) == 0
    assert ev.main([]) == 1


STUDY_TASKS = {
    "LX-0341-08",
    "LX-0343-08",
    "LX-0344-08",
    "LX-0345-08",
    "LX-0346-08",
    "LX-0347-08",
    "LX-0348-08",
    "LX-0351-08",
    "LX-0353-08",
    "LX-0354-08",
    "LX-0355-08",
    "LX-0356-08",
    "LX-0357-08",
    "LX-0358-08",
    "LX-0359-08",
    "LX-0360-08",
    "LX-0361-08",
    "LX-0362-08",
    "LX-0363-08",
}


def test_every_lx_study_task_has_exactly_one_protocol_named_in_the_checklist():
    assert set(kit.BY_TASK) == STUDY_TASKS and len(kit.STUDIES) == len(STUDY_TASKS)
    for study in kit.STUDIES:
        assert re.search(rf"\*\*{study.task} - ", CHECKLIST), study.task
        assert study.prompts and study.success and set(study.groups) <= kit.GROUPS


def session(task="LX-0343-08", group="novice", seconds=(30, 40), **over):
    study = kit.BY_TASK.get(task, kit.BY_TASK["LX-0343-08"])
    record = {
        "task": task,
        "facilitator": "F. Person",
        "date": "2026-11-12",
        "participant": "P01",
        "group": group,
        "coached": False,
        "outcomes": [{"success": True, "seconds": s} for s in seconds][: len(study.prompts)],
    }
    record.update(over)
    return record


def test_a_complete_session_record_counts():
    assert kit.record_problems(session()) == []


@pytest.mark.parametrize(
    ("over", "reason"),
    [
        ({"facilitator": ""}, "facilitator"),
        ({"date": "soon"}, "date"),
        ({"participant": "Jane Smith"}, "never a name"),
        ({"coached": True}, "coached"),
        ({"group": "manager"}, "group"),
        ({"outcomes": []}, "outcomes for"),
        ({"task": "LX-0399-08"}, "unknown study"),
    ],
)
def test_incomplete_or_coached_sessions_are_refused(over, reason):
    assert any(reason in p for p in kit.record_problems(session(**over)))


def test_a_timed_study_needs_seconds():
    record = session()
    record["outcomes"][0].pop("seconds")
    assert any("seconds" in p for p in kit.record_problems(record))


def test_scoring_ignores_bad_records_and_compares_with_the_baseline():
    records = [
        session(group="novice", seconds=(30, 40)),
        session(group="expert", participant="P02", seconds=(20, 30)),
        session(group="expert", participant="P03", coached=True),
    ]
    result = kit.score("LX-0343-08", records, baseline_seconds=60)
    assert result["sessions"] == 2 and result["rejected"] == 1
    assert result["enough"] and result["success_rate"] == 1.0
    assert result["median_seconds"] == 30 and result["versus_baseline"] == "faster"
    assert kit.score("LX-0343-08", [], baseline_seconds=60)["enough"] is False
    only_novice = kit.score("LX-0343-08", records[:1])
    assert only_novice["enough"] is False and only_novice["versus_baseline"] is None


def test_the_study_kit_page_is_current():
    assert (ROOT / kit.OUT).read_text(encoding="utf-8") == kit.render()


WP3_CARDS = (
    "LX-0340-01 LX-0340-04 LX-0341-03 LX-0342-06 LX-0343-01 LX-0343-07 LX-0344-04 LX-0345-01 "
    "LX-0346-02 LX-0348-02 LX-0348-06 LX-0349-01 LX-0349-04 LX-0352-03 LX-0353-01 LX-0353-03 "
    "LX-0354-01 LX-0354-03 LX-0357-01 LX-0359-01 LX-0361-04 LX-0362-01 LX-0363-02"
).split()


def test_every_wp3_task_has_one_complete_study_card_with_a_preparation_pilot():
    assert sorted(card.task for card in kit.CARDS) == sorted(WP3_CARDS)
    for card in kit.CARDS:
        assert card.card and card.timed and len(card.prompts) == 1, card.task
        assert card.route.startswith("/") and card.success and card.hesitation, card.task
        assert kit.PILOT_SHA in card.pilot, f"{card.task} has no pilot walkthrough"
        # a pilot is preparation: it never names a participant or claims a study result
        assert not re.search(r"\bP\d{2}\b|participants? (said|found)", card.pilot), card.task
        line = next(row for row in CHECKLIST.splitlines() if f"**{card.task} " in row)
        assert line.startswith("- [ ]") and "Claude part done:" in line, card.task
        assert "Needs a person:" in line, card.task
    assert "SelectaDJ" in kit.CONSENT and "P01" in kit.CONSENT
    assert "—" not in kit.render()


def test_a_study_card_record_needs_consent_confidence_and_hesitation():
    task = "LX-0353-03"
    good = session(task=task, seconds=(4,), consent=True)
    good["outcomes"][0].update(confidence=4, hesitated=False)
    assert kit.record_problems(good) == []
    for key, bad in (("confidence", 7), ("hesitated", "maybe")):
        record = session(task=task, seconds=(4,), consent=True)
        record["outcomes"][0].update(confidence=4, hesitated=False, **{key: bad})
        assert any(key in p for p in kit.record_problems(record))
    unconsented = session(task=task, seconds=(4,))
    unconsented["outcomes"][0].update(confidence=4, hesitated=False)
    assert any("consent" in p for p in kit.record_problems(unconsented))
    assert kit.score(task, [unconsented])["sessions"] == 0
