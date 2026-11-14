"""Fail-closed admission for authenticated, versioned Cloud metadata requests.

Route owners derive workspace_id from authenticated claims before using this
gate. Never trust MIME headers, client feature flags or plan entitlements.
"""
from __future__ import annotations
from typing import Any
from selecta.lf_egress.contract import PayloadKind, PayloadRejected, validate_envelope


def admit_cloud_metadata(
    body: bytes | str, *, content_type: str, workspace_id: str,
    kind: PayloadKind | str, max_bytes: int = 64 * 1024,
) -> dict[str, Any]:
    """Inspect typed JSON for unexpected binary, encoded media and unsafe keys."""
    media_type, _, parameters = content_type.partition(";")
    if media_type.strip().lower() not in {
        "application/json", "application/vnd.selecta.metadata+json"
    }:
        raise PayloadRejected("unexpected_binary_payload")
    if parameters and parameters.strip().lower().replace(" ", "") != "charset=utf-8":
        raise PayloadRejected("invalid_metadata_json")
    if not isinstance(body, (bytes, str)):
        raise PayloadRejected("unexpected_binary_payload")
    return validate_envelope(
        body, workspace_id=workspace_id, kind=kind, max_bytes=max_bytes
    )


__all__ = ["admit_cloud_metadata"]
