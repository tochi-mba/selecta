"""Uploads join the song they are for (`storage.upload_identity`, phase 6a of the two-places plan).

A song a device already registered is uploaded through the real upload routes (plan, the
browser's part, complete) and must land on the same catalogue row, with everything that points
at it untouched: its own bytes, an older copy's bytes (a secondary hash), a re-tagged copy (same
audio id, new bytes), and an unsure audio match (a version). A file that isn't the named song is
refused at plan and at acceptance, another workspace's song is never matched, and with the flag
off everything is as before. The dry run (`POST /api/uploads/preview`) is checked for each
answer and its totals. The cloud worker's facts replace a device's (`hosted_facts`), and the
member's corrections still win.

`cloud_engine` runs each test on migrated SQLite, and on PostgreSQL where
`SELECTA_TEST_POSTGRES_URL` is set (the Linux CI job); it skips the PostgreSQL run otherwise.
"""

from __future__ import annotations

import hashlib
import json
import shutil
from types import SimpleNamespace

import numpy as np
import pytest
import sqlalchemy as sa
from brain_helpers import arrays_for, facts_body, scalars
from fastapi import FastAPI
from fastapi.testclient import TestClient
from test_cloud_storage_fakes import FakeS3

from selecta import flags, hosted_caps, hosted_facts
from selecta.billing.plans import plan_for
from selecta.cloud_brain.facts_routes import parse_facts
from selecta.engine_store import EngineStore, facts_store
from selecta.engine_store import ratings as stored_ratings
from selecta.engine_store import seams as stored_seams
from selecta.engine_store import songs as stored_songs
from selecta.engine_store.mixes import StoreMixes
from selecta.engine_store.schema import analysis, drafts, ratings, seams, song_overrides
from selecta.identity.tokens import Claims
from selecta.library.audio_identity import audio_id
from selecta.local_media import store
from selecta.local_media.hashes_schema import local_song_hashes
from selecta.local_media.schema import local_songs
from selecta.persistence import db_now, new_id, transaction
from selecta.storage import api as upload_api
from selecta.storage import personal_rights
from selecta.storage.api import install_routes
from selecta.storage.artifacts import LocalArtifactStore
from selecta.storage.keys import original_key
from selecta.storage.ports import PlanLimits
from selecta.storage.schema import assets
from selecta.storage.uploads import Probe
from selecta.usage import quota

A, B = "workspace-a", "workspace-b"
HEADERS = {"Authorization": "Bearer test"}
FRAMES = b"\xff\xfb\x90\x64" + bytes(range(256)) * 4
OTHER_FRAMES = b"\xff\xfb\x90\x64" + bytes(range(255, -1, -1)) * 4


def _mp3(title: str, frames: bytes = FRAMES) -> bytes:
    """A small MP3 whose audio id is its frames alone, so a new title is new bytes, same audio."""
    text = b"\x00" + title.encode()
    tag = b"TIT2" + len(text).to_bytes(4, "big") + b"\x00\x00" + text
    size = len(tag)
    syncsafe = bytes([(size >> 21) & 0x7F, (size >> 14) & 0x7F, (size >> 7) & 0x7F, size & 0x7F])
    return b"ID3\x03\x00\x00" + syncsafe + tag + frames


def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _audio(data: bytes, tmp_path) -> str:
    path = tmp_path / f"{_sha(data)}.mp3"
    path.write_bytes(data)
    found = audio_id(path)
    assert found is not None
    return found


def _probe(path):
    return Probe("mp3", 200.0, 44_100, 2, _sha(path.read_bytes()), path.stat().st_size)


