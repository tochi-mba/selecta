"""What every artifact row must record about how it was made (ADR-0397, SC-0397-03; §10.6).

An artifact is published only with a SHA-256 `checksum` of its bytes and a `provenance` object of
this shape:

- `inputs`: what it was made from, by content. A non-empty mapping from a role (`source`, `a`,
  `b`, `window`) to an asset's content hash or a stored object key, or a non-empty list of them.
- `versions`: the code versions that shaped it. A non-empty mapping from a name to an integer or
  a non-empty string. Some kinds must name particular versions (`REQUIRED_VERSIONS`): a playback
  file its `proxy` version, a seam the `analysis` and `render` versions.
- `models`: the model checkpoints it depends on, name to checkpoint. Optional, but required for
  kinds made by a model (`MODEL_KINDS`, today stems).
- `settings_hash`: the SHA-256 of the settings it was made with (`settings_hash()`; an empty
  settings object still has one). `settings` may carry those settings too; when it does, it must
  hash to `settings_hash`.

No other top-level keys are allowed, so the shape can't drift one producer at a time. `build()`
makes a valid object; `check()` and `check_output()` are the one rule every publish and complete
path applies, raising `ProvenanceInvalid` with what is missing. A worker that raises it fails as
an engine bug: the code that published the artifact is wrong, and retrying wouldn't help.
"""

from __future__ import annotations

import hashlib
import json
import re
from collections.abc import Mapping
from typing import Any

SHA256 = re.compile(r"[0-9a-f]{64}")

KEYS = frozenset({"inputs", "versions", "models", "settings", "settings_hash"})

REQUIRED_VERSIONS: Mapping[str, tuple[str, ...]] = {
    "playback": ("proxy",),
    "seam": ("analysis", "render"),
}
"""Versions a kind must name, because its bytes change when they do."""

MODEL_KINDS = frozenset({"stems"})
"""Kinds a model makes, so their provenance must name its checkpoint."""

MAX_REF = 512


class ProvenanceInvalid(Exception):
    """An artifact was published without a checksum or without the provenance it must record."""


def settings_hash(settings: Mapping[str, Any]) -> str:
    """The SHA-256 of settings, as sorted compact JSON."""
    text = json.dumps(dict(settings), sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(text.encode()).hexdigest()


def build(
    inputs: Mapping[str, Any],
    versions: Mapping[str, Any],
    settings: Mapping[str, Any] | None = None,
    models: Mapping[str, str] | None = None,
) -> dict[str, Any]:
    """A provenance object for these inputs, versions, settings and models."""
    made: dict[str, Any] = {
        "inputs": dict(inputs),
        "versions": dict(versions),
        "settings": dict(settings or {}),
        "settings_hash": settings_hash(settings or {}),
    }
    if models:
        made["models"] = dict(models)
    return made


def _ref(value: Any) -> bool:
    return isinstance(value, str) and 0 < len(value) <= MAX_REF


def _version(value: Any) -> bool:
    if isinstance(value, bool):
        return False
    return (isinstance(value, int) and value >= 0) or (isinstance(value, str) and bool(value))


def check(kind: str, provenance: Any) -> None:
    """Raise `ProvenanceInvalid` unless `provenance` records what a `kind` artifact must."""
    if not isinstance(provenance, Mapping) or not provenance:
        raise ProvenanceInvalid(f"The {kind} artifact must record its provenance.")
    extra = sorted(set(provenance) - KEYS)
    if extra:
        raise ProvenanceInvalid(f"The {kind} artifact's provenance has unknown keys: {extra}.")
    inputs = provenance.get("inputs")
    if not isinstance(inputs, Mapping) or not inputs:
        raise ProvenanceInvalid(f"The {kind} artifact's provenance must name its inputs.")
    for role, value in inputs.items():
        refs = value if isinstance(value, list) else [value]
        if not refs or not all(_ref(ref) for ref in refs):
            raise ProvenanceInvalid(
                f"The {kind} artifact's input {role!r} must be a content hash or object key."
            )
    versions = provenance.get("versions")
    if not isinstance(versions, Mapping) or not versions:
        raise ProvenanceInvalid(f"The {kind} artifact's provenance must name its versions.")
    if not all(_version(value) for value in versions.values()):
        raise ProvenanceInvalid(f"The {kind} artifact's versions must be numbers or names.")
    missing = [name for name in REQUIRED_VERSIONS.get(kind, ()) if name not in versions]
    if missing:
        named = ", ".join(missing)
        raise ProvenanceInvalid(f"The {kind} artifact must record its {named} version.")
    models = provenance.get("models")
    if models is not None and (
        not isinstance(models, Mapping) or not all(_ref(value) for value in models.values())
    ):
        raise ProvenanceInvalid(f"The {kind} artifact's models must map names to checkpoints.")
    if kind in MODEL_KINDS and not models:
        raise ProvenanceInvalid(f"The {kind} artifact must record its model checkpoints.")
    digest = provenance.get("settings_hash")
    if not isinstance(digest, str) or not SHA256.fullmatch(digest):
        raise ProvenanceInvalid(f"The {kind} artifact must record the SHA-256 of its settings.")
    settings = provenance.get("settings")
    if settings is not None and (
        not isinstance(settings, Mapping) or settings_hash(settings) != digest
    ):
        raise ProvenanceInvalid(f"The {kind} artifact's settings don't match their settings_hash.")


def check_checksum(kind: str, checksum: Any) -> None:
    if not isinstance(checksum, str) or not SHA256.fullmatch(checksum):
        raise ProvenanceInvalid(f"The {kind} artifact must record the SHA-256 of its bytes.")


def check_output(output: Any) -> None:
    """The whole rule for one published output (`work.ports.ArtifactOutput`)."""
    check_checksum(output.kind, output.checksum)
    check(output.kind, output.provenance)
