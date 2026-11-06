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

from selecta import db, jobs, mix
from selecta.analysis.pipeline import features_path
from selecta.api import create_app
from selecta.config import ANALYSIS_VERSION, Settings
from selecta.lyrics.lrclib import Line
from selecta.planner.beam import ARTIST_SEPARATION, plan_set, suggest_next
from selecta.planner.choose import enumerate_candidates
from selecta.seams import (
    MIX,
    PREPARING,
    CannotRender,
    SeamRequest,
    SeamStore,
    links_between,
    request_from,
    seam_options,
)


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


def test_discovery_review_persists_without_changing_the_mix(conn, tmp_path):
    payload = json.dumps({"a_at": 2, "b_at": 8, "bars": 8, "transpose": 2})
    conn.execute(
        "INSERT INTO seam_book(song_a,song_b,kind,payload,score) VALUES(1,2,?,?,.98)",
        ("harmonic_sequence_candidate", payload),
    )
    conn.commit()
    client = TestClient(create_app(Settings(tmp_path), tmp_path / "no-web"))
    candidate = client.get("/api/discoveries").json()[0]
    assert candidate["payload"]["b_at"] == 8
    route = f"/api/discoveries/{candidate['id']}/review"
    assert client.post(route, json={"verdict": "approved"}).status_code == 200
    assert client.get("/api/discoveries").json()[0]["status"] == "approved"
    assert conn.execute("SELECT COUNT(*) FROM queue").fetchone()[0] == 0
    assert client.post(route, json={"verdict": "invalid"}).status_code == 400
    assert client.post("/api/discoveries/999/review", json={"verdict": "new"}).status_code == 404


def test_listening_routes_hide_mapping_and_persist_responses(conn, tmp_path):
    from selecta.listening import create_trials

    trial = create_trials(
        conn, "study-1", [{"pair": "1-2", "conditions": ["first-render", "second-render"]}], 42
    )[0]
    client = TestClient(create_app(Settings(tmp_path), tmp_path / "no-web"))
    public = client.get("/api/listening?study=study-1")
    assert "first-render" not in public.text
    assert public.json()[0]["id"] == trial
    assert client.get(f"/api/listening/{trial}/a/audio").status_code == 404
    for key in ("first-render", "second-render"):
        folder = Settings(tmp_path).renders_dir / "seams" / key
        folder.mkdir(parents=True)
        (folder / "preview.flac").write_bytes(b"opaque audio response")
    audio = client.get(f"/api/listening/{trial}/a/audio")
    assert audio.status_code == 200
    assert audio.content == b"opaque audio response"
    assert "first-render" not in str(audio.headers)
    assert "second-render" not in str(audio.headers)
    response = client.post(
        f"/api/listening/{trial}/response",
        json={"listener": "one", "choice": "tie", "setup": "headphones"},
    )
    assert response.json() == {"saved": True}
    assert conn.execute("SELECT choice FROM listening_responses").fetchone()[0] == "tie"


def test_skip_feedback_preserves_exposure_and_does_not_edit_queue(conn, tmp_path):
    client = TestClient(create_app(Settings(tmp_path), tmp_path / "no-web"))
    payload = {"song_id": 1, "heard_seconds": 16.9, "source_position": 84.95}
    assert client.post("/api/playback/skip", json=payload).json() == {"saved": True}
    row = conn.execute("SELECT * FROM playback_skips").fetchone()
    assert row["heard_seconds"] == pytest.approx(16.9)
    assert row["source_position"] == pytest.approx(84.95)
    assert conn.execute("SELECT COUNT(*) FROM queue").fetchone()[0] == 0
    assert (
        client.post("/api/playback/skip", json={**payload, "heard_seconds": -1}).status_code == 400
    )
    assert client.post("/api/playback/skip", json={**payload, "song_id": 999}).status_code == 404
    assert conn.execute("SELECT COUNT(*) FROM playback_skips").fetchone()[0] == 1


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
    assert moves["stem_intertwine"]["available"]


def _song(tmp_path, name, artist, bpm=120.0, energy=0.5, camelot="8A"):
    song = song_from_track(tmp_path, name, make_track(bpm=bpm, bars=64, seed=abs(hash(name)) % 99))
    song.artist = artist
    song.energy = energy
    song.camelot = camelot
    return song


def test_a_plan_never_brings_an_artist_back_too_soon(tmp_path):
    """An earlier planner repeated an artist two songs apart. The rule is ten."""
    assert ARTIST_SEPARATION >= 10
    songs = [_song(tmp_path, f"s{i}", f"Artist {i % 24}") for i in range(48)]
    artists = [item.song.artist for item in plan_set(songs, songs[0].id, 22)]
    assert len(artists) == 22
    for i, artist in enumerate(artists):
        assert artist not in artists[max(i - ARTIST_SEPARATION, 0) : i]


def test_a_few_artists_share_a_plan_rather_than_stop_it_short(tmp_path):
    songs = [_song(tmp_path, f"s{i}", f"Artist {i % 3}") for i in range(9)]
    artists = [item.song.artist for item in plan_set(songs, songs[0].id, 6)]
    assert len(artists) == 6
    assert all(x != y for x, y in zip(artists, artists[1:], strict=False))


def test_a_plan_is_quick_and_never_repeats_a_song(tmp_path):
    songs = [_song(tmp_path, f"s{i}", f"Artist {i}", bpm=118.0 + i % 5) for i in range(24)]
    planned = plan_set(songs, songs[3].id, 12)
    ids = [item.song.id for item in planned]
    assert ids[0] == songs[3].id
    assert len(ids) == len(set(ids)) == 12


def test_a_plan_can_reach_a_requested_destination(tmp_path):
    songs = [_song(tmp_path, f"destination-{i}", f"Artist {i}") for i in range(16)]
    planned = plan_set(songs, songs[0].id, 6, end_id=songs[-1].id)
    assert len(planned) == 6
    assert planned[0].song.id == songs[0].id
    assert planned[-1].song.id == songs[-1].id
    assert len({item.song.id for item in planned}) == 6


def test_a_destination_cannot_also_be_the_explicit_start(tmp_path):
    songs = [_song(tmp_path, f"destination-conflict-{i}", f"Artist {i}") for i in range(4)]
    with pytest.raises(ValueError, match="start song and destination are the same"):
        plan_set(songs, songs[0].id, 3, end_id=songs[0].id)
    assert plan_set(songs, count=1, end_id=songs[1].id)[0].song.id == songs[1].id
    with pytest.raises(ValueError, match="one-song mix cannot start and finish"):
        plan_set(songs, songs[0].id, 1, end_id=songs[1].id)


def test_destination_planning_does_not_return_an_unfinished_route(tmp_path, monkeypatch):
    from selecta.planner import beam

    songs = [_song(tmp_path, f"unreachable-{i}", f"Artist {i}") for i in range(3)]
    monkeypatch.setattr(beam, "_best_move", lambda *args: None)
    with pytest.raises(ValueError, match="Could not find a playable route"):
        plan_set(songs, songs[0].id, 3, end_id=songs[-1].id)
    with pytest.raises(ValueError, match="empty library"):
        plan_set([], end_id=99)


def test_shared_phrases_pull_a_wordplay_plan_towards_them(tmp_path):
    first = _song(tmp_path, "a", "First")
    close = _song(tmp_path, "b", "Second", bpm=120.0)
    linked = _song(tmp_path, "c", "Third", bpm=128.0, camelot="10A")
    # Exercise link scoring independently of the grid-confidence gate.
    first.grid_confidence = close.grid_confidence = linked.grid_confidence = 0.95
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


def test_every_change_to_a_mix_can_be_undone(conn, store):
    for song in (1, 2, 3):
        mix.add_song(conn, song)
    mix.set_seam(conn, 1, {"move": "cut_on_one"})
    mix.set_mix_name(conn, "Late night")
    mix.remember(conn, "removing that song")
    mix.remove_at(conn, 0)
    mix.set_mix_name(conn, "Something else")
    assert _order(conn, store) == [2, 3]
    assert mix.undo(conn) == "removing that song"
    assert _order(conn, store) == [1, 2, 3]
    assert mix.read_mix(conn, store)[1]["seam"]["settings"] == {"move": "cut_on_one"}
    assert mix.mix_name(conn) == "Late night"
    assert mix.undo(conn) is None


