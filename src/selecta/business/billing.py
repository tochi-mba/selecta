"""SelectaDJ for Business billing: one Stripe subscription per organisation (ADR-0447).

The subscription has three quantity items (`business_venue`, `business_extra_zone`,
`business_extra_seat`). Quantities are always computed here from `OrgFacts` plus the venue
billing rows, never typed by a client:

- venues: billable (non-pilot) venues that are not pausing or paused after a downgrade;
- extra zones: zones above one per billed venue, capped by the venue's paid zone count;
- extra seats: staff seats (members who are not owners or admins) above three per billed venue.

Adding is immediate and prorated. Removing lowers the Stripe quantity with no proration, so the
next renewal bills less and nothing is credited; the item keeps working until period end (see
`entitled_quantities`). Each period keeps a high-water mark per item: re-adding up to a quantity
already paid this period is never prorated again, so remove then re-add never double-charges.

Every Stripe webhook is a poke: `handle_event` re-fetches the subscription and recomputes, as in
ADR-0403. Checkout, VAT and invoices live in `billing_b2b`; dunning in `dunning`.
"""

from __future__ import annotations

from collections.abc import Collection, Iterable, Mapping
from dataclasses import dataclass, field
from typing import Any, Protocol

import sqlalchemy as sa
from sqlalchemy.engine import Connection

from selecta.billing.schema import insert_ignore
from selecta.business import dunning
from selecta.business.billing_catalogue import (
    INCLUDED_SEATS_PER_VENUE,
    INCLUDED_ZONES_PER_VENUE,
    ITEM_SEAT,
    ITEM_VENUE,
    ITEM_ZONE,
    ITEMS,
    TRIAL_DAYS,
    TRIAL_VENUES,
    TRIAL_ZONES,
    VOLUME_COUPON_ID,
    BusinessPriceMap,
    check_self_serve,
    discount_percent,
    price_id_for,
)
from selecta.business.commercial_audit import audit
from selecta.business.commercial_facts import OrgFacts
from selecta.business.commercial_schema import (
    biz_billing_profiles,
    biz_contracts,
    biz_quantity_changes,
    biz_subscriptions,
    biz_trials,
    biz_venue_billing,
)
from selecta.persistence import new_id

PRORATE = "create_prorations"
NO_PRORATION = "none"
PAUSED_STATES = frozenset({"pausing", "paused"})
GRACE_STATUSES = frozenset({"past_due", "unpaid"})
GOOD_STATUSES = frozenset({"active", "trialing"})
ENDED_STATUSES = frozenset({"canceled", "incomplete_expired", "paused"})

EU_COUNTRIES = frozenset({
    "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT",
    "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE",
})
REVERSE_CHARGE_NOTE = (
    "Reverse charge: the customer must account for the VAT on this supply "
    "(Article 196, Council Directive 2006/112/EC)."
)


class BillingError(ValueError):
    """A billing request that cannot go ahead; the message is safe to show the owner."""


class NoSubscription(BillingError):
    pass


class CheckoutIncomplete(BillingError):
    pass


class TaxBlocked(BillingError):
    pass


class TrialRefused(BillingError):
    pass


