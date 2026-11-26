"""A Cloud account's mixes and drafts (`cloud.brain` with `cloud.account_mixes`, ADR-0479).

The Desktop's own mix routes answer for Alice from her own tables through the engine store, in
Desktop's shapes; each edit is one write and checks what the page saw; a song not in her library
is refused; Bob sees none of it; her recipes come in as drafts once and are never changed; the
`/cloud-mixes` import maps uploaded files to catalogue songs by hash; with the flag off the routes
answer flag_off. Synthetic catalogue rows only. PostgreSQL's policy is in
tests/test_engine_store_mixes_postgres.py.
"""

# ruff: noqa: F811  (each test takes the `cloud` fixture imported below)
from __future__ import annotations

import pytest
from test_cloud_brain_routes import ALICE, BOB, _auth, cloud  # noqa: F401  (the fixture)

from selecta import flags
from selecta.engine_store import EngineStore, mix_import


@pytest.fixture(autouse=True)
def account_mixes_on():
    flags.use("+cloud.account_mixes")
    yield
    flags.use(None)


def _workspace(cloud) -> str:
    with cloud["engine"].connect() as connection:
        return connection.exec_driver_sql(
            "SELECT workspace_id FROM local_songs WHERE id = ?", (cloud["ids"][0],)
        ).scalar_one()


def _order(answer) -> list[int]:
    assert answer.status_code == 200, answer.text
    return [item["song_id"] for item in answer.json()["mix"]]


def test_the_current_mix_is_made_edited_and_undone_in_desktop_shapes(cloud):
    client, (a, b, c, d, *_rest) = cloud["client"], cloud["ids"]
    empty = client.get("/api/mix", headers=_auth(ALICE))
    assert empty.json() == {"mix": [], "name": "Your mix", "can_undo": False}
    made = client.put(
        "/api/mix/order", headers=_auth(ALICE), json={"song_ids": [a, b, c], "name": "Friday"}
    )
    assert _order(made) == [a, b, c] and made.json()["name"] == "Friday"
    seam = made.json()["mix"][1]["seam"]
    assert seam["state"]["status"] == "none" and seam["settings"].get("move", "auto") == "auto"
    added = client.post("/api/mix/songs", headers=_auth(ALICE), json={"song_id": d, "position": 1})
    assert _order(added) == [a, d, b, c]
    moved = client.post("/api/mix/move", headers=_auth(ALICE), json={"source": 1, "target": 3})
    assert _order(moved) == [a, b, c, d]
    chosen = client.post("/api/mix/2/seam", headers=_auth(ALICE), json={"move": "echo_out"})
    assert chosen.json()["mix"][2]["seam"]["settings"]["move"] == "echo_out"
    # what the page saw is checked: a stale view changes nothing
    stale = client.delete("/api/mix/songs/0", headers={**_auth(ALICE), "x-mix-order": f"{a}"})
    assert stale.status_code == 409 and stale.json()["code"] == "mix_changed"
    undone = client.post("/api/mix/undo", headers=_auth(ALICE))
    assert undone.json()["undone"] == "changing that seam" and undone.json()["can_undo"] is True
    gone = client.delete("/api/mix/songs/0", headers=_auth(ALICE))
    assert _order(gone) == [b, c, d]
    cleared = client.post("/api/mix/clear", headers=_auth(ALICE))
    assert cleared.json()["mix"] == [] and cleared.json()["name"] == "Your mix"