@pytest.fixture
def world(cloud_engine):
    flags.use("+storage.upload_identity")
    for workspace in (A, B):
        with transaction(cloud_engine, workspace) as conn:
            quota.set_limit(conn, workspace, plan_for("free"))
            # cloud.move_to_cloud: the upload statement is agreed before a first upload
            personal_rights.record(conn, workspace, "user-test", now=db_now(conn))
    objects = FakeS3()

    def claims():
        return Claims("user-test", 1_000, 10_000, email="a@example.test", email_verified=True)

    def principal(_engine, _claims, workspace_id=None):
        return SimpleNamespace(workspace=SimpleNamespace(id=workspace_id or A))

    app = FastAPI()
    install_routes(app, engine=cloud_engine, current_claims=claims, principal_for=principal,
                   object_client_factory=lambda: objects, probe=_probe)
    with TestClient(app) as client:
        yield SimpleNamespace(engine=cloud_engine, client=client, objects=objects)


def _device_song(engine, data: bytes | str, *, workspace: str = A, title: str = "Call on Me",
                 artist: str = "Adekunle Gold", audio: str | None = None) -> int:
    """A song as a device registers it: its file hash and, when given, its audio id."""
    sha = data if isinstance(data, str) else _sha(data)
    song = {"content_sha256": sha, "title": title, "artist": artist, "album": "Afro Pop",
            "duration_s": 200.0, "codec": "mp3", "sample_rate": 44_100}
    if audio:
        song["audio_id"] = audio
    with transaction(engine, workspace) as conn:
        return int(store.register_songs(conn, workspace, [song], audio_ids=True)[0]["song_id"])


def _upload(world, data: bytes, *, name: str = "Someone - Something.mp3", workspace: str = A,
            **spec) -> dict:
    """Plan, send and complete one upload; the completion's answer (or the refused plan)."""
    headers = HEADERS | {"X-Workspace-ID": workspace}
    planned = world.client.post("/api/uploads/plan", headers=headers, json={
        "files": [{"name": name, "size": len(data), **spec}]})
    assert planned.status_code == 201, planned.text
    (answer,) = planned.json()["uploads"]
    if answer["session"] is None:
        return {"plan": answer}
    session_id = answer["session"]["id"]
    (upload_id,) = [key for key, upload in world.objects.uploads.items()
                    if upload.key == f"s/{session_id}/object"]
    world.objects.upload_part(upload_id, 1, data=data)
    done = world.client.post(f"/api/uploads/{session_id}/complete", headers=headers)
    assert done.status_code == 200, done.text
    return {"plan": answer, **done.json()}


def _plan(world, data: bytes, **spec) -> dict:
    planned = world.client.post("/api/uploads/plan", headers=HEADERS, json={
        "files": [{"name": "song.mp3", "size": len(data), **spec}]})
    assert planned.status_code == 201, planned.text
    return planned.json()["uploads"][0]


def _songs(engine, workspace: str = A) -> list:
    with transaction(engine, workspace) as conn:
        return conn.execute(sa.select(local_songs).where(
            local_songs.c.workspace_id == workspace).order_by(local_songs.c.id)).all()


def _hashes(engine, workspace: str = A) -> dict[str, int]:
    with transaction(engine, workspace) as conn:
        rows = conn.execute(sa.select(local_song_hashes.c.content_sha256,
                                      local_song_hashes.c.song_id).where(
            local_song_hashes.c.workspace_id == workspace)).all()
    return {row.content_sha256: int(row.song_id) for row in rows}


def _facts(sha: str, seed: int = 1):
    facts, _sha_named, _audio_named = parse_facts(json.dumps(facts_body(seed, sha=sha)).encode())
    return facts


def _everything_of(engine) -> dict[str, list]:
    tables = {"analysis": analysis, "song_overrides": song_overrides, "drafts": drafts,
              "ratings": ratings, "seams": seams}
    with transaction(engine, A) as conn:
        return {name: [tuple(row) for row in conn.execute(sa.select(table).where(
            table.c.workspace_id == A))] for name, table in tables.items()}


# -- the same song, through the routes -----------------------------------------------------------