def test_saved_mixes_come_back_exactly_as_they_were(conn, store):
    for song in (1, 2):
        mix.add_song(conn, song)
    mix.set_seam(conn, 1, {"move": "phrase_roll", "phrase": "good news"})
    mix.save_mix(conn, "For Friday")
    mix.write_order(conn, [])
    assert mix.load_saved(conn, "For Friday")
    assert _order(conn, store) == [1, 2]
    assert mix.read_mix(conn, store)[1]["seam"]["settings"]["phrase"] == "good news"
    assert mix.mix_name(conn) == "For Friday"
    mix.save_mix(conn, "For Friday")
    assert len(mix.saved_mixes(conn)) == 1, "the same name replaces, it doesn't pile up"
    assert not mix.delete_saved(conn, "For Friday")
    assert not mix.load_saved(conn, "For Friday")


def _vibe_library(tmp_path):
    from selecta.planner.vibes import traits_of

    track = make_track(bpm=120, bars=64, seed=1)
    songs = []
    years = {}
    families = ["Afrobeats", "Hip-Hop", "R&B", "Rock", "Pop", "Dance"]
    for i in range(36):
        song = song_from_track(tmp_path, f"v{i}", track, genre=families[i % 6])
        song.id = i + 1
        song.artist = f"Artist {i}"
        song.bpm = 92.0 + i
        song.energy = 0.3 + i * 0.006
        songs.append(song)
        years[song.id] = "1999" if i < 12 else "2021"
    return songs, traits_of(songs, years)


def test_energy_is_measured_against_your_own_library(tmp_path):
    """Raw scores sit between about 0.4 and 0.5, so "high" has to mean high for this library."""
    songs, traits = _vibe_library(tmp_path)
    assert traits[songs[0].id].energy == 0.0
    assert traits[songs[-1].id].energy == 1.0


def test_each_vibe_only_uses_songs_that_fit_it(tmp_path):
    from selecta.planner.vibes import BY_KEY, build_vibe, eligible

    songs, traits = _vibe_library(tmp_path)
    afro = eligible(BY_KEY["afro_heat"], songs, traits)
    assert afro and all(song.family == "afro" for song in afro)
    old = eligible(BY_KEY["throwbacks"], songs, traits)
    assert old and all(traits[song.id].year < 2010 for song in old)
    peak = eligible(BY_KEY["peak"], songs, traits)
    assert peak and all(traits[song.id].energy >= 0.6 for song in peak)
    planned, _ = build_vibe(BY_KEY["peak"], songs, traits, {}, 5, seed=1)
    assert {item.song.id for item in planned} <= {song.id for song in peak}


def test_listener_transition_feel_overrides_the_vibes_default(tmp_path, monkeypatch):
    from selecta.planner import vibes

    songs, traits = _vibe_library(tmp_path)
    seen = {}

    def plan_set(*_args, **kwargs):
        seen["language"] = kwargs["mix_language"]
        seen["stems"] = kwargs["stems"]
        seen["energy_arc"] = kwargs.get("energy_arc")
        return []

    def seam_choices(vibe, *_args):
        seen["seam_language"] = vibe.language
        return {}

    monkeypatch.setattr(vibes, "plan_set", plan_set)
    monkeypatch.setattr(vibes, "seam_choices", seam_choices)
    vibes.build_vibe(vibes.BY_KEY["peak"], songs, traits, {}, 6, seed=1)
    assert seen["language"] == "seamless"
    assert seen["seam_language"] == "seamless"
    vibes.build_vibe(vibes.BY_KEY["peak"], songs, traits, {}, 6, seed=1, mix_language="punchy")
    assert seen["language"] == "punchy"
    assert seen["seam_language"] == "punchy"
    vibes.build_vibe(
        vibes.BY_KEY["peak"],
        songs,
        traits,
        {},
        6,
        seed=1,
        stems="never",
        energy_arc=[0.1, 0.4, 0.9, 0.6, 0.2],
    )
    assert seen["stems"] == "never"
    assert seen["energy_arc"] == [0.1, 0.4, 0.9, 0.6, 0.2]


def test_building_a_vibe_ends_on_the_requested_song(tmp_path):
    from selecta.planner.vibes import BY_KEY, build_vibe

    songs, traits = _vibe_library(tmp_path)
    destination = songs[-1]
    planned, _ = build_vibe(
        BY_KEY["slow_burn"], songs, traits, {}, 6, seed=4, end_id=destination.id
    )
    assert len(planned) == 6
    assert planned[-1].song.id == destination.id
    assert planned[-1].reason == "your requested destination"


def test_destination_does_not_break_seasonal_mix_rules(tmp_path):
    from selecta.planner.vibes import BY_KEY, build_vibe

    songs, traits = _vibe_library(tmp_path)
    with pytest.raises(ValueError, match="choose a Christmas song"):
        build_vibe(BY_KEY["christmas"], songs, traits, {}, 6, end_id=songs[0].id)


def test_a_vibe_with_too_few_songs_says_how_many_it_needs(tmp_path):
    from selecta.planner.vibes import BY_KEY, describe

    songs, traits = _vibe_library(tmp_path)
    card = describe(BY_KEY["afro_heat"], songs[:6], traits)
    assert not card["ready"]
    assert card["needs"] == 5
    full = describe(BY_KEY["pick"], songs, traits)
    assert full["ready"]
    assert len(full["artists"]) == 4


def test_word_handoffs_stay_rare_unless_the_mix_is_about_them(tmp_path):
    from selecta.planner.beam import PlannedSong
    from selecta.planner.vibes import BY_KEY, seam_choices

    track = make_track(bpm=120, bars=64, seed=1)
    songs = []
    for i in range(8):
        song = song_from_track(tmp_path, f"w{i}", track, genre="Pop")
        song.id = i + 1
        song.lines = [Line(10.0, 12.0, "you and me in the night")]
        songs.append(song)
    planned = [PlannedSong(song, "bass_swap_blend", "") for song in songs]
    phrases = {(songs[i].id, songs[i + 1].id): "good news" for i in range(7)}
    showcase = seam_choices(BY_KEY["wordplay"], planned, phrases)
    assert sum("phrase" in seam for seam in showcase.values()) == 7
    usual = seam_choices(BY_KEY["pick"], planned, phrases)
    positions = [i for i, song in enumerate(songs) if "phrase" in usual.get(song.id, {})]
    assert len(positions) == 2
    assert positions[1] - positions[0] >= 4


def test_stem_preference_steers_vocal_ride_availability_and_weight(tmp_path, monkeypatch):
    from selecta.planner import vibes
    from selecta.planner.wordreel import Verdicts

    a = _song(tmp_path, "stem-a", "First")
    b = _song(tmp_path, "stem-b", "Second")
    monkeypatch.setattr(vibes, "modes_for", lambda *_: {"word_blend"})
    monkeypatch.setattr(vibes, "ride_lines", lambda *_: (object(), object()))
    monkeypatch.setattr(vibes, "enumerate_candidates", lambda *_args, **_kwargs: [object()])
    monkeypatch.setattr(vibes, "can_intertwine", lambda *_: True)
    vibe = vibes.BY_KEY["pick"]

    never = vibes._moves_that_fit(vibe, a, b, Verdicts(), "never")
    sometimes = dict(vibes._moves_that_fit(vibe, a, b, Verdicts(), "sometimes"))
    often = dict(vibes._moves_that_fit(vibe, a, b, Verdicts(), "often"))

    assert "vocal_ride" not in dict(never)
    assert often["vocal_ride"] > sometimes["vocal_ride"]
    assert "stem_intertwine" not in dict(never)
    assert often["stem_intertwine"] > sometimes["stem_intertwine"]
    failed = vibes._moves_that_fit(
        vibe,
        a,
        b,
        Verdicts(failed={(a.id, b.id, "stem_intertwine")}),
        "often",
    )
    assert "stem_intertwine" not in dict(failed)


