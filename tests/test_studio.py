"""The Seam Studio: lining up both songs' stems and turning a shape into a real seam."""

from __future__ import annotations

import hashlib
import json
from dataclasses import asdict
from types import SimpleNamespace

import numpy as np
import pytest
import soundfile as sf
from fastapi.testclient import TestClient
from helpers import song_from_track
from synth import make_track

import selecta.seams as seams_module
import selecta.studio as studio_module
from selecta import db
from selecta.api import create_app
from selecta.config import ANALYSIS_VERSION, SAMPLE_RATE, Settings
from selecta.planner.memory import SeamMemory
from selecta.seams import (
    MOVES,
    RENDER_VERSION,
    STUDIO_SESSION,
    SeamRequest,
    SeamStore,
    _make_session,
    request_from,
    seam_options,
)
from selecta.studio import (
    CELLS,
    LANES,
    SIDES,
    START_SHAPE,
    _lane_gain,
    clean_shape,
    find_placement,
    prepare_session,
    render_shape,
    why_no_studio,
    windows_to_separate,
)


def _pair(tmp_path, bpm_a=120, bpm_b=120, bars=64):
    a = song_from_track(tmp_path, "a", make_track(bpm=bpm_a, bars=bars, seed=1))
    b = song_from_track(tmp_path, "b", make_track(bpm=bpm_b, bars=bars, seed=2))
    a.id, b.id = 1, 2
    return a, b


def _fake_stems(monkeypatch, tmp_path, stretch=False):
    """Four stems per window, cut from the song, with a different level each so they can be told
    apart. Real separation takes minutes, and what's being tested is what happens after it."""
    made = []

    def separate(_settings, source, start, seconds=46.0):
        audio, rate = sf.read(source, dtype="float32", always_2d=True)
        begin = int(start * rate)
        piece = audio[begin : begin + int(seconds * rate)]
        folder = tmp_path / f"stems{len(made)}"
        folder.mkdir()
        made.append((source, start, seconds))
        paths = {}
        for index, lane in enumerate(LANES):
            path = folder / f"{lane}.wav"
            sf.write(path, piece * (0.2 + 0.1 * index), rate)
            paths[lane] = path
        return SimpleNamespace(**paths)

    monkeypatch.setattr(studio_module, "separate_window", separate)
    # both songs share a tempo here, so stretching would change nothing and only take time
    if stretch is False:
        monkeypatch.setattr(studio_module.dsp, "stretch_to_warp", lambda audio, *_: (audio, None))
    return made


def test_two_songs_get_the_longest_overlap_they_can_hold(tmp_path):
    a, b = _pair(tmp_path)
    place = find_placement(a, b)
    assert place is not None
    assert place.bars == 16


def test_the_placement_keeps_to_the_cue_points_a_person_chose(tmp_path):
    a, b = _pair(tmp_path)
    chosen = find_placement(a, b)
    place = find_placement(a, b, chosen.exit_cue.bar, chosen.entry_cue.bar)
    assert place.exit_cue.bar == chosen.exit_cue.bar
    assert place.entry_cue.bar == chosen.entry_cue.bar


def test_a_cue_point_that_no_longer_exists_does_not_stop_the_studio(tmp_path):
    a, b = _pair(tmp_path)
    assert find_placement(a, b, exit_bar=9999, entry_bar=9999) is not None


def test_songs_too_far_apart_in_tempo_say_why_in_plain_words(tmp_path):
    a, b = _pair(tmp_path, bpm_a=120, bpm_b=160)
    assert find_placement(a, b) is None
    reason = why_no_studio(a, b)
    assert "tempo" in reason
    assert "%" in reason


def test_songs_with_an_unclear_beat_are_not_lined_up(tmp_path):
    a, b = _pair(tmp_path)
    a.grid_confidence = 0.2
    assert find_placement(a, b) is None
    assert "clear bars" in why_no_studio(a, b)


def test_songs_in_different_meters_are_not_lined_up(tmp_path):
    a, b = _pair(tmp_path)
    b.beats_per_bar = 3
    assert find_placement(a, b) is None


def test_nothing_to_say_when_it_can_be_done(tmp_path):
    a, b = _pair(tmp_path)
    assert why_no_studio(a, b) is None


def test_a_session_lays_out_eight_stems_of_exactly_the_same_length(tmp_path, monkeypatch):
    a, b = _pair(tmp_path)
    made = _fake_stems(monkeypatch, tmp_path)
    folder = tmp_path / "session"
    session = prepare_session(Settings(tmp_path / "home"), a, b, folder)
    assert len(made) == 2
    lengths = set()
    for side in SIDES:
        for lane in LANES:
            audio, rate = sf.read(folder / f"{side}_{lane}.flac")
            assert rate == SAMPLE_RATE
            lengths.add(audio.shape[0])
    assert len(lengths) == 1
    assert lengths.pop() == pytest.approx(session["seconds"] * SAMPLE_RATE, abs=2)


