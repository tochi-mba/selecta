"""Drafts are mixes that don't touch what's playing, and the render line gets them ready in turn."""

from __future__ import annotations

import json
from collections import Counter
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from selecta import db, mix
from selecta.api import create_app
from selecta.config import ANALYSIS_VERSION, Settings
from selecta.eta import JobClock, mix_time_left, time_ahead
from selecta.seams import LATER, LINE, MIX, PREPARING, REQUEST, URGENT, SeamRequest, SeamStore


def _song_row(conn, song_id):
    conn.execute(
        "INSERT INTO songs(id,path,folder,size,mtime,duration,artist,title,is_music) "
        "VALUES(?,?,?,?,?,?,?,?,1)",
        (song_id, f"{song_id}.flac", "f", 1, 1.0, 200.0, f"Artist {song_id}", f"Song {song_id}"),
    )
    conn.execute(
        "INSERT INTO analysis(song_id,version,bpm,camelot) VALUES(?,?,?,?)",
        (song_id, ANALYSIS_VERSION, 120.0, "8A"),
    )


@pytest.fixture
def conn(tmp_path):
    connection = db.connect(tmp_path / "selecta.sqlite")
    for song_id in range(1, 8):
        _song_row(connection, song_id)
    connection.commit()
    return connection


@pytest.fixture
def store(tmp_path):
    return SeamStore(Settings(tmp_path))


def _songs(conn, store, draft=None):
    return [item["song_id"] for item in mix.read_mix(conn, store, draft)]


def _draft(conn, *songs, name=None):
    draft = mix.create_draft(conn, name)
    for song in songs:
        mix.add_song(conn, song, draft=draft)
    return draft


# ---- a draft never touches the current mix


def test_changing_a_draft_leaves_the_current_mix_alone(conn, store):
    mix.add_song(conn, 1)
    mix.add_song(conn, 2)
    draft = _draft(conn, 3, 4, 5)
    mix.move_song(conn, 0, 2, draft)
    mix.remove_at(conn, 0, draft)
    mix.replace_at(conn, 0, 6, draft)
    mix.set_seam(conn, 1, {"move": "echo_out"}, draft)
    mix.toggle_lock(conn, 0, draft)
    mix.set_mix_name(conn, "Friday", draft)
    assert _songs(conn, store) == [1, 2]
    assert mix.mix_name(conn) == "Your mix"
    assert mix.read_mix(conn, store)[1]["seam"]["settings"] == {}
    assert not mix.read_mix(conn, store)[0]["locked"]
    assert mix.mix_name(conn, draft) == "Friday"


def test_changing_the_current_mix_leaves_a_draft_alone(conn, store):
    draft = _draft(conn, 3, 4)
    mix.add_song(conn, 1)
    mix.write_order(conn, [])
    assert _songs(conn, store, draft) == [3, 4]


def test_a_draft_edits_just_like_a_mix(conn, store):
    draft = _draft(conn, 1, 2, 3)
    mix.add_song(conn, 4, 1, draft)
    assert _songs(conn, store, draft) == [1, 4, 2, 3]
    mix.set_seam(conn, 1, {"move": "echo_out", "bars": None}, draft)
    assert mix.read_mix(conn, store, draft)[1]["seam"]["settings"] == {"move": "echo_out"}
    mix.toggle_lock(conn, 2, draft)
    assert mix.read_mix(conn, store, draft)[2]["locked"] is True
    mix.toggle_lock(conn, 2, draft)
    assert mix.read_mix(conn, store, draft)[2]["locked"] is False


def test_moving_a_song_gives_its_neighbours_fresh_seams(conn, store):
    draft = _draft(conn, 1, 2, 3, 4)
    for position in (1, 2, 3):
        mix.set_seam(conn, position, {"move": "echo_out"}, draft)
    mix.move_song(conn, 0, 2, draft)
    settings = [item["seam"]["settings"] for item in mix.read_mix(conn, store, draft)[1:]]
    assert settings[0] == {"move": "echo_out"}, "a pair that didn't change keeps its seam"
    assert settings[1] == {}, "a new pair starts fresh"
    assert settings[2] == {}


def test_a_draft_seam_is_the_same_seam_as_anywhere_else(conn, store):
    """Rendering it once is enough, wherever it ends up."""
    mix.add_song(conn, 1)
    mix.add_song(conn, 2)
    draft = _draft(conn, 1, 2)
    current = mix.read_mix(conn, store)[1]["seam"]["state"]["key"]
    assert mix.read_mix(conn, store, draft)[1]["seam"]["state"]["key"] == current


def test_undo_in_a_draft_only_undoes_that_draft(conn, store):
    mix.add_song(conn, 1)
    mix.remember(conn, "current change")
    draft = _draft(conn, 2, 3)
    mix.remember(conn, "adding Song 4", draft)
    mix.add_song(conn, 4, draft=draft)
    assert mix.can_undo(conn, draft)
    assert mix.undo(conn, draft) == "adding Song 4"
    assert _songs(conn, store, draft) == [2, 3]
    assert _songs(conn, store) == [1]
    assert not mix.can_undo(conn, draft)
    assert mix.can_undo(conn)
    assert mix.undo(conn, draft) is None