def test_intertwined_stem_request_uses_the_shared_audited_seam_path(tmp_path, monkeypatch):
    from types import SimpleNamespace

    from selecta.render.script import Curve

    a = _song(tmp_path, "intertwine-render-a", "First")
    b = _song(tmp_path, "intertwine-render-b", "Second")
    exit_cue, entry_cue = a.exit_cues()[0], b.entry_cues()[0]
    a_index = a.beat_index_of_bar(exit_cue.bar - 8)
    b_index = b.beat_index_of_bar(entry_cue.bar)
    a_points = a.beats[a_index : a_index + 65]
    b_points = b.beats[b_index : b_index + 65]
    start = float(a_points[0])
    duration = float(a_points[-1] - start)
    empty = np.zeros((int(round(duration * SR)), 2), dtype=np.float32)
    result = SimpleNamespace(
        audio=empty,
        a_start=start,
        b_end=float(b_points[-1]),
        exit_cue=exit_cue,
        entry_cue=entry_cue,
        a_dry=empty,
        b_dry=empty,
        b_points=b_points,
        a_vocal=Curve.constant(1),
        b_vocal=Curve.constant(0),
        a_drums=Curve.constant(1),
        b_drums=Curve.constant(1),
    )
    monkeypatch.setattr("selecta.seams.render_intertwined", lambda *_: result)
    monkeypatch.setattr("selecta.seams.audit", lambda _rendered: SimpleNamespace(passed=True))
    store = SeamStore(Settings(tmp_path))

    rendered, _, why = store._chosen_move(SeamRequest(a.id, b.id, "stem_intertwine"), a, b)

    assert rendered.script.style == "stem_intertwine"
    assert rendered.script.meta["bars"] == 16
    assert rendered.script.a_source_start == start
    assert abs(rendered.script.b_source_end - b_points[-1]) < 1e-6
    assert "vocals take turns" in why


def test_building_a_vibe_starts_on_a_song_it_can_leave(tmp_path):
    from selecta.planner.vibes import BY_KEY, build_vibe

    songs, traits = _vibe_library(tmp_path)
    first_has_no_exit = songs[0]
    first_has_no_exit.exit_cues = lambda *args, **kwargs: []
    planned, _ = build_vibe(BY_KEY["slow_burn"], songs[:1] + songs[1:], traits, {}, 6, seed=3)
    assert len(planned) == 6
    assert planned[0].song.id != first_has_no_exit.id


def test_the_vibes_route_lists_cards_and_refuses_a_mix_with_too_few_songs(client):
    cards = client.get("/api/vibes").json()
    assert {card["key"] for card in cards} >= {"pick", "late_night", "afro_heat"}
    assert client.post("/api/vibes/afro_heat/build").status_code == 400
    assert client.post("/api/vibes/nonsense/build").status_code == 404


def test_song_details_include_line_estimated_word_focus_times(tmp_path):
    from selecta import db

    settings = Settings(tmp_path)
    conn = db.connect(settings.db_path)
    track = make_track(bpm=120, bars=16, seed=41)
    song = song_from_track(tmp_path, "lyric-detail", track)
    _song_row(conn, 1, "Test Artist", "Timed Line", song.path)
    db.save_analysis(
        conn,
        1,
        {
            "version": ANALYSIS_VERSION,
            "bpm": song.bpm,
            "camelot": "8A",
            "lufs": -14.0,
            "peak_db": -2.0,
            "energy": 0.5,
            "sections": json.dumps(song.sections),
            "beats_per_bar": 4,
            "grid_confidence": 0.95,
            "constant_tempo": 1,
            "key_confidence": 0.9,
        },
    )
    features = features_path(settings, 1)
    features.parent.mkdir(parents=True, exist_ok=True)
    np.savez(
        features,
        beats=song.beats,
        bar_starts=song.bar_starts,
        peaks=np.ones(100),
        energy_bars=song.energy_bars,
        low_share_bars=song.low_share_bars,
        chroma_bars=np.zeros((song.bar_starts.size, 12)),
        rms_db_bars=np.zeros(song.bar_starts.size),
        mfcc_bars=np.zeros((song.bar_starts.size, 20)),
    )
    db.save_lyrics(conn, 1, "synced", "[00:01.00]Hello bright city lights", None)
    conn.close()

    response = TestClient(create_app(settings, tmp_path / "no-web")).get("/api/songs/1")
    assert response.status_code == 200
    detail = response.json()
    words = detail["lines"][0]["words"]
    assert len(words) == 4
    assert all(word["start"] < word["end"] for word in words)
    assert [word["start"] for word in words] == sorted(word["start"] for word in words)
    assert detail["bar_times"] == song.bar_times.tolist()
    assert detail["beat_times"] == song.beats.tolist()
    assert detail["beats_per_bar"] == song.beats_per_bar


def test_destination_steering_persists_and_status_names_the_song(client):
    response = client.post("/api/steer", json={"action": "take_me_to", "value": 2})
    assert response.status_code == 200
    assert response.json()["target"] == "2"
    status = client.get("/api/status").json()
    assert status["steering"]["target_label"] == "Artist 2 — Song 2"
    invalid = client.post("/api/steer", json={"action": "take_me_to", "value": "unknown"})
    assert invalid.status_code == 400


def test_stem_frequency_steering_persists_and_validates(client):
    response = client.post("/api/steer", json={"action": "stems", "value": "never"})
    assert response.status_code == 200
    assert response.json()["stems"] == "never"
    assert client.get("/api/status").json()["steering"]["stems"] == "never"
    assert client.post("/api/steer", json={"action": "stems", "value": "always"}).status_code == 400


def test_the_cache_never_fills_the_drive_or_outgrows_its_limit(tmp_path, monkeypatch):
    """The page once said a 13 GB limit with 11 GB free, and nothing stopped it being reached."""
    from selecta import stems

    settings = Settings(tmp_path)
    settings.set_storage_budget(10 * 1024**3)
    folder = tmp_path / "stems" / "old"
    folder.mkdir(parents=True)
    (folder / "vocals.wav").write_bytes(b"0" * 1000)
    usage = type("Usage", (), {"free": stems.FREE_SPACE_RESERVE + 500, "total": 10**12})
    monkeypatch.setattr(stems.shutil, "disk_usage", lambda path: usage)
    assert stems.largest_cache_bytes(settings) == stems.MIN_CACHE_BYTES
    usage.free = stems.FREE_SPACE_RESERVE + 5 * 1024**3
    assert stems.largest_cache_bytes(settings) == 5 * 1024**3 + 1000
    settings.set_storage_budget(512 * 1024**2)
    stems.prune_cache(settings)
    assert folder.exists(), "still under the limit"


def test_stems_and_seams_share_one_limit(tmp_path):
    from selecta import stems

    settings = Settings(tmp_path)
    for place, name in ((tmp_path / "stems", "window"), (settings.renders_dir / "seams", "seam")):
        folder = place / name
        folder.mkdir(parents=True)
        (folder / "file.flac").write_bytes(b"0" * 1000)
    assert stems.cache_bytes(settings) == 2000
    stems._prune(stems.cache_roots(settings), 1500, keep={"seam"})
    assert (settings.renders_dir / "seams" / "seam").exists()
    assert not (tmp_path / "stems" / "window").exists()


def test_cache_pruning_keeps_stems_for_priority_songs_even_over_budget(tmp_path):
    from selecta import stems

    settings = Settings(tmp_path)
    settings.home.mkdir(exist_ok=True)
    conn = db.connect(settings.db_path)
    source = tmp_path / "priority.flac"
    source.touch()
    conn.execute(
        "INSERT INTO songs(id,path,folder,size,mtime,duration,processing_priority) "
        "VALUES(1,?,?,?,?,?,100)",
        (str(source), str(tmp_path), 1, 1.0, 100.0),
    )
    conn.commit()
    conn.close()

    root = tmp_path / "stems"
    protected = root / "priority-window"
    ordinary = root / "ordinary-window"
    protected.mkdir(parents=True)
    ordinary.mkdir()
    (protected / "window.json").write_text(json.dumps({"source": str(source)}))
    (ordinary / "vocals.wav").write_bytes(b"a" * 100)
    (protected / "vocals.wav").write_bytes(b"p" * 100)
    priority_names = stems._priority_window_names(settings)

    stems._prune(root, 100, protect=priority_names)

    assert protected.exists()
    assert not ordinary.exists()


