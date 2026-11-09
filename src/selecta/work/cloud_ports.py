"""Cloud-backed scheduler adapters for plan eligibility, feature gates and R2 outputs."""

from __future__ import annotations

import tempfile
from pathlib import Path
from typing import Any

import sqlalchemy as sa

from selecta import flags
from selecta.billing import plans, stripe_sync
from selecta.flags import targeting
from selecta.flags.matching import Context
from selecta.flags.rules import RulesCache, user_preferences
from selecta.identity.schema import users, workspaces
from selecta.persistence import db_now, transaction
from selecta.storage import api as storage_api
from selecta.storage.keys import Bucket, derived_key, validate_key, workspace_of
from selecta.storage.objects import R2Error
from selecta.storage.r2 import file_sha256
from selecta.work.ports import AccountStanding, ArtifactOutput, Entitlements, OutputVerifier


class CloudJobEntitlements(Entitlements):
    """Read the plan and account deletion state at dispatch time, not when a job was queued."""

    def __init__(self, engine):
        self.engine = engine

    def standing(self, workspace_id: str) -> AccountStanding:
        with transaction(self.engine, workspace_id) as conn:
            owner = conn.execute(
                sa.select(users.c.id, users.c.created_at, users.c.deleted_at)
                .select_from(workspaces.join(users, workspaces.c.owner_user_id == users.c.id))
                .where(workspaces.c.id == workspace_id)
            ).first()
            if owner is None:
                return AccountStanding(suspended=True)
            entitlement = stripe_sync.effective_entitlement(conn, workspace_id)
            plan = plans.plan_for(entitlement.plan_id, entitlement.plan_version)
            caps = dict(plan.concurrency) | {"speculative": 1}
            return AccountStanding(
                tier=plan.id,
                suspended=owner.deleted_at is not None,
                entitlement_version=entitlement.snapshot_version,
                caps=caps,
            )


class CloudJobFlags:
    """Resolve the same build, rule and plan layers the account API reports to the user."""

    def __init__(self, engine, rules: RulesCache):
        self.engine = engine
        self.rules = rules

    def is_on(self, workspace_id: str, flag_id: str) -> bool:
        self.rules.refresh_if_stale()
        with transaction(self.engine, workspace_id) as conn:
            owner = conn.execute(
                sa.select(users.c.id, users.c.created_at, users.c.deleted_at)
                .select_from(workspaces.join(users, workspaces.c.owner_user_id == users.c.id))
                .where(workspaces.c.id == workspace_id)
            ).first()
            if owner is None or owner.deleted_at is not None:
                return False
            now = db_now(conn)
            entitlement = stripe_sync.effective_entitlement(conn, workspace_id)
            plan = plans.plan_for(entitlement.plan_id, entitlement.plan_version)
            context = Context(
                environment="production",
                mode="cloud",
                workspace_id=workspace_id,
                user_id=owner.id,
                plan=plan.id,
                plan_version=plan.version,
                account_age_days=max(0.0, (now - owner.created_at) / 86_400),
            )
            decision = targeting.decide(
                flag_id,
                context,
                build_states=flags.effective(),
                rules=self.rules.snapshot,
                entitled=plan.flags,
                plan_gated=plans.plan_gated_flags(),
                user_prefs=user_preferences(conn, owner.id),
                now=now,
                lock_plans=plans.unlocking_plans(),
            )
            return decision.on


class R2OutputVerifier(OutputVerifier):
    """Require every claimed artifact to exist under its workspace with matching metadata."""

    def verify(self, workspace_id: str, output: ArtifactOutput) -> bool:
        keys = output.keys if isinstance(output.keys, list) else [output.keys]
        if not keys or output.size_bytes is None or not output.checksum:
            return False
        client = storage_api._r2_client()
        buckets = storage_api._buckets()
        try:
            for key in keys:
                try:
                    if (
                        validate_key(key) is not Bucket.DERIVED
                        or workspace_of(key) != workspace_id
                        or f"/{output.kind}/{output.input_hash}/attempts/" not in key
                    ):
                        return False
                    head = client.head_object(buckets.derived, key)
                except (ValueError, R2Error):
                    return False
                if head.size != output.size_bytes:
                    return False
                with tempfile.TemporaryDirectory(prefix="selecta-output-check-") as temp:
                    path = Path(temp) / "artifact"
                    client.get_object(buckets.derived, key, path)
                    size, digest = file_sha256(path)
                if size != output.size_bytes or digest != output.checksum:
                    return False
            return True
        finally:
            client.close()


def signed_inputs(job: Any) -> list[dict[str, str]]:
    """Sign only keys declared by the job and owned by its workspace."""
    input_ref = job.input_ref
    keys = input_ref.get("objects", []) if isinstance(input_ref, dict) else []
    if not isinstance(keys, list):
        raise ValueError("A worker job's object inputs must be a list.")
    client = storage_api._r2_client()
    buckets = storage_api._buckets()
    result = []
    try:
        for key in keys:
            bucket = validate_key(key)
            if bucket is Bucket.STAGING or workspace_of(key) != job.workspace_id:
                raise ValueError("A worker input key is outside this workspace.")
            result.append(
                {
                    "key": key,
                    "url": client.presign_get(buckets.name(bucket), key, 900),
                }
            )
    finally:
        client.close()
    return result


def output_prefix(job: Any, attempt_id: str) -> str | None:
    """Build the attempt's output namespace from a server-declared content hash and kind."""
    from selecta.storage.keys import derived_prefix

    output = job.input_ref.get("output") if isinstance(job.input_ref, dict) else None
    if not isinstance(output, dict):
        return None
    kind, input_hash = output.get("kind"), output.get("input_hash")
    try:
        prefix = derived_prefix(job.workspace_id, kind, input_hash)
    except (TypeError, ValueError):
        raise ValueError("A worker job has an invalid declared output namespace.") from None
    return f"{prefix}attempts/{attempt_id}/"


def signed_outputs(store, attempt, names: list[str]) -> list[dict[str, str]]:
    """Give this live attempt short-lived PUT links under only its declared artifact namespace."""
    job = store.job(attempt.job_id)
    output = job.input_ref.get("output") if job and isinstance(job.input_ref, dict) else None
    if not isinstance(output, dict):
        raise ValueError("This job has no declared artifact output namespace.")
    if len(set(names)) != len(names):
        raise ValueError("Output file names must be unique.")
    keys = [
        derived_key(
            job.workspace_id,
            output.get("kind"),
            output.get("input_hash"),
            attempt.id,
            name,
        )
        for name in names
    ]
    client = storage_api._r2_client()
    buckets = storage_api._buckets()
    try:
        return [
            {"key": key, "url": client.presign_put(buckets.derived, key, 900)} for key in keys
        ]
    finally:
        client.close()


__all__ = [
    "CloudJobEntitlements",
    "CloudJobFlags",
    "R2OutputVerifier",
    "output_prefix",
    "signed_inputs",
    "signed_outputs",
]
