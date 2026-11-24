"""What the customer should be told about their subscription right now (docs/saas/08-billing.md).

`stripe_sync` decides what a workspace may use; this module turns the same records into the one
billing moment the person needs to hear about, so a failed renewal is never invisible:

| state | when | the date given |
|---|---|---|
| `payment_failed` | a renewal failed and the 7 days of grace are running | when the grace ends |
| `action_required` | the bank wants a payment confirmed (3D Secure) | when the plan ends |
| `cancelling` | the plan was cancelled and runs to the end of its period | when it ends |
| `ended_payment_failed` | the plan dropped to Free because payment failed | when it ended |

Anything else (a healthy plan, Free from the start, a plain cancellation that has run out) says
nothing. `key` changes whenever the state or its date changes, so a notice the person dismissed
comes back for a new event and never for the same one.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

import sqlalchemy as sa
from sqlalchemy.engine import Connection

from selecta.billing import plans
from selecta.billing.schema import entitlement_snapshots, stripe_events, subscriptions
from selecta.billing.stripe_sync import PAST_DUE_GRACE_SECONDS, Entitlement

# How long after a plan ended for a failed payment the notice is still offered.
ENDED_NOTICE_SECONDS = 30 * 86_400
# Invoice events that settle whether a payment still waits on the person.
_INVOICE_EVENTS = ("invoice.payment_action_required", "invoice.paid", "invoice.payment_failed")
_PAYMENT_ENDED = frozenset({"past_due_expired", "unpaid"})


def _label(plan_id: str | None, version: int | None = None) -> str:
    return plans.plan_for(plan_id, version).label


def _latest_subscription(conn: Connection, workspace_id: str) -> Mapping[str, Any] | None:
    return conn.execute(
        sa.select(subscriptions)
        .where(subscriptions.c.workspace_id == workspace_id)
        .order_by(subscriptions.c.updated_at.desc())
        .limit(1)
    ).mappings().first()


def _last_paid_snapshot(conn: Connection, workspace_id: str) -> Mapping[str, Any] | None:
    return conn.execute(
        sa.select(entitlement_snapshots)
        .where(entitlement_snapshots.c.workspace_id == workspace_id,
               entitlement_snapshots.c.plan_id != "free")
        .order_by(entitlement_snapshots.c.version.desc())
        .limit(1)
    ).mappings().first()


def action_required(conn: Connection, subscription_id: str | None) -> bool:
    """Whether the newest invoice event for this subscription asks the person to confirm."""
    if not subscription_id:
        return False
    kind = conn.execute(
        sa.select(stripe_events.c.type)
        .where(stripe_events.c.type.in_(_INVOICE_EVENTS),
               stripe_events.c.refs["subscription"].as_string() == subscription_id)
        .order_by(stripe_events.c.stripe_created.desc(), stripe_events.c.received_at.desc())
        .limit(1)
    ).scalar()
    return kind == "invoice.payment_action_required"


def _cancelled_for_payment(raw: Mapping[str, Any]) -> bool:
    details = raw.get("cancellation_details") or {}
    return details.get("reason") == "payment_failed"


def describe(
    conn: Connection, workspace_id: str, entitlement: Entitlement, now: float
) -> dict[str, Any] | None:
    """The billing moment for the account payload, or None when there is nothing to say."""
    if entitlement.source == "override":
        return None  # staff decided the plan; Stripe's state is not the person's to act on
    sub = _latest_subscription(conn, workspace_id)
    raw = dict(sub["raw"] or {}) if sub else {}
    sub_id = sub["stripe_subscription_id"] if sub else None
    reason = entitlement.reason

    def said(state: str, plan_label: str, at: float | None) -> dict[str, Any]:
        when = round(float(at)) if at else None
        return {"state": state, "plan_label": plan_label, "at": when,
                "key": f"{state}:{sub_id or workspace_id}:{when or 0}"}

    paid_label = _label(entitlement.plan_id, entitlement.plan_version)
    if entitlement.plan_id != "free":
        if reason == "past_due_grace" and action_required(conn, sub_id):
            return said("action_required", paid_label, entitlement.valid_until)
        if reason == "past_due_grace":
            return said("payment_failed", paid_label, entitlement.valid_until)
        if reason in ("cancel_at_period_end", "cancel_at"):
            return said("cancelling", paid_label, entitlement.valid_until)
        return None
    # On Free: the first payment waiting on the bank, or a plan that ended for want of payment.
    if sub is not None and sub["status"] == "incomplete":
        return said("action_required", _label(_price_plan(sub)), None)
    last = _last_paid_snapshot(conn, workspace_id)
    if last is None:
        return None
    ended_at: float | None = None
    if reason in _PAYMENT_ENDED or (reason == "lapsed" and last["reason"] == "past_due_grace"):
        since = sub["past_due_since"] if sub else None
        ended_at = (since + PAST_DUE_GRACE_SECONDS) if since else last["valid_until"]
    elif reason == "canceled" and _cancelled_for_payment(raw):
        ended_at = raw.get("ended_at") or raw.get("canceled_at")
    if ended_at is None:
        return None
    if now - float(ended_at) > ENDED_NOTICE_SECONDS:
        return None
    return said("ended_payment_failed", _label(last["plan_id"], last["plan_version"]), ended_at)


def for_account(
    conn: Connection, principal: Any, entitlement: Entitlement, now: float
) -> dict[str, Any] | None:
    """`describe`, plus whether this person may fix it (only billing managers open the portal)."""
    from selecta.authz.roles import WorkspaceAction

    found = describe(conn, principal.workspace.id, entitlement, now)
    if found is not None:
        found["can_manage"] = bool(principal.can(WorkspaceAction.BILLING_MANAGE))
    return found


def _price_plan(sub: Mapping[str, Any]) -> str | None:
    """The plan a not-yet-paid subscription is for, from the price map; Free when unknown."""
    from selecta.billing.stripe_sync import load_price_map

    try:
        price = load_price_map().get(sub["price_id"] or "")
    except ValueError:
        price = None
    return price.plan_id if price else None


__all__ = ["describe", "for_account", "action_required", "ENDED_NOTICE_SECONDS"]