def test_a_draft_that_has_gone_says_so(conn, store):
    with pytest.raises(mix.NoSuchDraft):
        mix.read_mix(conn, store, 99)
    with pytest.raises(mix.NoSuchDraft):
        mix.add_song(conn, 1, draft=99)
    with pytest.raises(mix.NoSuchDraft):
        mix.play_draft(conn, 99)
    with pytest.raises(mix.NoSuchDraft):
        mix.delete_draft(conn, 99)


def test_a_song_that_leaves_the_library_just_drops_out(conn, store):
    draft = _draft(conn, 1, 2, 3)
    conn.execute("DELETE FROM analysis WHERE song_id=2")
    conn.execute("DELETE FROM songs WHERE id=2")
    conn.commit()
    assert _songs(conn, store, draft) == [1, 3]
    mix.add_song(conn, 4, draft=draft)
    assert _songs(conn, store, draft) == [1, 3, 4]


def test_positions_stay_in_order_when_a_song_has_gone(conn, store):
    draft = _draft(conn, 1, 2, 3)
    conn.execute("DELETE FROM analysis WHERE song_id=1")
    conn.execute("DELETE FROM songs WHERE id=1")
    conn.commit()
    assert [item["position"] for item in mix.read_mix(conn, store, draft)] == [0, 1]
    assert mix.read_mix(conn, store, draft)[0]["seam"] is None


# ---- names


def test_new_drafts_get_the_first_free_number(conn):
    first = mix.create_draft(conn, items=[(1, None, 0)])
    second = mix.create_draft(conn, items=[(1, None, 0)])
    assert mix.mix_name(conn, first) == "Draft 1"
    assert mix.mix_name(conn, second) == "Draft 2"
    mix.delete_draft(conn, first)
    assert mix.mix_name(conn, mix.create_draft(conn, items=[(1, None, 0)])) == "Draft 1"


def test_empty_drafts_do_not_pile_up(conn):
    first = mix.create_draft(conn)
    assert mix.create_draft(conn) == first
    mix.add_song(conn, 1, draft=first)
    assert mix.create_draft(conn) != first


def test_names_can_not_be_mistaken_for_each_other(conn):
    first = mix.create_draft(conn, "Friday")
    second = mix.create_draft(conn, "friday")
    third = mix.create_draft(conn, "Friday")
    assert mix.mix_name(conn, first) == "Friday"
    assert mix.mix_name(conn, second) == "friday 2"
    assert mix.mix_name(conn, third) == "Friday 3"


def test_renaming_keeps_the_old_name_if_there_is_nothing_to_go_on(conn):
    draft = mix.create_draft(conn, "Friday")
    assert mix.rename_draft(conn, draft, "   ") == "Friday"
    assert mix.rename_draft(conn, draft, "Friday") == "Friday", "not 'Friday 2'"
    assert mix.rename_draft(conn, draft, "  Sunday   morning ") == "Sunday morning"


def test_renaming_to_a_name_in_use_gets_a_number(conn):
    mix.create_draft(conn, "Friday")
    draft = mix.create_draft(conn, "Sunday")
    assert mix.rename_draft(conn, draft, "Friday") == "Friday 2"


def test_very_long_names_are_shortened(conn):
    draft = mix.create_draft(conn, "x" * 500)
    assert len(mix.mix_name(conn, draft)) == mix.NAME_LIMIT


def test_a_copy_is_its_own_draft(conn, store):
    draft = _draft(conn, 1, 2, name="Friday")
    mix.set_seam(conn, 1, {"move": "echo_out"}, draft)
    copy = mix.duplicate_draft(conn, draft)
    assert mix.mix_name(conn, copy) == "Friday copy"
    assert mix.read_mix(conn, store, copy)[1]["seam"]["settings"] == {"move": "echo_out"}
    mix.remove_at(conn, 0, copy)
    assert _songs(conn, store, draft) == [1, 2]


def test_the_current_mix_can_be_kept_as_a_draft(conn, store):
    mix.add_song(conn, 1)
    mix.add_song(conn, 2)
    mix.set_seam(conn, 1, {"move": "echo_out"})
    mix.set_mix_name(conn, "Friday")
    draft = mix.copy_current(conn)
    assert mix.mix_name(conn, draft) == "Friday"
    assert mix.read_mix(conn, store, draft)[1]["seam"]["settings"] == {"move": "echo_out"}
    assert _songs(conn, store) == [1, 2], "the current mix stays as it was"


# ---- deleting


