"""Signed *offline* update staging and reversible activation metadata.

No signing key is shipped or provisioned. No package executes without an external,
platform-specific installer applying the verified artifact in a separate release gate.
"""

from __future__ import annotations

import base64
import hashlib
import json
import os
import shutil
from pathlib import Path

from selecta.local_engine.config import EngineConfigError, atomic_json, ensure_private


class UpdateRejected(ValueError):
    pass


def verify_manifest(manifest: dict, trusted_keys: dict[str, bytes]) -> dict:
    """Verify Ed25519 over the canonical unsigned manifest; fail closed."""
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

    required = {"version", "platform", "sha256", "key_id", "signature", "rollout_percent"}
    if not isinstance(manifest, dict) or set(manifest) != required:
        raise UpdateRejected("Unexpected update-manifest fields.")
    kid = manifest["key_id"]
    key = trusted_keys.get(kid) if isinstance(kid, str) else None
    if not key or len(key) != 32:
        raise UpdateRejected("Unknown update-signing key; updates disabled.")
    if (
        not isinstance(manifest["version"], str) or len(manifest["version"]) > 64
        or not isinstance(manifest["platform"], str)
        or manifest["platform"] not in ("win32", "linux", "darwin")
        or not isinstance(manifest["sha256"], str)
        or len(manifest["sha256"]) != 64
        or any(c not in "0123456789abcdef" for c in manifest["sha256"])
        or type(manifest["rollout_percent"]) is not int
        or not 0 <= manifest["rollout_percent"] <= 100
    ):
        raise UpdateRejected("Invalid manifest fields.")
    payload = {k: v for k, v in manifest.items() if k != "signature"}
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
    try:
        signature = base64.b64decode(manifest["signature"], validate=True)
        Ed25519PublicKey.from_public_bytes(key).verify(signature, canonical)
    except (ValueError, TypeError, Exception) as exc:
        raise UpdateRejected("Update signature verification failed.") from exc
    return payload


def in_rollout(identifier: str, version: str, percentage: int) -> bool:
    if not 0 <= percentage <= 100:
        raise UpdateRejected("Invalid rollout percentage.")
    sample = int.from_bytes(
        hashlib.sha256(f"{identifier}:{version}".encode()).digest()[:8], "big"
    ) % 100
    return sample < percentage


def stage_update(
    directory: Path, archive: Path, manifest: dict, trusted_keys: dict[str, bytes],
    *, identifier: str, platform_name: str,
) -> Path:
    payload = verify_manifest(manifest, trusted_keys)
    if payload["platform"] != platform_name:
        raise UpdateRejected("Update targets a different operating system.")
    if not in_rollout(identifier, payload["version"], payload["rollout_percent"]):
        raise UpdateRejected("Device is outside the staged rollout.")
    if archive.is_symlink() or not archive.is_file():
        raise UpdateRejected("Update package must be a regular file.")
    ensure_private(directory)
    staged = ensure_private(directory / "updates")
    expected = payload["sha256"]
    target = staged / f"{expected}.package"
    temporary = staged / f".{expected}.{os.getpid()}.tmp"
    digest = hashlib.sha256()
    try:
        with archive.open("rb") as source, temporary.open("xb") as destination:
            while chunk := source.read(1024 * 1024):
                digest.update(chunk)
                destination.write(chunk)
            destination.flush()
            os.fsync(destination.fileno())
        if digest.hexdigest() != expected:
            raise UpdateRejected("Downloaded package checksum mismatch.")
        os.replace(temporary, target)
        atomic_json(
            directory / "update-staged.json",
            {"version": payload["version"], "sha256": expected, "platform": platform_name},
        )
        return target
    finally:
        temporary.unlink(missing_ok=True)


def record_activation(directory: Path) -> None:
    """Atomically change installer *intent*, not any running binaries."""
    staged = json.loads((directory / "update-staged.json").read_text("utf-8"))
    if not (directory / "updates" / f"{staged['sha256']}.package").is_file():
        raise UpdateRejected("Staged package is missing.")
    path = directory / "update-active.json"
    try:
        previous = json.loads(path.read_text("utf-8")).get("current")
    except (OSError, ValueError):
        previous = None
    atomic_json(path, {"current": staged, "previous": previous, "applied": False})


def rollback_activation(directory: Path) -> None:
    path = directory / "update-active.json"
    state = json.loads(path.read_text("utf-8"))
    previous = state.get("previous")
    if not previous:
        raise UpdateRejected("No previous verified update to roll back to.")
    if not (directory / "updates" / f"{previous['sha256']}.package").is_file():
        raise UpdateRejected("Previous package unavailable.")
    atomic_json(path, {"current": previous, "previous": None, "applied": False})