def test_the_second_song_is_stretched_onto_the_first_songs_bars(tmp_path, monkeypatch):
    a, b = _pair(tmp_path, bpm_a=120, bpm_b=124)
    _fake_stems(monkeypatch, tmp_path, stretch=True)
    folder = tmp_path / "session"
    session = prepare_session(Settings(tmp_path / "home"), a, b, folder)
    first, _ = sf.read(folder / "a_drums.flac")
    second, _ = sf.read(folder / "b_drums.flac")
    assert first.shape == second.shape
    assert first.shape[0] == pytest.approx(session["seconds"] * SAMPLE_RATE, abs=2)
    assert np.abs(second).max() > 0.01


def test_a_session_tells_the_page_all_it_needs(tmp_path, monkeypatch):
    a, b = _pair(tmp_path)
    _fake_stems(monkeypatch, tmp_path)
    session = prepare_session(Settings(tmp_path / "home"), a, b, tmp_path / "session")
    assert session["bars"] == 16
    assert session["cells"] == CELLS
    assert session["seconds"] == pytest.approx(16 * 4 * 0.5, abs=0.05)
    assert session["start_shape"] == START_SHAPE
    assert len(session["a_points"]) == 16 * 4 + 1
    assert len(session["b_points"]) == 16 * 4 + 1
    json.dumps(session)


def test_a_session_that_cannot_be_laid_out_says_why(tmp_path):
    a, b = _pair(tmp_path, bpm_a=120, bpm_b=160)
    with pytest.raises(ValueError, match="tempo"):
        prepare_session(Settings(tmp_path / "home"), a, b, tmp_path / "session")


def test_the_wait_only_counts_stems_that_are_still_needed(tmp_path, monkeypatch):
    a, b = _pair(tmp_path)
    settings = Settings(tmp_path / "home")
    monkeypatch.setattr(studio_module, "window_is_ready", lambda *_args: False)
    assert windows_to_separate(settings, a, b) == 2
    monkeypatch.setattr(studio_module, "window_is_ready", lambda *_args: True)
    assert windows_to_separate(settings, a, b) == 0


def test_the_wait_is_zero_when_it_cannot_be_done(tmp_path):
    a, b = _pair(tmp_path, bpm_a=120, bpm_b=160)
    assert windows_to_separate(Settings(tmp_path / "home"), a, b) == 0


def test_a_shape_from_outside_is_made_safe():
    assert clean_shape(None) == START_SHAPE
    assert clean_shape("not json") == START_SHAPE
    assert clean_shape("[1, 2]") == START_SHAPE
    assert clean_shape({"a": "nope"}) == START_SHAPE
    wrong_length = {"a": {"vocals": [1, 0]}}
    assert clean_shape(wrong_length)["a"]["vocals"] == START_SHAPE["a"]["vocals"]
    odd_values = {"a": {"vocals": [5, 0, "x", None, True, 0, 0, 1]}}
    assert clean_shape(odd_values)["a"]["vocals"] == [1, 0, 1, 0, 1, 0, 0, 1]


def test_a_shape_survives_being_saved_and_read():
    shape = clean_shape(START_SHAPE)
    assert clean_shape(json.dumps(shape)) == shape


def test_a_lane_is_on_and_off_where_the_grid_says():
    cells = [1, 1, 0, 0, 1, 1, 1, 0]
    count = 8 * SAMPLE_RATE
    gain = _lane_gain(cells, 8.0, count)[:, 0]
    for index, value in enumerate(cells):
        assert gain[int((index + 0.5) * SAMPLE_RATE)] == pytest.approx(value)


def test_turning_a_lane_on_or_off_never_clicks():
    gain = _lane_gain([1, 0, 1, 0, 1, 0, 1, 0], 8.0, 8 * SAMPLE_RATE)[:, 0]
    assert np.abs(np.diff(gain)).max() < 0.1


def test_a_lane_that_never_changes_is_steady():
    assert np.all(_lane_gain([1] * CELLS, 8.0, 1000) == 1.0)
    assert np.all(_lane_gain([0] * CELLS, 8.0, 1000) == 0.0)


@pytest.fixture
def session(tmp_path, monkeypatch):
    a, b = _pair(tmp_path)
    _fake_stems(monkeypatch, tmp_path)
    folder = tmp_path / "session"
    return a, b, folder, prepare_session(Settings(tmp_path / "home"), a, b, folder)


def _shape(a_on=0, b_on=0):
    return {
        "a": dict.fromkeys(LANES, [a_on] * CELLS),
        "b": dict.fromkeys(LANES, [b_on] * CELLS),
    }