class BusinessStripe(Protocol):
    """The Stripe operations business billing uses. Every write takes an idempotency key."""

    def create_customer(
        self, *, name: str, email: str | None, address: Mapping[str, Any],
        metadata: Mapping[str, str], idempotency_key: str,
    ) -> dict[str, Any]: ...

    def update_customer(
        self, customer_id: str, *, idempotency_key: str, tax_exempt: str | None = None,
        invoice_custom_fields: list[dict[str, str]] | None = None,
        invoice_footer: str | None = None,
    ) -> dict[str, Any]: ...

    def get_payment_method(self, payment_method_id: str) -> dict[str, Any] | None: ...

    def verify_tax_id(self, *, country: str, value: str) -> dict[str, Any]:
        """{"status": "valid" | "invalid" | "unavailable", "reference": str | None}."""
        ...

    def create_subscription(
        self, *, customer: str, items: list[dict[str, Any]], metadata: Mapping[str, str],
        idempotency_key: str, trial_end: float | None = None,
        default_payment_method: str | None = None, coupon: str | None = None,
        collection_method: str = "charge_automatically", days_until_due: int | None = None,
    ) -> dict[str, Any]: ...

    def get_subscription(self, subscription_id: str) -> dict[str, Any] | None: ...

    def update_subscription(
        self, subscription_id: str, *, idempotency_key: str,
        discounts: list[str] | None = None, collection_method: str | None = None,
        days_until_due: int | None = None, pause_collection: dict[str, Any] | None = None,
        resume_collection: bool = False,
    ) -> dict[str, Any]: ...

    def add_subscription_item(
        self, subscription_id: str, *, price: str, quantity: int, proration_behavior: str,
        idempotency_key: str,
    ) -> dict[str, Any]: ...

    def update_subscription_item(
        self, item_id: str, *, quantity: int, proration_behavior: str, idempotency_key: str,
    ) -> dict[str, Any]: ...

    def preview_upcoming_invoice(
        self, *, customer: str, subscription: str, items: list[dict[str, Any]],
        proration_behavior: str, proration_date: float,
    ) -> dict[str, Any]:
        """Totals in minor units: subtotal, discount, tax, total, and lines with `proration`."""
        ...

    def list_invoices(self, *, customer: str, status: str | None = None) -> list[dict[str, Any]]:
        ...

    def update_invoice(
        self, invoice_id: str, *, idempotency_key: str,
        custom_fields: list[dict[str, str]] | None = None,
    ) -> dict[str, Any]: ...

    def update_invoice_line(
        self, invoice_id: str, line_id: str, *, description: str, idempotency_key: str,
    ) -> dict[str, Any]: ...

    def get_dispute(self, dispute_id: str) -> dict[str, Any] | None: ...

    def create_balance_credit(
        self, customer: str, *, amount: int, currency: str, description: str,
        idempotency_key: str,
    ) -> dict[str, Any]: ...

    def refund_charge(
        self, charge_id: str, *, amount: int, idempotency_key: str,
    ) -> dict[str, Any]: ...


# Quantities ------------------------------------------------------------------------------


def quantities_for(
    org: OrgFacts,
    *,
    excluded_venues: Collection[str] = (),
    zone_caps: Mapping[str, int] | None = None,
) -> dict[str, int]:
    """Billed quantities from the organisation's facts. Pilot venues are never billed."""
    venues = [v for v in org.billable_venues if v.id not in excluded_venues]
    caps = zone_caps or {}
    extra_zones = 0
    for venue in venues:
        zones = venue.zones if venue.id not in caps else min(venue.zones, caps[venue.id])
        extra_zones += max(zones - INCLUDED_ZONES_PER_VENUE, 0)
    included_seats = INCLUDED_SEATS_PER_VENUE * len(venues)
    extra_seats = max(org.staff_seats - included_seats, 0) if venues else 0
    return {ITEM_VENUE: len(venues), ITEM_ZONE: extra_zones, ITEM_SEAT: extra_seats}


def venue_billing_rows(conn: Connection, organisation_id: str) -> dict[str, dict]:
    rows = conn.execute(
        sa.select(biz_venue_billing).where(biz_venue_billing.c.organisation_id == organisation_id)
    ).mappings()
    return {r["venue_id"]: dict(r) for r in rows}


def billed_quantities(conn: Connection, org: OrgFacts) -> dict[str, int]:
    """`quantities_for` after downgrades: pausing or paused venues and unpaid zones drop out."""
    rows = venue_billing_rows(conn, org.organisation_id)
    excluded = {vid for vid, r in rows.items() if r["state"] in PAUSED_STATES}
    caps = {vid: int(r["paid_zones"]) for vid, r in rows.items()}
    return quantities_for(org, excluded_venues=excluded, zone_caps=caps)


# Rows -------------------------------------------------------------------------------------


def subscription_row(conn: Connection, organisation_id: str) -> dict | None:
    row = conn.execute(
        sa.select(biz_subscriptions).where(biz_subscriptions.c.organisation_id == organisation_id)
    ).mappings().first()
    return dict(row) if row else None


def profile_row(conn: Connection, organisation_id: str) -> dict | None:
    row = conn.execute(
        sa.select(biz_billing_profiles).where(
            biz_billing_profiles.c.organisation_id == organisation_id
        )
    ).mappings().first()
    return dict(row) if row else None


