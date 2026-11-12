"""A pretend Stripe for `dev.cmd cloud`: plans and limits without a Stripe account or key.

`DevStripe` replaces `billing.webhooks.HttpStripeClient` inside the local API process only. The
real billing routes still check consent, the origin and the price map; Checkout and the
customer portal are small pages here:

- Checkout offers "Pay with a test card", which writes the paid plan's entitlement snapshot the
  way Stripe's webhook would, and "Use a declined card", which fails as a declined card does and
  leaves the plan unchanged. Cancel goes back to SelectaDJ.
- The portal can cancel the subscription now, which returns the workspace to Free.

With `--stripe-test-key` and a `sk_test_` key in `SELECTA_STRIPE_SECRET_KEY`, the launcher leaves
the real client in place instead (Stripe test mode). A live key is refused by `guard`.
"""

from __future__ import annotations

import json
import secrets
import threading
from html import escape
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlencode, urlsplit

from fastapi import FastAPI, Request
from fastapi.responses import RedirectResponse
from sqlalchemy import select
from sqlalchemy.engine import Engine

from selecta.billing import plans as plan_catalogue
from selecta.billing import stripe_sync
from selecta.billing.plans import plan_for
from selecta.billing.schema import stripe_customers
from selecta.devstack.pages import page
from selecta.persistence import db_now, transaction
from selecta.usage import quota

PREFIX = "/dev-stripe"
CONSENT = "terms-local-dev"
PRICES = {
    "price_dev_standard_month": {"plan": "standard", "version": 1, "interval": "month"},
    "price_dev_standard_year": {"plan": "standard", "version": 1, "interval": "year"},
    "price_dev_premium_month": {"plan": "premium", "version": 1, "interval": "month"},
    "price_dev_premium_year": {"plan": "premium", "version": 1, "interval": "year"},
}


def environment() -> dict[str, str]:
    """What the billing routes read from the environment, for the pretend Stripe."""
    return {
        "SELECTA_STRIPE_SECRET_KEY": "sk_dev_local_pretend",
        "SELECTA_STRIPE_PRICES": json.dumps(PRICES),
        "SELECTA_CHECKOUT_CONSENT_VERSION": CONSENT,
    }


def same_site(url: str) -> str:
    """Only the path and query of a return URL, so these pages can't send anyone elsewhere."""
    parts = urlsplit(url)
    path = "/" + parts.path.lstrip("/\\")
    return path + (f"?{parts.query}" if parts.query else "")


class Checkouts:
    """Checkout sessions, kept in a JSON file so a restart mid-checkout still works."""

    def __init__(self, path: Path) -> None:
        self.path = path
        self._lock = threading.Lock()

    def _all(self) -> dict[str, dict[str, Any]]:
        try:
            return json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return {}

    def add(self, fields: dict[str, Any]) -> str:
        with self._lock:
            sessions = self._all()
            session_id = f"cs_dev_{secrets.token_hex(8)}"
            sessions[session_id] = fields
            self.path.write_text(json.dumps(sessions), encoding="utf-8")
        return session_id

    def get(self, session_id: str) -> dict[str, Any] | None:
        return self._all().get(session_id)


