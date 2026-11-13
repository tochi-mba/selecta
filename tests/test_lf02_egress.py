"""LF-02 boundary negative tests; synthetic media only, no customer audio."""

from __future__ import annotations

import base64
import json
from datetime import UTC, datetime, timedelta

import pytest

from selecta.lf_egress import (
    AdmissionDenied,
    PayloadKind,
    PayloadRejected,
    Phase,
    current_phase,
    legacy_retrieval_enabled,
    require_media_write,
    require_proxy_job,
    require_upload_action,
    safe_audit_fields,
    validate_envelope,
)
from selecta.storage.artifacts import R2ArtifactStore
from selecta.storage.keys import original_key, staging_key
from selecta.storage.r2 import R2Client

NOW = datetime(2026, 11, 13, 12, tzinfo=UTC)


def envelope(data=None, *, workspace="ws-a", kind="recipe"):
    return {
        "schema_version": 1,
        "kind": kind,
        "workspace_id": workspace,
        "data": {"recipe_id": "mix-1"} if data is None else data,
    }


def test_known_typed_metadata_is_accepted_and_is_tenant_bound():
    source = envelope(
        {
            "recipe_id": "m1",
            "occurrences": [
                {
                    "occurrence_id": "o1",
                    "recording_ref": "recording-1",
                    "cue_in_ms": 4000,
                    "transition_ms": 3000,
                }
            ],
        }
    )
    result = validate_envelope(
        json.dumps(source).encode(), workspace_id="ws-a", kind=PayloadKind.RECIPE
    )
    assert result == source
    assert result is not source


@pytest.mark.parametrize(
    "data",
    [
        {"audio": "x"},
        {"pcm": [1, 2]},
        {"raw_fingerprint": "abc"},
        {"lyrics": "words"},
        {"file_path": "/home/alice/music.wav"},
        {"export": "mix.flac"},
        {"attachments": []},
        {"sha256": "f" * 64},
        {"recording_ref": {"arbitrary_raw": "unsafe"}},
        {"occurrences": [{"candidate": "unknown extension"}]},
        {"recipe_id": b"raw bytes"},
        {"recipe_id": object()},
        {"recipe_id": "C:\\Users\\alice\\Music\\track.wav"},
        {"recipe_id": "failed to load /mnt/private/sample.wav"},
        {"recipe_id": "failed to load /data/private/sample.wav"},
        {"recipe_id": "a" * 64},
        {"title": [0, 32767, -8192]},
        {"occurrences": ["UklGR12345"]},
        {"occurrences": [[1, 2, 3]]},
        {"title": {"title": "hello"}},
        {"notes": ["hello", "world"]},
        {"recipe_id": "https://example.com/audio/track.mp3"},
        {"recipe_id": "data:audio/wav;base64,ABCD"},
        {"recipe_id": "x" * 513},
        {"occurrences": list(range(129))},
        {"recipe_id": float("nan")},
        {"recipe_id": float("inf")},
    ],
)
def test_forbidden_metadata_fails_closed_without_reflecting_data(data):
    with pytest.raises(PayloadRejected) as info:
        validate_envelope(envelope(data), workspace_id="ws-a", kind="recipe")
    assert "/" not in str(info.value)
    assert "alice" not in str(info.value)


@pytest.mark.parametrize(
    "bad",
    [
        b"RIFF\x01\x00\x00\x00WAVE" + b"\x00" * 100,
        b"fLaC" + b"\x00" * 100,
        b"ID3" + b"\x00" * 100,
        b"\x00\x01\x02\xff",
        b'{"schema_version":1,"kind":"recipe","workspace_id":"ws-a",'
        b'"data":{"recipe_id":"ok"},"data":{}}',
        b'{"schema_version":1,"kind":"recipe","workspace_id":"ws-a","data":{"recipe_id": NaN}}',
        b"[]",
        b"\xff" * 40,
    ],
)
def test_malformed_binary_and_duplicate_json_are_rejected(bad):
    with pytest.raises(PayloadRejected):
        validate_envelope(bad, workspace_id="ws-a", kind="recipe")


