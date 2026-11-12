"""Replay captured Stripe events at a Selecta webhook, scrambled, for the staging run (SC-0403-01).

The staging check for ADR-0403 is: real Stripe test-mode events reach `POST /api/webhooks/stripe`,
their signatures verify, duplicates are ignored, and each is processed by re-fetching the current
state from Stripe. Stripe's own CLI sends each event once and in order. This tool takes events
captured from it and sends them again the way production will: shuffled, duplicated and retried,
each freshly signed with the staging webhook secret, then reports what the endpoint said.

Capture (Stripe CLI, test mode, against the staging account)::

    stripe listen --forward-to https://api.staging.example/api/webhooks/stripe --print-json \
        > stripe-events.jsonl
    stripe trigger checkout.session.completed
    stripe trigger customer.subscription.updated
    stripe trigger invoice.paid
    stripe trigger customer.subscription.deleted

Replay::

    SELECTA_STRIPE_WEBHOOK_SECRET=whsec_... python tests/load/stripe_fixture_replay.py \
        --url https://api.staging.example/api/webhooks/stripe --events stripe-events.jsonl \
        --order shuffled --copies 3 --seed 7

Because Selecta re-fetches every object from Stripe, replayed events must name objects that
exist in that Stripe account: capture and replay against the same test-mode account. The events
file may be JSON Lines (what `--print-json` writes), one JSON array, or a folder of `.json`
files. `--print-cli` prints the capture commands. The exit status is 0 only when every delivery
was finally answered 2xx and the first delivery of each event wasn't already a duplicate (unless
`--allow-seen`, for a second pass). Never point it at production: it refuses a `sk_live`/
`whsec` pair it can tell is live, and any URL without "staging", "test", "localhost" or
"127.0.0.1" in its host unless `--i-know-this-is-not-production` is given.
"""

from __future__ import annotations

import argparse
import hashlib
import hmac
import json
import os
import random
import sys
import time
from collections import Counter
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

import httpx

TRIGGERS = (
    "checkout.session.completed",
    "customer.subscription.created",
    "customer.subscription.updated",
    "invoice.paid",
    "invoice.payment_failed",
    "customer.subscription.deleted",
    "charge.refunded",
)
SAFE_HOST_WORDS = ("staging", "test", "localhost", "127.0.0.1")


def sign(payload: bytes, secret: str, timestamp: int) -> str:
    """The `Stripe-Signature` header Stripe would send for this body at this time."""
    digest = hmac.new(secret.encode(), f"{timestamp}.".encode() + payload, hashlib.sha256)
    return f"t={timestamp},v1={digest.hexdigest()}"


def load_events(source: Path) -> list[dict[str, Any]]:
    """Stripe events from JSON Lines, a JSON array, or a folder of .json files, in file order.
    Anything that isn't a Stripe event (the CLI's own log lines) is skipped."""
    if source.is_dir():
        texts = [path.read_text(encoding="utf-8") for path in sorted(source.glob("*.json"))]
        found = [json.loads(text) for text in texts]
    else:
        text = source.read_text(encoding="utf-8").strip()
        if text.startswith("["):
            found = json.loads(text)
        else:
            found = []
            for line in text.splitlines():
                line = line.strip()
                if not line.startswith("{"):
                    continue
                try:
                    found.append(json.loads(line))
                except json.JSONDecodeError:
                    continue
    events = [
        item
        for item in found
        if isinstance(item, dict)
        and item.get("object") == "event"
        and isinstance(item.get("id"), str)
        and isinstance(item.get("type"), str)
    ]
    seen: set[str] = set()
    unique = []
    for item in events:  # the capture may hold an event twice; the plan decides repeats
        if item["id"] not in seen:
            seen.add(item["id"])
            unique.append(item)
    return unique


def plan(events: list[dict[str, Any]], *, order: str, copies: int, seed: int) -> list[dict]:
    """The deliveries to make: each event `copies` times, in the chosen order."""
    if copies < 1:
        raise ValueError("copies must be at least 1")
    deliveries = [item for item in events for _ in range(copies)]
    if order == "shuffled":
        random.Random(seed).shuffle(deliveries)
    elif order == "reversed":
        deliveries.reverse()
    elif order != "captured":
        raise ValueError(f"unknown order {order!r}")
    return deliveries


