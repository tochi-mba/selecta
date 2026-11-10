"""Stripe webhooks: check the signature, store each event once, then process it as a poke (§8.2).

The endpoint calls `parse_event` on the raw body and the `Stripe-Signature` header, then
`store_event`, and answers 200 at once. A job calls `process_event` later. Processing never
trusts the event's copy of the subscription: it asks Stripe for the subscription as it is now,
stores that, and recomputes the workspace's entitlement snapshot. So a duplicate changes
nothing, and events arriving late or out of order still end at Stripe's current state.

What an event's body is trusted for: which subscription, customer or charge it is about, the
workspace a Checkout session was opened for (`client_reference_id`, set by our own server), and
a dispute's final status. A lost dispute never changes back, so applying it in any order is safe.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import re
import time
from collections.abc import Iterator, Mapping, Sequence
from dataclasses import dataclass
from enum import StrEnum
from typing import Any

import httpx
import sqlalchemy as sa
from sqlalchemy.engine import Connection

from selecta.billing.schema import insert_ignore, stripe_events, subscriptions
from selecta.billing.stripe_sync import (
    PriceMap,
    StripeClient,
    StripeUnavailable,
    attach_consent,
    recompute_snapshot,
    stripe_id,
    upsert_subscription,
    workspace_for,
)
from selecta.persistence import db_now, lock_rows, new_id

TOLERANCE_SECONDS = 300
HANDLED_TYPES = frozenset(
    {
        "checkout.session.completed",
        "customer.subscription.created",
        "customer.subscription.updated",
        "customer.subscription.deleted",
        "customer.subscription.paused",
        "customer.subscription.resumed",
        "invoice.paid",
        "invoice.payment_failed",
        "invoice.payment_action_required",
        "charge.refunded",
        "charge.dispute.created",
        "charge.dispute.closed",
        "entitlements.active_entitlement_summary.updated",
    }
)


class SignatureError(ValueError):
    """The body isn't provably from Stripe, or is too old. Answer 400 and store nothing."""


class EventStatus(StrEnum):
    RECEIVED = "received"
    PROCESSED = "processed"
    IGNORED = "ignored"  # a type Selecta doesn't act on; stored so it isn't counted as lost
    FAILED = "failed"  # will be retried; `error` says why


def verify_signature(
    payload: bytes,
    header: str | None,
    secrets: str | Sequence[str],
    *,
    tolerance: float = TOLERANCE_SECONDS,
    now: float | None = None,
) -> int:
    """Check `Stripe-Signature` (`t=...,v1=...`) and return its timestamp.

    The signature is HMAC-SHA256 of `"{t}.{raw body}"` with the endpoint's signing secret. Any
    `v1` may match any of `secrets` (several during a secret roll), compared in constant time.
    A timestamp more than `tolerance` seconds from now is refused, which stops replays.
    """
    if not header:
        raise SignatureError("Missing Stripe-Signature header.")
    timestamp, signatures = None, []
    for part in header.split(","):
        key, _, value = part.strip().partition("=")
        if key == "t":
            timestamp = value
        elif key == "v1" and value:
            signatures.append(value)
    if not timestamp or not signatures:
        raise SignatureError("Stripe-Signature has no timestamp or no v1 signature.")
    try:
        signed_at = int(timestamp)
    except ValueError as problem:
        raise SignatureError("Stripe-Signature has a malformed timestamp.") from problem
    now = time.time() if now is None else now
    if abs(now - signed_at) > tolerance:
        raise SignatureError("Stripe-Signature timestamp is outside the tolerance.")
    # An empty secret is a key anyone can sign with, so it never counts as configured.
    keys = [key for key in ([secrets] if isinstance(secrets, str) else secrets) if key]
    if not keys:
        raise SignatureError("No webhook signing secret is configured.")
    signed = timestamp.encode() + b"." + payload
    for key in keys:
        expected = hmac.new(key.encode(), signed, hashlib.sha256).hexdigest()
        for candidate in signatures:
            if hmac.compare_digest(expected, candidate):
                return signed_at
    raise SignatureError("No signature matches.")


