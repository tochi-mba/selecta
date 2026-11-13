"""Dayparts drive the existing planner (ADR-0444, BZ-0444-07 to 11). Made-up data only."""

from __future__ import annotations

import dataclasses
import json
from datetime import UTC, date, datetime
from zoneinfo import ZoneInfo

import pytest
from mix_helpers import _song

from selecta import db
from selecta.business import dayparts
from selecta.business.dayparts import (
    ECHO_OUT,
    HARD_CUTS,
    LANDING_WINDOW_SECONDS,
    MIX_LANGUAGES,
    STEM_FREQUENCIES,
    Block,
    Programme,
    ProgrammeError,
    ProgrammeVersion,
    StaffSteering,
    block_windows,
    blocks_for_day,
    boundary_moves,
    boundary_seam,
    bridge_or_echo,
    committed_window_end,
    land_boundary,
    lead_in,
    lead_in_seconds,
    planner_inputs,
    replan_from,
    target_at,
)
from selecta.planner import arc as arc_module
from selecta.planner.beam import plan_set
from selecta.planner.vibes import BY_KEY
from selecta.session import Steering, steer
from selecta.styles import all_recipes

LONDON = ZoneInfo("Europe/London")
A_VIBE = next(iter(BY_KEY))

BRUNCH = Block("10:00", "Brunch calm", arc=(20, 25, 30, 30, 35), mix_language="seamless")
LUNCH = Block("12:00", "Lunch", energy=50, crates=("lunch",), brand={"bpm_min": 90})
EVENING = Block("18:00", "Evening lift", energy=80, mix_language="balanced", stems="often")


def _programme() -> Programme:
    return Programme(
        weekly={0: (EVENING, BRUNCH, LUNCH), 5: (BRUNCH,)},
        replacements={
            date(2026, 12, 24): (Block("10:00", "Christmas Eve party", energy=90),),
        },
    )


def _london(day: date, hour: int, minute: int = 0) -> datetime:
    return datetime(day.year, day.month, day.day, hour, minute, tzinfo=LONDON)


# Programmes and versions (BZ-0444-07)


def test_programme_sorts_blocks_by_start():
    assert [b.name for b in _programme().weekly[0]] == ["Brunch calm", "Lunch", "Evening lift"]


def test_date_replacement_replaces_the_weekly_day():
    programme = _programme()
    christmas_eve = date(2026, 12, 24)
    assert christmas_eve.weekday() == 3
    assert [b.name for b in blocks_for_day(programme, christmas_eve)] == ["Christmas Eve party"]
    monday = date(2026, 11, 16)
    assert blocks_for_day(programme, monday) == programme.weekly[0]
    assert blocks_for_day(programme, date(2026, 11, 17)) == ()


def test_version_is_immutable_and_round_trips_json():
    version = ProgrammeVersion(
        "v1", "owner@example.test", datetime(2026, 11, 1, tzinfo=UTC), _programme()
    )
    with pytest.raises(dataclasses.FrozenInstanceError):
        version.version_id = "v2"  # type: ignore[misc]
    with pytest.raises(dataclasses.FrozenInstanceError):
        BRUNCH.energy = 99  # type: ignore[misc]
    with pytest.raises(TypeError):
        version.programme.weekly[1] = (BRUNCH,)  # type: ignore[index]
    with pytest.raises(TypeError):
        LUNCH.brand["bpm_max"] = 130  # type: ignore[index]
    again = ProgrammeVersion.from_json(version.to_json())
    assert again == version
    assert again.to_json() == version.to_json()
    row = ProgrammeVersion.from_row(
        "v1", version.created_by, version.created_at, version.blocks_json
    )
    assert row.programme == version.programme
    assert json.loads(version.blocks_json)["replacements"]["2026-12-24"][0]["energy"] == 90


@pytest.mark.parametrize(
    "build, message",
    [
        (lambda: Programme(weekly={0: (Block("09:00", "A"), Block("09:00", "B"))}), "two blocks"),
        (lambda: Block("10:00", "X", vibe="not-a-vibe"), "unknown vibe"),
        (lambda: Block("10:00", "X", mix_language="shouty"), "mixing language"),
        (lambda: Block("10:00", "X", stems="always"), "stem frequency"),
        (lambda: Block("10:00", "X", arc=(10, 20, 30, 40)), "five points"),
        (lambda: Block("10:00", "X", arc=(10, 20, 30, 40, 101)), "0 to 100"),
        (lambda: Block("10:00", "X", arc=(10, 20, 30.5, 40, 50)), "0 to 100"),
        (lambda: Block("10:00", "X", energy=-1), "0 to 100"),
        (lambda: Block("10:00", "X", energy=40, arc=(1, 2, 3, 4, 5)), "not both"),
        (lambda: Block("25:00", "X"), "time of day"),
        (lambda: Block("9:00", "X"), "HH:MM"),
        (lambda: Block("10:00", " "), "name"),
        (lambda: Block("10:00", "X", brand={"loudness": 3}), "brand"),
        (lambda: Programme(weekly={7: (BRUNCH,)}), "weekday"),
    ],
)
def test_validation_refuses_what_the_zone_cannot_play(build, message):
    with pytest.raises(ProgrammeError, match=message):
        build()


