"""Cloud mix reads, revisions and source assets are isolated on both database backends."""

from __future__ import annotations

import hashlib

import pytest
import sqlalchemy as sa
from cloud_party import ALICE, BOB, auth, made_up

from selecta import flags
from selecta.audit import invariants
from selecta.persistence import db_now, transaction
from selecta.storage.keys import original_key
from selecta.storage.schema import assets
from selecta.work import provenance
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


def _mix_artifacts(engine, workspace_id):
    with transaction(engine, workspace_id) as conn:
        return conn.execute(
            sa.select(artifacts).where(
                artifacts.c.workspace_id == workspace_id,
                artifacts.c.kind == "mix_revision",
            )
        ).all()


def test_new_mix_manifest_is_valid_and_records_its_actual_source_hashes(alice_mix):
    party = alice_mix["party"]
    workspace_id = party.workspaces[ALICE]
    rows = _mix_artifacts(party.engine, workspace_id)
    assert len(rows) == 1
    row = rows[0]
    provenance.check_output(row)
    assert row.protected is True
    assert row.input_hash == alice_mix["mix"]["revision"]
    assert row.provenance["settings"]["contract"]["revision"] == alice_mix["mix"]["revision"]
    # The response adds availability to each song; the persisted contract does not.
    assert all("available" not in song for song in row.provenance["settings"]["contract"]["songs"])
    with transaction(party.engine, workspace_id) as conn:
        hashes = dict(conn.execute(
            sa.select(assets.c.id, assets.c.sha256).where(
                assets.c.id.in_(alice_mix["assets"]),
                assets.c.workspace_id == workspace_id,
            )
        ))
    assert row.provenance["inputs"] == {
        "songs": [hashes[asset_id] for asset_id in alice_mix["assets"]],
    }
    invariants.assert_clean(party.engine)


def test_edited_mix_manifest_links_to_parent_without_overwriting_history(alice_mix):
    party = alice_mix["party"]
    workspace_id = party.workspaces[ALICE]
    first = alice_mix["mix"]
    changed = party.client.post(
        f"/api/cloud-mixes/{first['mix_id']}/revisions", headers=auth(ALICE),
        json={"base_revision": first["revision"], "name": "Second revision"},
    )
    assert changed.status_code == 201, changed.text
    second = changed.json()["mix"]
    by_revision = {row.input_hash: row for row in _mix_artifacts(party.engine, workspace_id)}
    assert set(by_revision) == {first["revision"], second["revision"]}
    for row in by_revision.values():
        provenance.check_output(row)
        assert row.protected is True
    assert "parent" not in by_revision[first["revision"]].provenance["inputs"]
    assert by_revision[second["revision"]].provenance["inputs"]["parent"] == first["revision"]
    assert by_revision[second["revision"]].provenance["settings"]["contract"]["name"] == (
        "Second revision"
    )
    assert party.client.get(
        f"/api/cloud-mixes/{first['mix_id']}", headers=auth(BOB)
    ).status_code == 404
    assert not _mix_artifacts(party.engine, party.workspaces[BOB])
    invariants.assert_clean(party.engine)


@pytest.mark.parametrize("corruption", ["creator", "checksum", "keys"])
@pytest.mark.invariants_off("deliberately corrupts a provenance row to test the read boundary")
def test_a_tampered_revision_is_never_read_as_a_valid_mix(alice_mix, corruption):
    party = alice_mix["party"]
    workspace_id = party.workspaces[ALICE]
    row = _mix_artifacts(party.engine, workspace_id)[0]
    if corruption == "creator":
        bad = dict(row.provenance)
        bad["settings"] = {**bad["settings"], "by": ""}
        bad["settings_hash"] = provenance.settings_hash(bad["settings"])
        updates = {"provenance": bad}
    elif corruption == "checksum":
        updates = {"checksum": "f" * 64}
    else:
        updates = {"keys": ["w/other/invalid-key"]}
    with transaction(party.engine, workspace_id) as conn:
        conn.execute(
            artifacts.update().where(artifacts.c.id == row.id).values(**updates)
        )
    own = party.client.get(
        f"/api/cloud-mixes/{alice_mix['mix']['mix_id']}", headers=auth(ALICE)
    )
    assert own.status_code == 404, own.text
    with party.engine.connect() as conn:
        assert any(item.invariant == 5 for item in invariants.check(conn))
