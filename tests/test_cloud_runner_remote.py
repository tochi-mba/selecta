"""A remote worker: the runner over HTTP through the worker gateway (§4A.6, SC-0396).

The worker side (`RemoteWorkerClient`) talks to the real gateway routes through an
`httpx.MockTransport` bridge, so nothing leaves the process. Storage is a fake transport too.
"""

from __future__ import annotations

import hashlib
import threading
from pathlib import Path
from types import SimpleNamespace

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from test_cloud_jobs_support import Outputs, make_store
from test_cloud_runner import WAIT, until_stopped

from selecta.scheduling.policy import WorkerCaps
from selecta.work.enqueue import JobSpec
from selecta.work.errors import CompletionRejected, JobCancelled, StaleLease
from selecta.work.gateway_api import install_routes
from selecta.work.model import JobState
from selecta.work.ports import ArtifactOutput
from selecta.workers import remote
from selecta.workers.context import InputInvalid, TransientError
from selecta.workers.remote import RemoteGatewayError, RemoteWorkerClient
from selecta.workers.runner import WorkerRunner

TOKEN_SECRET = "remote-worker-token-secret-long-enough-for-hs256"
BOOTSTRAP = "remote-worker-bootstrap-secret-long-enough-too"
STORAGE = "https://bucket.account.r2.cloudflarestorage.com"
HASH = "c" * 64


def bridge(app: FastAPI) -> httpx.MockTransport:
    client = TestClient(app)

    def forward(request: httpx.Request) -> httpx.Response:
        answer = client.request(
            request.method, request.url.path, content=request.content,
            headers={k: v for k, v in request.headers.items() if k.lower() != "host"},
        )
        return httpx.Response(answer.status_code, headers=answer.headers,
                              content=answer.content, request=request)

    return httpx.MockTransport(forward)


def output_key(job, attempt_id: str, name: str) -> str:
    return f"w/{job.workspace_id}/analysis/{HASH}/attempts/{attempt_id}/{name}"


@pytest.fixture
def gateway(cloud_engine):
    outputs = Outputs()
    store = make_store(cloud_engine, verifier=outputs)
    app = FastAPI()
    install_routes(
        app, store=store, token_secret=TOKEN_SECRET, bootstrap_token=BOOTSTRAP,
        allowed_pools=frozenset({"cpu-heavy", "cpu-light"}),
        sign_inputs=lambda job: [{"name": "song.flac", "key": "w/x/song.flac",
                                  "url": f"{STORAGE}/song.flac?sig=1"}],
        output_prefix_for=lambda job, attempt_id: f"prefix/{attempt_id}/",
        sign_outputs=lambda attempt, names: [
            {"key": output_key(store.job(attempt.job_id), attempt.id, name),
             "url": f"{STORAGE}/{name}?sig=2", "headers": {"x-amz-acl": "private",
                                                           "Authorization": "no"}}
            for name in names
        ],
    )
    return SimpleNamespace(store=store, app=app, transport=bridge(app), outputs=outputs)


def enroll(gateway, pool: str = "cpu-heavy", clock=None, **values) -> RemoteWorkerClient:
    caps = WorkerCaps(pool=pool, slots=2, job_types=values.pop("job_types", None))
    options = {"clock": clock} if clock is not None else {}
    return RemoteWorkerClient.register(
        "https://gateway.test", caps, bootstrap_token=BOOTSTRAP, api_transport=gateway.transport,
        heartbeat_s=0.01, **options, **values,
    )


