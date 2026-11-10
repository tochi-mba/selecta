"""From Stripe subscriptions to what a workspace may use (ADR-0403, §8.3).

Stripe is the clock and the till; Selecta decides entitlements from what Stripe says, never from
what the browser says. The rules:

| Stripe says | The workspace gets |
|---|---|
| active or trialing | the plan of its price, at once (so an upgrade applies immediately) |
| cancel at period end | the plan until the period ends, then Free |
| past_due | the plan for 7 days from when the renewal failed, while Smart Retries run; then Free |
| canceled, unpaid, incomplete_expired, paused, or a lost dispute | Free |
| incomplete | Free until the first payment goes through |

A downgrade chosen in the Customer Portal takes effect at period end because that's when Stripe
changes the subscription's price; nothing here needs to know about it. Each answer is stored as
an entitlement snapshot with a version that only goes up. If Stripe can't be reached, the last
verified snapshot keeps applying for up to 72 hours past its natural end. A staff override is
read beside the snapshot and is labelled as an override, so it never looks like Stripe charged.

The price map (price id -> plan, plan version, interval) comes from configuration: the JSON in
`SELECTA_STRIPE_PRICES`, for example `{"price_123": {"plan": "standard", "version": 1,
"interval": "month"}}`. A price that isn't in it grants nothing: each decision that meets one
logs a `billing.unknown_price` warning (the alert), and reconciliation lists it in
`DriftReport.unknown_prices` for the audit log and the admin Billing page.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
import math
import os
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field, replace
from enum import StrEnum
from typing import Any, Protocol

import sqlalchemy as sa
from sqlalchemy.engine import Connection

from selecta.billing.schema import (
    checkout_consents,
    entitlement_overrides,
    entitlement_snapshots,
    subscriptions,
)
from selecta.persistence import db_now, new_id

log = logging.getLogger(__name__)

PLAN_IDS = ("free", "standard", "premium")
PLAN_RANK = {plan: rank for rank, plan in enumerate(PLAN_IDS)}
PAID_PLANS = frozenset({"standard", "premium"})
INTERVALS = frozenset({"month", "year"})
PRICE_MAP_ENV = "SELECTA_STRIPE_PRICES"
IP_HASH_KEY_ENV = "SELECTA_IP_HASH_KEY"

PAST_DUE_GRACE_SECONDS = 7 * 86_400
OUTAGE_HOLD_SECONDS = 72 * 3_600
RENEWAL_SLACK_SECONDS = 2 * 3_600  # a renewal's webhook can trail the period end a little
GRANTING = frozenset({"active", "trialing"})
RENEWING = GRANTING  # snapshot reasons whose end Stripe normally extends with a renewal
ENDED = frozenset({"canceled", "unpaid", "incomplete_expired", "paused", "incomplete"})


class StripeUnavailable(RuntimeError):
    """Stripe couldn't be reached or answered with a server error. Retry later."""


class StripeClient(Protocol):
    """Stripe operations used by billing and account lifecycle workflows."""

    def get_subscription(self, subscription_id: str) -> dict[str, Any] | None: ...

    def cancel_subscription(self, subscription_id: str) -> dict[str, Any] | None: ...

    def list_subscriptions(self, customer: str | None = None) -> Iterable[dict[str, Any]]:
        """Every subscription in any status, all pages, optionally for one customer."""
        ...

    def get_charge(self, charge_id: str) -> dict[str, Any] | None: ...


# The price map ----------------------------------------------------------------------------


@dataclass(frozen=True)
class PricePlan:
    plan_id: str
    plan_version: int
    interval: str


PriceMap = Mapping[str, PricePlan]


def parse_price_map(data: Mapping[str, Any]) -> dict[str, PricePlan]:
    if not isinstance(data, Mapping):
        raise ValueError("The price map must be a JSON object of price ids.")
    plans: dict[str, PricePlan] = {}
    for price_id, entry in data.items():
        if not isinstance(entry, Mapping):
            raise ValueError(f"Price {price_id} needs an object with its plan.")
        plan_id = entry.get("plan") or entry.get("plan_id")
        if plan_id not in PAID_PLANS:
            raise ValueError(f"Price {price_id} names {plan_id!r}; only paid plans have prices.")
        interval = entry.get("interval", "month")
        if interval not in INTERVALS:
            raise ValueError(f"Price {price_id} has interval {interval!r}.")
        version = int(entry.get("version", entry.get("plan_version", 1)))
        plans[str(price_id)] = PricePlan(plan_id, version, interval)
    return plans


