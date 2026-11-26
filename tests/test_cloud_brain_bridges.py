"""Find a bridge for a Cloud account's request (`cloud_brain.bridge_routes`, T-20261126-0ae3).

The Desktop's search (`request_planner.bridge_options`) over the account's stored song facts, in
the Desktop route's shape: the same options the planner core gives for the same songs, bounded
(a library past the cap is searched over the songs nearest in tempo and says so), only over the
songs a browser names as playing on it, never Bob's, and refused with its flags off. Synthetic
catalogue rows and facts only.
"""

# ruff: noqa: F811  (each test takes the `cloud` fixture imported below)
from __future__ import annotations

import pytest
from cloud_helpers import grant_hosted_media
from test_cloud_brain_routes import ALICE, BOB, _auth, _infos, cloud  # noqa: F401  (the fixture)

from selecta import flags
from selecta.cloud_brain import bridge_routes
from selecta.planner_core.memory import SeamMemory
from selecta.request_planner import PairBook, bridge_options


@pytest.fixture(autouse=True)
def account_mixes_on(cloud):
    # on for every account with the cloud library: it needs cloud.hosted_media
    grant_hosted_media(cloud["engine"], cloud["app"])
    yield
    flags.use(None)


def _asked(cloud, mix: list[int], song: int) -> int:
    client = cloud["client"]
    made = client.put("/api/mix/order", headers=_auth(ALICE), json={"song_ids": mix})
    assert made.status_code == 200, made.text
    answer = client.post("/api/requests", headers=_auth(ALICE), json={"song_id": song})
    assert answer.status_code == 200, answer.text
    return answer.json()["id"]


def test_the_search_is_the_desktops_over_the_same_songs(cloud):
    client, ids = cloud["client"], cloud["ids"]
    mix, wanted = ids[:3], ids[7]
    request_id = _asked(cloud, mix, wanted)
    answer = client.post(
        f"/api/requests/{request_id}/bridges", headers=_auth(ALICE),
        json={"order": mix, "position": 0},
    )
    assert answer.status_code == 200, answer.text
    body = answer.json()
    rows = client.get("/api/requests", headers=_auth(ALICE)).json()["requests"]
    items = [(song, None, 0) for song in mix]
    songs = _infos(ids)
    direct = bridge_options(
        rows[0], rows, items, songs, 1, SeamMemory(), lambda _key: {"status": "none"},
        "never", book=PairBook(), allowed=set(ids),
    )
    assert [option["song_ids"] for option in body["options"]] == [
        route["songs"] for route in direct["routes"]
    ]
    assert (body["looked_at"], body["direct"]) == (direct["looked_at"], direct["direct"])
    assert body["capped"] is False and body["measured"] == len(ids)
    for option in body["options"]:
        assert all("key" not in transition for transition in option["transitions"])


def test_only_the_songs_named_and_a_bounded_number_are_looked_at(cloud, monkeypatch):
    client, ids = cloud["client"], cloud["ids"]
    request_id = _asked(cloud, ids[:3], ids[7])
    named = client.post(
        f"/api/requests/{request_id}/bridges", headers=_auth(ALICE),
        json={"songs": [ids[7]]},
    ).json()
    assert named["options"] == [] and named["measured"] == 1
    monkeypatch.setattr(bridge_routes, "MOST_SONGS", 2)
    capped = client.post(f"/api/requests/{request_id}/bridges", headers=_auth(ALICE), json={})
    assert capped.status_code == 200, capped.text
    assert capped.json()["capped"] is True and capped.json()["measured"] == len(ids)
    for option in capped.json()["options"]:
        assert len([song for song in option["songs"] if song["bridge"]]) <= 2


def test_clear_refusals_and_another_account(cloud):
    client, ids = cloud["client"], cloud["ids"]
    first = client.post("/api/requests", headers=_auth(ALICE), json={"song_id": ids[7]}).json()
    no_mix = client.post(f"/api/requests/{first['id']}/bridges", headers=_auth(ALICE), json={})
    assert no_mix.status_code == 409
    request_id = _asked(cloud, ids[:3], ids[7])
    assert client.post(
        f"/api/requests/{request_id}/bridges", headers=_auth(BOB), json={}
    ).status_code == 409
    named = client.post("/api/requests/abc/bridges", headers=_auth(ALICE), json={})
    assert named.status_code == 404
    extra = client.post(
        f"/api/requests/{request_id}/bridges", headers=_auth(ALICE), json={"path": "x"}
    )
    assert extra.status_code == 422


@pytest.mark.parametrize("off", ["-cloud.account_mixes", "+cloud.account_mixes -requests.bridges"])
def test_the_search_answers_flag_off(cloud, off):
    flags.use(off)
    answer = cloud["client"].post("/api/requests/1/bridges", headers=_auth(ALICE), json={})
    assert answer.status_code == 403
