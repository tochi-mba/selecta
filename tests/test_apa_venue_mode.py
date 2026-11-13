"""ADR-0424: maturity levels, night session states, staff controls, the venue-mode flag and
truthful availability claims (AV-0424-01 to AV-0424-05)."""

from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from selecta import flags
from selecta.autopilot import availability, takeover
from selecta.autopilot.maturity import (
    HUMAN_CONTROLS,
    LEVELS,
    Action,
    MaturityLevel,
    highest_permitted,
    may,
    missing_for,
)
from selecta.autopilot.night_session import (
    LEGAL,
    LIVE_STATES,
    Actor,
    NightSession,
    SessionError,
    SessionState,
)
from selecta.autopilot.routes_autopilot import install_routes
from selecta.flags import guard as flag_guard

S = SessionState
ROOT = Path(__file__).resolve().parents[1]
NOW = datetime(2026, 11, 12, 20, 0, tzinfo=UTC)


def clock():
    return NOW


# AV-0424-01 ---------------------------------------------------------------------------------


def test_levels_run_l0_to_l4_and_each_adds_to_the_last():
    assert [int(level) for level in LEVELS] == [0, 1, 2, 3, 4]
    previous: frozenset = frozenset()
    for rules in LEVELS.values():
        assert previous <= rules.actions
        previous = rules.actions
    assert LEVELS[MaturityLevel.L0_MANUAL].actions == frozenset()
    assert LEVELS[MaturityLevel.L4_UNATTENDED].staff_present is False


def test_level_rules_permit_only_what_they_list():
    assert not may(0, Action.SUGGEST_NEXT)
    assert may(1, Action.SUGGEST_NEXT) and not may(1, Action.CHOOSE_NEXT)
    assert may(2, Action.CHOOSE_NEXT) and not may(2, Action.REPLAN_HORIZON)
    assert may(3, Action.REPLAN_HORIZON) and not may(3, Action.RUN_WITHOUT_STAFF)
    assert may(4, Action.RUN_WITHOUT_STAFF)
    assert not may(4, "delete_library")


def test_human_controls_are_never_level_actions():
    actions = {a.value for a in Action}
    assert not actions & set(HUMAN_CONTROLS)
    for rules in LEVELS.values():
        assert rules.to_dict()["human_controls"] == list(HUMAN_CONTROLS)


def test_prerequisites_cap_the_highest_level():
    assert highest_permitted(has_policy=False, unattended_consent=False) == 2
    assert highest_permitted(has_policy=True, unattended_consent=False) == 3
    assert highest_permitted(has_policy=True, unattended_consent=True) == 4
    assert missing_for(4, has_policy=False, unattended_consent=False) == [
        "venue_policy", "unattended_consent"]


# AV-0424-02 ---------------------------------------------------------------------------------


def session(level: int = 2, guard=None) -> NightSession:
    return NightSession("n1", "main", level=level, clock=clock, guard=guard)


def test_a_full_evening_follows_legal_moves():
    night = session(3)
    night.move(S.WARMING)
    night.move(S.LIVE, Actor.AUTOPILOT)
    night.move(S.WINDING_DOWN, Actor.AUTOPILOT)
    night.move(S.ENDED, Actor.AUTOPILOT)
    assert [t.to_state for t in night.history] == [S.WARMING, S.LIVE, S.WINDING_DOWN, S.ENDED]
    assert LEGAL[S.ENDED] == frozenset()


@pytest.mark.parametrize("start,to", [(S.SETUP, S.LIVE), (S.ENDED, S.LIVE), (S.FAILED, S.LIVE),
                                      (S.SETUP, S.PAUSED)])
def test_illegal_moves_are_refused(start, to):
    night = session()
    night.state = start
    with pytest.raises(SessionError) as refused:
        night.move(to)
    assert refused.value.code == "illegal_transition"


def test_resume_returns_exactly_to_the_paused_state():
    night = session()
    night.move(S.WARMING)
    night.move(S.PAUSED)
    with pytest.raises(SessionError):
        night.move(S.LIVE)  # paused from warming, so resume can't skip ahead
    night.move(S.WARMING)
    assert night.state is S.WARMING and night.paused_from is None


def test_autopilot_is_limited_by_level_and_never_leaves_pause_or_takeover():
    low = session(1)
    low.move(S.WARMING)
    with pytest.raises(SessionError) as refused:
        low.move(S.LIVE, Actor.AUTOPILOT)
    assert refused.value.code == "autopilot_not_permitted"
    high = session(4)
    high.move(S.WARMING)
    high.move(S.PAUSED)
    with pytest.raises(SessionError):
        high.move(S.WARMING, Actor.AUTOPILOT)
    high.move(S.MANUAL_TAKEOVER)
    with pytest.raises(SessionError):
        high.move(S.LIVE, Actor.AUTOPILOT)


def test_the_system_can_only_mark_a_failure_and_staff_recover_from_it():
    night = session()
    night.move(S.WARMING)
    with pytest.raises(SessionError):
        night.move(S.LIVE, Actor.SYSTEM)
    night.fail("device lost")
    assert night.state is S.FAILED
    assert takeover.take_over(night).state is S.MANUAL_TAKEOVER


# AV-0424-03 ---------------------------------------------------------------------------------


def _at(state: SessionState, guard=None) -> NightSession:
    night = session(4, guard)
    night.state = state
    if state is S.PAUSED:
        night.paused_from = S.LIVE
    return night


def _refuse_everything(night, to):
    raise AssertionError("staff controls must never ask Autopilot's guard")


@pytest.mark.parametrize("state", sorted(LIVE_STATES, key=lambda s: s.value))
@pytest.mark.parametrize("control,expected", [("pause", S.PAUSED), ("stop", S.ENDED),
                                              ("take_over", S.MANUAL_TAKEOVER)])
