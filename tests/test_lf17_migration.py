"""LF17 safety, compatibility and recovery tests. All objects and databases are synthetic."""
from __future__ import annotations

import copy
import hashlib
import io
import json
import shutil
import time
import zipfile

import pytest

from cloud_world import HEADERS, add_asset, signed_up
from selecta.cloud_mixes import _store
from selecta.lf_migration import (
    IncompleteInventory,
    LegacyRetrievalDenied,
    LocalPlanJournal,
    MigrationConflict,
    RetrievalGrant,
    VerifiedLocalBinding,
    apply_prepared_plan,
    audit_references,
    collect_inventory,
    deletion_readiness,
    dry_run_report,
    plan_backfill,
    require_grant,
    restore_legacy_revisions,
    rollback_prepared_plan,
    retrieve_original,
)
from selecta.mix_contract import SongRef, new_contract
from selecta.persistence import transaction
from selecta.storage.keys import original_key
from selecta.storage.objects import R2Error


def _contract():
    first = SongRef("cloud", "assetOne", "First")
    second = SongRef("cloud", "assetTwo", "Second")
    return new_contract("mixABC", "Original", "cloud", [first, second])


def _proof(workspace="workspace1"):
    return VerifiedLocalBinding(
        workspace, "assetOne", "canonicalOne", "engineOne",
        "proof-verified-on-device", True, "recording-v1",
    )


def test_idempotent_backfill_and_repeated_occurrences_remain_distinct():
    base = _contract()
    repeated = new_contract(
        "mixABC", "Repeated", "cloud",
        [SongRef("cloud", "assetOne", "A"), SongRef("cloud", "assetOne", "A")],
    )
    inputs = [base.to_json(), repeated.to_json()]
    original = copy.deepcopy(inputs)
    a = plan_backfill("workspace1", inputs, [_proof()])
    b = plan_backfill("workspace1", inputs[::-1], [_proof()])
    assert a == b
    assert inputs == original
    one = next(x for x in a["revisions"] if x["legacy_revision_id"] == repeated.revision)
    assert [x["canonical_track_id"] for x in one["references"]] == ["canonicalOne"] * 2
    assert one["references"][0]["occurrence_id"] != one["references"][1]["occurrence_id"]
    restored = restore_legacy_revisions(a)
    assert {x["revision"] for x in restored} == {x["revision"] for x in inputs}


def test_missing_recording_never_becomes_a_guessed_canonical_reference():
    plan = plan_backfill("workspace1", [_contract().to_json()], [_proof()])
    a, b = plan["revisions"][0]["references"]
    assert a["resolution"] == "verified_on_device"
    assert b["resolution"] == "unresolved"
    assert b["canonical_track_id"] is None
    assert b["legacy_asset_id"] == "assetTwo"


def test_rejects_cross_tenant_evidence_unverified_candidates_and_unsupported_versions():
    with pytest.raises(MigrationConflict, match="cross-tenant"):
        plan_backfill("workspace1", [_contract().to_json()], [_proof("workspace2")])
    with pytest.raises(MigrationConflict, match="candidate"):
        VerifiedLocalBinding("workspace1", "assetOne", "track", "device", "proof", False, "rev")
    invalid = _contract().to_json()
    invalid["version"] = 99
    with pytest.raises(MigrationConflict, match="unsupported"):
        plan_backfill("workspace1", [invalid])
    changed = _contract().to_json()
    changed["songs"][0]["title"] = "tampered"
    with pytest.raises(MigrationConflict, match="invalid"):
        plan_backfill("workspace1", [changed])


def test_old_history_rollback_and_replay_after_interruption(tmp_path, monkeypatch):
    base = _contract()
    later = base.edited(songs=base.songs, name="Edited")
    plan = plan_backfill("workspace1", [base.to_json(), later.to_json()])
    journal = LocalPlanJournal(tmp_path / "migration")
    assert journal.prepare(plan)["state"] == "prepared"
    with pytest.raises(PermissionError):
        journal.checkpoint(plan["plan_id"], base.revision)
    journal.checkpoint(plan["plan_id"], base.revision, approved=True)
    assert journal.checkpoint(plan["plan_id"], base.revision, approved=True)["completed"] == [base.revision]
    assert journal.read(plan["plan_id"])["state"] == "in_progress"

    old_replace = __import__("os").replace
    def crash(*_args):
        raise OSError("simulated process crash")
    monkeypatch.setattr("selecta.lf_migration.backfill.os.replace", crash)
    with pytest.raises(OSError, match="crash"):
        journal.checkpoint(plan["plan_id"], later.revision, approved=True)
    monkeypatch.setattr("selecta.lf_migration.backfill.os.replace", old_replace)
    assert journal.read(plan["plan_id"])["completed"] == [base.revision]

    backup = tmp_path / "offsite-journal"
    shutil.copytree(tmp_path / "migration", backup)
    restored = LocalPlanJournal(backup)
    assert restored.checkpoint(plan["plan_id"], later.revision, approved=True)["state"] == "complete"
    assert [r["revision"] for r in restore_legacy_revisions(plan)] == [
        base.revision, later.revision,
    ]
    assert restored.rollback(plan["plan_id"], approved=True)["state"] == "rolled_back"
    with pytest.raises(MigrationConflict):
        restored.checkpoint(plan["plan_id"], base.revision, approved=True)