def test_a_deleted_draft_can_be_taken_back_exactly_as_it_was(conn, store):
    draft = _draft(conn, 1, 2, name="Friday")
    mix.remember(conn, "something", draft)
    mix.join_line(conn, draft)
    assert mix.delete_draft(conn, draft) == "Friday"
    assert mix.all_drafts(conn) == []
    assert mix.line_order(conn) == []
    assert mix.restore_draft(conn) == draft
    assert _songs(conn, store, draft) == [1, 2]
    assert mix.can_undo(conn, draft)
    assert mix.line_order(conn) == [draft]
    assert mix.restore_draft(conn) is None, "only once"


def test_a_taken_back_draft_returns_to_its_place_in_line(conn):
    first, second, third = (_draft(conn, 1, 2) for _ in range(3))
    for draft in (first, second, third):
        mix.join_line(conn, draft)
    mix.delete_draft(conn, second)
    assert mix.line_order(conn) == [first, third]
    mix.restore_draft(conn)
    assert mix.line_order(conn) == [first, second, third]


def test_a_taken_back_draft_keeps_clear_of_a_new_name(conn):
    draft = mix.create_draft(conn, "Friday", [(1, None, 0)])
    mix.delete_draft(conn, draft)
    mix.create_draft(conn, "Friday", [(2, None, 0)])
    restored = mix.restore_draft(conn)
    assert mix.mix_name(conn, restored) == "Friday 2"


def test_a_new_draft_never_reuses_a_deleted_ones_number(conn):
    """A tab still showing the old one must not start editing something else."""
    draft = mix.create_draft(conn, "Friday", [(1, None, 0)])
    mix.delete_draft(conn, draft)
    assert mix.create_draft(conn, "Other", [(1, None, 0)]) != draft


# ---- playing a draft


def test_playing_a_draft_makes_it_current_and_nothing_is_lost(conn, store):
    mix.add_song(conn, 1)
    mix.add_song(conn, 2)
    mix.set_mix_name(conn, "What was on")
    draft = _draft(conn, 3, 4, name="Friday")
    assert mix.play_draft(conn, draft) == "Friday"
    assert _songs(conn, store) == [3, 4]
    assert mix.mix_name(conn) == "Friday"
    rows = mix.all_drafts(conn)
    assert [row["name"] for row in rows] == ["What was on"]
    assert _songs(conn, store, rows[0]["id"]) == [1, 2]


def test_playing_keeps_its_seams(conn, store):
    draft = _draft(conn, 3, 4)
    mix.set_seam(conn, 1, {"move": "echo_out"}, draft)
    mix.toggle_lock(conn, 0, draft)
    mix.play_draft(conn, draft)
    current = mix.read_mix(conn, store)
    assert current[1]["seam"]["settings"] == {"move": "echo_out"}
    assert current[0]["locked"] is True


def test_an_empty_current_mix_does_not_become_a_draft(conn):
    mix.play_draft(conn, _draft(conn, 3, 4))
    assert mix.all_drafts(conn) == []


def test_trading_back_and_forth_makes_no_copies(conn, store):
    mix.add_song(conn, 1)
    mix.set_mix_name(conn, "A")
    mix.play_draft(conn, _draft(conn, 2, name="B"))
    for _ in range(3):
        waiting = mix.all_drafts(conn)
        assert len(waiting) == 1
        mix.play_draft(conn, waiting[0]["id"])
    assert len(mix.all_drafts(conn)) == 1


def test_a_current_mix_already_kept_as_a_draft_is_not_kept_twice(conn):
    mix.add_song(conn, 1)
    kept = mix.copy_current(conn, "Saved")
    other = _draft(conn, 2)
    mix.play_draft(conn, other)
    assert [row["id"] for row in mix.all_drafts(conn)] == [kept]


def test_playing_can_be_undone_completely(conn, store):
    mix.add_song(conn, 1)
    mix.set_mix_name(conn, "What was on")
    draft = _draft(conn, 3, 4, name="Friday")
    mix.remember(conn, "editing Friday", draft)
    mix.join_line(conn, draft)
    mix.play_draft(conn, draft)
    assert mix.undo(conn) == "playing Friday"
    assert _songs(conn, store) == [1]
    assert mix.mix_name(conn) == "What was on"
    rows = mix.all_drafts(conn)
    assert [row["name"] for row in rows] == ["Friday"]
    assert rows[0]["id"] == draft
    assert _songs(conn, store, draft) == [3, 4]
    assert mix.line_order(conn) == [draft], "back in its place in line"
    assert mix.can_undo(conn, draft), "with its own undo too"


def test_undoing_keeps_changes_made_to_the_old_mix_since(conn, store):
    mix.add_song(conn, 1)
    mix.set_mix_name(conn, "What was on")
    mix.play_draft(conn, _draft(conn, 3))
    kept = mix.all_drafts(conn)[0]["id"]
    mix.add_song(conn, 5, draft=kept)
    mix.undo(conn)
    assert _songs(conn, store, kept) == [1, 5]


