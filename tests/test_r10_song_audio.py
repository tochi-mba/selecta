"""r10: the whole-song audio route is tagged by its source file and decoded once.

`GET /api/songs/{id}/audio` used to decode and WAV-encode the whole song on every request. These
prove a browser holding the song gets a 304 without a decode, a repeat is served from the render
cache with Range, the tag changes when the file does, the cache counts toward the cache room and
is tidied with the song, and the song detail route reads only the waveform peaks.
"""

from __future__ import annotations

import os
import time
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf
from fastapi.testclient import TestClient
from test_r8d_backend_speed import _library

from selecta import cache_care, flags, song_audio, stems
from selecta.api import create_app
from selecta.config import SAMPLE_RATE, Settings

SECONDS = 2.0


@pytest.fixture
def settings(tmp_path):
    return Settings(tmp_path / "home")


@pytest.fixture
def source(tmp_path) -> Path:
    path = tmp_path / "music" / "one.wav"
    path.parent.mkdir(parents=True)
    tone = 0.2 * np.sin(np.linspace(0, 440 * 2 * np.pi * SECONDS, int(SAMPLE_RATE * SECONDS)))
    sf.write(path, np.column_stack([tone, tone]).astype(np.float32), SAMPLE_RATE)
    return path


@pytest.fixture
def conn(settings, source):
    connection = _library(settings, songs=2, links=2)
    connection.execute("UPDATE songs SET path=? WHERE id=1", (str(source),))
    connection.commit()
    yield connection
    connection.close()


@pytest.fixture
def decodes(monkeypatch) -> list[str]:
    """Counts decodes, and stands in for ffmpeg with a quiet stereo second."""
    seen: list[str] = []

    def decode(path, *_args, **_kwargs):
        seen.append(str(path))
        return np.zeros((SAMPLE_RATE, 2), np.float32)

    monkeypatch.setattr("selecta.audio.decode", decode)
    return seen


@pytest.fixture
def client(settings, conn, tmp_path):
    return TestClient(create_app(settings, tmp_path / "no-web"))


def test_the_first_answer_carries_a_strong_tag_and_is_cached(client, settings, decodes):
    first = client.get("/api/songs/1/audio")
    assert first.status_code == 200 and first.headers["content-type"] == "audio/wav"
    etag = first.headers["etag"]
    assert etag.startswith('"') and not etag.startswith("W/")
    assert first.headers["cache-control"] == "no-cache"
    assert first.headers["accept-ranges"] == "bytes"
    assert len(decodes) == 1
    cached = list(song_audio.cache_root(settings).glob("1-*/song.wav"))
    assert len(cached) == 1 and cached[0].read_bytes() == first.content
    assert not list(song_audio.cache_root(settings).glob("*/*.part"))


def test_a_browser_holding_the_song_gets_a_304_without_a_decode(client, decodes):
    etag = client.get("/api/songs/1/audio").headers["etag"]
    again = client.get("/api/songs/1/audio", headers={"If-None-Match": etag})
    assert again.status_code == 304 and again.content == b""
    assert again.headers["etag"] == etag
    assert len(decodes) == 1
    weak = client.get("/api/songs/1/audio", headers={"If-None-Match": f"W/{etag}"})
    assert weak.status_code == 304


def test_a_304_needs_no_cached_copy(client, settings, decodes):
    """Evicted from the cache, a browser's copy is still good: nothing is decoded to say so."""
    etag = client.get("/api/songs/1/audio").headers["etag"]
    for folder in song_audio.cache_root(settings).iterdir():
        for path in folder.iterdir():
            path.unlink()
        folder.rmdir()
    assert client.get("/api/songs/1/audio", headers={"If-None-Match": etag}).status_code == 304
    assert len(decodes) == 1


def test_a_repeat_is_served_from_the_cache(client, decodes):
    first = client.get("/api/songs/1/audio")
    second = client.get("/api/songs/1/audio")
    assert second.status_code == 200 and second.content == first.content
    assert second.headers["etag"] == first.headers["etag"]
    assert len(decodes) == 1


def test_a_range_request_gets_its_range(client, decodes):
    whole = client.get("/api/songs/1/audio").content
    part = client.get("/api/songs/1/audio", headers={"Range": "bytes=100-299"})
    assert part.status_code == 206
    assert part.content == whole[100:300]
    assert part.headers["content-range"] == f"bytes 100-299/{len(whole)}"
    assert len(decodes) == 1