def test_nested_base64_and_hex_audio_are_rejected():
    wav = b"RIFF" + b"\x40\x00\x00\x00WAVEfmt " + b"\x00" * 120
    for payload in (
        base64.b64encode(wav).decode(),
        wav.hex(),
        "trace: " + base64.b64encode(wav).decode(),
    ):
        with pytest.raises(PayloadRejected) as info:
            validate_envelope(envelope({"notes": payload}), workspace_id="ws-a", kind="recipe")
        assert info.value.code == "encoded_media_forbidden"


def test_arbitrary_encoded_blob_not_allowed_even_without_audio_magic():
    opaque = base64.b64encode(b"x" * 128).decode()
    with pytest.raises(PayloadRejected):
        validate_envelope(envelope({"notes": opaque}), workspace_id="ws-a", kind="recipe")


@pytest.mark.parametrize(
    "bad",
    [
        envelope(workspace="ws-b"),
        {**envelope(), "other_workspace_id": "ws-b"},
        {**envelope(), "schema_version": 2},
        {**envelope(), "kind": "diagnostic"},
    ],
)
def test_wrong_workspace_version_or_kind_is_rejected(bad):
    with pytest.raises(PayloadRejected):
        validate_envelope(bad, workspace_id="ws-a", kind=PayloadKind.RECIPE)


def test_payload_budgets_and_depth_fail_closed():
    with pytest.raises(PayloadRejected, match="metadata_too_large"):
        validate_envelope(
            json.dumps(envelope({"notes": "a" * 50000})).encode(),
            workspace_id="ws-a",
            kind="recipe",
            max_bytes=1024,
        )
    nested = {"recipe_id": "m"}
    for _ in range(9):
        nested = {"occurrences": [nested]}
    with pytest.raises(PayloadRejected, match="metadata_too_deep"):
        validate_envelope(envelope(nested), workspace_id="ws-a", kind="recipe")


def test_untrusted_logs_and_diagnostic_attachments_rejected():
    for data in (
        {"traceback": "at /home/a/song.flac"},
        {"reason_code": "crash at /tmp/track.wav"},
        {"reason_code": "data:application/octet-stream;base64,AAAA"},
    ):
        with pytest.raises(PayloadRejected):
            validate_envelope(
                envelope(data, kind="diagnostic"), workspace_id="ws-a", kind="diagnostic"
            )
    safe = safe_audit_fields("untrusted/user/var/log", "diagnostic")
    assert safe == {
        "event": "lf_egress_refused",
        "reason_code": "metadata_rejected",
        "kind": "diagnostic",
    }


@pytest.mark.parametrize("action", ["plan", "start", "parts", "complete", "accept"])
def test_sealed_deny_all_upload_mutations(action):
    with pytest.raises(AdmissionDenied, match="new_cloud_audio_uploads_disabled"):
        require_upload_action(action, phase=Phase.SEALED)


def test_drain_only_existing_sessions_and_no_hosted_dsp():
    with pytest.raises(AdmissionDenied):
        require_upload_action("plan", phase=Phase.DRAIN)
    with pytest.raises(AdmissionDenied):
        require_upload_action("start", phase=Phase.DRAIN)
    for action in ("parts", "complete", "accept"):
        require_upload_action(action, phase=Phase.DRAIN)
    for operation in ("put", "publish", "copy", "presign_put"):
        with pytest.raises(AdmissionDenied):
            require_media_write(operation, phase=Phase.DRAIN)
    require_media_write("complete_legacy", phase=Phase.DRAIN)
    require_media_write("promote_legacy", phase=Phase.DRAIN)
    with pytest.raises(AdmissionDenied):
        require_proxy_job(phase=Phase.DRAIN)


