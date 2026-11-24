"""The personal plan's billing emails, and which are due (docs/saas/08-billing.md §8.9).

Stripe sends receipts, invoices, the link to confirm a payment the bank asks about (3D Secure)
and refund notices. SelectaDJ sends the four below, because only SelectaDJ knows what each means
for the account (the grace date, what Free keeps). The Stripe dashboard must have its own
"failed payment" email turned off so nobody gets two for one event (§8.9 says which switch).

| kind | when | key, with the workspace (sent once) |
|---|---|---|
| `billing_payment_failed` | a renewal failed and 7 days of grace started | grace end |
| `billing_plan_ending` | a cancelled plan ends in 3 days or fewer | end date |
| `billing_plan_ended` | the plan dropped to Free (payment failed or cancelled) | snapshot |
| `billing_plan_now` | the plan became a paid plan, or changed to another | snapshot |

Each is looked for over the last `LOOKBACK_S` (shorter than the outbox's seven days, which is
how `send_once` remembers a key). Only with `billing.standing` on. Dates are in the owner's own
time zone. No amounts: those are Stripe's receipt, which carries VAT correctly.
"""

from __future__ import annotations

from datetime import UTC, datetime
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import sqlalchemy as sa
from sqlalchemy.engine import Connection

from selecta.billing import plans
from selecta.billing.schema import entitlement_snapshots
from selecta.billing.stripe_sync import RENEWAL_SLACK_SECONDS
from selecta.identity.schema import users, workspaces
from selecta.notify import templates
from selecta.notify.mail import SENDER_NAME, Message, valid_address

LOOKBACK_S = 6 * 86_400.0
ENDING_NOTICE_S = 3 * 86_400.0
FLAG = "billing.standing"
_CANCELLING = frozenset({"cancel_at_period_end", "cancel_at"})


def day_in(epoch_s: float, timezone: str | None) -> str:
    """"4 December 2026" in the person's own time zone (UTC when it is unknown)."""
    try:
        zone = ZoneInfo(timezone or "UTC")
    except (ZoneInfoNotFoundError, ValueError):
        zone = ZoneInfo("UTC")
    moment = datetime.fromtimestamp(float(epoch_s), UTC).astimezone(zone)
    return f"{moment.day} {moment:%B %Y}"


def _billing_link(site_url: str) -> str:
    return templates._link(site_url, "/account/billing")


def payment_failed(*, to: str, key: str, plan: str, until: float, timezone: str | None,
                   site_url: str = "") -> Message:
    day = day_in(until, timezone)
    return templates._message(
        to=to, kind="billing_payment_failed", key=key,
        subject=f"We couldn't take your {SENDER_NAME} payment",
        lines=[
            f"We couldn't take your last payment for {SENDER_NAME} {plan}.",
            f"Your {plan} plan stays until {day}. Update your card before then to keep it. "
            "Stripe will try the payment again in the meantime.",
            "Your music and mixes are safe whatever happens.",
        ],
        action=("Update your card", _billing_link(site_url)),
    )


def plan_ending(*, to: str, key: str, plan: str, ends: float, timezone: str | None,
                site_url: str = "") -> Message:
    day = day_in(ends, timezone)
    return templates._message(
        to=to, kind="billing_plan_ending", key=key,
        subject=f"Your {SENDER_NAME} {plan} plan ends on {day}",
        lines=[
            f"Your {plan} plan ends on {day}, as you asked. After that you're on Free.",
            "Nothing is deleted. If you change your mind, you can keep your plan from "
            "Plan & billing before then.",
        ],
        action=("Keep my plan", _billing_link(site_url)),
    )


def plan_ended(*, to: str, key: str, plan: str, ended: float, timezone: str | None,
               payment_failed: bool, site_url: str = "") -> Message:
    day = day_in(ended, timezone)
    why = " because payment failed" if payment_failed else ""
    return templates._message(
        to=to, kind="billing_plan_ended", key=key,
        subject=f"Your {SENDER_NAME} {plan} plan has ended",
        lines=[
            f"Your {plan} plan ended on {day}{why}. You're now on Free.",
            "Your music and mixes are still here, and nothing has been deleted. Anything over "
            "Free's limits stays as it is; you can choose a plan again whenever you like.",
        ],
        action=("See plans", _billing_link(site_url)),
    )


