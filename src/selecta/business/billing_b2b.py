"""Business checkout, B2B VAT and invoices (ADR-0447 BZ-0447-06, -07, -08).

Checkout records that the buyer acts for a business, the business terms version (ADR-0449),
the company name, billing address and tax ID. It never carries the consumer cancellation
acknowledgement of ADR-0403: business plans have no consumer 14-day cancellation right.

VAT: UK customers pay UK VAT. An EU business whose VAT number validates (VIES) at the time of
sale is zero-rated with a reverse-charge note; the result and time are stored. Without a valid
number EU sales stay blocked. Before each renewal the number is checked again; a failure holds
the renewal (Stripe keeps the invoice as a draft), tells the owner and enters grace. The tax
treatment never changes silently.

Invoices carry up to four custom fields: the organisation PO number and per-venue cost centres.
Line descriptions name venues; a per-venue cost breakdown is available as CSV. Edits apply to
draft and future invoices only, since Stripe cannot change a finalised invoice.
"""

from __future__ import annotations

import csv
import io
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

import sqlalchemy as sa
from sqlalchemy.engine import Connection

from selecta.billing.schema import insert_ignore
from selecta.business import dunning
from selecta.business.billing import (
    EU_COUNTRIES,
    REVERSE_CHARGE_NOTE,
    BillingError,
    BusinessStripe,
    active_contract,
    billed_quantities,
    profile_row,
    subscription_row,
    tax_treatment,
    venue_billing_rows,
)
from selecta.business.billing_catalogue import (
    INCLUDED_SEATS_PER_VENUE,
    INCLUDED_ZONES_PER_VENUE,
    INTERVALS,
    ITEM_NAMES,
    ITEM_SEAT,
    ITEM_VENUE,
    ITEM_ZONE,
    BusinessPriceMap,
    check_self_serve,
    discount_percent,
    estimate,
    unit_amount,
)
from selecta.business.commercial_audit import audit, notice
from selecta.business.commercial_facts import BILLING_ROLES, OrgFacts
from selecta.business.commercial_schema import (
    biz_billing_profiles,
    biz_subscriptions,
    biz_terms_acceptances,
    biz_venue_billing,
)
from selecta.persistence import new_id

MAX_CUSTOM_FIELDS = 4
CUSTOM_FIELD_NAME_MAX = 40
CUSTOM_FIELD_VALUE_MAX = 140
NET_DAYS = 30
RENEWAL_RECHECK_S = 7 * 86_400
REQUIRED_ADDRESS = ("line1", "city", "postal_code", "country")


# Checkout ---------------------------------------------------------------------------------


@dataclass(frozen=True)
class CheckoutPlan:
    payload: dict[str, Any]
    tax_treatment: str
    tax_id_status: str
    blocked: bool = False
    message: str | None = None