def active_contract(conn: Connection, organisation_id: str, now: float) -> dict | None:
    """The live enterprise contract, if any: it replaces Stripe as the entitlement source."""
    row = conn.execute(
        sa.select(biz_contracts)
        .where(
            biz_contracts.c.organisation_id == organisation_id,
            biz_contracts.c.revoked_at.is_(None),
            biz_contracts.c.term_start <= now,
            biz_contracts.c.term_end > now,
        )
        .order_by(biz_contracts.c.term_end.desc())
    ).mappings().first()
    return dict(row) if row else None


def tax_treatment(country: str, tax_id_status: str | None) -> str:
    """uk_vat, reverse_charge (EU, VAT number valid), blocked (EU otherwise), or other."""
    country = (country or "").upper()
    if country == "GB":
        return "uk_vat"
    if country in EU_COUNTRIES:
        return "reverse_charge" if tax_id_status == "valid" else "blocked"
    return "other"


def _items(sub: Mapping[str, Any]) -> list[Mapping[str, Any]]:
    return list((sub.get("items") or {}).get("data") or [])


def _price_id(item: Mapping[str, Any]) -> str | None:
    price = item.get("price")
    if isinstance(price, Mapping):
        price = price.get("id")
    return str(price) if price else None


def stripe_items(
    sub: Mapping[str, Any], price_map: BusinessPriceMap
) -> tuple[dict[str, dict[str, Any]], list[str]]:
    """{item: {"id", "quantity", "price"}} for known prices, and the unknown price ids."""
    known: dict[str, dict[str, Any]] = {}
    unknown: list[str] = []
    for item in _items(sub):
        pid = _price_id(item)
        price = price_map.get(pid) if pid else None
        if price is None:
            unknown.append(pid or "")
            continue
        entry = known.setdefault(price.item, {"id": item["id"], "quantity": 0, "price": pid})
        entry["quantity"] += int(item.get("quantity") or 0)
    return known, unknown


def _quantities_of(sub: Mapping[str, Any], price_map: BusinessPriceMap) -> dict[str, int]:
    known, _ = stripe_items(sub, price_map)
    return {item: int(known.get(item, {}).get("quantity", 0)) for item in ITEMS}


def store_subscription(
    conn: Connection, org: OrgFacts, sub: Mapping[str, Any], price_map: BusinessPriceMap,
    now: float, *, interval: str | None = None,
) -> dict:
    """Upsert the organisation's row from a freshly fetched Stripe subscription."""
    customer = sub.get("customer")
    if isinstance(customer, Mapping):
        customer = customer.get("id")
    values = {
        "stripe_customer_id": customer,
        "stripe_subscription_id": sub.get("id"),
        "currency": str(sub.get("currency") or org.currency).upper(),
        "status": str(sub.get("status") or "incomplete"),
        "trial_ends_at": sub.get("trial_end"),
        "current_period_start": sub.get("current_period_start"),
        "current_period_end": sub.get("current_period_end"),
        "quantities": _quantities_of(sub, price_map),
        "raw": dict(sub),
        "updated_at": now,
    }
    existing = subscription_row(conn, org.organisation_id)
    if existing is None:
        conn.execute(sa.insert(biz_subscriptions).values(
            id=new_id(), workspace_id=org.workspace_id, organisation_id=org.organisation_id,
            interval=interval or _interval_of(sub, price_map) or "month", created_at=now,
            **values,
        ))
    else:
        if interval:
            values["interval"] = interval
        conn.execute(sa.update(biz_subscriptions).where(
            biz_subscriptions.c.organisation_id == org.organisation_id).values(**values))
    return subscription_row(conn, org.organisation_id) or {}


def _interval_of(sub: Mapping[str, Any], price_map: BusinessPriceMap) -> str | None:
    for item in _items(sub):
        price = price_map.get(_price_id(item) or "")
        if price:
            return price.interval
    return None


# Subscription -----------------------------------------------------------------------------


