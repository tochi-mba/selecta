"""Every hosted job type, from producer to verified artifact, through the real worker gateway.

On staging a remote worker analysed a song and then had its upload refused with
`invalid_output_slots`: the job declared no output namespace. No local run caught it, because the
dev worker publishes straight to disk and never asks the gateway. Here the real pieces meet:

- jobs made by the real producers (`hosted_render.prepare_songs`, `mix_state`,
  `hosted_export.request_export`);
- the real gateway app (`gateway_cloud.create_gateway_app`: `work.gateway_api` with
  `work.cloud_ports` signing inputs and output slots and re-hashing every output);
- the real remote worker client (`workers.remote.RemoteWorkerClient`) under the real runner.

Only object storage is fake, at its HTTP edge: signed URLs point at `objects.test`, answered by
an in-memory store that the gateway's verifier reads too. The handlers' audio work is stubbed
(no engine run here, by the owner's rule): each stub fetches its inputs through the job context,
checks them against their SHA-256 and publishes under the hash the real handler uses
(`tests/test_hosted_render_outputs.py` pins those hashes to the worker's). The playback and
transition stubs write tiny real FLAC files, so `export.render` is the real handler
(`workers.export_join`): it fetches every part of the timeline through its signed link, checks
it, joins it and uploads the result through the gateway's slot.
"""

from __future__ import annotations

import hashlib
import json
from types import SimpleNamespace

import httpx
import numpy as np
import pytest
import soundfile as sf
import sqlalchemy as sa
from cloud_helpers import grant_hosted_media
from fastapi.testclient import TestClient

from selecta import hosted_export, hosted_render
from selecta.admin.state import DbWorkControls
from selecta.business.weight import business_policy
from selecta.config import ANALYSIS_VERSION
from selecta.identity.schema import users, workspaces
from selecta.persistence import db_now, make_engine, migrate, new_id, transaction
from selecta.scheduling.policy import WorkerCaps
from selecta.seam_kinds import RENDER_VERSION
from selecta.storage import api as storage_api
from selecta.storage.artifacts import Buckets
from selecta.storage.keys import original_key
from selecta.storage.objects import ObjectHead, R2Error
from selecta.storage.schema import assets
from selecta.work.cloud_ports import CloudJobEntitlements
from selecta.work.enqueue import JobSpec
from selecta.work.provenance import build as build_provenance
from selecta.work.schema import artifacts, job_attempts, jobs
from selecta.work.store import JobStore
from selecta.workers import engine_handlers, remote
from selecta.workers.audio_handlers import PROXY_VERSION
from selecta.workers.context import InputInvalid
from selecta.workers.export_join import render_export
from selecta.workers.remote import RemoteWorkerClient
from selecta.workers.runner import WorkerRunner

TOKEN_SECRET = "contract-test-worker-token-secret-32-bytes"
BOOTSTRAP = "contract-test-worker-bootstrap-token-32-bytes"
STORAGE = "objects.test"


class Storage:
    """R2 as both sides see it: the API's client (presign, head, get) and the signed-URL HTTP
    edge a worker talks to."""

    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}
        self.puts: list[str] = []

    # the R2 client the gateway and producers use
    def presign_get(self, bucket, key, _ttl, *_rest, **_kw):
        return f"https://{STORAGE}/{bucket}/{key}?signature=get"

    def presign_put(self, bucket, key, _ttl, *_rest, **_kw):
        return f"https://{STORAGE}/{bucket}/{key}?signature=put"

    def head_object(self, _bucket, key):
        if key not in self.objects:
            raise R2Error("missing", status=404)
        return ObjectHead(key, len(self.objects[key]), "etag")

    def get_object(self, _bucket, key, dest):
        dest.write_bytes(self.objects[key])
        return dest

    def close(self) -> None:
        pass

    # the HTTP edge
    def handle(self, request: httpx.Request) -> httpx.Response:
        assert request.url.host == STORAGE and "signature=" in str(request.url)
        _bucket, _, key = request.url.path.lstrip("/").partition("/")
        if request.method == "GET":
            assert "signature=get" in str(request.url)
            if key not in self.objects:
                return httpx.Response(404)
            return httpx.Response(200, content=self.objects[key])
        if request.method == "PUT":
            assert "signature=put" in str(request.url)
            self.objects[key] = request.read()
            self.puts.append(key)
            return httpx.Response(200)
        return httpx.Response(405)