def record_checkout(
    conn: Connection, client: BusinessStripe, org: OrgFacts, *, user_id: str,
    business_confirmed: bool, terms_version: str, company_name: str,
    billing_address: Mapping[str, Any], tax_id: str | None, now: float,
    interval: str = "month", collection_method: str = "charge_automatically",
    po_number: str | None = None,
) -> CheckoutPlan:
    """Validate and store the B2B checkout answers; return the checkout payload.

    Raises BillingError for missing answers and EnterpriseRequired at 25 or more venues. An EU
    sale without a valid VAT number is stored (result and time) and returned with `blocked`
    set and an empty payload, so the caller can commit the check and show the message.
    """
    if not business_confirmed:
        raise BillingError("Confirm you are buying for a business. SelectaDJ for Business "
                           "is not sold to consumers.")
    if not terms_version or not terms_version.strip():
        raise BillingError("Accept the SelectaDJ business terms to continue.")
    if not company_name or not company_name.strip():
        raise BillingError("Enter the company name for invoices.")
    missing = [k for k in REQUIRED_ADDRESS if not str(billing_address.get(k) or "").strip()]
    if missing:
        raise BillingError(f"The billing address needs: {', '.join(missing)}.")
    if interval not in INTERVALS:
        raise BillingError(f"Unknown billing interval: {interval}")
    _check_collection(collection_method, interval, conn, org.organisation_id, now)
    quantities = billed_quantities(conn, org)
    check_self_serve(quantities[ITEM_VENUE])
    country = str(billing_address["country"]).upper()
    status, ref, checked_at = "none", None, None
    if tax_id and tax_id.strip():
        result = client.verify_tax_id(country=country, value=tax_id.strip())
        status, ref, checked_at = str(result.get("status") or "unavailable"), result.get(
            "reference"), now
    treatment = tax_treatment(country, status)
    values = {
        "workspace_id": org.workspace_id,
        "company_name": company_name.strip(),
        "billing_address": dict(billing_address),
        "country": country,
        "tax_id": tax_id.strip() if tax_id else None,
        "tax_id_status": status,
        "tax_id_checked_at": checked_at,
        "tax_id_check_ref": ref,
        "reverse_charge": treatment == "reverse_charge",
        "po_number": po_number,
        "collection_method": collection_method,
        "net_days": NET_DAYS if collection_method == "send_invoice" else None,
        "business_confirmed_by": user_id,
        "business_confirmed_at": now,
        "updated_at": now,
    }
    _upsert_profile(conn, org.organisation_id, values)
    insert_ignore(conn, biz_terms_acceptances, {
        "id": new_id(), "workspace_id": org.workspace_id, "organisation_id": org.organisation_id,
        "terms_version": terms_version, "accepted_by": user_id, "accepted_at": now,
        "context": "checkout", "ip_hash": None,
    }, ("organisation_id", "terms_version"))
    audit(conn, workspace_id=org.workspace_id, organisation_id=org.organisation_id,
          action="billing.checkout.recorded", actor=user_id, now=now,
          detail={"terms_version": terms_version, "tax_treatment": treatment,
                  "tax_id_status": status, "country": country})
    if treatment == "blocked":
        return CheckoutPlan({}, treatment, status, blocked=True, message=(
            "SelectaDJ can't sell to EU businesses without a VAT number that validates. "
            "Check the number and try again."))
    est = estimate(quantities, org.currency, interval)
    payload = {
        "mode": "subscription",
        "plan": "business",
        "organisation_id": org.organisation_id,
        "business_confirmed": True,
        "terms_version": terms_version,
        "company_name": values["company_name"],
        "billing_address": values["billing_address"],
        "tax_id": values["tax_id"],
        "tax_treatment": treatment,
        "reverse_charge_note": REVERSE_CHARGE_NOTE if treatment == "reverse_charge" else None,
        "currency": org.currency.upper(),
        "interval": interval,
        "quantities": quantities,
        "estimate_minor": est.total_minor,
        "discount_percent": discount_percent(quantities[ITEM_VENUE]),
        "collection_method": collection_method,
        "net_days": values["net_days"],
    }
    return CheckoutPlan(payload, treatment, status)


def _upsert_profile(conn: Connection, organisation_id: str, values: Mapping[str, Any]) -> None:
    if profile_row(conn, organisation_id) is None:
        conn.execute(sa.insert(biz_billing_profiles).values(
            organisation_id=organisation_id, **values))
    else:
        conn.execute(sa.update(biz_billing_profiles).where(
            biz_billing_profiles.c.organisation_id == organisation_id).values(**values))


def _check_collection(
    method: str, interval: str, conn: Connection, organisation_id: str, now: float
) -> None:
    if method == "charge_automatically":
        return
    if method != "send_invoice":
        raise BillingError(f"Unknown payment method: {method}")
    if interval != "year" and not active_contract(conn, organisation_id, now):
        raise BillingError("Bank transfer invoices (net 30) are for annual and Enterprise plans.")


def set_collection_method(
    conn: Connection, client: BusinessStripe, org: OrgFacts, method: str, *, actor: str,
    now: float,
) -> dict:
    """Switch between card and bank-transfer invoices (send_invoice, net 30)."""
    row = subscription_row(conn, org.organisation_id)
    interval = (row or {}).get("interval", "month")
    _check_collection(method, interval, conn, org.organisation_id, now)
    net = NET_DAYS if method == "send_invoice" else None
    conn.execute(sa.update(biz_billing_profiles).where(
        biz_billing_profiles.c.organisation_id == org.organisation_id).values(
        collection_method=method, net_days=net, updated_at=now))
    if row and row.get("stripe_subscription_id"):
        client.update_subscription(
            row["stripe_subscription_id"], collection_method=method, days_until_due=net,
            idempotency_key=f"bzcoll:{org.organisation_id}:{method}:{int(now)}",
        )
    audit(conn, workspace_id=org.workspace_id, organisation_id=org.organisation_id,
          action="billing.collection_method", actor=actor, now=now,
          detail={"method": method, "net_days": net})
    return profile_row(conn, org.organisation_id) or {}


# VAT --------------------------------------------------------------------------------------


@dataclass(frozen=True)
class TaxCheck:
    status: str
    checked_at: float
    reference: str | None
    treatment: str