def test_cloud_defaults_sealed_and_invalid_rollout_stays_sealed():
    assert current_phase({"SELECTA_ENV": "production"}) is Phase.SEALED
    assert current_phase({"SELECTA_ENV": "staging"}) is Phase.SEALED
    assert current_phase({"SELECTA_ENV": "prod"}) is Phase.SEALED
    assert (
        current_phase({"SELECTA_ENV": "production", "SELECTA_LF_AUDIO_ROLLOUT_PHASE": "typo"})
        is Phase.SEALED
    )
    assert (
        current_phase({"SELECTA_ENV": "production", "SELECTA_LF_AUDIO_ROLLOUT_PHASE": "legacy"})
        is Phase.SEALED
    )
    assert current_phase({"SELECTA_LF_AUDIO_ROLLOUT_PHASE": "sealed"}) is Phase.SEALED
    assert current_phase({}) is Phase.LEGACY  # standalone compatibility


def test_utc_approved_exception_is_deadlined_and_cannot_be_stale():
    env = {
        "SELECTA_ENV": "production",
        "SELECTA_LF_AUDIO_ROLLOUT_PHASE": "drain",
        "SELECTA_LF_AUDIO_EXCEPTION_APPROVED": "yes",
    }
    assert (
        current_phase(
            {**env, "SELECTA_LF_AUDIO_EXCEPTION_UNTIL": (NOW + timedelta(hours=1)).isoformat()},
            now=NOW,
        )
        is Phase.DRAIN
    )
    assert (
        current_phase(
            {**env, "SELECTA_LF_AUDIO_EXCEPTION_UNTIL": (NOW - timedelta(seconds=1)).isoformat()},
            now=NOW,
        )
        is Phase.SEALED
    )
    assert (
        current_phase({**env, "SELECTA_LF_AUDIO_EXCEPTION_UNTIL": "2026-11-14T12:00:00"}, now=NOW)
        is Phase.SEALED
    )
    assert (
        current_phase(
            {**env, "SELECTA_LF_AUDIO_EXCEPTION_UNTIL": (NOW + timedelta(days=31)).isoformat()},
            now=NOW,
        )
        is Phase.SEALED
    )


def test_legacy_reads_separate_from_cloud_writes():
    assert legacy_retrieval_enabled({}) is True
    assert legacy_retrieval_enabled({"SELECTA_LF_LEGACY_RETRIEVAL": "disabled"}) is False


class NeverWrite:
    def put_object(self, *args, **kwargs):
        pytest.fail("Cloud must not transmit media")


def test_r2_artifact_store_refuses_publish_without_touching_client(tmp_path, monkeypatch):
    monkeypatch.setenv("SELECTA_ENV", "production")
    monkeypatch.delenv("SELECTA_LF_AUDIO_ROLLOUT_PHASE", raising=False)
    store = R2ArtifactStore(NeverWrite())
    source = tmp_path / "media.wav"
    source.write_bytes(b"RIFF" + b"\x00" * 200)
    with pytest.raises(AdmissionDenied):
        store.publish(original_key("ws-a", "song-1"), source)


def test_r2_signed_upload_denied_before_issuing_credentials(monkeypatch):
    monkeypatch.setenv("SELECTA_ENV", "production")
    monkeypatch.delenv("SELECTA_LF_AUDIO_ROLLOUT_PHASE", raising=False)
    r2 = object.__new__(R2Client)
    with pytest.raises(AdmissionDenied):
        r2.presign_put("sel-derived", "w/ws-a/a/song-1", 300)
    with pytest.raises(AdmissionDenied):
        r2.presign_upload_part("sel-staging", staging_key("sid-1"), "upload", 1, 60)
    with pytest.raises(AdmissionDenied):
        r2.create_multipart_upload("sel-staging", staging_key("sid-1"))


def test_retrieval_revocation_refuses_signing_without_leaking_url(monkeypatch):
    monkeypatch.setenv("SELECTA_LF_LEGACY_RETRIEVAL", "disabled")
    r2 = object.__new__(R2Client)
    with pytest.raises(AdmissionDenied, match="legacy_audio_retrieval_disabled"):
        r2.presign_get("sel-originals", original_key("ws-a", "song-1"), 30)
