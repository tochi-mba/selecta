"""Prepaid packs of extra Lucy usage (ADR-0486): the catalogue, crediting, spending and refunds.

A pack is a number of usage units bought in advance through Stripe Checkout in payment mode.
Each paid payment credits one `lucy_usage_packs` row, keyed by Stripe's payment intent id, so a
webhook that arrives twice credits once (rule 1). The balance is its own ledger line, apart from
the plan's weekly allowance (rule 7). Units last 365 days from purchase, and a pack that is
unspent may be refunded within 14 days (rule 6).

No size or price is set here. The catalogue comes from `SELECTA_STRIPE_PACK_PRICES`, which is
unset by default, and the point-of-sale wording is named by `SELECTA_PACK_CONSENT_VERSION`.
With either unset nothing can be bought.

Nothing in this module spends a pack on its own: `spend` and `give_back` are for the gateway
(`selecta.ai.usage_extra`) once the weekly limit is reached and the member has confirmed for
that week (rule 3).
"""

from __future__ import annotations

import datetime as dt
import json
import logging
import os
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

import sqlalchemy as sa
from sqlalchemy.engine import Connection

from selecta.ai.usage_schema import insert_ignore, lucy_usage_packs, lucy_usage_state
from selecta.billing.schema import stripe_customers
from selecta.billing.stripe_sync import stripe_id
from selecta.persistence import new_id

log = logging.getLogger(__name__)

FLAG = "lucy.extra_usage"
KIND = "lucy_pack"  # the `kind` metadata on a pack's Checkout session
PRICES_ENV = "SELECTA_STRIPE_PACK_PRICES"
CONSENT_ENV = "SELECTA_PACK_CONSENT_VERSION"

# A starting hypothesis (ADR-0486 rule 8), not a measured figure: the owner may change it.
PACKS_PER_MONTH = 4
LIFETIME_SECONDS = 365 * 86_400
REFUND_WINDOW_SECONDS = 14 * 86_400
MAX_LABEL = 80

_packs = lucy_usage_packs.c
_state = lucy_usage_state.c


# The catalogue ----------------------------------------------------------------------------


@dataclass(frozen=True)
class Pack:
    price_id: str
    units: int
    label: str


def parse_catalogue(data: Any) -> dict[str, Pack]:
    """The catalogue from decoded JSON: a Stripe price id to `{"units": int, "label": str}`.
    Raises ValueError naming the first entry that is wrong."""
    if not isinstance(data, Mapping):
        raise ValueError("The pack catalogue must be a JSON object of price ids.")
    found: dict[str, Pack] = {}
    for price_id, entry in data.items():
        if not isinstance(price_id, str) or not price_id.startswith("price_"):
            raise ValueError(f"{price_id!r} is not a Stripe price id.")
        if not isinstance(entry, Mapping):
            raise ValueError(f"Pack {price_id} needs an object with its units and label.")
        units, label = entry.get("units"), entry.get("label")
        if isinstance(units, bool) or not isinstance(units, int) or units < 1:
            raise ValueError(f"Pack {price_id} needs a whole number of units above zero.")
        if not isinstance(label, str) or not label.strip() or len(label) > MAX_LABEL:
            raise ValueError(f"Pack {price_id} needs a label of 1 to {MAX_LABEL} characters.")
        found[price_id] = Pack(price_id, units, label.strip())
    return found


def catalogue(environ: Mapping[str, str] | None = None) -> dict[str, Pack]:
    """The packs on sale. Empty when the variable is unset, empty or does not parse."""
    raw = (os.environ if environ is None else environ).get(PRICES_ENV, "").strip()
    if not raw:
        return {}
    try:
        return parse_catalogue(json.loads(raw))
    except (ValueError, TypeError):
        log.warning("%s does not parse; no pack is on sale.", PRICES_ENV)
        return {}


def packs_available(environ: Mapping[str, str] | None = None) -> bool:
    """Whether the catalogue names at least one pack."""
    return bool(catalogue(environ))


def consent_version(environ: Mapping[str, str] | None = None) -> str | None:
    """The version of the point-of-sale wording a buyer must accept. None when unset, and then
    nothing can be bought."""
    return (os.environ if environ is None else environ).get(CONSENT_ENV, "").strip() or None


# The monthly cap --------------------------------------------------------------------------


def month_bounds(now: float) -> tuple[float, float]:
    """The start and end of the calendar month holding `now`, in UTC."""
    moment = dt.datetime.fromtimestamp(now, dt.UTC)
    start = moment.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    following = (start + dt.timedelta(days=32)).replace(day=1)
    return start.timestamp(), following.timestamp()


def bought_this_month(conn: Connection, workspace_id: str, now: float) -> int:
    """Packs credited to the workspace in the calendar month holding `now`. A refunded pack
    still counts: the cap bounds purchases, so a refund does not hand back a go."""
    start, end = month_bounds(now)
    return int(
        conn.execute(
            sa.select(sa.func.count())
            .select_from(lucy_usage_packs)
            .where(_packs.workspace_id == workspace_id, _packs.bought_at >= start,
                   _packs.bought_at < end)
        ).scalar_one()
    )


