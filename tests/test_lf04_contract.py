"""LF04 contract and device-availability invariants; uses no real music."""
from __future__ import annotations

from dataclasses import replace

import pytest

from selecta.lf_recipes.contract import (
    AvailabilityState as State, Cue, DeviceBinding, DeviceInventory,
    Occurrence, Recipe, RecipeError, Transition, availability, from_legacy,
    new_recipe, parse_recipe,
)
from selecta.mix_contract import ContractError, SongRef, from_json, new_contract


def _tracks(count=8):
    return [
        {"occurrence_id": f"occ{i}", "canonical_track_id": f"track{i}",
         "title": f"Song {i}", "recording_version": "v1"}
        for i in range(count)
    ]


class Resolver:
    def __init__(self, snapshot):
        self.snapshot = snapshot
        self.requested = None

    def resolve(self, workspace_id, target_device_id, canonical_track_ids):
        self.requested = (workspace_id, target_device_id, canonical_track_ids)
        return self.snapshot


def _snapshot(states, *, expires_at=200, device_id="device-b"):
    return DeviceInventory(
        workspace_id="tenant-a", target_device_id=device_id,
        verified_at=100, expires_at=expires_at,
        bindings=tuple(
            DeviceBinding(f"track{i}", state, recording_version="v1")
            for i, state in enumerate(states)
        ),
        policy_version="p1",
    )


def test_eight_track_device_transfer_is_truthful_and_does_not_change_saved_revision():
    recipe = new_recipe("Eight songs", _tracks())
    original = recipe.revision_id
    states = [State.READY] * 5 + [State.MISSING] * 2 + [State.CANDIDATE]
    resolver = Resolver(_snapshot(states))
    status = availability(recipe, "tenant-a", "device-b", resolver, now=110)
    assert status["counts"] == {
        "ready": 5, "missing": 2, "candidate": 1,
        "version_mismatch": 0, "blocked": 0, "unknown": 0,
    }
    assert status["can_run"] is False
    assert status["fresh"] is True
    assert [row["state"] for row in status["tracks"]] == [item.value for item in states]
    assert status["target_device_id"] == "device-b"
    assert recipe.revision_id == original
    assert [o.canonical_track_id for o in recipe.occurrences] == [
        f"track{i}" for i in range(8)
    ]
    assert resolver.requested == (
        "tenant-a", "device-b", tuple(f"track{i}" for i in range(8))
    )
    assert "path" not in str(recipe.to_json()).lower()
    assert "sha256" not in str(status).lower()


def test_stale_and_wrong_workspace_device_reports_are_unknown_not_missing_or_ready():
    recipe = new_recipe("Eight songs", _tracks())
    for snapshot in (
        _snapshot([State.READY] * 8, expires_at=109),
        _snapshot([State.READY] * 8, device_id="other-device"),
        replace(_snapshot([State.READY] * 8), workspace_id="tenant-b"),
    ):
        status = availability(recipe, "tenant-a", "device-b", Resolver(snapshot), now=110)
        assert status["counts"]["unknown"] == 8
        assert status["verified_at"] is None
        assert status["can_run"] is False
    assert availability(recipe, "tenant-a", "device-b", None, now=110)["counts"]["unknown"] == 8


def test_candidates_mismatch_blocked_and_missing_remain_distinct():
    recipe = new_recipe("Mix", _tracks(4))
    status = availability(
        recipe, "tenant-a", "device-b",
        Resolver(_snapshot([
            State.CANDIDATE, State.BLOCKED, State.MISSING, State.READY,
        ])), now=110,
    )
    assert status["counts"]["candidate"] == 1
    assert status["counts"]["blocked"] == 1
    assert status["counts"]["missing"] == 1
    assert status["counts"]["ready"] == 1
    altered = replace(recipe, occurrences=(
        *recipe.occurrences[:3],
        replace(recipe.occurrences[3], recording_version="v2"),
    ))
    mismatched = availability(
        altered, "tenant-a", "device-b",
        Resolver(_snapshot([State.READY] * 4)), now=110,
    )
    assert mismatched["counts"]["version_mismatch"] == 1


