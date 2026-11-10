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


# --- Configuration, tokens and registration ---------------------------------------------------


def test_install_routes_refuses_weak_secrets_odd_lifetimes_and_unknown_pools(gateway):
    _app, store = gateway
    good = {"store": store, "token_secret": TOKEN_SECRET, "bootstrap_token": BOOTSTRAP}
    for changes in (
        {"token_secret": "short"},
        {"bootstrap_token": "short"},
        {"token_ttl_s": 0},
        {"token_ttl_s": 3_601},
        {"allowed_pools": frozenset()},
        {"allowed_pools": frozenset({"internal"})},
    ):
        with pytest.raises(ValueError):
            install_routes(FastAPI(), **(good | changes))


def token_for(worker_id, pool: str = "cpu-light") -> str:
    import time

    import jwt

    issued = int(time.time())
    payload = {"sub": worker_id, "pool": pool, "aud": "selecta-workers", "iat": issued,
               "exp": issued + 600}
    return jwt.encode(payload, TOKEN_SECRET, algorithm="HS256")


def bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def test_tokens_for_other_pools_unregistered_workers_or_broken_registrations_are_refused(
    gateway,
):
    import sqlalchemy as sa

    from selecta.persistence import transaction
    from selecta.work.schema import workers

    app, store = gateway
    with TestClient(app) as client:
        worker_id, token = enroll(client)
        assert client.post("/internal/workers/refresh", headers=bearer(token)).status_code == 200
        gpu = client.post("/internal/workers/claim", headers=bearer(token_for(worker_id, "gpu")))
        assert gpu.json()["detail"]["code"] == "invalid_worker_token"
        bad_sub = client.post("/internal/workers/claim", headers=bearer(token_for(123)))
        assert bad_sub.status_code == 401
        ghost = client.post("/internal/workers/claim", headers=bearer(token_for("ghost")))
        assert ghost.json()["detail"]["code"] == "worker_not_registered"
        with transaction(store.engine) as connection:
            connection.execute(
                sa.update(workers).where(workers.c.id == worker_id).values(
                    capabilities={"slots": "many"}
                )
            )
        broken = client.post("/internal/workers/claim", headers=bearer(token))
        assert broken.json()["detail"]["code"] == "worker_registration_invalid"


def test_registration_refuses_unknown_types_too_many_slots_and_caps_the_store_rejects(
    gateway, monkeypatch
):
    app, store = gateway
    headers = bearer(BOOTSTRAP)

    def refuse(caps, worker_id):
        raise ValueError("bad caps")

    with TestClient(app) as client:
        unknown = client.post("/internal/workers/register", headers=headers,
                              json={"pool": "cpu-light", "job_types": ["nope.nothing"]})
        too_many = client.post("/internal/workers/register", headers=headers,
                               json={"pool": "cpu-light", "slots": 9})
        monkeypatch.setattr(store, "register_worker", refuse)
        refused = client.post("/internal/workers/register", headers=headers,
                              json={"pool": "cpu-light"})
    assert unknown.json()["detail"]["code"] == "unknown_worker_job_type"
    assert too_many.json()["detail"]["code"] == "worker_capability_not_allowed"
    assert refused.json()["detail"]["code"] == "invalid_worker_caps"


# --- Attempt routes -----------------------------------------------------------------------------


def claimed(client, store, **spec):
    store.enqueue(JobSpec("workspace-1", "ingest.validate", **spec))
    worker_id, token = enroll(client)
    claim = client.post("/internal/workers/claim", headers=bearer(token)).json()["claim"]
    path = f"/internal/workers/attempts/{claim['attempt_id']}"
    return worker_id, token, claim, path


def test_another_workers_attempt_is_not_found(gateway):
    app, store = gateway
    with TestClient(app) as client:
        _, _, claim, path = claimed(client, store)
        _, stranger = enroll(client)
        payload = {"fencing_token": claim["fencing_token"]}
        assert client.post(path + "/heartbeat", headers=bearer(stranger),
                           json=payload).status_code == 404
        missing = "/internal/workers/attempts/0190f2a4-0000-7000-8000-000000000000/heartbeat"
        assert client.post(missing, headers=bearer(stranger), json=payload).status_code == 404


def test_attempt_routes_answer_409_once_the_lease_is_gone(gateway):
    app, store = gateway
    with TestClient(app) as client:
        _, token, claim, path = claimed(client, store)
        payload = {"fencing_token": claim["fencing_token"]}
        released = client.post(path + "/release", headers=bearer(token), json=payload)
        assert released.json()["state"] == "queued"
        for route, extra in (("/heartbeat", {}), ("/progress", {"done": 1}),
                             ("/complete", {}), ("/fail", {"error_class": "transient"})):
            gone = client.post(path + route, headers=bearer(token), json=payload | extra)
            assert (gone.status_code, gone.json()["detail"]["code"]) == (409, "stale_lease")
        again = client.post(path + "/release", headers=bearer(token), json=payload)
        assert again.status_code == 200