def test_a_device_song_uploaded_whole_keeps_its_id_and_everything_pointing_at_it(world, tmp_path):
    data = _mp3("Call on Me")
    song = _device_song(world.engine, data, audio=_audio(data, tmp_path))
    other = _device_song(world.engine, _mp3("Other", OTHER_FRAMES), title="Other")
    engine_store = EngineStore(world.engine, A)
    artifacts = LocalArtifactStore(tmp_path / "artifacts")
    facts_store.save(engine_store, artifacts, song, _facts(_sha(data)), content_sha256=_sha(data))
    facts_store.set_correction(engine_store, song, 124.0, "10A")
    stored_seams.keep(engine_store, {"status": "ready", "key": "k" * 20,
                                     "request": {"a": song, "b": other}, "style": "echo_out",
                                     "passed": True, "rating": "good", "rated_at": 1.0})
    with engine_store.write() as conn:
        StoreMixes(conn, engine_store).insert_draft("Friday", json.dumps([song, other]))
    stored_ratings.save(engine_store, song, other, "echo_out", 5, ["smooth"], seam_key="k" * 20)
    before, songs_before = _everything_of(world.engine), _songs(world.engine)

    done = _upload(world, data, song_id=song, sha256=_sha(data))

    assert done["status"] == "accepted", done
    assert done["plan"]["session"]["song_id"] == song
    assert _songs(world.engine) == songs_before  # same rows, same title, same artist
    assert _everything_of(world.engine) == before
    assert all(before.values())  # every kind of row was really there


def test_a_copy_under_a_secondary_hash_lands_on_the_same_song(world, tmp_path):
    first, second = _mp3("Call on Me"), _mp3("Call on Me (tagged)")
    audio = _audio(first, tmp_path)
    song = _device_song(world.engine, first, audio=audio)
    assert _device_song(world.engine, second, audio=audio, title="Renamed") == song
    assert _hashes(world.engine) == {_sha(second): song}

    done = _upload(world, second, sha256=_sha(second))

    assert done["status"] == "accepted"
    rows = _songs(world.engine)
    assert [row.id for row in rows] == [song]
    assert rows[0].content_sha256 == _sha(first)  # the row's own hash never changes


def test_a_retagged_copy_lands_on_the_same_song_and_its_hash_is_recorded(world, tmp_path):
    device, retagged = _mp3("Call on Me"), _mp3("Call on Me - edited tags")
    song = _device_song(world.engine, device, audio=_audio(device, tmp_path))

    done = _upload(world, retagged, name="Not - The Same Name.mp3", sha256=_sha(retagged))

    assert done["status"] == "accepted"
    (row,) = _songs(world.engine)
    assert (row.id, row.title, row.artist, row.album) == (
        song, "Call on Me", "Adekunle Gold", "Afro Pop")
    assert row.content_sha256 == _sha(device)
    assert _hashes(world.engine) == {_sha(retagged): song}


def test_a_named_retagged_copy_is_allowed_by_its_audio_id(world, tmp_path):
    device, retagged = _mp3("Call on Me"), _mp3("Call on Me - new art")
    audio = _audio(device, tmp_path)
    song = _device_song(world.engine, device, audio=audio)

    done = _upload(world, retagged, song_id=song, audio_id=audio, sha256=_sha(retagged))

    assert done["status"] == "accepted"
    assert [row.id for row in _songs(world.engine)] == [song]
    assert _hashes(world.engine) == {_sha(retagged): song}


def test_an_unsure_audio_match_becomes_a_version_never_a_separate_song(world, tmp_path):
    upload = _mp3("Call on Me - third copy")
    audio = _audio(upload, tmp_path)
    first = _device_song(world.engine, _mp3("one"))
    second = _device_song(world.engine, _mp3("two"), title="Call on Me (Live)")
    with transaction(world.engine, A) as conn:  # two songs with one audio id: unsure
        conn.execute(local_songs.update().where(local_songs.c.id.in_([first, second]))
                     .values(audio_id=audio))

    done = _upload(world, upload, name="Unrelated - Name.mp3", sha256=_sha(upload))

    assert done["status"] == "accepted"
    made = [row for row in _songs(world.engine) if row.content_sha256 == _sha(upload)]
    assert len(made) == 1
    assert (made[0].duplicate_of, made[0].title, made[0].artist) == (
        first, "Call on Me", "Adekunle Gold")