def test_the_tag_changes_when_the_file_does(client, source, decodes):
    before = client.get("/api/songs/1/audio").headers["etag"]
    sf.write(source, np.zeros((SAMPLE_RATE * 3, 2), np.float32), SAMPLE_RATE)
    later = time.time() + 5
    os.utime(source, (later, later))
    after = client.get("/api/songs/1/audio", headers={"If-None-Match": before})
    assert after.status_code == 200
    assert after.headers["etag"] != before
    assert len(decodes) == 2


def test_with_the_cache_off_it_decodes_in_memory_but_still_tags(
    client, settings, decodes, monkeypatch
):
    real = flags.on
    monkeypatch.setattr(flags, "on", lambda flag: False if flag == song_audio.FLAG else real(flag))
    first = client.get("/api/songs/1/audio")
    assert first.status_code == 200 and first.content[:4] == b"RIFF"
    assert not song_audio.cache_root(settings).exists()
    again = client.get("/api/songs/1/audio", headers={"If-None-Match": first.headers["etag"]})
    assert again.status_code == 304
    assert len(decodes) == 1


def test_a_missing_file_is_a_404_not_a_crash(client, source, decodes):
    source.unlink()
    assert client.get("/api/songs/1/audio").status_code == 404
    assert decodes == []


def test_the_cached_songs_count_toward_the_cache_room(client, settings, decodes):
    assert song_audio.cache_root(settings) in stems.cache_roots(settings)
    before = stems.cache_room(settings)[0]
    size = len(client.get("/api/songs/1/audio").content)
    assert stems.cache_room(settings)[0] >= before + size


def test_the_cache_limit_never_pushes_out_the_current_mix(client, settings, decodes, monkeypatch):
    seam = settings.renders_dir / "seams" / "mixkey"
    seam.mkdir(parents=True)
    (seam / "clip.flac").write_bytes(b"x" * 4096)
    cache_care.remember_protected(settings, ["mixkey"])
    monkeypatch.setattr(Settings, "effective_cache_cap_bytes", property(lambda _self: 1))
    assert client.get("/api/songs/1/audio").status_code == 200
    assert (seam / "clip.flac").is_file()


def test_tidying_removes_songs_that_left_or_changed(settings, conn, source, decodes):
    song_audio.cached_file(settings, 1, source, 0.0, song_audio.song_key(1, source, 0.0))
    gone = song_audio.folder_for(settings, 7, "abc")
    gone.mkdir(parents=True)
    (gone / song_audio.FILE_NAME).write_bytes(b"x")
    swept = cache_care.Swept()
    cache_care._song_orphans(settings, {1, 2}, swept)
    assert not gone.exists()
    assert swept.removed == {"full song of a removed song": 1}
    later = time.time() + 5
    os.utime(source, (later, later))
    cache_care._song_orphans(settings, {1, 2}, swept)
    assert not list(song_audio.cache_root(settings).iterdir())
    assert swept.removed["full song of a changed file"] == 1


def test_a_crash_leftover_part_is_tidied(settings):
    folder = song_audio.folder_for(settings, 1, "abc")
    folder.mkdir(parents=True)
    leftover = folder / "song.wav.part"
    leftover.write_bytes(b"x")
    old = time.time() - cache_care.CRASH_GRACE_S - 60
    os.utime(leftover, (old, old))
    swept = cache_care.Swept()
    cache_care._crash_leftovers(settings, cache_care._kept(settings), time.time(), swept)
    assert not leftover.exists()


def test_the_song_detail_reads_only_the_peaks(client, monkeypatch):
    asked: list = []
    real = __import__("selecta.analysis.pipeline", fromlist=["load_features"]).load_features

    def watching(settings_, song_id, names=None):
        if names is None or "peaks" in names:
            asked.append(names)
        return real(settings_, song_id, names)

    monkeypatch.setattr("selecta.analysis.pipeline.load_features", watching)
    detail = client.get("/api/songs/1")
    assert detail.status_code == 200 and detail.json()["peaks"]
    assert ("peaks",) in asked and None not in asked
