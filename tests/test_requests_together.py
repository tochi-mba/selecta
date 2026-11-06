"""Requests are planned together, and what's been worked out about pairs of songs is kept."""

from __future__ import annotations

import json
from types import SimpleNamespace as NS

import pytest

import selecta.request_planner as planner
from selecta.planner.memory import SeamMemory
from selecta.request_planner import PairBook, bridge_options, proposals, same_song


def _song(song_id, title=None, artist=None, bpm=120.0, camelot="8A"):
    return NS(
        id=song_id,
        title=title or f"Song {song_id}",
        artist=artist or f"Artist {song_id}",
        bpm=bpm,
        camelot=camelot,
        exit_cues=lambda: [],
        entry_cues=lambda: [],
    )


def _wire(monkeypatch, fits, moves=("bass_swap_blend",)):
    """`fits` says which pairs can go together, or how well, by (a, b)."""

    def quality(a, b, _riders):
        if callable(fits):
            return fits(a.id, b.id)
        return fits.get((a.id, b.id), 0) if isinstance(fits, dict) else 0.9 * ((a.id, b.id) in fits)

    work = []

    def candidates(a, b, name=None, **_kw):
        work.append((a.id, b.id, name))
        return [NS(score=0.7)] if name in moves else []

    monkeypatch.setattr(planner, "handoff_quality", quality)
    monkeypatch.setattr(planner, "enumerate_candidates", candidates)
    return work


def _rows(*song_ids, **more):
    return [
        {"id": index, "song_id": song, "title": f"Song {song}", "available": 1, **more}
        for index, song in enumerate(song_ids, start=1)
    ]


def _items(*songs):
    return [(song, None, 0) for song in songs]


def _plan(rows, order, songs, protected=0, **options):
    return proposals(
        rows,
        _items(*order),
        songs,
        protected,
        SeamMemory(),
        lambda _k: {"status": "none"},
        **options,
    )


def _all_songs(results):
    return [song for row in results if row["plan"] for song in row["plan"]["songs"]]


def test_a_requested_song_is_never_also_a_bridge_for_another_request(monkeypatch):
    """The Fate of Ophelia was asked for, and chosen as the way into I AM as well."""
    songs = [_song(i) for i in (1, 2, 3, 7, 8, 9)]
    _wire(
        monkeypatch,
        {(1, 8), (8, 2), (2, 8), (8, 9), (9, 3), (2, 7), (7, 9)},
    )
    first, second = _plan(_rows(8, 9), [1, 2, 3], songs)
    assert first["plan"]["songs"] == [8]
    assert second["plan"]["songs"] == [7, 9]
    assert second["plan"]["bridges"] == [7]


def test_not_even_when_the_later_request_is_the_one_that_could_use_it(monkeypatch):
    songs = [_song(i) for i in (1, 2, 3, 8, 9)]
    _wire(monkeypatch, {(2, 9), (9, 8), (8, 3), (1, 9), (9, 2)})
    results = _plan(_rows(8, 9), [1, 2, 3], songs)
    assert 8 not in _all_songs(results[1:]) or results[1]["plan"]["songs"] == [9]


def test_two_requests_never_go_in_the_same_spot(monkeypatch):
    """Two songs both said they'd come straight after Opalite."""
    songs = [_song(i) for i in (1, 2, 3, 8, 9)]
    _wire(monkeypatch, {(2, 8), (8, 3), (2, 9), (9, 3)})
    first, second = _plan(_rows(8, 9), [1, 2, 3], songs, protected=1)
    assert first["plan"]["position"] == 2
    assert second["plan"] is None


def test_the_second_says_who_it_is_waiting_for(monkeypatch):
    songs = [_song(i) for i in (1, 2, 3, 8, 9)]
    _wire(monkeypatch, {(2, 8), (8, 3), (2, 9), (9, 3)})
    second = _plan(_rows(8, 9), [1, 2, 3], songs, protected=1)[1]
    assert second["behind"] == "Song 8"
    assert second["stage"] == "searching"