def load_price_map(environ: Mapping[str, str] | None = None) -> dict[str, PricePlan]:
    """The price map from `SELECTA_STRIPE_PRICES`; empty when unset (no paid plans on sale)."""
    env = os.environ if environ is None else environ
    raw = env.get(PRICE_MAP_ENV)
    return parse_price_map(json.loads(raw)) if raw else {}


# Reading Stripe's subscription shape ------------------------------------------------------


def stripe_id(value: Any) -> str | None:
    """An id whether Stripe sent the bare id or the expanded object."""
    if isinstance(value, Mapping):
        value = value.get("id")
    return str(value) if value else None


def _items(sub: Mapping[str, Any]) -> list[Mapping[str, Any]]:
    return list((sub.get("items") or {}).get("data") or [])


def plan_for(sub: Mapping[str, Any], price_map: PriceMap) -> tuple[str | None, PricePlan | None]:
    """The highest plan among the subscription's items, with its price id."""
    best_id, best = None, None
    for item in _items(sub):
        price_id = stripe_id(item.get("price") or item.get("plan"))
        plan = price_map.get(price_id) if price_id else None
        if best_id is None:
            best_id = price_id
        if plan and (best is None or PLAN_RANK[plan.plan_id] > PLAN_RANK[best.plan_id]):
            best_id, best = price_id, plan
    return best_id, best


def period_end(sub: Mapping[str, Any]) -> float | None:
    """`current_period_end`, which newer API versions keep on each item instead."""
    value = sub.get("current_period_end")
    if value is None:
        ends = [item["current_period_end"] for item in _items(sub)
                if item.get("current_period_end")]
        value = max(ends) if ends else None
    return float(value) if value is not None else None


def past_due_started(sub: Mapping[str, Any]) -> float | None:
    """When the failing renewal invoice was finalised, if the latest invoice was expanded."""
    invoice = sub.get("latest_invoice")
    if isinstance(invoice, Mapping):
        when = (invoice.get("status_transitions") or {}).get("finalized_at") or invoice.get(
            "created"
        )
        if when:
            return float(when)
    return None


# Deciding a snapshot -----------------------------------------------------------------------


class SnapshotSource(StrEnum):
    STRIPE = "stripe"
    DEFAULT = "default"


@dataclass(frozen=True)
class SnapshotDecision:
    plan_id: str
    plan_version: int | None
    source: SnapshotSource
    reason: str
    valid_until: float | None
    subscription_id: str | None = None


def _free(reason: str, subscription_id: str | None = None) -> SnapshotDecision:
    return SnapshotDecision("free", None, SnapshotSource.DEFAULT, reason, None, subscription_id)


def snapshot_from_subscription(
    sub: Mapping[str, Any], price_map: PriceMap, now: float, *,
    past_due_since: float | None = None, dispute_lost: bool = False,
) -> SnapshotDecision:
    """What one Stripe subscription grants at `now`, by the table at the top of this module."""
    sub_id = stripe_id(sub.get("id"))
    status = str(sub.get("status") or "unknown")
    if dispute_lost:
        return _free("dispute_lost", sub_id)
    if status in ENDED:
        return _free(status, sub_id)
    _, plan = plan_for(sub, price_map)
    if plan is None:
        return _free("unknown_price", sub_id)

    def paid(reason: str, until: float | None) -> SnapshotDecision:
        return SnapshotDecision(
            plan.plan_id, plan.plan_version, SnapshotSource.STRIPE, reason, until, sub_id
        )

    end = period_end(sub)
    if status == "past_due":
        since = past_due_since or past_due_started(sub) or now
        until = since + PAST_DUE_GRACE_SECONDS
        return paid("past_due_grace", until) if now < until else _free("past_due_expired", sub_id)
    if status not in GRANTING:
        return _free(status, sub_id)  # a status Stripe adds later grants nothing until reviewed
    if sub.get("cancel_at_period_end"):
        return paid("cancel_at_period_end", end)
    if sub.get("cancel_at"):
        until = float(sub["cancel_at"])
        return paid("cancel_at", min(until, end + RENEWAL_SLACK_SECONDS) if end else until)
    return paid(status, end + RENEWAL_SLACK_SECONDS if end else None)


def _better(a: SnapshotDecision, b: SnapshotDecision) -> bool:
    return (PLAN_RANK[a.plan_id], a.valid_until or math.inf) > (
        PLAN_RANK[b.plan_id], b.valid_until or math.inf
    )