def test_duplicate_recordings_have_distinct_stable_occurrence_ids():
    song = {"canonical_track_id": "track-one", "title": "Same recording"}
    recipe = new_recipe("Duplicate", [
        {"occurrence_id": "first", **song}, {"occurrence_id": "second", **song},
    ])
    assert [o.occurrence_id for o in recipe.occurrences] == ["first", "second"]
    changed = recipe.edited(occurrences=tuple(reversed(recipe.occurrences)))
    assert [o.occurrence_id for o in changed.occurrences] == ["second", "first"]
    assert recipe.occurrences[0].occurrence_id == "first"
    assert parse_recipe(changed.to_json()).revision_id == changed.revision_id


def test_recording_change_invalidates_related_cue_transition_and_analysis_only():
    recipe = new_recipe("Mix", _tracks(3))
    initial = replace(
        recipe,
        occurrences=tuple(replace(o, analysis_valid=True) for o in recipe.occurrences),
        cues=(Cue("occ0", 3, "source_seconds"), Cue("occ1", 8, "beats"), Cue("occ2", 12, "beats")),
        transitions=(
            Transition("occ0", "occ1", "crossfade", 4, False),
            Transition("occ1", "occ2", "crossfade", 4, False),
        ),
    )
    updated = initial.edited(occurrences=[
        *initial.occurrences[:1],
        replace(initial.occurrences[1], recording_version="v2"),
        initial.occurrences[2],
    ])
    assert updated.occurrences[0].analysis_valid is True
    assert updated.occurrences[1].analysis_valid is False
    assert updated.occurrences[2].analysis_valid is True
    assert all(seam.requires_rebuild for seam in updated.transitions)
    assert [cue.requires_revalidation for cue in updated.cues] == [False, True, False]
    assert updated.parent_revision == initial.revision_id
    assert initial.transitions[0].requires_rebuild is False


def test_recipe_rejects_unknown_version_tampered_digest_or_media_paths():
    recipe = new_recipe("Mix", _tracks(2))
    for patch in (
        {"schema_version": 3},
        {"schema_version": True},
        {"revision_id": "0" * 64},
        {"local_path": "C:/my_music/song.wav"},
    ):
        with pytest.raises(RecipeError):
            parse_recipe({**recipe.to_json(), **patch})
    with pytest.raises(RecipeError):
        new_recipe("Unsafe", [
            {"canonical_track_id": "../music/private.flac"},
        ])
    with pytest.raises(RecipeError):
        new_recipe("Unsafe", [
            {"canonical_track_id": "a" * 64},
        ])
    bad = recipe.to_json()
    bad["occurrences"][0]["path"] = "/private/song.flac"
    with pytest.raises(RecipeError):
        parse_recipe(bad)


def test_virtual_legacy_conversion_keeps_old_contract_and_never_invents_track():
    songs = [
        SongRef("cloud", "old-asset-one", "Song A", sha256="a" * 64),
        SongRef("cloud", "old-asset-one", "Song A", sha256="a" * 64),
    ]
    legacy = new_contract("old-mix", "Historical", "cloud", songs)
    before = legacy.to_json()
    first = from_legacy(legacy)
    second = from_legacy(legacy)
    assert first.to_json() == second.to_json()
    assert first.occurrences[0].occurrence_id != first.occurrences[1].occurrence_id
    assert all(item.canonical_track_id is None for item in first.occurrences)
    assert all(item.legacy_asset_id == "old-asset-one" for item in first.occurrences)
    assert legacy.to_json() == before
    assert "sha256" not in str(first.to_json())
    legacy_bad = {**legacy.to_json(), "version": 42}
    with pytest.raises(ContractError):
        from_json(legacy_bad)
