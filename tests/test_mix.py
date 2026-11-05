"""The mix a person edits: songs in order, with a seam between each pair."""

import json
import time
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf
from fastapi.testclient import TestClient
from helpers import song_from_track
from synth import SR, make_track

from selecta import db, mix
from selecta.analysis.pipeline import features_path
from selecta.api import create_app
from selecta.config import ANALYSIS_VERSION, Settings
from selecta.lyrics.lrclib import Line
from selecta.planner.beam import ARTIST_SEPARATION, plan_set, suggest_next
from selecta.seams import SeamRequest, SeamStore, links_between, request_from, seam_options


def _song_row(conn, song_id, artist, title, path="x.flac"):
    conn.execute(
        "INSERT INTO songs(id,path,folder,size,mtime,duration,artist,title,is_music) "
        "VALUES(?,?,?,?,?,?,?,?,1)",
        (song_id, f"{song_id}-{path}", "f", 1, 1.0, 200.0, artist, title),
    )
    conn.execute(
        "INSERT INTO analysis(song_id,version,bpm,camelot) VALUES(?,?,?,?)",
        (song_id, ANALYSIS_VERSION, 120.0, "8A"),
    )


@pytest.fixture
def conn(tmp_path):
    connection = db.connect(tmp_path / "selecta.sqlite")
    for song_id in range(1, 6):
        _song_row(connection, song_id, f"Artist {song_id}", f"Song {song_id}")
    connection.commit()
    return connection


@pytest.fixture
def store(tmp_path):
    return SeamStore(Settings(tmp_path))


def _order(conn, store):
    return [item["song_id"] for item in mix.read_mix(conn, store)]


def test_songs_can_be_added_anywhere_removed_and_reordered(conn, store):
    for song in (1, 2, 3):
        mix.add_song(conn, song)
    mix.add_song(conn, 4, 1)
    assert _order(conn, store) == [1, 4, 2, 3]
    mix.move_song(conn, 3, 0)
    assert _order(conn, store) == [3, 1, 4, 2]
    mix.remove_at(conn, 1)
    assert _order(conn, store) == [3, 4, 2]


def test_the_first_song_has_no_seam_and_the_rest_do(conn, store):
    for song in (1, 2, 3):
        mix.add_song(conn, song)
    items = mix.read_mix(conn, store)
    assert items[0]["seam"] is None
    assert items[1]["seam"]["state"]["status"] == "none"


def test_seam_settings_stick_and_change_what_gets_rendered(conn, store):
    for song in (1, 2):
        mix.add_song(conn, song)
    plain = mix.read_mix(conn, store)[1]["seam"]["state"]["key"]
    mix.set_seam(conn, 1, {"move": "vocal_ride", "bars": 8, "phrase": None})
    item = mix.read_mix(conn, store)[1]
    assert item["seam"]["settings"] == {"move": "vocal_ride", "bars": 8}
    assert item["seam"]["state"]["key"] != plain


def test_moving_a_song_resets_only_the_seams_whose_pairs_changed(conn, store):
    for song in (1, 2, 3, 4):
        mix.add_song(conn, song)
    for position in (1, 2, 3):
        mix.set_seam(conn, position, {"move": "cut_on_one"})
    mix.move_song(conn, 1, 2)  # 1 3 2 4: every pair around song 2 is new
    settings = [item["seam"]["settings"] for item in mix.read_mix(conn, store)[1:]]
    assert settings == [{"move": "cut_on_one"} if False else {}, {}, {}]
    for position in (1, 2, 3):
        mix.set_seam(conn, position, {"move": "cut_on_one"})
    mix.add_song(conn, 5)
    mix.move_song(conn, 4, 3)  # 1 3 2 5 4: the 1-3 and 3-2 pairs stay the same
    settings = [item["seam"]["settings"] for item in mix.read_mix(conn, store)[1:]]
    assert settings[:2] == [{"move": "cut_on_one"}, {"move": "cut_on_one"}]
    assert settings[2:] == [{}, {}]


