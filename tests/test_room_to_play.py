"""A song is never left before it has been entered, however the mix came to be that way."""

from __future__ import annotations

import json

import pytest
from test_mix import _two_songs

from selecta import db, mix
from selecta.config import ANALYSIS_VERSION, Settings
from selecta.mix import chain_with_room, settle_chain, with_room
from selecta.planner.memory import SeamMemory
from selecta.seams import SeamRequest, SeamStore, _bar_cue_render, request_from


def _state(status="none", **more):
    return lambda _key: {"status": status, **more}


def test_a_seam_that_leaves_before_the_song_arrives_is_sent_later():
    """I AM came in at 1:27 and its way out was at 1:15, so it ran right past."""
    settings = {"move": "delay_throw"}
    fixed = with_room(settings, 1, 2, 86.76, 192.0, _state("ready", a_source_start=74.83))
    assert fixed == {"move": "delay_throw", "leave_after": 117.0}


def test_seven_seconds_is_not_long_enough_either():
    fixed = with_room({}, 1, 2, 54.39, 136.0, _state("ready", a_source_start=61.75))
    assert fixed["leave_after"] == 85.0


def test_one_that_fits_is_left_exactly_as_it_is():
    settings = {"move": "delay_throw"}
    kept = with_room(settings, 1, 2, 40.0, 200.0, _state("ready", a_source_start=90.0))
    assert kept is settings


def test_one_yet_to_be_made_is_told_before_it_starts():
    fixed = with_room({"move": "echo_out"}, 1, 2, 90.0, 200.0, _state("none"))
    assert fixed["leave_after"] == 120.0


def test_one_already_being_made_gets_the_chance_to_turn_out_fine():
    settings = {"move": "echo_out"}
    assert with_room(settings, 1, 2, 90.0, 200.0, _state("rendering")) is settings


def test_one_yet_to_be_made_is_not_bothered_when_nothing_would_leave_that_early():
    settings = {"move": "echo_out"}
    assert with_room(settings, 1, 2, 10.0, 200.0, _state("none")) is settings


def test_not_knowing_where_it_lands_changes_nothing():
    settings = {"move": "echo_out"}
    assert with_room(settings, 1, 2, None, 200.0, _state("ready", a_source_start=1.0)) is settings


def test_a_place_someone_chose_stays_theirs():
    for pinned in ({"exit_bar": 12}, {"shape": "x"}):
        assert with_room(pinned, 1, 2, 90.0, 200.0, _state("ready", a_source_start=1.0)) is pinned


def test_it_does_not_keep_asking_once_it_has_asked():
    settings = {"leave_after": 120.0}
    assert with_room(settings, 1, 2, 90.0, 200.0, _state("ready", a_source_start=30.0)) is settings


def test_it_asks_again_if_the_song_comes_in_later_than_it_did():
    assert (
        with_room({"leave_after": 90.0}, 1, 2, 90.0, 200.0, _state("none"))["leave_after"] == 120.0
    )


def test_a_song_entered_near_its_end_gets_what_is_left():
    fixed = with_room({}, 1, 2, 170.0, 200.0, _state("ready", a_source_start=60.0))
    assert fixed["leave_after"] == 178.0


def test_a_song_entered_right_at_its_end_can_not_be_helped():
    settings = {}
    assert with_room(settings, 1, 2, 195.0, 200.0, _state("ready", a_source_start=60.0)) is settings


def test_along_a_chain_each_goes_by_the_one_before():
    states = {
        request_from(1, 2, {}).key: {
            "status": "ready",
            "a_source_start": 60.0,
            "b_source_end": 100.0,
        },
        request_from(2, 3, {}).key: {
            "status": "ready",
            "a_source_start": 50.0,
            "b_source_end": 30.0,
        },
    }
    settled = chain_with_room(
        [1, 2, 3, 4],
        [{}, {}, {}],
        None,
        lambda _song: 200.0,
        lambda key: states.get(key, {"status": "none"}),
    )
    assert settled[0] == {}
    assert settled[1] == {"leave_after": 130.0}
    assert settled[2] == {}, "the one before it isn't made yet, so where it lands isn't known"


# ---- the mix


@pytest.fixture
def conn(tmp_path):
    connection = db.connect(tmp_path / "selecta.sqlite")
    for song_id in range(1, 6):
        connection.execute(
            "INSERT INTO songs(id,path,folder,size,mtime,duration,artist,title,is_music) "
            "VALUES(?,?,?,?,?,?,?,?,1)",
            (song_id, f"{song_id}.flac", "f", 1, 1.0, 200.0, "A", f"Song {song_id}"),
        )
        connection.execute(
            "INSERT INTO analysis(song_id,version,bpm,camelot) VALUES(?,?,?,?)",
            (song_id, ANALYSIS_VERSION, 120.0, "8A"),
        )
    connection.commit()
    return connection


@pytest.fixture
def store(tmp_path):
    return SeamStore(Settings(tmp_path))


