"""ADR-0430 staff dashboard and ADR-0439 inventory/parity (AV-0430-01..05, AV-0439-01, -05)."""

from __future__ import annotations

import itertools
import json
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from selecta import flags
from selecta.autopilot.night_session import NightSession, SessionState
from selecta.venueops import dashboard_state as ds
from selecta.venueops import routes_staff
from selecta.venueops.staff_commands import (
    EXPERT_CONTROLS,
    SPECS,
    ApplyAt,
    CommandBook,
    CommandError,
    CommandKind,
    CommandState,
    Horizon,
)

ROOT = Path(__file__).resolve().parents[1]
INVENTORY = ROOT / "docs" / "autopilot" / "critical-tasks.json"
FREE = Horizon(next_seam_id="s1", following_seam_id="s2", has_next=True, genres=("House",))
COMMITTED = Horizon(next_seam_id="s1", next_seam_committed=True, following_seam_id="s2",
                    has_next=True)


def live_session() -> NightSession:
    session = NightSession("n1", "v1")
    session.move(SessionState.WARMING)
    session.move(SessionState.LIVE)
    return session


def book(session: NightSession | None = None) -> CommandBook:
    counter = itertools.count(1)
    ticks = itertools.count(100)
    return CommandBook(session, clock=lambda: float(next(ticks)),
                       new_id=lambda: f"c{next(counter)}")


def test_command_set_is_closed_and_validated():
    assert {k.value for k in CommandKind} == {
        "more_energy", "less_energy", "hold_genre", "skip_next", "extend_current", "pause",
        "emergency_stop", "hand_to_manual",
    }
    assert set(SPECS) == set(CommandKind)
    b = book()
    with pytest.raises(CommandError) as unknown:
        b.submit("play_something_loud", {}, FREE)
    assert unknown.value.code == "unknown_command"
    for kind, params in [
        ("more_energy", {"steps": 5}),
        ("more_energy", {"steps": True}),
        ("hold_genre", {}),
        ("hold_genre", {"genre": ""}),
        ("extend_current", {"seconds": 5}),
        ("skip_next", {"why": "x"}),
    ]:
        with pytest.raises(CommandError):
            b.submit(kind, params, FREE)
    assert b.commands == []  # malformed input is never recorded


def test_steering_is_pending_until_its_seam_then_applied():
    b = book(live_session())
    energy = b.submit("more_energy", {}, FREE)
    assert energy.state is CommandState.PENDING and energy.seam_id == "s1"
    assert energy.apply_at is ApplyAt.NEXT_SEAM
    assert "next blend" in energy.words()
    extend = b.submit("extend_current", {"seconds": 90}, FREE)
    assert extend.apply_at is ApplyAt.CURRENT_OUTRO and extend.params == {"seconds": 90}
    assert [c.id for c in b.seam_reached("s1")] == [energy.id, extend.id]
    assert energy.state is CommandState.APPLIED and energy.resolved_at is not None
    assert b.seam_reached("s1") == []  # a seam reached twice applies nothing twice
    with pytest.raises(CommandError):
        b._finish(energy, CommandState.REJECTED)  # terminal is final


def test_committed_seam_is_never_touched():
    b = book(live_session())
    energy = b.submit("less_energy", {}, COMMITTED)
    assert energy.seam_id == "s2"
    skip = b.submit("skip_next", {}, COMMITTED)
    assert skip.state is CommandState.REJECTED and "already mixing" in skip.reason
    extend = b.submit("extend_current", {}, COMMITTED)
    assert extend.state is CommandState.REJECTED
    assert b.submit("skip_next", {}, Horizon()).state is CommandState.REJECTED
    nothing = b.submit("more_energy", {}, Horizon())
    assert nothing.state is CommandState.REJECTED


def test_newer_command_supersedes_same_group_and_refused_seam_is_reported():
    b = book(live_session())
    first = b.submit("more_energy", {}, FREE)
    second = b.submit("less_energy", {}, FREE)
    assert first.state is CommandState.SUPERSEDED and first.superseded_by == second.id
    genre = b.submit("hold_genre", {"genre": "house"}, FREE)
    assert genre.state is CommandState.PENDING
    assert b.submit("hold_genre", {"genre": "Polka"}, FREE).state is CommandState.REJECTED
    b.seam_refused("s1", "No House song fits here.")
    assert genre.state is CommandState.REJECTED and "fits" in genre.words()


def test_pause_and_manual_apply_now_through_autopilot_takeover():
    session = live_session()
    b = book(session)
    pending = b.submit("more_energy", {}, FREE)
    assert b.submit("pause").state is CommandState.APPLIED
    assert session.state is SessionState.PAUSED
    manual = b.submit("hand_to_manual")
    assert manual.state is CommandState.APPLIED and session.state is SessionState.MANUAL_TAKEOVER
    assert pending.state is CommandState.SUPERSEDED
    refused = b.submit("skip_next", {}, FREE)
    assert refused.state is CommandState.REJECTED and "expert controls" in refused.reason