def test_storage_says_what_can_be_remade_and_keeps_the_limit_possible(tmp_path):
    settings = Settings(tmp_path)
    client = TestClient(create_app(settings, tmp_path / "no-web"))
    (tmp_path / "exports").mkdir()
    (tmp_path / "exports" / "kept.flac").write_bytes(b"0" * 2000)
    folder = tmp_path / "stems" / "window"
    folder.mkdir(parents=True)
    (folder / "vocals.wav").write_bytes(b"0" * 1000)
    state = client.get("/api/storage").json()
    assert state["cache_bytes"] == 1000
    assert state["kept_bytes"] >= 2000
    assert state["budget_bytes"] <= state["largest_budget_bytes"]
    far_too_big = client.post("/api/storage", json={"budget_gb": 999999}).json()
    assert far_too_big["budget_bytes"] == far_too_big["largest_budget_bytes"]
    assert client.post("/api/storage", json={"budget_gb": 0.1}).status_code == 400


def test_recommendations_put_the_best_fit_first_and_say_why(tmp_path):
    from selecta.planner.beam import rank_candidates

    now = _song(tmp_path, "now", "Now", bpm=120.0, camelot="8A")
    same = _song(tmp_path, "same", "Same", bpm=120.0, camelot="8A")
    near = _song(tmp_path, "near", "Near", bpm=125.0, camelot="9A")
    far = _song(tmp_path, "far", "Far", bpm=88.0, camelot="2B")
    ranked = rank_candidates(now, None, [now, same, near, far], {now.id})
    assert [item.song.id for item in ranked] == [same.id, near.id, far.id]
    assert ranked[0].reason.startswith("Same tempo")
    assert "tempo" in ranked[1].reason.lower()
    assert ranked[2].reason == "A big tempo jump, so an echo"


def test_recommendations_consider_the_song_on_each_side(tmp_path):
    from selecta.planner.beam import rank_candidates

    before = _song(tmp_path, "before", "Before", bpm=120.0, camelot="8A")
    after = _song(tmp_path, "after", "After", bpm=100.0, camelot="3B")
    only_before = _song(tmp_path, "b", "B", bpm=120.0, camelot="8A")
    between = _song(tmp_path, "m", "M", bpm=110.0, camelot="6A")
    alone = rank_candidates(
        before, None, [before, after, only_before, between], {before.id, after.id}
    )
    assert alone[0].song.id == only_before.id
    ranked = rank_candidates(
        before, after, [before, after, only_before, between], {before.id, after.id}
    )
    assert {item.song.id for item in ranked} == {only_before.id, between.id}


def test_a_shared_phrase_is_named_as_the_reason(tmp_path):
    from selecta.planner.beam import rank_candidates

    now = _song(tmp_path, "now", "Now", bpm=120.0)
    other = _song(tmp_path, "other", "Other", bpm=90.0, camelot="2B")
    ranked = rank_candidates(now, None, [now, other], {now.id}, {(now.id, other.id): "good news"})
    assert ranked[0].reason == "Shares “good news”"


def test_a_failed_seam_is_remembered_and_can_be_retried(tmp_path):
    store = SeamStore(Settings(tmp_path))
    request = SeamRequest(1, 2, "word_cut", phrase="good news")
    result = store._save_failure(request, "It didn't work.")
    assert result["status"] == "failed"
    again = SeamStore(Settings(tmp_path)).status(request.key)
    assert again["status"] == "failed"
    assert again["error"] == "It didn't work."
    import shutil

    shutil.rmtree(store.root)
    fresh = SeamStore(Settings(tmp_path))
    assert fresh.submit(request)["status"] == "failed"
    assert (request.a, request.b, request.move) in fresh.verdicts().failed
    assert not fresh.root.exists(), "a remembered failure must not start another render"
    assert "agreement" not in SeamStore.__dict__, "failure wording stays in plain language"


def test_spare_time_work_waits_behind_anything_a_person_asked_for(tmp_path):
    store = SeamStore(Settings(tmp_path))
    theirs = SeamRequest(1, 2, "cut_on_one")
    idle = SeamRequest(3, 4, "cut_on_one")
    store.next_idle_job = lambda: idle
    store.ask(theirs)
    assert store._next_job() == theirs
    assert store._next_job() == idle


def test_bad_rating_survives_audio_eviction_without_claiming_audio_is_ready(tmp_path):
    import shutil

    store = SeamStore(Settings(tmp_path))
    request = SeamRequest(1, 2, "vocal_ride")
    folder = store.folder(request.key)
    folder.mkdir(parents=True)
    state = {
        "key": request.key,
        "status": "ready",
        "style": "vocal_ride",
        "passed": True,
        "request": {"a": 1, "b": 2, "move": "vocal_ride"},
    }
    (folder / "seam.json").write_text(json.dumps(state), "utf-8")
    store.rate(request.key, "bad", "Voice clashes")
    shutil.rmtree(folder)
    fresh = SeamStore(Settings(tmp_path))
    assert fresh.status(request.key)["status"] == "none"
    assert (1, 2, "vocal_ride") in fresh.verdicts().failed
    assert (1, 2, "vocal_ride") not in fresh.verdicts().worked
    saved = json.loads((tmp_path / "seam-history" / f"{request.key}.json").read_text())
    assert saved["note"] == "Voice clashes"


def test_the_worker_reports_through_disk_so_the_app_can_read_it(tmp_path):
    worker = SeamStore(Settings(tmp_path))
    app_side = SeamStore(Settings(tmp_path))
    request = SeamRequest(1, 2, "cut_on_one")
    assert app_side.status(request.key)["status"] == "none"
    worker._mark_rendering(request)
    assert app_side.status(request.key)["status"] == "rendering"
    worker._save_failure(request, "It didn't work.")
    assert app_side.status(request.key)["error"] == "It didn't work."


def test_a_seam_cut_off_by_a_restart_gets_tried_again(tmp_path):
    store = SeamStore(Settings(tmp_path))
    cut_off = SeamRequest(1, 2, "cut_on_one")
    failed = SeamRequest(3, 4, "cut_on_one")
    store._mark_rendering(cut_off)
    store._save_failure(failed, "No.")
    store.forget_unfinished()
    assert store.status(cut_off.key)["status"] == "none"
    assert store.status(failed.key)["status"] == "failed", "a real failure stays remembered"


def test_asking_again_after_a_failure_clears_it(tmp_path, monkeypatch):
    store = SeamStore(Settings(tmp_path))
    request = SeamRequest(1, 2, "cut_on_one")
    store._save_failure(request, "No.")

    class Pipe:
        written = ""

        def write(self, text):
            Pipe.written += text

        def flush(self):
            pass

    worker = type("Worker", (), {"stdin": Pipe(), "poll": lambda self: None})()
    store._worker = worker
    assert store.submit(request)["status"] == "queued"
    assert json.loads(Pipe.written)["request"]["move"] == "cut_on_one"
    assert store.status(request.key)["status"] == "queued"
    assert store.submit(request)["status"] == "queued", "asking twice sends it once"
    assert Pipe.written.count("cut_on_one") == 1


def test_the_best_take_of_a_link_is_the_one_shown(tmp_path):
    from selecta.lyrics.match import LyricLink
    from selecta.planner.prepare import link_state

    line = Line(1.0, 2.0, "words")
    link = LyricLink(1, 2, "shared_word", "words", line, line, 0.5)
    states = {}
    key = lambda move: SeamRequest(1, 2, move, phrase="words").key  # noqa: E731
    status = lambda k: states.get(k, {"status": "none", "key": k})  # noqa: E731
    moves = ("word_blend", "phrase_roll")
    assert link_state(link, moves, status)[0] == "word_blend"
    states[key("word_blend")] = {"status": "failed", "key": "x"}
    assert link_state(link, moves, status)[0] == "phrase_roll", "try the next move"
    states[key("phrase_roll")] = {"status": "ready", "passed": True, "key": "y"}
    assert link_state(link, moves, status)[0] == "phrase_roll"
    states[key("phrase_roll")]["rating"] = "bad"
    assert link_state(link, moves, status)[1]["status"] == "failed", "rated bad, so it sinks"


