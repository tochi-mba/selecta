"""A room's settings (ADR-0416, docs/saas/11a-devices-and-rooms.md §11A.2): the defaults from the
proposal, the range every number is held to, and the plan limits a room keeps once it opens."""

from __future__ import annotations

import pytest

from selecta.rooms.ports import RoomEntitlement
from selecta.rooms.settings import (
    BOUNDS,
    MAX_CRATE_SONGS,
    JoinMode,
    RequestMode,
    RoomSettings,
)


def test_the_defaults_are_the_ones_the_proposal_set_out():
    defaults = RoomSettings()
    assert defaults.join_mode is JoinMode.ANYONE
    assert defaults.request_mode is RequestMode.AUTO
    assert defaults.crate_song_ids is None and defaults.crate is None
    assert (defaults.pending_per_guest, defaults.requests_per_guest_per_hour) == (1, 3)
    assert (defaults.replay_cooldown_minutes, defaults.pending_per_room) == (60, 20)
    assert defaults.votes and not defaults.names_shown and not defaults.display
    assert (defaults.max_hours, defaults.no_speaker_minutes) == (12.0, 60)
    assert (defaults.renders_per_hour, defaults.max_guests) == (60, 100)


def test_settings_survive_a_round_trip_through_json():
    chosen = RoomSettings(
        join_mode=JoinMode.APPROVE,
        request_mode=RequestMode.OFF,
        crate_song_ids=(3, 1, 2),
        votes=False,
        names_shown=True,
        max_hours=2.5,
    )
    raw = chosen.to_json()
    assert raw["join_mode"] == "approve" and raw["request_mode"] == "off"
    assert raw["crate_song_ids"] == [3, 1, 2]
    assert RoomSettings.from_json(raw) == chosen
    assert RoomSettings().to_json()["crate_song_ids"] is None


def test_missing_settings_take_the_default_and_unknown_ones_are_ignored():
    assert RoomSettings.from_json(None) == RoomSettings()
    assert RoomSettings.from_json({"colour": "teal", "votes": False}) == RoomSettings(votes=False)


@pytest.mark.parametrize(
    "raw",
    [
        {"join_mode": "everyone"},
        {"request_mode": "sometimes"},
        {"votes": "yes"},
        {"names_shown": 1},
        {"display": None},
        {"pending_per_guest": "2"},
        {"pending_per_guest": True},
        {"pending_per_guest": 1.5},
        {"max_guests": None},
        {"crate_song_ids": "1,2,3"},
        {"crate_song_ids": [1, "2"]},
        {"crate_song_ids": [True]},
        {"crate_song_ids": list(range(MAX_CRATE_SONGS + 1))},
    ],
)
def test_a_setting_of_the_wrong_kind_is_refused(raw):
    with pytest.raises(ValueError):
        RoomSettings.from_json(raw)


def test_whole_numbers_written_as_floats_are_accepted_and_hours_may_be_fractional():
    parsed = RoomSettings.from_json({"pending_per_guest": 2.0, "max_hours": 1.5})
    assert parsed.pending_per_guest == 2 and isinstance(parsed.pending_per_guest, int)
    assert RoomSettings.from_json({"max_hours": 3}).max_hours == 3.0


@pytest.mark.parametrize(("name", "bounds"), sorted(BOUNDS.items()))
def test_every_number_is_held_inside_its_range(name, bounds):
    low, high = bounds
    too_low = RoomSettings.from_json({name: low - 1000})
    too_high = RoomSettings.from_json({name: high + 1000})
    assert getattr(too_low, name) == low
    assert getattr(too_high, name) == high
    assert type(getattr(too_low, name)) is type(getattr(RoomSettings(), name))


def test_a_crate_keeps_each_song_once_in_the_order_given():
    parsed = RoomSettings.from_json({"crate_song_ids": [5, 3, 5, 1, 3]})
    assert parsed.crate_song_ids == (5, 3, 1)
    assert parsed.crate == frozenset({1, 3, 5})
    assert RoomSettings.from_json({"crate_song_ids": (7,)}).crate_song_ids == (7,)
    assert RoomSettings.from_json({"crate_song_ids": None}).crate is None


def test_a_room_is_held_to_what_the_plan_allows():
    plan = RoomEntitlement(allowed=True, max_guests=40, max_hours=4.0, renders_per_hour=20)
    asked = RoomSettings(max_guests=500, max_hours=12.0, renders_per_hour=600).checked()
    held = asked.within(plan)
    assert (held.max_guests, held.max_hours, held.renders_per_hour) == (40, 4.0, 20)
    modest = RoomSettings(max_guests=10, max_hours=1.0, renders_per_hour=5).within(plan)
    assert (modest.max_guests, modest.max_hours, modest.renders_per_hour) == (10, 1.0, 5)


def test_an_open_room_s_limits_only_ever_go_down():
    current = RoomSettings(max_guests=40, max_hours=4.0, renders_per_hour=20)
    raised = RoomSettings(max_guests=100, max_hours=12.0, renders_per_hour=60)
    kept = raised.keeping_limits_of(current)
    assert (kept.max_guests, kept.max_hours, kept.renders_per_hour) == (40, 4.0, 20)
    lowered = RoomSettings(max_guests=5, max_hours=1.0, renders_per_hour=2)
    assert lowered.keeping_limits_of(current) == lowered


def test_settings_already_in_range_are_returned_as_they_are():
    fine = RoomSettings()
    assert fine.checked() is fine
