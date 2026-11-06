"""Selecta arranging seams itself, learned from a shape the listener made and rated Good."""

from __future__ import annotations

import json
from types import SimpleNamespace

import numpy as np
import pytest
import soundfile as sf
from helpers import song_from_track
from synth import make_track

import selecta.seams as seams_module
import selecta.studio as studio_module
from selecta.arrange import (
    FIRST_ARC,
    PRESENT_DB,
    STRIP_AND_LAND,
    Hearing,
    Taste,
    WontWork,
    arc_of,
    arrangements,
    as_array,
    as_shape,
    can_arrange,
    listen,
    repair,
    score,
    taste_from,
    tune,
    what_changed,
    why_it_cant,
)
from selecta.config import SAMPLE_RATE, Settings
from selecta.planner.memory import SeamMemory
from selecta.planner.vibes import BY_KEY, MAX_SHARE, _moves_that_fit
from selecta.seams import MOVES, SeamRequest, SeamStore, _arranged, fallback_order, seam_options
from selecta.studio import CELLS, LANES, SIDES, clean_shape, prepare_session

LOUD = -24.0
QUIET = -70.0
LANE = {lane: index for index, lane in enumerate(LANES)}
SIDE = {side: index for index, side in enumerate(SIDES)}


def _hearing(**overrides) -> Hearing:
    """Every stem has something in every square, all in the same notes, unless told otherwise."""
    levels = np.full((2, 4, CELLS), LOUD)
    for name, values in overrides.items():
        side, lane = name.split("_")
        levels[SIDE[side], LANE[lane]] = values
    notes = np.zeros((2, 4, CELLS, 12))
    notes[:, :, :, 0] = 1.0
    edges = np.full((2, CELLS + 1), 0.05)
    return Hearing(levels, notes, edges)


# what the listener's own seam measured, I KNOW WHO I BE into Taste Back
REAL_LEVELS = np.array(
    [
        [
            [-24, -24, -25, -25, -24, -24, -25, -24],
            [-19, -19, -19, -18, -20, -20, -19, -19],
            [-25, -24, -25, -27, -28, -26, -30, -28],
            [-23, -25, -25, -25, -24, -25, -24, -25],
        ],
        [
            [-88, -87, -80, -81, -79, -55, -28, -28],
            [-91, -91, -87, -86, -26, -22, -23, -23],
            [-90, -89, -86, -85, -77, -24, -22, -21],
            [-41, -38, -28, -25, -24, -23, -26, -54],
        ],
    ],
    dtype=float,
)


def _real_hearing() -> Hearing:
    hearing = _hearing()
    return Hearing(REAL_LEVELS, hearing.notes, hearing.edges)


def test_the_first_shape_is_the_one_the_listener_made():
    assert "".join(map(str, STRIP_AND_LAND["a"]["vocals"])) == "11110000"
    assert "".join(map(str, STRIP_AND_LAND["a"]["drums"])) == "11000000"
    assert "".join(map(str, STRIP_AND_LAND["a"]["bass"])) == "10000000"
    assert "".join(map(str, STRIP_AND_LAND["a"]["other"])) == "11111111"
    assert "".join(map(str, STRIP_AND_LAND["b"]["vocals"])) == "00000000"
    assert "".join(map(str, STRIP_AND_LAND["b"]["drums"])) == "00000001"
    assert "".join(map(str, STRIP_AND_LAND["b"]["bass"])) == "00000011"
    assert "".join(map(str, STRIP_AND_LAND["b"]["other"])) == "00011011"


@pytest.mark.parametrize("lane", ["drums", "bass", "vocals"])
def test_it_never_has_two_of_the_same_part_at_once(lane):
    for cell in range(CELLS):
        assert not (STRIP_AND_LAND["a"][lane][cell] and STRIP_AND_LAND["b"][lane][cell])


def test_the_energy_shape_was_measured_from_the_seam_they_liked():
    measured = arc_of(as_array(STRIP_AND_LAND), _real_hearing())
    assert np.abs(measured - np.array(FIRST_ARC)).max() < 1.0
    assert measured.argmin() == 5, "lowest just before the landing"


def test_what_counts_as_present_sits_between_leftovers_and_real_parts():
    assert -55 < PRESENT_DB < -30


# ---- the score


def _on(shape, name, cells):
    side, lane = name.split("_")
    array = as_array(shape).copy()
    for cell in cells:
        array[SIDE[side], LANE[lane], cell] = True
    return array


def test_two_basses_at_once_score_worse():
    hearing, taste = _hearing(), Taste()
    base = as_array(STRIP_AND_LAND)
    assert score(_on(STRIP_AND_LAND, "a_bass", [7]), hearing, taste) < score(base, hearing, taste)


