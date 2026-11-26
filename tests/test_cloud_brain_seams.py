"""Seams in Cloud (`cloud.brain`, docs/engineering/engine-store-seams.md).

Alice's device reports a seam it rendered; a second device sees it exists and that it must render
its own; Alice rates it and reads her ratings in Desktop's shape; planning an order learns from
it; Bob can't see, rate or report into Alice's workspace; a report naming a path, a made-up key, a
song or device not Alice's is refused; the export carries the seam tables; the hosted adapter
keeps a cloud studio's seam with provenance `worker`. Synthetic numbers, no audio. The
PostgreSQL policy is in tests/test_engine_store_seams_postgres.py.
"""

# ruff: noqa: F811  (each test takes the `cloud` fixture imported below)
from __future__ import annotations

import io
import json
import zipfile

import pytest
from brain_helpers import sha_for
from test_cloud_brain_routes import ALICE, BOB, _auth, cloud  # noqa: F401  (the fixture)

from selecta import flags
from selecta.cloud_brain.seams_routes import device_seam_key
from selecta.engine_store import EngineStore
from selecta.engine_store import seams as stored

FINGERPRINT = "c" * 64


def _device(client, token: str) -> str:
    made = client.post("/api/devices", headers=_auth(token), json={"name": "Laptop"})
    assert made.status_code == 201, made.text
    return made.json()["device"]["id"]


def _report(a: int, b: int, device: str, **changes) -> dict:
    body = {
        "device_id": device,
        "a": a,
        "b": b,
        "fingerprint": FINGERPRINT,
        "option": 0,
        "move": "bass_swap_blend",
        "bars": 8,
        "exit_bar": 64,
        "entry_bar": 8,
        "a_source_start": 100.0,
        "b_source_end": 12.0,
        "passed": True,
        "near_miss": False,
        "fell_back": False,
        "audit": {"passed": True, "failures": []},
        "tried": 1,
        "implementation": "web-render-1+wsola-stretch-v1",
        "clip_sha256": "d" * 64,
        "clip_seconds": 24.0,
    }
    return {**body, **changes}


def _put(client, token, body, key=None):
    key = key or device_seam_key(body["a"], body["b"], body["fingerprint"], body["option"])
    return key, client.put(f"/api/seams/{key}", headers=_auth(token), json=body)


def _workspace(cloud) -> str:
    with cloud["engine"].connect() as connection:
        return connection.exec_driver_sql(
            "SELECT workspace_id FROM local_songs WHERE id = ?", (cloud["ids"][0],)
        ).scalar_one()


def test_the_key_is_the_one_the_browser_works_out():
    # the same values web/src/cloud/seamReports.test.ts pins
    assert device_seam_key(1, 2, "a" * 64, 2) == "beba0e3e932a76417d57"
    assert device_seam_key(7, 3, "b" * 64, "fallback") == "5f3fe31dad1a7256eb34"


def test_a_reported_seam_is_kept_seen_rated_and_learned_from(cloud):
    client, (a, b, *_rest) = cloud["client"], cloud["ids"]
    mine, other = _device(client, ALICE), _device(client, ALICE)
    key, answer = _put(client, ALICE, _report(a, b, mine))
    assert answer.status_code == 200, answer.text
    assert answer.json() == {"key": key, "kept": True}

    seen = client.get(f"/api/seams?a={a}&b={b}&device_id={other}", headers=_auth(ALICE)).json()
    (seam,) = seen["seams"]
    assert seam["key"] == key and seam["move"] == "bass_swap_blend" and seam["status"] == "ready"
    assert seam["playable_here"] is False  # only the device that made the clip may play it
    assert seam["rendered_by"] == [
        {
            "studio": "device",
            "implementation": "web-render-1+wsola-stretch-v1",
            "clip_seconds": 24.0,
            "this_device": False,
        }
    ]
    assert mine not in json.dumps(seen)  # another device's id is never listed
    held = client.get(f"/api/seams?keys={key}&device_id={mine}", headers=_auth(ALICE)).json()
    assert held["seams"][0]["playable_here"] is True

    # the second device renders its own: one record, two attestations, the first record kept
    again, second = _put(client, ALICE, _report(a, b, other, passed=False))
    assert (again, second.json()["kept"]) == (key, False)
    rated = client.post(f"/api/seams/{key}/rate", headers=_auth(ALICE), json={"rating": "good"})
    assert rated.status_code == 200, rated.text
    assert rated.json()["rating"] == "good" and rated.json()["passed"] is True
    store = EngineStore(cloud["engine"], _workspace(cloud))
    assert len(stored.known(store, wanted=[key])[0]["attestations"]) == 2
    (verdict,) = stored.verdicts(store)
    assert verdict["verdict"] == "good" and verdict["rated_by"] != "local"

    ratings = client.get("/api/memory/ratings", headers=_auth(ALICE))
    assert ratings.status_code == 200, ratings.text
    (one,) = ratings.json()["ratings"]
    assert (
        one["move"] == "bass_swap_blend" and one["good"] is True and one["a"].startswith("Artist")
    )
    assert "move" in ratings.json()["patterns"]

    # planning an order learns from it: the liked seam is in the memory the route builds
    from selecta.cloud_brain.planning_routes import _memory

    assert (a, b, "bass_swap_blend") in _memory(store).liked
    order = client.post("/api/planning/order", headers=_auth(ALICE), json={"songs": cloud["ids"]})
    assert order.status_code == 200, order.text