def test_rendering_every_seam_shows_them_queued_straight_away(client, tmp_path, monkeypatch):
    """The page once sat on "not rendered yet" until the last of many requests came back."""
    sent = []

    class Pipe:
        def write(self, text):
            sent.append(json.loads(text))

        def flush(self):
            pass

    def fake_start(store):
        store._worker = type("Worker", (), {"stdin": Pipe(), "poll": lambda self: None})()

    monkeypatch.setattr(SeamStore, "start", fake_start)
    conn = db.connect(Settings(tmp_path).db_path)
    for song_id in (3, 4):
        _song_row(conn, song_id, f"Artist {song_id}", f"Song {song_id}")
    conn.commit()
    for song_id in (1, 2, 3, 4):
        mix.add_song(conn, song_id)
    conn.close()
    answer = client.post("/api/mix/render").json()["mix"]
    assert [item["seam"]["state"]["status"] for item in answer[1:]] == ["queued"] * 3
    assert len(sent) == 3
    again = client.post("/api/mix/render").json()["mix"]
    assert [item["seam"]["state"]["status"] for item in again[1:]] == ["queued"] * 3
    assert len(sent) == 3, "nothing is asked for twice"


def test_counting_singing_quickly_still_gives_the_right_answer(tmp_path):
    song = song_from_track(tmp_path, "s", make_track(bpm=120, bars=8, seed=1))
    song.lines = [Line(10.0 + i * 3, 12.0 + i * 3, "some words here") for i in range(20)]

    def slowly(start, end):
        return sum(max(0.0, min(end, x.end) - max(start, x.start)) for x in song.lines)

    for start, end in (
        (0.0, 5.0),
        (9.0, 11.0),
        (11.0, 13.5),
        (20.5, 40.0),
        (65.0, 90.0),
        (5.0, 5.0),
    ):
        assert song.vocal_seconds(start, end) == pytest.approx(slowly(start, end))
    song.lines = [Line(1.0, 2.0, "new lines")]
    assert song.vocal_seconds(0.0, 3.0) == pytest.approx(1.0), "a new set of lines is noticed"


def test_reading_the_mix_is_what_keeps_the_badges_moving(client):
    assert client.get("/api/mix").status_code == 200, "the page polls this to update every badge"


def test_importing_the_app_starts_no_worker(monkeypatch):
    import importlib
    import subprocess

    import selecta.api

    def refuse(*_args, **_kwargs):
        pytest.fail("importing the app started a process")

    monkeypatch.setattr(subprocess, "Popen", refuse)
    importlib.reload(selecta.api)
    assert not hasattr(selecta.api, "app")


def test_many_songs_asked_for_share_one_process(client, tmp_path, monkeypatch):
    """One process per click used to run the machine out of memory."""
    import threading

    conn = db.connect(Settings(tmp_path).db_path)
    conn.execute("DELETE FROM analysis")
    conn.commit()
    conn.close()
    started: list[list[str]] = []
    finish = threading.Event()

    class FakeProcess:
        def __init__(self, command, **_kwargs):
            started.append(command)

        def wait(self):
            finish.wait(5)

    monkeypatch.setattr("selecta.api.subprocess.Popen", FakeProcess)
    first = client.post("/api/songs/1/analyse").json()
    second = client.post("/api/songs/2/analyse").json()
    assert first["ahead"] == 0
    assert second["ahead"] == 1
    assert client.get("/api/status").json()["analysing"] == [1, 2]
    assert len(started) == 1, "the second song waits for the process that's already running"
    finish.set()
    for _ in range(200):
        if not client.get("/api/status").json()["analysing"]:
            break
        threading.Event().wait(0.01)
    assert client.get("/api/status").json()["analysing"] == []
    assert len(started) == 2 and started[1][-2:] == ["--song", "2"]


def test_a_seam_is_not_rendering_once_the_worker_has_gone(tmp_path):
    store = SeamStore(Settings(tmp_path))
    folder = store.folder("abc")
    folder.mkdir(parents=True)
    (folder / "seam.json").write_text('{"status": "rendering", "key": "abc"}', "utf-8")

    class Worker:
        code = None

        def poll(self):
            return self.code

    store._worker = Worker()
    assert store.status("abc")["status"] == "rendering"
    store._worker.code = 1
    assert store.status("abc")["status"] == "none", "the worker crashed, so it can be asked again"


def test_starting_the_app_clears_seams_cut_off_last_time(tmp_path):
    settings = Settings(tmp_path)
    folder = SeamStore(settings).folder("abc")
    folder.mkdir(parents=True)
    (folder / "seam.json").write_text('{"status": "rendering", "key": "abc"}', "utf-8")
    create_app(settings, tmp_path / "no-web")
    assert not (folder / "seam.json").exists()


def _request(a: int, b: int = 99) -> SeamRequest:
    return SeamRequest(a=a, b=b, move="cut_on_one")


def test_the_mix_goes_ahead_of_everything_but_what_is_about_to_be_heard(tmp_path):
    store = SeamStore(Settings(tmp_path))
    in_mix = [_request(1), _request(2)]
    store.next_mix_seam = lambda: in_mix.pop(0) if in_mix else None
    store.next_idle_job = lambda: _request(4)
    store.ask(_request(3))  # an old request, from before the mix changed
    store.ask(_request(9), urgent=True)
    order = [store._next_job().a for _ in range(5)]
    assert order == [9, 1, 2, 3, 4]


def test_asking_again_moves_a_waiting_seam_to_the_front(tmp_path):
    store = SeamStore(Settings(tmp_path))
    store.ask(_request(1))
    store.ask(_request(2))
    store.ask(_request(2), urgent=True)
    assert store._next_job().a == 2
    assert store._next_job().a == 1


def test_spare_time_work_gives_way_to_the_mix(tmp_path):
    store = SeamStore(Settings(tmp_path))
    waiting = []
    store.next_mix_seam = lambda: waiting[0] if waiting else None
    store.next_idle_job = lambda: _request(4)
    store._next_job()
    assert store._running_rank == PREPARING
    assert store._give_way() is False
    waiting.append(_request(1))
    store._mix_checked_at = 0.0
    assert store._give_way() is True, "a mix seam stops word preparing straight away"


def test_a_mix_seam_only_gives_way_to_what_is_about_to_be_heard(tmp_path):
    store = SeamStore(Settings(tmp_path))
    store.next_mix_seam = lambda: _request(1)
    store._next_job()
    assert store._running_rank == MIX
    store.ask(_request(5))
    assert store._give_way() is False, "someone else's request waits for the mix"
    store.ask(_request(6), urgent=True)
    assert store._give_way() is True


def test_giving_way_leaves_the_seam_not_started(tmp_path, monkeypatch):
    store = SeamStore(Settings(tmp_path))
    jobs_seen = []

    def next_job():
        if jobs_seen:
            raise KeyboardInterrupt
        jobs_seen.append(1)
        return _request(4)

    def interrupted(_conn, _request):
        raise jobs.Interrupted

    monkeypatch.setattr(store, "_next_job", next_job)
    monkeypatch.setattr(store, "render_now", interrupted)
    monkeypatch.setattr("selecta.jobs.set_render_priority", lambda _important: None)
    with pytest.raises(KeyboardInterrupt):
        store.run_forever()
    assert store.status(_request(4).key)["status"] == "none"


HELPER_WHILE_WAITING = """
import subprocess, sys, threading, time
from selecta.jobs import take_app_input
app_input = take_app_input()
threading.Thread(target=app_input.read, daemon=True).start()
time.sleep(0.5)
subprocess.run([sys.executable, "-c", "print('hello')"], stdout=subprocess.DEVNULL)
print("finished", flush=True)
"""


def test_helpers_start_while_the_worker_waits_for_requests():
    """On Windows they froze, so seams only moved when another request happened to arrive."""
    import subprocess
    import sys
    import threading

    process = subprocess.Popen(
        [sys.executable, "-c", HELPER_WHILE_WAITING],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        text=True,
    )
    lines: list[str] = []
    reader = threading.Thread(target=lambda: lines.append(process.stdout.readline()), daemon=True)
    reader.start()
    reader.join(60)
    process.kill()
    assert lines and lines[0].strip() == "finished", "the helper froze"


