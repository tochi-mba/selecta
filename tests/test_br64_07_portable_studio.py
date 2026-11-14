"""Browser Studio API parity: metadata-only recipes, conflict fencing, missing media.

These tests exercise real Cloud HTTP routes rather than a parallel in-memory editor.
No recordings are uploaded or copied into the test Cloud account.
"""
from __future__ import annotations

from cloud_party import ALICE, BOB, auth
from selecta import flags

pytest_plugins = ("cloud_party",)


def _occurrences(count=8):
    return [
        {
            "occurrence_id": f"occ_{i}",
            "canonical_track_id": f"track_{i}",
            "recording_version": f"master_{i}",
            "title": f"Song {i}",
            "artist": "Test Artist",
        }
        for i in range(count)
    ]


def test_studio_creates_and_revises_without_cloud_assets(party):
    flags.use("+cloud.mix_create")
    before = party.client.get("/api/cloud-mixes?schema_version=2", headers=auth(ALICE))
    assert before.status_code == 200, before.text
    made = party.client.post(
        "/api/cloud-mixes",
        headers=auth(ALICE),
        json={"schema_version": 2, "name": "Portable set", "occurrences": _occurrences()},
    )
    assert made.status_code == 201, made.text
    first = made.json()["recipe"]
    assert first["schema_version"] == 2
    assert len(first["occurrences"]) == 8
    assert all(item["analysis_valid"] is False for item in first["occurrences"])
    assert "path" not in str(first).lower()

    rid = first["recipe_id"]
    opened = party.client.get(
        f"/api/cloud-mixes/{rid}?schema_version=2", headers=auth(ALICE)
    )
    assert opened.status_code == 200, opened.text
    assert opened.json()["head_revision"] == first["revision_id"]

    # A phone with no local bindings can still reorder and edit the saved recipe.
    reordered = list(reversed(first["occurrences"]))
    changed = party.client.post(
        f"/api/cloud-mixes/{rid}/revisions",
        headers=auth(ALICE),
        json={
            "schema_version": 2,
            "base_revision": first["revision_id"],
            "changes": {
                "name": "Portable set — edited on phone",
                "occurrences": reordered,
                "cues": [],
                "transitions": [],
                "draft": True,
            },
        },
    )
    assert changed.status_code == 201, changed.text
    second = changed.json()["recipe"]
    assert second["revision_id"] != first["revision_id"]
    assert second["parent_revision"] == first["revision_id"]
    assert [t["occurrence_id"] for t in second["occurrences"]] == [
        t["occurrence_id"] for t in reordered
    ]
    opened = party.client.get(
        f"/api/cloud-mixes/{rid}?schema_version=2", headers=auth(ALICE)
    ).json()
    assert [entry["revision"] for entry in opened["history"]][:2] == [
        second["revision_id"], first["revision_id"],
    ]
    assert opened["recipe"]["revision_id"] == second["revision_id"]

    stale = party.client.post(
        f"/api/cloud-mixes/{rid}/revisions",
        headers=auth(ALICE),
        json={
            "schema_version": 2,
            "base_revision": first["revision_id"],
            "changes": {"name": "Should not overwrite"},
        },
    )
    assert stale.status_code == 409
    assert stale.json()["detail"]["code"] == "stale_revision"
    assert party.client.get(
        f"/api/cloud-mixes/{rid}?schema_version=2", headers=auth(ALICE)
    ).json() == opened

    # A signed-in account on another workspace cannot inspect the recipe history.
    foreign = party.client.get(
        f"/api/cloud-mixes/{rid}?schema_version=2", headers=auth(BOB)
    )
    assert foreign.status_code == 404


def test_saved_recipe_is_not_claimed_playable_by_cloud(party):
    flags.use("+cloud.mix_create")
    made = party.client.post(
        "/api/cloud-mixes", headers=auth(ALICE),
        json={"schema_version": 2, "name": "Eight", "occurrences": _occurrences()},
    )
    assert made.status_code == 201
    rid = made.json()["recipe"]["recipe_id"]
    unknown = party.client.get(
        f"/api/cloud-mixes/{rid}?schema_version=2&target_device_id=mobile_1",
        headers=auth(ALICE),
    )
    assert unknown.status_code == 200, unknown.text
    result = unknown.json()
    assert result["availability"]["counts"]["unknown"] == 8
    assert result["availability"]["can_run"] is False
    assert result["recipe"]["revision_id"] == made.json()["recipe"]["revision_id"]