def cap_reached(conn: Connection, workspace_id: str, now: float) -> bool:
    return bought_this_month(conn, workspace_id, now) >= PACKS_PER_MONTH


# Crediting --------------------------------------------------------------------------------


def session_refs(session: Mapping[str, Any]) -> dict[str, Any]:
    """What crediting needs from a Checkout session, for `webhooks.event_refs`. Empty unless
    the session is a pack purchase: payment mode, with our own `kind` in its metadata."""
    metadata = session.get("metadata") or {}
    if session.get("mode") != "payment" or metadata.get("kind") != KIND:
        return {}
    return {
        "kind": KIND,
        "payment": stripe_id(session.get("payment_intent")),
        "price": metadata.get("price_id"),
        "paid": session.get("payment_status") == "paid",
    }


def credit(
    conn: Connection, *, workspace_id: str, payment_id: str, units: int, now: float
) -> bool:
    """Credit one pack for one payment. False when that payment was already credited."""
    return insert_ignore(
        conn,
        lucy_usage_packs,
        {
            "id": new_id(),
            "workspace_id": workspace_id,
            "payment_id": payment_id,
            "units": units,
            "remaining_units": units,
            "bought_at": now,
            "expires_at": now + LIFETIME_SECONDS,
            "refunded_at": None,
            "created_at": now,
        },
        ["payment_id"],
    )


def credit_from_refs(
    conn: Connection, refs: Mapping[str, Any], now: float
) -> tuple[str, str | None]:
    """Apply a stored pack event. Answers the event's final status and, when nothing was
    credited, why: `("processed", None)` once the payment has its pack (now or on an earlier
    delivery), else `("ignored", reason)`. Never raises for a bad event and never asks Stripe.
    """
    workspace_id, payment_id = refs.get("workspace"), refs.get("payment")
    if not refs.get("paid"):
        return "ignored", "The pack session is not paid."
    if not workspace_id or not payment_id:
        return "ignored", "The pack session names no workspace or no payment."
    pack = catalogue().get(str(refs.get("price")))
    if pack is None:
        log.warning("A paid pack session names a price that is not in the catalogue.")
        return "ignored", "The pack session's price is not in the catalogue."
    # The session must belong to the Stripe customer we made for that workspace, so metadata
    # written by anyone else cannot credit a workspace.
    owned = conn.execute(
        sa.select(stripe_customers.c.workspace_id).where(
            stripe_customers.c.workspace_id == workspace_id,
            stripe_customers.c.stripe_customer_id == refs.get("customer"),
        )
    ).first()
    if owned is None:
        log.warning("A paid pack session's customer does not belong to its workspace.")
        return "ignored", "The pack session's customer does not belong to its workspace."
    credit(conn, workspace_id=workspace_id, payment_id=payment_id, units=pack.units, now=now)
    return "processed", None


# Spending and the balance -----------------------------------------------------------------


def _live(workspace_id: str, now: float) -> sa.ColumnElement[bool]:
    """Packs that can still be spent: unexpired, unrefunded, with units left."""
    return sa.and_(
        _packs.workspace_id == workspace_id,
        _packs.refunded_at.is_(None),
        _packs.expires_at > now,
        _packs.remaining_units > 0,
    )


def spend(conn: Connection, *, workspace_id: str, units: int, now: float) -> int:
    """Take up to `units` from the workspace's live packs, soonest expiry first, and answer how
    many were taken. Each step is one guarded update, so a pack never goes below zero and two
    callers at once never take the same unit."""
    taken = 0
    # Each pass either takes units or lost a race to another spender; the bound only stops a
    # livelock from spinning for ever.
    for _ in range(1_000):
        if taken >= units:
            break
        pack = conn.execute(
            sa.select(_packs.id, _packs.remaining_units)
            .where(_live(workspace_id, now))
            .order_by(_packs.expires_at, _packs.bought_at, _packs.id)
            .limit(1)
        ).first()
        if pack is None:
            break
        want = min(units - taken, int(pack.remaining_units))
        took = conn.execute(
            sa.update(lucy_usage_packs)
            .where(_packs.id == pack.id, _live(workspace_id, now), _packs.remaining_units >= want)
            .values(remaining_units=_packs.remaining_units - want)
            .returning(_packs.id)
        ).first()
        if took is not None:
            taken += want
    return taken