def test_analysis_waits_only_while_the_sign_is_fresh(tmp_path):
    import os
    import time

    jobs.mark_mix_rendering(tmp_path, True)
    assert jobs.mix_is_rendering(tmp_path)
    old = time.time() - jobs.MIX_SIGN_LASTS_SECONDS - 1
    os.utime(tmp_path / jobs.MIX_RENDERING_SIGN, (old, old))
    assert not jobs.mix_is_rendering(tmp_path), "a stopped worker can't hold analysis up forever"
    jobs.mark_mix_rendering(tmp_path, True)
    jobs.mark_mix_rendering(tmp_path, False)
    assert not jobs.mix_is_rendering(tmp_path)
    jobs.mark_mix_rendering(tmp_path, False)  # taking down a sign that isn't up is fine


def test_the_sign_goes_up_for_the_mix_and_not_for_spare_time_work(tmp_path, monkeypatch):
    store = SeamStore(Settings(tmp_path))
    store.settings.home.mkdir(parents=True, exist_ok=True)
    seen = []
    jobs_to_do = [(MIX, _request(1)), (PREPARING, _request(2))]

    def next_job():
        if not jobs_to_do:
            raise KeyboardInterrupt
        rank, request = jobs_to_do.pop(0)
        store._running_rank = rank
        return request

    def note(_conn, _request):
        seen.append(jobs.mix_is_rendering(store.settings.home))
        return {}

    monkeypatch.setattr(store, "_next_job", next_job)
    monkeypatch.setattr(store, "render_now", note)
    monkeypatch.setattr("selecta.jobs.set_render_priority", lambda _important: None)
    with pytest.raises(KeyboardInterrupt):
        store.run_forever()
    assert seen == [True, False]


def test_a_request_pushed_back_by_the_mix_is_not_lost(tmp_path, monkeypatch):
    store = SeamStore(Settings(tmp_path))
    theirs = _request(5)
    store.ask(theirs)
    calls = []

    def interrupted_once(_conn, request):
        calls.append(request.a)
        if len(calls) == 1:
            raise jobs.Interrupted
        raise KeyboardInterrupt

    monkeypatch.setattr(store, "render_now", interrupted_once)
    monkeypatch.setattr("selecta.jobs.set_render_priority", lambda _important: None)
    with pytest.raises(KeyboardInterrupt):
        store.run_forever()
    assert calls == [5, 5], "it went back in line and was picked up again"


def test_rendering_from_the_words_page_never_jumps_the_mix(client, monkeypatch):
    sent = []
    monkeypatch.setattr(
        "selecta.seams.SeamStore.submit",
        lambda _store, request, urgent=False: sent.append(urgent) or {"status": "queued"},
    )
    reply = client.post("/api/seams", json={"a": 1, "b": 2, "move": "cut_on_one"})
    assert reply.status_code == 200
    assert sent == [False]


def test_a_mix_doesnt_stop_short_when_its_favourite_moves_dont_fit(tmp_path):
    from selecta.planner.vibes import BY_KEY, build_vibe

    songs, traits = _vibe_library(tmp_path)
    for i, song in enumerate(songs):
        song.bpm = 80.0 + 25.0 * (i % 5)  # far apart, so no blend reaches between most of them
        traits[song.id] = traits[song.id]
    planned, _ = build_vibe(BY_KEY["slow_burn"], songs, traits, {}, 10, seed=2)
    assert len(planned) == 10


def test_christmas_songs_stay_out_of_every_other_mix(tmp_path):
    from selecta.planner.vibes import BY_KEY, VIBES, eligible, traits_of

    songs, _ = _vibe_library(tmp_path)
    songs[0].title = "Jingle Bell Rock"
    songs[1].title = "Last Christmas"
    traits = traits_of(songs, {})
    for vibe in VIBES:
        found = {song.id for song in eligible(vibe, songs, traits)}
        if vibe.key == "christmas":
            assert found == {songs[0].id, songs[1].id}
        else:
            assert not found & {songs[0].id, songs[1].id}, vibe.key
    assert "christmas" in BY_KEY


def test_lyrics_tell_a_sad_song_from_a_party_song(tmp_path):
    from selecta.planner.vibes import BY_KEY, eligible, traits_of

    songs, _ = _vibe_library(tmp_path)
    sad, party = songs[0], songs[1]
    sad.lines = [Line(10.0 + i, 11.0 + i, "i cry alone with these tears") for i in range(8)]
    party.lines = [Line(10.0 + i, 11.0 + i, "dance at the party tonight") for i in range(8)]
    sad.bpm = party.bpm = 100.0
    traits = traits_of(songs, {})
    assert traits[sad.id].about("heartbreak") > traits[party.id].about("heartbreak")
    assert traits[party.id].about("party") > traits[sad.id].about("party")
    assert traits[sad.id].english
    assert sad.id in {song.id for song in eligible(BY_KEY["feelings"], songs, traits)}
    assert party.id not in {song.id for song in eligible(BY_KEY["feelings"], songs, traits)}


def test_a_song_not_in_english_gets_no_word_handoffs_but_can_still_ride(tmp_path):
    from selecta.planner.vibes import _word_move
    from selecta.planner.wordreel import Verdicts

    track = make_track(bpm=120, bars=64, seed=1)
    a = song_from_track(tmp_path, "a", track)
    b = song_from_track(tmp_path, "b", track)
    a.id, b.id = 1, 2
    a.lines = [Line(10.0, 12.0, "you and me in the night")]
    b.lines = [Line(10.0, 12.0, "you and me in the night")]
    assert _word_move(a, b, Verdicts()) is not None
    b.lines = [Line(10.0, 12.0, "wetin dey happen abeg oga")]
    assert _word_move(a, b, Verdicts()) is None


def test_a_move_that_failed_on_two_songs_isnt_planned_again(tmp_path):
    from selecta.planner.vibes import BY_KEY, _moves_that_fit
    from selecta.planner.wordreel import Verdicts

    track = make_track(bpm=120, bars=64, seed=1)
    a = song_from_track(tmp_path, "a", track)
    b = song_from_track(tmp_path, "b", track)
    a.id, b.id = 1, 2
    fresh = [name for name, _ in _moves_that_fit(BY_KEY["pick"], a, b, Verdicts())]
    assert "bass_swap_blend" in fresh
    known = Verdicts(failed={(1, 2, "bass_swap_blend")})
    assert "bass_swap_blend" not in [
        name for name, _ in _moves_that_fit(BY_KEY["pick"], a, b, known)
    ]


def test_only_a_rap_mix_ever_plans_a_cut():
    from selecta.planner.vibes import MOVE_WEIGHTS

    assert [name for name, moves in MOVE_WEIGHTS.items() if "cut_on_one" in moves] == ["punchy"]


def _report(*checks):
    from selecta.audit.checks import AuditReport, Check

    return AuditReport([Check(name, False, value, limit) for name, value, limit in checks])


def test_a_near_miss_is_good_enough_but_a_real_problem_isnt():
    from selecta.seams import good_enough

    assert good_enough(_report())
    assert good_enough(_report(("beat alignment", 35.0, 20.0)))
    assert not good_enough(_report(("beat alignment", 60.0, 20.0)))
    assert not good_enough(_report(("quiet time", 3.0, 1.2)))
    assert not good_enough(_report(("beat alignment", 35.0, 20.0), ("harmony", 2.0, 1.0)))


def test_a_cut_is_the_last_thing_tried(tmp_path, monkeypatch):
    store = SeamStore(Settings(tmp_path))
    track = make_track(bpm=120, bars=64, seed=1)
    a = song_from_track(tmp_path, "a", track)
    b = song_from_track(tmp_path, "b", track)
    a.id, b.id = 1, 2
    asked = []

    def nothing_works(request, _a, _b):
        asked.append(request.move)
        raise CannotRender("not here")

    monkeypatch.setattr(store, "_chosen_move", nothing_works)
    tried: list[dict] = []
    rendered, report, _why, fell_back = store._best_move(a, b, tried, "vocal_ride")
    assert "cut_on_one" not in asked
    assert asked[0] in {"filter_sweep", "bass_swap_blend", "tempo_ramp"}
    assert asked[-1] == "reverb_wash", "the listener likes reverb least, so it's the last effect"
    assert {item["move"] for item in tried} == set(asked)
    assert rendered.script.style == "cut_on_one"
    assert fell_back


