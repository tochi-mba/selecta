"""LF04 durable revisions, optimistic concurrency and tenancy boundaries."""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor

import pytest

from cloud_party import ALICE, BOB, auth
from selecta import flags
from selecta.lf_recipes import store

pytest_plugins = ("cloud_party",)


def _items(count=3):
    return [{"occurrence_id": f"occ{i}", "canonical_track_id": f"track{i}",
             "title": f"Track {i}"} for i in range(count)]


def _created(party):
    return store.create(
        party.engine, party.workspaces[ALICE], "author", name="Persisted",
        occurrences=_items(),
    )


def test_revision_history_restore_and_failed_edit_are_atomic(party):
    first = _created(party)
    ws = party.workspaces[ALICE]
    second = store.edit(
        party.engine, ws, "author", first["recipe_id"],
        base_revision=first["revision_id"], changes={"name": "Edited"},
    )
    third = store.edit(
        party.engine, ws, "author", first["recipe_id"],
        base_revision=second["revision_id"], changes={},
        restore=first["revision_id"],
    )
    assert third["name"] == "Persisted"
    assert third["parent_revision"] == second["revision_id"]
    assert third["revision_id"] != first["revision_id"]
    previous = store.read(party.engine, ws, first["recipe_id"])
    assert [entry["revision"] for entry in previous["history"]] == [
        third["revision_id"], second["revision_id"], first["revision_id"],
    ]
    with pytest.raises(store.RecipeStoreError) as exc:
        store.edit(
            party.engine, ws, "author", first["recipe_id"],
            base_revision=third["revision_id"],
            changes={"occurrences": [
                {"occurrence_id": "same", "canonical_track_id": "a"},
                {"occurrence_id": "same", "canonical_track_id": "b"},
            ]},
        )
    assert exc.value.code == "invalid_recipe"
    assert store.read(party.engine, ws, first["recipe_id"]) == previous


def test_concurrent_offline_editors_get_one_conflict_not_two_heads(party):
    first = _created(party)
    ws = party.workspaces[ALICE]
    def change(name):
        try:
            return store.edit(
                party.engine, ws, name, first["recipe_id"],
                base_revision=first["revision_id"], changes={"name": name},
            )["revision_id"]
        except store.RecipeStoreError as error:
            return error.code
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(change, ("Editor A", "Editor B")))
    assert results.count("stale_revision") == 1
    assert len([value for value in results if value != "stale_revision"]) == 1
    assert len(store.read(party.engine, ws, first["recipe_id"])["history"]) == 2


def test_legacy_endpoints_unchanged_and_new_recipe_tenant_scoped(party):
    first = _created(party)
    flags.use("+cloud.mix_create")
    target = f"/api/cloud-mixes/{first['recipe_id']}?schema_version=2"
    owned = party.client.get(target, headers=auth(ALICE))
    assert owned.status_code == 200, owned.text
    assert owned.json()["recipe"]["revision_id"] == first["revision_id"]
    unknown = party.client.get(target, headers=auth(BOB))
    assert unknown.status_code == 404
    assert unknown.json()["detail"]["code"] == "recipe_not_found"
    unauthorised = party.client.get(target)
    assert unauthorised.status_code == 401
    foreign_workspace = party.client.get(target, headers=auth(BOB, party.workspaces[ALICE]))
    assert foreign_workspace.status_code == 404
    assert foreign_workspace.json()["detail"]["code"] == "workspace_not_found"
    assert party.client.get("/api/cloud-mixes", headers=auth(ALICE)).status_code == 200
    assert party.client.get("/api/cloud-mixes", headers=auth(BOB)).status_code == 200


def test_unverified_device_never_gets_optimistic_ready(party):
    first = _created(party)
    ws = party.workspaces[ALICE]
    result = store.check_availability(
        party.engine, ws, first["recipe_id"], "device-b"
    )
    assert result["counts"]["unknown"] == 3
    assert result["can_run"] is False
    assert result["verified_at"] is None
    assert result["fresh"] is False


def test_failed_backfill_or_unsupported_editor_does_not_mutate_history(party):
    first = _created(party)
    ws = party.workspaces[ALICE]
    before = store.read(party.engine, ws, first["recipe_id"])
    with pytest.raises(store.RecipeStoreError) as exc:
        store.edit(
            party.engine, ws, "author", first["recipe_id"],
            base_revision=first["revision_id"],
            changes={"occurrences": [
                {"occurrence_id": "unsafe", "canonical_track_id": "../wrong"},
            ]},
        )
    assert exc.value.code == "invalid_recipe"
    assert store.read(party.engine, ws, first["recipe_id"]) == before
