"""The MI study kit: sheets, record checks and raw counts for the person-run MI tasks."""

from __future__ import annotations

import copy
import json
import re
from collections import Counter
from pathlib import Path

import pytest

from selecta.audit import mi_study_kit as kit
from selecta.audit.checklist_summary import summarise

ROOT = Path(__file__).resolve().parents[1]
CHECKLIST = ROOT / "docs/adr/selecta-microinteraction-implementation-checklist.md"
SHA = "a" * 40


def filled(task_id: str, participants: int = 4, **overrides) -> dict:
    record, _ = kit.sheet(task_id, participants, overrides.pop("conditions", None))
    record |= {
        "sha": SHA,
        "date": "2026-11-12",
        "facilitator": "Facilitator",
        "environment": "Windows 11, Edge 131, laptop speakers",
    }
    for person in record["participants"]:
        person["consent"] = True
        for values in person["trials"].values():
            for measure in kit.STUDIES[task_id].measures:
                values[measure.name] = {
                    "bool": False,
                    "count": 1,
                    "seconds": 12.5,
                    "rating5": 4,
                    "text": "words",
                    "time": "1:05",
                }.get(measure.kind, measure.choices[0] if measure.choices else None)
            values.update(overrides)
    return record


def test_every_person_step_mi_task_has_a_kit_entry():
    tasks = summarise(CHECKLIST).tasks
    people = {t.task_id for t in tasks if t.needs_person and not t.ticked}
    covered = set(kit.STUDIES) | set(kit.SIGNOFFS) | {kit.REPORT_ID}
    # the three MI-0162 benchmark tasks are measured by web/bench/mi-0162-scale.bench.ts instead
    assert people - covered <= {"MI-0162-04", "MI-0162-05", "MI-0162-08"}
    assert covered <= {t.task_id for t in tasks}


@pytest.mark.parametrize("k", [2, 3, 4, 5])
def test_williams_orders_balance_first_place_and_carry_over(k):
    names = tuple(f"c{i}" for i in range(k))
    rows = kit.williams(names, 2 * k if k % 2 else k)
    assert all(sorted(row) == sorted(names) for row in rows)
    firsts = Counter(row[0] for row in rows)
    assert len(set(firsts.values())) == 1 and len(firsts) == k
    pairs = Counter((a, b) for row in rows for a, b in zip(row, row[1:], strict=False))
    assert len(pairs) == k * (k - 1) and len(set(pairs.values())) == 1


@pytest.mark.parametrize("task_id", sorted(kit.STUDIES))
def test_a_blank_sheet_is_not_evidence_and_a_filled_one_is(task_id):
    conditions = ["s1", "s2", "s3"] if kit.STUDIES[task_id].conditions_from_facilitator else None
    blank, _ = kit.sheet(task_id, 3, conditions)
    problems = kit.check(blank)
    assert any(p.startswith("sha") for p in problems)
    assert any("consent" in p for p in problems)
    assert any("not recorded" in p for p in problems)
    assert kit.check(filled(task_id, conditions=conditions)) == []


def test_records_refuse_names_bad_values_superiority_and_coached_passes():
    record = filled("MI-0150-08")
    record["participants"][0]["code"] = "Alice"
    record["participants"][1]["trials"]["move"]["errors"] = -1
    record["participants"][2]["trials"]["lock"] |= {"coached": True, "success": True}
    record["claims"] = "The new editor is better than the old one."
    problems = "\n".join(kit.check(record))
    assert "never a name" in problems
    assert "errors must be a whole number" in problems
    assert "coached trial cannot count as a success" in problems
    assert "superiority claim" in problems


def test_summary_gives_raw_counts_and_order_effects_without_ranking():
    record = filled("MI-0135-06", participants=6)
    for person in record["participants"]:
        person["trials"][person["order"][0]]["success"] = True
    out = kit.summary(record)
    assert out["participants"] == 6
    assert out["by_position"]["position 1"] == "6/6 success"
    assert out["by_position"]["position 2"] == "0/6 success"
    first_mix = out["conditions"]["first mix"]
    assert first_mix["success"] == "2/6"
    assert first_mix["hesitations"]["total"] == 6
    assert first_mix["confidence"]["spread"]["4"] == 6
    assert first_mix["participant_words"] == ["words"] * 6
    assert "no condition is ranked" in out["limits"]
    assert not kit.SUPERIORITY.search(json.dumps(out))


