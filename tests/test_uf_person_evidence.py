"""The code half of the Unified finish person steps (UF-0366-07/08, UF-0367, UF-0388-08, UF-0389).

Each test feeds the checkers made-up records: a complete one must pass, a half-filled, unnamed,
synthetic or late one must be refused. The shipped logs must stay empty, so nothing here is
evidence that a person did anything.
"""

from __future__ import annotations

import json
from pathlib import Path

from selecta.audit import uf_human_logs as logs
from selecta.audit import uf_release_gate as gate
from selecta.audit import uf_research as research

ROOT = Path(__file__).resolve().parents[1]
STATUS = json.loads((ROOT / gate.STATUS).read_text(encoding="utf-8"))


def session(**over) -> dict:
    record = {
        "participant": "P01",
        "cohort": "new-listener",
        "build": "baseline",
        "date": "2026-12-01",
        "sample": {
            "age_band": "25-34",
            "music_app": "Spotify",
            "device": "laptop",
            "input": "mouse",
        },
        "library": "e2e made-up",
        "device_class": "laptop",
        "order": list(research.TASKS),
        "tasks": [
            {
                "task": t,
                "outcome": "Done unaided",
                "errors": [],
                "seconds": 60,
                "confusion": [],
                "confidence": 4,
                "recovered": None,
            }
            for t in research.TASKS
        ],
        "vocabulary": {"analysed": True, "draft": True},
    }
    record.update(over)
    return record


# UF-0367-01 and -03
def test_a_complete_session_record_passes_and_cohorts_are_never_pooled() -> None:
    assert research.record_problems(session()) == []
    editor = session(
        participant="P02",
        cohort="experienced-editor",
        sample={"years": "5", "tools": "Ableton", "device": "laptop", "input": "trackpad"},
    )
    summary = research.cohort_summary([session(), editor], "baseline")
    assert summary["new-listener"]["successes"] == 6
    assert summary["experienced-editor"]["participants"] == 1
    assert summary["assistive-technology"]["attempts"] == 0


def test_a_record_with_a_name_missing_details_or_measures_is_refused() -> None:
    bad = session(participant="Alice", sample={})
    bad["tasks"][0].update(confidence=9, seconds=0, errors=["clicked Play"], recovered=None)
    problems = " ".join(research.record_problems(bad))
    for word in ("never a name", "age_band", "confidence", "seconds", "recovered"):
        assert word in problems


def test_small_samples_report_an_interval_not_a_bare_percentage() -> None:
    low, high = research.wilson(9, 10)
    assert 0.5 < low < 0.9 < high <= 1.0


# UF-0367-04
def test_the_threshold_must_be_signed_before_the_first_candidate_session() -> None:
    records = [session(build="candidate", date="2026-12-05")]
    assert research.threshold_problems(None, records) == ["threshold not signed by a named owner"]
    late = {"signed_by": "Owner Name", "date": "2026-12-06"}
    assert "after the first candidate" in research.threshold_problems(late, records)[0]
    assert research.threshold_problems({"signed_by": "Owner", "date": "2026-12-01"}, records) == []


# UF-0367-05
def test_baseline_and_candidate_must_match_cards_library_device_and_order() -> None:
    base, cand = session(), session(participant="P03", build="candidate")
    assert research.matching_problems([base]) != []
    assert research.matching_problems([base, cand]) == []
    other = session(participant="P04", build="candidate", library="real folder")
    assert research.matching_problems([base, other]) != []


# UF-0367-06
def test_the_vocabulary_exercise_is_counted_per_cohort_and_word() -> None:
    counts = research.vocabulary_summary([session(), session(participant="P05")])
    assert counts["new-listener"]["analysed"] == 2
    assert counts["new-listener"]["rendering"] == 0
    assert set(counts["new-listener"]) == set(research.VOCABULARY)


# UF-0367-08 and UF-0389-04
def test_a_results_report_cannot_overclaim_and_must_give_counts_and_review() -> None:
    records = [session(build="candidate")]
    bad = research.report_problems("The candidate is statistically superior, 30% better.", records)
    assert any("overclaim" in p for p in bad) and any("6 of 6" in p for p in bad)
    good = (
        "New listeners: 6 of 6 tasks done. Sample of one person, so no general claim. "
        "Reviewed by Researcher Name."
    )
    assert research.report_problems(good, records) == []


def test_no_research_session_is_shipped() -> None:
    assert research.load(ROOT / research.SESSIONS) == []


# UF-0388-08, UF-0389-01/02/03/05/06
def full_entry(spec: logs.Log, key: str) -> dict:
    entry = {field: "named" for field in spec.fields}
    entry.update(
        {
            spec.key: key,
            "date": "2026-12-01",
            "reviewer": "Reviewer Name",
            "listener": "Listener Name",
            "sha": "abc1234",
        }
    )
    if spec.passes:
        entry[spec.passing] = spec.passes[0]
    if spec.name == "platform-report":
        entry["routes"] = list(logs.CORE_ROUTES)
    if spec.name == "real-audio":
        entry["source"] = "real audio"
    if spec.name == "visual-signoff":
        entry.update(light_sha256="a" * 64, dark_sha256="b" * 64)
    if spec.name == "benchmarks":
        entry.update(device="Dell XPS 13 9310", budget=500, measured=320)
    return {k: v for k, v in entry.items() if k in spec.fields or k == spec.key}


def test_every_log_accepts_a_complete_set_and_lists_what_is_missing() -> None:
    for name, spec in logs.LOG_SPECS.items():
        keys = spec.required or ("explore",)
        complete = {"entries": [full_entry(spec, key) for key in keys]}
        assert logs.log_status(spec, complete, keys) == [], name
        partial = {"entries": [full_entry(spec, keys[0])]}
        assert len(logs.log_status(spec, partial, keys)) == len(keys) - 1, name