def test_two_sets_of_drums_score_worse():
    hearing, taste = _hearing(), Taste()
    base = as_array(STRIP_AND_LAND)
    assert score(_on(STRIP_AND_LAND, "b_drums", [0]), hearing, taste) < score(base, hearing, taste)


def test_two_voices_score_worse():
    hearing, taste = _hearing(), Taste()
    base = as_array(STRIP_AND_LAND)
    assert score(_on(STRIP_AND_LAND, "b_vocals", [0]), hearing, taste) < score(base, hearing, taste)


def test_a_silent_square_scores_far_worse():
    hearing, taste = _hearing(), Taste()
    silent = as_array(STRIP_AND_LAND).copy()
    silent[:, :, 5] = False
    assert score(silent, hearing, taste) < score(as_array(STRIP_AND_LAND), hearing, taste) - 50


def test_no_landing_scores_far_worse():
    hearing, taste = _hearing(), Taste()
    flat = as_array(STRIP_AND_LAND).copy()
    flat[1, LANE["drums"]] = False
    flat[1, LANE["bass"]] = False
    assert score(flat, hearing, taste) < score(as_array(STRIP_AND_LAND), hearing, taste) - 30


def test_melodies_in_different_notes_score_worse_than_in_the_same_ones():
    taste = Taste()
    together = _hearing()
    apart = _hearing()
    apart.notes[1, LANE["other"], :, :] = 0.0
    apart.notes[1, LANE["other"], :, 6] = 1.0
    shape = as_array(STRIP_AND_LAND)
    assert score(shape, apart, taste) < score(shape, together, taste)


def test_stopping_a_voice_on_a_word_scores_worse_than_in_a_gap():
    taste = Taste()
    on_a_word, in_a_gap = _hearing(), _hearing()
    on_a_word.edges[0, 4] = 0.3
    in_a_gap.edges[0, 4] = 0.0
    shape = as_array(STRIP_AND_LAND)
    assert score(shape, on_a_word, taste) < score(shape, in_a_gap, taste)


def test_a_part_missing_at_either_end_counts_as_a_jump():
    hearing, taste = _hearing(), Taste()
    base = score(as_array(STRIP_AND_LAND), hearing, taste)
    missing = as_array(STRIP_AND_LAND).copy()
    missing[0, LANE["drums"], 0] = False
    assert score(missing, hearing, taste) < base
    late = as_array(STRIP_AND_LAND).copy()
    late[1, LANE["other"], 7] = False
    assert score(late, hearing, taste) < base


def test_the_next_songs_voice_may_come_in_on_the_landing_itself():
    hearing, taste = _hearing(), Taste()
    assert (~as_array(STRIP_AND_LAND)[1, 0]).all()
    assert score(as_array(STRIP_AND_LAND), hearing, taste) > 0


def test_flicking_a_part_on_and_off_scores_worse():
    hearing, taste = _hearing(), Taste()
    flickering = as_array(STRIP_AND_LAND).copy()
    flickering[1, LANE["other"]] = [True, False, True, False, True, False, True, True]
    assert score(flickering, hearing, taste) < score(as_array(STRIP_AND_LAND), hearing, taste)


def test_being_like_a_shape_they_liked_helps_and_a_bad_one_hurts():
    hearing = _hearing()
    shape = as_array(_another_shape())
    plain = score(shape, hearing, Taste())
    assert score(shape, hearing, Taste(liked=[shape])) > plain
    assert score(shape, hearing, Taste(disliked=[shape])) < plain


def test_scoring_changes_nothing():
    shape = as_array(STRIP_AND_LAND)
    before = shape.copy()
    score(shape, _hearing(), Taste())
    assert (shape == before).all()


# ---- fine tuning


def test_tuning_never_makes_it_worse():
    for overrides in (
        {},
        {"a_other": [LOUD, LOUD, QUIET, QUIET, LOUD, LOUD, LOUD, LOUD]},
        {"b_drums": [QUIET] * 6 + [LOUD] * 2},
    ):
        hearing, taste = _hearing(**overrides), Taste()
        start = as_array(STRIP_AND_LAND)
        assert score(tune(start, hearing, taste), hearing, taste) >= score(start, hearing, taste)


def test_tuning_changes_nothing_in_the_shape_it_starts_from():
    start = as_array(STRIP_AND_LAND)
    before = start.copy()
    tune(start, _hearing(), Taste())
    assert (start == before).all()


def test_tuning_takes_out_a_tease_that_clashes():
    hearing = _hearing()
    hearing.notes[1, LANE["other"], 3:5, :] = 0.0
    hearing.notes[1, LANE["other"], 3:5, 6] = 1.0
    tuned = tune(as_array(STRIP_AND_LAND), hearing, Taste())
    for cell in (3, 4):
        both = tuned[0, LANE["other"], cell] and tuned[1, LANE["other"], cell]
        assert not both, "the two melodies shouldn't play together where they clash"