# -- refusals ------------------------------------------------------------------------------------


def test_a_file_that_isnt_the_named_song_is_refused_at_plan(world):
    song = _device_song(world.engine, _mp3("Call on Me"))
    stranger = _mp3("Something else", OTHER_FRAMES)

    answer = _upload(world, stranger, song_id=song, sha256=_sha(stranger))["plan"]

    assert answer["session"] is None
    assert answer["refusal_code"] == "song_mismatch"
    with world.engine.connect() as conn:
        assert conn.execute(sa.text("SELECT COUNT(*) FROM upload_sessions")).scalar_one() == 0
        assert quota.usage(conn, A).reserved_bytes == 0


def test_a_file_that_isnt_the_named_song_is_refused_at_acceptance(world, tmp_path):
    device = _mp3("Call on Me")
    audio = _audio(device, tmp_path)
    song = _device_song(world.engine, device, audio=audio)
    stranger = _mp3("Something else", OTHER_FRAMES)

    # the plan allows it on the audio id it was told; the bytes the server reads say otherwise
    done = _upload(world, stranger, song_id=song, audio_id=audio)

    assert done["plan"]["session"]["song_id"] == song
    assert (done["status"], done["rejection_code"]) == ("rejected", "song_mismatch")
    assert done["asset_id"] is None
    with world.engine.connect() as conn:
        assert conn.execute(sa.select(sa.func.count()).select_from(assets)).scalar() == 0
        assert quota.usage(conn, A).used_bytes == 0
    assert [row.id for row in _songs(world.engine)] == [song]
    assert _hashes(world.engine) == {}


def test_another_workspaces_song_is_never_matched(world):
    theirs = _mp3("Theirs")
    their_song = _device_song(world.engine, theirs, workspace=B)

    planned = _upload(world, theirs, song_id=their_song, sha256=_sha(theirs))["plan"]
    previewed = world.client.post("/api/uploads/preview", headers=HEADERS, json={"files": [
        {"name": "x.mp3", "size": len(theirs), "sha256": _sha(theirs), "song_id": their_song}]})

    assert planned["refusal_code"] == "song_mismatch"
    assert previewed.json()["files"][0]["reason"] == "song_mismatch"
    assert _songs(world.engine) == []
    assert [row.id for row in _songs(world.engine, B)] == [their_song]


# -- with the flag off, as before ----------------------------------------------------------------


def test_with_the_flag_off_uploads_behave_as_before(world, tmp_path):
    first, second = _mp3("Call on Me"), _mp3("Call on Me (tagged)")
    audio = _audio(first, tmp_path)
    song = _device_song(world.engine, first, audio=audio)
    _device_song(world.engine, second, audio=audio)
    stranger = _mp3("Something else", OTHER_FRAMES)

    flags.use("-storage.upload_identity")  # turned off (the build ships it on)
    assert not flags.on("storage.upload_identity")
    old = _upload(world, second, song_id=song, sha256=_sha(second))
    ignored = _upload(world, stranger, song_id=song, sha256=_sha(stranger))
    preview = world.client.post("/api/uploads/preview", headers=HEADERS, json={"files": []})

    # the named song is dropped unread and a secondary-hash copy becomes its own row
    assert "song_id" not in old["plan"]["session"]
    assert "refusal_code" not in ignored["plan"]
    assert ignored["status"] == "accepted"
    by_hash = {row.content_sha256: row for row in _songs(world.engine)}
    assert by_hash[_sha(second)].id != song
    assert by_hash[_sha(second)].title == "Something"  # from the file name, as before
    assert (preview.status_code, preview.json()["detail"]["code"]) == (403, "flag_off")

    # the same upload with the flag on lands on the song
    flags.use("+storage.upload_identity")
    with transaction(world.engine, A) as conn:
        conn.execute(local_songs.delete().where(local_songs.c.id != song))
    again = _upload(world, second, sha256=_sha(second))
    assert again["status"] == "accepted"
    assert [row.id for row in _songs(world.engine)] == [song]


