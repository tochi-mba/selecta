"""The account's current mix on every device (`cloud.account_mixes`, engine-store-mixes.md).

Each route that changes which mix is current sends `mix.current`, marked `account`, with the
order every device reads back, and no other route does; two devices: the last change stands and
Undo brings the one before back; Bob hears none of Alice's; and an account with both recipes and
`/cloud-mixes` mixes ends, on first use, with every one of them as a draft and its current recipe
as the current mix. Account mixes are on for an account with the cloud library and off for one
without, with no setting anywhere. Synthetic catalogue rows only.
"""

# ruff: noqa: F811  (each test takes the `cloud` fixture imported below)
from __future__ import annotations

import pytest
import sqlalchemy as sa
from cloud_helpers import grant_hosted_media
from test_cloud_brain_routes import ALICE, BOB, _auth, cloud  # noqa: F401  (the fixture)

from selecta import flags
from selecta.flags.matching import Rule, RuleKind
from selecta.persistence import new_id
from selecta.work.schema import outbox_events


@pytest.fixture(autouse=True)
def account_mixes_on(cloud):
    # on for every account with the cloud library: it needs cloud.hosted_media
    grant_hosted_media(cloud["engine"], cloud["app"])
    yield
    flags.use(None)


def _owner_workspace(connection, token: str) -> str:
    """The token's own workspace (the fixture's people sign in as `user_<token>`)."""
    found = connection.execute(
        sa.text(
            "SELECT w.id FROM workspaces w JOIN users u ON u.id = w.owner_user_id"
            " WHERE u.auth_subject = :subject ORDER BY w.created_at"
        ),
        {"subject": f"user_{token}"},
    ).scalars().first()
    assert found is not None
    return found


def _events(cloud, workspace: str) -> list[dict]:
    with cloud["engine"].connect() as connection:
        return list(
            connection.execute(
                sa.select(outbox_events.c.payload)
                .where(outbox_events.c.topic == "mix.current")
                .where(outbox_events.c.workspace_id == workspace)
                .order_by(outbox_events.c.id)
            ).scalars()
        )


def _device(cloud, name: str, token: str = ALICE) -> str:
    answer = cloud["client"].post(
        "/api/devices", headers=_auth(token),
        json={"name": name, "kind": "laptop", "device_id": new_id()},
    )
    assert answer.status_code == 201, answer.text
    return answer.json()["device"]["id"]


def _order(answer) -> list[int]:
    assert answer.status_code == 200, answer.text
    return [item["song_id"] for item in answer.json()["mix"]]


def _joined(songs: list[int]) -> str:
    return ",".join(str(song) for song in songs)