def test_a_known_vibe_is_accepted():
    assert Block("10:00", "Vibe", vibe=A_VIBE).vibe == A_VIBE


def test_languages_and_stems_match_what_session_steer_accepts(tmp_path):
    conn = db.connect(tmp_path / "steer.db")
    for language in MIX_LANGUAGES:
        assert steer(conn, "mix_language", language).mix_language == language
    for frequency in STEM_FREQUENCIES:
        assert steer(conn, "stems", frequency).stems == frequency
    with pytest.raises(ValueError):
        steer(conn, "mix_language", "shouty")
    with pytest.raises(ValueError):
        steer(conn, "stems", "always")
    conn.close()


def test_block_windows_run_to_the_next_block_or_the_close_and_clamp_early_blocks():
    monday = date(2026, 11, 16)
    windows = block_windows(_programme(), _london(monday, 11), _london(monday, 20), monday, LONDON)
    assert [w.block.name for w in windows] == ["Brunch calm", "Lunch", "Evening lift"]
    assert windows[0].start == _london(monday, 11)  # clamped to the opening
    assert windows[0].end == windows[1].start == _london(monday, 12)
    assert windows[2].end == _london(monday, 20)
    assert windows[1].seconds == 6 * 3600


def test_block_windows_keep_only_the_latest_block_before_opening_and_drop_after_close():
    monday = date(2026, 11, 16)
    windows = block_windows(_programme(), _london(monday, 13), _london(monday, 17), monday, LONDON)
    assert [w.block.name for w in windows] == ["Lunch"]
    assert windows[0].seconds == 4 * 3600


def test_block_windows_place_after_midnight_blocks_on_overnight_hours():
    saturday = date(2026, 11, 21)
    late = Block("01:00", "Late", energy=70)
    programme = Programme(weekly={5: (Block("20:00", "Night", energy=60), late)})
    sunday = date(2026, 11, 22)
    windows = block_windows(programme, _london(saturday, 20), _london(sunday, 3), saturday, LONDON)
    assert [w.block.name for w in windows] == ["Night", "Late"]
    assert windows[1].start == _london(sunday, 1)


# Blocks drive the existing planner (BZ-0444-08)


def test_planner_inputs_send_the_arc_to_target_energy_as_the_custom_curve(monkeypatch):
    calls = []
    real = arc_module.target_energy

    def spy(progress, preset="slow_burn", custom=None):
        calls.append((progress, preset, custom))
        return real(progress, preset, custom)

    monkeypatch.setattr(arc_module, "target_energy", spy)
    inputs = planner_inputs(BRUNCH, 7200, zone_default_crates=("house",))
    assert inputs.custom_curve == (0.2, 0.25, 0.3, 0.3, 0.35)
    assert target_at(inputs, 0.0) == pytest.approx(0.2)
    assert target_at(inputs, 1.0) == pytest.approx(0.35)
    assert calls[0] == (0.0, "slow_burn", (0.2, 0.25, 0.3, 0.3, 0.35))
    assert target_at(inputs, 0.5) == pytest.approx(real(0.5, custom=inputs.custom_curve))
    assert inputs.crates == ("house",)  # empty crates fall back to the zone default
    assert inputs.mix_language == "seamless"
    assert inputs.plan_set_kwargs["energy_arc"] == [0.2, 0.25, 0.3, 0.3, 0.35]
    assert isinstance(inputs.steering, Steering)
    assert inputs.steering.energy_arc == [20, 25, 30, 30, 35]
    assert inputs.steering.mix_language == "seamless"


