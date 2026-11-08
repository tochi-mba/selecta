"""The mix a person edits: songs in order, with a seam between each pair."""

from __future__ import annotations

import json
import shutil
import time

import pytest
from fastapi.testclient import TestClient
from helpers import song_from_track
from mix_helpers import (  # noqa: F401
    HELPER_WHILE_WAITING,
    _report,
    _request,
    _song,
    _song_row,
    _two_songs,
    _vibe_library,
)
from synth import make_track

from selecta import db, jobs, mix
from selecta.api import create_app
from selecta.config import Settings
from selecta.lyrics.lrclib import Line
from selecta.planner.memory import SeamMemory
from selecta.seams import MIX, PREPARING, CannotRender, SeamRequest, SeamStore


def test_destination_steering_persists_and_status_names_the_song(client):
    response = client.post("/api/steer", json={"action": "take_me_to", "value": 2})
    assert response.status_code == 200
    assert response.json()["target"] == "2"
    status = client.get("/api/status").json()
    assert status["steering"]["target_label"] == "Artist 2 - Song 2"
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

    shutil.rmtree(store.root)
    fresh = SeamStore(Settings(tmp_path))
    assert fresh.submit(request)["status"] == "failed"
    assert (request.a, request.b, request.move) in fresh.remembered(fresh=True).failed
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
    known = fresh.remembered(fresh=True)
    assert known.move_factor(1, 2, "vocal_ride") == 0.0
    assert not known.proven(1, 2, "vocal_ride")
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
    assert store.submit(request)["status"] == "failed", "only asking on purpose tries it again"
    assert store.submit(request, retry=True)["status"] == "queued"
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

    monkeypatch.setattr("subprocess.Popen", FakeProcess)
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

    track = make_track(bpm=120, bars=64, seed=1)
    a = song_from_track(tmp_path, "a", track)
    b = song_from_track(tmp_path, "b", track)
    a.id, b.id = 1, 2
    a.lines = [Line(10.0, 12.0, "you and me in the night")]
    b.lines = [Line(10.0, 12.0, "you and me in the night")]
    assert _word_move(a, b, SeamMemory()) is not None
    b.lines = [Line(10.0, 12.0, "wetin dey happen abeg oga")]
    assert _word_move(a, b, SeamMemory()) is None


def test_a_move_that_failed_on_two_songs_isnt_planned_again(tmp_path):
    from selecta.planner.vibes import BY_KEY, _moves_that_fit

    track = make_track(bpm=120, bars=64, seed=1)
    a = song_from_track(tmp_path, "a", track)
    b = song_from_track(tmp_path, "b", track)
    a.id, b.id = 1, 2
    fresh = [name for name, _ in _moves_that_fit(BY_KEY["pick"], a, b, SeamMemory())]
    assert "bass_swap_blend" in fresh
    known = SeamMemory(failed={(1, 2, "bass_swap_blend")})
    assert "bass_swap_blend" not in [
        name for name, _ in _moves_that_fit(BY_KEY["pick"], a, b, known)
    ]


def test_only_a_rap_mix_ever_plans_a_cut():
    from selecta.planner.vibes import MOVE_WEIGHTS

    assert [name for name, moves in MOVE_WEIGHTS.items() if "cut_on_one" in moves] == ["punchy"]


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
    assert asked[0] in {"stem_arrange", "filter_sweep", "bass_swap_blend", "tempo_ramp"}
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

    monkeypatch.setattr("selecta.seam_making.ride_lines", lambda *_: (object(), object()))
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

    def fallback(_a, _b, tried, asked, near, stem_preference, leave_after=None):
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

    known = store.remembered(fresh=True)

    assert known.move_factor(1, 2, "phrase_roll") == 0.0
    assert not known.proven(1, 2, "phrase_roll")

    a, b = _two_songs(tmp_path)
    a.bpm, b.bpm = 120.0, 145.0
    a.lines = [Line(20.0, 22.0, "good morning world")]
    b.lines = [Line(20.0, 22.0, "good morning world")]
    assert _word_move(a, b, known) is None, "the rated-bad phrase roll must not be planned again"
