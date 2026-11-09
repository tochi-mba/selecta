"""Concrete idempotent effects for the account-deletion workflow.

The runner calls these effects outside its lease transaction. Each method uses short database
transactions around reads/writes and makes network calls separately. External operations are safe
to repeat: job cancellation is monotonic, Stripe DELETE is naturally idempotent, and object deletes
and storage tombstones are idempotent.

Physical object removal happens in storage maintenance after the 30-day recovery window. Workspace
rows and the user row are removed only after that purge is recorded. The off-database deletion
ledger is an injected port because its write-once bucket and credentials are deployment-owned.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any, Protocol

import sqlalchemy as sa
from sqlalchemy.engine import Engine

from selecta.authz.schema import (
    access_grants,
    audit_events,
    dangerous_actions,
    role_assignments,
)
from selecta.billing import stripe_sync
from selecta.billing.schema import (
    checkout_consents,
    entitlement_overrides,
    subscriptions,
)
from selecta.billing.stripe_sync import PriceMap, StripeClient
from selecta.flags.rules import flag_previews, flag_rule_versions, user_flag_preferences
from selecta.identity.accounts import DeletionPlan
from selecta.identity.deletion import DeletionEffects
from selecta.identity.schema import (
    session_revocations,
    users,
    workspace_members,
    workspaces,
)
from selecta.persistence import db_now, metadata, transaction
from selecta.persistence.registry import load_all_tables
from selecta.storage.artifacts import DEFAULT_BUCKETS, Buckets
from selecta.storage.deletion import DeletionKind, tombstone
from selecta.storage.objects import ObjectClient
from selecta.storage.schema import deletions, upload_sessions
from selecta.usage import quota
from selecta.work.errors import UnknownJob
from selecta.work.model import TERMINAL
from selecta.work.schema import job_dependencies, jobs
from selecta.work.store import JobStore

ANONYMIZED_ID = "00000000-0000-0000-0000-000000000000"
ANONYMIZED_LABEL = "deleted-account"
PRESERVED_WORKSPACE_TABLES = frozenset(
    {
        "deletions",  # tombstones must survive a restore after the workspace rows are gone
        "audit_events",  # retained for the audit retention period, with subject links removed
        "dangerous_actions",  # retained as an action record, with user/workspace links removed
        "checkout_consents",  # legal consent evidence; the person and IP hash are anonymized
    }
)
PRESERVED_USER_LINKS = frozenset({"account_deletion_workflows"})
USER_REFERENCE_COLUMNS = (
    "user_id",
    "owner_user_id",
    "auth_subject",
    "staff_user_id",
    "actor_id",
    "issued_by",
    "approved_by",
    "proposer_id",
    "approver_id",
    "revoked_by",
    "finished_by",
    "created_by",
    "subject_user_id",
    "resource_id",
)


class DeletionEffectError(RuntimeError):
    """A deletion effect can't safely complete and should be retried or investigated."""


class DeletionNotReady(DeletionEffectError):
    """The recovery period, worker drain or physical object purge hasn't completed yet."""


class LedgerWriter(Protocol):
    """A durable external ledger sink; writes must deduplicate on the supplied key."""

    def write(
        self,
        entries: Sequence[Mapping[str, Any]],
        idempotency_key: str,
        plan: DeletionPlan,
    ) -> None: ...


class _QuotaRelease:
    """Adapt the quota ledger to the storage deletion port."""

    @staticmethod
    def release_committed(conn, workspace_id: str, size: int, ref: str) -> None:
        quota.release_deleted(conn, workspace_id, size, ref=ref)


