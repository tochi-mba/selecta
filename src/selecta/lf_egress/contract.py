"""Strict metadata-only cloud payload contracts (ADR-0457).

Use validate_envelope() at each cloud egress/ingress integration boundary.
A typed field allowlist is mandatory: unknown fields never silently become data
transport. Content inspection is a secondary defence, not a substitute for schemas.
"""
from __future__ import annotations

import base64
import binascii
import json
import math
import re
from enum import StrEnum
from typing import Any, Mapping


class PayloadKind(StrEnum):
    RECIPE = "recipe"
    CONTROL = "control"
    CATALOGUE = "catalogue"
    AVAILABILITY = "availability"
    SCHEDULE = "schedule"
    PLAY_LOG = "play_log"
    AI_PLAN = "ai_plan"
    DIAGNOSTIC = "diagnostic"


class PayloadRejected(ValueError):
    """Stable public code; never embed untrusted content in exception text or logs."""

    def __init__(self, code: str = "metadata_rejected") -> None:
        self.code = code
        super().__init__(code)


# All fields in nested objects are subject to the same per-kind allowlist. The
# contract intentionally has no extensible arbitrary JSON/attachments/debug fields.
_FIELDS: dict[PayloadKind, frozenset[str]] = {
    PayloadKind.RECIPE: frozenset({
        "recipe_id", "revision_id", "parent_revision_id", "occurrences", "occurrence_id",
        "recording_ref", "position", "cue_in_ms", "cue_out_ms", "transition_ms",
        "transition_kind", "timebase", "bpm", "key", "title", "artist",
        "notes", "status", "created_at", "updated_at", "cues", "transitions",
        "source_revision", "intent", "expected_duration_ms", "confidence",
    }),
    PayloadKind.CONTROL: frozenset({
        "operation_id", "actor_id", "device_id", "zone_id", "recipe_revision_id",
        "generation", "expected_generation", "expiry", "idempotency_key",
        "command", "state", "status", "reason_code", "position_ms", "volume",
        "parameters", "target_device_id", "sequence", "issued_at", "applied_at",
        "recording_ref", "transition_ms",
    }),
    PayloadKind.CATALOGUE: frozenset({
        "recordings", "recording_ref", "title", "artist", "album", "duration_ms",
        "bpm", "key", "genre", "explicit", "year", "availability",
        "device_id", "zone_id", "last_verified_at", "state", "count", "revision",
    }),
    PayloadKind.AVAILABILITY: frozenset({
        "device_id", "zone_id", "recording_ref", "state", "verified_at",
        "expires_at", "confidence", "total", "ready", "missing", "blocked",
        "candidate", "engine_state", "output_state", "generation",
    }),
    PayloadKind.SCHEDULE: frozenset({
        "schedule_id", "zone_id", "device_id", "timezone", "dayparts",
        "day", "start_time", "end_time", "recipe_id", "revision_id",
        "enabled", "policy", "state", "effective_at", "priority",
    }),
    PayloadKind.PLAY_LOG: frozenset({
        "event_id", "device_id", "zone_id", "recording_ref", "recipe_revision_id",
        "started_at", "ended_at", "duration_ms", "state", "reason_code",
        "generation", "position_ms",
    }),
    PayloadKind.AI_PLAN: frozenset({
        "plan_id", "intent", "constraints", "recording_ref", "recordings",
        "recipe_id", "revision_id", "occurrences", "occurrence_id",
        "transition_ms", "bpm", "key", "title", "artist", "duration_ms",
        "status", "reason_code", "confidence", "sequence", "steps",
        "position", "action", "operation_id",
    }),
    PayloadKind.DIAGNOSTIC: frozenset({
        "event_id", "device_id", "zone_id", "timestamp", "category",
        "reason_code", "engine_state", "connection_state", "queue_depth",
        "memory_pressure", "cpu_percent", "job_count", "uptime_seconds",
        "version", "state", "last_seen_at",
    }),
}
_MAX_BYTES = 64 * 1024
_MAX_DEPTH = 8
_MAX_ENTRIES = 128
_MAX_STRING = 512
_MAX_KEY = 64
_FORBIDDEN_KEY = re.compile(
    r"(?:^|_)(?:audio|pcm|stem|stems|sample|samples|waveform|waveforms|"
    r"lyric|lyrics|fingerprint|fingerprints|hash|sha256|digest|"
    r"file|filename|filepath|path|export|exports|clip|clips|"
    r"attachment|attachments|payload|binary|blob|base64|encoded|"
    r"traceback|stacktrace|dump|raw|spectrogram|embedding|"
    r"secret|token|authorization|credentials)(?:_|$)",
    re.IGNORECASE,
)
_LOCAL_PATH = re.compile(
    r"(?:file://|(?:^|[\s(])(?:[a-zA-Z]:[\\/]|\\\\|/(?!/)[^\s]+))",
    re.IGNORECASE,
)
_DATA_URL = re.compile(r"data:[^\s;,]{0,64}[;,]", re.IGNORECASE)
_BASE64_TOKEN = re.compile(r"(?<![A-Za-z0-9_+/-])[A-Za-z0-9+/_-]{24,}={0,2}(?![A-Za-z0-9_+/-])")
_HEX_TOKEN = re.compile(r"(?<![0-9a-fA-F])[0-9a-fA-F]{32,}(?![0-9a-fA-F])")
_MAGIC = (b"ID3", b"fLaC", b"OggS", b"RIFF", b"FORM", b"\xff\xfb", b"\xff\xf3", b"\xff\xf2")


