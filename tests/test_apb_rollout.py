"""ADR-0440: phased order, honest status, flag-off rollback and P0 no-go gates."""

from __future__ import annotations

import re

import pytest
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient

from selecta import flags
from selecta.api import create_app
from selecta.config import Settings
from selecta.venueops import rollout
from selecta.venueops.rollout import GateEvidence, Phase

ROOT = rollout.ROOT


# --- AV-0440-01 dependency order -------------------------------------------------------------


def test_the_roadmap_order_has_no_problems():
    assert rollout.order_problems() == []
    assert rollout.topological(rollout.PHASES) == [1, 2, 3, 4, 5, 6]


def test_the_order_matches_the_roadmap_phases():
    text = (ROOT / "docs/adr/selecta-autopilot-roadmap.md").read_text("utf-8")
    assert "1. **Protect what exists:** ADR-0417 and 0434" in text
    assert rollout.PHASES[0].adrs == (417, 434)
    assert rollout.PHASES[-1].adrs == (440,)


def test_a_cycle_is_caught():
    phases = [Phase(1, "a", tuple(range(417, 441)), (), (2,)), Phase(2, "b", (), (), (1,))]
    assert "circle" in rollout.order_problems(phases)[0]


def test_unknown_flags_missing_adrs_and_backwards_needs_are_caught():
    phases = [
        Phase(1, "early", tuple(range(417, 430)), ("venue.continuity", "venue.nope"), ()),
        Phase(2, "late", tuple(range(430, 440)), ("autopilot.venue_mode",), (1,)),
    ]
    problems = " | ".join(rollout.order_problems(phases))
    assert "venue.nope" in problems
    assert "ADR-0440" in problems
    assert "needs autopilot.venue_mode from later phase 2" in problems


# --- AV-0440-02 honest status ----------------------------------------------------------------


def test_the_real_checklist_is_honest():
    assert rollout.audit_checklist() == []


GOOD = ("- [x] **AV-0440-01 - x.** Implementation: Implemented. Independently verified: No. "
        "Evidence: tests/test_apb_rollout.py (5 passed 2026-11-13).")


@pytest.mark.parametrize(
    ("line", "problem"),
    [
        ("- [x] **AV-0440-01 - x.** Implementation: Implemented. Evidence: None.",
         "ticked without Evidence"),
        ("- [x] **AV-0440-01 - x.** Implementation: Not started. Evidence: a.py.",
         "Not started"),
        ("- [ ] **AV-0440-01 - x.** Independently verified: Yes. Evidence: a.py.",
         "independent reviewer"),
        ("- [ ] **AV-0440-01 - x.** Independently verified: Yes. Independent reviewer: Claude. "
         "Evidence: a.py.", "independent reviewer"),
        ("- [ ] **AV-0440-01 - x.** Verified: Yes. Evidence: a.py.", "independent reviewer"),
    ],
)
def test_dishonest_lines_fail(line, problem):
    found = rollout.honest_status_problems(line)
    assert found and problem in found[0].problem


def test_honest_lines_pass():
    assert rollout.honest_status_problems(GOOD) == []
    named = ("- [x] **AV-0440-02 - x.** Implementation: Implemented. Independently verified: "
             "Yes. Independent reviewer: A. Person. Evidence: a.py.")
    assert rollout.honest_status_problems(named) == []


# --- AV-0440-03 flag-off rollback ------------------------------------------------------------


def _routes(app) -> set[str]:
    return {f"{m} {r.path}" for r in app.routes if isinstance(r, APIRoute) for m in r.methods}


def _plain_gets(app) -> list[str]:
    owners = flags.route_owners()
    rollback = set(rollout.rollback_flags())
    return sorted(
        r.path for r in app.routes
        if isinstance(r, APIRoute) and "GET" in r.methods and r.path.startswith("/api/")
        and "{" not in r.path and owners.get(f"GET {r.path}") not in rollback
        and not any(word in r.path for word in ("stream", "events", "audio", "download"))
    )


def test_the_rollback_set_is_every_venue_and_autopilot_flag():
    ids = rollout.rollback_flags()
    assert "autopilot.venue_mode" in ids and "venue.soak" in ids and "venue.rollout_gates" in ids
    assert all(i.startswith(("venue.", "autopilot.")) for i in ids)
    assert rollout.outside_dependents() == []