# Subscriptions ----------------------------------------------------------------------------

TRACKED = ("status", "price_id", "current_period_end", "cancel_at_period_end")


@dataclass(frozen=True)
class SubscriptionChange:
    workspace_id: str
    subscription_id: str
    created: bool
    diff: dict[str, tuple[Any, Any]]
    """Tracked fields that differed: name -> (what we had, what Stripe says)."""


def workspace_for(
    conn: Connection, sub: Mapping[str, Any], hint: str | None = None
) -> str | None:
    """The subscription's workspace: Checkout metadata, the event's hint, then what we stored."""
    workspace = (sub.get("metadata") or {}).get("workspace_id") or hint
    if workspace:
        return str(workspace)
    found = conn.execute(
        sa.select(subscriptions.c.workspace_id).where(
            subscriptions.c.stripe_subscription_id == stripe_id(sub.get("id"))
        )
    ).scalar()
    customer = stripe_id(sub.get("customer"))
    if found is None and customer:
        found = conn.execute(
            sa.select(subscriptions.c.workspace_id)
            .where(subscriptions.c.stripe_customer_id == customer)
            .order_by(subscriptions.c.updated_at.desc())
            .limit(1)
        ).scalar()
    return found


def upsert_subscription(
    conn: Connection, workspace_id: str, sub: Mapping[str, Any], now: float, *,
    price_map: PriceMap | None = None, dispute_lost: bool = False,
) -> SubscriptionChange:
    """Store what Stripe just said about a subscription, replacing what we had."""
    sub_id = stripe_id(sub.get("id"))
    if not sub_id:
        raise ValueError("A Stripe subscription without an id.")
    existing = conn.execute(
        sa.select(subscriptions).where(subscriptions.c.stripe_subscription_id == sub_id)
    ).mappings().first()
    status = str(sub.get("status") or "unknown")
    past_due_since = None
    if status == "past_due":
        past_due_since = (
            past_due_started(sub) or (existing["past_due_since"] if existing else None) or now
        )
    values: dict[str, Any] = {
        "workspace_id": workspace_id,
        "stripe_subscription_id": sub_id,
        "stripe_customer_id": stripe_id(sub.get("customer")),
        "status": status,
        "price_id": plan_for(sub, price_map or {})[0],
        "current_period_end": period_end(sub),
        "cancel_at_period_end": bool(sub.get("cancel_at_period_end")),
        "past_due_since": past_due_since,
        "raw": dict(sub),
        "updated_at": now,
    }
    if dispute_lost and not (existing and existing["dispute_lost_at"]):
        values["dispute_lost_at"] = now
    if existing is None:
        conn.execute(sa.insert(subscriptions).values(id=new_id(), created_at=now, **values))
        return SubscriptionChange(workspace_id, sub_id, True, {"status": (None, status)})
    diff = {name: (existing[name], values[name]) for name in TRACKED
            if existing[name] != values[name]}
    conn.execute(
        sa.update(subscriptions).where(subscriptions.c.id == existing["id"]).values(**values)
    )
    return SubscriptionChange(workspace_id, sub_id, False, diff)


# Snapshots --------------------------------------------------------------------------------


@dataclass(frozen=True)
class Snapshot:
    workspace_id: str
    version: int
    plan_id: str
    plan_version: int | None
    source: str
    reason: str
    stripe_subscription_id: str | None
    valid_until: float | None
    computed_at: float
    verified_at: float

    @classmethod
    def from_row(cls, row: Mapping[str, Any]) -> Snapshot:
        return cls(**{name: row[name] for name in cls.__dataclass_fields__})

    def same_as(self, decision: SnapshotDecision) -> bool:
        return (
            self.plan_id, self.plan_version, self.source, self.reason,
            self.stripe_subscription_id, self.valid_until,
        ) == (
            decision.plan_id, decision.plan_version, decision.source.value, decision.reason,
            decision.subscription_id, decision.valid_until,
        )


def current_snapshot(conn: Connection, workspace_id: str) -> Snapshot | None:
    row = conn.execute(
        sa.select(entitlement_snapshots)
        .where(entitlement_snapshots.c.workspace_id == workspace_id)
        .order_by(entitlement_snapshots.c.version.desc())
        .limit(1)
    ).mappings().first()
    return Snapshot.from_row(row) if row else None