def test_stems_never_also_removes_vocal_rides_from_fallbacks(tmp_path, monkeypatch):
    store = SeamStore(Settings(tmp_path))
    track = make_track(bpm=120, bars=64, seed=1)
    a = song_from_track(tmp_path, "no-stems-a", track)
    b = song_from_track(tmp_path, "no-stems-b", track)
    a.id, b.id = 1, 2
    asked = []

    def nothing_works(request, _a, _b):
        asked.append(request.move)
        raise CannotRender("not here")

    monkeypatch.setattr("selecta.seams.ride_lines", lambda *_: (object(), object()))
    monkeypatch.setattr(store, "_chosen_move", nothing_works)
    store._best_move(a, b, [], stem_preference="never")

    assert "vocal_ride" not in asked


def test_stems_never_skips_old_soft_planned_stem_moves(tmp_path, monkeypatch):
    from selecta.session import steer

    connection = db.connect(tmp_path / "steering.sqlite")
    steer(connection, "stems", "never")
    a = _song(tmp_path, "stale-stem-a", "First")
    b = _song(tmp_path, "stale-stem-b", "Second")
    monkeypatch.setattr("selecta.seams.load_song", lambda _c, _s, song: {a.id: a, b.id: b}[song])
    store = SeamStore(Settings(tmp_path))
    attempted = []
    seen = {}

    def chosen(request, *_songs):
        attempted.append(request.move)
        raise AssertionError("a stale automatic stem choice should not render")

    def fallback(_a, _b, tried, asked, near, stem_preference):
        seen["tried"] = tried
        seen["preference"] = stem_preference
        return None, None, "fallback", True

    monkeypatch.setattr(store, "_chosen_move", chosen)
    monkeypatch.setattr(store, "_best_move", fallback)
    monkeypatch.setattr(store, "_save", lambda _request, *_args: {"status": "ready"})

    store.render_now(connection, SeamRequest(a.id, b.id, "vocal_ride", soft=True))

    assert not attempted
    assert seen["preference"] == "never"
    assert seen["tried"][0]["why"] == "Stem-assisted moves are set to Never."
    connection.close()


def test_a_seam_says_what_was_tried_before_what_it_landed_on(tmp_path, monkeypatch):
    store = SeamStore(Settings(tmp_path))
    track = make_track(bpm=120, bars=64, seed=1)
    a = song_from_track(tmp_path, "a", track)
    b = song_from_track(tmp_path, "b", track)
    a.id, b.id = 1, 2
    monkeypatch.setattr("selecta.seams.load_song", lambda _c, _s, song: {1: a, 2: b}[song])
    request = SeamRequest(a=1, b=2, move="vocal_ride", soft=True)
    state = store.render_now(None, request)
    assert state["status"] == "ready"
    assert state["style"] != "cut_on_one", "two songs at the same tempo can always blend"
    assert state["tried"][0]["move"] == "vocal_ride"
    verdicts = store.verdicts()
    assert (1, 2, "vocal_ride") in verdicts.failed
    assert (1, 2, state["style"]) in verdicts.worked


def test_a_bad_human_rating_overrides_a_passed_audit_for_that_pair(tmp_path):
    from selecta.lyrics.lrclib import Line
    from selecta.planner.vibes import _word_move

    store = SeamStore(Settings(tmp_path))
    folder = store.folder("rated-bad")
    folder.mkdir(parents=True)
    (folder / "seam.json").write_text(
        json.dumps(
            {
                "status": "ready",
                "passed": True,
                "style": "phrase_roll",
                "rating": "bad",
                "request": {"a": 1, "b": 2, "move": "phrase_roll"},
            }
        ),
        "utf-8",
    )

    verdicts = store.verdicts()

    assert (1, 2, "phrase_roll") in verdicts.failed
    assert (1, 2, "phrase_roll") not in verdicts.worked

    a, b = _two_songs(tmp_path)
    a.bpm, b.bpm = 120.0, 145.0
    a.lines = [Line(20.0, 22.0, "good morning world")]
    b.lines = [Line(20.0, 22.0, "good morning world")]
    assert _word_move(a, b, verdicts) is None, "the rated-bad phrase roll must not be planned again"


def test_seams_an_old_fallback_swapped_get_another_chance(tmp_path):
    store = SeamStore(Settings(tmp_path))
    folder = store.folder("old")
    folder.mkdir(parents=True)
    swapped = {
        "status": "ready",
        "key": "old",
        "style": "cut_on_one",
        "request": {"a": 1, "b": 2, "move": "vocal_ride"},
    }
    (folder / "seam.json").write_text(json.dumps(swapped), "utf-8")
    assert store.status("old")["status"] == "none"
    swapped["tried"] = [{"move": "vocal_ride", "why": "no"}]
    (folder / "seam.json").write_text(json.dumps(swapped), "utf-8")
    assert store.status("old")["status"] == "ready", "it was tried under the new rules"


def test_a_voice_edge_comes_from_the_singing_itself():
    from selecta.config import SAMPLE_RATE
    from selecta.planner.wordreel import voice_edge

    audio = np.zeros(SAMPLE_RATE * 20, dtype=np.float32)
    time_axis = np.arange(int(SAMPLE_RATE * 4.0)) / SAMPLE_RATE
    audio[SAMPLE_RATE * 5 : SAMPLE_RATE * 9] = 0.3 * np.sin(2 * np.pi * 220 * time_axis)
    line = Line(5.2, 9.6, "any language at all")
    assert voice_edge(audio, 0.0, line, 12.0, at_end=True) == pytest.approx(9.0, abs=0.05)
    assert voice_edge(audio, 0.0, line, 12.0, at_end=False) == pytest.approx(5.0, abs=0.05)
    assert voice_edge(np.zeros_like(audio), 0.0, line, 12.0, at_end=True) is None


def _same_songs(tmp_path, count):
    from selecta.planner.beam import PlannedSong

    track = make_track(bpm=120, bars=64, seed=1)
    songs = []
    for i in range(count):
        song = song_from_track(tmp_path, f"m{i}", track, genre="Pop")
        song.id = i + 1
        song.lines = [
            Line(66.0 + j * 4.0, 69.5 + j * 4.0, "you and me in the night") for j in range(10)
        ]
        songs.append(song)
    return [PlannedSong(song, "bass_swap_blend", "") for song in songs]


def test_no_one_move_takes_over_a_mix_even_when_every_song_could_ride(tmp_path):
    from collections import Counter

    from selecta.planner.vibes import BY_KEY, seam_choices

    planned = _same_songs(tmp_path, 13)
    for item in planned:
        item.song.grid_confidence = 0.95
    for seed in range(8):
        seams = seam_choices(BY_KEY["pick"], planned, {}, np.random.default_rng(seed))
        moves = [seams[item.song.id]["move"] for item in planned[1:]]
        counts = Counter(moves)
        assert counts["vocal_ride"] >= 1, "the favourite still gets its moments"
        assert counts["vocal_ride"] <= 5, moves
        assert len(counts) >= 3, moves
        assert all(x != y for x, y in zip(moves, moves[1:], strict=False)), moves


def test_builds_of_a_mix_come_out_different(tmp_path):
    from selecta.planner.vibes import BY_KEY, seam_choices

    planned = _same_songs(tmp_path, 13)
    runs = {
        tuple(
            seam_choices(BY_KEY["pick"], planned, {}, np.random.default_rng(seed))[item.song.id][
                "move"
            ]
            for item in planned[1:]
        )
        for seed in range(6)
    }
    assert len(runs) >= 3


def test_a_fallback_takes_the_rest_of_the_mix_into_account():
    from collections import Counter

    from selecta.seams import fallback_order

    fresh = fallback_order(1, 2, True, Counter())
    assert fresh[0] == "vocal_ride"
    full = fallback_order(1, 2, True, Counter({"vocal_ride": 4, "filter_sweep": 2}))
    assert full.index("vocal_ride") > full.index("bass_swap_blend"), "plenty of rides already"
    assert full.index("bass_swap_blend") < full.index("filter_sweep"), "least used comes first"
    assert full[-1] == "reverb_wash"
    assert "cut_on_one" not in full
    assert "vocal_ride" not in fallback_order(1, 2, False, Counter())


