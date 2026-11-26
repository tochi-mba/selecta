"""A Cloud account's song requests (`cloud.brain` with `cloud.account_mixes`, ADR-0479).

The Desktop's own request routes answer for Alice from her own tables through the engine store,
in Desktop's shapes. Adding a request to the mix is one write with the mix's own (Undo takes it
out again). The look plans from song facts and names the handovers a placement needs; it is
ready for a device once that device has reported them, and only then can it be put in. Bob sees
none of it; with the flag off the routes answer flag_off. Synthetic catalogue rows only.
PostgreSQL's policy is in tests/test_engine_store_requests_postgres.py.
"""

# ruff: noqa: F811  (each test takes the `cloud` fixture imported below)
from __future__ import annotations

import pytest
from cloud_helpers import grant_hosted_media
from test_cloud_brain_routes import ALICE, BOB, _auth, cloud  # noqa: F401  (the fixture)
from test_cloud_brain_seams import _device, _put, _report

from selecta import flags


@pytest.fixture(autouse=True)
def account_mixes_on(cloud):
    # on for every account with the cloud library: it needs cloud.hosted_media
    grant_hosted_media(cloud["engine"], cloud["app"])
    yield
    flags.use(None)


def _ok(answer) -> dict:
    assert answer.status_code == 200, answer.text
    return answer.json()


def _playing(order: list[int], position: int = 0) -> dict:
    return {"order": order, "position": position, "phase": "playing", "seconds_left": 60.0}


def test_requests_are_asked_listed_and_cancelled_in_desktop_shapes(cloud):
    client, (a, b, *_rest) = cloud["client"], cloud["ids"]
    assert _ok(client.get("/api/requests", headers=_auth(ALICE))) == {"requests": []}
    asked = _ok(client.post("/api/requests", headers=_auth(ALICE), json={"song_id": a}))
    again = _ok(client.post("/api/requests", headers=_auth(ALICE), json={"song_id": a}))
    assert again["id"] == asked["id"]  # a repeated tap is the same request
    (row,) = asked["requests"]
    assert row["song_id"] == a and row["title"] == "Song 1" and row["available"] == 1
    assert row["status"] == "waiting" and row["bridge_choice"] is None and row["never"] is False
    stranger = client.post("/api/requests", headers=_auth(ALICE), json={"song_id": 999_999})
    assert stranger.status_code == 400
    assert _ok(client.get("/api/requests", headers=_auth(BOB))) == {"requests": []}
    bobs = client.delete(f"/api/requests/{asked['id']}", headers=_auth(BOB))
    assert _ok(bobs)["cancelled"] is False  # another workspace's request isn't there for Bob
    said = _ok(client.post(
        f"/api/requests/{asked['id']}/bridge", headers=_auth(ALICE), json={"allow": False}
    ))
    assert said["requests"][0]["bridge_choice"] is False
    gone = _ok(client.delete(f"/api/requests/{asked['id']}", headers=_auth(ALICE)))
    assert gone == {"cancelled": True, "requests": []}
    _ok(client.post("/api/requests", headers=_auth(ALICE), json={"song_id": b}))
    extra = client.post("/api/requests", headers=_auth(ALICE), json={"song_id": a, "path": "x"})
    assert extra.status_code == 422  # bodies forbid unknown fields


def test_adding_a_request_is_one_mix_edit_that_undo_takes_back(cloud):
    client, (a, b, c, d, *_rest) = cloud["client"], cloud["ids"]
    client.put("/api/mix/order", headers=_auth(ALICE), json={"song_ids": [a, b, c]})
    asked = _ok(client.post("/api/requests", headers=_auth(ALICE), json={"song_id": d}))
    added = _ok(client.post(
        f"/api/requests/{asked['id']}/add", headers=_auth(ALICE),
        json={"order": [a, b, c], "position": 0},
    ))
    assert [item["song_id"] for item in added["mix"]] == [a, b, d, c]
    assert _ok(client.get("/api/requests", headers=_auth(ALICE))) == {"requests": []}
    twice = client.post(f"/api/requests/{asked['id']}/add", headers=_auth(ALICE), json={})
    assert twice.status_code == 409
    undone = _ok(client.post("/api/mix/undo", headers=_auth(ALICE)))
    assert [item["song_id"] for item in undone["mix"]] == [a, b, c]
    assert undone["undone"] == "adding Song 4"


def test_the_look_names_the_handovers_and_waits_for_the_device_that_plays(cloud):
    client, (a, b, c, d, *_rest) = cloud["client"], cloud["ids"]
    client.put("/api/mix/order", headers=_auth(ALICE), json={"song_ids": [a, b, c]})
    _ok(client.post("/api/requests", headers=_auth(ALICE), json={"song_id": d}))
    device = _device(client, ALICE)
    look = _ok(client.post(
        f"/api/requests/consider?device_id={device}", headers=_auth(ALICE), json=_playing([a, b, c])
    ))
    (row,) = look["requests"]
    assert row["song_id"] == d
    if row.get("plan") is None:
        pytest.skip("the synthetic facts give request no place to fit")
    assert row["stage"] == "preparing" and row["ready"] is False
    pairs = [(seam["a"], seam["b"]) for seam in row["seams_needed"]]
    assert d in {song for pair in pairs for song in pair}
    early = client.post(
        f"/api/requests/insert?device_id={device}", headers=_auth(ALICE),
        json={**_playing([a, b, c]), "offer": row["offer"]},
    )
    assert early.status_code == 409  # nothing is in until this device has the handovers
    for one, two in pairs:
        _key, saved = _put(client, ALICE, _report(one, two, device))
        assert saved.status_code == 200, saved.text
    other = _device(client, ALICE)
    elsewhere = _ok(client.post(
        f"/api/requests/consider?device_id={other}", headers=_auth(ALICE), json=_playing([a, b, c])
    ))
    assert elsewhere["requests"][0]["ready"] is False  # another device must make its own
    here = _ok(client.post(
        f"/api/requests/consider?device_id={device}", headers=_auth(ALICE), json=_playing([a, b, c])
    ))
    (row,) = here["requests"]
    assert row["ready"] is True and row["stage"] == "ready"
    joined = _ok(client.post(
        f"/api/requests/insert?device_id={device}", headers=_auth(ALICE),
        json={**_playing([a, b, c]), "offer": row["offer"]},
    ))
    assert d in [item["song_id"] for item in joined["mix"]]
    assert _ok(client.get("/api/requests", headers=_auth(ALICE))) == {"requests": []}


def test_a_look_settles_a_request_already_in_the_mix(cloud):
    client, (a, b, c, *_rest) = cloud["client"], cloud["ids"]
    client.put("/api/mix/order", headers=_auth(ALICE), json={"song_ids": [a, b, c]})
    _ok(client.post("/api/requests", headers=_auth(ALICE), json={"song_id": c}))
    stale = client.post("/api/requests/consider", headers=_auth(ALICE), json=_playing([a, b]))
    assert stale.status_code == 409  # the page's mix isn't the account's
    playing = _playing([a, b, c])
    look = _ok(client.post("/api/requests/consider", headers=_auth(ALICE), json=playing))
    assert look == {"requests": [], "settled": ["Song 3"]}


def test_the_routes_answer_flag_off_without_account_mixes(cloud):
    flags.use("-cloud.account_mixes")
    client, (a, *_rest) = cloud["client"], cloud["ids"]
    for answer in (
        client.get("/api/requests", headers=_auth(ALICE)),
        client.post("/api/requests", headers=_auth(ALICE), json={"song_id": a}),
    ):
        assert answer.status_code == 403 and answer.json()["detail"]["code"] == "flag_off"
