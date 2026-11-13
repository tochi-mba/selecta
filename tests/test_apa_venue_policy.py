"""ADR-0425: versioned venue policies, guided setup, hard constraints, override expiry and the
empty licensed catalogue (AV-0425-01 to AV-0425-05)."""

from __future__ import annotations

import dataclasses
from datetime import UTC, datetime, time, timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from selecta import flags
from selecta.autopilot.routes_autopilot import install_routes
from selecta.autopilot.venue_policy import (
    ALL_FILTERED,
    NO_LICENSED_MUSIC,
    READY,
    Daypart,
    HardConstraints,
    Override,
    PolicyDraft,
    PolicyError,
    PolicyStore,
    TrackFacts,
    enforce,
    limits_at,
    select_candidates,
)
from selecta.autopilot.venue_setup import (
    STEP_IDS,
    SetupDraft,
    SetupError,
    next_step,
    save_step,
    to_policy_draft,
)
from selecta.flags import guard as flag_guard

T0 = datetime(2026, 11, 12, 18, 0, tzinfo=UTC)


def draft(**changes) -> PolicyDraft:
    base = PolicyDraft(name="The Lantern", timezone="UTC", licensed_sources=("cloud-library",))
    return dataclasses.replace(base, **changes)


# AV-0425-01 ---------------------------------------------------------------------------------


def test_versions_are_immutable_numbered_and_kept_in_history():
    store = PolicyStore()
    v1 = store.publish("ws", "main", draft(), effective_from=T0, now=T0)
    v2 = store.publish("ws", "main", draft(name="Lantern late"),
                       effective_from=T0 + timedelta(hours=4), now=T0 + timedelta(minutes=5))
    assert (v1.version, v2.version) == (1, 2)
    with pytest.raises(dataclasses.FrozenInstanceError):
        v1.version = 9  # type: ignore[misc]
    assert [p.version for p in store.history("ws", "main")] == [1, 2]
    assert store.effective("ws", "main", T0 + timedelta(hours=1)).version == 1
    assert store.effective("ws", "main", T0 + timedelta(hours=4)).version == 2
    assert store.effective("ws", "main", T0 - timedelta(seconds=1)) is None
    assert store.history("other-ws", "main") == ()


def test_a_newer_version_wins_a_tie_on_effective_from():
    store = PolicyStore()
    store.publish("ws", "main", draft(), effective_from=T0, now=T0)
    store.publish("ws", "main", draft(name="Fixed"), effective_from=T0, now=T0)
    assert store.effective("ws", "main", T0).draft.name == "Fixed"


def test_policy_times_need_a_zone_and_values_are_checked():
    with pytest.raises(PolicyError):
        PolicyStore().publish("ws", "main", draft(), effective_from=T0.replace(tzinfo=None),
                              now=T0)
    with pytest.raises(PolicyError):
        HardConstraints(energy_max=1.5)
    with pytest.raises(PolicyError):
        draft(closing_behaviour="explode")


# AV-0425-02 ---------------------------------------------------------------------------------


def _complete_setup() -> SetupDraft:
    d = SetupDraft("main")
    d = save_step(d, "venue", {"name": "The Lantern", "timezone": "Europe/London"})
    d = save_step(d, "sources", {"licensed_sources": "cloud-library", "confirm_licensed": True})
    d = save_step(d, "content", {"banned_artists": ["Loud Band"]})
    d = save_step(d, "limits", {"bpm_max": 128, "energy_max": "0.8"})
    d = save_step(d, "dayparts", {"dayparts": [
        {"name": "Brunch", "start": "10:00", "end": "14:00", "limits": {"energy_max": 0.4}}]})
    d = save_step(d, "closing", {"closing_behaviour": "fade_out"})
    return save_step(d, "review", {"confirmed": True})


def test_setup_walks_the_steps_in_order_and_builds_a_policy():
    assert STEP_IDS == ("venue", "sources", "content", "limits", "dayparts", "closing", "review")
    d = SetupDraft("main")
    assert next_step(d) == "venue"
    d = save_step(d, "venue", {"name": "The Lantern", "timezone": "Europe/London"})
    assert next_step(d) == "sources"
    policy = to_policy_draft(_complete_setup())
    assert policy.licensed_sources == ("cloud-library",)
    assert policy.constraints.banned_artists == frozenset({"loud band"})
    assert policy.constraints.bpm_max == 128 and policy.constraints.allow_explicit is False
    assert policy.dayparts[0].limits.energy_max == 0.4
    assert policy.closing_behaviour == "fade_out"