def ensure_subscription(
    conn: Connection, client: BusinessStripe, org: OrgFacts, *, price_map: BusinessPriceMap,
    now: float, actor: str, interval: str = "month", payment_method: str | None = None,
    trial_end: float | None = None, email: str | None = None,
) -> dict:
    """The organisation's subscription row, creating the Stripe customer and subscription once.

    Needs a completed business checkout (`billing_b2b.record_checkout`) and a tax treatment that
    is not blocked. 25 or more venues raise `EnterpriseRequired`.
    """
    row = subscription_row(conn, org.organisation_id)
    if row and row.get("stripe_subscription_id"):
        return row
    profile = profile_row(conn, org.organisation_id)
    if profile is None or not profile.get("business_confirmed_at"):
        raise CheckoutIncomplete("Finish the SelectaDJ for Business checkout first.")
    if tax_treatment(profile["country"], profile["tax_id_status"]) == "blocked":
        raise TaxBlocked(
            "SelectaDJ can't sell to EU businesses without a VAT number that validates."
        )
    quantities = billed_quantities(conn, org)
    if quantities[ITEM_VENUE] < 1:
        raise BillingError("Add a venue before choosing a plan.")
    check_self_serve(quantities[ITEM_VENUE])
    customer_id = (row or {}).get("stripe_customer_id")
    if not customer_id:
        customer = client.create_customer(
            name=profile["company_name"], email=email, address=profile["billing_address"],
            metadata={"organisation_id": org.organisation_id},
            idempotency_key=f"bzcus:{org.organisation_id}",
        )
        customer_id = customer["id"]
        if profile["reverse_charge"]:
            client.update_customer(
                customer_id, tax_exempt="reverse", invoice_footer=REVERSE_CHARGE_NOTE,
                idempotency_key=f"bzcus-tax:{org.organisation_id}",
            )
    currency = org.currency.upper()
    items = [
        {"price": price_id_for(price_map, item, currency, interval), "quantity": qty}
        for item, qty in quantities.items() if qty > 0
    ]
    send_invoice = profile["collection_method"] == "send_invoice"
    sub = client.create_subscription(
        customer=customer_id, items=items,
        metadata={"organisation_id": org.organisation_id},
        idempotency_key=f"bzsub:{org.organisation_id}", trial_end=trial_end,
        default_payment_method=payment_method,
        coupon=VOLUME_COUPON_ID if discount_percent(quantities[ITEM_VENUE]) else None,
        collection_method=profile["collection_method"],
        days_until_due=profile["net_days"] if send_invoice else None,
    )
    row = store_subscription(conn, org, sub, price_map, now, interval=interval)
    audit(conn, workspace_id=org.workspace_id, organisation_id=org.organisation_id,
          action="billing.subscription.created", actor=actor, now=now,
          detail={"subscription": sub.get("id"), "quantities": quantities,
                  "interval": interval, "trial_end": trial_end})
    return row


@dataclass(frozen=True)
class QuantityChange:
    item: str
    from_quantity: int
    to_quantity: int
    prorated: bool
    effective_at: float
    idempotency_key: str


def _period_rows(
    conn: Connection, organisation_id: str, item: str, period_start: float | None
) -> list[dict]:
    query = sa.select(biz_quantity_changes).where(
        biz_quantity_changes.c.organisation_id == organisation_id,
        biz_quantity_changes.c.item == item,
    )
    if period_start is None:
        query = query.where(biz_quantity_changes.c.period_start.is_(None))
    else:
        query = query.where(biz_quantity_changes.c.period_start == period_start)
    return [dict(r) for r in conn.execute(query).mappings()]


def high_water(
    conn: Connection, organisation_id: str, item: str, period_start: float | None, current: int
) -> int:
    """The highest quantity of `item` already paid for this period."""
    rows = _period_rows(conn, organisation_id, item, period_start)
    return max([current] + [max(r["from_quantity"], r["to_quantity"]) for r in rows])


def entitled_quantities(conn: Connection, organisation_id: str) -> dict[str, int]:
    """What the organisation may use now: removals keep working until the period ends."""
    row = subscription_row(conn, organisation_id)
    if row is None:
        return {item: 0 for item in ITEMS}
    current = row["quantities"] or {}
    return {
        item: high_water(conn, organisation_id, item, row["current_period_start"],
                         int(current.get(item, 0)))
        for item in ITEMS
    }


def _trial_running(conn: Connection, organisation_id: str) -> bool:
    outcome = conn.execute(
        sa.select(biz_trials.c.outcome).where(biz_trials.c.organisation_id == organisation_id)
    ).scalar()
    return outcome == "running"


