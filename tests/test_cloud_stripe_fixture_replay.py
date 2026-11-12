"""The Stripe fixture replay tool, against the real webhook route (SC-0403-01).

`tests/load/stripe_fixture_replay.py` is what the staging run uses to send captured Stripe CLI
events at staging, scrambled and duplicated. Here it runs against the webhook route on a bare
app with the fake Stripe, over a capture in the CLI's `--print-json` shape
(`tests/fixtures/stripe_cli_events.jsonl`): every signature verifies, every repeat is a
duplicate, any order ends at what Stripe says now, and an outage is caught up by the retry drain.
The run against Stripe test mode itself still needs the staging account.
"""

# ruff: noqa: F811 -- imported pytest fixtures are intentionally requested by test arguments.

from __future__ import annotations

import io
import json
import sys
from pathlib import Path

import httpx
import pytest
import sqlalchemy as sa
from test_cloud_billing_api import client, stripe  # noqa: F401
from test_cloud_billing_fakes import PRICE_MAP, WEBHOOK_SECRET, subscription

from selecta.billing.maintenance import drain_stripe_events
from selecta.billing.schema import stripe_events
from selecta.billing.stripe_sync import current_snapshot
from selecta.billing.webhooks import verify_signature
from selecta.persistence import transaction

sys.path.insert(0, str(Path(__file__).parent / "load"))
import stripe_fixture_replay as tool  # noqa: E402

CAPTURE = Path(__file__).parent / "fixtures" / "stripe_cli_events.jsonl"
URL = "/api/webhooks/stripe"


def stored(engine) -> dict[str, str]:
    with transaction(engine) as conn:
        return dict(conn.execute(sa.select(stripe_events.c.id, stripe_events.c.status)).tuples())


def plan_id(engine) -> str:
    with transaction(engine) as conn:
        return current_snapshot(conn, "w1").plan_id


def test_the_capture_loads_only_stripe_events_once_each_in_file_order():
    events = tool.load_events(CAPTURE)
    assert [item["id"] for item in events] == [f"evt_cli_{n}" for n in range(1, 6)]


def test_the_tool_signs_the_way_the_endpoint_verifies():
    raw = b'{"id":"evt_x"}'
    header = tool.sign(raw, WEBHOOK_SECRET, 1_800_000_000)
    assert verify_signature(raw, header, (WEBHOOK_SECRET,), now=1_800_000_010) == 1_800_000_000


def test_the_plan_repeats_each_event_and_a_seed_fixes_the_shuffle():
    events = tool.load_events(CAPTURE)
    shuffled = tool.plan(events, order="shuffled", copies=3, seed=7)
    assert len(shuffled) == 15
    assert [e["id"] for e in shuffled] == [
        e["id"] for e in tool.plan(events, order="shuffled", copies=3, seed=7)
    ]
    assert tool.plan(events, order="reversed", copies=1, seed=0)[0]["id"] == "evt_cli_5"
    with pytest.raises(ValueError):
        tool.plan(events, order="sideways", copies=1, seed=0)
    with pytest.raises(ValueError):
        tool.plan(events, order="captured", copies=0, seed=0)


@pytest.mark.parametrize(
    "order,seed",
    [("captured", 0), ("reversed", 0), ("shuffled", 1), ("shuffled", 2), ("shuffled", 3)],
)
def test_any_order_and_repeats_end_at_what_stripe_says_now(
    client, stripe, cloud_engine, order, seed
):
    stripe.put(subscription(price="price_premium_month"))  # Stripe's state after the capture
    deliveries = tool.plan(tool.load_events(CAPTURE), order=order, copies=3, seed=seed)

    report = tool.replay(deliveries, url=URL, secret=WEBHOOK_SECRET, post=client.post)

    assert report.ok(), report.as_dict()
    assert report.statuses == {"200": 15}
    assert report.outcomes["ignored"] == 3  # product.created is stored and ignored
    assert plan_id(cloud_engine) == "premium"
    assert set(stored(cloud_engine)) == {f"evt_cli_{n}" for n in range(1, 6)}
    assert set(stored(cloud_engine).values()) <= {"processed", "ignored"}

    # A second pass is all duplicates, and says so unless told it's expected.
    again = tool.replay(deliveries[:5], url=URL, secret=WEBHOOK_SECRET, post=client.post)
    assert not again.ok() and again.ok(allow_seen=True)
    assert plan_id(cloud_engine) == "premium"