def test_drafts_are_made_listed_renamed_played_deleted_and_restored(cloud):
    client, (a, b, c, *_rest) = cloud["client"], cloud["ids"]
    made = client.post("/api/drafts", headers=_auth(ALICE), json={"name": "Warm up"})
    assert made.status_code == 200, made.text
    draft = made.json()["id"]
    filled = client.put(
        f"/api/mix/order?draft={draft}", headers=_auth(ALICE), json={"song_ids": [a, b]}
    )
    assert _order(filled) == [a, b] and filled.json()["draft"] == {"id": draft, "place": None}
    listed = client.get("/api/drafts", headers=_auth(ALICE)).json()
    (summary,) = listed["drafts"]
    assert summary["name"] == "Warm up" and summary["song_ids"] == [a, b]
    assert summary["seams"] == 1 and listed["out_of_room"] is False
    names = client.get("/api/drafts/names", headers=_auth(ALICE)).json()
    assert names["drafts"] == [{"id": draft, "name": "Warm up"}]
    again = client.post(f"/api/drafts/{draft}/name", headers=_auth(ALICE), json={"name": "Peak"})
    assert again.json() == {"id": draft, "name": "Peak"}
    copy = client.post(f"/api/drafts/{draft}/duplicate", headers=_auth(ALICE)).json()
    assert copy["name"] == "Peak copy"
    client.put("/api/mix/order", headers=_auth(ALICE), json={"song_ids": [c]})
    played = client.post(f"/api/drafts/{draft}/play", headers=_auth(ALICE))
    assert _order(played) == [a, b] and played.json()["name"] == "Peak"
    names = [
        row["name"] for row in client.get("/api/drafts", headers=_auth(ALICE)).json()["drafts"]
    ]
    assert "Peak" not in names and "Your mix" in names  # what was current became a draft
    deleted = client.delete(f"/api/drafts/{copy['id']}", headers=_auth(ALICE))
    assert deleted.json() == {"name": "Peak copy"}
    restored = client.post("/api/drafts/restore", headers=_auth(ALICE))
    assert restored.json() == {"id": copy["id"], "name": "Peak copy"}
    missing = client.get("/api/mix?draft=999999", headers=_auth(ALICE))
    assert missing.status_code == 404
    assert missing.json() == {"detail": "That draft isn't there any more."}


def test_a_song_not_in_the_library_is_refused_and_bob_sees_nothing(cloud):
    client, (a, b, *_rest) = cloud["client"], cloud["ids"]
    client.put("/api/mix/order", headers=_auth(ALICE), json={"song_ids": [a, b]})
    refused = client.post("/api/mix/songs", headers=_auth(BOB), json={"song_id": a})
    assert refused.status_code == 404  # Alice's song is not in Bob's library
    assert client.get("/api/mix", headers=_auth(BOB)).json()["mix"] == []
    assert client.get("/api/drafts", headers=_auth(BOB)).json()["drafts"] == []
    made_up = client.put("/api/mix/order", headers=_auth(ALICE), json={"song_ids": [a, 987654]})
    assert made_up.status_code == 404
    twice = client.put("/api/mix/order", headers=_auth(ALICE), json={"song_ids": [a, a]})
    assert twice.status_code == 422
    unknown = client.post("/api/drafts", headers=_auth(ALICE), json={"name": "x", "path": "/m"})
    assert unknown.status_code == 422  # a body names only what the route takes
    assert _order(client.get("/api/mix", headers=_auth(ALICE))) == [a, b]


def test_recipes_come_in_as_drafts_once_and_are_never_changed(cloud):
    client, (a, b, c, *_rest) = cloud["client"], cloud["ids"]
    flags.use("")  # the browser's saved mixes, made before the account kept mixes
    first = client.post(
        "/api/local-media/recipes",
        headers=_auth(ALICE),
        json={"name": "Old one", "song_ids": [a, b]},
    ).json()["mix"]
    second = client.post(
        "/api/local-media/recipes",
        headers=_auth(ALICE),
        json={"name": "Old one", "song_ids": [b, c]},
    ).json()["mix"]
    client.post(
        f"/api/local-media/recipes/{second['mix_id']}/revisions",
        headers=_auth(ALICE),
        json={"base_revision": second["revision"], "seam_moves": {"1": "echo_out"}},
    )
    client.put("/api/local-media/current", headers=_auth(ALICE), json={"mix_id": first["mix_id"]})
    before = client.get("/api/local-media/recipes", headers=_auth(ALICE)).json()
    flags.use("+cloud.account_mixes")
    drafts = client.get("/api/drafts", headers=_auth(ALICE)).json()["drafts"]
    assert sorted(row["name"] for row in drafts) == ["Old one", "Old one 2"]
    echo = next(row for row in drafts if row["song_ids"] == [b, c])
    seam = client.get(f"/api/mix?draft={echo['id']}", headers=_auth(ALICE)).json()["mix"][1]["seam"]
    assert seam["settings"]["move"] == "echo_out"
    assert _order(client.get("/api/mix", headers=_auth(ALICE))) == [a, b]  # the current one
    # running again makes nothing, and a deleted draft stays deleted
    client.delete(f"/api/drafts/{echo['id']}", headers=_auth(ALICE))
    assert mix_import.import_recipes(EngineStore(cloud["engine"], _workspace(cloud))) == 0
    assert len(client.get("/api/drafts", headers=_auth(ALICE)).json()["drafts"]) == 1
    assert client.get("/api/local-media/recipes", headers=_auth(ALICE)).json() == before