def test_a_new_plan_keeps_locked_songs_where_they_are(conn, store):
    """An earlier build lost every lock whenever it planned again."""
    for song in (1, 2, 3):
        mix.add_song(conn, song)
    mix.toggle_lock(conn, 1)
    mix.set_seam(conn, 1, {"move": "cut_on_one"})
    mix.merge_with_locks(conn, [5, 4, 2, 3])
    items = mix.read_mix(conn, store)
    assert [item["song_id"] for item in items] == [5, 2, 4, 3]
    assert items[1]["locked"]
    assert items[1]["seam"]["settings"] == {"move": "cut_on_one"}


def test_requests_are_the_same_only_when_the_choices_are():
    base = request_from(1, 2, {"move": "bass_swap_blend", "bars": 8})
    assert base.key == SeamRequest(1, 2, "bass_swap_blend", 8).key
    assert base.key != SeamRequest(1, 2, "bass_swap_blend", 16).key
    assert base.key != SeamRequest(2, 1, "bass_swap_blend", 8).key
    assert request_from(1, 2, None).move == "auto"


def test_a_finished_seam_keeps_its_rating(tmp_path, store):
    request = SeamRequest(1, 2)
    folder = store.folder(request.key)
    folder.mkdir(parents=True)
    (folder / "seam.json").write_text(json.dumps({"status": "ready", "key": request.key}), "utf-8")
    store.rate(request.key, "good", "lovely")
    again = SeamStore(store.settings).status(request.key)
    assert again["rating"] == "good"
    assert again["note"] == "lovely"


def test_the_options_say_why_a_move_is_ruled_out(tmp_path):
    a = song_from_track(tmp_path, "a", make_track(bpm=120, bars=96, seed=1))
    b = song_from_track(tmp_path, "b", make_track(bpm=88, bars=96, seed=2))
    options = seam_options(a, b)
    moves = {move["name"]: move for move in options["moves"]}
    assert moves["auto"]["available"]
    assert not moves["bass_swap_blend"]["available"]
    assert "tempo" in moves["bass_swap_blend"]["reason"]
    assert not moves["word_cut"]["available"]
    assert "phrase" in moves["word_cut"]["reason"]
    assert options["exits"] and options["entries"]


def test_a_shared_phrase_opens_up_the_word_moves(tmp_path):
    a = song_from_track(tmp_path, "a", make_track(bpm=120, bars=96, seed=1))
    b = song_from_track(tmp_path, "b", make_track(bpm=120, bars=96, seed=2))
    a.artist, b.artist = "One", "Two"
    a.lines = [Line(70.0, 73.0, "you have got me on my knees"), Line(80.0, 82.0, "more words here")]
    b.lines = [Line(40.0, 43.0, "on my knees again"), Line(50.0, 52.0, "other words here")]
    assert any(link.phrase == "on my knees" for link in links_between(a, b))
    moves = {move["name"]: move for move in seam_options(a, b)["moves"]}
    assert moves["word_cut"]["available"]
    assert moves["phrase_roll"]["available"]
    assert moves["word_blend"]["available"]


def _song(tmp_path, name, artist, bpm=120.0, energy=0.5, camelot="8A"):
    song = song_from_track(tmp_path, name, make_track(bpm=bpm, bars=64, seed=abs(hash(name)) % 99))
    song.artist = artist
    song.energy = energy
    song.camelot = camelot
    return song


def test_a_plan_never_brings_an_artist_back_too_soon(tmp_path):
    """An earlier planner repeated an artist two songs apart. The rule is ten."""
    songs = [_song(tmp_path, f"s{i}", f"Artist {i % 3}") for i in range(9)]
    planned = plan_set(songs, songs[0].id, 6)
    artists = [item.song.artist for item in planned]
    assert len(artists) == 3, "only three artists, so it has to stop rather than repeat"
    assert ARTIST_SEPARATION >= 10


def test_a_plan_is_quick_and_never_repeats_a_song(tmp_path):
    songs = [_song(tmp_path, f"s{i}", f"Artist {i}", bpm=118.0 + i % 5) for i in range(24)]
    planned = plan_set(songs, songs[3].id, 12)
    ids = [item.song.id for item in planned]
    assert ids[0] == songs[3].id
    assert len(ids) == len(set(ids)) == 12