def _looks_like_audio(data: bytes) -> bool:
    if data.startswith((b"RIFF", b"FORM")) and data[8:12] in (b"WAVE", b"AIFF", b"AIFC"):
        return True
    if len(data) >= 12 and data[4:8] == b"ftyp":
        return True
    return data.startswith(_MAGIC)


def _check_text(value: str) -> None:
    if len(value.encode("utf-8")) > _MAX_STRING:
        raise PayloadRejected("metadata_string_too_large")
    if any(ord(char) < 32 for char in value) or _LOCAL_PATH.search(value) or _DATA_URL.search(value):
        raise PayloadRejected("forbidden_metadata")
    # Detect common encoded media; generic opaque encoding is not a permitted
    # metadata field either. This includes base64url, hex and JSON-wrapped audio.
    for match in _BASE64_TOKEN.finditer(value):
        token = match.group()
        try:
            binary = base64.b64decode(token.replace("-", "+").replace("_", "/") +
                                      "=" * (-len(token) % 4), validate=True)
        except (binascii.Error, ValueError):
            continue
        if _looks_like_audio(binary) or (len(token) >= 128 and len(binary) >= 64):
            raise PayloadRejected("encoded_media_forbidden")
    for match in _HEX_TOKEN.finditer(value):
        try:
            binary = bytes.fromhex(match.group())
        except ValueError:
            continue
        if _looks_like_audio(binary) or len(binary) >= 40 or len(match.group()) == 64:
            raise PayloadRejected("encoded_media_forbidden")


def _validate_value(value: Any, allowed: frozenset[str], depth: int) -> None:
    if depth > _MAX_DEPTH:
        raise PayloadRejected("metadata_too_deep")
    if isinstance(value, Mapping):
        if len(value) > _MAX_ENTRIES:
            raise PayloadRejected("metadata_too_many_fields")
        for key, item in value.items():
            if not isinstance(key, str) or len(key) > _MAX_KEY:
                raise PayloadRejected("metadata_invalid_field")
            if _FORBIDDEN_KEY.search(key) or key not in allowed:
                raise PayloadRejected("metadata_field_not_allowed")
            _validate_value(item, allowed, depth + 1)
    elif isinstance(value, list):
        if len(value) > _MAX_ENTRIES:
            raise PayloadRejected("metadata_too_many_items")
        for item in value:
            _validate_value(item, allowed, depth + 1)
    elif isinstance(value, str):
        _check_text(value)
    elif value is None or isinstance(value, bool):
        return
    elif isinstance(value, (int, float)):
        if isinstance(value, float) and not math.isfinite(value):
            raise PayloadRejected("metadata_invalid_number")
        if abs(value) > 10**15:
            raise PayloadRejected("metadata_invalid_number")
    else:
        # bytes, memoryview, files, arbitrary objects and attachments cannot be
        # represented as cloud metadata, irrespective of Content-Type.
        raise PayloadRejected("unexpected_binary_payload")