def apply_quantities(
    conn: Connection, client: BusinessStripe, org: OrgFacts, *, price_map: BusinessPriceMap,
    now: float, actor: str, reason: str = "change",
    desired: Mapping[str, int] | None = None,
) -> list[QuantityChange]:
    """Bring Stripe's quantities to the computed ones. One idempotent Stripe update per step."""
    row = subscription_row(conn, org.organisation_id)
    if row is None or not row.get("stripe_subscription_id"):
        raise NoSubscription("This organisation has no SelectaDJ for Business subscription.")
    target = dict(desired or billed_quantities(conn, org))
    check_self_serve(target[ITEM_VENUE])
    if _trial_running(conn, org.organisation_id) and (
        target[ITEM_VENUE] > TRIAL_VENUES or target[ITEM_ZONE] > TRIAL_ZONES - 1
    ):
        raise TrialRefused(
            "The SelectaDJ for Business trial covers 1 venue and 1 zone. "
            "Start paying to add more."
        )
    sub = client.get_subscription(row["stripe_subscription_id"])
    if sub is None:
        raise NoSubscription("Stripe has no record of this subscription.")
    period_start = sub.get("current_period_start")
    period_end = sub.get("current_period_end")
    known, _unknown = stripe_items(sub, price_map)
    currency = str(sub.get("currency") or org.currency).upper()
    interval = row["interval"]
    changes: list[QuantityChange] = []
    for item in ITEMS:
        current = int(known.get(item, {}).get("quantity", 0))
        want = int(target[item])
        if want == current:
            continue
        hw = high_water(conn, org.organisation_id, item, period_start, current)
        steps: list[tuple[int, bool]] = []
        if want > current:
            if current < hw:
                steps.append((min(want, hw), False))
            if want > hw:
                steps.append((want, True))
        else:
            steps.append((want, False))
        for to_qty, prorated in steps:
            change = _step(
                conn, client, org, sub, known, item, current, to_qty, prorated,
                price_map=price_map, currency=currency, interval=interval,
                period_start=period_start, period_end=period_end, now=now, actor=actor,
                reason=reason,
            )
            changes.append(change)
            current = to_qty
    _sync_volume_coupon(client, sub, target[ITEM_VENUE], org.organisation_id, now)
    fresh = client.get_subscription(row["stripe_subscription_id"]) or sub
    store_subscription(conn, org, fresh, price_map, now)
    return changes


def _step(
    conn: Connection, client: BusinessStripe, org: OrgFacts, sub: Mapping[str, Any],
    known: dict[str, dict[str, Any]], item: str, from_qty: int, to_qty: int, prorated: bool,
    *, price_map: BusinessPriceMap, currency: str, interval: str,
    period_start: float | None, period_end: float | None, now: float, actor: str, reason: str,
) -> QuantityChange:
    seq = len(_period_rows(conn, org.organisation_id, item, period_start))
    key = (f"bzq:{org.organisation_id}:{item}:{int(period_start or 0)}:{seq}:"
           f"{from_qty}-{to_qty}")
    behaviour = PRORATE if prorated else NO_PRORATION
    if item in known:
        client.update_subscription_item(
            known[item]["id"], quantity=to_qty, proration_behavior=behaviour,
            idempotency_key=key,
        )
    else:
        created = client.add_subscription_item(
            str(sub["id"]), price=price_id_for(price_map, item, currency, interval),
            quantity=to_qty, proration_behavior=behaviour, idempotency_key=key,
        )
        known[item] = {"id": created["id"], "quantity": to_qty, "price": created.get("price")}
    effective = now if to_qty > from_qty else float(period_end or now)
    insert_ignore(conn, biz_quantity_changes, {
        "id": new_id(), "workspace_id": org.workspace_id,
        "organisation_id": org.organisation_id, "item": item, "from_quantity": from_qty,
        "to_quantity": to_qty, "prorated": prorated, "period_start": period_start,
        "effective_at": effective, "idempotency_key": key, "actor": actor, "reason": reason,
        "created_at": now,
    }, ("idempotency_key",))
    audit(conn, workspace_id=org.workspace_id, organisation_id=org.organisation_id,
          action="billing.quantity.change", actor=actor, now=now,
          detail={"item": item, "from": from_qty, "to": to_qty, "prorated": prorated,
                  "effective_at": effective, "reason": reason})
    return QuantityChange(item, from_qty, to_qty, prorated, effective, key)