def write_snapshot(
    conn: Connection, workspace_id: str, decision: SnapshotDecision, now: float
) -> tuple[Snapshot, bool]:
    """Add a new version when the answer changed; otherwise note that Stripe confirmed it."""
    current = current_snapshot(conn, workspace_id)
    if current is not None and current.same_as(decision):
        conn.execute(
            sa.update(entitlement_snapshots)
            .where(entitlement_snapshots.c.workspace_id == workspace_id,
                   entitlement_snapshots.c.version == current.version)
            .values(verified_at=now)
        )
        return replace(current, verified_at=now), False
    snapshot = Snapshot(
        workspace_id=workspace_id, version=(current.version if current else 0) + 1,
        plan_id=decision.plan_id, plan_version=decision.plan_version,
        source=decision.source.value, reason=decision.reason,
        stripe_subscription_id=decision.subscription_id, valid_until=decision.valid_until,
        computed_at=now, verified_at=now,
    )
    conn.execute(sa.insert(entitlement_snapshots).values(id=new_id(), **snapshot.__dict__))
    # Tell the workspace's open pages, in the same transaction, so a page waiting on a checkout
    # hears the moment the plan really changed (docs/saas/08-billing.md §8.2).
    from selecta.work import outbox

    outbox.emit(
        conn,
        "entitlement.changed",
        workspace_id,
        {"plan": snapshot.plan_id, "version": snapshot.version},
        now,
    )
    return snapshot, True


def decide_workspace(
    conn: Connection, workspace_id: str, price_map: PriceMap, now: float
) -> SnapshotDecision:
    """The best grant among all of a workspace's subscriptions, or Free with the latest reason."""
    rows = conn.execute(
        sa.select(subscriptions)
        .where(subscriptions.c.workspace_id == workspace_id)
        .order_by(subscriptions.c.updated_at.desc())
    ).mappings().all()
    best: SnapshotDecision | None = None
    latest: SnapshotDecision | None = None
    for row in rows:
        decision = snapshot_from_subscription(
            row["raw"], price_map, now, past_due_since=row["past_due_since"],
            dispute_lost=row["dispute_lost_at"] is not None,
        )
        if decision.reason == "unknown_price":
            # A paying customer is getting Free: someone must add the price to the map.
            log.warning(
                "billing.unknown_price: subscription %s has price %s, which isn't in the "
                "price map, so it grants Free",
                row["stripe_subscription_id"], row["price_id"],
            )
        latest = latest or decision
        if decision.plan_id != "free" and (best is None or _better(decision, best)):
            best = decision
    return best or latest or _free("no_subscription")


def recompute_snapshot(
    conn: Connection, workspace_id: str, price_map: PriceMap, now: float | None = None
) -> tuple[Snapshot, bool]:
    now = db_now(conn) if now is None else now
    return write_snapshot(conn, workspace_id, decide_workspace(conn, workspace_id, price_map, now),
                          now)


# Overrides and the effective entitlement --------------------------------------------------


@dataclass(frozen=True)
class Override:
    id: str
    workspace_id: str
    plan_id: str
    reason: str
    actor: str
    expires_at: float
    created_at: float
    revoked_at: float | None


def grant_override(
    conn: Connection, *, workspace_id: str, plan_id: str, reason: str, actor: str,
    expires_at: float,
) -> str:
    """A staff decision with a reason, an actor and an expiry, kept apart from Stripe's data."""
    now = db_now(conn)
    if plan_id not in PLAN_RANK:
        raise ValueError(f"Unknown plan {plan_id!r}.")
    if not reason.strip() or not actor.strip():
        raise ValueError("An override needs a reason and the person granting it.")
    if expires_at <= now:
        raise ValueError("An override must expire in the future.")
    override_id = new_id()
    conn.execute(
        sa.insert(entitlement_overrides).values(
            id=override_id, workspace_id=workspace_id, plan_id=plan_id, reason=reason.strip(),
            actor=actor.strip(), expires_at=expires_at, created_at=now,
        )
    )
    return override_id


def revoke_override(conn: Connection, override_id: str, actor: str) -> bool:
    result = conn.execute(
        sa.update(entitlement_overrides)
        .where(entitlement_overrides.c.id == override_id,
               entitlement_overrides.c.revoked_at.is_(None))
        .values(revoked_at=db_now(conn), revoked_by=actor)
    )
    return result.rowcount == 1


