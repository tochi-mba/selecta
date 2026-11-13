"""Server-owned staged admission for the hosted-audio sunset (ADR-0457).

No request headers, client versions, user flags or billing entitlements can override this
policy. Deployed services fail closed. Temporary migration exceptions are explicit,
UTC-deadlined server configuration; standalone installs retain their existing behaviour.
"""

from __future__ import annotations

import os
from collections.abc import Mapping
from datetime import UTC, datetime, timedelta
from enum import StrEnum


class Phase(StrEnum):
    LEGACY = "legacy"
    DRAIN = "drain"
    SEALED = "sealed"


class AdmissionDenied(PermissionError):
    """A non-sensitive, stable rejection suitable for public API responses."""

    def __init__(self, code: str = "cloud_audio_disabled") -> None:
        self.code = code
        super().__init__(code)


def current_phase(env: Mapping[str, str] | None = None, *, now: datetime | None = None) -> Phase:
    """Resolve an immutable-for-this-operation, fail-closed server-side stage.

    On cloud deployments, legacy/drain requires an explicit approved exception with an
    expiration no more than 30 days away. An invalid, missing or expired exception seals
    immediately. The browser cannot extend the exception or downgrade the stage.
    """
    env = os.environ if env is None else env
    environment = env.get("SELECTA_ENV", "").strip().lower()
    deployed = environment not in {"", "local", "development", "dev", "test", "testing"}
    requested = env.get("SELECTA_LF_AUDIO_ROLLOUT_PHASE", "").strip().lower()
    if not requested:
        requested = Phase.SEALED.value if deployed else Phase.LEGACY.value
    try:
        phase = Phase(requested)
    except ValueError:
        return Phase.SEALED
    if not deployed or phase is Phase.SEALED:
        return phase
    if env.get("SELECTA_LF_AUDIO_EXCEPTION_APPROVED", "") != "yes":
        return Phase.SEALED
    expires = env.get("SELECTA_LF_AUDIO_EXCEPTION_UNTIL", "")
    try:
        deadline = datetime.fromisoformat(expires.replace("Z", "+00:00"))
        if deadline.tzinfo is None:
            return Phase.SEALED
        current = datetime.now(UTC) if now is None else now
        if current.tzinfo is None:
            return Phase.SEALED
        if not current < deadline <= current + timedelta(days=30):
            return Phase.SEALED
    except (TypeError, ValueError, OverflowError):
        return Phase.SEALED
    return phase


def require_upload_action(action: str, *, phase: Phase | None = None) -> None:
    """Guard Cloud upload mutations, including resumptions and completion.

    DRAIN permits only pre-existing session transfer/completion; PLAN and START are
    forbidden. SEALED forbids all writes, including replay by an outdated client.
    """
    stage = current_phase() if phase is None else phase
    if stage is Phase.LEGACY:
        return
    if stage is Phase.DRAIN and action in {"parts", "complete", "accept"}:
        return
    raise AdmissionDenied("new_cloud_audio_uploads_disabled")


def require_media_write(operation: str, *, phase: Phase | None = None) -> None:
    """Second-line guard for storage clients and worker artifact publishing."""
    stage = current_phase() if phase is None else phase
    if stage is Phase.LEGACY:
        return
    if stage is Phase.DRAIN and operation in {"complete_legacy", "promote_legacy"}:
        return
    raise AdmissionDenied("cloud_audio_storage_disabled")


def require_proxy_job(*, phase: Phase | None = None) -> None:
    """Block hosted audio decoding and new derived-media jobs after ingestion freeze."""
    if (current_phase() if phase is None else phase) is not Phase.LEGACY:
        raise AdmissionDenied("cloud_audio_processing_disabled")


def legacy_retrieval_enabled(env: Mapping[str, str] | None = None) -> bool:
    """Explicit separate migration gate; never delete or revoke old objects here."""
    env = os.environ if env is None else env
    return env.get("SELECTA_LF_LEGACY_RETRIEVAL", "enabled") == "enabled"