def test_a_seam_from_a_replaced_mix_stops_for_the_active_one(tmp_path):
    store = SeamStore(Settings(tmp_path))
    old, new = _request(1), _request(2)
    active = {old.key}
    store.keep_for_now = lambda: set(active)
    store.next_mix_seam = lambda: old
    store._next_job()
    assert store._give_way() is False
    active.clear()
    active.add(new.key)
    store._active_checked_at = 0.0
    assert store._give_way() is True


def test_a_leftover_request_from_the_last_mix_waits_behind_the_active_one(tmp_path):
    store = SeamStore(Settings(tmp_path))
    old, new = _request(1), _request(2)
    store.keep_for_now = lambda: {new.key}
    waiting = [new]
    store.next_mix_seam = lambda: waiting.pop() if waiting else None
    store.ask(old, urgent=True)
    assert store._next_job() == new
    assert store._next_job() == old


def test_a_mix_from_a_few_artists_still_reaches_its_length(tmp_path):
    from selecta.planner.vibes import BY_KEY, build_vibe

    songs, traits = _vibe_library(tmp_path)
    for i, song in enumerate(songs):
        song.artist = f"Artist {i % 6}"
        song.bpm = 120.0
    planned, _ = build_vibe(BY_KEY["slow_burn"], songs, traits, {}, 12, seed=4)
    assert len(planned) == 12
    artists = [item.song.artist for item in planned]
    assert all(x != y for x, y in zip(artists, artists[1:], strict=False))


def _takes(store, monkeypatch, reports):
    def take(request, _a, _b):
        if request.move not in reports:
            raise CannotRender("not here")
        return f"take of {request.move}", reports[request.move], "why"

    monkeypatch.setattr(store, "_chosen_move", take)


def _two_songs(tmp_path):
    track = make_track(bpm=120, bars=64, seed=1)
    a = song_from_track(tmp_path, "a", track)
    b = song_from_track(tmp_path, "b", track)
    a.id, b.id = 1, 2
    return a, b


def test_a_clean_take_beats_a_near_miss(tmp_path, monkeypatch):
    store = SeamStore(Settings(tmp_path))
    a, b = _two_songs(tmp_path)
    near = _report(("beat alignment", 30.0, 20.0))
    _takes(store, monkeypatch, {"filter_sweep": near, "bass_swap_blend": _report()})
    tried: list[dict] = []
    rendered, report, _why, _fell_back = store._best_move(a, b, tried)
    assert rendered == "take of bass_swap_blend"
    assert report.passed


def test_a_near_miss_blend_beats_a_clean_effect(tmp_path, monkeypatch):
    """By ear a blend a little off still beats an echo. The warning stays, so it isn't hidden."""
    store = SeamStore(Settings(tmp_path))
    a, b = _two_songs(tmp_path)
    near = _report(("beat alignment", 30.0, 20.0))
    _takes(store, monkeypatch, {"filter_sweep": near, "echo_out": _report()})
    tried: list[dict] = []
    rendered, report, _why, _fell_back = store._best_move(a, b, tried)
    assert rendered == "take of filter_sweep"
    assert not report.passed
    assert "filter_sweep" not in {attempt["move"] for attempt in tried}


def test_a_planned_near_miss_is_kept_if_nothing_comes_out_cleaner(tmp_path, monkeypatch):
    store = SeamStore(Settings(tmp_path))
    a, b = _two_songs(tmp_path)
    _takes(store, monkeypatch, {})
    held = ("take of tempo_ramp", _report(("level fall", 5.0, 3.5)), "why", "tempo_ramp")
    tried: list[dict] = []
    rendered, _report_kept, _why, fell_back = store._best_move(a, b, tried, "tempo_ramp", held)
    assert rendered == "take of tempo_ramp"
    assert not fell_back, "it's the move that was asked for"


def test_a_steady_beat_gap_is_closed_with_a_second_take(tmp_path):
    from dataclasses import replace

    from selecta.audit.checks import audit
    from selecta.render.engine import SongCache, render
    from selecta.render.script import Warp
    from selecta.seams import tighten_beats

    a, b = _two_songs(tmp_path)
    cache = SongCache()
    pool = enumerate_candidates(a, b, "bass_swap_blend")
    script = pool[0].recipe.make(a, b, pool[0].exit_cue, pool[0].entry_cue, pool[0].bars)
    assert audit(render(script, cache)).passed
    apart = replace(
        script, b=replace(script.b, warp=Warp(script.b.warp.output, script.b.warp.source - 0.035))
    )
    off = render(apart, cache)
    assert any(check.name == "beat alignment" for check in audit(off).failures)
    fixed, report = tighten_beats(off, cache)
    assert not any(check.name == "beat alignment" for check in report.failures)
    assert fixed is not off


def test_a_warning_counts_against_a_move_and_its_songs(tmp_path):
    from selecta.planner.vibes import BY_KEY, _moves_that_fit
    from selecta.planner.wordreel import Verdicts

    a, b = _two_songs(tmp_path)
    clean = dict(_moves_that_fit(BY_KEY["pick"], a, b, Verdicts()))
    known = Verdicts(warned={(1, 2, "bass_swap_blend")})
    warned = dict(_moves_that_fit(BY_KEY["pick"], a, b, known))
    assert warned["bass_swap_blend"] < clean["bass_swap_blend"]


def test_a_shaky_beat_grid_lowers_how_good_a_handoff_looks(tmp_path):
    from selecta.planner.beam import _Riders, handoff_quality

    a, b = _two_songs(tmp_path)
    a.grid_confidence = b.grid_confidence = 0.98
    sure = handoff_quality(a, b, _Riders())
    a.grid_confidence = 0.6
    assert handoff_quality(a, b, _Riders()) < sure
    a.grid_confidence = 0.3
    assert handoff_quality(a, b, _Riders()) == 0.1


def test_a_song_is_recommended_for_how_it_hands_over_on_both_sides(tmp_path):
    from selecta.planner.beam import rank_candidates

    before = _song(tmp_path, "before", "Before", bpm=120.0, camelot="8A")
    after = _song(tmp_path, "after", "After", bpm=120.0, camelot="8A")
    good = _song(tmp_path, "good", "Good", bpm=120.0, camelot="8A")
    lopsided = _song(tmp_path, "lop", "Lopsided", bpm=145.0, camelot="2B")
    ranked = rank_candidates(before, after, [before, after, good, lopsided], {before.id, after.id})
    assert ranked[0].song.id == good.id


def test_recommendations_keep_to_the_mix_and_away_from_nearby_artists(tmp_path):
    from selecta.planner.beam import rank_candidates

    before = _song(tmp_path, "before", "Before", bpm=120.0, camelot="8A")
    one = _song(tmp_path, "one", "One", bpm=120.0, camelot="8A")
    two = _song(tmp_path, "two", "Two", bpm=120.0, camelot="8A")
    songs = [before, one, two]
    assert (
        rank_candidates(before, None, songs, {before.id}, belongs={two.id: 1.0})[0].song.id
        == two.id
    )
    assert (
        rank_candidates(before, None, songs, {before.id}, nearby_artists={"two"})[0].song.id
        == one.id
    )


def test_bigger_and_calmer_think_about_the_next_song_too(tmp_path):
    current = _song(tmp_path, "now", "Now", bpm=120.0, camelot="8A", energy=0.5)
    following = _song(tmp_path, "next", "Next", bpm=120.0, camelot="8A", energy=0.5)
    fits_both = _song(tmp_path, "both", "Both", bpm=120.0, camelot="8A", energy=0.6)
    fits_one = _song(tmp_path, "one", "One", bpm=127.0, camelot="1B", energy=0.6)
    songs = [current, following, fits_both, fits_one]
    pick = suggest_next(current, songs, {following.id}, set(), 0, after=following)
    assert pick.id == fits_both.id


def test_suggestions_say_what_will_happen(tmp_path):
    from selecta.planner.beam import rank_candidates

    now = _song(tmp_path, "now", "Now", bpm=120.0, camelot="8A")
    ramp = _song(tmp_path, "ramp", "Ramp", bpm=100.0, camelot="8A")
    ranked = rank_candidates(now, None, [now, ramp], {now.id})
    assert ranked[0].reason == "A tempo ramp gets there"