def test_each_change_of_the_current_mix_is_sent_and_nothing_else_is(cloud):
    client, (a, b, c, d, *_rest) = cloud["client"], cloud["ids"]
    with cloud["engine"].connect() as connection:
        alice = _owner_workspace(connection, ALICE)
    phone = _device(cloud, "Phone")
    heard = lambda: _events(cloud, alice)  # noqa: E731

    made = client.put(
        f"/api/mix/order?device_id={phone}", headers=_auth(ALICE),
        json={"song_ids": [a, b, c], "name": "Friday"},
    )
    assert _order(made) == [a, b, c]
    (first,) = heard()
    assert first["account"] is True and first["mix_id"] is None and first["revision"] == 0
    assert first["order"] == _joined([a, b, c]) and first["songs"] == 3
    assert first["name"] == "Friday" and first["updated_by_device_name"] == "Phone"

    # none of these changes which mix is current
    draft = client.post("/api/drafts", headers=_auth(ALICE), json={"name": "Warm up"}).json()["id"]
    client.put(f"/api/mix/order?draft={draft}", headers=_auth(ALICE), json={"song_ids": [d, a]})
    client.post(f"/api/drafts/{draft}/name", headers=_auth(ALICE), json={"name": "Warmer"})
    copy = client.post(f"/api/drafts/{draft}/duplicate", headers=_auth(ALICE)).json()["id"]
    client.delete(f"/api/drafts/{copy}", headers=_auth(ALICE))
    client.post(f"/api/drafts/restore?id={copy}", headers=_auth(ALICE))
    scratch = client.post("/api/drafts", headers=_auth(ALICE), json={"name": "Scratch"}).json()
    scoped = f"?draft={scratch['id']}"
    client.put(f"/api/mix/order{scoped}", headers=_auth(ALICE), json={"song_ids": [b]})
    assert client.post(f"/api/mix/undo{scoped}", headers=_auth(ALICE)).json()["undone"]
    client.post("/api/mix/songs", headers=_auth(ALICE), json={"song_id": d})
    client.get("/api/mix", headers=_auth(ALICE))
    client.get("/api/drafts", headers=_auth(ALICE))
    assert len(heard()) == 1

    played = client.post(f"/api/drafts/{draft}/play", headers=_auth(ALICE))
    assert heard()[-1]["order"] == _joined(_order(played)) and heard()[-1]["name"] == "Warmer"
    assert heard()[-1]["updated_by_device_name"] is None  # no device named
    undone = client.post(f"/api/mix/undo?device_id={phone}", headers=_auth(ALICE))
    assert undone.json()["undone"] == "playing Warmer"
    assert heard()[-1]["order"] == _joined([a, b, c, d]) == _joined(_order(undone))
    cleared = client.post("/api/mix/clear", headers=_auth(ALICE))
    assert _order(cleared) == []
    assert heard()[-1]["order"] == "" and heard()[-1]["songs"] == 0
    assert len(heard()) == 4
    # an Undo with nothing left to undo changes nothing, so says nothing
    while client.post("/api/mix/undo", headers=_auth(ALICE)).json()["undone"]:
        pass
    count = len(heard())
    client.post("/api/mix/undo", headers=_auth(ALICE))
    assert len(heard()) == count


def test_two_devices_the_last_change_stands_and_undo_brings_the_one_before_back(cloud):
    client, (a, b, c, d, *_rest) = cloud["client"], cloud["ids"]
    with cloud["engine"].connect() as connection:
        alice = _owner_workspace(connection, ALICE)
    laptop, phone = _device(cloud, "Laptop"), _device(cloud, "Phone")
    client.put(
        f"/api/mix/order?device_id={laptop}", headers=_auth(ALICE), json={"song_ids": [a, b]}
    )
    client.put(
        f"/api/mix/order?device_id={phone}", headers=_auth(ALICE), json={"song_ids": [c, d]}
    )
    assert _order(client.get("/api/mix", headers=_auth(ALICE))) == [c, d]
    last = _events(cloud, alice)[-1]
    assert last["order"] == _joined([c, d]) and last["updated_by_device_name"] == "Phone"
    # the laptop still shows a, b: an edit made on that view changes nothing
    stale = client.delete(
        "/api/mix/songs/0", headers={**_auth(ALICE), "x-mix-order": _joined([a, b])}
    )
    assert stale.status_code == 409 and stale.json()["code"] == "mix_changed"
    back = client.post(f"/api/mix/undo?device_id={laptop}", headers=_auth(ALICE))
    assert _order(back) == [a, b]
    last = _events(cloud, alice)[-1]
    assert last["order"] == _joined([a, b]) and last["updated_by_device_name"] == "Laptop"


def test_a_device_of_another_account_is_never_named_and_bob_hears_nothing(cloud):
    client, (a, b, *_rest) = cloud["client"], cloud["ids"]
    with cloud["engine"].connect() as connection:
        alice = _owner_workspace(connection, ALICE)
        bob = _owner_workspace(connection, BOB)
    bobs = _device(cloud, "Bob's phone", BOB)
    client.put(
        f"/api/mix/order?device_id={bobs}", headers=_auth(ALICE), json={"song_ids": [a, b]}
    )
    assert _events(cloud, alice)[-1]["updated_by_device_name"] is None
    assert _events(cloud, bob) == []


