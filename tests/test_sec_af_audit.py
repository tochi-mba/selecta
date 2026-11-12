"""Security audit regressions for AI, outbound fetchers and secret/error leaks (SEC-AF, rc-saf)."""

from __future__ import annotations

import asyncio

from test_cloud_auth import world  # noqa: F401

from selecta.identity.routes import MAX_WEBHOOK_BYTES


def test_sec_af_1_an_oversized_workos_webhook_is_refused_without_buffering_it(
    world,  # noqa: F811
):
    """Unauthenticated: a huge body must be cut off once it passes the limit, not read whole
    into memory before the size check (and before the signature is even looked at). Driven
    over raw ASGI so we count what the app itself pulls (TestClient drains the body anyway)."""
    chunk = b"x" * 65_536
    total = (MAX_WEBHOOK_BYTES // len(chunk)) * 20
    pulled = 0
    sent: list[dict] = []

    async def receive():
        nonlocal pulled
        pulled += 1
        return {"type": "http.request", "body": chunk, "more_body": pulled < total}

    async def send(message):
        sent.append(message)

    scope = {
        "type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1", "method": "POST",
        "scheme": "http", "path": "/api/webhooks/workos", "raw_path": b"/api/webhooks/workos",
        "query_string": b"", "root_path": "", "client": ("127.0.0.1", 1),
        "server": ("testserver", 80),
        "headers": [(b"host", b"testserver"), (b"workos-signature", b"t=1,v1=00")],
    }
    asyncio.run(world.http.app(scope, receive, send))

    assert sent[0]["status"] == 413
    assert pulled * len(chunk) <= MAX_WEBHOOK_BYTES + 2 * len(chunk)


def test_sec_af_1_a_declared_oversized_workos_webhook_is_refused_up_front(
    world,  # noqa: F811
):
    answer = world.http.post(
        "/api/webhooks/workos", content=b"{}",
        headers={"WorkOS-Signature": "t=1,v1=00", "Content-Length": str(MAX_WEBHOOK_BYTES + 1)},
    )
    assert answer.status_code == 413