def check_tax_id(
    conn: Connection, client: BusinessStripe, org: OrgFacts, *, now: float, actor: str,
) -> TaxCheck:
    """Validate the stored VAT number now and store the result and time."""
    profile = profile_row(conn, org.organisation_id)
    if profile is None:
        raise BillingError("No billing details yet.")
    status, ref = "none", None
    if profile.get("tax_id"):
        result = client.verify_tax_id(country=profile["country"], value=profile["tax_id"])
        status, ref = str(result.get("status") or "unavailable"), result.get("reference")
    conn.execute(sa.update(biz_billing_profiles).where(
        biz_billing_profiles.c.organisation_id == org.organisation_id).values(
        tax_id_status=status, tax_id_checked_at=now, tax_id_check_ref=ref, updated_at=now))
    audit(conn, workspace_id=org.workspace_id, organisation_id=org.organisation_id,
          action="billing.tax_id.checked", actor=actor, now=now,
          detail={"status": status, "reference": ref})
    return TaxCheck(status, now, ref, tax_treatment(profile["country"], status))


def renewal_tax_recheck(
    conn: Connection, client: BusinessStripe, org: OrgFacts, *, now: float,
    window_s: float = RENEWAL_RECHECK_S,
) -> TaxCheck | None:
    """Recheck an EU reverse-charge customer's VAT number in the week before renewal.

    Failure holds the renewal (pause collection, invoice kept as draft), emails the owner and
    admins and enters grace. The reverse-charge setting is left as it was: no silent VAT change.
    A later valid check releases the hold. None when no check was due.
    """
    profile = profile_row(conn, org.organisation_id)
    row = subscription_row(conn, org.organisation_id)
    if not profile or not row or not row.get("stripe_subscription_id"):
        return None
    if profile["country"] not in EU_COUNTRIES or not profile["reverse_charge"]:
        return None
    period_end = row.get("current_period_end")
    if period_end is None or period_end - now > window_s:
        return None
    held = bool((row.get("raw") or {}).get("pause_collection"))
    checked = profile.get("tax_id_checked_at")
    if not held and checked is not None and checked >= period_end - window_s:
        return None  # already checked for this renewal
    result = check_tax_id(conn, client, org, now=now, actor="system:renewal")
    sub_id = row["stripe_subscription_id"]
    if result.status == "valid":
        if held:
            client.update_subscription(sub_id, resume_collection=True,
                                       idempotency_key=f"bzvat-release:{sub_id}:{int(now)}")
            audit(conn, workspace_id=org.workspace_id, organisation_id=org.organisation_id,
                  action="billing.renewal.released", actor="system:renewal", now=now)
            dunning.recover(conn, org, now=now, actor="system:renewal")
        return result
    if not held:
        client.update_subscription(
            sub_id, pause_collection={"behavior": "keep_as_draft"},
            idempotency_key=f"bzvat-hold:{sub_id}:{int(period_end)}",
        )
        audit(conn, workspace_id=org.workspace_id, organisation_id=org.organisation_id,
              action="billing.renewal.held", actor="system:renewal", now=now,
              detail={"reason": "vat_recheck", "status": result.status})
    notice(conn, workspace_id=org.workspace_id, organisation_id=org.organisation_id,
           kind="billing.vat.recheck_failed", cycle_key=f"renewal:{int(period_end)}",
           channel="email", audience=org.recipients(BILLING_ROLES), due_at=now, now=now,
           detail={"status": result.status, "tax_id": profile.get("tax_id")})
    raw = dict(row.get("raw") or {})
    raw["pause_collection"] = {"behavior": "keep_as_draft"}
    conn.execute(sa.update(biz_subscriptions).where(
        biz_subscriptions.c.organisation_id == org.organisation_id).values(raw=raw))
    dunning.start_grace(conn, org, now=now, reason="vat_recheck", actor="system:renewal")
    return result


# Invoices ---------------------------------------------------------------------------------


def _field(name: str, value: str) -> dict[str, str]:
    return {"name": name[:CUSTOM_FIELD_NAME_MAX], "value": value[:CUSTOM_FIELD_VALUE_MAX]}


