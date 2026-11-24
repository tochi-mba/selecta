"""The Stripe webhook does its blocking work off the event loop.

Storing the event, asking Stripe for the subscription (up to 20 seconds) and writing the
entitlement are all blocking calls. Run inside the `async` handler they held the event loop,
so every other request and every open event stream on that worker stalled until Stripe
answered. The WorkOS webhook already hands its work to a worker thread; this one does too."""

# ruff: noqa: F811 -- imported pytest fixtures are intentionally requested by test arguments.

from __future__ import annotations

import asyncio

from test_cloud_billing_api import client, post_event, stripe  # noqa: F401
from test_cloud_billing_fakes import event, subscription

from selecta.billing import api as billing_api


def test_the_webhook_stores_and_processes_off_the_event_loop(client, stripe, monkeypatch):
    seen: dict[str, bool] = {}

    def on_loop() -> bool:
        try:
            asyncio.get_running_loop()
        except RuntimeError:
            return False
        return True

    store, process = billing_api.store_event, billing_api.process_event

    def storing(*args, **kwargs):
        seen["store"] = on_loop()
        return store(*args, **kwargs)

    def processing(*args, **kwargs):
        seen["process"] = on_loop()
        return process(*args, **kwargs)

    monkeypatch.setattr(billing_api, "store_event", storing)
    monkeypatch.setattr(billing_api, "process_event", processing)
    stripe.put(subscription(price="price_premium_month"))

    answer = post_event(
        client, event("evt_thread", "customer.subscription.updated", subscription())
    )

    assert answer.status_code == 200 and answer.json()["status"] == "processed"
    assert seen == {"store": False, "process": False}
