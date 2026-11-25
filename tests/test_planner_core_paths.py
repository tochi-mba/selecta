"""Every name that moved into the planner core is still the same object at its old path."""

from __future__ import annotations

import importlib

import pytest

# modules that moved whole: the old path is the very same module object
WHOLE = {
    "selecta.planner.fit": "selecta.planner_core.fit",
    "selecta.planner.memory": "selecta.planner_core.memory",
    "selecta.planner.arc": "selecta.planner_core.arc",
    "selecta.planner.moods": "selecta.planner_core.moods",
    "selecta.planner.beam": "selecta.planner_core.beam",
    "selecta.planner.vibes": "selecta.planner_core.vibes",
    "selecta.styles.blend": "selecta.planner_core.recipes.blend",
    "selecta.styles.exits": "selecta.planner_core.recipes.exits",
    "selecta.styles.timing": "selecta.planner_core.recipes.timing",
}

# names that moved out of modules that stay: (old module, new module, names)
PARTS = [
    (
        "selecta.planner.choose",
        "selecta.planner_core.choose",
        [
            "BLEND_MAX_GAP",
            "BLEND_MIN_CONFIDENCE",
            "HOOK_IN_FADE_PENALTY",
            "LEVEL_FALL_FREE_DB",
            "LEVEL_RISE_FREE_DB",
            "SHORT_OVERLAP_BARS",
            "SHORT_OVERLAP_COST",
            "_BLEND_BARS_BY_FAMILY",
            "Candidate",
            "_key",
            "_score",
            "_style_fit",
            "enumerate_candidates",
            "fallback_candidate",
            "styles_for_language",
            "tempo_gap",
        ],
    ),
    ("selecta.planner.choose", "selecta.planner_core.repair", ["MAX_REPAIRS"]),
    (
        "selecta.planner.wordreel",
        "selecta.planner_core.wordreel",
        [
            "BLEND_MAX_GAP",
            "BLEND_MAX_KEY_DISTANCE",
            "BLEND_MIN_GRID",
            "CUT_MAX_GAP",
            "DEFAULT_QUOTAS",
            "LINE_SEARCH_AFTER",
            "MAX_TIMBRE",
            "MIN_RIDE_SINGING",
            "MODE_PAYOFF",
            "RIDE_BARS",
            "RIDE_LENGTHS",
            "ROLL_MIN_TEMPO_RATIO",
            "WINDOW_LEAD",
            "WINDOW_TAIL",
            "line_window",
            "modes_for",
            "music_fit",
            "rank_links",
            "ride_entry_line",
            "ride_exit_line",
            "ride_lengths",
            "ride_lines",
            "roll_suits",
        ],
    ),
    ("selecta.styles", "selecta.planner_core.recipes", ["MakeScript", "Recipe", "all_recipes"]),
    ("selecta.styles.wordplay", "selecta.planner_core.fit", ["felt_bpm", "pulse"]),
    ("selecta.lyrics.lrclib", "selecta.planner_core.names", ["clean_artist"]),
    ("selecta.analysis.vocal_sense", "selecta.planner_core.moves", ["sense_on"]),
    (
        "selecta.seam_kinds",
        "selecta.planner_core.moves",
        ["MOVE_FLAGS", "STUDIO_SESSION", "move_on"],
    ),
    ("selecta.seam_kinds", "selecta.planner_core.repair", ["NEAR_MISS"]),
    (
        "selecta.audit.checks",
        "selecta.planner_core.harmony",
        ["HARMONY_LIMIT", "_ROUGHNESS_BY_INTERVAL", "_roughness", "excess_roughness"],
    ),
    ("selecta.arrange", "selecta.planner_core.stem_gates", ["can_arrange", "why_it_cant"]),
    ("selecta.studio", "selecta.planner_core.stem_gates", ["Placement", "find_placement"]),
    ("selecta.render.intertwine", "selecta.planner_core.stem_gates", ["can_intertwine"]),
]

# constants that kept their old names over the core's clearer ones
GATES = "selecta.planner_core.stem_gates"
RENAMED = [
    ("selecta.studio", "OVERLAP_BARS", GATES, "STUDIO_OVERLAP_BARS"),
    ("selecta.studio", "MAX_TEMPO_GAP", GATES, "STUDIO_MAX_TEMPO_GAP"),
    ("selecta.studio", "MIN_GRID", GATES, "STUDIO_MIN_GRID"),
    ("selecta.arrange", "CLOSE_TEMPO", GATES, "ARRANGE_CLOSE_TEMPO"),
    ("selecta.arrange", "SHORTEST_OVERLAP", GATES, "ARRANGE_SHORTEST_OVERLAP"),
    ("selecta.arrange", "MIN_GRID", GATES, "ARRANGE_MIN_GRID"),
    ("selecta.render.intertwine", "_pair_that_fits", GATES, "intertwine_cues"),
    ("selecta.library.scan", "_ARTIST_SPLIT", "selecta.planner_core.names", "ARTIST_SPLIT"),
]


@pytest.mark.parametrize(("old", "new"), sorted(WHOLE.items()))
def test_a_module_that_moved_whole_is_the_same_module_at_its_old_path(old, new):
    assert importlib.import_module(old) is importlib.import_module(new)


def test_the_old_paths_export_the_same_objects():
    assert importlib.import_module("selecta.planner.fit").folded_gap is (
        importlib.import_module("selecta.planner_core.fit").folded_gap
    )
    for old, new, names in PARTS:
        before, after = importlib.import_module(old), importlib.import_module(new)
        for name in names:
            assert getattr(before, name) is getattr(after, name), f"{old}.{name}"


@pytest.mark.parametrize(("old", "name", "core", "core_name"), RENAMED)
def test_renamed_constants_are_the_cores_values(old, name, core, core_name):
    before = getattr(importlib.import_module(old), name)
    assert before is getattr(importlib.import_module(core), core_name)


def test_the_planner_kept_its_values():
    from selecta.planner_core import fit, memory, repair, stem_gates, wordreel

    assert memory.RULES_VERSION == 1
    assert repair.MAX_REPAIRS == 4
    assert repair.NEAR_MISS == {"beat alignment": 20.0, "level fall": 3.0, "entry level": 1.5}
    assert fit.CLOSE_TEMPO == 0.045 and fit.FAR_KEYS == 5 and fit.STEADY_GRID == 0.8
    assert wordreel.CUT_MAX_GAP == 0.06 and wordreel.BLEND_MAX_GAP == 0.08
    assert stem_gates.STUDIO_OVERLAP_BARS == (16, 12, 8)
    assert stem_gates.ARRANGE_SHORTEST_OVERLAP == 12