def test_turning_every_venue_flag_off_leaves_existing_features_unchanged(tmp_path):
    rollback = set(rollout.rollback_flags())
    states, routes, answers = {}, {}, {}
    for name, spec in (("default", None), ("on", rollout.ENABLE_SPEC),
                       ("off", rollout.ROLLBACK_SPEC)):
        flags.use(spec)
        home = tmp_path / name
        home.mkdir()
        app = create_app(Settings(home), home / "no-web")
        states[name] = {k: v for k, v in flags.snapshot().items() if k not in rollback}
        routes[name] = _routes(app)
        with TestClient(app) as client:
            answers[name] = {p: client.get(p).status_code for p in _plain_gets(app)[:40]}
    flags.use(None)
    assert states["off"] == states["default"] == states["on"]
    assert routes["off"] == routes["default"] == routes["on"]
    assert answers["off"] == answers["default"]
    assert answers["off"], "no existing routes were exercised"


def test_venue_routes_are_refused_when_rolled_back(tmp_path):
    flags.use(rollout.ROLLBACK_SPEC)
    try:
        client = TestClient(create_app(Settings(tmp_path), tmp_path / "no-web"))
        for flag_id in rollout.rollback_flags():
            for route in flags.registry()[flag_id].routes:
                method, template = route.split(" ", 1)
                response = client.request(method, re.sub(r"\{[^}]+\}", "1", template), json={})
                assert response.status_code == 403, route
    finally:
        flags.use(None)


# --- AV-0440-04 P0 gates ---------------------------------------------------------------------


SHA = "a" * 40


def _all_pass(sha=SHA):
    return {g.id: GateEvidence("pass", f"evidence for {g.id}", sha) for g in rollout.GATES}


def test_nothing_proven_is_no_go_with_every_p0_reason():
    decision = rollout.decide({}, release_sha=None)
    assert decision.no_go
    text = " ".join(decision.reasons)
    for gate in rollout.GATES:
        assert gate.title in text
    assert "No exact release SHA" in text


def test_only_complete_matching_evidence_is_eligible_and_never_plain_go():
    decision = rollout.decide(_all_pass(), release_sha=SHA)
    assert decision.verdict == "ELIGIBLE FOR SIGNED GO" and decision.reasons == []
    assert rollout.decide(_all_pass("b" * 40), release_sha=SHA).no_go


@pytest.mark.parametrize("gate", ["no_speaker_overlap", "emergency_stop_accessible",
                                  "licensed_content_and_models", "no_data_leakage"])
def test_any_failed_p0_gate_is_no_go(gate):
    evidence = _all_pass()
    evidence[gate] = GateEvidence("fail", "seen in pilot", SHA)
    decision = rollout.decide(evidence, release_sha=SHA)
    assert decision.no_go and any("P0" in r and "failed" in r for r in decision.reasons)


def test_open_tasks_and_status_problems_block():
    text = (ROOT / "docs/adr/selecta-autopilot-implementation-checklist.md").read_text("utf-8")
    decision = rollout.decide(_all_pass(), release_sha=SHA, open_tasks=rollout.open_tasks(text))
    assert decision.no_go and "Autopilot tasks are not done" in decision.reasons[-1]


def test_simulated_soak_never_satisfies_the_real_audio_gate():
    assert rollout.soak_gate({"mode": "simulated", "night_s": 21600, "passed": True}).status \
        == "missing"
    assert rollout.soak_gate({"mode": "realtime", "night_s": 3600, "passed": True}).status \
        == "fail"
    ok = rollout.soak_gate({"mode": "realtime", "night_s": 21600, "passed": True,
                            "git_sha": SHA})
    assert ok.status == "pass" and ok.sha == SHA


def test_the_cli_reports_no_go(capsys):
    assert rollout.main([]) == 0
    assert "NO-GO" in capsys.readouterr().out


# --- AV-0440-05 record template --------------------------------------------------------------


def test_the_go_no_go_record_template_needs_signatures():
    text = (ROOT / "docs/autopilot/go-no-go-record.md").read_text("utf-8")
    assert "Independent reviewer" in text and "Signature" in text
    for gate in rollout.GATES:
        if gate.p0:
            assert gate.title.split(" ")[-1] in text