def test_tuning_fills_a_silent_square():
    hearing = _hearing(
        a_other=[LOUD, LOUD, LOUD, LOUD, LOUD, QUIET, LOUD, LOUD],
        b_other=[QUIET] * CELLS,
    )
    tuned = tune(as_array(STRIP_AND_LAND), hearing, Taste())
    heard = tuned & (hearing.levels >= PRESENT_DB)
    assert heard.any(axis=(0, 1)).all()


def test_tuning_keeps_one_bass_and_one_set_of_drums():
    tuned = tune(as_array(STRIP_AND_LAND), _hearing(), Taste())
    assert not (tuned[0, LANE["bass"]] & tuned[1, LANE["bass"]]).any()
    assert not (tuned[0, LANE["drums"]] & tuned[1, LANE["drums"]]).any()
    assert not (tuned[0, LANE["vocals"]] & tuned[1, LANE["vocals"]]).any()


def test_tuning_keeps_the_character_of_what_they_liked():
    tuned = tune(as_array(STRIP_AND_LAND), _real_hearing(), Taste())
    assert (tuned == as_array(STRIP_AND_LAND)).mean() >= 0.8
    assert tuned[1, LANE["drums"], 7], "the drums still land last"
    assert not tuned[1, LANE["drums"], :5].any()


def _with_real_likeness(hearing):
    """Melodies as alike as the two on the seam they liked, measured square by square."""
    alike = [0.0, 0.64, 0.66, 0.66, 0.88, 0.62, 0.79, 0.0]
    for cell, amount in enumerate(alike):
        hearing.notes[0, LANE["other"], cell] = np.eye(12)[0]
        hearing.notes[1, LANE["other"], cell] = (
            amount * np.eye(12)[0] + np.sqrt(1 - amount**2) * np.eye(12)[1]
        )
    return hearing


def test_on_the_seam_they_made_tuning_changes_nothing():
    """The search should agree with their ear on the one seam known to be good."""
    hearing = _with_real_likeness(_real_hearing())
    assert as_shape(tune(as_array(STRIP_AND_LAND), hearing, Taste())) == STRIP_AND_LAND


def test_a_songs_own_voice_never_clashes_with_its_own_band():
    hearing = _hearing()
    apart = _hearing()
    apart.notes[0, LANE["vocals"], :, :] = 0.0
    apart.notes[0, LANE["vocals"], :, 6] = 1.0
    apart.notes[1, LANE["other"], :, :] = 0.0
    apart.notes[1, LANE["other"], :, 6] = 1.0
    only_first = as_array(STRIP_AND_LAND).copy()
    only_first[1] = False
    assert score(only_first, apart, Taste()) == pytest.approx(score(only_first, hearing, Taste()))


def test_a_part_that_left_stays_gone():
    """On a real pair the search brought a song's drums back for one square to hit the energy."""
    hearing, taste = _hearing(), Taste()
    returning = as_array(STRIP_AND_LAND).copy()
    returning[0, LANE["drums"], 5] = True
    assert score(returning, hearing, taste) < score(as_array(STRIP_AND_LAND), hearing, taste)


def test_tuning_does_not_bring_parts_back():
    hearing = _hearing(
        a_other=[LOUD, LOUD, QUIET, QUIET, QUIET, LOUD, LOUD, LOUD], b_other=[QUIET] * CELLS
    )
    tuned = tune(as_array(STRIP_AND_LAND), hearing, Taste())
    for side, lane in ((0, "drums"), (0, "bass"), (1, "drums"), (1, "bass")):
        lanes = tuned[side, LANE[lane]]
        assert int(lanes[0]) + int((lanes[1:] & ~lanes[:-1]).sum()) <= 1


def test_a_deliberate_tease_is_not_flicker():
    assert (
        score(as_array(STRIP_AND_LAND), _hearing(), Taste())
        >= score(as_array(_another_shape()), _hearing(), Taste())
    )


def test_tuning_someone_elses_shape_stays_close_to_it():
    start = as_array(_another_shape())
    free = tune(start, _hearing(), Taste())
    kept = tune(start, _hearing(), Taste(anchor=start))
    assert (kept == start).sum() >= (free == start).sum()


def test_tuning_is_quick_enough_to_feel_instant():
    import time

    began = time.monotonic()
    tune(as_array(STRIP_AND_LAND), _hearing(), Taste())
    assert time.monotonic() - began < 3.0


def test_what_changed_says_it_in_words():
    before = clean_shape(STRIP_AND_LAND)
    after = clean_shape(STRIP_AND_LAND)
    after["a"]["drums"][2] = 1
    after["b"]["other"][3] = 0
    hearing = _hearing()
    hearing.notes[1, LANE["other"], 3, :] = 0.0
    hearing.notes[1, LANE["other"], 3, 6] = 1.0
    lines = what_changed(before, after, hearing, {"a": "First", "b": "Second"})
    assert "Turned First's drums on in square 3." in lines
    assert "Turned Second's melody off in square 4, where it clashed with the other song." in lines