def test_planner_inputs_for_a_level_are_a_flat_curve_with_the_blocks_own_pool():
    inputs = planner_inputs(EVENING, 3600, zone_default_crates=("house",), steering_offset=1)
    assert inputs.custom_curve == (0.8,) * 5
    assert inputs.stems == inputs.steering.stems == "often"
    assert inputs.steering.energy == 1
    assert target_at(inputs, 0.3) == pytest.approx(0.9)
    lunch = planner_inputs(LUNCH, 3600, zone_default_crates=("house",))
    assert lunch.crates == ("lunch",)
    assert dict(lunch.brand) == {"bpm_min": 90}


def test_a_vibe_block_without_energy_follows_the_vibes_own_arc():
    inputs = planner_inputs(Block("10:00", "Vibe", vibe=A_VIBE), 3600, zone_default_crates=())
    assert inputs.custom_curve is None
    assert inputs.arc_preset == BY_KEY[A_VIBE].arc
    assert inputs.vibe == A_VIBE


# Boundaries without hard cuts (BZ-0444-09)


def test_calm_to_energetic_lead_in_is_monotone_and_lands_within_eight_minutes():
    calm = planner_inputs(BRUNCH, 2 * 3600, zone_default_crates=())
    lively = planner_inputs(EVENING, 3 * 3600, zone_default_crates=())
    boundary = 7200.0
    ramp = lead_in(calm, lively, boundary, [200.0, 240.0, 230.0])
    seconds = [point[0] for point in ramp]
    energies = [point[1] for point in ramp]
    assert seconds[-1] == boundary
    assert boundary - seconds[0] == pytest.approx(600.0)  # 10 minutes beats two songs here
    assert energies[0] == pytest.approx(0.35)
    assert energies[-1] == pytest.approx(0.8)
    assert all(b >= a for a, b in zip(energies, energies[1:], strict=False))
    assert all(b > a for a, b in zip(seconds, seconds[1:], strict=False))
    transitions = [6400.0, 6640.0, 6870.0, 7390.0, 7630.0]
    landed = land_boundary(transitions, boundary)
    assert landed == 7390.0
    assert abs(landed - boundary) <= LANDING_WINDOW_SECONDS
    assert land_boundary([6000.0, 8000.0], boundary) is None


def test_two_long_songs_make_a_lead_in_longer_than_ten_minutes():
    calm = planner_inputs(BRUNCH, 2 * 3600, zone_default_crates=())
    assert lead_in_seconds(calm, [400.0, 380.0]) == (780.0, False)


def test_a_short_happy_birthday_block_shortens_the_lead_in():
    birthday = planner_inputs(
        Block("19:00", "Happy birthday", energy=85), 420, zone_default_crates=()
    )
    after = planner_inputs(EVENING, 3600, zone_default_crates=())
    length, shortened = lead_in_seconds(birthday, [240.0, 180.0])
    assert shortened
    assert length == pytest.approx(420 - 240)  # the first birthday song plays in full
    ramp = lead_in(birthday, after, 420.0, [240.0, 180.0])
    assert ramp[0][0] == pytest.approx(240.0)
    assert ramp[-1] == (420.0, pytest.approx(0.8))


def test_bridge_then_echo_out_when_pools_do_not_connect():
    def compatible(a, b):
        return abs(a - b) <= 5

    assert bridge_or_echo([10, 20], [24, 90], compatible) == ("direct", (20, 24))
    pairs = {(10, 46), (46, 50)}
    assert bridge_or_echo([10], [50, 51], lambda a, b: (a, b) in pairs, bridges=[30, 46]) == (
        "bridge",
        (10, 46, 50),
    )
    assert bridge_or_echo([10, 11], [80, 81], compatible) == (ECHO_OUT, None)


def test_the_echo_out_and_cut_names_are_the_planners_own():
    recipes = all_recipes()
    assert ECHO_OUT in recipes
    assert HARD_CUTS == {"cut_on_one"}
    assert HARD_CUTS <= set(recipes)
    punchy = boundary_moves("punchy")
    assert punchy is not None and not punchy & HARD_CUTS
    assert ECHO_OUT in punchy