def test_a_report_is_refused_when_it_names_what_it_must_not(cloud):
    client, (a, b, *_rest) = cloud["client"], cloud["ids"]
    device = _device(client, ALICE)
    _key, wrong_key = _put(client, ALICE, _report(a, b, device), key="0" * 20)
    assert wrong_key.json()["detail"]["code"] == "key_mismatch"
    _key, path = _put(client, ALICE, {**_report(a, b, device), "file": "C:\\Music\\a.mp3"})
    assert path.json()["detail"]["code"] == "paths_never_reach_cloud"
    _key, stranger = _put(client, ALICE, _report(a, b, "not-a-device"))
    assert stranger.json()["detail"]["code"] == "unknown_device"
    _key, unknown = _put(client, ALICE, _report(a, 999_999, device))
    assert unknown.status_code == 404
    _key, extra = _put(client, ALICE, {**_report(a, b, device), "clip": [0.1] * 10})
    assert extra.status_code == 422
    big = client.put(
        "/api/seams/" + "0" * 20,
        headers={**_auth(ALICE), "Content-Type": "application/json"},
        content=b"{" + b" " * (70 * 1024) + b"}",
    )
    assert (big.status_code, big.json()["detail"]["code"]) == (413, "report_too_large")
    unready = client.post(
        "/api/seams/" + "1" * 20 + "/rate", headers=_auth(ALICE), json={"rating": "bad"}
    )
    assert unready.json()["detail"]["code"] == "seam_not_found"


def test_bob_never_sees_rates_or_reports_into_alices_seams(cloud):
    client, (a, b, *_rest) = cloud["client"], cloud["ids"]
    key, _answer = _put(client, ALICE, _report(a, b, _device(client, ALICE)))
    bobs = _device(client, BOB)
    assert client.get(f"/api/seams?keys={key}", headers=_auth(BOB)).json() == {"seams": []}
    assert client.get(f"/api/seams?a={a}&b={b}", headers=_auth(BOB)).json() == {"seams": []}
    refused = client.post(f"/api/seams/{key}/rate", headers=_auth(BOB), json={"rating": "bad"})
    assert refused.json()["detail"]["code"] == "seam_not_found"
    _key, into = _put(client, BOB, _report(a, b, bobs))
    assert into.status_code == 404  # Alice's songs aren't Bob's
    assert client.get("/api/memory/ratings", headers=_auth(BOB)).json()["ratings"] == []


def test_the_verdict_and_ratings_routes_also_need_the_brain(cloud):
    client, (a, b, *_rest) = cloud["client"], cloud["ids"]
    key, _answer = _put(client, ALICE, _report(a, b, _device(client, ALICE)))
    flags.use("-cloud.brain")
    for method, path, body in (
        ("POST", f"/api/seams/{key}/rate", {"rating": "good"}),
        ("GET", "/api/memory/ratings", None),
    ):
        answer = client.request(method, path, headers=_auth(ALICE), json=body)
        assert answer.status_code == 403, path
        assert answer.json()["detail"]["code"] == "flag_off", path


def test_the_export_carries_the_seam_tables(cloud):
    client, (a, b, *_rest) = cloud["client"], cloud["ids"]
    key, _answer = _put(client, ALICE, _report(a, b, _device(client, ALICE)))
    client.post(f"/api/seams/{key}/rate", headers=_auth(ALICE), json={"rating": "bad"})
    answer = client.get("/api/account/export", headers=_auth(ALICE))
    with zipfile.ZipFile(io.BytesIO(answer.content)) as archive:
        kept = json.loads(archive.read("song-facts.json"))
    assert [row["key"] for row in kept["seams"]] == [key]
    assert [row["verdict"] for row in kept["seam_verdicts"]] == ["bad"]
    assert len(kept["seam_attestations"]) == 1 and kept["seam_history"]


def test_the_hosted_adapter_keeps_a_cloud_studio_seam_as_the_workers(cloud):
    from selecta.engine_store.hosted_seams import record_worker_seam

    store = EngineStore(cloud["engine"], _workspace(cloud))
    cues = {"a_source_start": 90.0, "b_source_end": 10.0, "seconds": 20.0}
    kept = record_worker_seam(
        store,
        a_sha256=sha_for(1),
        b_sha256=sha_for(2),
        digest="e" * 64,
        move="echo_out",
        cues=cues,
        clip_sha256="f" * 64,
        worker_id="worker-1",
        implementation="python-render-2",
        passed=True,
    )
    assert kept is not None
    (row,) = stored.known(store, wanted=[kept])
    assert row["source"] == "worker" and row["attestations"][0]["studio"] == "worker"
    assert row["song_a"] == cloud["ids"][0] and row["duration"] == 20.0
    missing = record_worker_seam(
        store,
        a_sha256="0" * 64,
        b_sha256=sha_for(2),
        digest="e" * 64,
        move=None,
        cues=cues,
        clip_sha256="f" * 64,
        worker_id="worker-1",
        implementation="python-render-2",
        passed=True,
    )
    assert missing is None


@pytest.mark.parametrize("bad", ["", "x" * 21, "G" * 20])
def test_a_key_that_isnt_a_device_key_is_refused(cloud, bad):
    client, (a, b, *_rest) = cloud["client"], cloud["ids"]
    answer = client.put(f"/api/seams/{bad}x", headers=_auth(ALICE), json=_report(a, b, "d"))
    assert answer.status_code in {404, 405, 422}