def test_what_changed_talks_about_a_voice_as_stopping_somewhere():
    before = clean_shape(STRIP_AND_LAND)
    after = clean_shape(STRIP_AND_LAND)
    after["a"]["vocals"] = [1, 1, 1, 1, 1, 1, 0, 0]
    lines = what_changed(before, after, _hearing(), {"a": "First", "b": "Second"})
    assert lines == ["First's voice now stops at square 7, in a gap between words."]


def test_nothing_changed_means_nothing_to_say():
    shape = clean_shape(STRIP_AND_LAND)
    assert what_changed(shape, shape, _hearing(), {"a": "First", "b": "Second"}) == []


# ---- making arrangements


def test_a_shape_made_for_this_pair_is_used_as_it_is():
    theirs = clean_shape(None)
    assert arrangements(_hearing(), Taste(), theirs) == [theirs]


def test_something_gets_made_before_anything_has_been_rated():
    made = arrangements(_hearing(), Taste())
    assert made
    array = as_array(made[0])
    assert array[1, LANE["drums"], 7] or array[1, LANE["bass"], 7]


def test_on_the_pair_they_shaped_it_comes_out_close_to_what_they_made():
    made = as_array(arrangements(_real_hearing(), Taste())[0])
    assert (made == as_array(STRIP_AND_LAND)).mean() >= 0.8


def test_with_no_melody_to_carry_it_it_says_so():
    hearing = _hearing(a_other=[QUIET] * CELLS, b_other=[QUIET] * CELLS)
    with pytest.raises(WontWork, match="melody"):
        arrangements(hearing, Taste())


def test_with_nothing_to_land_with_it_says_so():
    hearing = _hearing(b_drums=[QUIET] * CELLS, b_bass=[QUIET] * CELLS)
    with pytest.raises(WontWork, match="land"):
        arrangements(hearing, Taste())


def test_bass_alone_is_enough_to_land_with():
    assert arrangements(_hearing(b_drums=[QUIET] * CELLS), Taste())


def test_near_silence_says_so():
    hearing = _hearing(
        **{f"{side}_{lane}": [LOUD] * 3 + [QUIET] + [LOUD] * 4 for side in SIDES for lane in LANES}
    )
    with pytest.raises(WontWork, match="silent"):
        arrangements(hearing, Taste())


def _another_shape():
    shape = clean_shape(STRIP_AND_LAND)
    shape["a"]["drums"] = [1, 1, 1, 1, 0, 0, 0, 0]
    shape["b"]["other"] = [0, 0, 0, 0, 0, 1, 1, 1]
    return shape


def test_shapes_they_liked_join_in():
    other = as_array(_another_shape())
    made = arrangements(_hearing(), Taste(liked=[other]))
    assert any((as_array(shape) == other).mean() >= 0.9 for shape in made)


def test_shapes_close_to_one_they_rated_bad_are_left_out():
    bad = as_array(STRIP_AND_LAND)
    for shape in arrangements(_hearing(), Taste(disliked=[bad])):
        assert (as_array(shape) == bad).mean() < 0.9


def test_one_liked_shape_that_does_not_fit_does_not_stop_the_others():
    needs_b_melody = as_array(STRIP_AND_LAND).copy()
    needs_b_melody[0, LANE["other"]] = False
    assert arrangements(_hearing(b_other=[QUIET] * CELLS), Taste(liked=[needs_b_melody]))


# ---- listening


def _stems(tmp_path, levels_db: dict[str, float], seconds=8.0):
    folder = tmp_path / "stems"
    folder.mkdir()
    count = int(seconds * SAMPLE_RATE)
    rng = np.random.default_rng(1)
    for side in SIDES:
        for lane in LANES:
            level = 10 ** (levels_db.get(f"{side}_{lane}", -70.0) / 20)
            noise = (rng.standard_normal(count) * level).astype(np.float32)
            audio = np.stack((noise, noise), axis=1)
            sf.write(folder / f"{side}_{lane}.flac", audio, SAMPLE_RATE, subtype="PCM_24")
    return folder


def test_levels_are_measured_square_by_square(tmp_path):
    hearing = listen(_stems(tmp_path, {"a_drums": -20.0}), 8.0)
    assert hearing.levels.shape == (2, 4, CELLS)
    assert hearing.levels[0, LANE["drums"], 0] == pytest.approx(-20.0, abs=1.5)
    assert hearing.levels[1, LANE["bass"], 0] == pytest.approx(-70.0, abs=1.5)