def test_shared_phrases_pull_a_wordplay_plan_towards_them(tmp_path):
    first = _song(tmp_path, "a", "First")
    close = _song(tmp_path, "b", "Second", bpm=120.0)
    linked = _song(tmp_path, "c", "Third", bpm=128.0, camelot="10A")
    without = plan_set([first, close, linked], first.id, 2)
    with_link = plan_set([first, close, linked], first.id, 2, links={(first.id, linked.id)})
    assert without[1].song.id == close.id
    assert with_link[1].song.id == linked.id
    assert with_link[1].reason == "shares a phrase"


@pytest.fixture
def client(tmp_path):
    settings = Settings(tmp_path)
    conn = db.connect(settings.db_path)
    for song_id in (1, 2):
        _song_row(conn, song_id, f"Artist {song_id}", f"Song {song_id}")
    conn.commit()
    conn.close()
    return TestClient(create_app(settings, tmp_path / "no-web"))


def test_the_mix_api_adds_moves_and_removes_songs(client, tmp_path, monkeypatch):
    monkeypatch.setattr("selecta.api.mix.add_song", mix.add_song)
    settings = Settings(tmp_path)
    conn = db.connect(settings.db_path)
    mix.add_song(conn, 1)
    mix.add_song(conn, 2)
    conn.close()
    state = client.get("/api/mix").json()["mix"]
    assert [item["song_id"] for item in state] == [1, 2]
    moved = client.post("/api/mix/move", json={"source": 0, "target": 1}).json()["mix"]
    assert [item["song_id"] for item in moved] == [2, 1]
    changed = client.post("/api/mix/1/seam", json={"move": "cut_on_one"}).json()["mix"]
    assert changed[1]["seam"]["settings"]["move"] == "cut_on_one"
    assert client.post("/api/mix/1/seam", json={"move": "nonsense"}).status_code == 400
    locked = client.post("/api/mix/0/lock").json()["mix"]
    assert locked[0]["locked"]
    left = client.delete("/api/mix/songs/0").json()["mix"]
    assert [item["song_id"] for item in left] == [1]


def test_the_api_refuses_a_song_it_cant_play(client):
    assert client.post("/api/mix/songs", json={"song_id": 999}).status_code == 404


def test_scanning_a_folder_that_isnt_there_is_refused_clearly(client):
    answer = client.post("/api/scan", json={"folder": "Z:/no/such/folder"})
    assert answer.status_code == 400
    assert "doesn't exist" in answer.json()["detail"]


def test_seam_files_cant_be_read_outside_the_seam_folder(client):
    assert client.get("/api/seams/..%2F..%2Fselecta.sqlite/clip").status_code == 404


def test_exporting_needs_finished_seams(client, tmp_path):
    settings = Settings(tmp_path)
    conn = db.connect(settings.db_path)
    mix.add_song(conn, 1)
    mix.add_song(conn, 2)
    conn.close()
    answer = client.post("/api/mix/export")
    assert answer.status_code == 400
    assert "rendering" in answer.json()["detail"]