def test_the_cloud_mixes_import_maps_files_to_catalogue_songs_by_hash(cloud, monkeypatch):
    from selecta import cloud_mixes
    from selecta.mix_contract import SongRef, new_contract

    client, (a, b, *_rest) = cloud["client"], cloud["ids"]
    with cloud["engine"].connect() as connection:
        hashes = dict(
            connection.exec_driver_sql(
                "SELECT id, content_sha256 FROM local_songs WHERE id IN (?, ?)", (a, b)
            ).all()
        )
    songs = [
        SongRef(source="cloud", id="asset-1", title="One", sha256=hashes[a]),
        SongRef(source="cloud", id="asset-2", title="Two", sha256=hashes[b]),
        SongRef(source="cloud", id="asset-3", title="Three", sha256="f" * 64),
    ]
    contract = new_contract("cm-1", "Uploaded", "cloud", songs)
    monkeypatch.setattr(cloud_mixes, "_all_revisions", lambda conn, ws: [(contract, 1.0)])
    store = EngineStore(cloud["engine"], _workspace(cloud))
    assert mix_import.import_cloud_mixes(store) == {"drafts": 1, "songs_left_out": 1}
    assert mix_import.import_cloud_mixes(store) == {"drafts": 0, "songs_left_out": 0}
    drafts = client.get("/api/drafts", headers=_auth(ALICE)).json()["drafts"]
    assert [(row["name"], row["song_ids"]) for row in drafts] == [("Uploaded", [a, b])]


def test_the_account_mix_routes_bring_cloud_mixes_in_on_first_use_once(cloud, monkeypatch):
    """Wired as the recipes are: the first use of the routes imports, later uses find nothing
    new, and another workspace's routes never see Alice's Cloud mix."""
    from selecta import cloud_mixes
    from selecta.mix_contract import SongRef, new_contract

    client, (a, *_rest) = cloud["client"], cloud["ids"]
    alice = _workspace(cloud)
    with cloud["engine"].connect() as connection:
        sha = connection.exec_driver_sql(
            "SELECT content_sha256 FROM local_songs WHERE id = ?", (a,)
        ).scalar_one()
    contract = new_contract(
        "cm-2", "From uploads", "cloud", [SongRef(source="cloud", id="asset-1", title="One",
                                                  sha256=sha)]
    )
    looked: list[str] = []

    def revisions(_conn, workspace):
        looked.append(workspace)
        return [(contract, 1.0)] if workspace == alice else []

    monkeypatch.setattr(cloud_mixes, "_all_revisions", revisions)
    drafts = client.get("/api/drafts", headers=_auth(ALICE)).json()["drafts"]
    assert [(row["name"], row["song_ids"]) for row in drafts] == [("From uploads", [a])]
    again = client.get("/api/drafts", headers=_auth(ALICE)).json()["drafts"]
    assert len(again) == 1  # once: nothing new is made on the next use
    assert client.get("/api/drafts", headers=_auth(BOB)).json()["drafts"] == []
    assert set(looked) == {alice, next(ws for ws in looked if ws != alice)}


def test_with_the_flag_off_the_routes_answer_flag_off(cloud):
    flags.use("")
    answer = cloud["client"].get("/api/mix", headers=_auth(ALICE))
    assert answer.status_code == 403 and answer.json()["detail"]["flag"] == "cloud.account_mixes"
    order = cloud["client"].put("/api/mix/order", headers=_auth(ALICE), json={"song_ids": []})
    assert order.status_code == 403


def test_the_export_carries_the_mix_tables(cloud):
    from selecta.cloud_brain.export import kept
    from selecta.persistence import transaction

    client, (a, b, *_rest) = cloud["client"], cloud["ids"]
    client.put("/api/mix/order", headers=_auth(ALICE), json={"song_ids": [a, b]})
    client.post("/api/drafts", headers=_auth(ALICE), json={"name": "Kept"})
    workspace = _workspace(cloud)
    with transaction(cloud["engine"], workspace) as connection:
        rows = kept(connection, workspace)
    assert [row["song_id"] for row in rows["current_mix"]] == [a, b]
    assert [row["name"] for row in rows["drafts"]] == ["Kept"]
    assert {row["key"] for row in rows["mix_values"]} >= {"mix_undo"}
