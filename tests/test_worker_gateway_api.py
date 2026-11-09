from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from selecta.persistence import make_engine
from selecta.work.enqueue import JobSpec
from selecta.work.gateway_api import install_routes
from selecta.work.store import JobStore

TOKEN_SECRET = "test-worker-token-secret-that-is-long-enough"
BOOTSTRAP = "test-worker-bootstrap-token-that-is-long-enough"


@pytest.fixture
def gateway(tmp_path):
    engine = make_engine(f"sqlite:///{tmp_path / 'gateway.sqlite'}")
    store = JobStore(engine)
    store.create_tables()
    app = FastAPI()
    install_routes(
        app,
        store=store,
        token_secret=TOKEN_SECRET,
        bootstrap_token=BOOTSTRAP,
        allowed_pools=frozenset({"cpu-light"}),
    )
    try:
        yield app, store
    finally:
        engine.dispose()


def enroll(client: TestClient) -> tuple[str, str]:
    response = client.post(
        "/internal/workers/register",
        headers={"Authorization": f"Bearer {BOOTSTRAP}"},
        json={"pool": "cpu-light", "slots": 1, "job_types": ["ingest.validate"]},
    )
    assert response.status_code == 201
    return response.json()["worker_id"], response.json()["token"]


def test_gateway_requires_bootstrap_for_registration_and_worker_token_for_claim(gateway):
    app, _store = gateway
    with TestClient(app) as client:
        denied_enroll = client.post("/internal/workers/register", json={"pool": "cpu-light"})
        denied_claim = client.post("/internal/workers/claim")
        assert denied_enroll.status_code == 401
        assert denied_claim.status_code == 401

        _worker_id, token = enroll(client)
        assert (
            client.post(
                "/internal/workers/claim", headers={"Authorization": f"Bearer {token}x"}
            ).status_code
            == 401
        )


def test_gateway_claims_starts_job_and_fences_worker_lifecycle(gateway):
    app, store = gateway
    queued = store.enqueue(JobSpec("workspace-1", "ingest.validate", input_ref={"asset": "a"}))
    with TestClient(app) as client:
        worker_id, token = enroll(client)
        headers = {"Authorization": f"Bearer {token}"}
        idle = client.post("/internal/workers/claim", headers=headers)
        claim = client.post("/internal/workers/claim", headers=headers)

        # The first claim consumes the queued job, so only that response is non-empty.
        if idle.json()["claim"] is None:
            claimed = claim.json()["claim"]
        else:
            claimed = idle.json()["claim"]
        assert claimed["job"]["id"] == queued.job.id
        attempt_id = claimed["attempt_id"]
        token_value = claimed["fencing_token"]
        path = f"/internal/workers/attempts/{attempt_id}"
        payload = {"fencing_token": token_value}
        heartbeat = client.post(path + "/heartbeat", headers=headers, json=payload)
        progress = client.post(
            path + "/progress", headers=headers, json=payload | {"done": 1, "total": 2}
        )
        completed = client.post(
            path + "/complete", headers=headers, json=payload | {"result": {"valid": True}}
        )
        repeated = client.post(
            path + "/complete", headers=headers, json=payload | {"result": {"valid": True}}
        )
        wrong_fence = client.post(
            path + "/heartbeat", headers=headers, json={"fencing_token": token_value + 1}
        )

    assert heartbeat.status_code == 200
    assert heartbeat.json()["cancel_requested"] is False
    assert progress.status_code == 204
    assert completed.status_code == 200
    assert completed.json()["state"] == "succeeded"
    assert repeated.json()["state"] == "succeeded"
    assert wrong_fence.status_code == 409
    assert store.attempt(attempt_id).worker_id == worker_id


def test_registration_rejects_cross_pool_job_type_and_disallowed_pool(gateway):
    app, _store = gateway
    with TestClient(app) as client:
        headers = {"Authorization": f"Bearer {BOOTSTRAP}"}
        wrong_type = client.post(
            "/internal/workers/register",
            headers=headers,
            json={"pool": "cpu-light", "job_types": ["analyse.song"]},
        )
        denied_pool = client.post(
            "/internal/workers/register", headers=headers, json={"pool": "gpu"}
        )
    assert wrong_type.status_code == 400
    assert wrong_type.json()["detail"]["code"] == "worker_job_type_pool_mismatch"
    assert denied_pool.status_code == 400


def test_artifact_completion_is_restricted_to_attempt_scoped_workspace_keys(gateway):
    app, store = gateway
    store.enqueue(JobSpec("workspace-1", "ingest.validate"))
    with TestClient(app) as client:
        _worker_id, token = enroll(client)
        headers = {"Authorization": f"Bearer {token}"}
        claim = client.post("/internal/workers/claim", headers=headers).json()["claim"]
        invalid = client.post(
            f"/internal/workers/attempts/{claim['attempt_id']}/complete",
            headers=headers,
            json={
                "fencing_token": claim["fencing_token"],
                "artifacts": [
                    {
                        "kind": "analysis",
                        "input_hash": "a" * 64,
                        "keys": [
                            "w/other-workspace/analysis/"
                            + "a" * 64
                            + "/attempts/"
                            + claim["attempt_id"]
                            + "/features.npz"
                        ],
                    }
                ],
            },
        )
    assert invalid.status_code == 422
    assert invalid.json()["detail"]["code"] == "invalid_artifact_keys"
