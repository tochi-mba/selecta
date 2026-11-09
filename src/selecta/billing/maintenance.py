"""Retry stored Stripe webhook events from the billing maintenance runner."""

from __future__ import annotations

import logging
from dataclasses import dataclass

from sqlalchemy.engine import Engine

from selecta.billing import plans, stripe_sync
from selecta.billing.stripe_sync import PriceMap, StripeClient
from selecta.billing.webhooks import pending_events, process_event
from selecta.persistence import transaction
from selecta.usage import quota

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
                    snapshot, _changed = stripe_sync.recompute_snapshot(
                        connection, workspace_id, price_map
                    )
                    quota.set_limit(
                        connection,
                        workspace_id,
                        plans.plan_for(snapshot.plan_id, snapshot.plan_version),
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
