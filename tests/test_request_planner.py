from types import SimpleNamespace as NS

from selecta.request_planner import proposals


def test_waiting_request_does_not_block_fit_and_known_failures_are_not_retried(monkeypatch):
    songs = [
        NS(id=i, bpm=120, exit_cues=lambda: [], entry_cues=lambda: []) for i in (1, 2, 3, 8, 9)
    ]
    monkeypatch.setattr(
        "selecta.request_planner.handoff_quality",
        lambda a, b, riders: 0.9 if (a.id, b.id) in {(2, 9), (9, 3)} else 0,
    )
    candidate = NS(
        recipe=NS(name="bass_swap_blend"), bars=8, exit_cue=NS(bar=16), entry_cue=NS(bar=0), score=1
    )
    monkeypatch.setattr(
        "selecta.request_planner.enumerate_candidates", lambda *a, **kw: [candidate]
    )
    memory = NS(move_factor=lambda *a: 1)
    requests = [dict(id=1, song_id=8), dict(id=2, song_id=9)]
    order = [(1, None, 0), (2, None, 0), (3, None, 0)]
    result = proposals(requests, order, songs, 1, memory, lambda key: {"status": "none"})
    assert result[0]["plan"] is None
    assert result[1]["plan"]["position"] == 2
    assert len(result[1]["plan"]["seams"]) == 2
    failed = proposals(requests, order, songs, 1, memory, lambda key: {"status": "failed"})
    assert all(row["plan"] is None for row in failed)
    warned = proposals(
        requests,
        order,
        songs,
        1,
        memory,
        lambda key: {"status": "ready", "passed": False},
    )
    assert all(row["plan"] is None for row in warned)
    assert order == [(1, None, 0), (2, None, 0), (3, None, 0)]


def test_missing_analysis_and_existing_song_have_distinct_waiting_reasons():
    rows = [dict(id=1, song_id=9), dict(id=2, song_id=1)]
    result = proposals(rows, [(1, None, 0)], [], 0, NS(), lambda key: {})
    assert "analysis" in result[0]["reason"]
    assert "already" in result[1]["reason"]


def _pair_setup(monkeypatch, recipes):
    songs = [NS(id=i, bpm=120, exit_cues=lambda: [], entry_cues=lambda: []) for i in (1, 2, 9)]
    monkeypatch.setattr("selecta.request_planner.handoff_quality", lambda *a: 0.9)
    monkeypatch.setattr(
        "selecta.request_planner.enumerate_candidates",
        lambda a, b, name=None, **kw: [NS(score=0.7)] if name in recipes else [],
    )
    return songs


REQUEST = [dict(id=1, song_id=9)]
ORDER = [(1, None, 0), (2, None, 0)]


def _plan(songs, state_of, memory=None, **options):
    memory = memory or NS(move_factor=lambda *a: 1)
    return proposals(REQUEST, ORDER, songs, 0, memory, state_of, **options)[0]["plan"]


def test_a_move_is_asked_to_find_its_own_placement(monkeypatch):
    """Pinning one exact placement meant most tries failed, and the request hopped along the mix."""
    songs = _pair_setup(monkeypatch, {"bass_swap_blend"})
    plan = _plan(songs, lambda key: {"status": "none"})
    assert plan["seams"][0] == {"move": "bass_swap_blend", "from_request": True}
    assert "exit_bar" not in plan["seams"][0]


def test_when_a_blend_fails_it_tries_other_moves_before_leaving_that_spot(monkeypatch):
    from selecta.seams import request_from

    songs = _pair_setup(monkeypatch, {"bass_swap_blend", "filter_sweep", "delay_throw"})
    failed = {
        request_from(a, 9, {"move": "bass_swap_blend", "from_request": True}).key for a in (1, 2)
    }

    def state_of(key):
        return {"status": "failed"} if key in failed else {"status": "none"}

    plan = _plan(songs, state_of)
    assert plan["position"] == 1, "the same spot, by another way"
    assert plan["seams"][0]["move"] == "filter_sweep"


def test_a_move_that_already_came_out_clean_goes_first(monkeypatch):
    from selecta.seams import request_from

    songs = _pair_setup(monkeypatch, {"bass_swap_blend", "delay_throw"})
    clean = request_from(1, 9, {"move": "delay_throw", "from_request": True}).key

    def state_of(key):
        return {"status": "ready", "passed": True} if key == clean else {"status": "none"}

    assert _plan(songs, state_of)["seams"][0]["move"] == "delay_throw"


def test_a_near_miss_counts_only_when_nothing_else_is_left(monkeypatch):
    from selecta.seams import request_from

    songs = _pair_setup(monkeypatch, {"bass_swap_blend", "delay_throw"})
    near = {
        request_from(a, b, {"move": "bass_swap_blend", "from_request": True}).key
        for a, b in ((1, 9), (9, 2))
    }

    def trying_others(key):
        if key in near:
            return {"status": "ready", "passed": False, "near_miss": True}
        return {"status": "none"}

    assert _plan(songs, trying_others)["seams"][0]["move"] == "delay_throw"

    def nothing_else(key):
        if key in near:
            return {"status": "ready", "passed": False, "near_miss": True}
        return {"status": "failed"}

    assert _plan(songs, nothing_else)["seams"][0]["move"] == "bass_swap_blend"


def test_a_bare_cut_is_never_planned_for_a_request(monkeypatch):
    songs = _pair_setup(monkeypatch, {"cut_on_one"})
    assert _plan(songs, lambda key: {"status": "none"}) is None


def test_a_vocal_ride_is_tried_only_when_stems_are_allowed(monkeypatch):
    songs = _pair_setup(monkeypatch, {"delay_throw"})
    monkeypatch.setattr("selecta.request_planner.modes_for", lambda *a: ("word_blend",))
    monkeypatch.setattr("selecta.request_planner.ride_lines", lambda *a: ("line", "line"))
    assert _plan(songs, lambda key: {"status": "none"}, stems="never")["seams"][0]["move"] == (
        "delay_throw"
    )
    assert _plan(songs, lambda key: {"status": "none"}, stems="sometimes")["seams"][0]["move"] == (
        "vocal_ride"
    )


def test_a_song_set_to_never_play_says_so():
    rows = [dict(id=1, song_id=9, never=True)]
    assert proposals(rows, [(1, None, 0)], [], 0, NS(), lambda key: {})[0]["stage"] == "never"


def test_a_song_still_being_analysed_is_told_apart_from_one_that_cannot_be_placed():
    rows = [dict(id=1, song_id=9, waiting_on="analysis"), dict(id=2, song_id=8)]
    result = proposals(rows, [(1, None, 0)], [], 0, NS(), lambda key: {})
    assert result[0]["stage"] == "analysing"
    assert result[1]["stage"] == "no_cues"