def test_recipes_and_cloud_mixes_all_become_drafts_on_first_use_and_the_current_mix_stays(
    cloud, monkeypatch
):
    from selecta import cloud_mixes
    from selecta.mix_contract import SongRef, new_contract

    client, (a, b, c, d, *_rest) = cloud["client"], cloud["ids"]
    with cloud["engine"].connect() as connection:
        alice = _owner_workspace(connection, ALICE)
        hashes = dict(
            connection.exec_driver_sql(
                "SELECT id, content_sha256 FROM local_songs WHERE id IN (?, ?, ?)", (b, c, d)
            ).all()
        )
    # the browser's saved mixes and the uploaded-music mixes, made before
    flags.use("-cloud.account_mixes")
    friday = client.post(
        "/api/local-media/recipes", headers=_auth(ALICE),
        json={"name": "Friday", "song_ids": [a, b]},
    ).json()["mix"]
    client.post(
        "/api/local-media/recipes", headers=_auth(ALICE),
        json={"name": "Sunday", "song_ids": [c, d]},
    )
    chosen = client.put(
        "/api/local-media/current", headers=_auth(ALICE), json={"mix_id": friday["mix_id"]}
    )
    assert chosen.status_code == 200, chosen.text
    uploaded = [
        new_contract("cm-1", "Uploaded one", "cloud", [
            SongRef(source="cloud", id="asset-1", title="Two", sha256=hashes[b]),
            SongRef(source="cloud", id="asset-2", title="Three", sha256=hashes[c]),
        ]),
        new_contract("cm-2", "Uploaded two", "cloud", [
            SongRef(source="cloud", id="asset-3", title="Four", sha256=hashes[d]),
        ]),
    ]
    monkeypatch.setattr(
        cloud_mixes, "_all_revisions",
        lambda _conn, ws: [(contract, 1.0) for contract in uploaded] if ws == alice else [],
    )
    flags.use("")  # the build as it ships
    drafts = client.get("/api/drafts", headers=_auth(ALICE)).json()["drafts"]
    assert sorted((row["name"], tuple(row["song_ids"])) for row in drafts) == [
        ("Friday", (a, b)), ("Sunday", (c, d)), ("Uploaded one", (b, c)), ("Uploaded two", (d,)),
    ]
    current = client.get("/api/mix", headers=_auth(ALICE))
    assert _order(current) == [a, b] and current.json()["name"] == "Friday"
    # a later use brings nothing in again, and the import says nothing as the account's mix
    assert len(client.get("/api/drafts", headers=_auth(ALICE)).json()["drafts"]) == 4
    assert [event for event in _events(cloud, alice) if event.get("account")] == []


def test_on_for_an_account_with_the_cloud_library_and_off_for_one_without(cloud):
    """No console or deployment step: the shipped build gives account mixes to the granted
    account, and the one whose grant is taken away is refused as flag_off and hears nothing."""
    client, (a, b, *_rest) = cloud["client"], cloud["ids"]
    with cloud["engine"].connect() as connection:
        alice = _owner_workspace(connection, ALICE)
    flags.use("")
    assert client.get("/api/mix", headers=_auth(BOB)).status_code == 200
    without = Rule(RuleKind.WORKSPACES, {"ids": [alice], "on": False})
    grant_hosted_media(cloud["engine"], cloud["app"], without)
    for answer in (
        client.get("/api/mix", headers=_auth(ALICE)),
        client.put("/api/mix/order", headers=_auth(ALICE), json={"song_ids": [a, b]}),
    ):
        assert answer.status_code == 403, answer.text
        assert answer.json()["detail"]["flag"] == "cloud.account_mixes"
    assert _events(cloud, alice) == []
    assert client.get("/api/mix", headers=_auth(BOB)).status_code == 200