@dataclass
class Report:
    deliveries: int = 0
    statuses: Counter = field(default_factory=Counter)
    outcomes: Counter = field(default_factory=Counter)
    retries: int = 0
    refused: list[str] = field(default_factory=list)  # event ids answered 4xx
    gave_up: list[str] = field(default_factory=list)  # event ids still failing after retries
    seen_before: list[str] = field(default_factory=list)  # first delivery already a duplicate

    def ok(self, *, allow_seen: bool = False) -> bool:
        return not self.refused and not self.gave_up and (allow_seen or not self.seen_before)

    def as_dict(self) -> dict[str, Any]:
        return {
            "deliveries": self.deliveries,
            "statuses": dict(self.statuses),
            "outcomes": dict(self.outcomes),
            "retries": self.retries,
            "refused": self.refused,
            "gave_up": self.gave_up,
            "seen_before": self.seen_before,
        }


def replay(
    deliveries: Iterable[dict[str, Any]],
    *,
    url: str,
    secret: str,
    post: Callable[..., httpx.Response],
    attempts: int = 4,
    backoff_s: float = 1.0,
    sleep: Callable[[float], None] = time.sleep,
    clock: Callable[[], float] = time.time,
) -> Report:
    """Send each delivery, signed now, retrying 5xx and network errors as Stripe does."""
    report = Report()
    first_seen: set[str] = set()
    for item in deliveries:
        report.deliveries += 1
        raw = json.dumps(item, separators=(",", ":")).encode()
        answer: httpx.Response | None = None
        for attempt in range(attempts):
            headers = {
                "Stripe-Signature": sign(raw, secret, int(clock())),
                "Content-Type": "application/json",
            }
            try:
                answer = post(url, content=raw, headers=headers)
            except httpx.TransportError:
                answer = None
            if answer is not None and answer.status_code < 500:
                break
            if attempt + 1 < attempts:
                report.retries += 1
                sleep(backoff_s * 2**attempt)
        if answer is None:
            report.statuses["network_error"] += 1
            report.gave_up.append(item["id"])
            continue
        report.statuses[str(answer.status_code)] += 1
        if answer.status_code >= 500:
            report.gave_up.append(item["id"])
        elif answer.status_code >= 400:
            report.refused.append(item["id"])
        else:
            body = answer.json() if answer.content else {}
            report.outcomes[str(body.get("status", "unknown"))] += 1
            if item["id"] not in first_seen and body.get("duplicate") is True:
                report.seen_before.append(item["id"])
        first_seen.add(item["id"])
    return report


def cli_commands(url: str) -> list[str]:
    return [
        f"stripe listen --forward-to {url} --print-json > stripe-events.jsonl",
        *(f"stripe trigger {name}" for name in TRIGGERS),
    ]


def refuse_production(url: str, secret: str, forced: bool) -> str | None:
    host = (urlsplit(url).hostname or "").lower()
    if secret.startswith(("sk_live", "rk_live")):
        return "that is a live API key, not a webhook signing secret"
    if not forced and not any(word in host for word in SAFE_HOST_WORDS):
        return (
            f"{host or url!r} doesn't look like staging; pass "
            "--i-know-this-is-not-production to send anyway"
        )
    return None


def main(
    argv: list[str] | None = None,
    *,
    post: Callable[..., httpx.Response] | None = None,
    out=sys.stdout,
) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--url", required=True)
    parser.add_argument("--events", type=Path)
    parser.add_argument("--order", choices=("captured", "shuffled", "reversed"), default="shuffled")
    parser.add_argument("--copies", type=int, default=2)
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--attempts", type=int, default=4)
    parser.add_argument("--backoff", type=float, default=1.0)
    parser.add_argument("--allow-seen", action="store_true")
    parser.add_argument("--print-cli", action="store_true")
    parser.add_argument("--i-know-this-is-not-production", dest="forced", action="store_true")
    args = parser.parse_args(argv)
    if args.print_cli:
        print("\n".join(cli_commands(args.url)), file=out)
        return 0
    if args.events is None:
        parser.error("--events is required unless --print-cli is given")
    secret = os.environ.get("SELECTA_STRIPE_WEBHOOK_SECRET", "").strip()
    if not secret:
        parser.error("set SELECTA_STRIPE_WEBHOOK_SECRET to the staging endpoint's signing secret")
    problem = refuse_production(args.url, secret, args.forced)
    if problem:
        parser.error(problem)
    events = load_events(args.events)
    if not events:
        parser.error(f"no Stripe events found in {args.events}")
    deliveries = plan(events, order=args.order, copies=args.copies, seed=args.seed)
    if post is None:
        client = httpx.Client(timeout=30.0)
        post = client.post
    report = replay(
        deliveries,
        url=args.url,
        secret=secret,
        post=post,
        attempts=args.attempts,
        backoff_s=args.backoff,
    )
    print(json.dumps({"events": len(events), **report.as_dict()}, indent=2), file=out)
    return 0 if report.ok(allow_seen=args.allow_seen) else 1


if __name__ == "__main__":
    raise SystemExit(main())