def test_events_received_during_a_stripe_outage_are_caught_up_by_the_retry_drain(
    client, stripe, cloud_engine
):
    stripe.put(subscription(price="price_premium_month"))
    stripe.down = True
    deliveries = tool.plan(tool.load_events(CAPTURE), order="shuffled", copies=2, seed=4)

    report = tool.replay(deliveries, url=URL, secret=WEBHOOK_SECRET, post=client.post)

    assert report.ok() and report.outcomes["failed"] >= 4
    assert {status for status in stored(cloud_engine).values()} == {"failed", "ignored"}
    stripe.down = False
    result = drain_stripe_events(cloud_engine, stripe, PRICE_MAP)
    assert result.processed == 4 and result.errors == 0
    assert set(stored(cloud_engine).values()) == {"processed", "ignored"}
    assert plan_id(cloud_engine) == "premium"
    assert drain_stripe_events(cloud_engine, stripe, PRICE_MAP).selected == 0


def test_a_wrong_secret_is_refused_and_5xx_answers_are_retried_then_reported(
    client, stripe, cloud_engine
):
    events = tool.load_events(CAPTURE)[:2]
    forged = tool.replay(events, url=URL, secret="whsec_wrong", post=client.post)
    assert forged.refused == ["evt_cli_1", "evt_cli_2"] and stored(cloud_engine) == {}

    answers = iter([httpx.Response(503), httpx.Response(200, json={"status": "processed"})])
    naps: list[float] = []
    flaky = tool.replay(
        events[:1],
        url=URL,
        secret=WEBHOOK_SECRET,
        post=lambda *a, **k: next(answers),
        sleep=naps.append,
    )
    assert flaky.ok() and flaky.retries == 1 and naps == [1.0]

    def unreachable(*args, **kwargs):
        raise httpx.ConnectError("no route")

    down = tool.replay(
        events[:1], url=URL, secret=WEBHOOK_SECRET, post=unreachable, attempts=3, sleep=naps.append
    )
    assert down.gave_up == ["evt_cli_1"] and down.retries == 2 and not down.ok()


def test_the_command_line_refuses_production_and_prints_the_capture_commands(
    client, stripe, monkeypatch
):
    out = io.StringIO()
    assert (
        tool.main(["--url", "https://api.staging.test/api/webhooks/stripe", "--print-cli"], out=out)
        == 0
    )
    assert "stripe listen --forward-to https://api.staging.test" in out.getvalue()
    assert "stripe trigger customer.subscription.updated" in out.getvalue()

    monkeypatch.setenv("SELECTA_STRIPE_WEBHOOK_SECRET", WEBHOOK_SECRET)
    with pytest.raises(SystemExit):
        tool.main(
            ["--url", "https://api.selecta.app/api/webhooks/stripe", "--events", str(CAPTURE)]
        )
    monkeypatch.setenv("SELECTA_STRIPE_WEBHOOK_SECRET", "sk_live_nope")
    with pytest.raises(SystemExit):
        tool.main(["--url", "http://localhost/api/webhooks/stripe", "--events", str(CAPTURE)])

    monkeypatch.setenv("SELECTA_STRIPE_WEBHOOK_SECRET", WEBHOOK_SECRET)
    stripe.put(subscription(price="price_standard_month"))
    out = io.StringIO()
    code = tool.main(
        [
            "--url",
            "http://localhost/api/webhooks/stripe",
            "--events",
            str(CAPTURE),
            "--copies",
            "2",
            "--seed",
            "5",
        ],
        post=lambda url, **kw: client.post(URL, **kw),
        out=out,
    )
    assert code == 0, out.getvalue()
    assert json.loads(out.getvalue())["deliveries"] == 10