def test_it_waits_rather_than_asking_about_an_extra_song_it_does_not_need(monkeypatch):
    songs = [_song(i) for i in (1, 2, 3, 7, 8, 9)]
    _wire(monkeypatch, {(2, 8), (8, 3), (2, 9), (9, 3), (3, 7), (7, 9)})
    second = _plan(_rows(8, 9), [1, 2, 3], songs, protected=1)[1]
    assert second["plan"] is None
    assert second["behind"] == "Song 8"


def test_the_second_takes_its_own_spot_if_there_is_one(monkeypatch):
    songs = [_song(i) for i in (1, 2, 3, 4, 8, 9)]
    _wire(monkeypatch, {(1, 8), (8, 2), (1, 9), (9, 2), (2, 9), (9, 3)})
    first, second = _plan(_rows(8, 9), [1, 2, 3, 4], songs)
    assert first["plan"]["position"] == 1
    assert second["plan"]["position"] == 2


def test_the_oldest_request_chooses_first(monkeypatch):
    songs = [_song(i) for i in (1, 2, 3, 8, 9)]
    _wire(monkeypatch, {(2, 8), (8, 3), (2, 9), (9, 3)})
    assert _plan(_rows(9, 8), [1, 2, 3], songs, protected=1)[0]["plan"]["songs"] == [9]


def test_however_many_there_are_no_song_or_spot_is_used_twice(monkeypatch):
    songs = [_song(i) for i in range(1, 30)]
    _wire(monkeypatch, lambda _a, _b: 0.9)
    results = _plan(_rows(*range(10, 22)), list(range(1, 8)), songs)
    used = _all_songs(results)
    spots = [row["plan"]["position"] for row in results if row["plan"]]
    assert len(used) == len(set(used))
    assert not set(used) & set(range(1, 8))
    assert len(spots) == len(set(spots))
    assert len(spots) == 7


def test_no_spot_is_used_twice_with_bridges_either(monkeypatch):
    songs = [_song(i) for i in range(1, 40)]

    def only_through_bridges(a, b):
        return 0.0 if {a, b} & {10, 11, 12} and not ({a, b} & set(range(20, 40))) else 0.9

    _wire(monkeypatch, only_through_bridges)
    results = _plan(_rows(10, 11, 12), [1, 2, 3, 4, 5, 6], songs)
    used = _all_songs(results)
    assert len(used) == len(set(used))
    assert len({row["plan"]["position"] for row in results}) == 3


def test_a_results_row_stays_in_the_order_it_was_asked(monkeypatch):
    songs = [_song(i) for i in (1, 2, 8, 9)]
    _wire(monkeypatch, {(1, 8), (8, 2), (1, 9), (9, 2)})
    rows = _rows(8, 9)
    rows[1]["picked"] = [9]
    assert [row["song_id"] for row in _plan(rows, [1, 2], songs)] == [8, 9]


# ---- the same song by another name


@pytest.mark.parametrize(
    "other",
    [
        "Tonight (Extended)",
        "Tonight [Remastered 2011]",
        "Tonight - Radio Edit",
        "TONIGHT",
        "Tonight (feat. Someone Else)",
    ],
)
def test_another_version_of_a_song_is_the_same_song(other):
    assert same_song(_song(1, "Tonight", "Someone")) == same_song(_song(2, other, "Someone"))


def test_a_different_artist_singing_the_same_title_is_a_different_song():
    assert same_song(_song(1, "Tonight", "One")) != same_song(_song(2, "Tonight", "Other"))


def test_songs_with_no_title_are_not_all_the_same_song():
    assert same_song(NS(id=1)) != same_song(NS(id=2))