def _sync_volume_coupon(
    client: BusinessStripe, sub: Mapping[str, Any], venues: int, organisation_id: str,
    now: float,
) -> None:
    """Setting the discount list is idempotent, so the key only needs to dedupe retries."""
    want = [VOLUME_COUPON_ID] if discount_percent(venues) else []
    have = [d.get("coupon") if isinstance(d, Mapping) else d
            for d in (sub.get("discounts") or [])]
    if sorted(c for c in have if c) != want:
        client.update_subscription(
            str(sub["id"]), discounts=want,
            idempotency_key=f"bzdisc:{organisation_id}:{'on' if want else 'off'}:{int(now)}",
        )


# Preview ----------------------------------------------------------------------------------


@dataclass(frozen=True)
class Preview:
    currency: str
    quantities: dict[str, int]
    prorations_minor: int
    next_invoice_total_minor: int
    next_invoice: dict[str, Any] = field(default_factory=dict)


def preview_cost(
    conn: Connection, client: BusinessStripe, org: OrgFacts, *, price_map: BusinessPriceMap,
    now: float, proposed: Mapping[str, int] | None = None,
) -> Preview:
    """What the change to `proposed` (default: the computed quantities) will cost, from Stripe.

    `next_invoice` is Stripe's upcoming invoice at the proposed quantities with no new proration.
    `prorations_minor` is the prorated charge (ex VAT, before discount) for the part above what
    was already paid this period, from a second preview. `next_invoice_total_minor` adds those
    prorations to the next invoice using that invoice's own discount and tax ratios.
    """
    row = subscription_row(conn, org.organisation_id)
    if row is None or not row.get("stripe_subscription_id"):
        raise NoSubscription("This organisation has no SelectaDJ for Business subscription.")
    target = dict(proposed or billed_quantities(conn, org))
    check_self_serve(target[ITEM_VENUE])
    sub = client.get_subscription(row["stripe_subscription_id"]) or {}
    known, _ = stripe_items(sub, price_map)
    currency = str(sub.get("currency") or org.currency).upper()
    period_start = sub.get("current_period_start")

    def items_for(quantities: Mapping[str, int]) -> list[dict[str, Any]]:
        out = []
        for item in ITEMS:
            qty = int(quantities.get(item, 0))
            if item in known:
                out.append({"id": known[item]["id"], "quantity": qty})
            elif qty:
                out.append({"price": price_id_for(price_map, item, currency, row["interval"]),
                            "quantity": qty})
        return out

    base = client.preview_upcoming_invoice(
        customer=row["stripe_customer_id"], subscription=row["stripe_subscription_id"],
        items=items_for(target), proration_behavior=NO_PRORATION, proration_date=now,
    )
    chargeable: dict[str, int] = {}
    for item in ITEMS:
        current = int(known.get(item, {}).get("quantity", 0))
        hw = high_water(conn, org.organisation_id, item, period_start, current)
        chargeable[item] = current + max(int(target[item]) - max(current, hw), 0)
    prorations = 0
    if any(chargeable[i] != int(known.get(i, {}).get("quantity", 0)) for i in ITEMS):
        prorated = client.preview_upcoming_invoice(
            customer=row["stripe_customer_id"], subscription=row["stripe_subscription_id"],
            items=items_for(chargeable), proration_behavior=PRORATE, proration_date=now,
        )
        prorations = _proration_sum(prorated) - _proration_sum(base)
    total = int(base.get("total", 0))
    if prorations:
        subtotal = int(base.get("subtotal", 0)) or 1
        after_discount = subtotal - int(base.get("discount", 0))
        taxable = after_discount or 1
        discounted = prorations * after_discount / subtotal
        total += round(discounted + discounted * int(base.get("tax", 0)) / taxable)
    return Preview(currency, target, prorations, total, base)


def _proration_sum(invoice: Mapping[str, Any]) -> int:
    lines = (invoice.get("lines") or {}).get("data") or []
    return sum(int(line.get("amount", 0)) for line in lines if line.get("proration"))


# Reconciliation ---------------------------------------------------------------------------


@dataclass
class ReconcileReport:
    organisation_id: str
    skipped: str | None = None
    drift: list[dict[str, Any]] = field(default_factory=list)
    unknown_prices: list[str] = field(default_factory=list)
    changes: list[QuantityChange] = field(default_factory=list)