def test_playing_takes_it_out_of_the_line(conn):
    first, second = _draft(conn, 1, 2), _draft(conn, 3, 4)
    mix.join_line(conn, first)
    mix.join_line(conn, second)
    mix.play_draft(conn, first)
    assert mix.line_order(conn) == [second]


# ---- the line


def test_the_line_keeps_its_order(conn):
    drafts = [_draft(conn, 1, 2) for _ in range(3)]
    for draft in drafts:
        mix.join_line(conn, draft)
    assert mix.line_order(conn) == drafts
    mix.join_line(conn, drafts[0])
    assert mix.line_order(conn) == drafts, "joining twice changes nothing"


def test_moving_up_and_down_the_line(conn):
    first, second, third = (_draft(conn, 1, 2) for _ in range(3))
    for draft in (first, second, third):
        mix.join_line(conn, draft)
    mix.move_in_line(conn, third, -1)
    assert mix.line_order(conn) == [first, third, second]
    mix.move_in_line(conn, first, -1)
    assert mix.line_order(conn) == [first, third, second], "the front stays the front"
    mix.move_in_line(conn, second, 1)
    assert mix.line_order(conn) == [first, third, second], "the back stays the back"
    mix.move_in_line(conn, first, 5)
    assert mix.line_order(conn) == [third, first, second], "one place at a time"


def test_a_draft_not_in_line_can_not_be_moved(conn):
    first, second = _draft(conn, 1, 2), _draft(conn, 3, 4)
    mix.join_line(conn, first)
    mix.move_in_line(conn, second, -1)
    assert mix.line_order(conn) == [first]


def test_leaving_closes_the_gap(conn):
    first, second, third = (_draft(conn, 1, 2) for _ in range(3))
    for draft in (first, second, third):
        mix.join_line(conn, draft)
    mix.leave_line(conn, second)
    assert mix.line_order(conn) == [first, third]
    mix.leave_line(conn, second)
    assert mix.line_order(conn) == [first, third]


def test_the_list_shows_the_line_first_then_the_latest(conn):
    first, second, third = (_draft(conn, 1, 2) for _ in range(3))
    mix.join_line(conn, second)
    assert mix.all_drafts(conn)[0]["id"] == second
    assert {row["id"] for row in mix.all_drafts(conn)} == {first, second, third}


# ---- what the worker does next


def _request(number):
    return SeamRequest(number, number + 1, "echo_out")


def _ready_worker(store):
    store.keep_for_now = lambda: set()
    store.next_idle_job = lambda: None
    return store


def test_the_current_mix_always_renders_ahead_of_the_line(store):
    _ready_worker(store)
    in_mix, in_line = [_request(1)], [(5, _request(2))]
    store.next_mix_seam = lambda: in_mix[0] if in_mix else None
    store.next_line_seam = lambda: in_line[0] if in_line else None
    assert store._next_job() == _request(1)
    assert store._running_rank == MIX
    assert store._running_draft is None
    in_mix.clear()
    assert store._next_job() == _request(2)
    assert store._running_rank == LINE
    assert store._running_draft == 5


def test_the_line_goes_ahead_of_everything_else(store):
    _ready_worker(store)
    store.next_line_seam = lambda: (5, _request(2))
    store.next_idle_job = lambda: _request(9)
    store.ask(_request(3))
    assert store._next_job() == _request(2)
    assert store._running_rank == LINE


def test_things_people_asked_for_come_once_the_line_is_empty(store):
    _ready_worker(store)
    store.next_idle_job = lambda: _request(9)
    store.ask(_request(3))
    assert store._next_job() == _request(3)
    assert store._running_rank == LATER
    assert store._next_job() == _request(9)
    assert store._running_rank == PREPARING


def test_a_seam_from_the_mix_someone_tapped_still_goes_first(store):
    _ready_worker(store)
    store.next_line_seam = lambda: (5, _request(2))
    store.ask(_request(1), urgent=True)
    assert store._next_job() == _request(1)
    assert store._running_rank == URGENT


def _running(store, rank, key="running"):
    store._running_rank = rank
    store._running_key = key
    store.keep_for_now = lambda: {key}
    store._sign_renewed_at = store._mix_checked_at = store._active_checked_at = 0.0
    return store


def test_a_line_seam_stops_for_the_current_mix(store):
    _running(store, LINE)
    store.next_mix_seam = lambda: _request(1)
    assert store._give_way() is True


def test_a_line_seam_carries_on_when_only_other_line_seams_wait(store):
    _running(store, LINE)
    store.next_line_seam = lambda: (5, _request(2))
    assert store._give_way() is False


def test_a_line_seam_stops_if_its_mix_was_deleted_or_changed(store):
    _running(store, LINE)
    store.keep_for_now = lambda: {"something else"}
    assert store._give_way() is True


def test_a_line_seam_carries_on_if_nothing_more_important_comes(store):
    _running(store, LINE)
    store.ask(_request(3))
    assert store._give_way() is False, "someone's request waits for the line"