def test_nothing_on_is_silence(session):
    a, b, folder, details = session
    assert np.abs(render_shape(a, b, folder, details, _shape()).audio).max() == 0.0


def test_only_the_first_song_on_is_only_the_first_song(session):
    a, b, folder, details = session
    rendered = render_shape(a, b, folder, details, _shape(a_on=1))
    assert np.abs(rendered.audio).max() > 0.01
    assert np.abs(rendered.b_dry).max() == 0.0
    assert np.abs(rendered.a_dry).max() > 0.01


def test_the_grid_really_changes_what_is_heard(session):
    a, b, folder, details = session
    silent_half = {
        "a": dict.fromkeys(LANES, [1, 1, 1, 1, 0, 0, 0, 0]),
        "b": dict.fromkeys(LANES, [0] * CELLS),
    }
    audio = render_shape(a, b, folder, details, silent_half).audio
    middle = audio.shape[0] // 2
    assert np.abs(audio[: middle - 2000]).max() > 0.01
    assert np.abs(audio[middle + 2000 :]).max() == 0.0


def test_a_rendered_shape_is_a_seam_the_mix_can_use(session):
    a, b, folder, details = session
    rendered = render_shape(a, b, folder, details, clean_shape(START_SHAPE))
    script = rendered.script
    assert script.style == "stem_studio"
    assert script.duration == pytest.approx(details["seconds"])
    assert script.a_source_start == pytest.approx(details["a_start"])
    assert script.b_source_end == pytest.approx(details["b_points"][-1], abs=0.05)
    assert rendered.audio.shape[0] == pytest.approx(details["seconds"] * SAMPLE_RATE, abs=2)
    assert np.abs(rendered.audio).max() <= 1.0


def test_seams_from_before_the_studio_keep_their_keys():
    plain = SeamRequest(1, 2, "echo_out")
    fields = asdict(plain)
    del fields["shape"]
    text = json.dumps([fields, ANALYSIS_VERSION, RENDER_VERSION], sort_keys=True)
    assert plain.key == hashlib.sha256(text.encode()).hexdigest()[:20]


def test_a_different_shape_is_a_different_seam():
    first = SeamRequest(1, 2, "stem_studio", shape=json.dumps(_shape(a_on=1)))
    second = SeamRequest(1, 2, "stem_studio", shape=json.dumps(_shape(b_on=1)))
    assert first.key != second.key


def test_a_saved_shape_comes_back_in_the_request():
    shape = json.dumps(_shape(a_on=1))
    request = request_from(1, 2, {"move": "stem_studio", "shape": shape})
    assert request.shape == shape
    assert request.move == "stem_studio"


def test_your_stems_never_appear_among_the_moves_to_choose(tmp_path):
    a, b = _pair(tmp_path)
    assert "stem_studio" in MOVES
    options = seam_options(a, b)
    assert "stem_studio" not in {move["name"] for move in options["moves"]}
    assert options["studio"] == {"available": True, "reason": None}


def test_the_chooser_explains_when_the_studio_is_not_possible(tmp_path):
    a, b = _pair(tmp_path, bpm_a=120, bpm_b=160)
    studio = seam_options(a, b)["studio"]
    assert studio["available"] is False
    assert "tempo" in studio["reason"]


def test_a_session_saves_its_layout_and_failures_are_reported_plainly(tmp_path, monkeypatch):
    a, b = _pair(tmp_path)
    _fake_stems(monkeypatch, tmp_path)
    settings = Settings(tmp_path / "home")
    request = SeamRequest(1, 2, STUDIO_SESSION)
    made = _make_session(settings, request, a, b)
    saved = settings.renders_dir / "seams" / request.key / "session.json"
    assert json.loads(saved.read_text("utf-8")) == json.loads(json.dumps(made))
    (tmp_path / "other").mkdir()
    far_a, far_b = _pair(tmp_path / "other", 120, 160)
    with pytest.raises(seams_module.CannotRender, match="tempo"):
        _make_session(settings, SeamRequest(1, 3, STUDIO_SESSION), far_a, far_b)


def test_a_studio_session_teaches_the_memory_nothing():
    memory = SeamMemory()
    request = {"a": 1, "b": 2, "move": STUDIO_SESSION}
    memory.learn({"status": "ready", "key": "x", "request": request})
    assert not memory.clean
    assert not memory.failed