def parse_event(
    payload: bytes,
    header: str | None,
    secrets: str | Sequence[str],
    *,
    tolerance: float = TOLERANCE_SECONDS,
    now: float | None = None,
) -> dict[str, Any]:
    """Verify, then decode. Only a verified body is ever parsed."""
    verify_signature(payload, header, secrets, tolerance=tolerance, now=now)
    try:
        event = json.loads(payload)
    except ValueError as problem:
        raise SignatureError("The signed body isn't JSON.") from problem
    if not isinstance(event, dict) or not event.get("id") or not event.get("type"):
        raise SignatureError("The signed body isn't a Stripe event.")
    return event


def event_refs(event: Mapping[str, Any]) -> dict[str, Any]:
    """The pointers processing needs, and nothing else (no names, emails or card details)."""
    obj = (event.get("data") or {}).get("object") or {}
    kind = obj.get("object")
    metadata = obj.get("metadata") or {}
    refs: dict[str, Any] = {"object": kind}
    if kind == "subscription":
        refs.update(
            subscription=stripe_id(obj.get("id")),
            customer=stripe_id(obj.get("customer")),
            workspace=metadata.get("workspace_id"),
        )
    elif kind == "checkout.session":
        refs.update(
            subscription=stripe_id(obj.get("subscription")),
            customer=stripe_id(obj.get("customer")),
            workspace=obj.get("client_reference_id") or metadata.get("workspace_id"),
            session=stripe_id(obj.get("id")),
        )
    elif kind == "invoice":
        parent = (obj.get("parent") or {}).get("subscription_details") or {}
        refs.update(
            subscription=stripe_id(obj.get("subscription") or parent.get("subscription")),
            customer=stripe_id(obj.get("customer")),
        )
    elif kind == "charge":
        refs.update(charge=stripe_id(obj.get("id")), customer=stripe_id(obj.get("customer")))
    elif kind == "dispute":
        charge = obj.get("charge")
        refs.update(
            charge=stripe_id(charge),
            dispute=stripe_id(obj.get("id")),
            dispute_status=obj.get("status"),
        )
        if isinstance(charge, Mapping):
            refs["customer"] = stripe_id(charge.get("customer"))
    else:
        refs["customer"] = stripe_id(obj.get("customer"))
    return {key: value for key, value in refs.items() if value}


@dataclass(frozen=True)
class StoredEvent:
    event_id: str
    stored: bool
    """False when this event id was already stored: a duplicate delivery."""
    status: str


def store_event(conn: Connection, event: Mapping[str, Any]) -> StoredEvent:
    """Store a verified event once. Safe to call for every delivery of the same event."""
    event_id, event_type = event.get("id"), event.get("type")
    if not event_id or not event_type:
        raise ValueError("A Stripe event needs an id and a type.")
    now = db_now(conn)
    handled = event_type in HANDLED_TYPES
    status = EventStatus.RECEIVED if handled else EventStatus.IGNORED
    created = event.get("created")
    stored = insert_ignore(
        conn,
        stripe_events,
        {
            "id": new_id(),
            "event_id": event_id,
            "type": event_type,
            "livemode": bool(event.get("livemode")),
            "stripe_created": float(created) if created else None,
            "refs": event_refs(event) if handled else {},
            "received_at": now,
            "processed_at": None if handled else now,
            "status": status.value,
            "attempts": 0,
        },
        ["event_id"],
    )
    if not stored:
        status = conn.execute(
            sa.select(stripe_events.c.status).where(stripe_events.c.event_id == event_id)
        ).scalar_one()
    return StoredEvent(str(event_id), stored, str(status))


@dataclass(frozen=True)
class ProcessResult:
    event_id: str
    status: str
    """processed, ignored, failed, busy (another worker holds it; retry) or missing."""
    workspaces: tuple[str, ...] = ()
    error: str | None = None
    duplicate: bool = False


