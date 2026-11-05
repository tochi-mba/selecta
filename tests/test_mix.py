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
from selecta.seams import (
    MIX,
    PREPARING,
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
    assert old and all(traits[song.id].year < 2006 for song in old)
    peak = eligible(BY_KEY["peak"], songs, traits)
    assert peak and all(traits[song.id].energy >= 0.55 for song in peak)
    planned, _ = build_vibe(BY_KEY["peak"], songs, traits, {}, 5, seed=1)
    assert {item.song.id for item in planned} <= {song.id for song in peak}


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
        songs.append(song)
    planned = [PlannedSong(song, "bass_swap_blend", "") for song in songs]
    phrases = {(songs[i].id, songs[i + 1].id): "good news" for i in range(7)}
    showcase = seam_choices(BY_KEY["wordplay"], planned, phrases)
    assert sum("phrase" in seam for seam in showcase.values()) == 7
    usual = seam_choices(BY_KEY["pick"], planned, phrases)
    positions = [i for i, song in enumerate(songs) if "phrase" in usual.get(song.id, {})]
    assert len(positions) == 2
    assert positions[1] - positions[0] >= 4


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
    assert ranked[2].reason == "A change of pace"


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
    assert "agreement" not in SeamStore.__dict__, "failure wording stays in plain language"


def test_spare_time_work_waits_behind_anything_a_person_asked_for(tmp_path):
    store = SeamStore(Settings(tmp_path))
    theirs = SeamRequest(1, 2, "cut_on_one")
    idle = SeamRequest(3, 4, "cut_on_one")
    store.next_idle_job = lambda: idle
    store.ask(theirs)
    assert store._next_job() == theirs
    assert store._next_job() == idle


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