def install(app: FastAPI, engine: Engine, folder: Path) -> type:
    """Mount the pretend Checkout and portal pages; return the client class to use."""
    checkouts = Checkouts(folder / "stripe-checkouts.json")

    class DevStripe:
        def __init__(self, *_args, **_kwargs) -> None:
            pass

        def create_customer(self, **fields):
            return {"id": f"cus_dev_{fields['workspace_id'][:12]}", "object": "customer"}

        def create_checkout_session(self, **fields):
            session_id = checkouts.add(dict(fields))
            return {"id": session_id, "url": f"{PREFIX}/checkout/{session_id}"}

        def create_portal_session(self, **fields):
            query = urlencode(
                {"back": same_site(fields["return_url"]), "customer": fields["customer_id"]}
            )
            return {"id": f"bps_dev_{secrets.token_hex(4)}", "url": f"{PREFIX}/portal?{query}"}

    def price_text(price_id: str) -> tuple[str, str]:
        price = PRICES[price_id]
        plan = plan_catalogue.plan_for(price["plan"])
        name = getattr(plan, "name", None) or price["plan"].title()
        return str(name), "per month" if price["interval"] == "month" else "per year"

    @app.get(PREFIX + "/checkout/{session_id}", include_in_schema=False)
    def checkout(session_id: str):
        fields = checkouts.get(session_id)
        if fields is None:
            return page("This checkout has expired", "<p>Start again from SelectaDJ.</p>", 404)
        name, interval = price_text(fields["price_id"])
        action = f"{PREFIX}/checkout/{escape(session_id)}"
        return page(
            f"Pretend checkout: {name}",
            f"""<p>SelectaDJ {escape(name)}, billed {escape(interval)}. No money moves and no
card is asked for: this page stands in for Stripe Checkout on this computer.</p>
<form method="post" action="{action}/pay"><button class="primary">Pay with a test card</button>
</form>
<form method="post" action="{action}/decline"><button class="danger">Use a declined card
</button></form>
<p><a href="{escape(same_site(fields['cancel_url']))}">Cancel and return to SelectaDJ</a></p>""",
            ribbon="Pretend Stripe checkout for local development. No real payment is made.",
        )

    @app.post(PREFIX + "/checkout/{session_id}/pay", include_in_schema=False)
    def pay(session_id: str):
        fields = checkouts.get(session_id)
        if fields is None:
            return page("This checkout has expired", "<p>Start again from SelectaDJ.</p>", 404)
        price = PRICES[fields["price_id"]]
        workspace_id = fields["workspace_id"]
        with transaction(engine, workspace_id) as conn:
            now = db_now(conn)
            decision = stripe_sync.SnapshotDecision(
                plan_id=price["plan"],
                plan_version=price["version"],
                source=stripe_sync.SnapshotSource.STRIPE,
                reason="active",
                subscription_id=f"sub_{session_id}",
                valid_until=now + (31 if price["interval"] == "month" else 366) * 86_400,
            )
            stripe_sync.write_snapshot(conn, workspace_id, decision, now)
            quota.set_limit(conn, workspace_id, plan_for(price["plan"]))
        target = same_site(fields["success_url"].replace("{CHECKOUT_SESSION_ID}", session_id))
        return RedirectResponse(target, status_code=303)

    @app.post(PREFIX + "/checkout/{session_id}/decline", include_in_schema=False)
    def decline(session_id: str):
        fields = checkouts.get(session_id)
        if fields is None:
            return page("This checkout has expired", "<p>Start again from SelectaDJ.</p>", 404)
        return page(
            "Your card was declined",
            "<p class='problem' role='alert'>The test card was declined, as a real card can be. "
            "Your plan hasn't changed.</p>"
            f"<p class='row'><a class='button primary' href='{PREFIX}/checkout/"
            f"{escape(session_id)}'>Try again</a>"
            f"<a class='button' href='{escape(same_site(fields['cancel_url']))}'>"
            "Return to SelectaDJ</a></p>",
            status=402,
            ribbon="Pretend Stripe checkout for local development. No real payment is made.",
        )

    @app.get(PREFIX + "/portal", include_in_schema=False)
    def portal(back: str = "/account/billing", customer: str = ""):
        return page(
            "Pretend billing portal",
            "<p>Manage the pretend subscription for this local account.</p>"
            f"<form method='post' action='{PREFIX}/portal/cancel'>"
            f"<input type='hidden' name='back' value='{escape(same_site(back))}'>"
            f"<input type='hidden' name='customer' value='{escape(customer)}'>"
            "<button class='danger'>Cancel subscription now</button></form>"
            f"<p><a href='{escape(same_site(back))}'>Return to SelectaDJ</a></p>",
            ribbon="Pretend Stripe portal for local development.",
        )

    @app.post(PREFIX + "/portal/cancel", include_in_schema=False)
    async def cancel(request: Request):
        fields = {
            name: values[0]
            for name, values in parse_qs((await request.body()).decode()).items()
        }
        with transaction(engine) as conn:
            workspace_id = conn.execute(
                select(stripe_customers.c.workspace_id).where(
                    stripe_customers.c.stripe_customer_id == fields.get("customer", "")
                )
            ).scalar_one_or_none()
        if workspace_id is not None:
            with transaction(engine, workspace_id) as conn:
                free = stripe_sync.SnapshotDecision(
                    "free", None, stripe_sync.SnapshotSource.DEFAULT, "canceled", None
                )
                stripe_sync.write_snapshot(conn, workspace_id, free, db_now(conn))
                quota.set_limit(conn, workspace_id, plan_for("free"))
        return RedirectResponse(same_site(fields.get("back", "/account/billing")), 303)

    return DevStripe


__all__ = ["CONSENT", "PREFIX", "PRICES", "environment", "install"]