@pytest.fixture
def world(tmp_path, monkeypatch):
    storage = Storage()
    monkeypatch.setattr(storage_api, "_r2_client", lambda: storage)
    monkeypatch.setattr(storage_api, "_buckets", lambda: Buckets())
    real_client = httpx.Client

    def client(*args, **kwargs):
        # only the worker's storage requests go out without a transport of their own
        kwargs["transport"] = kwargs.get("transport") or httpx.MockTransport(storage.handle)
        return real_client(*args, **kwargs)

    monkeypatch.setattr(remote.httpx, "Client", client)
    for name, value in {
        "SELECTA_GATEWAY_DATABASE_URL": "postgresql://unused/the-engine-is-passed-in",
        "SELECTA_GATEWAY_ALLOWED_HOSTS": "localhost",
        "SELECTA_WORKER_TOKEN_SECRET": TOKEN_SECRET,
        "SELECTA_WORKER_BOOTSTRAP_TOKEN": BOOTSTRAP,
    }.items():
        monkeypatch.setenv(name, value)

    engine = make_engine(f"sqlite:///{tmp_path / 'contract.sqlite'}")
    migrate.upgrade(engine)
    workspace, user = new_id(), new_id()
    with transaction(engine) as conn:
        conn.execute(users.insert().values(
            id=user, auth_subject=f"auth|{user}", email_verified=True, timezone="UTC",
            age_confirmed=True, created_at=0.0))
        conn.execute(workspaces.insert().values(
            id=workspace, name="Mine", kind="personal", owner_user_id=user, created_at=0.0))
    grant_hosted_media(engine)
    songs = [_song(engine, storage, workspace, f"song {n}".encode() * 50) for n in range(3)]

    from selecta.gateway_cloud import create_gateway_app

    app = create_gateway_app(engine=engine)
    with TestClient(app, base_url="http://localhost") as gateway:
        work = hosted_render.Work(JobStore(
            engine, business_policy(), entitlements=CloudJobEntitlements(engine),
            controls=DbWorkControls()))
        def forward(request: httpx.Request) -> httpx.Response:
            answer = gateway.request(
                request.method, request.url.path, content=request.content,
                headers={k: v for k, v in request.headers.items() if k.lower() != "host"})
            return httpx.Response(answer.status_code, headers=answer.headers,
                                  content=answer.content, request=request)

        yield SimpleNamespace(engine=engine, storage=storage, workspace=workspace, songs=songs,
                              work=work, transport=httpx.MockTransport(forward), tmp=tmp_path)
    engine.dispose()


def _song(engine, storage: Storage, workspace: str, body: bytes) -> dict:
    asset_id = new_id()
    key = original_key(workspace, asset_id)
    storage.objects[key] = body
    sha = hashlib.sha256(body).hexdigest()
    with transaction(engine, workspace) as conn:
        conn.execute(assets.insert().values(
            id=asset_id, workspace_id=workspace, original_key=key, size=len(body), sha256=sha,
            format="mp3", duration_s=180.0, sample_rate=44_100, channels=2,
            created_at=db_now(conn)))
    return {"id": asset_id, "sha256": sha, "key": key}


# --- the handlers, with their audio work stubbed ----------------------------------------------


def _checked(ctx, side: dict, name: str):
    path = engine_handlers._fetch(ctx, side.get("source_key"), name, f"{name}.original")
    if hashlib.sha256(path.read_bytes()).hexdigest() != side["source_sha256"]:
        raise InputInvalid("A source checksum does not match the job.")
    return side["source_sha256"]


def _write(ctx, name: str, payload: dict):
    path = ctx.scratch / name
    path.write_bytes(json.dumps(payload, sort_keys=True).encode())
    return path


def _flac(ctx, name: str, payload: dict, seconds: float = 0.5):
    """A tiny real 24-bit FLAC whose samples follow from the payload (distinct per input)."""
    seed = int(hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()[:8], 16)
    steps = np.random.default_rng(seed).integers(-(1 << 20), 1 << 20, (int(44_100 * seconds), 2))
    path = ctx.scratch / name
    sf.write(str(path), steps.astype(np.int32) << 8, 44_100, subtype="PCM_24", format="FLAC")
    return path


def analyse(job, ctx):
    sha = _checked(ctx, job.input_ref, "source")
    input_hash = engine_handlers._hash({"source_sha256": sha, "analysis": ANALYSIS_VERSION})
    made = ctx.publish("analysis", input_hash, _write(ctx, "analysis.npz", {"sha": sha}),
                       "analysis.npz", provenance=build_provenance(
                           inputs={"source": sha}, versions={"analysis": ANALYSIS_VERSION},
                           models={"beats": "small0"}))
    return {"input_hash": input_hash, "keys": made.keys, "bpm": 120.0, "camelot": "8A",
            "lufs": -8.0, "peak_db": -1.0, "checksum": made.checksum}