def test_other_work_stops_for_the_line(store):
    for rank in (LATER, PREPARING):
        _running(store, rank)
        store.next_line_seam = lambda: (5, _request(2))
        assert store._give_way() is True


def test_the_current_mix_never_stops_for_the_line(store):
    _running(store, MIX)
    store.next_line_seam = lambda: (5, _request(2))
    assert store._give_way() is False


def test_a_line_seam_chooses_its_moves_with_its_own_mix_in_mind(store, tmp_path):
    """A fallback should add variety to the mix it's in, not to whatever's playing."""
    from helpers import song_from_track
    from synth import make_track

    track = make_track(bpm=120, bars=64, seed=1)
    a, b = song_from_track(tmp_path, "a", track), song_from_track(tmp_path, "b", track)
    a.id, b.id = 1, 2
    looked_at = []

    def in_draft(draft):
        looked_at.append(draft)
        return Counter()

    def in_current():
        looked_at.append("current")
        return Counter()

    store.draft_moves, store.mix_moves = in_draft, in_current
    store._take = lambda *_args: None
    store._running_draft = 5
    store._best_move(a, b, [])
    store._running_draft = None
    store._best_move(a, b, [])
    assert looked_at == [5, "current"]


# ---- a request's seams


def _statuses(store, states):
    real = store.status
    store.status = lambda key: {"status": states[key]} if key in states else real(key)


def test_a_request_goes_ahead_of_the_rest_of_the_mix(store):
    _ready_worker(store)
    store.next_mix_seam = lambda: _request(1)
    store.ask(_request(5), after=[])
    assert store._next_job() == _request(5)
    assert store._running_rank == REQUEST
    assert store._next_job() == _request(1), "and the mix carries on straight after"


def test_what_is_heard_before_a_request_goes_first(store):
    _ready_worker(store)
    before = _request(1)
    states = {before.key: "none"}
    _statuses(store, states)
    store.next_mix_seam = lambda: before
    store.ask(_request(5), after=[before.key])
    assert store._next_job() == before
    assert store._running_rank == MIX
    states[before.key] = "ready"
    assert store._next_job() == _request(5)
    assert store._running_rank == REQUEST


def test_a_seam_that_could_not_be_made_does_not_hold_a_request_up(store):
    _ready_worker(store)
    before = _request(1)
    _statuses(store, {before.key: "failed"})
    store.ask(_request(5), after=[before.key])
    assert store._next_job() == _request(5)


def test_what_is_about_to_be_heard_still_beats_a_request(store):
    _ready_worker(store)
    store.ask(_request(5), after=[])
    store.ask(_request(1), urgent=True)
    assert store._next_job() == _request(1)
    assert store._running_rank == URGENT


def test_requests_go_in_the_order_they_came(store):
    _ready_worker(store)
    store.ask(_request(5), after=[])
    store.ask(_request(6), after=[])
    assert store._next_job() == _request(5)
    assert store._next_job() == _request(6)


def test_a_request_goes_ahead_of_the_line_and_other_work(store):
    _ready_worker(store)
    store.next_line_seam = lambda: (5, _request(2))
    store.next_idle_job = lambda: _request(9)
    store.ask(_request(3))
    store.ask(_request(7), after=[])
    assert store._next_job() == _request(7)
    assert store._running_rank == REQUEST


def test_a_request_seam_is_never_treated_as_left_over_from_an_old_mix(store):
    """It isn't in the mix yet, which is exactly why it's being rendered."""
    _ready_worker(store)
    store.ask(_request(7), after=[])
    store._next_job()
    store.keep_for_now = lambda: {"something in the mix"}
    store._active_checked_at = 0.0
    assert store._give_way() is False


def test_a_request_seam_stops_for_what_is_about_to_be_heard(store):
    _ready_worker(store)
    store.ask(_request(7), after=[])
    store._next_job()
    store.ask(_request(1), urgent=True)
    assert store._give_way() is True


def test_a_request_seam_does_not_stop_for_the_rest_of_the_mix(store):
    _ready_worker(store)
    store.ask(_request(7), after=[])
    store._next_job()
    store.next_mix_seam = lambda: _request(1)
    store._mix_checked_at = 0.0
    assert store._give_way() is False


def test_a_seam_in_progress_finishes_rather_than_stopping_for_a_request(store):
    """Stopping one partway through a stem split would throw away minutes to save seconds."""
    _running(store, MIX)
    store.ask(_request(7), after=[])
    assert store._give_way() is False


def test_lesser_work_stops_for_a_request(store):
    for rank in (LINE, LATER, PREPARING):
        _running(store, rank)
        store.ask(_request(7), after=[])
        assert store._give_way() is True


def test_a_request_already_finished_is_dropped(store):
    _ready_worker(store)
    done = _request(7)
    _statuses(store, {done.key: "ready"})
    store.ask(done, after=[])
    store.next_idle_job = lambda: _request(9)
    assert store._next_job() == _request(9)