def test_journal_detects_plan_checksum_tampering(tmp_path):
    plan = plan_backfill("workspace1", [_contract().to_json()])
    plan["revisions"][0]["references"][0]["canonical_track_id"] = "forged"
    with pytest.raises(MigrationConflict, match="checksum"):
        LocalPlanJournal(tmp_path).prepare(plan)


def test_snapshot_dry_run_r2_missing_object_and_backup_gate(tmp_path, monkeypatch):
    with signed_up(tmp_path, monkeypatch) as world:
        asset_id = add_asset(world.engine, world.objects, world.workspace_id, b"safe music bytes")
        snapshot = collect_inventory(world.engine, world.workspace_id, objects=world.objects)
        assert snapshot["assets"][0]["id"] == asset_id
        assert snapshot["missing_objects"] == []
        assert snapshot["object_scan_complete"] is True
        assert dry_run_report(snapshot)["legacy_originals"] == 1
        audit = deletion_readiness(snapshot, gates={})
        assert not audit["ready_for_manual_review"]
        assert audit["destruction_authorized"] is False
        assert "backup_manifest_unavailable" in audit["blockers"]
        assert "active_legacy_assets" in audit["blockers"]
        assert world.objects.count("delete_object") == 0

        world.objects.objects.pop(("sel-originals", original_key(world.workspace_id, asset_id)))
        missing = collect_inventory(world.engine, world.workspace_id, objects=world.objects)
        assert len(missing["missing_objects"]) == 1
        assert "historical_objects_missing" in deletion_readiness(missing)["blockers"]


def test_incomplete_r2_scan_fails_closed(tmp_path, monkeypatch):
    with signed_up(tmp_path, monkeypatch) as world:
        add_asset(world.engine, world.objects, world.workspace_id, b"original")
        world.objects.fail_next("list_objects_v2", RuntimeError("partition"))
        with pytest.raises(IncompleteInventory):
            collect_inventory(world.engine, world.workspace_id, objects=world.objects)


def test_cross_tenant_asset_dangling_reference_and_corrupted_revision_audit():
    rev = _contract().to_json()
    snapshot = {
        "workspace_id": "workspace1",
        "assets": [{"id": "assetOne", "workspace_id": "workspace1", "deleted_at": None}],
        "mix_revisions": [{
            "revision": rev["revision"], "contract": rev, "protected": True,
        }],
        "issues": [], "missing_objects": [], "orphan_objects": [],
        "subscriptions": [{"id": "sub"}], "plan_versions": [],
    }
    report = audit_references(snapshot, known_foreign_asset_ids=["assetTwo"])
    assert len(report["unresolved"]) == 1
    assert report["unresolved"][0]["reason"] == "cross_tenant_asset"
    assert any(e["kind"] == "cross_tenant_asset" for e in report["issues"])
    assert not deletion_readiness(snapshot)["ready_for_manual_review"]
    bad = copy.deepcopy(snapshot)
    bad["mix_revisions"][0]["contract"]["revision"] = "0" * 64
    assert any(e["kind"] == "revision_identity_mismatch" for e in audit_references(bad)["issues"])


def test_grant_is_workspace_bounded_revocable_and_time_limited():
    grant = RetrievalGrant("workspace1", "admin", 1_000, 1_100, "notice-v1")
    require_grant(grant, "workspace1", now=1_005)
    for workspace, when in (("workspace2", 1_005), ("workspace1", 1_100)):
        with pytest.raises(LegacyRetrievalDenied):
            require_grant(grant, workspace, now=when)
    with pytest.raises(LegacyRetrievalDenied):
        require_grant(None, "workspace1", now=1_005)
    with pytest.raises(LegacyRetrievalDenied):
        require_grant(RetrievalGrant("workspace1", "admin", 1, 20, "n", True),
                      "workspace1", now=5)


def test_approved_legacy_retrieval_integrity_and_cross_tenant_refusal(tmp_path, monkeypatch):
    with signed_up(tmp_path, monkeypatch) as world:
        payload = b"old and user-owned audio" * 7
        asset_id = add_asset(world.engine, world.objects, world.workspace_id, payload)
        row = dict(collect_inventory(world.engine, world.workspace_id)["assets"][0])
        grant = RetrievalGrant(world.workspace_id, "security", 100, 500, "notice-v1")
        dest = tmp_path / "retrieved.wav"
        result = retrieve_original(world.objects, grant, workspace_id=world.workspace_id,
                                   asset=row, destination=dest, now=101)
        assert result["verified"] and dest.read_bytes() == payload
        with pytest.raises(LegacyRetrievalDenied):
            retrieve_original(world.objects, grant, workspace_id="someoneelse", asset=row,
                              destination=tmp_path / "foreign.wav", now=101)
        # Failure cleans a new destination rather than leaving a plausible corrupt file.
        world.objects.objects.pop(("sel-originals", original_key(world.workspace_id, asset_id)))
        with pytest.raises(R2Error):
            retrieve_original(world.objects, grant, workspace_id=world.workspace_id,
                              asset=row, destination=tmp_path / "gone.wav", now=101)


