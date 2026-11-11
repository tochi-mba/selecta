"""S4-0101-03 and S4-0101-04: the transition inspector's choices, held to what came before 4.0.

S4-0101-03: the move chooser still offers every move it offered before Selecta 4.0 (frozen below
from base 9b663f9f), with the same names and words, and anything it can't use carries a reason.

S4-0101-04: each setting a person can make (the move, the overlap length, where the first song is
left, where the second comes in, the phrase) is saved exactly as sent, in the current mix and in a
draft, cleared when sent empty, and refused in plain words when it falls outside the songs, with
the saved settings left as they were.
"""

from __future__ import annotations

import pytest
from helpers import song_from_track
from synth import make_track
from test_api_contracts import (  # noqa: F401 - pytest fixtures shared with the contract tests
    _fill,
    _somewhere_for_files,
    client,
    conn,
    settings,
)

from selecta.routes.edit import MOST_OVERLAP_BARS
from selecta.seam_kinds import MOVES, NOT_IN_THE_CHOOSER
from selecta.seams import seam_options

# The chooser at base 9b663f9f (before PR #29), name -> label. Its descriptions were the same.
BEFORE_4 = {
    "auto": "Let Selecta pick",
    "bass_swap_blend": "Blend",
    "vocal_ride": "Vocal ride",
    "stem_arrange": "Strip and land",
    "stem_intertwine": "Intertwined stems",
    "filter_sweep": "Filter sweep",
    "tempo_ramp": "Tempo ramp",
    "word_blend": "Word blend",
    "word_exchange": "Call and response",
    "phrase_roll": "Phrase roll",
    "word_cut": "Word cut",
    "cut_on_one": "Cut",
    "echo_out": "Echo out",
    "delay_throw": "Delay throw",
    "reverb_wash": "Reverb wash",
}

# test_api_contracts' songs each have two bars
BARS_IN_A_SONG = 2


def _settings(client, draft=None):  # noqa: F811
    query = f"?draft={draft}" if draft is not None else ""
    saved = client.get(f"/api/mix{query}").json()["mix"][1]["seam"]["settings"]
    # every choice made here is the person's own, which the server records beside it as soft=False
    assert saved.pop("soft", False) is False
    return saved


@pytest.mark.parametrize(("bpm_a", "bpm_b"), [(120, 121), (120, 135)])
def test_every_move_offered_before_4_is_still_offered_with_its_words(tmp_path, bpm_a, bpm_b):
    a = song_from_track(tmp_path, "a", make_track(bpm=bpm_a, bars=32, seed=1))
    b = song_from_track(tmp_path, "b", make_track(bpm=bpm_b, bars=32, seed=2))
    a.id, b.id = 1, 2
    offered = {move["name"]: move for move in seam_options(a, b)["moves"]}
    assert {name: offered[name]["label"] for name in BEFORE_4} == BEFORE_4
    assert set(offered) == set(MOVES) - NOT_IN_THE_CHOOSER
    for name, move in offered.items():
        assert move["description"] == MOVES[name][1]
        # nothing is greyed out without saying why, and nothing with a reason can be chosen
        assert move["available"] is (move["reason"] is None)
        if not move["available"]:
            assert move["reason"].strip()
    # the far-apart pair really does rule some out, so the reasons above were exercised
    if bpm_b == 135:
        assert any(not move["available"] for move in offered.values())


@pytest.mark.parametrize("name", sorted(BEFORE_4))
def test_every_move_before_4_can_still_be_saved(client, conn, name):  # noqa: F811
    _fill(conn, 1, 2)
    conn.commit()
    answer = client.post("/api/mix/1/seam", json={"move": name})
    assert answer.status_code == 200, answer.text
    assert _settings(client)["move"] == name


CHOICES = [
    {"move": "bass_swap_blend", "bars": 1},
    {"move": "bass_swap_blend", "bars": MOST_OVERLAP_BARS},
    {"move": "echo_out", "exit_bar": 0, "entry_bar": 0},
    {"move": "echo_out", "exit_bar": BARS_IN_A_SONG - 1, "entry_bar": BARS_IN_A_SONG - 1},
    {"move": "word_cut", "phrase": "night time"},
    {"move": "vocal_ride", "bars": 12, "exit_bar": 1, "entry_bar": 0},
]


@pytest.mark.parametrize("choice", CHOICES)
def test_each_setting_is_saved_exactly_at_its_edges(client, conn, choice):  # noqa: F811
    _fill(conn, 1, 2)
    conn.commit()
    answer = client.post("/api/mix/1/seam", json=choice)
    assert answer.status_code == 200, answer.text
    assert _settings(client) == choice


def test_settings_are_saved_exactly_in_a_draft_too_and_never_reach_the_current_mix(
    client, conn  # noqa: F811
):
    _fill(conn, 1, 2)
    conn.commit()
    draft = client.post("/api/drafts", json={"copy_current": True}).json()["id"]
    choice = {"move": "echo_out", "bars": 8, "exit_bar": 1, "entry_bar": 0}
    assert client.post(f"/api/mix/1/seam?draft={draft}", json=choice).status_code == 200
    assert _settings(client, draft) == choice
    assert _settings(client).get("exit_bar") is None


def test_a_cue_sent_empty_goes_back_to_wherever_is_best(client, conn):  # noqa: F811
    _fill(conn, 1, 2)
    conn.commit()
    client.post("/api/mix/1/seam", json={"move": "echo_out", "exit_bar": 1, "entry_bar": 1})
    cleared = {"move": "echo_out", "exit_bar": None, "entry_bar": 1}
    assert client.post("/api/mix/1/seam", json=cleared).status_code == 200
    assert _settings(client) == {"move": "echo_out", "entry_bar": 1}


@pytest.mark.parametrize(
    ("choice", "words"),
    [
        ({"bars": 0}, "between 1 and"),
        ({"bars": MOST_OVERLAP_BARS + 1}, "between 1 and"),
        ({"exit_bar": -1}, "leave the first song"),
        ({"exit_bar": BARS_IN_A_SONG}, f"has {BARS_IN_A_SONG} bars"),
        ({"entry_bar": -1}, "bring in the second song"),
        ({"entry_bar": BARS_IN_A_SONG}, "bring in the second song"),
    ],
)
def test_a_setting_outside_the_songs_is_refused_and_changes_nothing(
    client, conn, choice, words  # noqa: F811
):
    _fill(conn, 1, 2)
    conn.commit()
    kept = {"move": "echo_out", "bars": 8, "exit_bar": 1}
    client.post("/api/mix/1/seam", json=kept)
    refused = client.post("/api/mix/1/seam", json={"move": "echo_out", **choice})
    assert refused.status_code == 422
    assert words in refused.json()["detail"]
    assert _settings(client) == kept


def test_a_cue_for_a_song_whose_bars_are_unknown_is_kept_for_the_render_to_place(
    client, conn, monkeypatch  # noqa: F811
):
    _fill(conn, 1, 2)
    conn.commit()

    def not_analysed(*_args):
        raise KeyError("not analysed")

    monkeypatch.setattr("selecta.analysis.song.load_song", not_analysed)
    assert client.post("/api/mix/1/seam", json={"move": "echo_out", "exit_bar": 40}).status_code == 200
    assert _settings(client)["exit_bar"] == 40