def test_a_request_never_waits_on_a_seam_that_left_the_mix(store):
    """It would have waited forever, since nothing would ever render it."""
    _ready_worker(store)
    gone = _request(1)
    _statuses(store, {gone.key: "none"})
    store.keep_for_now = lambda: {"what is in the mix now"}
    store.ask(_request(5), after=[gone.key])
    assert store._next_job() == _request(5)


def test_a_request_never_waits_on_a_mix_that_cannot_go_further(store):
    """The mix stops at the storage limit, and that mustn't leave a request stuck behind it."""
    _ready_worker(store)
    before = _request(1)
    _statuses(store, {before.key: "none"})
    store.keep_for_now = lambda: {before.key}
    store.next_mix_seam = lambda: None
    store.ask(_request(5), after=[before.key])
    assert store._next_job() == _request(5)


def test_a_request_seam_that_failed_is_dropped(store):
    _ready_worker(store)
    done = _request(7)
    _statuses(store, {done.key: "failed"})
    store.ask(done, after=[])
    store.next_idle_job = lambda: _request(9)
    assert store._next_job() == _request(9)


def test_a_finished_request_seam_is_kept_until_it_joins(store):
    store.ask(_request(7), after=[])
    assert _request(7).key in store._request_keys


# ---- how long it will take


def _clock(tmp_path, seconds=100.0):
    clock = JobClock(tmp_path)
    for _ in range(5):
        clock.record("echo_out", seconds)
    return clock


def _waiting(key):
    return {"seam": {"settings": {"move": "echo_out"}, "state": {"status": "none", "key": key}}}


def test_work_ahead_adds_up_and_counts_a_shared_seam_once(tmp_path):
    clock = _clock(tmp_path)
    estimates, seen = time_ahead([[_waiting("a"), _waiting("b")], [_waiting("b")]], clock)
    assert len(estimates) == 2
    assert seen == {"a", "b"}


def test_a_seam_in_a_draft_counts_what_is_ahead_of_it(tmp_path):
    clock = _clock(tmp_path)
    ahead, seen = time_ahead([[_waiting("a")]], clock)
    items = [_waiting("b"), _waiting("a")]
    left = mix_time_left(items, clock, ahead=ahead, seen=seen)
    assert items[0]["seam"]["state"]["eta"] == 200
    assert items[1]["seam"]["state"]["eta"] == 200, "that one's coming anyway"
    assert left["seconds"] == 200
    assert left["seams"] == 2


# ---- old saved mixes


def _with_saved(tmp_path, saved):
    path = tmp_path / "old.sqlite"
    conn = db.connect(path)
    db.set_preference(conn, "saved_mixes", saved)
    conn.close()
    return db.connect(path)


def test_saved_mixes_become_drafts_only_once(tmp_path):
    saved = [
        {"name": "Newest", "items": [[1, None, 0]], "songs": 1},
        {"name": "Oldest", "items": [[2, '{"move": "echo_out"}', 1]], "songs": 1},
    ]
    conn = _with_saved(tmp_path, saved)
    names = [row["name"] for row in conn.execute("SELECT name FROM drafts ORDER BY id")]
    assert names == ["Oldest", "Newest"]
    assert db.preference(conn, "saved_mixes", None) is None
    conn.close()
    conn = db.connect(tmp_path / "old.sqlite")
    assert conn.execute("SELECT COUNT(*) FROM drafts").fetchone()[0] == 2
    row = conn.execute("SELECT items FROM drafts WHERE name='Oldest'").fetchone()
    assert json.loads(row["items"]) == [[2, '{"move": "echo_out"}', 1]]


def test_old_saved_mixes_with_nothing_in_them_cause_no_trouble(tmp_path):
    conn = _with_saved(tmp_path, [{"name": "Odd", "songs": [1]}])
    assert conn.execute("SELECT items FROM drafts").fetchone()["items"] == "[]"


def test_a_saved_mix_brought_in_again_is_not_doubled(tmp_path):
    saved = [{"name": "Friday", "items": [[1, None, 0]], "songs": 1}]
    conn = _with_saved(tmp_path, saved)
    db.set_preference(conn, "saved_mixes", saved)
    conn.close()
    conn = db.connect(tmp_path / "old.sqlite")
    assert conn.execute("SELECT COUNT(*) FROM drafts").fetchone()[0] == 1


# ---- through the routes


@pytest.fixture
def client(tmp_path, monkeypatch):
    settings = Settings(tmp_path)
    conn = db.connect(settings.db_path)
    for song_id in range(1, 7):
        _song_row(conn, song_id)
    conn.commit()
    conn.close()
    monkeypatch.setattr(
        "selecta.analysis.song.load_song",
        lambda _conn, _settings, song_id: SimpleNamespace(
            id=song_id, title=f"Song {song_id}", vocals_known=True
        ),
    )
    monkeypatch.setattr("selecta.planner.reel.load_library", lambda _conn, _settings: [])
    sent = []

    def submit(self, request, urgent=False, retry=False):
        sent.append((request, urgent))
        return {"status": "queued", "key": request.key}

    monkeypatch.setattr(SeamStore, "submit", submit)
    test_client = TestClient(create_app(settings, tmp_path / "no-web"))
    test_client.sent = sent
    return test_client


