"""Synthetic forbidden-media canaries and cross-tenant adversarial requests."""
from __future__ import annotations

import base64
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .audio import AudioFixture


@dataclass(frozen=True)
class ForbiddenProbe:
    name: str
    payload: dict
    expected: str = "rejected"


def forbidden_media_probes(fixture: AudioFixture) -> list[ForbiddenProbe]:
    data = fixture.path.read_bytes()
    token = base64.b64encode(data).decode("ascii")
    return [
        ForbiddenProbe("raw_base64_in_json", {"diagnostic": {"content": token}}),
        ForbiddenProbe("nested_log_audio", {"debug": json.dumps({"samples": token})}),
        ForbiddenProbe("misleading_content_type", {"content_type": "application/json", "blob": token}),
        ForbiddenProbe("pcm_integer_samples", {"metrics": {"samples": list(data[:256])}}),
        ForbiddenProbe("raw_media_path", {"event": {"file_path": str(fixture.path)}}),
        ForbiddenProbe("debug_attachment", {"error": {"attachment_base64": token}}),
        ForbiddenProbe("inline_audio_json", {"payload": {"waveform": token}}),
    ]


def assert_no_media_in_cloud_capture(capture: Any, fixture: AudioFixture) -> None:
    """Detect direct WAV/PCM, base64, JSON-log leakage; fixture-specific negative oracle.

    This is not a complete media classifier and MUST be used alongside the
    production ingress/egress denylist and byte-level transport capture.
    """
    if isinstance(capture, (dict, list)):
        wire = json.dumps(capture, sort_keys=True).encode("utf-8")
    elif isinstance(capture, str):
        wire = capture.encode("utf-8")
    elif isinstance(capture, bytes):
        wire = capture
    else:
        raise TypeError("captured cloud traffic must be JSON, text or bytes")
    data = fixture.path.read_bytes()
    with fixture.path.open("rb") as file:
        file.read(44)
        pcm = file.read()
    forbidden_signatures = (
        data, pcm, base64.b64encode(data), base64.b64encode(pcm),
        str(fixture.path).encode("utf-8"),
    )
    if any(sig and sig in wire for sig in forbidden_signatures):
        raise AssertionError("forbidden synthetic audio or local media path observed in cloud capture")


def cross_tenant_command(*, target_device_id: str, foreign_workspace: str) -> dict:
    return {
        "schema_version": 1, "operation_id": "cross-tenant-probe",
        "idempotency_key": "cross-tenant-probe", "workspace_id": foreign_workspace,
        "actor_id": "foreign-controller", "zone_id": "zone-main",
        "target_device_id": target_device_id, "expected_generation": 1,
        "expected_recipe_revision": "rev-synthetic-1", "command": "play",
        "arguments": {}, "created_at": 1, "expires_at": 100,
    }


def malicious_local_paths() -> tuple[str, ...]:
    return ("../../etc/passwd", "..\\..\\windows\\system32", "file:///etc/shadow",
            "\\\\evil.example\\share", "%2e%2e/%2e%2e/secret", "C:\\Users\\Other\\Music")
