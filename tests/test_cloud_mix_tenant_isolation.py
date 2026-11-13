"""Cloud mix reads, revisions and source assets are isolated on both database backends."""

from __future__ import annotations

import hashlib

import pytest
import sqlalchemy as sa
from cloud_party import ALICE, BOB, auth, made_up
from selecta import flags
from selecta.persistence import db_now, transaction
from selecta.storage.keys import original_key
from selecta.storage.schema import assets
from selecta.work.schema import artifacts

pytest_plugins = ("cloud_party",)


@pytest.fixture
def alice_mix(party):
    flags.use("+cloud.mix_create")
    alice_ws = party.workspaces[ALICE]
    ids = [made_up(), made_up()]
    with transaction(party.engine, alice_ws) as conn:
        now = db_now(conn)
        for pos, asset_id in enumerate(ids):
            payload = f"alice-track-{pos}".encode()
            conn.execute(assets.insert().values(
                id=asset_id,
                workspace_id=alice_ws,
                original_key=original_key(alice_ws, asset_id),
                size=len(payload),
                sha256=hashlib.sha256(payload).hexdigest(),
                format="flac",
                duration_s=180.0,
                sample_rate=44100,
                channels=2,
                created_at=now,
            ))
    created = party.client.post(
        "/api/cloud-mixes", headers=auth(ALICE),
        json={"name": "Alice private set", "asset_ids": ids},
    )
    assert created.status_code == 201, created.text
    contract = created.json()["mix"]
    return {"party": party, "assets": ids, "mix": contract}


def _revisions(engine, workspace_id):
    with transaction(engine, workspace_id) as conn:
        return sorted(
            (row[0], repr(row[1]))
            for row in conn.execute(
                sa.select(artifacts.c.input_hash, artifacts.c.provenance).where(
                    artifacts.c.workspace_id == workspace_id,
                    artifacts.c.kind == "mix_revision",
                )
            )
        )


def test_cloud_mix_requires_a_signed_in_member_on_every_route(alice_mix):
    party = alice_mix["party"]
    mix_id = alice_mix["mix"]["mix_id"]
    revision = alice_mix["mix"]["revision"]
    cases = (
        ("GET", "/api/cloud-mixes", None),
        ("POST", "/api/cloud-mixes", {"name": "A set", "asset_ids": []}),
        ("GET", "/api/cloud-mixes/capabilities", None),
        ("GET", f"/api/cloud-mixes/{mix_id}", None),
        ("POST", f"/api/cloud-mixes/{mix_id}/revisions",
         {"base_revision": revision, "name": "Unauthorised"}),
    )
    for method, path, body in cases:
        missing = party.client.request(method, path, json=body)
        assert missing.status_code == 401, (method, path, missing.text)
        foreign_workspace = party.client.request(
            method, path, headers=auth(BOB, party.workspaces[ALICE]), json=body,
        )
        assert foreign_workspace.status_code == 404, (
            method, path, foreign_workspace.text
        )
        assert foreign_workspace.json()["detail"]["code"] == "workspace_not_found"


def test_mixes_and_revision_ids_do_not_reveal_another_tenants_data(alice_mix):
    party = alice_mix["party"]
    contract = alice_mix["mix"]
    mix_id = contract["mix_id"]
    revision = contract["revision"]
    alice_ws, bob_ws = party.workspaces[ALICE], party.workspaces[BOB]
    before_alice = _revisions(party.engine, alice_ws)

    alice_list = party.client.get("/api/cloud-mixes", headers=auth(ALICE))
    assert alice_list.status_code == 200
    assert [mix["mix_id"] for mix in alice_list.json()["mixes"]] == [mix_id]
    bob_list = party.client.get("/api/cloud-mixes", headers=auth(BOB))
    assert bob_list.status_code == 200 and bob_list.json()["mixes"] == []

    for method, suffix, body in (
        ("GET", "", None),
        ("POST", "/revisions", {"base_revision": revision, "name": "Stolen"}),
    ):
        def request(candidate, method=method, suffix=suffix, body=body):
            return party.client.request(
                method, f"/api/cloud-mixes/{candidate}{suffix}",
                headers=auth(BOB), json=body,
            )

        another_owner = request(mix_id)
        nonexistent = request(made_up())
        assert another_owner.status_code == 404, another_owner.text
        assert another_owner.json() == nonexistent.json()

    # Bob cannot build a revision using source asset ids from Alice's library.
    foreign_songs = party.client.post(
        "/api/cloud-mixes", headers=auth(BOB),
        json={"name": "Stolen source files", "asset_ids": alice_mix["assets"]},
    )
    assert foreign_songs.status_code == 404, foreign_songs.text
    assert foreign_songs.json()["detail"]["code"] == "song_not_found"
    assert _revisions(party.engine, alice_ws) == before_alice
    assert _revisions(party.engine, bob_ws) == []


def test_owner_can_still_edit_their_mix_after_isolation_checks(alice_mix):
    party = alice_mix["party"]
    contract = alice_mix["mix"]
    mix_id = contract["mix_id"]
    changed = party.client.post(
        f"/api/cloud-mixes/{mix_id}/revisions", headers=auth(ALICE),
        json={"base_revision": contract["revision"], "name": "New name"},
    )
    assert changed.status_code == 201, changed.text
    read = party.client.get(f"/api/cloud-mixes/{mix_id}", headers=auth(ALICE))
    assert read.status_code == 200
    assert read.json()["mix"]["name"] == "New name"
    assert len(read.json()["history"]) == 2