def test_metadata_account_export_retains_revision_history_without_r2_get(tmp_path, monkeypatch):
    with signed_up(tmp_path, monkeypatch) as world:
        a = add_asset(world.engine, world.objects, world.workspace_id, b"private original")
        checksum = hashlib.sha256(b"private original").hexdigest()
        first = new_contract(
            "mixABC", "Original", "cloud",
            [SongRef("cloud", a, "Track", sha256=checksum),
             SongRef("cloud", a, "Again", sha256=checksum)],
        )
        second = first.edited(songs=first.songs, name="Second")
        with transaction(world.engine, world.workspace_id) as conn:
            _store(conn, world.workspace_id, first, world.user_id)
            _store(conn, world.workspace_id, second, world.user_id)
        world.objects.calls.clear()
        response = world.client.get("/api/account/export?mode=metadata", headers=HEADERS)
        assert response.status_code == 200, response.text
        assert response.headers["x-selecta-export-mode"] == "metadata"
        assert not any(c[0] in ("head_object", "get_object") for c in world.objects.calls)
        with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
            assert not any(name.startswith("originals/") for name in archive.namelist())
            manifest = json.loads(archive.read("manifest.json"))
            mixes = json.loads(archive.read("mixes.json"))
            assets = json.loads(archive.read("assets.json"))
        assert manifest["mode"] == "metadata_only"
        assert len(mixes["mixes"]) == 2
        assert {m["revision"] for m in mixes["mixes"]} == {first.revision, second.revision}
        assert all(m["protected"] for m in mixes["mixes"])
        assert assets[0]["local_original_included"] is False
        assert assets[0]["legacy_asset_id"] == a


def test_old_client_export_keeps_legacy_archive_until_cutover(tmp_path, monkeypatch):
    with signed_up(tmp_path, monkeypatch) as world:
        asset_id = add_asset(world.engine, world.objects, world.workspace_id, b"legacy")
        response = world.client.get("/api/account/export", headers=HEADERS)
        assert response.status_code == 200
        assert response.headers["x-selecta-export-mode"] == "legacy"
        with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
            assert any(name.startswith("originals/" + asset_id) for name in archive.namelist())


class _ProjectionWriter:
    recipe_schema = "selecta.lf04.recipe-test/1"

    def __init__(self):
        self.migrated = {}
        self.calls = 0
        self.crash_after_upsert = False

    def upsert_sidecar(self, workspace_id, revision, sidecar, *, idempotency_key):
        self.calls += 1
        assert sidecar["legacy_contract"]["revision"] == revision
        assert workspace_id == "workspace1"
        self.migrated[idempotency_key] = copy.deepcopy(sidecar)
        if self.crash_after_upsert:
            self.crash_after_upsert = False
            raise RuntimeError("connection lost after commit")

    def rollback_sidecar(self, workspace_id, revision, *, idempotency_key):
        assert workspace_id == "workspace1"
        self.migrated.pop(idempotency_key, None)


def test_agent04_adapter_refuses_unapproved_or_version_mismatched_writes(tmp_path):
    plan = plan_backfill("workspace1", [_contract().to_json()])
    journal = LocalPlanJournal(tmp_path)
    journal.prepare(plan)
    writer = _ProjectionWriter()
    with pytest.raises(PermissionError):
        apply_prepared_plan(journal, plan["plan_id"], writer,
                            expected_recipe_schema=writer.recipe_schema)
    with pytest.raises(MigrationConflict, match="schema mismatch"):
        apply_prepared_plan(journal, plan["plan_id"], writer,
                            expected_recipe_schema="incorrect", approved=True)
    assert writer.migrated == {}


def test_adapter_crash_after_commit_replay_then_compensating_rollback(tmp_path):
    base = _contract()
    later = base.edited(songs=base.songs, name="Edited")
    plan = plan_backfill("workspace1", [base.to_json(), later.to_json()])
    journal = LocalPlanJournal(tmp_path)
    journal.prepare(plan)
    writer = _ProjectionWriter()
    writer.crash_after_upsert = True
    with pytest.raises(RuntimeError, match="connection lost"):
        apply_prepared_plan(journal, plan["plan_id"], writer,
                            expected_recipe_schema=writer.recipe_schema, approved=True)
    assert len(writer.migrated) == 1
    assert journal.read(plan["plan_id"])["completed"] == []
    assert apply_prepared_plan(journal, plan["plan_id"], writer,
                               expected_recipe_schema=writer.recipe_schema,
                               approved=True)["state"] == "complete"
    assert len(writer.migrated) == 2
    assert rollback_prepared_plan(journal, plan["plan_id"], writer,
                                 expected_recipe_schema=writer.recipe_schema,
                                 approved=True)["state"] == "rolled_back"
    assert writer.migrated == {}
    assert {r["revision"] for r in restore_legacy_revisions(plan)} == {
        base.revision, later.revision,
    }