def _new(client, *songs, name=None):
    draft = client.post("/api/drafts", json={"name": name}).json()["id"]
    for song in songs:
        added = client.post(f"/api/mix/songs?draft={draft}", json={"song_id": song})
        assert added.status_code == 200
    return draft


def test_every_mix_route_can_work_on_a_draft(client):
    client.post("/api/mix/songs", json={"song_id": 6})
    draft = _new(client, 1, 2, 3)
    data = client.get(f"/api/mix?draft={draft}").json()
    assert [item["song_id"] for item in data["mix"]] == [1, 2, 3]
    assert data["draft"] == {"id": draft, "place": None}
    moved = client.post(f"/api/mix/move?draft={draft}", json={"source": 0, "target": 2}).json()
    assert [item["song_id"] for item in moved["mix"]] == [2, 3, 1]
    gone = client.delete(f"/api/mix/songs/0?draft={draft}").json()
    assert [item["song_id"] for item in gone["mix"]] == [3, 1]
    seam = client.post(f"/api/mix/1/seam?draft={draft}", json={"move": "echo_out"}).json()
    assert seam["mix"][1]["seam"]["settings"]["move"] == "echo_out"
    locked = client.post(f"/api/mix/0/lock?draft={draft}").json()
    assert locked["mix"][0]["locked"] is True
    undone = client.post(f"/api/mix/undo?draft={draft}").json()
    assert undone["undone"] == "changing that seam"
    assert [item["song_id"] for item in client.get("/api/mix").json()["mix"]] == [6]


def test_a_seam_in_a_draft_never_jumps_ahead_of_the_current_mix(client):
    draft = _new(client, 1, 2)
    client.post(f"/api/mix/1/render?draft={draft}")
    assert client.sent[-1][1] is False
    client.post(f"/api/mix/1/render?draft={draft}&retry=true")
    assert client.sent[-1][1] is False
    client.post("/api/mix/songs", json={"song_id": 3})
    client.post("/api/mix/songs", json={"song_id": 4})
    client.post("/api/mix/1/render")
    assert client.sent[-1][1] is True, "the current mix does"


def test_a_draft_that_has_gone_is_a_plain_404(client):
    answer = client.get("/api/mix?draft=99")
    assert answer.status_code == 404
    assert "isn't there" in answer.json()["detail"]
    assert client.post("/api/drafts/99/play").status_code == 404
    assert client.post("/api/drafts/99/name", json={"name": "x"}).status_code == 404
    assert client.delete("/api/drafts/99").status_code == 404
    assert client.post("/api/drafts/99/duplicate").status_code == 404


def test_the_list_says_where_each_draft_has_got_to(client):
    empty = client.post("/api/drafts", json={}).json()["id"]
    draft = _new(client, 1, 2, 3, name="Friday")
    listing = client.get("/api/drafts").json()
    by_id = {item["id"]: item for item in listing["drafts"]}
    assert by_id[empty]["songs"] == 0
    assert by_id[empty]["seams"] == 0
    friday = by_id[draft]
    assert friday["name"] == "Friday"
    assert friday["songs"] == 3
    assert friday["seconds"] == 600
    assert friday["seams"] == 2
    assert friday["waiting"] == 2
    assert friday["place"] is None
    assert friday["eta"] is None
    assert friday["to_render"] > 0
    # SF-0206-04: the returned song order, for the draft's Mix Sleeve
    assert friday["song_ids"] == [1, 2, 3]
    assert by_id[empty]["song_ids"] == []
    assert listing["current"]["left"] == 0
    assert listing["out_of_room"] is False


def test_prioritizing_quotes_the_wait_including_whats_ahead(client):
    client.post("/api/mix/songs", json={"song_id": 5})
    client.post("/api/mix/songs", json={"song_id": 6})
    first, second = _new(client, 1, 2), _new(client, 3, 4)
    client.post(f"/api/drafts/{first}/line")
    listing = client.post(f"/api/drafts/{second}/line").json()
    assert [(item["id"], item["place"]) for item in listing["drafts"][:2]] == [
        (first, 1),
        (second, 2),
    ]
    assert listing["current"]["left"] == 1
    waits = [item["eta"]["seconds"] for item in listing["drafts"][:2]]
    assert waits[0] < waits[1]
    assert waits[0] > listing["current"]["eta"]["seconds"]


def test_only_a_mix_with_seams_can_be_prioritized(client):
    draft = _new(client, 1)
    answer = client.post(f"/api/drafts/{draft}/line")
    assert answer.status_code == 400
    assert "two songs" in answer.json()["detail"]