def test_pause_stop_and_takeover_work_from_every_live_state(state, control, expected):
    night = _at(state, guard=_refuse_everything)
    result = takeover.apply(night, control)
    assert night.state is expected
    assert result.changed is (state is not expected)
    assert control in takeover.available_controls(_at(state))


def test_an_autopilot_guard_that_refuses_cannot_block_staff():
    night = session(4, guard=lambda *_: False)
    night.move(S.WARMING)
    with pytest.raises(SessionError) as refused:
        night.move(S.LIVE, Actor.AUTOPILOT)
    assert refused.value.code == "autopilot_guard_refused"
    takeover.take_over(night)
    takeover.pause(night)
    takeover.resume(night)
    assert night.state is S.MANUAL_TAKEOVER
    takeover.hand_back(night)
    assert night.state is S.LIVE
    takeover.stop(night)
    assert night.state is S.ENDED


def test_stop_works_from_setup_and_failed_and_repeats_harmlessly():
    for start in (S.SETUP, S.FAILED):
        night = _at(start)
        assert takeover.stop(night).changed and night.state is S.ENDED
        assert not takeover.stop(night).changed
    assert takeover.available_controls(_at(S.ENDED)) == []


# AV-0424-04 and routes ----------------------------------------------------------------------


def _app() -> TestClient:
    app = FastAPI()
    flag_guard.install(app, strict=True)
    install_routes(app, scope=lambda: "ws-test", clock=clock)
    return TestClient(app)


def test_venue_mode_is_off_by_default_and_every_route_refuses_while_off():
    registry = flags.registry()
    mode, policy = registry["autopilot.venue_mode"], registry["autopilot.venue_policy"]
    assert mode.default is False and policy.default is False
    assert policy.requires == ("autopilot.venue_mode",)
    assert mode.modes == ("cloud",) and policy.modes == ("cloud",)
    flags.use("")
    client = _app()
    for route in mode.routes + policy.routes:
        method, path = route.split(" ", 1)
        path = path.replace("{session_id}", "night-1").replace("{control}", "pause")
        path = path.replace("{venue_id}", "main").replace("{step}", "venue")
        path = path.replace("{override_id}", "ovr-1")
        answer = client.request(method, path, json={})
        assert answer.status_code == 403, route
        assert answer.json()["code"] == "flag_off"


def test_venue_policy_alone_stays_off_without_venue_mode():
    flags.use("+autopilot.venue_policy")
    assert not flags.on("autopilot.venue_policy")


def test_session_routes_with_the_flag_on():
    flags.use("+autopilot.venue_mode")
    client = _app()
    created = client.post("/api/autopilot/sessions", json={"venue_id": "main", "level": 2})
    assert created.status_code == 201
    body = created.json()
    assert body["state"] == "setup" and body["level_usable"] is False
    sid = body["id"]
    assert client.post(f"/api/autopilot/sessions/{sid}/transitions",
                       json={"to": "warming"}).json()["state"] == "warming"
    paused = client.post(f"/api/autopilot/sessions/{sid}/controls/pause").json()
    assert paused["state"] == "paused" and "resume" in paused["session"]["controls"]
    bad = client.post(f"/api/autopilot/sessions/{sid}/transitions", json={"to": "live"})
    assert bad.status_code == 409 and bad.json()["detail"]["code"] == "illegal_transition"
    refused = client.post("/api/autopilot/sessions", json={"venue_id": "main", "level": 3})
    assert refused.status_code == 409
    assert refused.json()["detail"]["missing"] == ["venue_policy"]


# AV-0424-05 ---------------------------------------------------------------------------------


def test_availability_reports_only_built_capabilities_that_are_on():
    flags.use("")
    off = availability.report(flags.on)
    assert off["available"] == []
    flags.use("+autopilot.venue_mode")
    on = availability.report(flags.on)
    ids = {c["id"] for c in on["available"]}
    assert ids == {"maturity_levels", "night_session", "staff_controls"}
    unbuilt = {c["id"] for c in on["unavailable"] if c["reason"] == "not_built"}
    assert {"autopilot_playback", "unattended_evening"} <= unbuilt
    assert all(not availability.BY_ID[i].built for i in unbuilt)


def test_maturity_route_marks_levels_without_a_runtime_unusable():
    flags.use("+autopilot.venue_mode")
    levels = _app().get("/api/autopilot/maturity").json()["levels"]
    assert [lv["usable"] for lv in levels] == [True, False, False, False, False]


def test_scan_finds_claims_of_unbuilt_capabilities():
    found = availability.scan_copy({"x": "Autopilot plays your set. SelectaDJ runs unattended."})
    assert len(found) == 2


def _user_facing_copy() -> dict[str, str]:
    texts: dict[str, str] = {}
    web = ROOT / "web" / "src"
    for path in list(web.rglob("*.tsx")) + list(web.rglob("*.ts")):
        if ".test." in path.name or "__snapshots__" in path.parts:
            continue
        texts[str(path.relative_to(ROOT))] = path.read_text(encoding="utf-8", errors="ignore")
    for path in (ROOT / "src" / "selecta" / "flags").glob("*.json"):
        data = json.loads(path.read_text(encoding="utf-8"))
        for flag_id, spec in data.get("flags", {}).items():
            texts[f"{path.name}:{flag_id}"] = f"{spec.get('label', '')}. {spec.get('about', '')}"
    return texts


def test_no_user_facing_copy_claims_an_unbuilt_autopilot_capability():
    texts = _user_facing_copy()
    assert any("VenueSetup" in where for where in texts)
    assert availability.scan_copy(texts) == []