# -- the duplicate check and the dry run ---------------------------------------------------------


def _asset(engine, data: bytes, *, venue: str | None = None) -> str:
    asset_id = new_id()
    with transaction(engine, A) as conn:
        conn.execute(assets.insert().values(
            id=asset_id, workspace_id=A, original_key=original_key(A, asset_id), size=len(data),
            sha256=_sha(data), format="mp3", duration_s=200.0, sample_rate=44_100, channels=2,
            created_at=db_now(conn), venue_id=venue))
    return asset_id


def test_a_song_already_uploaded_under_another_hash_is_a_duplicate(world, tmp_path):
    first, second = _mp3("Call on Me"), _mp3("Call on Me (tagged)")
    audio = _audio(first, tmp_path)
    song = _device_song(world.engine, first, audio=audio)
    _device_song(world.engine, second, audio=audio)
    stored = _asset(world.engine, second)

    by_hash = _plan(world, first, sha256=_sha(first))
    by_song = _plan(world, first, song_id=song, sha256=_sha(first))

    assert by_hash["duplicate_of"] == stored
    assert by_song["duplicate_of"] == stored


def _file(data: bytes, name: str = "song.mp3", **more) -> dict:
    return {"name": name, "size": len(data), "sha256": _sha(data), **more}


def _preview(world, *files) -> dict:
    answer = world.client.post("/api/uploads/preview", headers=HEADERS,
                               json={"files": list(files)})
    assert answer.status_code == 200, answer.text
    return answer.json()


def test_the_dry_run_answers_each_file_and_totals_and_creates_nothing(world, tmp_path,
                                                                      monkeypatch):
    monkeypatch.setattr(upload_api._LimitsAdapter, "limits",
                        lambda _self, _conn, _ws: PlanLimits(500_000_000, 3_600.0))
    first, second = _mp3("Call on Me"), _mp3("Call on Me (tagged)")
    audio = _audio(first, tmp_path)
    song = _device_song(world.engine, first, audio=audio)
    _device_song(world.engine, second, audio=audio)
    _asset(world.engine, second)
    with transaction(world.engine, A) as conn:
        quota.set_limit(conn, A, plan_for("free"), limit_bytes=1_000)
    small, long, last = b"a" * 300, b"b" * 400, b"c" * 500

    found = _preview(
        world,
        _file(first, song_id=song),                          # in the cloud library already
        _file(b"wma", "song.wma"),                           # format
        {"name": "big.mp3", "size": 500_000_001, "sha256": "d" * 64},  # too large
        _file(b"long", "long.flac", duration=3_601.0),       # too long for the plan
        _file(small, duration=200.0),                        # fits
        _file(long, "mix.wav", duration=2_000.0),            # fits, too long for server mixes
        _file(last),                                         # no room left: quota
        _file(b"after"),                                     # after the first that won't fit
    )

    assert [(f["status"], f["reason"]) for f in found["files"]] == [
        ("in_cloud_library", None), ("refused", "format"), ("refused", "too_large"),
        ("refused", "too_long"), ("ok", None), ("ok", None), ("refused", "quota"),
        ("refused", "quota"),
    ]
    assert found["files"][0]["song_id"] == song
    assert found["files"][5]["notes"] == ["long_for_server_mixes"]
    assert found["files"][4]["notes"] == []
    assert found["totals"] == {
        "files": 8, "ok": 2, "in_cloud_library": 1, "refused": 5,
        "bytes_needed": 300 + 400 + 500 + len(b"after"), "bytes_left": 1_000, "fit": 2,
        "measure_days": 1,
    }
    with world.engine.connect() as conn:
        assert conn.execute(sa.text("SELECT COUNT(*) FROM upload_sessions")).scalar_one() == 0
        assert quota.usage(conn, A).reserved_bytes == 0