def test_it_hears_which_notes_a_melody_is_playing(tmp_path):
    folder = _stems(tmp_path, {})
    seconds = np.arange(8 * SAMPLE_RATE) / SAMPLE_RATE
    tone = (np.sin(2 * np.pi * 440.0 * seconds) * 0.2).astype(np.float32)
    sf.write(folder / "a_other.flac", np.stack((tone, tone), axis=1), SAMPLE_RATE, subtype="PCM_24")
    notes = listen(folder, 8.0).notes[0, LANE["other"], 0]
    assert int(np.argmax(notes)) == 9, "A is the ninth note up from C"


def test_it_hears_a_gap_between_words(tmp_path):
    folder = _stems(tmp_path, {})
    audio = np.random.default_rng(2).standard_normal((8 * SAMPLE_RATE, 2)).astype(np.float32) * 0.2
    audio[5 * SAMPLE_RATE - SAMPLE_RATE // 2 : 5 * SAMPLE_RATE + SAMPLE_RATE // 2] = 0.0
    sf.write(folder / "a_vocals.flac", audio, SAMPLE_RATE, subtype="PCM_24")
    edges = listen(folder, 8.0).edges[0]
    assert edges[5] < edges[3] / 10


def test_listening_only_happens_once(tmp_path):
    folder = _stems(tmp_path, {"a_drums": -20.0})
    first = listen(folder, 8.0)
    for stem in folder.glob("*.flac"):
        stem.unlink()
    assert (listen(folder, 8.0).levels == first.levels).all()


def test_cached_measurements_validate_notes_and_stem_signatures(tmp_path):
    import os

    folder = _stems(tmp_path, {"a_drums": -20.0})
    listen(folder, 8.0)
    saved = folder / "hearing.json"
    cached = json.loads(saved.read_text())
    cached["notes"] = []
    saved.write_text(json.dumps(cached))
    assert listen(folder, 8.0).notes.shape == (2, 4, CELLS, 12)
    stem = folder / "a_drums.flac"
    stat = stem.stat()
    os.utime(stem, ns=(stat.st_atime_ns, stat.st_mtime_ns + 1_000_000))
    listen(folder, 8.0)
    assert json.loads(saved.read_text())["sources"][stem.name][1] == stem.stat().st_mtime_ns


@pytest.mark.parametrize("damaged", ["{broken", "[]", '{"levels": [1], "notes": [], "edges": []}'])
def test_damaged_measurements_are_measured_again(tmp_path, damaged):
    folder = _stems(tmp_path, {"a_drums": -20.0})
    (folder / "hearing.json").write_text(damaged, "utf-8")
    assert listen(folder, 8.0).levels.shape == (2, 4, CELLS)


# ---- repairing what a render's checks found


def test_a_harmony_failure_keeps_the_melodies_apart_until_the_landing():
    fixed = repair(clean_shape(STRIP_AND_LAND), ["harmony"], _hearing())
    assert fixed["b"]["other"] == [0, 0, 0, 0, 0, 0, 1, 1]


def test_a_thin_stretch_is_filled_by_a_melody_that_is_resting():
    """The thinnest square on the shape is the sixth, where the tease pulls away."""
    fixed = repair(clean_shape(STRIP_AND_LAND), ["quiet time"], _hearing())
    assert fixed["b"]["other"][5] == 1
    assert fixed["a"]["drums"] == STRIP_AND_LAND["a"]["drums"]


def test_with_no_melody_to_fill_it_the_first_songs_drums_stay_longer():
    fixed = repair(clean_shape(STRIP_AND_LAND), ["level fall"], _hearing(b_other=[QUIET] * CELLS))
    assert fixed["a"]["drums"] == [1, 1, 1, 0, 0, 0, 0, 0]


def test_a_thin_stretch_with_drums_already_to_the_end_has_nothing_to_extend():
    """Found on a real pair, where the first song's drums already ran to the last square."""
    shape = clean_shape(STRIP_AND_LAND)
    shape["a"]["drums"] = [1] * CELLS
    assert repair(shape, ["quiet time"], _hearing(b_other=[QUIET] * CELLS)) is None


def test_a_thin_stretch_with_no_drums_starts_them_from_the_top():
    shape = clean_shape(STRIP_AND_LAND)
    shape["a"]["drums"] = [0] * CELLS
    assert (
        repair(shape, ["level fall"], _hearing(b_other=[QUIET] * CELLS))["a"]["drums"][0] == 1
    )


def test_a_low_end_clash_removes_the_doubled_part():
    shape = clean_shape(STRIP_AND_LAND)
    shape["a"]["bass"] = [1] * CELLS
    fixed = repair(shape, ["low end clash"], _hearing())
    assert not any(x and y for x, y in zip(fixed["a"]["bass"], fixed["b"]["bass"], strict=True))


def test_a_vocal_overlap_silences_the_second_voice():
    shape = clean_shape(STRIP_AND_LAND)
    shape["b"]["vocals"] = [1] * CELLS
    assert repair(shape, ["vocal overlap"], _hearing())["b"]["vocals"] == [0] * CELLS


def test_a_failure_the_shape_can_not_fix_is_left_alone():
    assert repair(clean_shape(STRIP_AND_LAND), ["beat alignment"], _hearing()) is None
    assert repair(clean_shape(STRIP_AND_LAND), [], _hearing()) is None


def test_shapes_convert_both_ways():
    assert as_shape(as_array(STRIP_AND_LAND)) == STRIP_AND_LAND


# ---- learning from ratings


def _state(style="stem_studio", rating="good", shape=None, a=1, b=2):
    request = {"a": a, "b": b, "move": style}
    state = {
        "status": "ready",
        "key": f"{a}-{b}-{style}",
        "style": style,
        "passed": True,
        "rules": 1,
        "request": request,
    }
    if rating:
        state["rating"] = rating
    if style == "stem_studio":
        request["shape"] = json.dumps(shape or STRIP_AND_LAND)
    else:
        state["shape_used"] = shape or STRIP_AND_LAND
    return state


def test_a_shape_they_made_and_liked_is_remembered_for_that_pair_and_in_general():
    memory = SeamMemory.from_states([_state()])
    assert memory.pair_shapes[(1, 2)] == STRIP_AND_LAND
    assert memory.liked_shapes == [STRIP_AND_LAND]
    assert memory.good_moves["stem_arrange"] == 1


def test_a_pair_they_shaped_themselves_is_wanted_for_that_pair():
    memory = SeamMemory.from_states([_state()])
    assert memory.move_factor(1, 2, "stem_arrange") > memory.move_factor(3, 4, "stem_arrange")


def test_a_liked_shape_raises_arranging_everywhere():
    assert SeamMemory.from_states([_state()]).taste("stem_arrange") > SeamMemory().taste(
        "stem_arrange"
    )


def test_a_shape_they_rated_bad_is_avoided():
    memory = SeamMemory.from_states([_state(rating="bad")])
    assert memory.disliked_shapes == [STRIP_AND_LAND]
    assert memory.liked_shapes == []
    assert (1, 2) not in memory.pair_shapes
    assert memory.bad_moves["stem_arrange"] == 1


def test_a_shape_nobody_has_rated_teaches_nothing():
    memory = SeamMemory.from_states([_state(rating=None)])
    assert memory.liked_shapes == []
    assert memory.disliked_shapes == []


def test_rating_something_selecta_arranged_teaches_it_too():
    memory = SeamMemory.from_states([_state("stem_arrange", "good", _another_shape())])
    assert memory.liked_shapes == [_another_shape()]
    assert memory.pair_shapes == {}, "only a shape they made is kept for one pair"
    memory = SeamMemory.from_states([_state("stem_arrange", "bad", _another_shape())])
    assert memory.disliked_shapes == [_another_shape()]
    assert memory.move_factor(1, 2, "stem_arrange") == 0.0, "not again on this pair"


def test_the_same_shape_twice_counts_once():
    memory = SeamMemory.from_states([_state(), _state(a=3, b=4)])
    assert memory.liked_shapes == [STRIP_AND_LAND]
    assert memory.good_moves["stem_arrange"] == 2


def test_the_energy_of_what_they_liked_is_remembered_too():
    state = _state()
    state["arc"] = [0.0, -1.0, -4.0, -4.0, -4.0, -6.0, -2.0, 0.0]
    memory = SeamMemory.from_states([state])
    assert memory.liked_arcs == [state["arc"]]
    taste = taste_from(memory)
    assert len(taste.arcs) == 2, "alongside the first one"


def test_a_taste_starts_from_the_first_seam_they_liked():
    taste = taste_from(SeamMemory())
    assert taste.liked == []
    assert (taste.arcs[0] == np.array(FIRST_ARC)).all()


def test_changing_a_rating_changes_what_is_learned():
    assert SeamMemory.from_states([_state(rating="bad")]).liked_shapes == []
    assert SeamMemory.from_states([_state(rating="good")]).disliked_shapes == []


def test_a_damaged_shape_is_ignored():
    state = _state()
    state["request"]["shape"] = "{not json"
    assert SeamMemory.from_states([state]).liked_shapes == []


# ---- which pairs can do it


def _pair(tmp_path, bpm_a=120, bpm_b=120):
    a = song_from_track(tmp_path, "a", make_track(bpm=bpm_a, bars=64, seed=1))
    b = song_from_track(tmp_path, "b", make_track(bpm=bpm_b, bars=64, seed=2))
    a.id, b.id = 1, 2
    a.title, b.title = "First", "Second"
    return a, b


def test_two_close_songs_can(tmp_path):
    assert can_arrange(*_pair(tmp_path, 120, 123)), "the pair the listener shaped was 2.5% apart"


def test_songs_far_apart_in_tempo_can_not_and_it_says_why(tmp_path):
    a, b = _pair(tmp_path, 120, 135)
    assert not can_arrange(a, b)
    assert "tempo" in why_it_cant(a, b)


def test_songs_with_a_shaky_beat_can_not(tmp_path):
    a, b = _pair(tmp_path)
    a.grid_confidence = 0.6
    assert "steadier" in why_it_cant(a, b)


def test_songs_far_apart_in_key_can_not(tmp_path):
    a, b = _pair(tmp_path)
    a.camelot, b.camelot = "1A", "7B"
    assert "key" in why_it_cant(a, b)


def test_songs_too_short_to_overlap_can_not(tmp_path):
    a = song_from_track(tmp_path, "a", make_track(bpm=120, bars=6, seed=1))
    b = song_from_track(tmp_path, "b", make_track(bpm=120, bars=6, seed=2))
    assert "clear bars" in why_it_cant(a, b)


def test_it_is_a_move_a_person_can_choose(tmp_path):
    a, b = _pair(tmp_path)
    assert MOVES["stem_arrange"][0] == "Strip and land"
    option = next(m for m in seam_options(a, b)["moves"] if m["name"] == "stem_arrange")
    assert option["available"] is True


def test_the_chooser_explains_when_it_can_not_be_chosen(tmp_path):
    a, b = _pair(tmp_path, 120, 135)
    option = next(m for m in seam_options(a, b)["moves"] if m["name"] == "stem_arrange")
    assert option["available"] is False
    assert "tempo" in option["reason"]


# ---- the render


def _fake_stems(monkeypatch, tmp_path):
    made = []

    def separate(_settings, source, start, seconds=46.0):
        audio, rate = sf.read(source, dtype="float32", always_2d=True)
        begin = int(start * rate)
        piece = audio[begin : begin + int(seconds * rate)]
        folder = tmp_path / f"stems{len(made)}"
        folder.mkdir()
        made.append(source)
        paths = {}
        for index, lane in enumerate(LANES):
            path = folder / f"{lane}.wav"
            sf.write(path, piece * (0.2 + 0.1 * index), rate)
            paths[lane] = path
        return SimpleNamespace(**paths)

    monkeypatch.setattr(studio_module, "separate_window", separate)
    monkeypatch.setattr(studio_module.dsp, "stretch_to_warp", lambda audio, *_: (audio, None))
    return made


@pytest.fixture
def arranged(tmp_path, monkeypatch):
    a, b = _pair(tmp_path)
    made = _fake_stems(monkeypatch, tmp_path)
    settings = Settings(tmp_path / "home")
    settings.home.mkdir()
    return settings, a, b, made


def test_it_renders_a_real_seam_and_keeps_the_shape_it_used(arranged):
    settings, a, b, _made = arranged
    rendered, report, why = _arranged(
        settings, SeamRequest(1, 2, "stem_arrange"), a, b, SeamMemory()
    )
    assert rendered.script.style == "stem_arrange"
    assert rendered.script.meta["shape"]["b"]["drums"][7] == 1
    assert report is not None
    assert "First" in why
    assert "Second" in why
    assert np.abs(rendered.audio).max() <= 1.0


def test_the_stems_are_only_split_once_and_are_shared_with_the_studio(arranged):
    settings, a, b, made = arranged
    request = SeamRequest(1, 2, "stem_arrange")
    _arranged(settings, request, a, b, SeamMemory())
    assert len(made) == 2
    _arranged(settings, request, a, b, SeamMemory())
    assert len(made) == 2


def test_a_shape_made_for_this_pair_is_what_gets_rendered(arranged):
    settings, a, b, _made = arranged
    theirs = clean_shape(_another_shape())
    memory = SeamMemory(pair_shapes={(1, 2): theirs})
    rendered, _report, _why = _arranged(
        settings, SeamRequest(1, 2, "stem_arrange"), a, b, memory
    )
    assert rendered.script.meta["shape"] == theirs


def test_when_it_can_not_work_it_says_why_so_the_next_move_gets_tried(arranged, monkeypatch):
    settings, a, b, _made = arranged
    monkeypatch.setattr(
        seams_module,
        "listen",
        lambda _folder, _seconds: _hearing(b_drums=[QUIET] * CELLS, b_bass=[QUIET] * CELLS),
    )
    with pytest.raises(seams_module.CannotRender, match="land"):
        _arranged(settings, SeamRequest(1, 2, "stem_arrange"), a, b, SeamMemory())


def _report(*names):
    failures = [SimpleNamespace(name=name, value=2.0, limit=1.0) for name in names]
    return SimpleNamespace(passed=not names, failures=failures)


def test_it_goes_again_with_a_fix_when_a_take_fails_its_checks(arranged, monkeypatch):
    settings, a, b, _made = arranged
    reports = [_report("harmony"), _report()]
    monkeypatch.setattr(seams_module, "audit", lambda _rendered: reports.pop(0))
    rendered, report, _why = _arranged(
        settings, SeamRequest(1, 2, "stem_arrange"), a, b, SeamMemory()
    )
    assert report.passed
    assert rendered.script.meta["shape"]["b"]["other"][:6] == [0, 0, 0, 0, 0, 0]


def test_it_gives_up_after_a_few_takes_and_keeps_the_closest(arranged, monkeypatch):
    settings, a, b, _made = arranged
    takes = []

    def never_passes(rendered):
        takes.append(rendered)
        return _report("harmony", "quiet time")

    monkeypatch.setattr(seams_module, "audit", never_passes)
    rendered, report, _why = _arranged(
        settings, SeamRequest(1, 2, "stem_arrange"), a, b, SeamMemory()
    )
    assert 1 <= len(takes) <= seams_module.TAKES
    assert not report.passed
    assert rendered is takes[0]


def test_the_energy_it_used_is_kept_for_learning(arranged):
    settings, a, b, _made = arranged
    rendered, _report_seen, _why = _arranged(
        settings, SeamRequest(1, 2, "stem_arrange"), a, b, SeamMemory()
    )
    assert len(rendered.script.meta["arc"]) == CELLS


def test_stems_that_have_been_cleared_get_split_again(arranged):
    settings, a, b, made = arranged
    request = SeamRequest(1, 2, "stem_arrange")
    _arranged(settings, request, a, b, SeamMemory())
    session_request = SeamRequest(1, 2, seams_module.STUDIO_SESSION)
    (settings.renders_dir / "seams" / session_request.key / "a_drums.flac").unlink()
    (settings.renders_dir / "seams" / session_request.key / "hearing.json").unlink()
    count = len(made)
    rendered, _report_seen, _why = _arranged(settings, request, a, b, SeamMemory())
    assert len(made) > count
    assert rendered.script.style == "stem_arrange"


def test_a_session_laid_out_for_the_studio_gets_reused(arranged):
    settings, a, b, made = arranged
    session_request = SeamRequest(1, 2, seams_module.STUDIO_SESSION)
    folder = settings.renders_dir / "seams" / session_request.key
    session = prepare_session(settings, a, b, folder)
    (folder / "session.json").write_text(json.dumps(session), "utf-8")
    count = len(made)
    _arranged(settings, SeamRequest(1, 2, "stem_arrange"), a, b, SeamMemory())
    assert len(made) == count


# ---- planning with it


def test_a_plan_can_choose_it(tmp_path):
    a, b = _pair(tmp_path)
    vibe = next(iter(BY_KEY.values()))
    assert "stem_arrange" in dict(_moves_that_fit(vibe, a, b, SeamMemory()))


def test_a_plan_does_not_choose_it_if_stems_are_turned_off(tmp_path):
    a, b = _pair(tmp_path)
    vibe = next(iter(BY_KEY.values()))
    assert "stem_arrange" not in dict(_moves_that_fit(vibe, a, b, SeamMemory(), "never"))


def test_a_plan_wants_it_more_once_they_have_liked_one(tmp_path):
    a, b = _pair(tmp_path)
    vibe = next(iter(BY_KEY.values()))
    before = dict(_moves_that_fit(vibe, a, b, SeamMemory()))["stem_arrange"]
    after = dict(_moves_that_fit(vibe, a, b, SeamMemory.from_states([_state(a=8, b=9)])))
    assert after["stem_arrange"] > before


def test_a_plan_does_not_repeat_what_they_rated_bad_on_that_pair(tmp_path):
    a, b = _pair(tmp_path)
    vibe = next(iter(BY_KEY.values()))
    memory = SeamMemory.from_states([_state("stem_arrange", "bad", _another_shape())])
    assert "stem_arrange" not in dict(_moves_that_fit(vibe, a, b, memory))


def test_it_can_not_take_over_a_mix():
    assert MAX_SHARE["stem_arrange"] <= 0.25


def test_it_is_tried_when_a_planned_move_falls_through():
    from collections import Counter

    order = fallback_order(1, 2, True, Counter(), can_strip=True)
    assert order.index("stem_arrange") < order.index("reverb_wash")
    assert "stem_arrange" not in fallback_order(1, 2, True, Counter(), can_strip=False)


def test_a_near_miss_is_not_worth_minutes_of_splitting_stems(tmp_path, monkeypatch):
    store = SeamStore(Settings(tmp_path))
    a, b = _pair(tmp_path)
    asked = []

    def take(_a, _b, move, _tried, _leave_after=None):
        asked.append(move)
        return None

    monkeypatch.setattr(store, "_take", take)
    near = ("rendered", SimpleNamespace(passed=False), "why", "filter_sweep")
    monkeypatch.setattr(seams_module, "can_arrange", lambda *_: True)
    store._best_move(a, b, [], near=near)
    assert "stem_arrange" not in asked
