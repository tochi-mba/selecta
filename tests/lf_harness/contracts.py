"""Schematic contract adapters from the accepted LF ADR; never invent API routes.

The protocol is an integration seam. Actual production adapters must be supplied by
other agents, translated from these design shapes, and independently reviewed.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Protocol, runtime_checkable


class ContractViolation(AssertionError):
    """An observed implementation response violates a documented LF invariant."""


AVAILABILITY_STATES = frozenset({
    "ready", "missing", "candidate", "version_mismatch", "source_disconnected",
    "permission_required", "unsupported", "blocked", "unknown", "cache_invalid",
})
COMMAND_STATES = frozenset({
    "created", "authorised", "queued", "delivered", "accepted", "applied",
    "acknowledged", "rejected", "expired", "superseded", "conflicted", "failed", "unknown",
})
FORBIDDEN_CLOUD_FIELDS = frozenset({
    "local_path", "absolute_path", "file_path", "pcm", "raw_audio", "audio_base64",
    "audio_bytes", "fingerprint", "file_hash", "raw_features", "waveform", "stem_data",
    "lyrics_full", "r2_key", "presigned_url", "storage_url",
})


def _assert_no_forbidden_fields(value: Any, *, prefix: str = "$") -> None:
    if isinstance(value, dict):
        for key, inner in value.items():
            if str(key).lower() in FORBIDDEN_CLOUD_FIELDS:
                raise ContractViolation(f"forbidden cloud field {prefix}.{key}")
            _assert_no_forbidden_fields(inner, prefix=f"{prefix}.{key}")
    elif isinstance(value, (list, tuple)):
        for index, inner in enumerate(value):
            _assert_no_forbidden_fields(inner, prefix=f"{prefix}[{index}]")


def assert_availability_contract(value: dict, *, device_id: str, revision: str,
                                 expected_occurrences: int | None = None) -> None:
    if not isinstance(value, dict):
        raise ContractViolation("availability must be an object")
    _assert_no_forbidden_fields(value)
    if value.get("target_device_id") != device_id or value.get("recipe_revision") != revision:
        raise ContractViolation("availability target/revision mismatch")
    tracks = value.get("tracks")
    if not isinstance(tracks, list):
        raise ContractViolation("availability tracks must be an array")
    if expected_occurrences is not None and len(tracks) != expected_occurrences:
        raise ContractViolation("availability silently omitted occurrences")
    ids: set[str] = set()
    for track in tracks:
        if not isinstance(track, dict) or not isinstance(track.get("occurrence_id"), str):
            raise ContractViolation("missing stable occurrence id")
        if track["occurrence_id"] in ids:
            raise ContractViolation("duplicate occurrence id")
        ids.add(track["occurrence_id"])
        if track.get("state") not in AVAILABILITY_STATES:
            raise ContractViolation(f"unknown availability state: {track.get('state')}")
    if value.get("status") == "ready" and any(t["state"] != "ready" for t in tracks):
        raise ContractViolation("aggregate falsely ready with unavailable recording")
    if value.get("status") == "ready" and not tracks:
        raise ContractViolation("empty catalogue cannot prove recipe readiness")
    if not value.get("last_verified_at") and value.get("last_verified_at") != 0:
        raise ContractViolation("missing verification timestamp")
    if "transition_states" not in value or not isinstance(value["transition_states"], list):
        raise ContractViolation("missing transition readiness")


def assert_command_contract(value: dict, *, target_workspace: str, device_id: str,
                            now: int | None = None) -> None:
    if not isinstance(value, dict):
        raise ContractViolation("command must be an object")
    _assert_no_forbidden_fields(value)
    for key in ("operation_id", "idempotency_key", "actor_id", "zone_id", "command",
                "expected_recipe_revision", "schema_version", "created_at", "expires_at"):
        if key not in value:
            raise ContractViolation(f"missing command field {key}")
    if value.get("workspace_id") != target_workspace or value.get("target_device_id") != device_id:
        raise ContractViolation("cross-tenant or misdirected command")
    if not isinstance(value.get("expected_generation"), int) or value["expected_generation"] < 0:
        raise ContractViolation("generation fence missing or invalid")
    if not isinstance(value["schema_version"], int) or value["schema_version"] < 1:
        raise ContractViolation("invalid schema version")
    if not isinstance(value["arguments"], dict):
        raise ContractViolation("invalid argument map")
    if value["expires_at"] <= value["created_at"]:
        raise ContractViolation("invalid TTL")
    if now is not None and value["expires_at"] <= now:
        raise ContractViolation("command expired before delivery")


def assert_command_result(value: dict, *, local_ack: bool) -> None:
    if not isinstance(value, dict) or value.get("status") not in COMMAND_STATES:
        raise ContractViolation("invalid command result state")
    if not local_ack and value["status"] in {"applied", "acknowledged"}:
        raise ContractViolation("cloud accept/deliver is not actual local application")


@runtime_checkable
class EngineAdapter(Protocol):
    """Host-supplied bridge to actual LF implementation, not simulation.

    No network endpoint paths are prescribed by ADR: implement the bridge once
    Agent 02/03/07/08 etc settle their schema. All methods return observed data.
    """

    def register_engine(self, *, identity: dict, capabilities: dict) -> dict: ...
    def availability(self, *, workspace_id: str, target_device_id: str,
                     recipe: dict, policy_version: int) -> dict: ...
    def dispatch_command(self, *, actor: dict, command: dict) -> dict: ...
    def observed_output(self, *, device_id: str, zone_id: str) -> dict: ...
    def send_cloud_payload(self, *, workspace_id: str, payload: dict) -> dict: ...
    def revoke_device(self, *, workspace_id: str, device_id: str) -> dict: ...


def resolve_adapter(import_path: str) -> EngineAdapter:
    import importlib
    if ":" not in import_path:
        raise ValueError("adapter must be module:factory or module:object")
    name, attribute = import_path.split(":", 1)
    mod = importlib.import_module(name)
    candidate = getattr(mod, attribute)
    adapter = candidate() if isinstance(candidate, type) else candidate
    required = ("register_engine", "availability", "dispatch_command",
                "observed_output", "send_cloud_payload", "revoke_device")
    if not all(callable(getattr(adapter, method, None)) for method in required):
        raise TypeError(f"adapter does not implement required {required}")
    return adapter


def synthetic_recipe(recording_ids: list[str]) -> dict:
    return {
        "recipe_id": "mix-harness", "revision_id": "rev-synthetic-1",
        "parent_revision": None, "schema_version": 2,
        "occurrences": [{"occurrence_id": f"occ-{i + 1}", "canonical_track_id": track}
                        for i, track in enumerate(recording_ids)],
        "seams": [{"from_occurrence_id": f"occ-{i}", "to_occurrence_id": f"occ-{i + 1}",
                   "type": "beatmatched_crossfade", "duration_seconds": 8}
                  for i in range(1, len(recording_ids))],
    }
