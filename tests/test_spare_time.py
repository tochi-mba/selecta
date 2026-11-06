"""With nothing else to do, Selecta gets the library's best transitions ready."""

from __future__ import annotations

from types import SimpleNamespace as NS

import pytest

import selecta.planner.prepare as prepare
import selecta.request_planner as planner
import selecta.seam_worker as worker
from selecta import db
from selecta.config import Settings
from selecta.planner.memory import SeamMemory
from selecta.planner.prepare import best_transitions, next_transition
from selecta.request_planner import PairBook
from selecta.seams import SeamRequest, SeamStore


def _song(song_id, bpm=120.0, title=None, artist=None, camelot="8A"):
    return NS(
        id=song_id,
        title=title or f"Song {song_id}",
        artist=artist or f"Artist {song_id}",
        bpm=bpm,
        camelot=camelot,
        exit_cues=lambda: [],
        entry_cues=lambda: [],
    )


@pytest.fixture
def wired(monkeypatch):
    monkeypatch.setattr(planner, "handoff_quality", lambda a, b, _riders: 0.9)
    monkeypatch.setattr(
        planner,
        "enumerate_candidates",
        lambda _a, _b, name=None, **_kw: [NS(score=0.7)]
        if name in {"bass_swap_blend", "tempo_ramp", "echo_out"}
        else [],
    )


def _pairs(songs, memory=None, **options):
    return best_transitions(songs, memory or SeamMemory(), PairBook(), **options)


def _next(pairs, songs, memory=None, status=None, **options):
    return next_transition(
        pairs,
        {song.id: song for song in songs},
        PairBook(),
        status or (lambda key: {"status": "none", "key": key}),
        memory or SeamMemory(),
        **options,
    )


def test_every_song_gets_its_best_partner_before_any_gets_a_second(wired):
    songs = [_song(i, bpm=120.0 + i * 0.1) for i in range(1, 7)]
    pairs = _pairs(songs)
    firsts = [a for a, _b in pairs[:6]]
    assert sorted(firsts) == [1, 2, 3, 4, 5, 6]
    assert len(pairs) == 12


def test_the_closest_in_tempo_and_key_is_the_best_partner(wired):
    songs = [_song(1), _song(2, bpm=128.0), _song(3, bpm=121.0), _song(4, camelot="2B", bpm=120.5)]
    assert next(b for a, b in _pairs(songs) if a == 1) == 3


def test_what_the_listener_liked_counts(wired):
    memory = SeamMemory()
    memory.liked.add((1, 3, "bass_swap_blend"))
    songs = [_song(1), _song(2, bpm=120.5), _song(3, bpm=121.0)]
    assert next(b for a, b in _pairs(songs, memory) if a == 1) == 3


def test_a_songs_own_artist_does_not_count(wired):
    songs = [_song(1, artist="Same"), _song(2, artist="Same"), _song(3, bpm=125.0)]
    assert all({a, b} != {1, 2} for a, b in _pairs(songs))


def test_another_version_of_a_song_does_not_count(wired):
    songs = [_song(1, title="Hit", artist="A"), _song(2, title="Hit (Extended)", artist="A & B")]
    assert _pairs(songs) == []


def test_songs_too_far_apart_are_not_looked_at(wired):
    assert _pairs([_song(1, bpm=90.0), _song(2, bpm=140.0)]) == []


def test_songs_the_listener_does_not_want_are_left_out(wired):
    songs = [_song(1), _song(2, bpm=121.0), _song(3, bpm=122.0)]
    assert all(3 not in pair for pair in _pairs(songs, allowed={1, 2}))


def test_pairs_that_would_not_work_are_left_out(monkeypatch):
    monkeypatch.setattr(planner, "handoff_quality", lambda _a, _b, _riders: 0.2)
    assert _pairs([_song(1), _song(2)]) == []


def test_an_empty_library_is_fine():
    assert _pairs([]) == []
    assert _next([], []) is None


def test_it_makes_the_first_one_that_has_not_been_made(wired):
    songs = [_song(1), _song(2)]
    assert _next([(1, 2), (2, 1)], songs) == SeamRequest(1, 2, "bass_swap_blend")


def test_something_that_came_out_clean_is_not_made_again(wired):
    songs = [_song(1), _song(2)]
    memory = SeamMemory()
    memory.clean.add((1, 2, "bass_swap_blend"))
    assert _next([(1, 2), (2, 1)], songs, memory) == SeamRequest(2, 1, "bass_swap_blend")


def test_nor_when_its_audio_has_been_cleared_to_make_room(wired):
    """It would be stuck making the same few for ever, as they pushed each other out."""
    songs = [_song(1), _song(2)]
    memory = SeamMemory()
    memory.clean.add((1, 2, "bass_swap_blend"))
    assert _next([(1, 2)], songs, memory, lambda key: {"status": "none", "key": key}) is None