def test_another_version_of_something_in_the_mix_is_not_a_bridge(monkeypatch):
    songs = [_song(1, "Tonight", "Someone"), _song(2), _song(7, "Tonight (Extended)", "Someone")]
    songs += [_song(6), _song(9)]
    _wire(monkeypatch, {(1, 7), (7, 9), (9, 2), (1, 6), (6, 9)})
    assert _plan(_rows(9), [1, 2], songs)[0]["plan"]["bridges"] == [6]


def test_another_version_of_a_request_is_not_its_bridge(monkeypatch):
    songs = [_song(1), _song(2), _song(7, "Wanted (Extended)", "A"), _song(9, "Wanted", "A")]
    _wire(monkeypatch, {(1, 7), (7, 9), (9, 2)})
    assert _plan(_rows(9), [1, 2], songs)[0]["plan"] is None


def test_something_set_aside_is_not_a_bridge(monkeypatch):
    songs = [_song(i) for i in (1, 2, 6, 7, 9)]
    _wire(monkeypatch, {(1, 7), (7, 9), (9, 2), (1, 6), (6, 9)})
    plan = _plan(_rows(9), [1, 2], songs, allowed={1, 2, 6, 9})[0]["plan"]
    assert plan["bridges"] == [6]


def test_two_extra_songs_are_never_the_same_song(monkeypatch):
    songs = [_song(1), _song(2), _song(3), _song(6, "Hit", "A"), _song(7, "Hit (Live)", "A")]
    songs += [_song(9)]
    _wire(monkeypatch, {(1, 6), (6, 9), (9, 7), (7, 2)})
    assert _plan(_rows(9), [1, 2, 3], songs)[0]["plan"] is None


# ---- choosing a bridge


def test_the_best_bridge_is_chosen_not_the_first(monkeypatch):
    songs = [_song(i) for i in (1, 2, 6, 7, 9)]
    _wire(
        monkeypatch,
        {(1, 6): 0.55, (6, 9): 0.55, (1, 7): 1.0, (7, 9): 1.0, (9, 2): 1.0},
    )
    assert _plan(_rows(9), [1, 2], songs)[0]["plan"]["bridges"] == [7]


def test_a_chain_is_only_as_good_as_its_weakest_link(monkeypatch):
    songs = [_song(i) for i in (1, 2, 6, 7, 9)]
    _wire(
        monkeypatch,
        {(1, 6): 1.0, (6, 9): 0.5, (1, 7): 0.8, (7, 9): 0.8, (9, 2): 0.8},
    )
    assert _plan(_rows(9), [1, 2], songs)[0]["plan"]["bridges"] == [7]


def test_a_bridge_can_lead_out_as_well_as_in(monkeypatch):
    songs = [_song(i) for i in (1, 2, 7, 9)]
    _wire(monkeypatch, {(1, 9), (9, 7), (7, 2)})
    assert _plan(_rows(9), [1, 2], songs)[0]["plan"]["songs"] == [9, 7]


def test_someone_who_said_no_to_a_bridge_is_not_offered_one(monkeypatch):
    songs = [_song(i) for i in (1, 2, 7, 9)]
    _wire(monkeypatch, {(1, 7), (7, 9), (9, 2)})
    assert _plan(_rows(9, bridge_choice=False), [1, 2], songs)[0]["plan"] is None


def test_and_it_does_not_hold_a_spot_or_a_song_while_saying_no(monkeypatch):
    songs = [_song(i) for i in (1, 2, 7, 8, 9)]
    _wire(monkeypatch, {(1, 7), (7, 9), (9, 2), (7, 8), (8, 2)})
    rows = _rows(9, 8)
    rows[0]["bridge_choice"] = False
    _first, second = _plan(rows, [1, 2], songs)
    assert second["plan"]["songs"] == [7, 8]


