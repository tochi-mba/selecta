"""The mix a person edits: songs in order, with a seam between each pair."""

from __future__ import annotations

import json
import time
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf
from fastapi.testclient import TestClient
from helpers import song_from_track
from mix_helpers import _order, _song, _song_row, _vibe_library  # noqa: F401
from synth import SR, make_track

from selecta import db, mix
from selecta.analysis.pipeline import features_path
from selecta.api import create_app
from selecta.config import ANALYSIS_VERSION, Settings
from selecta.lyrics.lrclib import Line
from selecta.planner.beam import ARTIST_SEPARATION, WORDPLAY_LINK_BONUS, plan_set, suggest_next
from selecta.planner.memory import SeamMemory
from selecta.seams import SeamRequest, SeamStore, links_between, request_from, seam_options


@pytest.mark.parametrize("bridges", [[], [5]])
def test_prepared_request_requires_ready_audio_fresh_mix_and_bridge_consent(
    conn, tmp_path, monkeypatch, bridges
):
    mix.write_order(conn, [(1, None, 0), (2, None, 0), (3, None, 0)])
    monkeypatch.setattr("selecta.planner.reel.load_library", lambda *args: [])
    route = [*bridges, 4]

    def propose(rows, *args, **_options):
        return [
            {
                **row,
                "plan": dict(
                    position=2,
                    songs=route,
                    bridges=bridges,
                    seams=[{"move": "bass_swap_blend"}] * (len(route) + 1),
                ),
            }
            for row in rows
        ]

    monkeypatch.setattr("selecta.request_planner.proposals", propose)
    monkeypatch.setattr(SeamStore, "submit", lambda *args, **kwargs: {"status": "queued"})
    ready = False
    monkeypatch.setattr(
        SeamStore,
        "status",
        lambda self, key: dict(key=key, status="ready" if ready else "queued", passed=ready),
    )
    client = TestClient(create_app(Settings(tmp_path), tmp_path / "no-web"))
    request_id = client.post("/api/requests", json={"song_id": 4}).json()["id"]
    playback = dict(order=[1, 2, 3], position=0, phase="playing", seconds_left=100)
    offer = client.post("/api/requests/consider", json=playback).json()["requests"][0]
    action = {**playback, "offer": offer["offer"]}
    assert client.post("/api/requests/insert", json=action).status_code == 409
    ready = True
    assert client.post("/api/requests/insert", json=action).status_code == 409
    chain = [2, *route, 3]
    for a, b in zip(chain, chain[1:], strict=False):
        key = request_from(a, b, {"move": "bass_swap_blend"}).key
        folder = Settings(tmp_path).renders_dir / "seams" / key
        folder.mkdir(parents=True, exist_ok=True)
        (folder / "clip.flac").write_bytes(b"test prepared clip")
    offer = client.post("/api/requests/consider", json=playback).json()["requests"][0]
    if bridges:
        assert offer["needs_approval"]
        assert client.post("/api/requests/insert", json=action).status_code == 409
        answer = client.post(f"/api/requests/{request_id}/bridge", json={"allow": True})
        assert answer.status_code == 200
        offer = client.post("/api/requests/consider", json=playback).json()["requests"][0]
    assert offer["ready"]
    assert client.post("/api/requests/insert", json={**action, "position": 1}).status_code == 409
    result = client.post("/api/requests/insert", json=action)
    assert result.status_code == 200
    assert [item["song_id"] for item in result.json()["mix"]] == [1, 2, *route, 3]
    assert client.delete(f"/api/requests/{request_id}").json()["cancelled"] is False
    assert client.post("/api/requests/insert", json=action).status_code == 409


def test_song_request_routes_keep_unanalysed_intent_without_changing_mix(conn, tmp_path):
    conn.execute("DELETE FROM analysis WHERE song_id=1")
    conn.commit()
    client = TestClient(create_app(Settings(tmp_path), tmp_path / "no-web"))
    added = client.post("/api/requests", json={"song_id": 1})
    assert added.status_code == 200
    request_id = added.json()["id"]
    assert client.post("/api/requests", json={"song_id": 1}).json()["id"] == request_id
    assert len(client.get("/api/requests").json()["requests"]) == 1
    assert conn.execute("SELECT COUNT(*) FROM queue").fetchone()[0] == 0
    assert client.post("/api/requests", json={"song_id": 9999}).status_code == 400
    assert client.delete(f"/api/requests/{request_id}").json()["cancelled"]
    assert client.get("/api/requests").json()["requests"] == []


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


def test_moving_a_song_up_past_several_resets_the_song_that_closes_its_gap(conn, store):
    """1 2 3 4 5, move 4 to the second place: 1 4 2 3 5. The 4-2 and 1-4 pairs and 3-5 are new; 2-3 is not."""
    for song in (1, 2, 3, 4, 5):
        mix.add_song(conn, song)
    for position in (1, 2, 3, 4):
        mix.set_seam(conn, position, {"move": "cut_on_one"})
    mix.move_song(conn, 3, 1)
    items = mix.read_mix(conn, store)
    assert [item["song_id"] for item in items] == [1, 4, 2, 3, 5]
    settings = [item["seam"]["settings"] for item in items[1:]]
    assert settings == [{}, {}, {"move": "cut_on_one"}, {}]


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
    with_link = plan_set(
        [first, close, linked],
        first.id,
        2,
        links={(first.id, linked.id)},
        link_bonus=WORDPLAY_LINK_BONUS,
    )
    assert without[1].song.id == close.id
    assert with_link[1].song.id == linked.id
    assert with_link[1].reason == "shares a phrase"


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