def test_every_move_across_a_calm_to_energetic_boundary_is_not_a_cut(tmp_path):
    calm_songs = [
        _song(tmp_path, f"calm{i}", f"Calm {i}", bpm=100.0 + i, energy=0.3) for i in range(6)
    ]
    lively_songs = [
        _song(tmp_path, f"lively{i}", f"Lively {i}", bpm=124.0 + i, energy=0.8, camelot="2B")
        for i in range(6)
    ]
    for offset, song in enumerate(calm_songs + lively_songs):
        song.id = 1000 + offset
    punchy_party = Block("18:00", "Party", energy=80, mix_language="punchy")
    calm = planner_inputs(BRUNCH, 1800, zone_default_crates=())
    lively = planner_inputs(punchy_party, 1800, zone_default_crates=())
    before = plan_set(calm_songs, calm_songs[0].id, 4, **calm.plan_set_kwargs)
    kind, joined = bridge_or_echo(
        [before[-1].song.id], [song.id for song in lively_songs], lambda a, b: True
    )
    assert kind == "direct"
    first_new = next(song for song in lively_songs if song.id == joined[1])
    seam = boundary_seam(before[-1].song, first_new, lively.mix_language, lively.stems)
    after = plan_set(lively_songs, first_new.id, 4, **lively.plan_set_kwargs)
    seam_moves = [item.transition for item in before[1:]] + [seam.recipe.name]
    assert seam.recipe.name not in HARD_CUTS
    assert all(move not in HARD_CUTS for move in seam_moves)
    assert [song.song.energy for song in after] == [0.8] * 4
    # Inside a punchy block the planner may still choose a cut between two new-block songs;
    # only the boundary seam is guaranteed cut-free from this module.


# Staff steering decays to the block (BZ-0444-11)


def test_bigger_decays_back_to_the_block_over_three_songs():
    staff = StaffSteering()
    assert staff.press("bigger") == 1
    assert staff.press("bigger") == 2
    assert staff.press("bigger") == 2  # capped like session.steer
    assert staff.after_song() == pytest.approx(4 / 3)
    assert staff.after_song() == pytest.approx(2 / 3)
    assert staff.after_song() == 0
    assert staff.after_song() == 0
    inputs = planner_inputs(EVENING, 3600, zone_default_crates=(), steering_offset=4 / 3)
    assert target_at(inputs, 0.5) == pytest.approx(0.8 + 0.4 / 3)


def test_calmer_pressed_again_restarts_the_decay_and_something_else_keeps_energy():
    staff = StaffSteering()
    staff.press("calmer")
    staff.after_song()
    assert staff.press("calmer") == -2  # -2/3 rounds to -1, then one more step
    assert staff.songs_since == 0
    assert staff.press("something_else") == -2
    assert staff.something_else == 1
    with pytest.raises(ValueError):
        staff.press("louder")


def test_a_new_block_resets_steering_and_it_round_trips_a_dict():
    staff = StaffSteering()
    staff.press("bigger")
    stored = StaffSteering.from_dict(json.loads(json.dumps(staff.to_dict())))
    assert stored == staff and stored.offset == 1
    staff.new_block()
    assert staff.offset == 0 and staff == StaffSteering()
    assert StaffSteering.from_dict(None) == StaffSteering()


# Edits while playing (BZ-0444-10)


def _version(version_id: str, programme: Programme) -> ProgrammeVersion:
    return ProgrammeVersion(version_id, "manager", datetime(2026, 11, 2, tzinfo=UTC), programme)


def test_committed_window_is_the_playing_song_and_the_next_two_transitions():
    assert committed_window_end(200.0, [200.0, 410.0, 650.0]) == 410.0
    assert committed_window_end(200.0, [150.0, 230.0]) == 230.0
    assert committed_window_end(200.0, []) == 200.0


def test_an_edit_to_the_current_block_starts_a_lead_in_after_the_committed_window():
    old = _version("v1", _programme())
    louder_brunch = dataclasses.replace(BRUNCH, arc=None, energy=60)
    new = _version("v2", Programme(weekly={0: (louder_brunch, LUNCH, EVENING), 5: (BRUNCH,)}))
    point = replan_from(410.0, old, new, BRUNCH, opening_date=date(2026, 11, 16))
    assert (point.start_s, point.lead_in, point.version_id) == (410.0, True, "v2")
    scanned = replan_from(410.0, old, new, BRUNCH)
    assert scanned.lead_in


def test_an_edit_elsewhere_replans_after_the_window_without_a_lead_in():
    old = _version("v1", _programme())
    new = _version(
        "v2",
        Programme(
            weekly={0: (BRUNCH, LUNCH, dataclasses.replace(EVENING, energy=95)), 5: (BRUNCH,)}
        ),
    )
    point = replan_from(410.0, old, new, BRUNCH, opening_date=date(2026, 11, 16))
    assert (point.start_s, point.lead_in) == (410.0, False)
    assert not replan_from(410.0, old, old, BRUNCH).lead_in


def test_the_module_never_plans_a_set_itself():
    source = dayparts.__file__
    with open(source, encoding="utf-8") as handle:
        text = handle.read()
    assert "def plan_set(" not in text and "enumerate_candidates(a, b)" in text