def test_logs_refuse_unnamed_synthetic_unsigned_or_over_budget_rows() -> None:
    audio = logs.LOG_SPECS["real-audio"]
    synthetic = full_entry(audio, "seams") | {"source": "playwright muted run"}
    assert any("never a synthetic" in p for p in logs.entry_problems(audio, synthetic))
    at = logs.LOG_SPECS["at-journeys"]
    assert logs.entry_problems(at, full_entry(at, "lucy") | {"reviewer": "-"})
    bench = logs.LOG_SPECS["benchmarks"]
    slow = full_entry(bench, "editor-40") | {"measured": 900}
    assert logs.log_status(bench, {"entries": [slow]}, ("editor-40",))
    assert logs.entry_problems(bench, full_entry(bench, "editor-40") | {"device": "laptop"})
    visual = logs.LOG_SPECS["visual-signoff"]
    same = full_entry(visual, "listen") | {"dark_sha256": "a" * 64}
    assert any("two different" in p for p in logs.entry_problems(visual, same))
    rejected = full_entry(visual, "listen") | {"verdict": "rejected"}
    assert any("rationale" in p for p in logs.entry_problems(visual, rejected))
    platform = logs.LOG_SPECS["platform-report"]
    assert logs.entry_problems(platform, full_entry(platform, "mobile") | {"routes": ["/"]})


def test_visual_signoff_covers_every_documented_fixture() -> None:
    fixtures = logs.visual_fixtures(ROOT)
    assert {"listen", "editor", "library", "analysis", "export-dialog"} <= set(fixtures)


def test_shipped_logs_are_empty_so_no_person_evidence_is_claimed() -> None:
    for name in logs.LOG_SPECS:
        assert logs.load(ROOT, name)["entries"] == [], name
    assert all(problems for problems in logs.all_status(ROOT).values())


# UF-0366-07
def test_the_proposed_order_puts_correctness_before_polish_and_respects_phases() -> None:
    order = gate.dependency_graph(STATUS)
    assert len(order) == 24 and gate.order_problems(order) == []
    phases = [item["phase_number"] for item in order]
    assert phases == sorted(phases)
    swapped = [order[5], *order[:5], *order[6:]]  # ADR-0369 polish before the P0 foundation
    assert gate.order_problems(swapped)


def test_the_dependency_graph_page_is_current() -> None:
    page = (ROOT / gate.GRAPH).read_text(encoding="utf-8")
    assert page == gate.render_graph(gate.dependency_graph(STATUS))
    assert "not owner-approved" in page and chr(0x2014) not in page


# UF-0366-08
def test_the_charter_needs_a_named_owner_date_rationale_and_reasons() -> None:
    blank = json.loads((ROOT / gate.LOGS / "charter-approval.json").read_text(encoding="utf-8"))
    assert len(gate.charter_problems(blank)) >= 4
    signed = {
        "owner": "Owner Name",
        "date": "2026-12-01",
        "rationale": "Correctness first.",
        "rejected_decisions": [{"decision": "UF-0375 extra motion", "reason": "noise"}],
        "dependency_graph_approved_by": "Owner Name",
    }
    assert gate.charter_problems(signed) == []
    signed["rejected_decisions"] = [{"decision": "x"}]
    assert gate.charter_problems(signed)


# UF-0389-08
def test_the_release_dry_run_is_no_go_today_and_names_why() -> None:
    verdict = json.loads((ROOT / gate.LOGS / "release-verdict.json").read_text(encoding="utf-8"))
    charter = json.loads((ROOT / gate.LOGS / "charter-approval.json").read_text(encoding="utf-8"))
    reasons = " | ".join(gate.gate(ROOT, STATUS, verdict, charter))
    for part in (
        "unresolved P0 task UF-0389-08",
        "open P1 task",
        "rollback",
        "release owner",
        "GO sign-off",
        "charter",
        "person-evidence log",
    ):
        assert part in reasons


def test_the_gate_goes_only_when_everything_is_verified_signed_and_independent(
    tmp_path: Path,
) -> None:
    status = json.loads(json.dumps(STATUS))
    for adr in status["adrs"]:
        for task in adr["tasks"]:
            task["independently_verified"] = adr["priority"] == "P0"
    p1 = gate.unresolved(status, "P1")
    (tmp_path / "rollback.md").write_text("revert", encoding="utf-8")
    (tmp_path / "docs/adr/completion").mkdir(parents=True)
    (tmp_path / "docs/adr/completion/visual-evidence.md").write_text(
        "## Fixtures\n\n| `listen` | x |\n", encoding="utf-8"
    )
    folder = tmp_path / logs.LOGS
    folder.mkdir(parents=True)
    for name, spec in logs.LOG_SPECS.items():
        keys = spec.required or ("listen",)
        entries = [full_entry(spec, key) for key in keys]
        (folder / f"{name}.json").write_text(json.dumps({"entries": entries}), encoding="utf-8")
    charter = {
        "owner": "Owner",
        "date": "2026-12-01",
        "rationale": "ok",
        "rejected_decisions": [],
        "dependency_graph_approved_by": "Owner",
    }
    verdict = {
        "owner": "Owner",
        "rollback": "rollback.md",
        "p1_decisions": [{"task": t, "decision": "defer", "rationale": "later"} for t in p1],
        "go_signoff": {"reviewer": "Someone Else", "date": "2026-12-02", "verdict": "GO"},
    }
    assert gate.gate(tmp_path, status, verdict, charter) == []
    verdict["go_signoff"]["reviewer"] = "Owner"
    assert gate.gate(tmp_path, status, verdict, charter) == [
        "the GO sign-off must come from someone other than the owner"
    ]