def invoice_custom_fields(conn: Connection, org: OrgFacts) -> list[dict[str, str]]:
    """PO number first, then cost centres; more cost centres than fit share one field."""
    fields: list[dict[str, str]] = []
    profile = profile_row(conn, org.organisation_id)
    if profile and profile.get("po_number"):
        fields.append(_field("PO number", str(profile["po_number"])))
    rows = venue_billing_rows(conn, org.organisation_id)
    centres = []
    for venue in org.billable_venues:
        centre = (rows.get(venue.id) or {}).get("cost_centre")
        if centre:
            centres.append((venue.name, str(centre)))
    room = MAX_CUSTOM_FIELDS - len(fields)
    if len(centres) <= room:
        fields.extend(_field(f"Cost centre {name}", centre) for name, centre in centres)
    elif centres:
        fields.append(_field("Cost centres", "; ".join(f"{n}: {c}" for n, c in centres)))
    return fields[:MAX_CUSTOM_FIELDS]


@dataclass(frozen=True)
class InvoiceFieldResult:
    fields: list[dict[str, str]]
    drafts_updated: list[str]
    finalised_unchanged: list[str]


def _push_invoice_fields(
    conn: Connection, client: BusinessStripe, org: OrgFacts, now: float
) -> InvoiceFieldResult:
    fields = invoice_custom_fields(conn, org)
    row = subscription_row(conn, org.organisation_id)
    customer = (row or {}).get("stripe_customer_id")
    if not customer:
        return InvoiceFieldResult(fields, [], [])
    stamp = f"{int(now)}:{len(fields)}"
    client.update_customer(customer, invoice_custom_fields=fields,
                           idempotency_key=f"bzfields:{customer}:{stamp}")
    drafts, finalised = [], []
    for invoice in client.list_invoices(customer=customer):
        if invoice.get("status") == "draft":
            client.update_invoice(invoice["id"], custom_fields=fields,
                                  idempotency_key=f"bzinvf:{invoice['id']}:{stamp}")
            drafts.append(invoice["id"])
        else:
            finalised.append(invoice["id"])
    return InvoiceFieldResult(fields, drafts, finalised)


def set_po_number(
    conn: Connection, client: BusinessStripe, org: OrgFacts, po_number: str | None, *,
    actor: str, now: float,
) -> InvoiceFieldResult:
    """Change the organisation PO number for draft and future invoices only."""
    if profile_row(conn, org.organisation_id) is None:
        raise BillingError("No billing details yet.")
    value = (po_number or "").strip() or None
    conn.execute(sa.update(biz_billing_profiles).where(
        biz_billing_profiles.c.organisation_id == org.organisation_id).values(
        po_number=value, updated_at=now))
    result = _push_invoice_fields(conn, client, org, now)
    audit(conn, workspace_id=org.workspace_id, organisation_id=org.organisation_id,
          action="billing.po_number", actor=actor, now=now,
          detail={"po_number": value, "drafts_updated": result.drafts_updated})
    return result


def ensure_venue_row(conn: Connection, org: OrgFacts, venue_id: str, now: float) -> dict:
    rows = venue_billing_rows(conn, org.organisation_id)
    if venue_id in rows:
        return rows[venue_id]
    venue = org.venue(venue_id)
    if venue is None:
        raise BillingError("That venue is not in this organisation.")
    conn.execute(sa.insert(biz_venue_billing).values(
        venue_id=venue_id, workspace_id=org.workspace_id, organisation_id=org.organisation_id,
        cost_centre=None, state="active", pause_at=None, paused_at=None,
        paid_zones=venue.zones, decided_by=None, updated_at=now))
    return venue_billing_rows(conn, org.organisation_id)[venue_id]


def set_cost_centre(
    conn: Connection, client: BusinessStripe, org: OrgFacts, venue_id: str,
    cost_centre: str | None, *, actor: str, now: float,
) -> InvoiceFieldResult:
    ensure_venue_row(conn, org, venue_id, now)
    value = (cost_centre or "").strip() or None
    conn.execute(sa.update(biz_venue_billing).where(biz_venue_billing.c.venue_id == venue_id)
                 .values(cost_centre=value, updated_at=now))
    result = _push_invoice_fields(conn, client, org, now)
    audit(conn, workspace_id=org.workspace_id, organisation_id=org.organisation_id,
          action="billing.cost_centre", actor=actor, now=now, venue_id=venue_id,
          detail={"cost_centre": value})
    return result