def _finish(store, a, b, settings=None, **facts):
    key = request_from(a, b, settings or {}).key
    folder = store.folder(key)
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "seam.json").write_text(json.dumps({"status": "ready", "key": key, **facts}), "utf-8")
    (folder / "clip.flac").write_bytes(b"x")


def _fill(conn, *songs, draft=None):
    for song in songs:
        mix.add_song(conn, song, None, draft)


def test_every_mix_gets_put_right_when_it_is_read(conn, store):
    _fill(conn, 1, 2, 3)
    _finish(store, 1, 2, a_source_start=60.0, b_source_end=90.0)
    _finish(store, 2, 3, a_source_start=70.0, b_source_end=30.0)
    settle_chain(conn, store)
    after = mix.read_mix(conn, store)
    assert after[1]["seam"]["settings"] == {}
    assert after[2]["seam"]["settings"]["leave_after"] == 120.0
    assert after[2]["seam"]["state"]["status"] == "none", "so it goes back in line to be made"


def test_doing_it_again_changes_nothing(conn, store):
    _fill(conn, 1, 2, 3)
    _finish(store, 1, 2, a_source_start=60.0, b_source_end=90.0)
    _finish(store, 2, 3, a_source_start=70.0, b_source_end=30.0)
    settle_chain(conn, store)
    before = mix._items(conn)
    settle_chain(conn, store)
    assert mix._items(conn) == before


def test_the_new_one_is_kept_once_it_is_made(conn, store):
    _fill(conn, 1, 2, 3)
    _finish(store, 1, 2, a_source_start=60.0, b_source_end=90.0)
    _finish(store, 2, 3, a_source_start=70.0, b_source_end=30.0)
    settle_chain(conn, store)
    _finish(store, 2, 3, {"leave_after": 120.0}, a_source_start=125.0, b_source_end=30.0)
    settle_chain(conn, store)
    assert mix.read_mix(conn, store)[2]["seam"]["state"]["status"] == "ready"


def test_a_change_carries_along_the_mix(conn, store):
    """A later way out can mean a later way in to the next song, which has to be right too."""
    _fill(conn, 1, 2, 3, 4)
    _finish(store, 1, 2, a_source_start=60.0, b_source_end=90.0)
    _finish(store, 2, 3, {"leave_after": 120.0}, a_source_start=125.0, b_source_end=80.0)
    _finish(store, 3, 4, a_source_start=70.0, b_source_end=30.0)
    mix.set_seam(conn, 2, {"leave_after": 120.0})
    settle_chain(conn, store)
    assert mix.read_mix(conn, store)[3]["seam"]["settings"]["leave_after"] == 110.0


def test_the_first_song_has_no_limit_because_it_starts_from_the_top(conn, store):
    _fill(conn, 1, 2)
    settle_chain(conn, store)
    assert mix.read_mix(conn, store)[1]["seam"]["settings"] == {}


def test_an_empty_or_single_song_mix_is_fine(conn, store):
    settle_chain(conn, store)
    _fill(conn, 1)
    settle_chain(conn, store)
    assert len(mix.read_mix(conn, store)) == 1


def test_drafts_are_put_right_too(conn, store):
    draft = mix.create_draft(conn, "Friday")
    _fill(conn, 1, 2, 3, draft=draft)
    _finish(store, 1, 2, a_source_start=60.0, b_source_end=90.0)
    _finish(store, 2, 3, a_source_start=70.0, b_source_end=30.0)
    settle_chain(conn, store, draft)
    assert mix.read_mix(conn, store, draft)[2]["seam"]["settings"]["leave_after"] == 120.0
    assert mix._items(conn) == [], "and it leaves the current mix alone"


def test_a_chosen_move_stays_chosen(conn, store):
    _fill(conn, 1, 2, 3)
    mix.set_seam(conn, 2, {"move": "delay_throw"})
    _finish(store, 1, 2, a_source_start=60.0, b_source_end=90.0)
    _finish(store, 2, 3, {"move": "delay_throw"}, a_source_start=70.0, b_source_end=30.0)
    settle_chain(conn, store)
    assert mix.read_mix(conn, store)[2]["seam"]["settings"]["move"] == "delay_throw"


def test_what_can_not_be_helped_is_flagged(conn, store):
    _fill(conn, 1, 2, 3)
    mix.set_seam(conn, 2, {"exit_bar": 12})
    _finish(store, 1, 2, a_source_start=60.0, b_source_end=90.0)
    _finish(store, 2, 3, {"exit_bar": 12}, a_source_start=70.0, b_source_end=30.0)
    settle_chain(conn, store)
    assert mix.read_mix(conn, store)[2]["seam"]["too_soon"] is True


def test_nothing_is_flagged_when_it_fits(conn, store):
    _fill(conn, 1, 2, 3)
    _finish(store, 1, 2, a_source_start=60.0, b_source_end=30.0)
    _finish(store, 2, 3, a_source_start=70.0, b_source_end=30.0)
    assert "too_soon" not in mix.read_mix(conn, store)[2]["seam"]