def test_a_chosen_route_is_used_even_if_something_else_would_fit(monkeypatch):
    songs = [_song(i) for i in (1, 2, 7, 9)]
    _wire(monkeypatch, {(1, 9), (9, 2), (1, 7), (7, 9)})
    plan = _plan(_rows(9, picked=[7, 9], bridge_choice=True), [1, 2], songs)[0]["plan"]
    assert plan["songs"] == [7, 9]


def test_a_chosen_route_moves_along_the_mix_with_the_same_songs(monkeypatch):
    songs = [_song(i) for i in (1, 2, 3, 4, 7, 9)]
    _wire(monkeypatch, {(1, 7), (7, 9), (9, 2), (3, 7), (9, 4)})
    rows = _rows(9, picked=[7, 9])
    assert _plan(rows, [1, 2, 3, 4], songs)[0]["plan"]["position"] == 1
    assert _plan(rows, [1, 2, 3, 4], songs, protected=2)[0]["plan"]["position"] == 3


def test_a_route_that_stops_working_says_so_and_looks_for_something_else(monkeypatch):
    songs = [_song(i) for i in (1, 2, 7, 9)]
    _wire(monkeypatch, {(1, 9), (9, 2)})
    row = _plan(_rows(9, picked=[7, 9]), [1, 2], songs)[0]
    assert row["bridge_lost"] is True
    assert row["plan"]["songs"] == [9]


def test_a_chosen_bridge_that_has_gone_in_the_mix_can_not_be_used(monkeypatch):
    songs = [_song(i) for i in (1, 2, 7, 9)]
    _wire(monkeypatch, {(1, 7), (7, 9), (9, 2), (2, 7)})
    row = _plan(_rows(9, picked=[7, 9]), [1, 7, 2], songs)[0]
    assert row["bridge_lost"] is True


def test_nobody_else_can_take_a_song_someone_has_chosen(monkeypatch):
    songs = [_song(i) for i in (1, 2, 3, 7, 8, 9)]
    _wire(monkeypatch, {(2, 7), (7, 9), (9, 3), (1, 7), (7, 8), (8, 2)})
    rows = _rows(8, 9)
    rows[1]["picked"] = [7, 9]
    older, chosen = _plan(rows, [1, 2, 3], songs)
    assert chosen["plan"]["songs"] == [7, 9]
    assert older["plan"] is None


def test_pairs_found_not_to_work_are_avoided(monkeypatch):
    songs = [_song(i) for i in (1, 2, 3, 9)]
    _wire(monkeypatch, {(1, 9), (9, 2), (2, 9), (9, 3)})
    plan = _plan(_rows(9), [1, 2, 3], songs, avoid={(1, 9)})[0]["plan"]
    assert plan["position"] == 2


# ---- finding a bridge


def _search(rows, order, songs, protected=0, **options):
    return bridge_options(
        rows[0],
        rows,
        _items(*order),
        songs,
        protected,
        SeamMemory(),
        lambda _key: {"status": "none"},
        **options,
    )


def test_it_goes_through_every_song_not_just_a_shortlist(monkeypatch):
    far_away = _song(99, bpm=240.0)
    songs = [_song(1), _song(2), _song(9), far_away, *[_song(i) for i in range(10, 90)]]
    _wire(monkeypatch, {(1, 99), (99, 9), (9, 2)})
    found = _search(_rows(9), [1, 2], songs)
    assert found["routes"][0]["bridges"] == [99]
    assert found["looked_at"] == 81


def test_it_shows_the_best_few_best_first(monkeypatch):
    songs = [_song(1), _song(2), _song(9), *[_song(i) for i in range(10, 22)]]

    def fits(a, b):
        if (a, b) == (9, 2):
            return 1.0
        return 0.5 + (max(a, b) % 100) / 100 if 9 in (a, b) or a == 1 else 0

    _wire(monkeypatch, fits)
    routes = _search(_rows(9), [1, 2], songs)["routes"]
    assert len(routes) == 5
    assert routes[0]["bridges"] == [21]


