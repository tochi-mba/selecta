"""Scrambled-event replay at scale (ADR-0403, SC-0403-02; test plan §18.14).

Thousands of workspaces each live through a long Stripe history. Every change Stripe makes sends
an event; each event is delivered one to three times, late, out of order, interleaved with every
other workspace's deliveries, and some of them meet a Stripe outage or a one-off 503. After the
last delivery Stripe is back and the retry drain runs. Every workspace must then hold exactly the
entitlement snapshot its final Stripe subscription implies, and every subscription row must hold
Stripe's final word.

The run is seeded, so a failure replays exactly. Its size is the number of webhook deliveries:
`SELECTA_BILLING_REPLAY_DELIVERIES` (the weekly nightly run sets 250,000; locally that takes a
few minutes on SQLite), defaulting to a size that keeps the everyday suite quick. The seed comes
from `SELECTA_BILLING_REPLAY_SEED` when set.

The Hypothesis property in `test_cloud_billing_webhooks.py` explores odd orders for one
subscription; this one checks the same promise holds across a long, crowded history.
"""

from __future__ import annotations

import bisect
import os
import random
import time
from dataclasses import dataclass, field
from typing import Any

import sqlalchemy as sa
from test_cloud_billing_fakes import PRICE_MAP, FakeStripe, event, subscription

from selecta.billing.schema import stripe_events, subscriptions
from selecta.billing.stripe_sync import current_snapshot, snapshot_from_subscription
from selecta.billing.webhooks import pending_events, process_event, store_event
from selecta.persistence import transaction

DELIVERIES_ENV = "SELECTA_BILLING_REPLAY_DELIVERIES"
SEED_ENV = "SELECTA_BILLING_REPLAY_SEED"
DEFAULT_DELIVERIES = 10_000
DEFAULT_SEED = 403_02
BATCH = 500
"""Deliveries per transaction. Processing is per event either way; batching only spares SQLite
a commit per delivery."""

NOW = 1_800_000_000
DAY = 86_400
STATUSES = ("active", "active", "trialing", "past_due", "canceled", "unpaid", "incomplete",
            "incomplete_expired")
PRICES = ("price_standard_month", "price_standard_year", "price_premium_month", "price_unknown")
SUBSCRIPTION_EVENTS = ("customer.subscription.created", "customer.subscription.updated",
                       "customer.subscription.deleted")
INVOICE_EVENTS = ("invoice.paid", "invoice.payment_failed")


@dataclass
class Account:
    """One workspace, its customer and subscription, and every state Stripe moves it through."""

    workspace: str
    customer: str
    sub_id: str
    charge: str
    states: list[dict[str, Any]] = field(default_factory=list)
    reached: int = -1


def stripe_state(rng: random.Random, account: Account) -> dict[str, Any]:
    status = rng.choice(STATUSES)
    extra: dict[str, Any] = {"cancel_at_period_end": rng.random() < 0.2}
    if status == "past_due":
        # Stripe expands the failing invoice when asked; the grace runs from its finalisation.
        extra["latest_invoice"] = {
            "object": "invoice",
            "status_transitions": {"finalized_at": NOW - rng.randint(0, 10) * DAY},
        }
    elif rng.random() < 0.1:
        extra["cancel_at"] = NOW + rng.randint(1, 40) * DAY
    return subscription(
        account.sub_id, workspace=account.workspace, customer=account.customer, status=status,
        price=rng.choice(PRICES), period_end=NOW + rng.randint(1, 60) * DAY, **extra,
    )


def pointer(rng: random.Random, account: Account, state: dict[str, Any]) -> tuple[str, dict]:
    """An event about this change. Its body is a pointer: processing re-fetches what it names,
    so a stale body (as every late delivery's is) must not matter."""
    roll = rng.random()
    if roll < 0.45:
        return rng.choice(SUBSCRIPTION_EVENTS), dict(state)
    if roll < 0.75:
        return rng.choice(INVOICE_EVENTS), {"object": "invoice", "subscription": account.sub_id,
                                            "customer": account.customer}
    if roll < 0.82:
        return "invoice.payment_action_required", {"object": "invoice",
                                                   "customer": account.customer}
    if roll < 0.9:
        return "entitlements.active_entitlement_summary.updated", {
            "object": "entitlements.active_entitlement_summary", "customer": account.customer}
    return "charge.refunded", {"object": "charge", "id": account.charge}


@dataclass
class Scenario:
    stripe: FakeStripe
    accounts: list[Account]
    changes: list[tuple[float, int]]
    """(when, account index): Stripe moves that account to its next state."""
    deliveries: list[tuple[float, dict[str, Any]]]
    """(when, event): one delivery of an event; an event appears one to three times."""
    outages: list[tuple[float, float]]
    events: int