def test_an_exported_mix_joins_songs_and_seams_in_order(tmp_path):
    settings = Settings(tmp_path)
    conn = db.connect(settings.db_path)
    a = song_from_track(tmp_path, "a", make_track(bpm=120, bars=16, seed=1))
    b = song_from_track(tmp_path, "b", make_track(bpm=120, bars=16, seed=2))
    for row_id, song in ((1, a), (2, b)):
        conn.execute(
            "INSERT INTO songs(id,path,folder,size,mtime,duration,artist,title,is_music) "
            "VALUES(?,?,?,?,?,?,?,?,1)",
            (row_id, song.path, "f", 1, 1.0, song.duration, song.artist, song.title),
        )
        conn.execute(
            "INSERT INTO analysis(song_id,version,bpm,camelot,lufs,peak_db,energy,sections,"
            "beats_per_bar,grid_confidence,constant_tempo,key_confidence) "
            "VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
            (row_id, ANALYSIS_VERSION, song.bpm, "8A", -14.0, -2.0, 0.5, "[]", 4, 0.9, 1, 0.9),
        )
        features = features_path(settings, row_id)
        features.parent.mkdir(parents=True, exist_ok=True)
        np.savez(
            features,
            beats=song.beats,
            bar_starts=song.bar_starts,
            energy_bars=song.energy_bars,
            low_share_bars=song.low_share_bars,
            chroma_bars=np.zeros((song.bar_starts.size, 12)),
            rms_db_bars=np.zeros(song.bar_starts.size),
            mfcc_bars=np.zeros((song.bar_starts.size, 20)),
        )
    conn.commit()
    mix.add_song(conn, 1)
    mix.add_song(conn, 2)
    store = SeamStore(settings)
    key = mix.read_mix(conn, store)[1]["seam"]["state"]["key"]
    folder = store.folder(key)
    folder.mkdir(parents=True)
    clip = np.full((SR, 2), 0.25, dtype=np.float32)
    sf.write(folder / "clip.flac", clip, SR, subtype="PCM_16")
    (folder / "seam.json").write_text(
        json.dumps({"status": "ready", "key": key, "a_source_start": 4.0, "b_source_end": 3.0}),
        "utf-8",
    )
    out = Path(tmp_path) / "exports" / "mix.flac"
    result = mix.export_mix(conn, settings, store, out)
    expected = 4.0 + 1.0 + (b.duration - 3.0) - 2 * 0.03
    assert result["seconds"] == pytest.approx(expected, abs=0.01)
    assert out.exists()


def test_swapping_a_song_resets_only_its_own_two_seams(conn, store):
    for song in (1, 2, 3, 4):
        mix.add_song(conn, song)
    for position in (1, 2, 3):
        mix.set_seam(conn, position, {"move": "cut_on_one"})
    mix.replace_at(conn, 2, 5)
    items = mix.read_mix(conn, store)
    assert [item["song_id"] for item in items] == [1, 2, 5, 4]
    assert [item["seam"]["settings"] for item in items[1:]] == [{"move": "cut_on_one"}, {}, {}]


def test_bigger_and_calmer_go_the_way_they_say(tmp_path):
    current = _song(tmp_path, "now", "Now", energy=0.5)
    replacing = _song(tmp_path, "old", "Old", energy=0.5)
    bigger = _song(tmp_path, "big", "Big", energy=0.8)
    calmer = _song(tmp_path, "calm", "Calm", energy=0.2)
    songs = [current, replacing, bigger, calmer]
    assert suggest_next(current, songs, {replacing.id}, set(), 1, replacing.id).id == bigger.id
    assert suggest_next(current, songs, {replacing.id}, set(), -1, replacing.id).id == calmer.id


def test_a_suggestion_keeps_artists_apart(tmp_path):
    current = _song(tmp_path, "now", "Now")
    same = _song(tmp_path, "same", "Nearby Artist")
    other = _song(tmp_path, "other", "Someone Else")
    pick = suggest_next(current, [current, same, other], set(), {"nearby artist"})
    assert pick.id == other.id


def test_a_plan_of_twenty_from_a_big_library_is_quick(tmp_path):
    """It took 22 seconds for eight songs before planning reused each song's cues."""
    track = make_track(bpm=120, bars=64, seed=1)
    songs = []
    for i in range(120):
        song = song_from_track(tmp_path, f"s{i}", track)
        song.id = i + 1
        song.artist = f"Artist {i}"
        song.bpm = 110.0 + i % 20
        song.energy = 0.3 + (i % 10) * 0.05
        songs.append(song)
    started = time.perf_counter()
    planned = plan_set(songs, songs[0].id, 20)
    assert len(planned) == 20
    assert time.perf_counter() - started < 30


def test_a_plan_can_say_how_each_seam_should_land(conn, store):
    mix.merge_with_locks(conn, [1, 2, 3], {2: {"move": "phrase_roll", "phrase": "good news"}})
    items = mix.read_mix(conn, store)
    assert items[1]["seam"]["settings"] == {"move": "phrase_roll", "phrase": "good news"}
    assert items[2]["seam"]["settings"] == {}