def test_a_finished_mix_leaves_the_line_by_itself(client, tmp_path, monkeypatch):
    draft = _new(client, 1, 2)
    client.post(f"/api/drafts/{draft}/line")
    monkeypatch.setattr(
        SeamStore, "status", lambda self, key: {"status": "ready", "key": key, "passed": True}
    )
    listing = client.get("/api/drafts").json()
    assert listing["drafts"][0]["place"] is None
    assert listing["drafts"][0]["ready"] == 1
    assert client.post(f"/api/drafts/{draft}/line").json()["drafts"][0]["place"] is None


def test_the_line_can_be_reordered_and_left(client):
    first, second = _new(client, 1, 2), _new(client, 3, 4)
    client.post(f"/api/drafts/{first}/line")
    client.post(f"/api/drafts/{second}/line")
    moved = client.post(f"/api/drafts/{second}/line/move", json={"step": -1}).json()
    assert [item["id"] for item in moved["drafts"][:2]] == [second, first]
    left = client.delete(f"/api/drafts/{second}/line").json()
    assert {item["id"]: item["place"] for item in left["drafts"]} == {first: 1, second: None}


def test_a_draft_in_line_quotes_only_the_seams_coming(client):
    other = _new(client, 5, 6)
    draft = _new(client, 1, 2)
    data = client.get(f"/api/mix?draft={draft}").json()
    assert "eta" not in data["mix"][1]["seam"]["state"], "it won't start by itself"
    client.post(f"/api/drafts/{other}/line")
    client.post(f"/api/drafts/{draft}/line")
    data = client.get(f"/api/mix?draft={draft}").json()
    assert data["draft"]["place"] == 2
    assert data["mix"][1]["seam"]["state"]["eta"] > 0


def test_playing_a_draft_through_the_route(client):
    client.post("/api/mix/songs", json={"song_id": 6})
    draft = _new(client, 1, 2, name="Friday")
    data = client.post(f"/api/drafts/{draft}/play").json()
    assert data["name"] == "Friday"
    assert [item["song_id"] for item in data["mix"]] == [1, 2]
    assert client.get(f"/api/mix?draft={draft}").status_code == 404
    names = [item["name"] for item in client.get("/api/drafts").json()["drafts"]]
    assert names == ["Your mix"]
    undone = client.post("/api/mix/undo").json()
    assert undone["undone"] == "playing Friday"
    assert [item["song_id"] for item in undone["mix"]] == [6]


def test_an_empty_draft_can_not_be_played(client):
    draft = client.post("/api/drafts", json={}).json()["id"]
    assert client.post(f"/api/drafts/{draft}/play").status_code == 400


def test_deleting_and_taking_back_through_the_route(client):
    draft = _new(client, 1, 2, name="Friday")
    assert client.delete(f"/api/drafts/{draft}").json() == {"name": "Friday"}
    assert client.get("/api/drafts").json()["drafts"] == []
    assert client.post("/api/drafts/restore").json()["id"] == draft
    assert client.post("/api/drafts/restore").status_code == 404


def test_keeping_the_current_mix_through_the_route(client):
    client.post("/api/mix/songs", json={"song_id": 6})
    made = client.post("/api/drafts", json={"name": "Friday", "copy_current": True}).json()
    assert made["name"] == "Friday"
    assert [i["song_id"] for i in client.get(f"/api/mix?draft={made['id']}").json()["mix"]] == [6]


def test_status_says_how_many_mixes_are_in_line(client):
    assert client.get("/api/status").json()["mixes_in_line"] == 0
    draft = _new(client, 1, 2)
    client.post(f"/api/drafts/{draft}/line")
    assert client.get("/api/status").json()["mixes_in_line"] == 1


def test_a_feeling_can_be_kept_as_a_draft_without_touching_whats_playing(
    tmp_path, monkeypatch, client
):
    client.post("/api/mix/songs", json={"song_id": 6})
    monkeypatch.setattr(
        "selecta.planner.vibes.eligible", lambda _vibe, songs, _traits: list(range(100))
    )

    class Planned:
        def __init__(self, song_id):
            self.song = type("Song", (), {"id": song_id})

    monkeypatch.setattr(
        "selecta.planner.vibes.build_vibe",
        lambda *_args, **_kwargs: (
            [Planned(1), Planned(2)],
            {2: {"move": "echo_out"}},
        ),
    )
    from selecta.planner.vibes import VIBES

    key = VIBES[0].key
    made = client.post(f"/api/vibes/{key}/build?as_draft=true")
    assert made.status_code == 200, made.text
    body = made.json()
    assert body["name"] == VIBES[0].name
    assert body["count"] == 2
    assert [item["song_id"] for item in client.get("/api/mix").json()["mix"]] == [6]
    draft = client.get(f"/api/mix?draft={body['id']}").json()
    assert [item["song_id"] for item in draft["mix"]] == [1, 2]
    assert draft["mix"][1]["seam"]["settings"] == {"move": "echo_out"}
