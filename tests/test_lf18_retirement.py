"""LF-0481: source inventory, staged gates, no destructive side effects and safe rollback."""

from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path

import pytest

from selecta.lf_fleet.__main__ import main
from selecta.lf_fleet.retirement import (
    REQUIRED_GATES,
    audit_inventory,
    load_manifest,
    retirement_plan,
    validate_rollback_scopes,
)

ROOT = Path(__file__).resolve().parents[1]
NOW = datetime(2026, 11, 13, 21, 0, tzinfo=UTC)


def attestation() -> dict[str, object]:
    return {
        "passed": True, "independent": True, "evidence_id": "LF_EVIDENCE_0001",
        "reviewer_id": "independent_reviewer", "confirmed_at": NOW.isoformat(),
    }


def full_evidence() -> dict[str, object]:
    gates = {gate: attestation() for names in REQUIRED_GATES.values() for gate in names}
    return {"schema_version": 1, "environment": "staging", "gates": gates}


def test_inventory_covers_retire_review_and_critical_retained_services():
    manifest = load_manifest(ROOT)
    by_id = {asset["id"]: asset for asset in manifest["assets"]}
    assert len(by_id) >= 25
    assert by_id["modal-cpu-gpu-export"]["stage"] == "workers"
    assert by_id["r2-originals-backup"]["stage"] == "storage"
    assert by_id["render-control-api-and-gateway"]["classification"] == "mixed"
    for keep in (
        "control-postgres", "control-workos-stripe-ai", "control-api-service",
        "control-cloudflare-pages-waf", "control-db-backup", "control-observability-audit",
    ):
        assert by_id[keep]["classification"] == "retain"
    assert audit_inventory(ROOT) == []


def test_planner_is_non_destructive_and_blocks_all_unauthorised_stages():
    plan = retirement_plan(ROOT, environment="production", now=NOW)
    assert plan["mode"] == "dry-run-only"
    assert plan["destructive_operations_supported"] is False
    assert plan["stages"][0]["reviewable_for_external_approval"] is True
    for stage in plan["stages"][1:]:
        assert stage["reviewable_for_external_approval"] is False
        assert stage["missing_gates"]


def test_full_signed_gate_record_still_cannot_execute_any_operation():
    plan = retirement_plan(ROOT, environment="staging", evidence=full_evidence(), now=NOW)
    assert all(stage["reviewable_for_external_approval"] for stage in plan["stages"])
    assert plan["destructive_operations_supported"] is False


def test_evidence_is_environment_scoped_and_invalid_claims_do_not_count():
    evidence = full_evidence()
    with pytest.raises(ValueError, match="mismatch"):
        retirement_plan(ROOT, environment="production", evidence=evidence, now=NOW)
    evidence["gates"]["legal_holds_cleared"]["independent"] = False
    plan = retirement_plan(ROOT, environment="staging", evidence=evidence, now=NOW)
    storage = next(stage for stage in plan["stages"] if stage["stage"] == "storage")
    assert "legal_holds_cleared" in storage["missing_gates"]
    assert not storage["reviewable_for_external_approval"]
    assert not plan["stages"][-1]["reviewable_for_external_approval"]


def test_missing_source_and_new_unknown_audio_reference_are_found(tmp_path):
    root = tmp_path
    (root / "infra" / "retirement").mkdir(parents=True)
    (root / "services" / "worker").mkdir(parents=True)
    (root / ".github" / "workflows").mkdir(parents=True)
    inventory = {"schema_version": 1, "assets": [{
        "id": "worker", "classification": "audio", "stage": "workers",
        "source_paths": ["infra/modal/worker.py"], "markers": ["modal.App"],
    }]}
    (root / "infra" / "retirement" / "inventory.json").write_text(json.dumps(inventory))
    (root / "infra" / "new_worker.sh").write_text("modal deploy new_worker.py")
    findings = audit_inventory(root)
    codes = {item.code for item in findings}
    assert {"source_missing", "expected_reference_missing", "uncatalogued_audio_reference"} <= codes
    assert not retirement_plan(root, environment="staging", now=NOW)["stages"][0][
        "reviewable_for_external_approval"
    ]


def test_inventory_rejects_path_traversal_and_misclassified_shared_api(tmp_path):
    (tmp_path / "infra" / "retirement").mkdir(parents=True)
    manifest = {"schema_version": 1, "assets": [{
        "id": "bad", "classification": "audio", "stage": "workers",
        "source_paths": ["../../secrets"], "markers": ["secret"],
    }]}
    file = tmp_path / "infra" / "retirement" / "inventory.json"
    file.write_text(json.dumps(manifest))
    with pytest.raises(ValueError):
        load_manifest(tmp_path)
    manifest["assets"][0].update({
        "classification": "mixed", "stage": "workers", "source_paths": ["infra/test.txt"]
    })
    file.write_text(json.dumps(manifest))
    with pytest.raises(ValueError):
        load_manifest(tmp_path)


@pytest.mark.parametrize("scopes", [
    ["audio_uploads"], ["audio_streaming"], ["r2_audio_bucket"],
    ["remote_stems"], ["cloud_control", "*"], ["worker_gateway"],
])
def test_unsafe_rollback_never_restores_media_endpoints(scopes):
    with pytest.raises(ValueError):
        validate_rollback_scopes(scopes, media_purged=False, retrieval_authorised=True)


def test_rollback_is_metadata_only_after_purge_and_legacy_retrieval_is_conditional():
    assert validate_rollback_scopes(
        ["cloud_control", "metadata", "database"], media_purged=True, retrieval_authorised=False
    ) == ("cloud_control", "metadata", "database")
    with pytest.raises(ValueError):
        validate_rollback_scopes(
            ["approved_legacy_retrieval"], media_purged=True, retrieval_authorised=True
        )
    with pytest.raises(ValueError):
        validate_rollback_scopes(
            ["approved_legacy_retrieval"], media_purged=False, retrieval_authorised=False
        )
    assert validate_rollback_scopes(
        ["approved_legacy_retrieval"], media_purged=False, retrieval_authorised=True
    ) == ("approved_legacy_retrieval",)


def test_cli_is_read_only_and_has_no_apply_command(capsys):
    assert main(["audit", "--root", str(ROOT)]) == 0
    output = json.loads(capsys.readouterr().out)
    assert output["mode"] == "read-only" and output["findings"] == []
    assert main(["plan", "--root", str(ROOT), "--environment", "staging"]) == 0
    output = json.loads(capsys.readouterr().out)
    assert output["mode"] == "dry-run-only"
    with pytest.raises(SystemExit):
        main(["apply", "--root", str(ROOT)])


def test_audit_never_embeds_credentials_or_source_lines_in_findings(tmp_path):
    (tmp_path / "infra" / "retirement").mkdir(parents=True)
    (tmp_path / "services" / "worker").mkdir(parents=True)
    (tmp_path / ".github" / "workflows").mkdir(parents=True)
    (tmp_path / "infra" / "retirement" / "inventory.json").write_text(json.dumps({
        "schema_version": 1, "assets": [{
            "id": "test", "classification": "audio", "stage": "workers",
            "source_paths": ["infra/legacy.sh"], "markers": ["modal deploy"],
        }],
    }))
    (tmp_path / "infra" / "legacy.sh").write_text(
        "modal deploy --token=ultra-secret-should-never-appear\n"
    )
    (tmp_path / "infra" / "unexpected.sh").write_text(
        "rclone copy --password=very-private\n"
    )
    findings = audit_inventory(tmp_path)
    text = json.dumps([item.as_dict() for item in findings])
    assert "ultra-secret" not in text and "very-private" not in text