def test_one_that_fell_short_tries_the_next_move(wired):
    songs = [_song(1), _song(2)]
    first = SeamRequest(1, 2, "bass_swap_blend").key

    def status(key):
        return {"status": "ready", "passed": False} if key == first else {"status": "none"}

    assert _next([(1, 2)], songs, status=status) == SeamRequest(1, 2, "echo_out")


def test_one_known_to_fail_is_passed_over(wired):
    songs = [_song(1), _song(2)]
    memory = SeamMemory()
    memory.failed.add((1, 2, "bass_swap_blend"))
    assert _next([(1, 2)], songs, memory) == SeamRequest(1, 2, "echo_out")


def test_a_pair_with_a_good_one_is_done(wired):
    songs = [_song(1), _song(2)]
    assert _next([(1, 2)], songs, status=lambda _k: {"status": "ready", "passed": True}) is None


def test_one_under_way_is_left_to_finish(wired):
    songs = [_song(1), _song(2)]
    assert _next([(1, 2)], songs, status=lambda _k: {"status": "rendering"}) is None


def test_moves_the_listener_has_not_liked_are_not_made(monkeypatch):
    monkeypatch.setattr(planner, "handoff_quality", lambda *_a: 0.9)
    monkeypatch.setattr(
        planner,
        "enumerate_candidates",
        lambda _a, _b, name=None, **_kw: [NS(score=0.7)] if name == "tempo_ramp" else [],
    )
    assert _next([(1, 2)], [_song(1), _song(2)]) is None


def test_vocal_rides_come_after_a_quick_one_for_everything(wired, monkeypatch):
    monkeypatch.setattr(planner, "modes_for", lambda _a, _b: {"word_blend"})
    monkeypatch.setattr(planner, "ride_lines", lambda _a, _b: ("out", "in"))
    songs = [_song(1), _song(2)]
    memory = SeamMemory()
    assert _next([(1, 2), (2, 1)], songs, memory, stems="often").move == "bass_swap_blend"
    memory.clean |= {(1, 2, "bass_swap_blend"), (2, 1, "bass_swap_blend")}
    assert _next([(1, 2), (2, 1)], songs, memory, stems="often") == SeamRequest(1, 2, "vocal_ride")


def test_no_vocal_rides_if_stems_are_turned_off(wired, monkeypatch):
    monkeypatch.setattr(planner, "modes_for", lambda _a, _b: {"word_blend"})
    monkeypatch.setattr(planner, "ride_lines", lambda _a, _b: ("out", "in"))
    memory = SeamMemory()
    memory.clean.add((1, 2, "bass_swap_blend"))
    assert _next([(1, 2)], [_song(1), _song(2)], memory, stems="never") is None


def test_songs_that_have_left_the_library_are_skipped(wired):
    assert _next([(1, 99), (1, 2)], [_song(1), _song(2)]) == SeamRequest(1, 2, "bass_swap_blend")


# ---- the worker


@pytest.fixture
def preparer(tmp_path, monkeypatch, wired):
    settings = Settings(tmp_path)
    conn = db.connect(settings.db_path)
    for song_id in (1, 2, 3):
        conn.execute(
            "INSERT INTO songs(id,path,folder,size,mtime,duration,artist,title,is_music) "
            "VALUES(?,?,?,?,?,?,?,?,1)",
            (song_id, f"{song_id}.flac", "f", 1, 1.0, 200.0, f"A{song_id}", f"Song {song_id}"),
        )
    conn.commit()
    conn.close()
    songs = [_song(1), _song(2, bpm=121.0), _song(3, bpm=122.0)]
    monkeypatch.setattr("selecta.planner.reel.load_library", lambda _conn, _settings: songs)
    monkeypatch.setattr("selecta.discovery.search.lyric_links", lambda _conn: [])
    monkeypatch.setattr(prepare, "best_links", lambda _links, _songs: ([], {}, None))
    monkeypatch.setattr(worker, "cache_bytes", lambda _settings: 0)
    monkeypatch.setattr(worker, "largest_cache_bytes", lambda _settings: 1000)
    store = SeamStore(settings)
    return settings, store


def test_with_nothing_else_to_do_it_gets_on_with_the_library(preparer):
    settings, store = preparer
    request = worker._preparer(store, settings)()
    assert request is not None
    assert request.move == "bass_swap_blend"


def test_word_links_still_come_first(preparer, monkeypatch):
    settings, store = preparer
    link = SeamRequest(1, 2, "word_cut", phrase="hello")
    monkeypatch.setattr(prepare, "next_to_prepare", lambda *_a: link)
    assert worker._preparer(store, settings)() == link


def test_it_leaves_room_for_what_is_being_played(preparer, monkeypatch):
    settings, store = preparer
    monkeypatch.setattr(worker, "cache_bytes", lambda _settings: 900)
    assert worker._preparer(store, settings)() is None


def test_a_song_set_to_never_play_is_left_out(preparer):
    settings, store = preparer
    conn = db.connect(settings.db_path)
    db.set_preference(conn, "never_play", [1, 2])
    conn.commit()
    conn.close()
    assert worker._preparer(store, settings)() is None