class AccountDeletionEffects(DeletionEffects):
    """Handlers for the ordered effects in ``accounts.DELETION_STEPS``.

    ``ledger_writer`` is required for the off-database tombstone copy. It may be absent while
    running earlier steps, but the ledger step raises and remains retryable until configured.
    """

    def __init__(
        self,
        engine: Engine,
        job_store: JobStore,
        stripe: StripeClient,
        objects: ObjectClient,
        *,
        price_map: PriceMap,
        ledger_writer: LedgerWriter | None = None,
        buckets: Buckets = DEFAULT_BUCKETS,
    ) -> None:
        self.engine = engine
        self.job_store = job_store
        self.stripe = stripe
        self.objects = objects
        self.price_map = price_map
        self.ledger_writer = ledger_writer
        self.buckets = buckets

    def apply(self, step: str, plan: DeletionPlan, idempotency_key: str) -> None:
        handler = {
            "cancel_running_jobs": self.cancel_running_jobs,
            "cancel_subscriptions": self.cancel_subscriptions,
            "remove_memberships": self.remove_memberships,
            "delete_objects": self.delete_objects,
            "delete_workspace_rows": self.delete_workspace_rows,
            "record_in_deletions_ledger": self.record_in_deletions_ledger,
            "erase_user": self.erase_user,
        }.get(step)
        if handler is None:
            raise DeletionEffectError(f"Unknown account deletion step {step!r}.")
        handler(plan, idempotency_key)

    def cancel_running_jobs(self, plan: DeletionPlan, _key: str) -> None:
        live = [str(state) for state in TERMINAL]
        # JobStore applies the domain lifecycle and requests active workers to stop. Each call
        # commits on its own, so a large library never holds one account-wide transaction open.
        for workspace_id in plan.owned_workspace_ids:
            with transaction(self.engine, workspace_id) as conn:
                rows = conn.execute(
                    sa.select(jobs.c.id)
                    .where(jobs.c.workspace_id == workspace_id, jobs.c.state.notin_(live))
                    .order_by(jobs.c.created_at, jobs.c.id)
                ).scalars().all()
            for job_id in rows:
                try:
                    self.job_store.cancel(workspace_id, job_id)
                except UnknownJob:
                    # Another worker may have moved/deleted it after our short read transaction.
                    continue

    def cancel_subscriptions(self, plan: DeletionPlan, _key: str) -> None:
        for workspace_id in plan.cancel_billing_for:
            with transaction(self.engine, workspace_id) as conn:
                rows = conn.execute(
                    sa.select(
                        subscriptions.c.stripe_subscription_id,
                        subscriptions.c.raw,
                    ).where(subscriptions.c.workspace_id == workspace_id)
                ).all()

            for subscription_id, previous in rows:
                # Stripe calls are outside DB transactions. Repeating DELETE is safe; after a
                # network timeout a retry asks Stripe again before updating our snapshot.
                remote = self.stripe.cancel_subscription(subscription_id)
                if remote is None:
                    remote = {**(previous or {}), "id": subscription_id, "status": "canceled"}
                elif remote.get("id") != subscription_id:
                    raise DeletionEffectError("Stripe returned a different subscription id.")
                if remote.get("status") != "canceled":
                    raise DeletionEffectError("Stripe did not confirm subscription cancellation.")
                with transaction(self.engine, workspace_id) as conn:
                    now = db_now(conn)
                    stripe_sync.upsert_subscription(
                        conn,
                        workspace_id,
                        remote,
                        now,
                        price_map=self.price_map,
                    )
                    stripe_sync.recompute_snapshot(conn, workspace_id, self.price_map, now)

    def remove_memberships(self, plan: DeletionPlan, _key: str) -> None:
        # A deleted account cannot authenticate during the recovery period, so memberships are
        # revoked immediately. Owned workspace rows and their data remain for the recovery window.
        for workspace_id in set(plan.owned_workspace_ids + plan.member_workspace_ids):
            with transaction(self.engine, workspace_id) as conn:
                conn.execute(
                    workspace_members.delete().where(
                        workspace_members.c.workspace_id == workspace_id,
                        workspace_members.c.user_id == plan.user_id,
                    )
                )

    def delete_objects(self, plan: DeletionPlan, _key: str) -> None:
        for workspace_id in plan.owned_workspace_ids:
            with transaction(self.engine, workspace_id) as conn:
                uploads = conn.execute(
                    sa.select(upload_sessions).where(
                        upload_sessions.c.workspace_id == workspace_id
                    )
                ).mappings().all()

            # Staging keys are not under a workspace prefix. Remove/abort these separately now;
            # accepted assets and derived data are merely tombstoned and purged after 30 days.
            for row in uploads:
                if row["upload_id"]:
                    self.objects.abort_multipart_upload(
                        self.buckets.staging, row["staging_key"], row["upload_id"]
                    )
                self.objects.delete_object(self.buckets.staging, row["staging_key"])

            with transaction(self.engine, workspace_id) as conn:
                tombstone(
                    conn,
                    workspace_id,
                    DeletionKind.ACCOUNT,
                    workspace_id,
                    quota=_QuotaRelease(),
                )
                now = db_now(conn)
                active = conn.execute(
                    sa.select(upload_sessions).where(
                        upload_sessions.c.workspace_id == workspace_id,
                        upload_sessions.c.status.in_(
                            ("planned", "uploading", "completing", "completed")
                        ),
                    )
                ).mappings().all()
                for row in active:
                    if row["reservation_id"]:
                        quota.release(conn, row["reservation_id"])
                    conn.execute(
                        upload_sessions.update()
                        .where(upload_sessions.c.id == row["id"])
                        .values(
                            status="aborted",
                            error="The account was deleted.",
                            updated_at=now,
                        )
                    )

    def delete_workspace_rows(self, plan: DeletionPlan, _key: str) -> None:
        if db_now_from_engine(self.engine) < plan.erase_after:
            raise DeletionNotReady("Workspace cleanup is held through the 30-day recovery period.")
        load_all_tables()
        for workspace_id in plan.owned_workspace_ids:
            with transaction(self.engine, workspace_id) as conn:
                tombstone_row = conn.execute(
                    sa.select(deletions.c.id, deletions.c.physical_done_at).where(
                        deletions.c.workspace_id == workspace_id,
                        deletions.c.kind == DeletionKind.ACCOUNT.value,
                        deletions.c.ref == workspace_id,
                    )
                ).first()
                if tombstone_row is None:
                    raise DeletionNotReady(
                        f"The account deletion tombstone for workspace {workspace_id} is missing."
                    )
                if tombstone_row.physical_done_at is None:
                    raise DeletionNotReady(
                        f"The account object purge for workspace {workspace_id} is not complete."
                    )
                live_jobs = conn.execute(
                    sa.select(sa.func.count())
                    .select_from(jobs)
                    .where(
                        jobs.c.workspace_id == workspace_id,
                        jobs.c.state.notin_([str(state) for state in TERMINAL]),
                    )
                ).scalar_one()
                if live_jobs:
                    raise DeletionNotReady(
                        f"Workspace {workspace_id} still has jobs waiting for cancellation."
                    )
            with transaction(self.engine) as conn:
                self._clear_user_references(conn, plan.user_id)
            with transaction(self.engine, workspace_id) as conn:
                # The dependency table has no workspace_id of its own. Remove edges for jobs in
                # this workspace before deleting their attempts and rows.
                ids = sa.select(jobs.c.id).where(jobs.c.workspace_id == workspace_id)
                conn.execute(
                    job_dependencies.delete().where(
                        sa.or_(
                            job_dependencies.c.job_id.in_(ids),
                            job_dependencies.c.depends_on.in_(ids),
                        )
                    )
                )
                # Delete children before parents to satisfy the explicit room and device FKs.
                for table in reversed(metadata.sorted_tables):
                    if "workspace_id" not in table.c or table.name in PRESERVED_WORKSPACE_TABLES:
                        continue
                    conn.execute(table.delete().where(table.c.workspace_id == workspace_id))
                conn.execute(
                    dangerous_actions.update()
                    .where(dangerous_actions.c.workspace_id == workspace_id)
                    .values(workspace_id=None)
                )
                conn.execute(
                    audit_events.update()
                    .where(audit_events.c.workspace_id == workspace_id)
                    .values(workspace_id=None)
                )
                conn.execute(
                    workspaces.delete().where(
                        workspaces.c.id == workspace_id,
                        workspaces.c.owner_user_id == plan.user_id,
                    )
                )

    def record_in_deletions_ledger(self, plan: DeletionPlan, key: str) -> None:
        if self.ledger_writer is None:
            raise DeletionEffectError("The off-database deletion ledger writer isn't configured.")
        for workspace_id in plan.owned_workspace_ids:
            with transaction(self.engine, workspace_id) as conn:
                entries = [
                    dict(row)
                    for row in conn.execute(
                        sa.select(deletions).where(
                            deletions.c.workspace_id == workspace_id,
                            deletions.c.kind == DeletionKind.ACCOUNT.value,
                        )
                    ).mappings()
                ]
            self.ledger_writer.write(entries, f"{key}:{workspace_id}", plan)

    def erase_user(self, plan: DeletionPlan, _key: str) -> None:
        if db_now_from_engine(self.engine) < plan.erase_after:
            raise DeletionNotReady("User erasure is held through the 30-day recovery period.")
        with transaction(self.engine) as conn:
            self._clear_user_references(conn, plan.user_id)
            remaining = self._remaining_user_references(conn, plan.user_id)
            if remaining:
                raise DeletionNotReady(
                    "User erasure stopped because linked data remains in: " + ", ".join(remaining)
                )
            conn.execute(users.delete().where(users.c.id == plan.user_id))

    @staticmethod
    def _clear_user_references(conn, user_id: str) -> None:
        """Remove direct user links while preserving anonymized security/payment evidence."""
        user = conn.execute(sa.select(users).where(users.c.id == user_id)).mappings().first()
        email = user["email"] if user else None

        conn.execute(flag_previews.delete().where(flag_previews.c.user_id == user_id))
        conn.execute(
            user_flag_preferences.delete().where(user_flag_preferences.c.user_id == user_id)
        )
        conn.execute(
            flag_rule_versions.update()
            .where(flag_rule_versions.c.subject_user_id == user_id)
            .values(subject_user_id=None)
        )

        conn.execute(role_assignments.delete().where(role_assignments.c.user_id == user_id))
        conn.execute(
            role_assignments.update()
            .where(role_assignments.c.issued_by == user_id)
            .values(issued_by=ANONYMIZED_ID)
        )
        conn.execute(
            role_assignments.update()
            .where(role_assignments.c.revoked_by == user_id)
            .values(revoked_by=None)
        )

        conn.execute(access_grants.delete().where(access_grants.c.staff_user_id == user_id))
        conn.execute(
            access_grants.update()
            .where(access_grants.c.issued_by == user_id)
            .values(issued_by=ANONYMIZED_ID)
        )
        conn.execute(
            access_grants.update()
            .where(access_grants.c.approved_by == user_id)
            .values(approved_by=None)
        )
        conn.execute(
            access_grants.update()
            .where(access_grants.c.revoked_by == user_id)
            .values(revoked_by=None)
        )

        conn.execute(
            dangerous_actions.update()
            .where(dangerous_actions.c.proposer_id == user_id)
            .values(
                proposer_id=ANONYMIZED_ID,
                status=sa.case(
                    (dangerous_actions.c.status == "pending", "cancelled"),
                    else_=dangerous_actions.c.status,
                ),
                approver_id=sa.case(
                    (dangerous_actions.c.approver_id == user_id, None),
                    else_=dangerous_actions.c.approver_id,
                ),
                finished_by=sa.case(
                    (dangerous_actions.c.finished_by == user_id, None),
                    else_=dangerous_actions.c.finished_by,
                ),
            )
        )
        conn.execute(
            dangerous_actions.update()
            .where(dangerous_actions.c.approver_id == user_id)
            .values(approver_id=None)
        )
        conn.execute(
            dangerous_actions.update()
            .where(dangerous_actions.c.finished_by == user_id)
            .values(finished_by=None)
        )
        conn.execute(
            dangerous_actions.update()
            .where(dangerous_actions.c.resource_id == user_id)
            .values(resource_id=None)
        )

        conn.execute(
            audit_events.update()
            .where(audit_events.c.actor_id == user_id)
            .values(
                actor_id=None,
                resource_id=sa.case(
                    (
                        sa.and_(
                            audit_events.c.resource_type == "user",
                            audit_events.c.resource_id == user_id,
                        ),
                        None,
                    ),
                    else_=audit_events.c.resource_id,
                ),
            )
        )
        conn.execute(
            audit_events.update()
            .where(audit_events.c.resource_id == user_id)
            .values(resource_id=None)
        )
        conn.execute(session_revocations.delete().where(session_revocations.c.user_id == user_id))

        # Keep evidence that immediate access was requested, but unlink it from the account and
        # discard the IP hash, which is still personal data even though it is one-way.
        consent_match = checkout_consents.c.user_id == user_id
        if email:
            consent_match = sa.or_(consent_match, checkout_consents.c.user_id == email)
        conn.execute(
            checkout_consents.update()
            .where(consent_match)
            .values(user_id=ANONYMIZED_ID, ip_hash=None)
        )

        for table, columns in (
            (entitlement_overrides, ("actor", "revoked_by")),
            (flag_rule_versions, ("author",)),
        ):
            for column_name in columns:
                column = table.c[column_name]
                match = column == user_id
                if email:
                    match = sa.or_(match, column == email)
                conn.execute(table.update().where(match).values({column_name: ANONYMIZED_LABEL}))

        from selecta.ai.schema import model_routing_versions

        for author in (user_id, email):
            if author:
                conn.execute(
                    model_routing_versions.update()
                    .where(model_routing_versions.c.author == author)
                    .values(author=ANONYMIZED_LABEL)
                )
        conn.execute(
            jobs.update().where(jobs.c.created_by == user_id).values(created_by=None)
        )

    @staticmethod
    def _remaining_user_references(conn, user_id: str) -> list[str]:
        load_all_tables()
        remaining: list[str] = []
        for table in metadata.tables.values():
            if table.name == "users" or table.name in PRESERVED_USER_LINKS:
                continue
            for column_name in USER_REFERENCE_COLUMNS:
                if column_name not in table.c:
                    continue
                if conn.execute(
                    sa.select(sa.literal(1))
                    .select_from(table)
                    .where(table.c[column_name] == user_id)
                    .limit(1)
                ).first():
                    remaining.append(f"{table.name}.{column_name}")
        return sorted(set(remaining))


def db_now_from_engine(engine: Engine) -> float:
    """Read the database clock in a short, unscoped transaction."""
    with transaction(engine) as conn:
        return db_now(conn)