def plan_now(*, to: str, key: str, plan: str, site_url: str = "") -> Message:
    return templates._message(
        to=to, kind="billing_plan_now", key=key,
        subject=f"Your {SENDER_NAME} plan is now {plan}",
        lines=[
            f"Your {SENDER_NAME} plan is now {plan}, and everything it includes is ready to use.",
            "Stripe sends your receipt separately. You can change or cancel your plan at any "
            "time from Plan & billing.",
        ],
        action=(f"Open {SENDER_NAME}", templates._link(site_url, "/")),
    )


def _owner(conn: Connection, workspace_id: str) -> tuple[str, str | None] | None:
    row = conn.execute(
        sa.select(users.c.email, users.c.email_verified, users.c.deleted_at, users.c.timezone)
        .select_from(workspaces.join(users, users.c.id == workspaces.c.owner_user_id))
        .where(workspaces.c.id == workspace_id)
    ).one_or_none()
    if row is None or row.deleted_at is not None or not row.email_verified:
        return None
    return (row.email, row.timezone) if valid_address(row.email) else None


def _latest_two(conn: Connection, workspace_id: str) -> list[sa.Row]:
    return list(conn.execute(
        sa.select(entitlement_snapshots)
        .where(entitlement_snapshots.c.workspace_id == workspace_id)
        .order_by(entitlement_snapshots.c.version.desc())
        .limit(2)
    ))


def _label(plan_id: str, version: int | None) -> str:
    return plans.plan_for(plan_id, version).label


def due(conn: Connection, now: float, site_url: str = "") -> list[Message]:
    """Every billing email due now. The caller sends each once by its key."""
    recent = sa.select(entitlement_snapshots.c.workspace_id).where(
        sa.or_(entitlement_snapshots.c.computed_at >= now - LOOKBACK_S,
               entitlement_snapshots.c.valid_until.between(now, now + ENDING_NOTICE_S))
    ).distinct()
    found: list[Message] = []
    for workspace_id in sorted(conn.execute(recent).scalars()):
        rows = _latest_two(conn, workspace_id)
        owner = _owner(conn, workspace_id)
        if not rows or owner is None:
            continue
        to, timezone = owner
        latest, before = rows[0], rows[1] if len(rows) > 1 else None
        fresh = latest.computed_at >= now - LOOKBACK_S
        if latest.plan_id != "free":
            label = _label(latest.plan_id, latest.plan_version)
            if fresh and latest.reason == "past_due_grace" and latest.valid_until:
                found.append(payment_failed(
                    to=to, key=f"billing_payment_failed:{workspace_id}:{int(latest.valid_until)}",
                    plan=label, until=latest.valid_until, timezone=timezone, site_url=site_url))
            if (latest.reason in _CANCELLING and latest.valid_until
                    and now < latest.valid_until <= now + ENDING_NOTICE_S):
                found.append(plan_ending(
                    to=to, key=f"billing_plan_ending:{workspace_id}:{int(latest.valid_until)}",
                    plan=label, ends=latest.valid_until, timezone=timezone, site_url=site_url))
            moved = before is None or before.plan_id != latest.plan_id
            if fresh and moved and latest.source == "stripe":
                found.append(plan_now(
                    to=to, key=f"billing_plan_now:{workspace_id}:{latest.version}",
                    plan=label, site_url=site_url))
        elif fresh and before is not None and before.plan_id != "free":
            failed = latest.reason in ("past_due_expired", "unpaid") or (
                before.reason == "past_due_grace")
            ended = before.valid_until if before.valid_until else latest.computed_at
            if before.reason in ("active", "trialing") and before.valid_until:
                ended = before.valid_until - RENEWAL_SLACK_SECONDS
            found.append(plan_ended(
                to=to, key=f"billing_plan_ended:{workspace_id}:{latest.version}",
                plan=_label(before.plan_id, before.plan_version), ended=min(ended, now),
                timezone=timezone, payment_failed=failed, site_url=site_url))
    return found


def on() -> bool:
    from selecta import flags

    try:
        return flags.on(FLAG)
    except KeyError:
        return False


__all__ = ["ENDING_NOTICE_S", "LOOKBACK_S", "day_in", "due", "on", "payment_failed",
           "plan_ended", "plan_ending", "plan_now"]