def build(seed: int, target: int) -> Scenario:
    rng = random.Random(seed)
    stripe = FakeStripe()
    accounts: list[Account] = []
    changes: list[tuple[float, int]] = []
    deliveries: list[tuple[float, dict[str, Any]]] = []
    horizon = 0.0
    events = 0
    while len(deliveries) < target:
        index = len(accounts)
        account = Account(f"w_{index:05d}", f"cus_{index:05d}", f"sub_{index:05d}",
                          f"ch_{index:05d}")
        accounts.append(account)
        stripe.charges[account.charge] = {"id": account.charge, "customer": account.customer}
        when = rng.uniform(0, DAY)
        for number in range(rng.randint(20, 60)):
            when += rng.expovariate(1 / 600)  # changes about ten minutes apart
            state = stripe_state(rng, account)
            account.states.append(state)
            changes.append((when, index))
            kind, body = pointer(rng, account, state)
            evt = event(f"evt_{index:05d}_{number:03d}", kind, body, created=int(NOW + when))
            events += 1
            for _ in range(rng.choice((1, 1, 2, 2, 3))):
                if rng.random() < 0.05:
                    delay = rng.uniform(0, DAY)  # retried by Stripe hours later
                else:
                    delay = rng.expovariate(1 / 120)  # usually a couple of minutes
                deliveries.append((when + 0.001 + delay, evt))
                horizon = max(horizon, when + delay)
        if rng.random() < 0.03:
            # Stripe also sends events Selecta stores and ignores.
            deliveries.append((rng.uniform(0, horizon), event(
                f"evt_{index:05d}_other", "product.created", {"object": "product"})))
            events += 1
    outages = []
    for _ in range(max(3, int(horizon // (6 * 3_600)))):
        start = rng.uniform(0, horizon)
        outages.append((start, start + rng.uniform(300, 2_400)))
    outages.sort()
    changes.sort()
    deliveries.sort(key=lambda item: item[0])
    return Scenario(stripe, accounts, changes, deliveries, outages, events)


def in_outage(outages: list[tuple[float, float]], when: float) -> bool:
    at = bisect.bisect_right(outages, (when, float("inf"))) - 1
    return any(start <= when < end for start, end in outages[max(0, at - 3):at + 1])


def replay(engine, scenario: Scenario, seed: int) -> dict[str, int]:
    rng = random.Random(seed + 1)
    stripe, accounts = scenario.stripe, scenario.accounts
    counts = {"deliveries": 0, "duplicates": 0, "failed": 0, "drained": 0}
    next_change = 0

    def stripe_catches_up_to(moment: float) -> None:
        nonlocal next_change
        while next_change < len(scenario.changes) and scenario.changes[next_change][0] <= moment:
            account = accounts[scenario.changes[next_change][1]]
            account.reached += 1
            stripe.put(account.states[account.reached])
            next_change += 1

    for start in range(0, len(scenario.deliveries), BATCH):
        with transaction(engine) as conn:
            for when, evt in scenario.deliveries[start:start + BATCH]:
                stripe_catches_up_to(when)
                stripe.down = in_outage(scenario.outages, when)
                stripe.fail_next = 1 if rng.random() < 0.03 else 0
                stored = store_event(conn, evt)
                result = process_event(conn, evt["id"], stripe, PRICE_MAP, NOW)
                counts["deliveries"] += 1
                counts["duplicates"] += not stored.stored
                counts["failed"] += result.status == "failed"
    stripe_catches_up_to(float("inf"))
    stripe.down, stripe.fail_next = False, 0  # Stripe is back
    while True:  # the retry drain, as the scheduled job runs it
        with transaction(engine) as conn:
            waiting = pending_events(conn, limit=BATCH)
            for event_id in waiting:
                assert process_event(conn, event_id, stripe, PRICE_MAP, NOW).status == "processed"
        counts["drained"] += len(waiting)
        if not waiting:
            return counts


def test_a_long_scrambled_replay_ends_every_workspace_at_its_final_stripe_state(sqlite_engine):
    target = int(os.environ.get(DELIVERIES_ENV) or DEFAULT_DELIVERIES)
    seed = int(os.environ.get(SEED_ENV) or DEFAULT_SEED)
    started = time.perf_counter()
    scenario = build(seed, target)

    counts = replay(sqlite_engine, scenario, seed)

    wrong = []
    with transaction(sqlite_engine) as conn:
        stored = conn.execute(sa.select(sa.func.count()).select_from(stripe_events)).scalar_one()
        unfinished = conn.execute(
            sa.select(sa.func.count()).select_from(stripe_events)
            .where(stripe_events.c.processed_at.is_(None))
        ).scalar_one()
        rows = {row["stripe_subscription_id"]: row
                for row in conn.execute(sa.select(subscriptions)).mappings()}
        for account in scenario.accounts:
            final = scenario.stripe.subscriptions[account.sub_id]
            expected = snapshot_from_subscription(final, PRICE_MAP, NOW)
            snapshot = current_snapshot(conn, account.workspace)
            if snapshot is None or not snapshot.same_as(expected):
                wrong.append((account.workspace, snapshot, expected))
            elif rows[account.sub_id]["raw"] != final:
                wrong.append((account.workspace, "stale subscription row", final))
    elapsed = time.perf_counter() - started
    print(f"\nscrambled replay: seed {seed}, {len(scenario.accounts)} workspaces, "
          f"{scenario.events} events, {counts['deliveries']} deliveries "
          f"({counts['duplicates']} duplicates, {counts['failed']} failed, "
          f"{counts['drained']} drained), {len(scenario.outages)} outages, {elapsed:.1f}s")

    assert all(account.reached == len(account.states) - 1 for account in scenario.accounts)
    assert counts["deliveries"] >= target and stored == scenario.events
    assert counts["duplicates"] > 0 and counts["failed"] > 0 and counts["drained"] > 0
    assert unfinished == 0
    assert not wrong, f"{len(wrong)} workspaces ended wrong, first: {wrong[:3]}"