# ---- rendering honours it


def test_seams_that_never_needed_this_keep_their_keys_and_their_audio():
    plain = SeamRequest(a=1, b=2, move="echo_out")
    assert plain.key == request_from(1, 2, {"move": "echo_out"}).key
    assert plain.key != request_from(1, 2, {"move": "echo_out", "leave_after": 100.0}).key


def test_it_starts_no_sooner_than_it_was_told(tmp_path):
    from selecta.render.engine import SongCache

    a, b = _two_songs(tmp_path)
    free, *_rest = _bar_cue_render(SeamRequest(1, 2, "echo_out"), a, b, SongCache())
    later = free.script.a_source_start + 8.0
    held, *_rest = _bar_cue_render(
        SeamRequest(1, 2, "echo_out", leave_after=later), a, b, SongCache()
    )
    assert held.script.a_source_start >= later


def test_if_there_is_nowhere_that_late_it_says_so(tmp_path):
    from selecta.render.engine import SongCache
    from selecta.seams import CannotRender

    a, b = _two_songs(tmp_path)
    with pytest.raises(CannotRender):
        _bar_cue_render(
            SeamRequest(1, 2, "echo_out", leave_after=a.duration + 10.0), a, b, SongCache()
        )


def test_not_having_room_says_nothing_about_whether_two_songs_work():
    memory = SeamMemory()
    request = {"a": 1, "b": 2, "move": "echo_out", "leave_after": 180.0}
    memory.learn({"status": "failed", "request": request, "rules": memory_rules()})
    memory.learn(
        {
            "status": "ready",
            "style": "delay_throw",
            "passed": True,
            "request": request,
            "tried": [{"move": "echo_out", "why": "no room"}],
            "rules": memory_rules(),
        }
    )
    assert memory.move_factor(1, 2, "echo_out") > 0


def memory_rules():
    from selecta.planner.memory import RULES_VERSION

    return RULES_VERSION


# ---- requests that have stopped needing something


def test_what_requests_stop_needing_comes_out_of_their_line(tmp_path):
    store = SeamStore(Settings(tmp_path))
    keep, drop = SeamRequest(1, 2, "echo_out"), SeamRequest(3, 4, "echo_out")
    store.ask(keep, after=[])
    store.ask(drop, after=[])
    store.drop_requests([drop.key])
    assert [item[0].key for item in store._requested] == [keep.key]


def test_it_is_asked_for_afresh_if_it_is_wanted_again(tmp_path, monkeypatch):
    store = SeamStore(Settings(tmp_path))
    request = SeamRequest(1, 2, "echo_out")
    monkeypatch.setattr(store, "start", lambda: None)

    class Worker:
        stdin = None

        def poll(self):
            return None

    sent = []
    worker = Worker()
    worker.stdin = type(
        "Pipe",
        (),
        {"write": lambda _self, line: sent.append(json.loads(line)), "flush": lambda _self: None},
    )()
    store._worker = worker
    store.submit(request, after=[])
    assert store.status(request.key)["status"] == "queued"
    store.keep_requested(set())
    assert sent[-1] == {"drop": [request.key]}
    assert store.status(request.key)["status"] == "none"
    store.submit(request, after=[])
    assert store.status(request.key)["status"] == "queued"
    count = len(sent)
    store.keep_requested({request.key})
    assert len(sent) == count, "nothing to say, so nothing is sent"


def test_a_list_for_someone_hearing_a_seam_or_a_worker_gone_is_handled(tmp_path):
    store = SeamStore(Settings(tmp_path))
    store._asked_by_requests.add("gone")
    store.keep_requested(set())
    assert store._asked_by_requests == set()


# ---- looking things up without asking the disk each time


def test_a_quick_look_gives_the_same_answers(tmp_path):
    store = SeamStore(Settings(tmp_path))
    done = SeamRequest(1, 2, "echo_out")
    _finish(store, 1, 2, {"move": "echo_out"}, a_source_start=60.0, b_source_end=30.0)
    read = store.status_reader()
    assert read(done.key)["status"] == store.status(done.key)["status"] == "ready"
    assert read("never-tried") == {"status": "none", "key": "never-tried"}


def test_a_quick_look_with_nothing_rendered_yet_is_fine(tmp_path):
    assert SeamStore(Settings(tmp_path)).status_reader()("x")["status"] == "none"


def test_memory_only_reads_what_has_changed(tmp_path, monkeypatch):
    store = SeamStore(Settings(tmp_path))
    _finish(
        store, 1, 2, {"move": "echo_out"}, a_source_start=60.0, b_source_end=30.0, style="echo_out"
    )
    store.remembered(fresh=True)
    reads = []
    real = json.loads
    monkeypatch.setattr("selecta.seams.json.loads", lambda text: reads.append(1) or real(text))
    store.remembered(fresh=True)
    assert reads == []
