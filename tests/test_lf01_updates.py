from __future__ import annotations

import base64
import hashlib
import json

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from selecta.local_engine.updates import (
    UpdateRejected,
    in_rollout,
    record_activation,
    rollback_activation,
    stage_update,
    verify_manifest,
)


def signed_manifest(private, version, content):
    data = {
        "version": version, "platform": "linux",
        "sha256": hashlib.sha256(content).hexdigest(),
        "key_id": "local-test", "rollout_percent": 100,
    }
    canonical = json.dumps(data, sort_keys=True, separators=(",", ":")).encode()
    data["signature"] = base64.b64encode(private.sign(canonical)).decode()
    return data


def test_signed_stage_and_reversible_activation(tmp_path):
    private = Ed25519PrivateKey.generate()
    key = private.public_key().public_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PublicFormat.Raw,
    )
    keys = {"local-test": key}
    package = tmp_path / "package"
    package.write_bytes(b"first local package")
    first = signed_manifest(private, "1", package.read_bytes())
    assert verify_manifest(first, keys)["version"] == "1"
    with pytest.raises(UpdateRejected):
        verify_manifest(first, {})
    assert stage_update(
        tmp_path, package, first, keys, identifier="device", platform_name="linux"
    ).exists()
    record_activation(tmp_path)
    package.write_bytes(b"second local package")
    second = signed_manifest(private, "2", package.read_bytes())
    stage_update(tmp_path, package, second, keys, identifier="device", platform_name="linux")
    record_activation(tmp_path)
    rollback_activation(tmp_path)
    state = json.loads((tmp_path / "update-active.json").read_text())
    assert state["current"]["version"] == "1"
    assert state["applied"] is False


def test_rejected_tamper_wrong_platform_and_rollout(tmp_path):
    private = Ed25519PrivateKey.generate()
    key = private.public_key().public_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PublicFormat.Raw,
    )
    manifest = signed_manifest(private, "1", b"expected")
    with pytest.raises(UpdateRejected):
        verify_manifest({**manifest, "version": "tampered"}, {"local-test": key})
    package = tmp_path / "package"
    package.write_bytes(b"wrong")
    with pytest.raises(UpdateRejected, match="checksum"):
        stage_update(
            tmp_path, package, manifest, {"local-test": key},
            identifier="device", platform_name="linux",
        )
    with pytest.raises(UpdateRejected, match="operating system"):
        stage_update(
            tmp_path, package, manifest, {"local-test": key},
            identifier="device", platform_name="win32",
        )
    assert not in_rollout("device", "1", 0)
    assert in_rollout("device", "1", 100)