def reconcile(
    conn: Connection, client: BusinessStripe, org: OrgFacts, *, price_map: BusinessPriceMap,
    now: float, actor: str = "system:reconcile",
) -> ReconcileReport:
    """Find and fix quantity drift between Stripe and the computed quantities.

    Organisations on an enterprise contract are skipped: the contract is their entitlement.
    """
    report = ReconcileReport(org.organisation_id)
    if active_contract(conn, org.organisation_id, now):
        report.skipped = "contract"
        return report
    row = subscription_row(conn, org.organisation_id)
    if row is None or not row.get("stripe_subscription_id"):
        report.skipped = "no_subscription"
        return report
    sub = client.get_subscription(row["stripe_subscription_id"])
    if sub is None:
        report.skipped = "missing_in_stripe"
        return report
    store_subscription(conn, org, sub, price_map, now)
    known, report.unknown_prices = stripe_items(sub, price_map)
    if str(sub.get("status")) in ENDED_STATUSES:
        report.skipped = f"status_{sub.get('status')}"
        return report
    want = billed_quantities(conn, org)
    for item in ITEMS:
        have = int(known.get(item, {}).get("quantity", 0))
        if have != want[item]:
            report.drift.append({"item": item, "stripe": have, "computed": want[item]})
    if report.drift:
        report.changes = apply_quantities(
            conn, client, org, price_map=price_map, now=now, actor=actor, reason="reconcile",
            desired=want,
        )
        audit(conn, workspace_id=org.workspace_id, organisation_id=org.organisation_id,
              action="billing.reconcile.drift", actor=actor, now=now,
              detail={"drift": report.drift, "unknown_prices": report.unknown_prices})
    return report


# Trials -----------------------------------------------------------------------------------


def start_trial(
    conn: Connection, client: BusinessStripe, org: OrgFacts, *, payment_method_id: str,
    price_map: BusinessPriceMap, now: float, actor: str, interval: str = "month",
) -> dict:
    """A 14-day trial with 1 venue and 1 zone and a card; one per organisation and per card."""
    if conn.execute(sa.select(biz_trials.c.id).where(
            biz_trials.c.organisation_id == org.organisation_id)).first():
        raise TrialRefused("This organisation has already had its SelectaDJ for Business trial.")
    existing = subscription_row(conn, org.organisation_id)
    if existing and existing.get("stripe_subscription_id"):
        raise TrialRefused("This organisation already has a subscription.")
    method = client.get_payment_method(payment_method_id)
    fingerprint = ((method or {}).get("card") or {}).get("fingerprint")
    if not fingerprint:
        raise TrialRefused("The trial needs a card.")
    if conn.execute(sa.select(biz_trials.c.id).where(
            biz_trials.c.card_fingerprint == fingerprint)).first():
        raise TrialRefused("This card has already been used for a SelectaDJ for Business trial.")
    quantities = billed_quantities(conn, org)
    if quantities[ITEM_VENUE] != TRIAL_VENUES or quantities[ITEM_ZONE] != 0:
        raise TrialRefused("The trial covers 1 venue with 1 zone.")
    ends = now + TRIAL_DAYS * 86_400
    row = ensure_subscription(
        conn, client, org, price_map=price_map, now=now, actor=actor, interval=interval,
        payment_method=payment_method_id, trial_end=ends,
    )
    conn.execute(sa.insert(biz_trials).values(
        id=new_id(), workspace_id=org.workspace_id, organisation_id=org.organisation_id,
        card_fingerprint=fingerprint, started_at=now, ends_at=ends, outcome="running",
    ))
    audit(conn, workspace_id=org.workspace_id, organisation_id=org.organisation_id,
          action="billing.trial.started", actor=actor, now=now, detail={"ends_at": ends})
    return row


def trial_row(conn: Connection, organisation_id: str) -> dict | None:
    row = conn.execute(sa.select(biz_trials).where(
        biz_trials.c.organisation_id == organisation_id)).mappings().first()
    return dict(row) if row else None


