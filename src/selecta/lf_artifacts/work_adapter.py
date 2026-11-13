"""Explicit, one-way compatibility bridge to Agent 05's existing job ports.

This adapter is strictly local; it is NOT a cloud upload serializer. Job owners
must validate placement on an authorised engine before using this output.
"""
from __future__ import annotations

from typing import Any

from .store import ArtifactInvalid, ArtifactSpec


def to_local_work_output(spec: ArtifactSpec, record: dict[str, Any]):
    """Adapt a verified local publication to work.ports without changing Agent 05 files."""
    from selecta.work.ports import ArtifactOutput
    from selecta.work.provenance import build, check_output

    if record.get("id") != spec.identity or record.get("state") != "ready":
        raise ArtifactInvalid("The output does not match its frozen local identity.")
    if record.get("storage") not in {"cache", "export"}:
        raise ArtifactInvalid("Only device-owned files may be published to local work.")
    kind = "stems" if spec.kind == "stem" else spec.kind
    provenance = build(
        inputs=dict(spec.source_revisions),
        versions=dict(spec.versions),
        models=dict(spec.models) or None,
        settings=dict(spec.settings),
    )
    output = ArtifactOutput(
        kind=kind, input_hash=spec.identity, keys=[record["local_path"]],
        checksum=record["checksum"], size_bytes=record["bytes"],
        provenance=provenance, protected=record["storage"] == "export",
    )
    check_output(output)
    return output