def test_a_mix_kept_as_a_draft_comes_back_exactly_as_it_was(conn, store):
    for song in (1, 2):
        mix.add_song(conn, song)
    mix.set_seam(conn, 1, {"move": "phrase_roll", "phrase": "good news"})
    draft = mix.copy_current(conn, "For Friday")
    mix.write_order(conn, [])
    mix.play_draft(conn, draft)
    assert _order(conn, store) == [1, 2]
    assert mix.read_mix(conn, store)[1]["seam"]["settings"]["phrase"] == "good news"
    assert mix.mix_name(conn) == "For Friday"


def test_energy_is_measured_against_your_own_library(tmp_path):
    """Raw scores sit between about 0.4 and 0.5, so "high" has to mean high for this library."""
    songs, traits = _vibe_library(tmp_path)
    assert traits[songs[0].id].energy == 0.0
    assert traits[songs[-1].id].energy == 1.0


def test_sound_candidates_do_not_invent_genre_from_missing_tags_or_word_density():
    from types import SimpleNamespace

    from selecta.planner.vibes import BY_KEY, Traits, _ranks, build_vibe, resolve_vibe

    traits = Traits(energy=0.8, felt=120, year=2020, wordy=1.0, english=True)
    unknown = SimpleNamespace(id=1, family="other")
    pop = SimpleNamespace(id=2, family="pop")
    assert not BY_KEY["guitars"].fits(unknown, traits)
    assert not BY_KEY["rap_run"].fits(pop, traits)
    assert resolve_vibe("slow_burn__other") is None
    assert list(_ranks([0.4, 0.4, 0.8])) == [0.0, 0.0, 1.0]
    with pytest.raises(ValueError, match="does not belong"):
        build_vibe(BY_KEY["afro_heat"], [pop], {2: traits}, {}, end_id=2)
    with pytest.raises(ValueError, match="No matching"):
        build_vibe(BY_KEY["afro_heat"], [], {}, {})


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


def test_journey_candidates_are_split_by_musical_family(tmp_path):
    from selecta.planner.vibes import candidate_vibes, eligible, resolve_vibe

    songs, traits = _vibe_library(tmp_path)
    candidates = {vibe.key: vibe for vibe in candidate_vibes(songs, traits)}

    afro = candidates["slow_burn__afro"]
    assert afro.name == "Afrobeats & amapiano · Slow burn"
    assert {song.family for song in eligible(afro, songs, traits)} == {"afro"}
    assert "slow_burn" not in candidates
    resolved = resolve_vibe("slow_burn__afro")
    assert resolved is not None and (resolved.key, resolved.family) == (afro.key, afro.family)


def test_family_candidate_rejects_an_unrelated_start_or_destination(tmp_path):
    from selecta.planner.vibes import build_vibe, resolve_vibe

    songs, traits = _vibe_library(tmp_path)
    vibe = resolve_vibe("slow_burn__afro")
    assert vibe is not None
    unrelated = next(song for song in songs if song.family != "afro")

    with pytest.raises(ValueError, match="does not belong"):
        build_vibe(vibe, songs, traits, {}, 6, start=unrelated.id)
    with pytest.raises(ValueError, match="Afrobeats & amapiano song"):
        build_vibe(vibe, songs, traits, {}, 6, end_id=unrelated.id)


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

    a = _song(tmp_path, "stem-a", "First")
    b = _song(tmp_path, "stem-b", "Second")
    monkeypatch.setattr(vibes, "modes_for", lambda *_: {"word_blend"})
    monkeypatch.setattr(vibes, "ride_lines", lambda *_: (object(), object()))
    monkeypatch.setattr(vibes, "enumerate_candidates", lambda *_args, **_kwargs: [object()])
    monkeypatch.setattr(vibes, "can_intertwine", lambda *_: True)
    vibe = vibes.BY_KEY["pick"]

    never = vibes._moves_that_fit(vibe, a, b, SeamMemory(), "never")
    sometimes = dict(vibes._moves_that_fit(vibe, a, b, SeamMemory(), "sometimes"))
    often = dict(vibes._moves_that_fit(vibe, a, b, SeamMemory(), "often"))

    assert "vocal_ride" not in dict(never)
    assert often["vocal_ride"] > sometimes["vocal_ride"]
    assert "stem_intertwine" not in dict(never)
    assert often["stem_intertwine"] > sometimes["stem_intertwine"]
    failed = vibes._moves_that_fit(
        vibe,
        a,
        b,
        SeamMemory(failed={(a.id, b.id, "stem_intertwine")}),
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
    monkeypatch.setattr("selecta.seam_making.render_intertwined", lambda *_: result)
    monkeypatch.setattr("selecta.seam_making.audit", lambda _rendered: SimpleNamespace(passed=True))
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