def _pairs(items: list[tuple[str, Any]]) -> dict[str, Any]:
    obj: dict[str, Any] = {}
    for key, value in items:
        if key in obj:
            raise PayloadRejected("metadata_duplicate_field")
        obj[key] = value
    return obj


def _no_constant(_constant: str) -> None:
    raise PayloadRejected("metadata_invalid_number")


def validate_envelope(
    value: Mapping[str, Any] | bytes | str, *, workspace_id: str,
    kind: PayloadKind | str, max_bytes: int = _MAX_BYTES,
) -> dict[str, Any]:
    """Validate a fully typed, tenant-bound metadata-only envelope.

    Required shape: {schema_version: 1, kind: ..., workspace_id: ..., data: {...}}.
    Caller must derive workspace_id from authenticated claims, never from user input.
    Returned value is safe-to-serialize metadata, not an authorization grant.
    """
    if not isinstance(workspace_id, str) or not workspace_id or len(workspace_id) > 128:
        raise PayloadRejected("invalid_tenant_scope")
    try:
        category = PayloadKind(kind)
    except ValueError as error:
        raise PayloadRejected("metadata_kind_not_allowed") from error
    if isinstance(value, (bytes, str)):
        if isinstance(value, bytes):
            if len(value) > max_bytes:
                raise PayloadRejected("metadata_too_large")
            if _looks_like_audio(value):
                raise PayloadRejected("unexpected_binary_payload")
            try:
                raw = value.decode("utf-8", errors="strict")
            except UnicodeDecodeError as error:
                raise PayloadRejected("unexpected_binary_payload") from error
        else:
            raw = value
            if len(raw.encode("utf-8")) > max_bytes:
                raise PayloadRejected("metadata_too_large")
        try:
            value = json.loads(raw, object_pairs_hook=_pairs, parse_constant=_no_constant)
        except PayloadRejected:
            raise
        except (ValueError, RecursionError, TypeError) as error:
            raise PayloadRejected("invalid_metadata_json") from error
    if not isinstance(value, Mapping):
        raise PayloadRejected("invalid_metadata_envelope")
    try:
        serialized_size = len(json.dumps(value, allow_nan=False, ensure_ascii=False).encode("utf-8"))
    except (TypeError, ValueError, OverflowError, RecursionError) as error:
        raise PayloadRejected("invalid_metadata_json") from error
    if serialized_size > max_bytes:
        raise PayloadRejected("metadata_too_large")
    if set(value) != {"schema_version", "kind", "workspace_id", "data"}:
        raise PayloadRejected("metadata_field_not_allowed")
    if type(value["schema_version"]) is not int or value["schema_version"] != 1:
        raise PayloadRejected("metadata_version_unsupported")
    if value["kind"] != category.value:
        raise PayloadRejected("metadata_kind_not_allowed")
    if value["workspace_id"] != workspace_id:
        raise PayloadRejected("tenant_scope_mismatch")
    data = value["data"]
    if not isinstance(data, Mapping):
        raise PayloadRejected("invalid_metadata_envelope")
    _validate_value(data, _FIELDS[category], 0)
    # Output a plain dict without preserving attacker-supplied mapping subclasses.
    return json.loads(json.dumps(value, allow_nan=False, ensure_ascii=False))


def safe_audit_fields(code: str, kind: PayloadKind | str) -> dict[str, str]:
    """Only opaque, bounded enums/codes; never log raw input, paths, hashes or IDs."""
    safe_codes = {
        "metadata_rejected", "metadata_too_large", "metadata_invalid_field",
        "metadata_field_not_allowed", "metadata_string_too_large",
        "metadata_too_many_items", "metadata_too_many_fields", "metadata_too_deep",
        "invalid_metadata_json", "invalid_metadata_envelope", "unexpected_binary_payload",
        "encoded_media_forbidden", "forbidden_metadata", "metadata_duplicate_field",
        "metadata_invalid_number", "tenant_scope_mismatch", "invalid_tenant_scope",
        "metadata_kind_not_allowed", "metadata_version_unsupported",
        "cloud_audio_disabled", "cloud_audio_storage_disabled",
        "cloud_audio_processing_disabled", "new_cloud_audio_uploads_disabled",
    }
    return {
        "event": "lf_egress_refused",
        "reason_code": code if code in safe_codes else "metadata_rejected",
        "kind": str(kind) if str(kind) in {p.value for p in PayloadKind} else "unknown",
    }