def seam(job, ctx):
    ref = job.input_ref
    hashes = {}
    for name in ("a", "b"):
        hashes[name] = _checked(ctx, ref[name], name)
        engine_handlers._fetch(ctx, ref[name]["analysis_key"], f"{name}_analysis", f"{name}.npz")
    input_hash = engine_handlers._hash(
        {**hashes, "style": ref.get("style"), "analysis": ANALYSIS_VERSION,
         "render": RENDER_VERSION})
    cues = {"a_source_start": 150.0, "b_source_end": 20.0, "seconds": 16.0}
    made = ctx.publish("seam", input_hash, _flac(ctx, "seam.flac", hashes), "seam.flac",
                       provenance=build_provenance(
                           inputs=hashes,
                           versions={"analysis": ANALYSIS_VERSION, "render": RENDER_VERSION},
                           settings={"style": ref.get("style") or "auto", "cues": cues}))
    return {"input_hash": input_hash, "keys": made.keys, "move": "cut_on_one",
            "audit_passed": True, "fell_back": False, "checks": []}


def proxy(job, ctx):
    ref = job.input_ref
    source = ctx.download_input(0, ctx.scratch / "original.audio")
    if hashlib.sha256(source.read_bytes()).hexdigest() != ref["source_sha256"]:
        raise InputInvalid("Playback source checksum does not match the job.")
    hashed = {"source_sha256": ref["source_sha256"], "sample_rate": ref["sample_rate"],
              "proxy_version": PROXY_VERSION, "codec": "flac", "bits": 24}
    input_hash = hashlib.sha256(json.dumps(hashed, sort_keys=True).encode()).hexdigest()
    made = ctx.publish_artifact("playback", input_hash, _flac(ctx, "playback.flac", hashed),
                                "playback.flac", provenance=build_provenance(
                                    inputs={"source": ref["source_sha256"]},
                                    versions={"proxy": PROXY_VERSION},
                                    settings={"sample_rate": ref["sample_rate"],
                                              "codec": "flac", "bits": 24}))
    return {"input_hash": input_hash, "keys": made.keys, "sample_rate": ref["sample_rate"],
            "size_bytes": made.size_bytes, "checksum": made.checksum}


HANDLERS = {"analyse.song": analyse, "seam.render": seam, "play.proxy": proxy,
            "export.render": render_export}
POOL_TYPES = {"cpu-heavy": {"analyse.song", "seam.render"}, "cpu-light": {"play.proxy"},
              "export": {"export.render"}}


def drain(world, pool: str) -> list:
    """Enrol a remote worker for the pool through the gateway and run until nothing is left."""
    caps = WorkerCaps(pool=pool, slots=1, job_types=frozenset(POOL_TYPES[pool]),
                      engine_version=1, scratch_mb=512)
    client = RemoteWorkerClient.register(
        "http://localhost", caps, bootstrap_token=BOOTSTRAP, api_transport=world.transport,
        storage_hosts=(STORAGE,))
    runner = WorkerRunner(client, client.caps,
                          {name: HANDLERS[name] for name in POOL_TYPES[pool]},
                          scratch_root=world.tmp, heartbeat_s=5.0)
    results = []
    try:
        for _ in range(20):
            result = runner.run_once()
            if result is None:
                break
            results.append(result)
    finally:
        client.close()
    return results


def states(world, kind: str) -> list[str]:
    with world.engine.connect() as conn:
        return sorted(conn.execute(sa.select(jobs.c.state).where(jobs.c.type == kind)).scalars())