def test_the_dry_run_counts_days_under_the_daily_analysis_cap(world, monkeypatch):
    monkeypatch.setattr(hosted_caps, "left",
                        lambda _conn, _ws, _kind: SimpleNamespace(limit=2.0, remaining=1.0))
    files = [_file(bytes([n]) * 10, f"{n}.mp3") for n in range(5)]
    assert _preview(world, *files)["totals"]["measure_days"] == 3  # 1 today, then 2 a day
    assert _preview(world, files[0])["totals"]["measure_days"] == 1
    assert _preview(world)["totals"]["measure_days"] == 0
    flags.use("+storage.upload_identity -cloud.hosted_caps")
    assert _preview(world, *files)["totals"]["measure_days"] is None


def test_a_venue_upload_is_never_the_songs_cloud_copy(world):
    data = _mp3("Call on Me")
    song = _device_song(world.engine, data)
    _asset(world.engine, data, venue=new_id())
    (answer,) = _preview(world, _file(data, song_id=song))["files"]
    assert answer["status"] == "ok"


# -- the cloud's measurements replace the device's -----------------------------------------------


def _worker_analysis(path) -> None:
    """An analysis file as the hosted worker writes it (`engine_handlers.analyse`)."""
    arrays, sections = arrays_for(1, 128.0, 200.0)
    summary = {**scalars(1, 128.0), "sections": sections, "duration": 200.0}
    summary["constant_tempo"] = int(summary.pop("constant_tempo"))
    summary.pop("key_agrees_chroma")
    np.savez_compressed(
        path, beats=arrays["beats"], bar_starts=arrays["bar_starts"],
        raw_beats=arrays["beats"].astype(np.float32),
        raw_downbeats=arrays["beats"][::4].astype(np.float32),
        peaks=np.zeros(64, dtype=np.uint8), summary=np.array(json.dumps(summary)),
        **{name: arrays[name].astype(np.float16) for name in
           ("chroma_bars", "mfcc_bars", "energy_bars", "rms_db_bars", "low_share_bars")},
    )


def test_the_workers_facts_replace_the_devices_and_corrections_still_win(world, tmp_path):
    first, second = _mp3("Call on Me"), _mp3("Call on Me (tagged)")
    audio = _audio(first, tmp_path)
    song = _device_song(world.engine, first, audio=audio)
    _device_song(world.engine, second, audio=audio)
    engine_store = EngineStore(world.engine, A)
    artifacts = LocalArtifactStore(tmp_path / "artifacts")
    facts_store.save(engine_store, artifacts, song, _facts(_sha(first)),
                     content_sha256=_sha(first))
    facts_store.set_correction(engine_store, song, 124.0, None)
    analysed = tmp_path / "analysis.npz"
    _worker_analysis(analysed)

    def read_object(_key, destination):
        shutil.copyfile(analysed, destination)
        return destination

    flags.use("+storage.upload_identity -cloud.brain")
    assert hosted_facts.keep(world.engine, A, [(_sha(second), "k", None)], read_object,
                             artifacts) == 0  # cloud.brain off: nothing read
    flags.use("-storage.upload_identity")  # off: a song under a secondary hash is not picked up
    assert hosted_facts.unmeasured(engine_store, [_sha(second)]) == {}
    flags.use("+storage.upload_identity")
    assert hosted_facts.unmeasured(engine_store, [_sha(second), _sha(first)]) == {
        _sha(second): song, _sha(first): song}

    kept = hosted_facts.keep(world.engine, A, [(_sha(second), "k", None), (_sha(first), "k", None)],
                             read_object, artifacts)

    assert kept == 1  # one song, read once
    (row,) = facts_store.measured(engine_store)["songs"]
    assert (row["source"], row["bpm"], row["override_bpm"]) == ("worker", 128.0, 124.0)
    assert stored_songs.load_song(engine_store, artifacts, song).bpm == 124.0
    assert hosted_facts.unmeasured(engine_store, [_sha(second), _sha(first)]) == {}