def _mix_client(tmp_path, monkeypatch, bpm_b=120):
    settings = Settings(tmp_path / "home")
    settings.home.mkdir(parents=True)
    a, b = _pair(tmp_path, bpm_b=bpm_b)
    conn = db.connect(settings.db_path)
    for song in (a, b):
        conn.execute(
            "INSERT INTO songs(id,path,folder,size,mtime,duration,artist,title,is_music) "
            "VALUES(?,?,?,?,?,?,?,?,1)",
            (song.id, song.path, "f", 1, 1.0, song.duration, song.artist, song.title),
        )
        conn.execute(
            "INSERT INTO analysis(song_id,version,bpm,camelot) VALUES(?,?,?,?)",
            (song.id, ANALYSIS_VERSION, song.bpm, "8A"),
        )
    conn.commit()
    conn.close()
    songs = {1: a, 2: b}
    monkeypatch.setattr(
        "selecta.analysis.song.load_song", lambda _conn, _settings, song_id: songs[song_id]
    )
    sent = []

    def submit(self, request, urgent=False, retry=False):
        sent.append((request, urgent))
        state = {"status": "queued", "key": request.key, "request": request.__dict__}
        self._states[request.key] = state
        return state

    monkeypatch.setattr(SeamStore, "submit", submit)
    client = TestClient(create_app(settings, tmp_path / "no-web"))
    return client, settings, sent


def _load_two_song_mix(client):
    assert client.post("/api/mix/songs", json={"song_id": 1}).status_code == 200
    assert client.post("/api/mix/songs", json={"song_id": 2}).status_code == 200


def test_opening_the_studio_starts_a_session_and_quotes_the_wait(tmp_path, monkeypatch):
    client, _settings, sent = _mix_client(tmp_path, monkeypatch)
    monkeypatch.setattr("selecta.api.windows_to_separate", lambda *_args: 2)
    _load_two_song_mix(client)
    answer = client.post("/api/mix/1/studio")
    assert answer.status_code == 200
    body = answer.json()
    assert body["status"] == "queued"
    assert sent[-1][0].move == STUDIO_SESSION
    assert sent[-1][1] is True, "someone's waiting at the screen, so it goes first"
    # No job history yet: preparation plus two windows at the measured 120-second default.
    assert body["eta"]["seconds"] == 60 + 2 * 120
    assert body["key"] == sent[-1][0].key


def test_asking_again_while_it_waits_does_not_start_another(tmp_path, monkeypatch):
    client, _settings, sent = _mix_client(tmp_path, monkeypatch)
    monkeypatch.setattr("selecta.api.windows_to_separate", lambda *_args: 2)
    _load_two_song_mix(client)
    client.post("/api/mix/1/studio")
    count = len(sent)
    client.post("/api/mix/1/studio")
    assert len(sent) == count


def test_songs_that_cannot_share_a_studio_get_a_reason(tmp_path, monkeypatch):
    client, _settings, sent = _mix_client(tmp_path, monkeypatch, bpm_b=160)
    _load_two_song_mix(client)
    answer = client.post("/api/mix/1/studio")
    assert answer.status_code == 400
    assert "tempo" in answer.json()["detail"]
    assert not [item for item in sent if item[0].move == STUDIO_SESSION]


def test_only_real_stems_can_be_fetched(tmp_path, monkeypatch):
    client, settings, _sent = _mix_client(tmp_path, monkeypatch)
    folder = settings.renders_dir / "seams" / "abc"
    folder.mkdir(parents=True)
    sf.write(folder / "a_vocals.flac", np.zeros((100, 2)), SAMPLE_RATE)
    assert client.get("/api/studio/abc/a/vocals").status_code == 200
    assert client.get("/api/studio/abc/a/guitar").status_code == 404
    assert client.get("/api/studio/abc/c/vocals").status_code == 404
    assert client.get("/api/studio/abc/b/vocals").status_code == 404
    assert client.get("/api/studio/..%2F..%2Fsecret/a/vocals").status_code == 404


def test_using_a_shape_makes_it_that_seam_and_renders_it_first(tmp_path, monkeypatch):
    client, _settings, sent = _mix_client(tmp_path, monkeypatch)
    _load_two_song_mix(client)
    shape = _shape(a_on=1)
    answer = client.post("/api/mix/1/studio/use", json={"shape": shape})
    assert answer.status_code == 200
    item = answer.json()["mix"][1]
    assert item["seam"]["settings"]["move"] == "stem_studio"
    assert json.loads(item["seam"]["settings"]["shape"]) == clean_shape(shape)
    request, urgent = sent[-1]
    assert request.move == "stem_studio"
    assert urgent is True


def test_a_used_shape_can_be_undone(tmp_path, monkeypatch):
    client, _settings, _sent = _mix_client(tmp_path, monkeypatch)
    _load_two_song_mix(client)
    client.post("/api/mix/1/studio/use", json={"shape": _shape(a_on=1)})
    answer = client.post("/api/mix/undo")
    assert answer.status_code == 200
    assert answer.json()["mix"][1]["seam"]["settings"].get("move") != "stem_studio"