def _claim(conn: Connection, refs: Mapping[str, Any]) -> bool:
    """Lock the subscription rows this event is about before asking Stripe, so a slower worker
    holding an older answer can't write it over a newer one."""
    if refs.get("subscription"):
        column, value = subscriptions.c.stripe_subscription_id, refs["subscription"]
    elif refs.get("customer"):
        column, value = subscriptions.c.stripe_customer_id, refs["customer"]
    else:
        return True
    ids = set(conn.execute(sa.select(subscriptions.c.id).where(column == value)).scalars())
    if not ids:
        return True
    locked = conn.execute(
        lock_rows(sa.select(subscriptions.c.id).where(subscriptions.c.id.in_(ids)))
    ).scalars()
    return set(locked) == ids


def _fetch(client: StripeClient, refs: Mapping[str, Any]) -> list[dict[str, Any]]:
    if refs.get("subscription"):
        found = client.get_subscription(refs["subscription"])
        return [found] if found else []
    customer = refs.get("customer")
    if not customer and refs.get("charge"):
        charge = client.get_charge(refs["charge"]) or {}
        customer = stripe_id(charge.get("customer"))
    return list(client.list_subscriptions(customer=customer)) if customer else []


def _mark(
    conn: Connection, row_id: str, status: EventStatus, now: float, error: str | None
) -> None:
    conn.execute(
        sa.update(stripe_events)
        .where(stripe_events.c.id == row_id)
        .values(
            status=status.value,
            error=error,
            attempts=stripe_events.c.attempts + 1,
            processed_at=now if status is EventStatus.PROCESSED else None,
        )
    )


def process_event(
    conn: Connection,
    event_id: str,
    client: StripeClient,
    price_map: PriceMap,
    now: float | None = None,
) -> ProcessResult:
    """Re-fetch what the event is about, store it, and recompute entitlements. Call inside a
    transaction, one event per transaction. A Stripe outage marks the event failed for retry
    and leaves every snapshot as it was."""
    row = (
        conn.execute(
            lock_rows(sa.select(stripe_events).where(stripe_events.c.event_id == event_id))
        )
        .mappings()
        .first()
    )
    if row is None:
        exists = conn.execute(
            sa.select(stripe_events.c.id).where(stripe_events.c.event_id == event_id)
        ).first()
        return ProcessResult(event_id, "busy" if exists else "missing")
    if row["status"] in (EventStatus.PROCESSED, EventStatus.IGNORED):
        return ProcessResult(event_id, row["status"], duplicate=True)
    now = db_now(conn) if now is None else now
    refs = dict(row["refs"] or {})
    if not _claim(conn, refs):
        return ProcessResult(event_id, "busy")
    try:
        found = _fetch(client, refs)
    except StripeUnavailable as problem:
        _mark(conn, row["id"], EventStatus.FAILED, now, f"Stripe unavailable: {problem}")
        return ProcessResult(event_id, EventStatus.FAILED.value, error=str(problem))

    dispute_lost = refs.get("dispute_status") == "lost"
    touched: list[str] = []
    unmatched: list[str] = []
    for sub in found:
        workspace_id = workspace_for(conn, sub, refs.get("workspace"))
        if workspace_id is None:
            unmatched.append(str(stripe_id(sub.get("id"))))
            continue
        upsert_subscription(
            conn, workspace_id, sub, now, price_map=price_map, dispute_lost=dispute_lost
        )
        if workspace_id not in touched:
            touched.append(workspace_id)
    if refs.get("session") and refs.get("subscription"):
        attach_consent(conn, refs["session"], refs["subscription"])
    for workspace_id in touched:
        recompute_snapshot(conn, workspace_id, price_map, now)
    if unmatched:
        error = f"No workspace for {', '.join(unmatched)}."
        _mark(conn, row["id"], EventStatus.FAILED, now, error)
        return ProcessResult(event_id, EventStatus.FAILED.value, tuple(touched), error)
    _mark(conn, row["id"], EventStatus.PROCESSED, now, None)
    return ProcessResult(event_id, EventStatus.PROCESSED.value, tuple(touched))