def test_one_artist_does_not_fill_the_list(monkeypatch):
    songs = [_song(1), _song(2), _song(9)]
    songs += [_song(i, artist="Same One") for i in range(10, 16)]
    songs += [_song(30)]
    _wire(monkeypatch, lambda a, b: 0.9 if (9 in (a, b) or a == 1) else 0)
    routes = _search(_rows(9), [1, 2], songs)["routes"]
    same = [route for route in routes if route["bridges"][0] < 30]
    assert len(same) == 2


def test_it_takes_two_songs_when_one_will_not_do(monkeypatch):
    songs = [_song(i) for i in (1, 2, 6, 7, 9)]
    _wire(monkeypatch, {(1, 6), (6, 7), (7, 9), (9, 2)})
    assert _search(_rows(9), [1, 2], songs)["routes"][0]["songs"] == [6, 7, 9]


def test_or_two_on_the_way_out(monkeypatch):
    songs = [_song(i) for i in (1, 2, 6, 7, 9)]
    _wire(monkeypatch, {(1, 9), (9, 6), (6, 7), (7, 2)})
    assert _search(_rows(9), [1, 2], songs)["routes"][0]["songs"] == [9, 6, 7]


def test_or_one_on_each_side(monkeypatch):
    songs = [_song(i) for i in (1, 2, 6, 7, 9)]
    _wire(monkeypatch, {(1, 6), (6, 9), (9, 7), (7, 2)})
    assert _search(_rows(9), [1, 2], songs)["routes"][0]["songs"] == [6, 9, 7]


def test_a_song_far_from_the_mix_can_have_two_on_one_side_and_one_on_the_other(monkeypatch):
    songs = [_song(i) for i in (1, 2, 5, 6, 7, 9)]
    _wire(monkeypatch, {(1, 5), (5, 6), (6, 9), (9, 7), (7, 2)})
    assert _search(_rows(9), [1, 2], songs)["routes"][0]["songs"] == [5, 6, 9, 7]


def test_it_will_not_go_on_for_ever(monkeypatch):
    songs = [_song(i) for i in (1, 2, 4, 5, 6, 7, 9)]
    _wire(monkeypatch, {(1, 5), (5, 6), (6, 9), (9, 7), (7, 4), (4, 2)})
    assert _search(_rows(9), [1, 2], songs)["routes"] == []


def test_it_looks_all_the_way_along_the_mix(monkeypatch):
    """A song far from where the mix is now may be close to where it's going."""
    order = list(range(1, 21))
    songs = [_song(i) for i in [*order, 77, 99]]
    _wire(monkeypatch, {(18, 77), (77, 99), (99, 19)})
    assert _search(_rows(99), order, songs)["routes"][0]["position"] == 18


def test_nearer_is_better_when_they_are_otherwise_the_same(monkeypatch):
    songs = [_song(i) for i in (1, 2, 3, 4, 6, 7, 9)]
    _wire(monkeypatch, {(1, 6), (6, 9), (9, 2), (3, 7), (7, 9), (9, 4)})
    routes = _search(_rows(9), [1, 2, 3, 4], songs)["routes"]
    assert [route["position"] for route in routes] == [1, 3]


def test_a_better_one_further_on_can_still_win(monkeypatch):
    songs = [_song(i) for i in (1, 2, 3, 4, 6, 7, 9)]
    _wire(
        monkeypatch,
        {(1, 6): 0.55, (6, 9): 0.55, (9, 2): 0.55, (3, 7): 1.0, (7, 9): 1.0, (9, 4): 1.0},
    )
    assert _search(_rows(9), [1, 2, 3, 4], songs)["routes"][0]["bridges"] == [7]


def test_a_song_with_no_steady_beat_says_so(monkeypatch):
    wanted = _song(9)
    wanted.grid_confidence = 0.2
    songs = [_song(1), _song(2), wanted]
    _wire(monkeypatch, set())
    assert _search(_rows(9), [1, 2], songs)["unsteady"] is True


