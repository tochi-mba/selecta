"""Playback files are made only for songs about to be heard (SC-0399-01, ADR-0399).

Songs entering a mix, a preview or a request get a `play.proxy` job in that work's lane and
urgency, once each; a song already lossless at the analysis rate gets none; and a finished
playback file is an ordinary derived artifact, evicted under the budget unless the playing
revision uses it, and made again the next time it's needed. SQLite and PostgreSQL.
"""

from __future__ import annotations

import pytest
import sqlalchemy as sa
from test_cloud_jobs_support import count_jobs, make_store, worker

from selecta.persistence import transaction
from selecta.playback.schema import playback_sessions
from selecta.storage import eviction
from selecta.storage.artifacts import LocalArtifactStore, StoredOutputs
from selecta.storage.schema import assets
from selecta.work import proxies
from selecta.work.enqueue import JobSpec
from selecta.work.schema import jobs
from selecta.workers.runner import WorkerRunner

WS = "ws-a"


def add_asset(engine, asset_id, *, fmt="mp3", rate=48_000, channels=2, sha=None):
    with transaction(engine, WS) as connection:
        connection.execute(sa.insert(assets).values(
            id=asset_id, workspace_id=WS, original_key=f"w/{WS}/a/{asset_id}", size=1_000,
            sha256=sha or (asset_id[-1] * 64 if asset_id[-1] in "0123456789abcdef" else "e" * 64),
            format=fmt, sample_rate=rate, channels=channels, created_at=1.0,
        ))


@pytest.fixture
def store(cloud_engine):
    for name, fmt, rate in (("song-1", "mp3", 48_000), ("song-2", "aac", 44_100),
                            ("song-3", "flac", 44_100)):
        add_asset(cloud_engine, name, fmt=fmt, rate=rate)
    return make_store(cloud_engine)


def proxy_rows(store):
    with transaction(store.engine) as connection:
        return connection.execute(
            sa.select(jobs).where(jobs.c.type == "play.proxy").order_by(jobs.c.created_at)
        ).all()


def test_nothing_is_made_at_upload_only_when_songs_are_needed(store):
    assert count_jobs(store, type="play.proxy") == 0
    made = proxies.prepare(store, WS, ["song-1", "song-2", "song-3"], need="preview")
    assert [p.status for p in made] == ["queued", "queued", "direct"]
    assert count_jobs(store, type="play.proxy") == 2, "a 44.1 kHz stereo FLAC plays as it is"


def test_a_preview_or_request_job_gets_the_lane_and_urgency_it_is_given(store):
    proxies.prepare(store, WS, ["song-1"], need="preview", lane="interactive", urgency=0)
    proxies.prepare(store, WS, ["song-2"], need="request", lane="standard", urgency=3)
    rows = {row.input_ref["objects"][0]: row for row in proxy_rows(store)}
    assert (rows[f"w/{WS}/a/song-1"].lane, rows[f"w/{WS}/a/song-1"].urgency) == ("interactive", 0)
    assert (rows[f"w/{WS}/a/song-2"].lane, rows[f"w/{WS}/a/song-2"].urgency) == ("standard", 3)


def test_a_song_entering_a_mix_inherits_the_mixs_lane_and_the_mix_waits_for_it(store):
    mix = store.enqueue(JobSpec(WS, "seam.render", lane="interactive", urgency=1)).job

    made = proxies.prepare(store, WS, ["song-1"], need="mix", for_job=mix.id)

    proxy = store.job(made[0].job_id)
    assert (proxy.lane, proxy.urgency) == ("interactive", 1)
    assert store.job(mix.id).state == "waiting_deps"


def test_asking_twice_makes_one_job_raised_to_the_more_urgent_need(store):
    first = proxies.prepare(store, WS, ["song-1"], need="request", lane="speculative")
    again = proxies.prepare(store, WS, ["song-1"], need="preview", lane="interactive", urgency=0)
    assert first[0].job_id == again[0].job_id
    assert count_jobs(store, type="play.proxy") == 1
    proxy = store.job(first[0].job_id)
    assert (proxy.lane, proxy.urgency) == ("interactive", 0)
    proxies.prepare(store, WS, ["song-1"], need="request", lane="speculative")
    assert store.job(first[0].job_id).lane == "interactive", "a later, calmer need never lowers it"


def test_the_producer_and_the_worker_agree_on_the_files_identity():
    provenance, digest = proxies.identity("a" * 64, 48_000)
    from selecta.workers import audio_handlers

    assert provenance["proxy_version"] == audio_handlers.PROXY_VERSION
    assert len(digest) == 64


def test_bad_requests_are_refused(store):
    with pytest.raises(ValueError):
        proxies.prepare(store, WS, ["song-1"], need="upload")
    with pytest.raises(proxies.ProxyRefused):
        proxies.prepare(store, WS, ["no-such-song"], need="preview")
    other = store.enqueue(JobSpec("ws-other", "seam.render")).job
    with pytest.raises(proxies.ProxyRefused):
        proxies.prepare(store, WS, ["song-1"], need="mix", for_job=other.id)


def test_a_made_playback_file_is_reused_evicted_under_budget_and_made_again(cloud_engine, tmp_path):
    add_asset(cloud_engine, "song-1")
    files = LocalArtifactStore(tmp_path / "derived")
    store = make_store(cloud_engine, verifier=StoredOutputs(files))

    def proxy(current, ctx):
        made = ctx.scratch / "playback.flac"
        made.write_bytes(b"f" * 5_000)
        output = current.input_ref["output"]
        ctx.publish("playback", output["input_hash"], made, "playback.flac")
        return {}

    runner = WorkerRunner(store, worker("cpu-light"), {"play.proxy": proxy}, heartbeat_s=0.05,
                          idle_s=0.01, artifact_store=files)
    proxies.prepare(store, WS, ["song-1"], need="preview")
    assert runner.run_once().outcome == "succeeded"

    ready = proxies.prepare(store, WS, ["song-1"], need="mix", lane="standard")
    assert ready[0].status == "ready" and files.exists(ready[0].keys[0])
    assert count_jobs(store, type="play.proxy") == 1

    playing = store.find_artifact(WS, "playback", ready[0].input_hash, touch=False)
    with transaction(cloud_engine, WS) as connection:
        eviction.pin(connection, WS, "rev-1", [playing.id])
        connection.execute(playback_sessions.insert().values(
            workspace_id=WS, mix_revision_id="rev-1", state="playing", song_index=0,
            offset_ms=0, seq=0, updated_at=1.0,
        ))
    assert eviction.evict(cloud_engine, WS, files, budget_bytes=0).removed == ()

    with transaction(cloud_engine, WS) as connection:
        connection.execute(playback_sessions.update().values(state="stopped"))
    assert eviction.evict(cloud_engine, WS, files, budget_bytes=0).removed == (playing.id,)
    assert not files.exists(ready[0].keys[0])

    again = proxies.prepare(store, WS, ["song-1"], need="preview")
    assert again[0].status == "queued"
    assert count_jobs(store, type="play.proxy") == 2
