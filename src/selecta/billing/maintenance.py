"""Retry stored Stripe webhook events from the billing maintenance runner."""

from __future__ import annotations

import logging
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.engine import Engine

from selecta.admin import state as emergency_state
from selecta.authz import audit
from selecta.billing import plans, stripe_sync
from selecta.billing.stripe_sync import PriceMap, StripeClient
from selecta.billing.webhooks import pending_events, process_event
from selecta.persistence import transaction
from selecta.usage import quota
from selecta.usage.schema import quota_state

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class StripeDrainResult:
    """Counts from one bounded drain of the durable webhook queue."""

    selected: int = 0
    processed: int = 0
    failed: int = 0
    busy: int = 0
    ignored: int = 0
    missing: int = 0
    errors: int = 0


@dataclass(frozen=True)
class StripeReconcileResult:
    """One full Stripe reconciliation and the entitlement changes it found."""

    checked: int
    changed: int
    unmatched: int
    quota_limits_updated: int
    audit_entries: int = 0
    unknown_prices: int = 0


def drain_stripe_events(
    engine: Engine,
    client: StripeClient,
    price_map: PriceMap,
    *,
    limit: int = 50,
    max_attempts: int = 10,
) -> StripeDrainResult:
    """Process a bounded batch of received/failed events, one transaction per event.

    The queue is platform-wide and the workspace is not known until the event is fetched from
    Stripe. The maintenance database role therefore opens each event transaction without a
    workspace scope. `process_event` updates the event, subscriptions, and entitlement snapshots
    together; a failure rolls the whole event back. Its row lock makes this safe alongside the
    synchronous webhook path or another runner.
    """
    if limit < 1 or max_attempts < 1:
        raise ValueError("limit and max_attempts must be positive")

    with transaction(engine) as connection:
        event_ids = pending_events(connection, limit=limit, max_attempts=max_attempts)
        if emergency_state.load(connection).billing_safe_mode:
            event_ids = []  # billing safe mode holds stored events until it ends

    counts = {
        "selected": len(event_ids), "processed": 0, "failed": 0, "busy": 0,
        "ignored": 0, "missing": 0, "errors": 0,
    }
    for event_id in event_ids:
        try:
            with transaction(engine) as connection:
                result = process_event(connection, event_id, client, price_map)
                # process_event recomputes billing snapshots. Keep storage quotas in sync in the
                # same transaction so retries cannot leave entitlements and limits out of step.
                for workspace_id in result.workspaces:
                    entitlement = stripe_sync.effective_entitlement(connection, workspace_id)
                    quota.set_limit(
                        connection,
                        workspace_id,
                        plans.plan_for(entitlement.plan_id, entitlement.plan_version),
                    )
            status = result.status
            counts[status] = counts.get(status, 0) + 1
        except Exception as error:  # noqa: BLE001 - one broken event must not block the batch
            counts["errors"] += 1
            # Avoid logging event payloads, Stripe error text, or credentials from HTTP errors.
            log.warning(
                "Stripe event maintenance failed (event=%s, error_type=%s)",
                event_id,
                type(error).__name__,
            )

    return StripeDrainResult(**counts)


def reconcile_stripe_billing(
    engine: Engine, client: StripeClient, price_map: PriceMap
) -> StripeReconcileResult:
    """Re-fetch all Stripe subscriptions and sync affected workspace quota limits.

    Call from a scheduled maintenance process, not a customer request. Stripe lookups and the
    resulting snapshot/quota changes commit together; a Stripe outage leaves the prior snapshots
    untouched and can be retried on the next scheduled run.
    """
    with transaction(engine) as connection:
        report = stripe_sync.reconcile_all(connection, client, price_map)
        affected = {item.workspace_id for item in report.items}
        # Overrides may expire without any Stripe change. Refresh all existing quota
        # accounts too, using the effective entitlement rather than the paid snapshot.
        affected.update(connection.execute(select(quota_state.c.workspace_id)).scalars())
        for workspace_id in sorted(affected):
            entitlement = stripe_sync.effective_entitlement(connection, workspace_id)
            quota.set_limit(
                connection,
                workspace_id,
                plans.plan_for(entitlement.plan_id, entitlement.plan_version),
            )
        # Keep the drift correction and its audit evidence atomic. Values here are limited to
        # the compared billing fields; the Stripe payload itself is never copied into the log.
        for item in report.items:
            audit.record(
                connection,
                action="billing.reconciliation.drift_corrected",
                result=audit.AuditResult.SUCCESS,
                resource_type="stripe_subscription",
                resource_id=item.subscription_id,
                workspace_id=item.workspace_id,
                reason=f"Stripe reconciliation corrected {item.field}",
                metadata={"field": item.field, "before": item.ours, "after": item.stripe},
            )
        for subscription_id in report.unmatched:
            audit.record(
                connection,
                action="billing.reconciliation.unmatched_subscription",
                result=audit.AuditResult.FAILURE,
                resource_type="stripe_subscription",
                resource_id=subscription_id,
                reason="Stripe subscription could not be associated with a workspace",
            )
        # A price missing from the map grants Free to someone Stripe charges: nothing here can
        # fix that, so it is recorded as a failure for staff to act on.
        for item in report.unknown_prices:
            audit.record(
                connection,
                action="billing.reconciliation.unknown_price",
                result=audit.AuditResult.FAILURE,
                resource_type="stripe_subscription",
                resource_id=item.subscription_id,
                workspace_id=item.workspace_id,
                reason="Stripe subscription price is not in the price map",
                metadata={"price_id": item.stripe},
            )
    from selecta.observability import metrics

    metrics.set_gauge("selecta_reconciliation_drift",
                      len(report.items) + len(report.unmatched) + len(report.unknown_prices),
                      check="billing")
    return StripeReconcileResult(
        checked=report.checked,
        changed=len(report.items),
        unmatched=len(report.unmatched),
        quota_limits_updated=len(affected),
        audit_entries=len(report.items) + len(report.unmatched) + len(report.unknown_prices),
        unknown_prices=len(report.unknown_prices),
    )


__all__ = [
    "StripeDrainResult",
    "StripeReconcileResult",
    "drain_stripe_events",
    "reconcile_stripe_billing",
]
