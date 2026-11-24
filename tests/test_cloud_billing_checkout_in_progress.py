"""A second Checkout is refused while the first may already be paid for.

Coming back from Stripe, the workspace still reads as Free until the webhook lands. Pressing
Continue again in that window (or in a second tab) opened a second Checkout on the same
customer, and paying it made a second subscription. The server now refuses with
`checkout_in_progress` while this workspace has a Checkout from the last half hour that has
not become a subscription, from its own records and without asking Stripe about it."""

# ruff: noqa: F811 -- imported pytest fixtures are intentionally requested by test arguments.

from __future__ import annotations

import sqlalchemy as sa
from test_cloud_billing_api import ACCEPTED, checkout, client, rows, stripe  # noqa: F401

from selecta.billing import api as billing_api
from selecta.billing.schema import checkout_consents
from selecta.billing.stripe_sync import attach_consent
from selecta.persistence import transaction


def per_key_sessions(stripe):
    """Stripe gives one session per idempotency key, and the same one for the same key."""

    def create(**fields):
        stripe.posts.append(("checkout", fields))
        digest = fields["idempotency_key"][-12:]
        return {"id": f"cs_{digest}", "url": f"https://checkout.stripe.com/c/pay/cs_{digest}"}

    stripe.create_checkout_session = create


def test_a_second_checkout_is_refused_while_the_first_is_unconfirmed(
    client, stripe, cloud_engine
):
    per_key_sessions(stripe)
    first = checkout(client, key="press-1")
    assert first.status_code == 200, first.text

    second = checkout(client, key="press-2")

    assert second.status_code == 409
    assert second.json()["detail"] == {"code": "checkout_in_progress"}
    assert "url" not in second.json()
    assert len(rows(cloud_engine, checkout_consents)) == 1


def test_the_same_press_sent_again_gets_the_same_checkout_back(client, stripe, cloud_engine):
    per_key_sessions(stripe)
    first = checkout(client, key="press-1")
    again = checkout(client, key="press-1")

    assert again.status_code == 200
    assert again.json() == first.json()
    assert len(rows(cloud_engine, checkout_consents)) == 1


def test_a_cancelled_checkout_can_be_started_again_at_once(client, stripe, cloud_engine):
    per_key_sessions(stripe)
    assert checkout(client, key="press-1").status_code == 200

    again = checkout(client, body={**ACCEPTED, "after_cancel": True}, key="press-2")

    assert again.status_code == 200, again.text
    assert len(rows(cloud_engine, checkout_consents)) == 2


def test_an_old_or_finished_checkout_does_not_block_a_new_one(client, stripe, cloud_engine):
    per_key_sessions(stripe)
    first = checkout(client, key="press-1").json()
    with transaction(cloud_engine) as conn:
        conn.execute(
            sa.update(checkout_consents).values(
                accepted_at=checkout_consents.c.accepted_at
                - billing_api.CHECKOUT_IN_PROGRESS_SECONDS
                - 1
            )
        )
    assert checkout(client, key="press-2").status_code == 200

    with transaction(cloud_engine) as conn:
        conn.execute(sa.delete(checkout_consents))
    third = checkout(client, key="press-3").json()
    with transaction(cloud_engine) as conn:
        # the webhook linked it: from here the entitlement, not this guard, decides
        assert attach_consent(conn, third["session_id"], "sub_1") == 1
    assert first["session_id"] != third["session_id"]
    assert checkout(client, key="press-4").status_code == 200