def give_back(conn: Connection, *, workspace_id: str, units: int, now: float) -> int:
    """Return up to `units` to the workspace's packs, soonest expiry first, and answer how many
    went back. A pack is never lifted above the units it was bought with, and an expired or
    refunded pack takes nothing. Each step is one guarded update."""
    returned = 0
    for _ in range(1_000):
        if returned >= units:
            break
        open_pack = sa.and_(
            _packs.workspace_id == workspace_id,
            _packs.refunded_at.is_(None),
            _packs.expires_at > now,
            _packs.remaining_units < _packs.units,
        )
        pack = conn.execute(
            sa.select(_packs.id, _packs.units, _packs.remaining_units)
            .where(open_pack)
            .order_by(_packs.expires_at, _packs.bought_at, _packs.id)
            .limit(1)
        ).first()
        if pack is None:
            break
        want = min(units - returned, int(pack.units) - int(pack.remaining_units))
        gave = conn.execute(
            sa.update(lucy_usage_packs)
            .where(_packs.id == pack.id, open_pack,
                   _packs.remaining_units + want <= _packs.units)
            .values(remaining_units=_packs.remaining_units + want)
            .returning(_packs.id)
        ).first()
        if gave is not None:
            returned += want
    return returned


def balance(conn: Connection, workspace_id: str, now: float) -> dict[str, Any]:
    """The workspace's extra usage as of `now`: units left across live packs, the size of the
    most recently bought live pack (the meter shows the balance as a share of it), and the
    soonest expiry. With nothing left, zero and two Nones."""
    remaining, soonest = conn.execute(
        sa.select(sa.func.coalesce(sa.func.sum(_packs.remaining_units), 0),
                  sa.func.min(_packs.expires_at))
        .where(_live(workspace_id, now))
    ).one()
    last = conn.execute(
        sa.select(_packs.units)
        .where(_live(workspace_id, now))
        .order_by(_packs.bought_at.desc(), _packs.id.desc())
        .limit(1)
    ).scalar_one_or_none()
    return {
        "remaining_units": int(remaining),
        "last_pack_units": None if last is None else int(last),
        "expires_at": None if soonest is None else float(soonest),
    }


def list_packs(conn: Connection, workspace_id: str, now: float) -> list[dict[str, Any]]:
    """The workspace's packs, newest first, each with whether it has expired or may be
    refunded."""
    rows = conn.execute(
        sa.select(lucy_usage_packs)
        .where(_packs.workspace_id == workspace_id)
        .order_by(_packs.bought_at.desc(), _packs.id.desc())
    ).mappings()
    return [
        {
            "id": row["id"],
            "units": int(row["units"]),
            "remaining_units": int(row["remaining_units"]),
            "bought_at": float(row["bought_at"]),
            "expires_at": float(row["expires_at"]),
            "refunded_at": row["refunded_at"],
            "expired": float(row["expires_at"]) <= now,
            "refundable": refundable(row, now),
        }
        for row in rows
    ]


# The weekly confirmation ------------------------------------------------------------------


def confirm_week(conn: Connection, workspace_id: str, week_seq: int) -> bool:
    """Record that extra usage may be spent in week `week_seq` (rule 3). True when the
    workspace is in that week and it is now confirmed; safe to repeat."""
    return (
        conn.execute(
            sa.update(lucy_usage_state)
            .where(_state.workspace_id == workspace_id, _state.week_seq == week_seq)
            .values(extra_confirmed_week_seq=week_seq)
            .returning(_state.id)
        ).first()
        is not None
    )


def confirmed(conn: Connection, workspace_id: str, week_seq: int) -> bool:
    """Whether the member confirmed extra usage for week `week_seq`."""
    return (
        conn.execute(
            sa.select(_state.id).where(
                _state.workspace_id == workspace_id,
                _state.extra_confirmed_week_seq == week_seq,
            )
        ).first()
        is not None
    )


# Refunds ----------------------------------------------------------------------------------


def refundable(pack: Mapping[str, Any], now: float) -> bool:
    """Whether a pack may be refunded: nothing spent, not refunded, bought at most 14 days
    ago (rule 6)."""
    return (
        pack["refunded_at"] is None
        and int(pack["remaining_units"]) == int(pack["units"])
        and now - float(pack["bought_at"]) <= REFUND_WINDOW_SECONDS
    )


def mark_refunded(conn: Connection, pack_id: str, now: float) -> bool:
    """Mark a refundable pack refunded, so it stops counting. True once; False when it was
    spent from, is past 14 days or is already refunded. The money is returned by whoever calls
    this (a staff path, not built yet)."""
    return (
        conn.execute(
            sa.update(lucy_usage_packs)
            .where(
                _packs.id == pack_id,
                _packs.refunded_at.is_(None),
                _packs.remaining_units == _packs.units,
                _packs.bought_at >= now - REFUND_WINDOW_SECONDS,
            )
            .values(refunded_at=now)
            .returning(_packs.id)
        ).first()
        is not None
    )


__all__ = [
    "CONSENT_ENV",
    "FLAG",
    "KIND",
    "LIFETIME_SECONDS",
    "PACKS_PER_MONTH",
    "PRICES_ENV",
    "REFUND_WINDOW_SECONDS",
    "Pack",
    "balance",
    "bought_this_month",
    "cap_reached",
    "catalogue",
    "confirm_week",
    "confirmed",
    "consent_version",
    "credit",
    "credit_from_refs",
    "give_back",
    "list_packs",
    "mark_refunded",
    "month_bounds",
    "packs_available",
    "parse_catalogue",
    "refundable",
    "session_refs",
    "spend",
]