def test_when_it_runs_out_of_time_it_keeps_what_it_found(monkeypatch):
    songs = [_song(i) for i in (1, 2, 5, 6, 9)]
    _wire(monkeypatch, {(1, 5), (5, 6), (6, 9), (9, 2)})
    monkeypatch.setattr(planner, "SEARCH_SECONDS", -1.0)
    assert _search(_rows(9), [1, 2], songs)["routes"] == []


def test_one_song_beats_two_if_they_are_about_as_good(monkeypatch):
    songs = [_song(i) for i in (1, 2, 3, 6, 7, 8, 9)]
    _wire(monkeypatch, {(1, 6), (6, 9), (9, 2), (2, 7), (7, 8), (8, 9), (9, 3)})
    assert _search(_rows(9), [1, 2, 3], songs)["routes"][0]["songs"] == [6, 9]


def test_it_will_not_offer_what_other_requests_are_using(monkeypatch):
    songs = [_song(i) for i in (1, 2, 3, 6, 7, 8, 9)]
    _wire(monkeypatch, {(1, 7), (7, 9), (9, 2), (1, 8), (8, 9), (1, 6), (6, 9), (2, 8), (8, 3)})
    rows = _rows(9, 8)
    found = _search(rows, [1, 2, 3], songs)
    assert all(8 not in route["songs"] for route in found["routes"])


def test_it_will_not_offer_the_spot_another_request_is_in(monkeypatch):
    songs = [_song(i) for i in (1, 2, 3, 6, 8, 9)]
    _wire(monkeypatch, {(1, 8), (8, 2), (1, 6), (6, 9), (9, 2), (2, 6), (9, 3)})
    rows = _rows(9, 8)
    found = _search(rows, [1, 2, 3], songs)
    assert {route["position"] for route in found["routes"]} == {2}


def test_it_says_when_a_song_fits_already(monkeypatch):
    songs = [_song(i) for i in (1, 2, 7, 9)]
    _wire(monkeypatch, {(1, 9), (9, 2), (1, 7), (7, 9)})
    assert _search(_rows(9), [1, 2], songs)["direct"] is True


def test_it_says_when_nothing_can_do_it(monkeypatch):
    songs = [_song(i) for i in (1, 2, 7, 9)]
    _wire(monkeypatch, {(1, 2)})
    found = _search(_rows(9), [1, 2], songs)
    assert found["routes"] == []
    assert found["direct"] is False


def test_it_never_reaches_back_past_what_is_playing(monkeypatch):
    songs = [_song(i) for i in (1, 2, 3, 7, 9)]
    _wire(monkeypatch, {(1, 7), (7, 9), (9, 2), (2, 7), (9, 3)})
    assert {r["position"] for r in _search(_rows(9), [1, 2, 3], songs, protected=1)["routes"]} == {
        2
    }


def test_it_says_what_makes_the_route_work_from_what_was_measured(monkeypatch):
    songs = [_song(1, bpm=120.0), _song(2, bpm=120.0), _song(7, bpm=121.0), _song(9, bpm=122.0)]
    _wire(monkeypatch, {(1, 7), (7, 9), (9, 2)})
    words = _search(_rows(9), [1, 2], songs)["routes"][0]["words"]
    assert words == "Tempo barely moves, keys match. 120 → 121 → 122 → 120 BPM."


# ---- nothing is worked out twice


def test_a_pair_is_only_worked_out_once_however_often_it_is_looked_at(monkeypatch):
    songs = [_song(i) for i in (1, 2, 3, 7, 9)]
    work = _wire(monkeypatch, {(1, 9), (9, 2)})
    book = PairBook()
    _plan(_rows(9), [1, 2, 3], songs, book=book)
    assert work
    done = len(work)
    for protected in (0, 1, 0):
        _plan(_rows(9), [1, 2, 3], songs, protected=protected, book=book)
    assert len(work) == done