def test_setup_says_which_field_is_wrong():
    with pytest.raises(SetupError) as wrong:
        save_step(SetupDraft("main"), "venue", {"name": "", "timezone": "Mars/Base"})
    assert set(wrong.value.errors) == {"name", "timezone"}
    with pytest.raises(SetupError) as unlicensed:
        save_step(SetupDraft("main"), "sources", {"licensed_sources": ["x"]})
    assert "confirm_licensed" in unlicensed.value.errors
    with pytest.raises(SetupError):
        save_step(SetupDraft("main"), "limits", {"bpm_max": 400})


def test_publishing_needs_required_steps_and_a_fresh_review():
    with pytest.raises(SetupError):
        to_policy_draft(SetupDraft("main"))
    changed = save_step(_complete_setup(), "limits", {"bpm_max": 120})
    assert "review" not in changed.saved
    with pytest.raises(SetupError):
        to_policy_draft(changed)


# AV-0425-03 ---------------------------------------------------------------------------------


def track(id_, **facts) -> TrackFacts:
    base = {"artist": "Ok Artist", "genres": ("house",), "bpm": 120.0, "energy": 0.5,
            "explicit": False, "source": "cloud-library", "licensed": True}
    return TrackFacts(id=id_, **(base | facts))


def test_enforce_drops_every_breach_and_says_why():
    limits = HardConstraints(banned_artists=frozenset({"Loud Band"}),
                             banned_genres=frozenset({"Drill"}), bpm_max=125, energy_max=0.7)
    songs = [
        track("ok"),
        track("explicit", explicit=True),
        track("unknown-explicit", explicit=None),
        track("artist", artist="  LOUD band "),
        track("genre", genres=("drill",)),
        track("fast", bpm=140.0),
        track("no-bpm", bpm=None),
        track("hot", energy=0.9),
    ]
    result = enforce(songs, limits)
    assert [t.id for t in result.allowed] == ["ok"]
    reasons = dict(result.rejected)
    assert reasons["explicit"] == ("explicit",)
    assert reasons["unknown-explicit"] == ("explicit_unknown",)
    assert reasons["artist"] == ("banned_artist",)
    assert reasons["genre"] == ("banned_genre",)
    assert reasons["fast"] == ("bpm_over_ceiling",)
    assert reasons["no-bpm"] == ("bpm_unknown",)
    assert reasons["hot"] == ("energy_over_ceiling",)


def test_dayparts_and_volume_cap_tighten_never_loosen():
    brunch = Daypart("Brunch", time(10), time(14), HardConstraints(allow_explicit=True,
                                                                     energy_max=0.4))
    late = Daypart("Late", time(23), time(2), HardConstraints(allow_explicit=True, bpm_max=130))
    policy = PolicyStore().publish("ws", "main", draft(
        constraints=HardConstraints(energy_max=0.8, volume_cap=0.7), dayparts=(brunch, late)),
        effective_from=T0, now=T0)
    at_brunch = limits_at(policy, (), datetime(2026, 11, 13, 11, 0, tzinfo=UTC))
    assert at_brunch.energy_max == 0.4 and at_brunch.allow_explicit is False
    assert limits_at(policy, (), datetime(2026, 11, 13, 1, 0, tzinfo=UTC)).bpm_max == 130
    assert limits_at(policy, (), datetime(2026, 11, 13, 16, 0, tzinfo=UTC)).energy_max == 0.8
    assert at_brunch.cap_volume(1.0) == 0.7 and at_brunch.cap_volume(0.2) == 0.2


# AV-0425-04 ---------------------------------------------------------------------------------


def test_overrides_expire_exactly_on_the_injected_clock():
    policy = PolicyStore().publish("ws", "main", draft(), effective_from=T0, now=T0)
    start = T0 + timedelta(hours=1)
    quiet = Override("o1", "main", start, start + timedelta(minutes=30),
                     HardConstraints(allow_explicit=True, energy_max=0.3))
    assert not quiet.active(start - timedelta(microseconds=1))
    assert quiet.active(start)
    assert quiet.active(start + timedelta(minutes=30) - timedelta(microseconds=1))
    assert not quiet.active(start + timedelta(minutes=30))
    assert limits_at(policy, [quiet], start + timedelta(minutes=10)).energy_max == 0.3
    assert limits_at(policy, [quiet], start + timedelta(minutes=30)).energy_max is None


