"""SF-0246-06: the finished export is the frozen plan, checked by decoding the FLAC.

A real export job joins real audio (synthesized songs and a rendered clip on disk, no stand-in
for the join or the encode). The mix changes while the job waits for its transition, then the
saved FLAC is decoded and its length and the checksum of its decoded samples are compared with
what the job's frozen revision says it holds: the songs and transition keys it pinned down, joined
from scratch here. The live mix it no longer matches would give a different file.
"""

from __future__ import annotations

import hashlib
import json
import threading
import time

import numpy as np
import soundfile as sf
from fastapi.testclient import TestClient
from helpers import song_from_track
from mix_helpers import _song_row
from synth import make_track

from selecta import db, mix
from selecta.api import create_app
from selecta.config import SAMPLE_RATE, Settings
from selecta.export_validation import pcm_checksum, verify_export
from selecta.render.engine import SongCache
from selecta.render.setmix import SEAM_SECONDS, _native, join
from selecta.routes import exports
from selecta.seams import SeamStore

# where the transition leaves the first song and lands in the second, in each song's own seconds
LEAVE_AT, LAND_AT = 12.0, 4.0


def _settle(client, job_id):
    for _ in range(500):
        saved = client.get(f"/api/exports/jobs/{job_id}").json()
        if saved["state"] not in {"preparing", "encoding", "cancelling"}:
            return saved
        time.sleep(0.02)
    raise AssertionError(f"export {job_id} never settled: {saved}")


def _frozen_audio(songs, store, seam_states, song_ids, keys) -> np.ndarray:
    """The frozen plan joined from scratch: these songs in this order with these clips."""
    cache = SongCache(capacity=3)
    parts, position = [], 0.0
    for index, song_id in enumerate(song_ids):
        song = songs[song_id]
        after = seam_states[keys[index]] if index < len(keys) else None
        end = after["a_source_start"] if after else song.duration
        parts.append(_native(cache, song, position, end))
        if after:
            clip, _ = sf.read(store.folder(after["key"]) / "clip.flac", dtype="float32")
            parts.append(clip)
            position = after["b_source_end"]
    return join(parts)


def test_the_saved_flac_decodes_to_exactly_the_frozen_revision(tmp_path, monkeypatch):
    settings = Settings(tmp_path)
    conn = db.connect(settings.db_path)
    for song_id in (1, 2, 3):
        _song_row(conn, song_id, f"Artist {song_id}", f"Song {song_id}")
    conn.commit()
    songs = {}
    for song_id in (1, 2, 3):
        song = song_from_track(tmp_path, f"song-{song_id}", make_track(bars=8, seed=song_id))
        song.id = song_id
        songs[song_id] = song
    monkeypatch.setattr(mix, "load_song", lambda _conn, _settings, song_id: songs[song_id])
    store = SeamStore(settings)
    mix.add_song(conn, 1)
    mix.add_song(conn, 2)
    conn.commit()
    key = mix.read_mix(conn, store)[1]["seam"]["state"]["key"]
    conn.close()

    # the rendered transition: a short clip on disk where the worker would have put it
    folder = store.folder(key)
    folder.mkdir(parents=True, exist_ok=True)
    seconds = np.arange(int(3 * SAMPLE_RATE)) / SAMPLE_RATE
    tone = (0.2 * np.sin(2 * np.pi * 220 * seconds)).astype(np.float32)
    sf.write(folder / "clip.flac", np.stack([tone, tone], axis=1), SAMPLE_RATE, subtype="PCM_16")
    ready_state = {
        "status": "ready",
        "key": key,
        "a_source_start": LEAVE_AT,
        "b_source_end": LAND_AT,
    }
    rendered = threading.Event()

    def status(_store, asked):
        if asked != key:
            return {"status": "none", "key": asked}
        return ready_state if rendered.is_set() else {"status": "rendering", "key": asked}

    monkeypatch.setattr(SeamStore, "status", status)
    monkeypatch.setattr(SeamStore, "submit", lambda _store, _request: None)
    monkeypatch.setattr(exports, "CHECK_EVERY_SECONDS", 0.01)
    client = TestClient(create_app(settings, tmp_path / "no-web"))

    job = client.post("/api/exports/jobs").json()
    assert job["state"] == "preparing"
    # the mix moves on while the job waits for its transition
    with db.connect(settings.db_path) as changing:
        mix.add_song(changing, 3)
        live = [item["song_id"] for item in mix.read_mix(changing, store)]
    assert live == [1, 2, 3]
    rendered.set()
    done = _settle(client, job["id"])
    assert done["state"] == "ready", done

    # the frozen revision is the identity of exactly what the job pinned down
    identity = json.dumps(
        {
            "scope": done["scope"],
            "draft": done["draft"],
            "songs": [song["song_id"] for song in done["songs"]],
            "seams": [seam["key"] for seam in done["seams"]],
        },
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    assert done["revision"] == job["revision"] == hashlib.sha256(identity).hexdigest()[:12]
    assert [song["song_id"] for song in done["songs"]] == [1, 2]
    assert [seam["key"] for seam in done["seams"]] == [key]

    # decode the saved FLAC in full and compare it with the frozen plan joined from scratch
    saved = settings.home / "exports" / done["name"]
    with sf.SoundFile(saved) as flac:
        assert (flac.format, flac.subtype, flac.channels, flac.samplerate) == (
            "FLAC",
            "PCM_16",
            2,
            SAMPLE_RATE,
        )
        frames = flac.frames
    decoded, rate = sf.read(saved, dtype="int16", always_2d=True)
    assert rate == SAMPLE_RATE and decoded.shape == (frames, 2)
    expected = _frozen_audio(songs, store, {key: ready_state}, [1, 2], [key])
    assert frames == expected.shape[0]
    assert abs(done["seconds"] - frames / SAMPLE_RATE) < 1 / SAMPLE_RATE
    # song 1 to where the transition leaves it, the clip, the rest of song 2; each of the two joins
    # overlaps by its short declick
    plan_seconds = LEAVE_AT + 3.0 + (songs[2].duration - LAND_AT) - 2 * SEAM_SECONDS
    assert abs(frames / SAMPLE_RATE - plan_seconds) <= 2 / SAMPLE_RATE
    decoded_sum = hashlib.sha256(np.ascontiguousarray(decoded.astype("<i2")).tobytes()).hexdigest()
    assert done["checksum"] == decoded_sum == pcm_checksum(expected)
    assert verify_export(saved, done["seconds"]) == done["checksum"]

    # the live mix it no longer matches would be a different, longer file
    assert songs[3].duration > 0 and len(live) > len(done["songs"])

    # and a file that drifted from the frozen audio by a single sample no longer matches
    decoded[frames // 2, 0] ^= 1
    sf.write(saved, decoded, SAMPLE_RATE, subtype="PCM_16", format="FLAC")
    assert verify_export(saved, done["seconds"]) != done["checksum"]