def test_emergency_stop_rehearsal_is_immediate_and_idempotent():
    session = live_session()
    b = book(session)
    waiting = [b.submit("more_energy", {}, FREE), b.submit("skip_next", {}, FREE)]
    stop = b.submit("emergency_stop")
    assert stop.state is CommandState.APPLIED and stop.apply_at is ApplyAt.NOW
    assert session.state is SessionState.ENDED
    assert all(c.state is CommandState.SUPERSEDED for c in waiting)
    count = len(b.commands)
    assert b.emergency_stop() is stop and b.submit("emergency_stop") is stop
    assert len(b.commands) == count
    after = b.submit("more_energy", {}, FREE)
    assert after.state is CommandState.REJECTED and after.reason == "Autopilot is stopped."
    # Stop also works with no session attached (a screen that only has the local player).
    lone = book()
    assert lone.emergency_stop() is lone.emergency_stop()


def test_dashboard_states_and_navigation():
    inputs = ds.DashboardInputs(
        loaded=True, session_state=SessionState.LIVE,
        now=ds.Track("Song A", "Artist", 80), next=ds.Track("Song B", "Artist"),
        horizon=ds.HorizonSummary(4, 17.6),
    )
    assert ds.build(ds.DashboardInputs()).nav is ds.NavState.LOADING
    live = ds.build(inputs)
    assert live.nav is ds.NavState.LIVE and live.horizon.words() == "4 songs planned, about 18 min."
    assert "emergency_stop" not in live.enabled and live.stop_visible and live.stop_enabled
    offline = ds.build(ds.DashboardInputs(loaded=True, seconds_since_heard=30))
    assert offline.nav is ds.NavState.OFFLINE and offline.enabled == () and offline.stop_enabled
    for session_state, nav in ds.SESSION_NAV.items():
        state = ds.build(ds.DashboardInputs(loaded=True, session_state=session_state))
        assert state.nav is nav and state.stop_visible
        assert state.headline == ds.HEADLINES[nav]
    manual = ds.build(ds.DashboardInputs(loaded=True, session_state=SessionState.MANUAL_TAKEOVER))
    assert not set(manual.enabled) & {k.value for k in CommandKind if k.value != "pause"}
    stopped = ds.build(ds.DashboardInputs(loaded=True, session_state=SessionState.ENDED))
    assert stopped.nav is ds.NavState.STOPPED and not stopped.stop_enabled and stopped.now is None
    with pytest.raises(ValueError):
        ds.Health("panic", "x")


def test_dashboard_separates_pending_from_applied_and_announces():
    session = live_session()
    b = book(session)
    energy = b.submit("more_energy", {}, FREE)
    inputs = ds.DashboardInputs(loaded=True, session_state=session.state)
    state = ds.build(inputs, b).to_dict()
    assert [c["id"] for c in state["pending"]] == [energy.id] and state["applied"] == []
    assert state["announcement"] == "More energy: waiting, changes at the next blend."
    b.seam_reached("s1")
    state = ds.build(inputs, b).to_dict()
    assert state["pending"] == [] and state["applied"][0]["state"] == "applied"
    assert state["announcement"] == "More energy: done."


def test_expert_controls_stay_listed_in_every_state():
    paths = [c.path for c in EXPERT_CONTROLS]
    for session_state in SessionState:
        state = ds.build(ds.DashboardInputs(loaded=True, session_state=session_state)).to_dict()
        assert [c["path"] for c in state["expert_controls"]] == paths
    assert {"/mix/current/edit", "/workshop", "/listen"} <= set(paths)


def test_inventory_matches_expert_controls_and_covers_every_mode():
    data = json.loads(INVENTORY.read_text("utf-8"))
    assert {m["id"] for m in data["modes"]} == {
        "local", "cloud", "room_host", "guest", "venue_staff"
    }
    for mode in data["modes"]:
        assert mode["tasks"], mode["id"]
        for task in mode["tasks"]:
            assert task["id"] and task["task"] and task["keyboard"] and task["min_width_px"] <= 320
    assert [c["path"] for c in data["expert_controls"]] == [c.path for c in EXPERT_CONTROLS]
    router = (ROOT / "web" / "src" / "router.ts").read_text("utf-8")
    for control in data["expert_controls"]:
        assert f"'{control['path']}'" in router, control["path"]


def test_routes_are_flagged_and_shape_commands():
    session = live_session()
    b = book(session)
    nights = {"n1": (b, ds.DashboardInputs(loaded=True, session_state=SessionState.LIVE), FREE)}
    app = FastAPI()
    routes_staff.add_routes(app, nights.get)
    client = TestClient(app)
    try:
        flags.use("")
        assert client.get("/api/venue/staff/n1/dashboard").status_code == 404
        flags.use("+autopilot.venue_mode +venue.staff_dashboard")
        assert client.get("/api/venue/staff/nope/dashboard").status_code == 404
        made = client.post("/api/venue/staff/n1/commands", json={"kind": "more_energy"})
        assert made.status_code == 201 and made.json()["state"] == "pending"
        bad = client.post("/api/venue/staff/n1/commands", json={"kind": "louder!"})
        assert bad.status_code == 422
        first = client.post("/api/venue/staff/n1/stop").json()
        assert client.post("/api/venue/staff/n1/stop").json()["id"] == first["id"]
        assert client.get("/api/venue/staff/n1/dashboard").json()["nav"] == "stopped"
    finally:
        flags.use(None)