def line_descriptions(conn: Connection, org: OrgFacts) -> dict[str, str]:
    """Invoice line descriptions naming the billed venues."""
    rows = venue_billing_rows(conn, org.organisation_id)
    billed = [v for v in org.billable_venues
              if (rows.get(v.id) or {}).get("state", "active") not in ("pausing", "paused")]
    zones = []
    for v in billed:
        cap = (rows.get(v.id) or {}).get("paid_zones", v.zones)
        extra = max(min(v.zones, cap) - INCLUDED_ZONES_PER_VENUE, 0)
        if extra:
            zones.append(f"{v.name} ({extra})")
    out = {
        ITEM_VENUE: f"{ITEM_NAMES[ITEM_VENUE]}: " + ", ".join(v.name for v in billed),
        ITEM_ZONE: f"{ITEM_NAMES[ITEM_ZONE]}: " + (", ".join(zones) or "none"),
        ITEM_SEAT: (f"{ITEM_NAMES[ITEM_SEAT]}: staff seats beyond "
                    f"{INCLUDED_SEATS_PER_VENUE} per venue, owners and admins free"),
    }
    return {k: v[:500] for k, v in out.items()}


def prepare_draft_invoice(
    conn: Connection, client: BusinessStripe, org: OrgFacts, invoice_id: str, *,
    price_map: BusinessPriceMap, now: float,
) -> list[str]:
    """Name venues on a draft invoice's lines and set its custom fields. Returns line ids."""
    row = subscription_row(conn, org.organisation_id)
    customer = (row or {}).get("stripe_customer_id")
    if not customer:
        return []
    invoice = next((i for i in client.list_invoices(customer=customer, status="draft")
                    if i.get("id") == invoice_id), None)
    if invoice is None:
        return []
    descriptions = line_descriptions(conn, org)
    changed = []
    for line in (invoice.get("lines") or {}).get("data") or []:
        price = line.get("price")
        pid = price.get("id") if isinstance(price, Mapping) else price
        entry = price_map.get(pid or "")
        if entry is None or line.get("proration"):
            continue
        description = descriptions[entry.item]
        if line.get("description") != description:
            client.update_invoice_line(invoice_id, line["id"], description=description,
                                       idempotency_key=f"bzline:{invoice_id}:{line['id']}")
            changed.append(line["id"])
    client.update_invoice(invoice_id, custom_fields=invoice_custom_fields(conn, org),
                          idempotency_key=f"bzinvf:{invoice_id}:prepare")
    return changed


CSV_COLUMNS = (
    "venue_id", "venue", "cost_centre", "venue_fee", "extra_zones", "extra_zone_fee",
    "discount", "total", "currency", "interval",
)


def cost_breakdown(
    conn: Connection, org: OrgFacts, *, interval: str | None = None,
) -> list[dict[str, Any]]:
    """Per-venue cost for one period, in major units; extra seats are one organisation row."""
    row = subscription_row(conn, org.organisation_id)
    interval = interval or (row or {}).get("interval") or "month"
    currency = org.currency.upper()
    quantities = billed_quantities(conn, org)
    off = discount_percent(quantities[ITEM_VENUE])
    rows = venue_billing_rows(conn, org.organisation_id)
    venue_fee = unit_amount(ITEM_VENUE, currency, interval)
    zone_fee = unit_amount(ITEM_ZONE, currency, interval)
    out = []
    for v in org.billable_venues:
        vb = rows.get(v.id) or {}
        if vb.get("state") in ("pausing", "paused"):
            continue
        extra = max(min(v.zones, vb.get("paid_zones", v.zones)) - INCLUDED_ZONES_PER_VENUE, 0)
        gross = venue_fee + extra * zone_fee
        discount = gross * off // 100
        out.append({
            "venue_id": v.id, "venue": v.name, "cost_centre": vb.get("cost_centre") or "",
            "venue_fee": _major(venue_fee), "extra_zones": extra,
            "extra_zone_fee": _major(extra * zone_fee), "discount": _major(discount),
            "total": _major(gross - discount), "currency": currency, "interval": interval,
        })
    seats = quantities[ITEM_SEAT]
    if seats:
        gross = seats * unit_amount(ITEM_SEAT, currency, interval)
        discount = gross * off // 100
        out.append({
            "venue_id": "", "venue": f"Organisation: {seats} extra staff seats",
            "cost_centre": "", "venue_fee": _major(0), "extra_zones": 0,
            "extra_zone_fee": _major(0), "discount": _major(discount),
            "total": _major(gross - discount), "currency": currency, "interval": interval,
        })
    return out


def cost_breakdown_csv(conn: Connection, org: OrgFacts, *, interval: str | None = None) -> str:
    buffer = io.StringIO()
    writer = csv.DictWriter(buffer, fieldnames=list(CSV_COLUMNS), lineterminator="\n")
    writer.writeheader()
    for line in cost_breakdown(conn, org, interval=interval):
        writer.writerow(line)
    return buffer.getvalue()


def _major(minor: int) -> str:
    return f"{minor / 100:.2f}"