def storage(monkeypatch, handler) -> list[httpx.Request]:
    """Route the worker's storage requests (not its gateway ones) to `handler`."""
    seen: list[httpx.Request] = []

    def record(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return handler(request)

    real = httpx.Client
    transport = httpx.MockTransport(record)
    monkeypatch.setattr(remote.httpx, "Client", lambda **kwargs: real(transport=transport,
                                                                      **kwargs))
    return seen


# --- The whole loop through the gateway ---------------------------------------------------------


def test_a_remote_worker_claims_runs_and_completes_through_the_gateway(gateway, monkeypatch):
    job = gateway.store.enqueue(JobSpec("w1", "analyse.song", input_ref={"song": "s1"})).job
    client = enroll(gateway)
    audio = b"RIFF-audio-bytes"
    storage(monkeypatch, lambda request: httpx.Response(200, content=audio)
            if request.method == "GET" else httpx.Response(200))

    def analyse(current, ctx):
        assert ctx.output_prefix.startswith("prefix/")
        path = ctx.download_input("song.flac")
        assert path.read_bytes() == audio
        ctx.progress(1, 2)
        made = ctx.scratch / "features.npz"
        made.write_bytes(b"features")
        ctx.publish_artifact("analysis", HASH, made, "features.npz")
        return {"bpm": 120}

    result = WorkerRunner(client, client.caps, {"analyse.song": analyse},
                          heartbeat_s=0.01).run_once()

    assert (result.outcome, result.state) == ("succeeded", "succeeded")
    done = gateway.store.job(job.id)
    assert (done.state, done.result) == (JobState.SUCCEEDED, {"bpm": 120})
    found = gateway.store.find_artifact("w1", "analysis", HASH)
    assert found.checksum == hashlib.sha256(b"features").hexdigest()
    assert found.size_bytes == len(b"features")
    assert client.job(job.id).state == JobState.SUCCEEDED
    assert client.claim("cpu-heavy", client.caps) is None
    client.close()


def test_a_cancel_reaches_a_remote_worker_through_its_heartbeat(gateway):
    job = gateway.store.enqueue(JobSpec("w1", "analyse.song")).job
    client = enroll(gateway)
    started = threading.Event()

    def analyse(current, ctx):
        started.set()
        until_stopped(ctx)

    cancel = threading.Thread(
        target=lambda: started.wait(WAIT) and gateway.store.cancel("w1", job.id)
    )
    cancel.start()
    result = WorkerRunner(client, client.caps, {"analyse.song": analyse},
                          heartbeat_s=0.01).run_once()
    cancel.join()
    assert (result.outcome, result.state) == ("cancelled", "cancelled")
    assert gateway.store.job(job.id).state == JobState.CANCELLED


def test_a_remote_failure_is_recorded_with_its_class(gateway):
    job = gateway.store.enqueue(JobSpec("w1", "analyse.song")).job
    client = enroll(gateway)

    def analyse(current, ctx):
        raise InputInvalid("That isn't audio.")

    result = WorkerRunner(client, client.caps, {"analyse.song": analyse},
                          heartbeat_s=60.0).run_once()
    assert result.outcome == "failed"
    failed = gateway.store.job(job.id)
    assert (failed.state, failed.error_class, failed.error_detail) == (
        JobState.FAILED, "input_invalid", "That isn't audio."
    )


def test_a_remote_completion_of_a_cancelled_job_is_refused_and_remembered(gateway):
    job = gateway.store.enqueue(JobSpec("w1", "analyse.song")).job
    client = enroll(gateway)
    claim = client.claim("cpu-heavy", client.caps)
    gateway.store.cancel("w1", job.id)
    with pytest.raises(JobCancelled):
        client.complete(claim.attempt_id, claim.fencing_token, result={"bpm": 1})
    assert client.job(job.id).state == JobState.CANCELLED


def test_a_rejected_remote_completion_reports_the_class_and_the_new_state(gateway):
    job = gateway.store.enqueue(JobSpec("w1", "analyse.song")).job
    gateway.outputs.refused.add(HASH)
    client = enroll(gateway)
    claim = client.claim("cpu-heavy", client.caps)
    produced = ArtifactOutput("analysis", HASH, [output_key(job, claim.attempt_id, "f.npz")],
                              checksum="d" * 64, size_bytes=1)
    with pytest.raises(CompletionRejected) as rejected:
        client.complete(claim.attempt_id, claim.fencing_token, artifacts=(produced,))
    assert rejected.value.error_class == "transient"
    assert rejected.value.state == "retry_scheduled"
    assert client.job(job.id).state == "retry_scheduled"


def test_release_and_stale_attempts_through_the_gateway(gateway):
    job = gateway.store.enqueue(JobSpec("w1", "analyse.song")).job
    client = enroll(gateway)
    claim = client.claim("cpu-heavy", client.caps)
    assert client.start(claim.attempt_id, claim.fencing_token).id == job.id
    assert client.release(claim.attempt_id, claim.fencing_token).state == JobState.QUEUED
    with pytest.raises(StaleLease):
        client.fail(claim.attempt_id, claim.fencing_token, "transient")
    with pytest.raises(StaleLease):
        client.heartbeat(claim.attempt_id, claim.fencing_token)
    with pytest.raises(StaleLease):
        client.complete(claim.attempt_id, claim.fencing_token + 1)
    with pytest.raises(StaleLease):
        client.start("someone-else", 1)
    again = client.claim("cpu-heavy", client.caps)
    assert client.fail(again.attempt_id, again.fencing_token, "input_invalid",
                       "x" * 9_000).state == JobState.FAILED
    assert len(gateway.store.job(job.id).error_detail) == 5_000


def test_a_worker_token_is_refreshed_before_it_expires(gateway):
    gateway.store.enqueue(JobSpec("w1", "analyse.song"))
    moment = [1_000_000.0]
    client = enroll(gateway, clock=lambda: moment[0])
    first_expiry = client._token_expires_at
    assert first_expiry == moment[0] + 900.0
    assert client.claim("cpu-heavy", client.caps) is not None
    assert client._token_expires_at == first_expiry, "a fresh token isn't refreshed"
    moment[0] += 900.0 - 30.0
    client.touch_worker("ignored")
    assert client.claim("cpu-heavy", client.caps) is None
    assert client._token_expires_at == moment[0] + 900.0, "refreshed with 30 s to go"


def test_a_client_only_claims_for_its_own_pool_and_id(gateway):
    client = enroll(gateway)
    with pytest.raises(ValueError, match="its registered pool"):
        client.claim("gpu", client.caps)


# --- Answers from the gateway -------------------------------------------------------------------


def answer(status: int, payload=None, content: bytes | None = None) -> httpx.Response:
    request = httpx.Request("POST", "https://gateway.test/x")
    if content is not None:
        return httpx.Response(status, content=content, request=request)
    return httpx.Response(status, json=payload, request=request)


@pytest.mark.parametrize("status", [500, 503, 408, 429])
def test_busy_or_broken_gateways_are_transient(status):
    with pytest.raises(TransientError, match=str(status)):
        RemoteWorkerClient._response(answer(status, {}))


def test_gateway_answers_map_to_the_runner_errors():
    assert RemoteWorkerClient._response(answer(204, content=b"")) == {}
    assert RemoteWorkerClient._response(answer(200, {"ok": 1})) == {"ok": 1}
    with pytest.raises(StaleLease):
        RemoteWorkerClient._response(answer(409, {"detail": {"code": "stale_lease"}}))
    with pytest.raises(JobCancelled):
        RemoteWorkerClient._response(answer(409, {"detail": {"code": "job_cancelled"}}))
    with pytest.raises(TransientError, match="refresh"):
        RemoteWorkerClient._response(answer(401, {"detail": {"code": "invalid_worker_token"}}))
    with pytest.raises(RemoteGatewayError) as other:
        RemoteWorkerClient._response(answer(400, {"detail": {"code": "x" * 200}}))
    assert other.value.status == 400 and len(other.value.code) == 80
    with pytest.raises(RemoteGatewayError, match="gateway_request_failed"):
        RemoteWorkerClient._response(answer(400, {"detail": "plain text"}))
    with pytest.raises(RemoteGatewayError, match="gateway_request_failed"):
        RemoteWorkerClient._response(answer(400, ["not", "a", "dict"]))
    with pytest.raises(RemoteGatewayError, match="invalid_gateway_response"):
        RemoteWorkerClient._response(answer(200, content=b"not json"))
    with pytest.raises(RemoteGatewayError, match="invalid_gateway_response"):
        RemoteWorkerClient._response(answer(200, ["a list"]))
    rejected = answer(422, {"detail": {"code": "completion_rejected"}})
    with pytest.raises(CompletionRejected) as caught:
        RemoteWorkerClient._response(rejected)
    assert (caught.value.error_class, caught.value.state) == ("transient", "failed")


def fixed(payload: dict, status: int = 200) -> httpx.MockTransport:
    return httpx.MockTransport(lambda request: httpx.Response(status, json=payload))


def offline() -> httpx.MockTransport:
    def refuse(request):
        raise httpx.ConnectError("no route", request=request)

    return httpx.MockTransport(refuse)


def client_with(transport, **values) -> RemoteWorkerClient:
    return RemoteWorkerClient("https://gateway.test", "worker-1", "cpu-heavy", "token",
                              values.pop("expires", 4_000_000_000.0),
                              WorkerCaps(pool="cpu-heavy"), api_transport=transport, **values)


def test_enrollment_needs_https_a_host_no_credentials_and_a_usable_answer():
    caps = WorkerCaps(pool="cpu-heavy")
    for url in ("http://gateway.test", "https://user:pw@gateway.test", "https://"):
        with pytest.raises(ValueError):
            RemoteWorkerClient.register(url, caps, bootstrap_token="t")
        with pytest.raises(ValueError):
            RemoteWorkerClient(url, "w", "cpu-heavy", "t", 1.0, caps)
    loopback = RemoteWorkerClient("http://127.0.0.1:8000", "w", "cpu-heavy", "t", 2e9, caps)
    assert loopback.caps.worker_id == "w"
    with pytest.raises(TransientError, match="reach"):
        RemoteWorkerClient.register("https://gateway.test", caps, bootstrap_token="t",
                                    api_transport=offline())
    with pytest.raises(RemoteGatewayError, match="enrollment"):
        RemoteWorkerClient.register("https://gateway.test", caps, bootstrap_token="t",
                                    api_transport=fixed({"token": "t", "expires_in": 0}))


def test_malformed_claims_heartbeats_and_refreshes_are_refused():
    with pytest.raises(RemoteGatewayError, match="invalid_claim_response"):
        client_with(fixed({"claim": {"attempt_id": "a"}})).claim(
            "cpu-heavy", WorkerCaps(pool="cpu-heavy", worker_id="worker-1"))
    with pytest.raises(RemoteGatewayError, match="invalid_heartbeat_response"):
        client_with(fixed({"lease_expires_at": 1})).heartbeat("a", 1)
    with pytest.raises(TransientError, match="reach the gateway"):
        client_with(offline(), expires=0.0).heartbeat("a", 1)
    with pytest.raises(RemoteGatewayError, match="refresh"):
        client_with(fixed({"token": None}), expires=0.0).heartbeat("a", 1)
    with pytest.raises(TransientError, match="before a response"):
        client_with(offline()).heartbeat("a", 1)
    quiet = client_with(fixed({}, status=204))
    quiet.progress("a", 1, 1.0)
    quiet.close()


# --- Signed storage -----------------------------------------------------------------------------


def holding(client: RemoteWorkerClient, inputs, tmp_path: Path):
    claim = SimpleNamespace(attempt_id="attempt-1", fencing_token=1, input_urls=tuple(inputs),
                            job=None)
    client._claims["attempt-1"] = claim
    return SimpleNamespace(attempt_id="attempt-1", fencing_token=1, scratch=tmp_path)


def test_inputs_download_by_position_name_or_key_and_are_checked(monkeypatch, tmp_path):
    body = b"original-audio"
    digest = hashlib.sha256(body).hexdigest()
    client = client_with(fixed({}), storage_hosts=("files.example.test",))
    storage(monkeypatch, lambda request: httpx.Response(200, content=body))
    context = holding(client, [
        {"name": "a.flac", "key": "w/a", "url": f"{STORAGE}/a?s=1", "size_bytes": len(body),
         "sha256": digest},
        {"key": "w/b", "url": "https://FILES.example.test/b?s=2"},
    ], tmp_path)
    assert client.download_input(context, 0).read_bytes() == body
    assert client.download_input(context, "w/b").name == "input-1.bin"
    assert client.download_input(context, "a.flac", Path("nested/x.bin")).parent.name == "nested"
    with pytest.raises(InputInvalid):
        client.download_input(context, True)
    with pytest.raises(InputInvalid, match="position"):
        client.download_input(context, 5)
    with pytest.raises(InputInvalid, match="name"):
        client.download_input(context, "missing")
    with pytest.raises(InputInvalid, match="scratch"):
        client.download_input(context, 0, tmp_path.parent / "escape.bin")


def test_a_download_that_does_not_match_its_claim_is_deleted(monkeypatch, tmp_path):
    client = client_with(fixed({}))
    storage(monkeypatch, lambda request: httpx.Response(200, content=b"tampered"))
    context = holding(client, [
        {"name": "a", "url": f"{STORAGE}/a?s=1", "size_bytes": 3},
        {"name": "b", "url": f"{STORAGE}/b?s=1", "sha256": "0" * 64},
    ], tmp_path)
    with pytest.raises(InputInvalid, match="size"):
        client.download_input(context, "a")
    with pytest.raises(InputInvalid, match="checksum"):
        client.download_input(context, "b")
    assert list(tmp_path.iterdir()) == []


@pytest.mark.parametrize(
    "url",
    [None, "http://bucket.account.r2.cloudflarestorage.com/a", "https://evil.test/a",
     "https://user:pw@bucket.account.r2.cloudflarestorage.com/a"],
)
def test_only_https_urls_on_trusted_storage_hosts_are_used(tmp_path, url):
    client = client_with(fixed({}))
    context = holding(client, [{"name": "a", "url": url}], tmp_path)
    with pytest.raises(RemoteGatewayError):
        client.download_input(context, 0)


def slots(payload) -> RemoteWorkerClient:
    return client_with(fixed(payload))


def test_publishing_uploads_to_the_signed_slot_and_reports_checksum_and_size(
    monkeypatch, tmp_path
):
    source = tmp_path / "out.flac"
    source.write_bytes(b"flac-data")
    client = slots({"outputs": [{"name": "out.flac", "key": "w/k/out.flac",
                                 "url": f"{STORAGE}/out?s=1",
                                 "headers": {"Content-Type": "audio/flac", "Cookie": "no"}}]})
    seen = storage(monkeypatch, lambda request: httpx.Response(200))
    context = holding(client, [], tmp_path)
    made = client.publish_artifact(context, "playback", HASH, source, "out.flac",
                                   provenance={"v": 1}, protected=True)
    assert made.keys == ["w/k/out.flac"] and made.size_bytes == 9
    assert made.checksum == hashlib.sha256(b"flac-data").hexdigest()
    assert seen[0].method == "PUT" and "cookie" not in seen[0].headers
    assert seen[0].headers["content-type"] == "audio/flac"


@pytest.mark.parametrize(
    ("payload", "problem"),
    [
        ({"outputs": []}, RemoteGatewayError),
        ({"outputs": ["slot"]}, RemoteGatewayError),
        ({"outputs": [{"name": "other", "key": "k", "url": f"{STORAGE}/o"}]}, RemoteGatewayError),
        ({"outputs": [{"name": "out.flac", "key": 3, "url": f"{STORAGE}/o"}]}, RemoteGatewayError),
        ({"outputs": [{"name": "out.flac", "key": "k", "url": "https://evil.test/o"}]},
         RemoteGatewayError),
        ({"outputs": [{"name": "out.flac", "key": "k", "url": f"{STORAGE}/o",
                       "headers": ["x"]}]}, RemoteGatewayError),
    ],
)
def test_bad_output_slots_are_refused(tmp_path, payload, problem):
    source = tmp_path / "out.flac"
    source.write_bytes(b"x")
    client = slots(payload)
    context = holding(client, [], tmp_path)
    with pytest.raises(problem):
        client.publish_artifact(context, "playback", HASH, source, "out.flac")


def test_unsafe_artifact_names_hashes_and_missing_files_are_refused(monkeypatch, tmp_path):
    good = {"outputs": [{"name": "out.flac", "key": "k", "url": f"{STORAGE}/o"}]}
    client = slots(good)
    context = holding(client, [], tmp_path)
    with pytest.raises(InputInvalid, match="SHA-256"):
        client.publish_artifact(context, "playback", "ABC", tmp_path / "x", "out.flac")
    with pytest.raises(InputInvalid, match="unsafe"):
        client.publish_artifact(context, "playback", HASH, tmp_path / "x", "../out.flac")
    with pytest.raises(InputInvalid, match="missing"):
        client.publish_artifact(context, "playback", HASH, tmp_path / "absent", "out.flac")
    source = tmp_path / "out.flac"
    source.write_bytes(b"x")
    storage(monkeypatch, lambda request: httpx.Response(403))
    with pytest.raises(TransientError, match="403"):
        client.publish_artifact(context, "playback", HASH, source, "out.flac")
