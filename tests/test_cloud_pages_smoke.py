"""Read-only post-publish Cloudflare Pages deep-link smoke checks."""

from __future__ import annotations

import sys
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "infra" / "deploy"))
import smoke  # noqa: E402


def test_pages_smoke_checks_dedicated_entries_and_rejects_spa_fallback():
    entries = {
        "/r/K7QDM2XP": "guest",
        "/display": "display",
        "/kiosk": "kiosk",
    }

    def respond(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/ready":
            return httpx.Response(200, json={"status": "ready"})
        if request.url.host != "web.test":
            return httpx.Response(401)
        entry = entries.get(request.url.path)
        return httpx.Response(200, text=f'<html><main id="{entry}"></main></html>',
                              headers={"content-type": "text/html"})

    transport = httpx.MockTransport(respond)
    results = smoke.run("https://api.test", "https://gateway.test",
                        web="https://web.test", transport=transport)
    assert len(results) == 7
    assert all(result.ok for result in results)

    def fallback(request: httpx.Request) -> httpx.Response:
        if request.url.host == "web.test":
            return httpx.Response(200, text='<html><div id="root"></div></html>',
                                  headers={"content-type": "text/html"})
        return respond(request)

    failed = smoke.run("https://api.test", "https://gateway.test",
                       web="https://web.test", transport=httpx.MockTransport(fallback))
    assert [check.ok for check in failed[-3:]] == [False, False, False]

def test_pages_smoke_rejects_html_canonical_redirect_and_reports_destination():
    def respond(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/ready":
            return httpx.Response(200, json={"status": "ready"})
        if request.url.host != "web.test":
            return httpx.Response(401)
        if request.url.path.startswith("/r/"):
            return httpx.Response(301, headers={"location": "/guest"})
        entry = "display" if request.url.path == "/display" else "kiosk"
        return httpx.Response(200, text=f'<main id="{entry}"></main>',
                              headers={"content-type": "text/html"})

    results = smoke.run("https://api.test", "https://gateway.test",
                        web="https://web.test", transport=httpx.MockTransport(respond))
    assert [result.ok for result in results[-3:]] == [False, True, True]
    assert results[-3].detail == "HTTP 301 -> /guest"