def settle_trial(
    conn: Connection, org: OrgFacts, sub: Mapping[str, Any], now: float
) -> str | None:
    """Mark a running trial converted (paid and active) or lapsed (ended unpaid)."""
    trial = trial_row(conn, org.organisation_id)
    if trial is None or trial["outcome"] != "running":
        return None
    status = str(sub.get("status"))
    if status == "trialing" and now < trial["ends_at"]:
        return None
    if status == "active":
        outcome = "converted"
    elif status in ENDED_STATUSES:
        outcome = "lapsed"
    else:
        return None  # past_due after the trial: the grace path applies, outcome decided later
    conn.execute(sa.update(biz_trials).where(biz_trials.c.id == trial["id"])
                 .values(outcome=outcome, decided_at=now))
    audit(conn, workspace_id=org.workspace_id, organisation_id=org.organisation_id,
          action=f"billing.trial.{outcome}", actor="stripe", now=now,
          detail={"status": status})
    return outcome


# Webhooks: every event is a poke ----------------------------------------------------------


def sync_subscription(
    conn: Connection, client: BusinessStripe, org: OrgFacts, *, price_map: BusinessPriceMap,
    now: float,
) -> dict | None:
    """Re-fetch the subscription and recompute grace and trial state from what Stripe says."""
    row = subscription_row(conn, org.organisation_id)
    if row is None or not row.get("stripe_subscription_id"):
        return None
    sub = client.get_subscription(row["stripe_subscription_id"])
    if sub is None:
        return row
    row = store_subscription(conn, org, sub, price_map, now)
    status = str(sub.get("status"))
    held = bool(sub.get("pause_collection"))
    if status in GRACE_STATUSES:
        dunning.start_grace(conn, org, now=now, reason=f"stripe_{status}")
    elif status in GOOD_STATUSES and row.get("past_due_since") and not held and not row.get(
        "dispute_lost_at"
    ):
        dunning.recover(conn, org, now=now)
    settle_trial(conn, org, sub, now)
    return subscription_row(conn, org.organisation_id)


def organisation_for_event(conn: Connection, event: Mapping[str, Any]) -> str | None:
    obj = (event.get("data") or {}).get("object") or {}
    org_id = (obj.get("metadata") or {}).get("organisation_id")
    if org_id:
        return str(org_id)
    for column, key in (
        (biz_subscriptions.c.stripe_subscription_id, "subscription"),
        (biz_subscriptions.c.stripe_customer_id, "customer"),
    ):
        value = obj.get(key)
        if isinstance(value, Mapping):
            value = value.get("id")
        if value:
            found = conn.execute(sa.select(biz_subscriptions.c.organisation_id)
                                 .where(column == str(value))).scalar()
            if found:
                return str(found)
    if str(obj.get("object")) == "subscription" and obj.get("id"):
        found = conn.execute(sa.select(biz_subscriptions.c.organisation_id).where(
            biz_subscriptions.c.stripe_subscription_id == str(obj["id"]))).scalar()
        return str(found) if found else None
    return None


def handle_event(
    conn: Connection, client: BusinessStripe, event: Mapping[str, Any], *,
    orgs: Mapping[str, OrgFacts] | Any, price_map: BusinessPriceMap, now: float,
) -> dict[str, Any]:
    """Handle one verified Stripe event by re-fetching. `orgs` maps or `.organisation()`s ids."""
    org_id = organisation_for_event(conn, event)
    if org_id is None:
        return {"handled": False, "reason": "unknown_organisation"}
    org = orgs.get(org_id) if isinstance(orgs, Mapping) else orgs.organisation(conn, org_id)
    if org is None:
        return {"handled": False, "reason": "unknown_organisation"}
    kind = str(event.get("type", ""))
    obj = (event.get("data") or {}).get("object") or {}
    if kind.startswith("charge.dispute."):
        from selecta.business import billing_ops

        dispute = client.get_dispute(str(obj.get("id"))) or obj
        billing_ops.record_dispute(conn, org, dispute, now=now)
    elif kind == "invoice.created" and obj.get("id"):
        from selecta.business import billing_b2b

        billing_b2b.prepare_draft_invoice(
            conn, client, org, str(obj["id"]), price_map=price_map, now=now
        )
    sync_subscription(conn, client, org, price_map=price_map, now=now)
    return {"handled": True, "organisation_id": org_id, "type": kind}


def organisations_with_subscriptions(conn: Connection) -> Iterable[str]:
    return [r[0] for r in conn.execute(sa.select(biz_subscriptions.c.organisation_id))]