def test_overrides_are_bounded():
    with pytest.raises(PolicyError):
        Override("o", "main", T0, T0, HardConstraints())
    with pytest.raises(PolicyError):
        Override("o", "main", T0, T0 + timedelta(hours=13), HardConstraints())
    with pytest.raises(PolicyError):
        Override("o", "main", T0.replace(tzinfo=None), T0 + timedelta(hours=1),
                 HardConstraints())


def test_ending_an_override_early_stops_it_at_that_instant():
    store = PolicyStore()
    store.add_override("ws", Override("o1", "main", T0, T0 + timedelta(hours=2),
                                      HardConstraints(allow_explicit=True)))
    store.end_override("ws", "main", "o1", T0 + timedelta(minutes=15))
    assert store.active_overrides("ws", "main", T0 + timedelta(minutes=14))
    assert not store.active_overrides("ws", "main", T0 + timedelta(minutes=15))


# AV-0425-05 ---------------------------------------------------------------------------------


def test_an_empty_licensed_catalogue_plays_nothing_and_says_so():
    policy = PolicyStore().publish("ws", "main", draft(), effective_from=T0, now=T0)
    unlicensed = [track("pirate", licensed=False), track("other", source="someone-else")]
    for catalogue in ([], unlicensed):
        result = select_candidates(policy, catalogue, T0)
        assert result.status == NO_LICENSED_MUSIC
        assert result.enforcement.allowed == ()
        assert "won't play anything" in result.message
    no_sources = PolicyStore().publish("ws", "main", draft(licensed_sources=()),
                                       effective_from=T0, now=T0)
    assert select_candidates(no_sources, [track("a")], T0).status == NO_LICENSED_MUSIC


def test_filtered_out_is_its_own_state_and_unlicensed_is_never_a_fallback():
    policy = PolicyStore().publish("ws", "main", draft(
        constraints=HardConstraints(energy_max=0.2)), effective_from=T0, now=T0)
    result = select_candidates(policy, [track("hot", energy=0.9),
                                        track("calm-but-pirate", energy=0.1, licensed=False)], T0)
    assert result.status == ALL_FILTERED
    assert result.enforcement.allowed == ()
    assert result.unlicensed == ("calm-but-pirate",)
    ready = select_candidates(policy, [track("calm", energy=0.1)], T0)
    assert ready.status == READY and [t.id for t in ready.enforcement.allowed] == ["calm"]


# Routes ---------------------------------------------------------------------------------------


class Clock:
    now = T0

    def __call__(self):
        return self.now


def test_policy_routes_end_to_end_with_the_flags_on():
    flags.use("+autopilot.venue_mode +autopilot.venue_policy")
    clock = Clock()
    app = FastAPI()
    flag_guard.install(app, strict=True)
    install_routes(app, scope=lambda: "ws-test", clock=clock)
    client = TestClient(app)
    base = "/api/autopilot/venues/main"
    assert client.get(f"{base}/setup").json()["next_step"] == "venue"
    wrong = client.put(f"{base}/setup/venue", json={"name": "", "timezone": "UTC"})
    assert wrong.status_code == 422 and "name" in wrong.json()["detail"]["errors"]
    assert client.post(f"{base}/policies", json={}).status_code == 409
    client.put(f"{base}/setup/venue", json={"name": "The Lantern", "timezone": "UTC"})
    client.put(f"{base}/setup/sources", json={"licensed_sources": ["cloud-library"],
                                              "confirm_licensed": True})
    client.put(f"{base}/setup/review", json={"confirmed": True})
    published = client.post(f"{base}/policies", json={})
    assert published.status_code == 201
    assert published.json()["effective"]["version"] == 1
    song = {"id": "s1", "artist": "A", "bpm": 120, "energy": 0.6, "explicit": False,
            "source": "cloud-library", "licensed": True}
    assert client.post(f"{base}/candidates", json={"candidates": [song]}).json()["status"] == READY
    added = client.post(f"{base}/overrides", json={"minutes": 30, "limits": {"energy_max": 0.3}})
    assert added.status_code == 201 and added.json()["active"] is True
    assert client.post(f"{base}/candidates",
                       json={"candidates": [song]}).json()["status"] == ALL_FILTERED
    clock.now = T0 + timedelta(minutes=30)
    assert client.get(f"{base}/overrides").json()["overrides"][0]["active"] is False
    assert client.post(f"{base}/candidates", json={"candidates": [song]}).json()["status"] == READY
    empty = client.post(f"{base}/candidates", json={"candidates": []}).json()
    assert empty["status"] == NO_LICENSED_MUSIC and empty["allowed"] == []