def test_every_hosted_job_type_completes_through_the_real_gateway_and_worker_client(world):
    two = world.songs[:2]
    ids = [song["id"] for song in two]
    made = hosted_render.prepare_songs(world.engine, world.work, world.workspace, ids)
    assert made["queued"] == 2
    assert len(drain(world, "cpu-heavy")) == 2
    assert states(world, "analyse.song") == ["succeeded", "succeeded"]

    order = [{"asset_id": ids[0], "move": None}, {"asset_id": ids[1], "move": "cut_on_one"}]
    mix = hosted_render.mix_state(world.engine, world.work, world.workspace, order,
                                  client=world.storage, buckets=Buckets())
    assert mix["seams"][0]["state"] == "queued"
    assert len(drain(world, "cpu-light")) == 2
    assert len(drain(world, "cpu-heavy")) == 1
    assert states(world, "play.proxy") == ["succeeded", "succeeded"]
    assert states(world, "seam.render") == ["succeeded"]
    mix = hosted_render.mix_state(world.engine, world.work, world.workspace, order,
                                  client=world.storage, buckets=Buckets())
    assert mix["complete"] is True
    assert [part["kind"] for part in mix["parts"]] == ["song", "seam", "song"]

    asked = hosted_export.request_export(world.engine, world.work, world.workspace, order,
                                         client=world.storage, buckets=Buckets())
    assert asked["state"] == "queued" and asked["parts_total"] == 4
    # the export names the timeline the player plays: its files, cuts and levels
    with world.engine.connect() as conn:
        job = conn.execute(sa.select(jobs).where(jobs.c.type == "export.render")).mappings().one()
    timeline = job["input_ref"]["timeline"]
    played = [part for part in mix["parts"] if part["seconds"] > 0]
    assert [(p["kind"], p["from_s"], p["seconds"]) for p in timeline] == [
        (p["kind"], p["from_s"], p["seconds"]) for p in played]
    assert [p["gain_db"] for p in timeline if p["kind"] == "song"] == [
        p["gain_db"] for p in played if p["kind"] == "song"]
    assert job["input_ref"]["objects"] == [p["key"] for p in timeline]
    assert job["idempotency_key"] == f"hosted-export:{job['input_ref']['output']['input_hash']}"
    again = hosted_export.request_export(world.engine, world.work, world.workspace, order,
                                         client=world.storage, buckets=Buckets())
    assert again["job_id"] == asked["job_id"]  # asking twice makes one job
    assert len(drain(world, "export")) == 1
    done = hosted_export.export_status(world.engine, world.workspace, asked["job_id"],
                                       client=world.storage, buckets=Buckets())
    assert done["state"] == "ready" and done["url"].startswith(f"https://{STORAGE}/")
    with world.engine.connect() as conn:
        result = conn.execute(sa.select(jobs.c.result).where(jobs.c.id == asked["job_id"])).one()
    assert result.result["parts"] == 3 and result.result["songs"] == 2
    # asked again once made: the stored file is handed over, nothing is rendered again
    once_more = hosted_export.request_export(world.engine, world.work, world.workspace, order,
                                             client=world.storage, buckets=Buckets())
    assert once_more["state"] == "ready" and once_more["job_id"] == asked["job_id"]

    with world.engine.connect() as conn:
        kinds = sorted(conn.execute(sa.select(artifacts.c.kind)).scalars())
    assert kinds == ["analysis", "analysis", "export", "playback", "playback", "seam"]
    # every upload went through a gateway-signed slot under the attempt's own prefix
    assert len(world.storage.puts) == 6
    assert all(f"w/{world.workspace}/" in key and "/attempts/" in key
               for key in world.storage.puts)


def test_a_job_with_no_declared_output_fails_as_it_did_on_staging_and_prepare_replaces_it(world):
    song = world.songs[2]
    spec = hosted_render._analysis_spec(world.workspace, song, None)
    broken = {key: value for key, value in spec.input_ref.items() if key != "output"}
    world.work.store.enqueue(JobSpec(**{**spec.__dict__, "input_ref": broken}))
    drain(world, "cpu-heavy")
    with world.engine.connect() as conn:
        detail = " ".join(filter(None, conn.execute(
            sa.select(job_attempts.c.error_detail)).scalars()))
        old = conn.execute(sa.select(jobs.c.id, jobs.c.state)).one()
    assert "invalid_output_slots" in detail
    assert old.state != "succeeded"

    made = hosted_render.prepare_songs(world.engine, world.work, world.workspace, [song["id"]])
    assert made["replaced"] == 1
    drain(world, "cpu-heavy")
    status = hosted_render.song_status(world.engine, world.workspace, song["id"])
    assert status["status"]["state"] == "done"
    with world.engine.connect() as conn:
        rows = conn.execute(sa.select(jobs.c.id, jobs.c.state)
                            .order_by(jobs.c.created_at, jobs.c.id)).all()
    assert [row.state for row in rows if row.id != old.id] == ["succeeded"]
    assert [row.state for row in rows if row.id == old.id] in (["cancelled"], ["failed"])


def test_the_dev_worker_keeps_the_gateways_output_rule(tmp_path):
    """`dev.cmd cloud` publishes to disk, not through the gateway; it now refuses the same
    uploads the gateway would, so a job without a declared output fails locally too."""
    from selecta.devstack.worker import ContractBroken, LocalCloudStore

    stored: list[str] = []

    def keep(key, path):
        stored.append(key)
        return path.stat().st_size, hashlib.sha256(path.read_bytes()).hexdigest()

    store = object.__new__(LocalCloudStore)
    store.artifacts = SimpleNamespace(publish=keep)
    source = tmp_path / "analysis.npz"
    source.write_bytes(b"x")
    workspace, digest, attempt = new_id(), "a" * 64, new_id()

    def context(input_ref):
        return SimpleNamespace(attempt_id=attempt, job=SimpleNamespace(
            workspace_id=workspace, input_ref=input_ref))

    with pytest.raises(ContractBroken, match="invalid_output_slots"):
        store.publish_artifact(context({}), "analysis", digest, source, "analysis.npz")
    with pytest.raises(ContractBroken):
        store.publish_artifact(context({"output": {"kind": "analysis", "input_hash": "b" * 64}}),
                               "analysis", digest, source, "analysis.npz")
    assert stored == []
    made = store.publish_artifact(
        context({"output": {"kind": "analysis", "input_hash": digest}}), "analysis", digest,
        source, "analysis.npz")
    assert stored == made.keys