def pending_events(conn: Connection, limit: int = 50, max_attempts: int = 10) -> list[str]:
    """Event ids still to process, oldest first, for the job that calls `process_event`."""
    return list(
        conn.execute(
            sa.select(stripe_events.c.event_id)
            .where(
                stripe_events.c.status.in_([EventStatus.RECEIVED.value, EventStatus.FAILED.value]),
                stripe_events.c.attempts < max_attempts,
            )
            .order_by(stripe_events.c.received_at)
            .limit(limit)
        ).scalars()
    )


class HttpStripeClient:
    """Stripe's REST API over httpx. Nothing is sent until a method is called."""

    def __init__(
        self,
        api_key: str,
        *,
        base_url: str = "https://api.stripe.com",
        api_version: str | None = None,
        timeout: float = 20.0,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        self._headers = {"Authorization": f"Bearer {api_key}"}
        if api_version:
            self._headers["Stripe-Version"] = api_version
        self._base_url = base_url
        self._timeout = timeout
        self._transport = transport

    def __repr__(self) -> str:
        return f"HttpStripeClient(base_url={self._base_url!r})"  # never the key

    def _get(self, path: str, params: list[tuple[str, str]]) -> dict[str, Any] | None:
        try:
            with httpx.Client(
                base_url=self._base_url, timeout=self._timeout, transport=self._transport
            ) as client:
                response = client.get(path, params=params, headers=self._headers)
        except httpx.HTTPError as problem:
            raise StripeUnavailable(f"Can't reach Stripe: {problem}") from problem
        if response.status_code == 404:
            return None
        if response.status_code >= 400:
            raise StripeUnavailable(f"Stripe answered {response.status_code} for {path}.")
        return response.json()

    def _post(self, path: str, data: Mapping[str, str], idempotency_key: str) -> dict[str, Any]:
        """Submit a form to Stripe without exposing credentials or response bodies in errors."""
        if not idempotency_key or len(idempotency_key) > 255:
            raise ValueError("A Stripe idempotency key between 1 and 255 characters is required.")
        headers = {
            **self._headers,
            "Content-Type": "application/x-www-form-urlencoded",
            "Idempotency-Key": idempotency_key,
        }
        try:
            with httpx.Client(
                base_url=self._base_url,
                timeout=self._timeout,
                transport=self._transport,
                follow_redirects=False,
            ) as client:
                response = client.post(path, data=data, headers=headers)
        except httpx.HTTPError as problem:
            # httpx exceptions can contain request details. Keep the public error bounded.
            raise StripeUnavailable(f"Can't reach Stripe ({type(problem).__name__}).") from problem
        if response.status_code >= 400:
            raise StripeUnavailable(f"Stripe answered {response.status_code} for {path}.")
        try:
            payload = response.json()
        except (ValueError, json.JSONDecodeError) as problem:
            raise StripeUnavailable("Stripe returned an invalid response.") from problem
        if not isinstance(payload, dict):
            raise StripeUnavailable("Stripe returned an invalid response.")
        return payload

    @staticmethod
    def _require_response_string(payload: Mapping[str, Any], field: str, prefix: str) -> str:
        value = payload.get(field)
        if not isinstance(value, str) or not value.startswith(prefix) or len(value) > 512:
            raise StripeUnavailable("Stripe returned an invalid response.")
        return value

    @staticmethod
    def _require_session_url(payload: Mapping[str, Any]) -> str:
        value = payload.get("url")
        if not isinstance(value, str) or len(value) > 2048:
            raise StripeUnavailable("Stripe returned an invalid response.")
        try:
            parsed = httpx.URL(value)
        except (TypeError, ValueError, httpx.InvalidURL) as problem:  # not a ValueError
            raise StripeUnavailable("Stripe returned an invalid response.") from problem
        if parsed.scheme != "https" or not parsed.host:
            raise StripeUnavailable("Stripe returned an invalid response.")
        return value

    @staticmethod
    def _require_stripe_host(url: str, expected: str) -> str:
        parsed = httpx.URL(url)
        if parsed.host != expected:
            raise StripeUnavailable("Stripe returned a session URL on an unexpected host.")
        return url

    def create_customer(
        self,
        *,
        workspace_id: str,
        idempotency_key: str,
        email: str | None = None,
    ) -> dict[str, Any]:
        data = {"metadata[workspace_id]": workspace_id}
        if email:
            data["email"] = email
        payload = self._post("/v1/customers", data, idempotency_key)
        self._require_response_string(payload, "id", "cus_")
        return payload

    def create_checkout_session(
        self,
        *,
        workspace_id: str,
        customer_id: str,
        price_id: str,
        success_url: str,
        cancel_url: str,
        idempotency_key: str,
    ) -> dict[str, Any]:
        data = {
            "mode": "subscription",
            "customer": customer_id,
            "billing_address_collection": "required",
            "automatic_tax[enabled]": "true",
            "tax_id_collection[enabled]": "true",
            "customer_update[address]": "auto",
            "client_reference_id": workspace_id,
            "line_items[0][price]": price_id,
            "line_items[0][quantity]": "1",
            "subscription_data[metadata][workspace_id]": workspace_id,
            "success_url": success_url,
            "cancel_url": cancel_url,
        }
        payload = self._post("/v1/checkout/sessions", data, idempotency_key)
        self._require_response_string(payload, "id", "cs_")
        self._require_stripe_host(self._require_session_url(payload), "checkout.stripe.com")
        return payload

    def create_portal_session(
        self,
        *,
        customer_id: str,
        return_url: str,
        idempotency_key: str,
    ) -> dict[str, Any]:
        payload = self._post(
            "/v1/billing_portal/sessions",
            {"customer": customer_id, "return_url": return_url},
            idempotency_key,
        )
        self._require_response_string(payload, "id", "bps_")
        self._require_stripe_host(self._require_session_url(payload), "billing.stripe.com")
        return payload

    def get_subscription(self, subscription_id: str) -> dict[str, Any] | None:
        return self._get(f"/v1/subscriptions/{subscription_id}", [("expand[]", "latest_invoice")])

    def cancel_subscription(self, subscription_id: str) -> dict[str, Any] | None:
        """Cancel a subscription immediately; deleting an already absent one is harmless.

        Stripe's DELETE endpoint is naturally idempotent for this operation. We deliberately do
        not persist payment methods or issue a second customer deletion here; invoice retention
        and customer-data erasure need their own billing policy.
        """
        if not isinstance(subscription_id, str) or not re.fullmatch(
            r"sub_[A-Za-z0-9]{1,250}", subscription_id
        ):
            raise ValueError("A valid Stripe subscription id is required.")
        path = f"/v1/subscriptions/{subscription_id}"
        try:
            with httpx.Client(
                base_url=self._base_url,
                timeout=self._timeout,
                transport=self._transport,
                follow_redirects=False,
            ) as client:
                response = client.delete(path, headers=self._headers)
        except httpx.HTTPError as problem:
            raise StripeUnavailable(f"Can't reach Stripe ({type(problem).__name__}).") from problem
        if response.status_code == 404:
            return None
        if response.status_code >= 400:
            raise StripeUnavailable(f"Stripe answered {response.status_code} for {path}.")
        try:
            payload = response.json()
        except (ValueError, json.JSONDecodeError) as problem:
            raise StripeUnavailable("Stripe returned an invalid response.") from problem
        if not isinstance(payload, dict):
            raise StripeUnavailable("Stripe returned an invalid response.")
        return payload

    def list_subscriptions(self, customer: str | None = None) -> Iterator[dict[str, Any]]:
        params = [("status", "all"), ("limit", "100"), ("expand[]", "data.latest_invoice")]
        if customer:
            params.append(("customer", customer))
        after: str | None = None
        while True:
            page = (
                self._get(
                    "/v1/subscriptions", params + ([("starting_after", after)] if after else [])
                )
                or {}
            )
            data = page.get("data") or []
            yield from data
            if not page.get("has_more") or not data:
                return
            after = data[-1]["id"]

    def get_charge(self, charge_id: str) -> dict[str, Any] | None:
        return self._get(f"/v1/charges/{charge_id}", [])