def active_override(
    conn: Connection, workspace_id: str, now: float | None = None
) -> Override | None:
    """The newest override that hasn't expired or been revoked."""
    now = db_now(conn) if now is None else now
    row = conn.execute(
        sa.select(entitlement_overrides)
        .where(
            entitlement_overrides.c.workspace_id == workspace_id,
            entitlement_overrides.c.revoked_at.is_(None),
            entitlement_overrides.c.expires_at > now,
        )
        .order_by(entitlement_overrides.c.created_at.desc())
        .limit(1)
    ).mappings().first()
    if row is None:
        return None
    return Override(**{name: row[name] for name in Override.__dataclass_fields__})


@dataclass(frozen=True)
class Entitlement:
    workspace_id: str
    plan_id: str
    plan_version: int | None
    source: str  # "stripe", "default" or "override"
    paid_plan_id: str
    """What Stripe's data grants, whatever an override says."""
    reason: str
    valid_until: float | None
    snapshot_version: int | None
    override_id: str | None = None
    held: bool = False
    """True while a lapsed snapshot is kept because Stripe hasn't been heard from (outage)."""


def effective_entitlement(
    conn: Connection, workspace_id: str, now: float | None = None
) -> Entitlement:
    """The plan a workspace has right now: its snapshot, then any active override on top."""
    now = db_now(conn) if now is None else now
    snapshot = current_snapshot(conn, workspace_id)
    plan_id, plan_version, source, reason = "free", None, "default", "no_snapshot"
    valid_until, held = None, False
    if snapshot is not None:
        valid_until = snapshot.valid_until
        reason = snapshot.reason
        if snapshot.valid_until is None or now < snapshot.valid_until:
            plan_id, plan_version, source = (
                snapshot.plan_id, snapshot.plan_version, snapshot.source
            )
        elif (
            snapshot.reason in RENEWING
            and snapshot.verified_at < snapshot.valid_until
            and now < snapshot.valid_until + OUTAGE_HOLD_SECONDS
        ):
            # A renewal was due and Stripe hasn't been heard from since: keep the plan while
            # Stripe is unreachable. A known end (cancellation, past-due grace) is never held.
            plan_id, plan_version, source, held = (
                snapshot.plan_id, snapshot.plan_version, snapshot.source, True
            )
            reason = "held_during_outage"
        else:
            reason = "lapsed"
    paid_plan_id = plan_id
    override = active_override(conn, workspace_id, now)
    if override is not None:
        return Entitlement(
            workspace_id, override.plan_id, None, "override", paid_plan_id, override.reason,
            override.expires_at, snapshot.version if snapshot else None, override.id, held,
        )
    return Entitlement(
        workspace_id, plan_id, plan_version, source, paid_plan_id, reason, valid_until,
        snapshot.version if snapshot else None, None, held,
    )


# Nightly reconciliation -------------------------------------------------------------------


@dataclass(frozen=True)
class DriftItem:
    workspace_id: str
    subscription_id: str | None
    field: str
    ours: Any
    stripe: Any


@dataclass
class DriftReport:
    """What differed from Stripe and was corrected. The caller writes one audit entry each."""

    checked: int = 0
    items: list[DriftItem] = field(default_factory=list)
    unmatched: list[str] = field(default_factory=list)
    """Stripe subscriptions no workspace could be found for."""
    snapshots_changed: int = 0
    unknown_prices: list[DriftItem] = field(default_factory=list)
    """Live subscriptions whose price isn't in the price map, so they grant Free. Nothing is
    corrected for these; staff must add the price."""


def _paid_workspaces(conn: Connection) -> list[str]:
    """Workspaces whose newest snapshot grants a paid plan."""
    table = entitlement_snapshots
    latest = (
        sa.select(table.c.workspace_id, sa.func.max(table.c.version).label("version"))
        .group_by(table.c.workspace_id)
        .subquery()
    )
    query = (
        sa.select(table.c.workspace_id)
        .join(latest, sa.and_(table.c.workspace_id == latest.c.workspace_id,
                              table.c.version == latest.c.version))
        .where(table.c.plan_id != "free")
    )
    return list(conn.execute(query).scalars())