def test_blind_listening_hides_labels_behind_a_separate_key():
    record, key = kit.sheet("MI-0155-08", 4, ["seam 1", "seam 2", "seam 3"], seed=7)
    assert key and key["blind"]
    for person in record["participants"]:
        assert person["order"] == ["sample 1", "sample 2", "sample 3"]
        assert sorted(key["key"][person["code"]].values()) == ["seam 1", "seam 2", "seam 3"]
    assert "seam 1" not in json.dumps(record["participants"])
    with pytest.raises(ValueError):
        kit.sheet("MI-0151-08", 2)


def test_scene_signoff_needs_owner_reviewers_alternatives_no_go_and_sha():
    record, _ = kit.sheet("MI-0135-08", 0)
    problems = "\n".join(kit.check(record))
    for words in (
        "sha",
        "owner: a named",
        "accessibility_reviewer",
        "audio_reviewer",
        "alternatives needs",
        "no_go needs",
        "evidence is required",
    ):
        assert words in problems
    record |= {
        "sha": SHA,
        "date": "2026-11-12",
        "owner": "Owner",
        "accessibility_reviewer": "A11y",
        "audio_reviewer": "Audio",
    }
    record["scenes"] = [
        {
            "scene": "Listen",
            "owner": "Owner",
            "evidence": "PR #31",
            "alternatives": ["full-bleed art"],
            "no_go": ["beat-synced UI"],
        }
    ]
    assert kit.check(record) == []


def test_accessibility_signoff_needs_numerators_and_failures():
    record, _ = kit.sheet("MI-0161-08", 0)
    record |= {"sha": SHA, "date": "2026-11-12", "lead_reviewer": "Reviewer"}
    record["sessions"] = [
        {
            "reviewer": "R",
            "device": "laptop",
            "browser": "Edge 131",
            "assistive_technology": "NVDA 2024.4",
            "failures": [],
            "passed": 9,
            "total": 10,
        }
    ]
    assert any("need failures" in p for p in kit.check(record))
    record["sessions"][0]["failures"] = ["Studio grid cell name missing the lane"]
    assert kit.check(record) == []


def test_go_no_go_refuses_open_p0_and_undisposed_p1():
    record, _ = kit.sheet("MI-0164-08", 0)
    record |= {
        "sha": SHA,
        "date": "2026-11-12",
        "owner": "Owner",
        "decision": "GO",
        "decision_owners": ["Owner"],
    }
    record["issues"] = [
        {
            "id": "1",
            "severity": "P0",
            "description": "seam gap",
            "disposition": "",
            "disposition_owner": "",
        },
        {
            "id": "2",
            "severity": "P1",
            "description": "focus ring",
            "disposition": "",
            "disposition_owner": "",
        },
    ]
    problems = "\n".join(kit.check(record))
    assert "GO with an open P0" in problems
    assert "every P1 needs a disposition" in problems
    record["issues"][0]["disposition"] = "fixed"
    record["issues"][1] |= {"disposition": "accepted for 1.1", "disposition_owner": "Owner"}
    assert kit.check(record) == []


def test_report_joins_records_at_one_sha_and_refuses_claims():
    a, b = filled("MI-0142-08"), filled("MI-0153-08", participants=5)
    body, problems = kit.report([a, b], SHA, "2026-11-12")
    assert problems == []
    assert body["sample_count"] == 9 and len(body["studies"]) == 2
    b2 = copy.deepcopy(b) | {"sha": "b" * 40}
    _, problems = kit.report([a, b2], SHA, "2026-11-12", claims="Search wins")
    assert any("different SHA" in p for p in problems)
    assert any("superiority" in p for p in problems)


def test_cli_writes_a_sheet_and_a_key_and_checks_it(tmp_path, capsys):
    out = tmp_path / "mi-0151.json"
    assert (
        kit.main(
            ["sheet", "MI-0151-08", "--participants", "2", "--conditions", "x,y", "--out", str(out)]
        )
        == 0
    )
    assert out.with_suffix(".key.json").is_file()
    assert kit.main(["check", str(out)]) == 1
    assert re.search(r"\d+ problems", capsys.readouterr().out)
    done = tmp_path / "done.json"
    done.write_text(json.dumps(filled("MI-0163-08")), encoding="utf-8")
    assert kit.main(["summary", str(done)]) == 0
    assert '"participants": 4' in capsys.readouterr().out