def test_complete_answers_cancelled_rejected_and_too_large(gateway, monkeypatch):
    from selecta.work.errors import CompletionRejected

    app, store = gateway
    store.config = store.config.evolve(max_result_bytes=50)

    def reject(*args, **kwargs):
        raise CompletionRejected("transient", "missing output")

    with TestClient(app) as client:
        _, token, claim, path = claimed(client, store)
        payload = {"fencing_token": claim["fencing_token"]}
        big = client.post(path + "/complete", headers=bearer(token),
                          json=payload | {"result": {"x": "y" * 100}})
        assert (big.status_code, big.json()["detail"]["code"]) == (413, "result_too_large")
        with monkeypatch.context() as patched:
            patched.setattr(store, "complete", reject)
            rejected = client.post(path + "/complete", headers=bearer(token), json=payload)
        assert rejected.json()["detail"] == {"code": "completion_rejected",
                                             "error_class": "transient", "state": "running"}
        store.cancel("workspace-1", claim["job"]["id"])
        cancelled = client.post(path + "/complete", headers=bearer(token), json=payload)
        assert cancelled.json()["detail"]["code"] == "job_cancelled"


def test_release_of_a_job_cancelled_under_it_is_answered_as_cancelled(gateway, monkeypatch):
    from selecta.work.errors import JobCancelled

    app, store = gateway

    def cancelled(*args):
        raise JobCancelled("gone")

    with TestClient(app) as client:
        _, token, claim, path = claimed(client, store)
        monkeypatch.setattr(store, "release", cancelled)
        answer = client.post(path + "/release", headers=bearer(token),
                             json={"fencing_token": claim["fencing_token"]})
    assert answer.json()["detail"]["code"] == "job_cancelled"


def test_a_claim_whose_attempt_cannot_start_is_answered_as_stale(gateway, monkeypatch):
    from selecta.work.errors import StaleLease

    app, store = gateway
    store.enqueue(JobSpec("workspace-1", "ingest.validate"))

    def lost(*args):
        raise StaleLease("reaped")

    monkeypatch.setattr(store, "start", lost)
    with TestClient(app) as client:
        _, token = enroll(client)
        answer = client.post("/internal/workers/claim", headers=bearer(token))
    assert (answer.status_code, answer.json()["detail"]["code"]) == (409, "stale_lease")


@pytest.mark.parametrize(
    "keys",
    [[], [7], "w/workspace-1/analysis/" + "a" * 64 + "/attempts/other/x.npz", ["../escape"],
     ["s/workspace-1/upload.flac"]],
    ids=["empty", "not-text", "other-attempt", "invalid", "wrong-bucket"],
)
def test_artifact_keys_outside_the_attempts_own_prefix_are_refused(gateway, keys):
    app, store = gateway
    with TestClient(app) as client:
        _, token, claim, path = claimed(client, store)
        answer = client.post(path + "/complete", headers=bearer(token), json={
            "fencing_token": claim["fencing_token"],
            "artifacts": [{"kind": "analysis", "input_hash": "a" * 64, "keys": keys}],
        })
    assert (answer.status_code, answer.json()["detail"]["code"]) == (422, "invalid_artifact_keys")


def test_artifact_keys_inside_the_attempts_own_prefix_are_accepted(gateway):
    app, store = gateway
    with TestClient(app) as client:
        _, token, claim, path = claimed(client, store)
        key = f"w/workspace-1/analysis/{'a' * 64}/attempts/{claim['attempt_id']}/features.npz"
        answer = client.post(path + "/complete", headers=bearer(token), json={
            "fencing_token": claim["fencing_token"],
            "artifacts": [{"kind": "analysis", "input_hash": "a" * 64, "keys": key,
                           "checksum": "c", "size_bytes": 1}],
        })
    assert answer.json()["state"] == "succeeded"
    assert store.find_artifact("workspace-1", "analysis", "a" * 64).keys == key


def test_output_slots_need_a_signer_that_answers_one_slot_per_name(tmp_path):
    engine = make_engine(f"sqlite:///{tmp_path / 'slots.sqlite'}")
    store = JobStore(engine)
    store.create_tables()
    answers = {"mode": "ok"}

    def sign(attempt, names):
        if answers["mode"] == "raise":
            raise ValueError("no namespace")
        if answers["mode"] == "short":
            return []
        return [{"key": f"k/{name}", "url": "https://r2/x"} for name in names]

    plain, signed = FastAPI(), FastAPI()
    for app, signer in ((plain, None), (signed, sign)):
        install_routes(app, store=store, token_secret=TOKEN_SECRET, bootstrap_token=BOOTSTRAP,
                       allowed_pools=frozenset({"cpu-light"}), sign_outputs=signer)
    try:
        with TestClient(signed) as client:
            _, token, claim, path = claimed(client, store)
            body = {"fencing_token": claim["fencing_token"], "names": ["a.npz", "b.npz"]}
            ok = client.post(path + "/outputs", headers=bearer(token), json=body)
            assert [slot["name"] for slot in ok.json()["outputs"]] == ["a.npz", "b.npz"]
            answers["mode"] = "raise"
            assert client.post(path + "/outputs", headers=bearer(token),
                               json=body).status_code == 422
            answers["mode"] = "short"
            assert client.post(path + "/outputs", headers=bearer(token),
                               json=body).status_code == 502
        with TestClient(plain) as client:
            unavailable = client.post(path + "/outputs", headers=bearer(token), json=body)
            assert unavailable.status_code == 503
    finally:
        engine.dispose()