def reconcile_all(
    conn: Connection, client: StripeClient, price_map: PriceMap, now: float | None = None
) -> DriftReport:
    """List every Stripe subscription, fix what differs, and recompute affected snapshots.

    Run in one transaction: if Stripe fails part-way, `StripeUnavailable` rolls everything
    back and every workspace keeps its last verified snapshot.
    """
    now = db_now(conn) if now is None else now
    report = DriftReport()
    seen: set[str] = set()
    touched: set[str] = set()
    for sub in client.list_subscriptions():
        sub_id = stripe_id(sub.get("id"))
        if not sub_id:
            continue
        seen.add(sub_id)
        report.checked += 1
        workspace_id = workspace_for(conn, sub)
        if workspace_id is None:
            report.unmatched.append(sub_id)
            continue
        change = upsert_subscription(conn, workspace_id, sub, now, price_map=price_map)
        if snapshot_from_subscription(sub, price_map, now).reason == "unknown_price":
            report.unknown_prices.append(DriftItem(
                workspace_id, sub_id, "price_id", None, plan_for(sub, price_map)[0]
            ))
        report.items.extend(
            DriftItem(workspace_id, sub_id, name, ours, theirs)
            for name, (ours, theirs) in change.diff.items()
        )
        touched.add(workspace_id)
    stored = conn.execute(
        sa.select(subscriptions.c.id, subscriptions.c.workspace_id,
                  subscriptions.c.stripe_subscription_id, subscriptions.c.status,
                  subscriptions.c.raw)
    ).mappings().all()
    for row in stored:
        if row["stripe_subscription_id"] in seen or row["status"] == "canceled":
            continue
        raw = {**(row["raw"] or {}), "status": "canceled"}
        conn.execute(
            sa.update(subscriptions).where(subscriptions.c.id == row["id"])
            .values(status="canceled", raw=raw, updated_at=now)
        )
        report.items.append(DriftItem(row["workspace_id"], row["stripe_subscription_id"],
                                      "missing_in_stripe", row["status"], None))
        touched.add(row["workspace_id"])
    for workspace_id in sorted(touched | set(_paid_workspaces(conn))):
        before = current_snapshot(conn, workspace_id)
        after, changed = recompute_snapshot(conn, workspace_id, price_map, now)
        report.snapshots_changed += int(changed)
        old_plan = before.plan_id if before else "free"
        if old_plan != after.plan_id:
            report.items.append(DriftItem(workspace_id, after.stripe_subscription_id,
                                          "entitlement", old_plan, after.plan_id))
        # Catalogue remaps and time-based expiry can change a snapshot without changing
        # the subscription mirror or plan name. Include those differences so callers
        # audit them and synchronize the workspace's quota in the same transaction.
        if changed:
            for name in (
                "plan_version", "source", "reason", "stripe_subscription_id", "valid_until",
            ):
                previous = getattr(before, name) if before is not None else None
                current = getattr(after, name)
                if previous != current:
                    report.items.append(DriftItem(
                        workspace_id, after.stripe_subscription_id,
                        f"entitlement.{name}", previous, current,
                    ))
    return report


# UK checkout consent ----------------------------------------------------------------------


def hash_ip(ip: str, key: bytes | str) -> str:
    """A keyed hash: a plain hash of an IPv4 address can be reversed by trying them all."""
    secret = key.encode() if isinstance(key, str) else key
    return hmac.new(secret, ip.strip().encode(), hashlib.sha256).hexdigest()


def record_checkout_consent(
    conn: Connection, *, workspace_id: str, user_id: str, consent_text_version: str,
    ip: str | None = None, ip_hash_key: bytes | str | None = None,
    checkout_session_id: str | None = None,
) -> str:
    """Store the person's request for immediate access and their acknowledgement of losing the
    14-day cancellation right, before Checkout opens (ADR-0403 SC-0403-04)."""
    if not consent_text_version:
        raise ValueError("Record which consent text the person saw.")
    ip_hash = None
    if ip:
        key = ip_hash_key or os.environ.get(IP_HASH_KEY_ENV)
        if not key:
            raise ValueError(f"Hashing an IP address needs a key ({IP_HASH_KEY_ENV}).")
        ip_hash = hash_ip(ip, key)
    consent_id = new_id()
    conn.execute(
        sa.insert(checkout_consents).values(
            id=consent_id, workspace_id=workspace_id, user_id=user_id,
            consent_text_version=consent_text_version, accepted_at=db_now(conn),
            ip_hash=ip_hash, checkout_session_id=checkout_session_id,
        )
    )
    return consent_id


def attach_consent(conn: Connection, checkout_session_id: str, subscription_id: str) -> int:
    """Link consent given before Checkout to the subscription Checkout created."""
    result = conn.execute(
        sa.update(checkout_consents)
        .where(checkout_consents.c.checkout_session_id == checkout_session_id,
               checkout_consents.c.stripe_subscription_id.is_(None))
        .values(stripe_subscription_id=subscription_id)
    )
    return result.rowcount