def test_what_is_worked_out_survives_a_restart(monkeypatch, tmp_path):
    songs = [_song(i) for i in (1, 2, 9)]
    work = _wire(monkeypatch, {(1, 9), (9, 2)})
    path = tmp_path / "pair-book.json"
    book = PairBook(path)
    _plan(_rows(9), [1, 2], songs, book=book)
    book.save(now=True)
    done = len(work)
    assert _plan(_rows(9), [1, 2], songs, book=PairBook(path))[0]["plan"]["songs"] == [9]
    # what's too far apart isn't kept, and takes no working out, but the pairs that fit are there
    assert {(a, b) for a, b, _name in work[done:]} <= {(1, 2), (2, 9)}


def test_a_song_that_changes_only_loses_what_was_known_about_it(monkeypatch, tmp_path):
    songs = {i: _song(i) for i in (1, 2, 3)}
    work = _wire(monkeypatch, lambda _a, _b: 0.9)
    book = PairBook(tmp_path / "pair-book.json")
    book.sync(songs.values())
    for pair in ((1, 2), (2, 3), (1, 3)):
        book.facts(songs[pair[0]], songs[pair[1]])
    changed = _song(3, bpm=90.0)
    book.sync([songs[1], songs[2], changed])
    work.clear()
    book.facts(songs[1], songs[2])
    assert work == []
    book.facts(songs[2], changed)
    assert work


def test_a_song_changing_while_the_site_was_off_is_noticed(monkeypatch, tmp_path):
    work = _wire(monkeypatch, lambda _a, _b: 0.9)
    path = tmp_path / "pair-book.json"
    a, b = _song(1), _song(2)
    book = PairBook(path)
    book.sync([a, b])
    book.facts(a, b)
    book.save(now=True)
    work.clear()
    again = PairBook(path)
    changed = _song(2, bpm=90.0)
    again.sync([a, changed])
    again.facts(a, changed)
    assert work


def test_new_rules_for_what_works_start_it_again(monkeypatch, tmp_path):
    work = _wire(monkeypatch, lambda _a, _b: 0.9)
    path = tmp_path / "pair-book.json"
    a, b = _song(1), _song(2)
    book = PairBook(path)
    book.sync([a, b])
    book.facts(a, b)
    book.save(now=True)
    work.clear()
    monkeypatch.setattr(planner, "_rules", lambda: "different")
    fresh = PairBook(path)
    fresh.sync([a, b])
    fresh.facts(a, b)
    assert work


def test_a_broken_file_just_means_starting_again(tmp_path):
    path = tmp_path / "pair-book.json"
    path.write_text("{not json", "utf-8")
    assert PairBook(path)._pairs == {}


def test_it_is_not_written_over_and_over(monkeypatch, tmp_path):
    _wire(monkeypatch, lambda _a, _b: 0.9)
    path = tmp_path / "pair-book.json"
    book = PairBook(path)
    a, b = _song(1), _song(2)
    book.sync([a, b])
    book.facts(a, b)
    book.save(now=True)
    stamp = path.stat().st_mtime_ns
    book.save()
    book.save(now=True)  # nothing new to say
    assert path.stat().st_mtime_ns == stamp
    assert json.loads(path.read_text("utf-8"))["pairs"]


def test_pairs_too_far_apart_are_not_kept_on_disk(monkeypatch, tmp_path):
    _wire(monkeypatch, {(1, 2): 0.9, (2, 1): 0.1})
    path = tmp_path / "pair-book.json"
    book = PairBook(path)
    a, b = _song(1), _song(2)
    book.sync([a, b])
    book.facts(a, b)
    book.facts(b, a)
    book.save(now=True)
    assert [pair[:2] for pair in json.loads(path.read_text("utf-8"))["pairs"]] == [[1, 2]]
