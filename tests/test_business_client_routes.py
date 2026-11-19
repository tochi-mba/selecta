"""Every path the business web client calls is a route the Cloud server registers.

`web/src/business/client.ts`, `web/src/business/api.ts` and the zone playback calls Play here
uses (`web/src/devices/zonePlayback.ts`, `web/src/devices/useZoneSpeaker.ts`) build paths from
string literals. This reads every literal that starts with `/` (comments left out), treats each
`${...}` as any text within one path segment, drops the query string, and asserts the path
matches a mounted FastAPI route under `/api`. A client path with no server route (the old
`/orgs/...` calls) fails here, so the client and the server cannot drift apart again.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest
from cloud_helpers import make_cloud_app
from fastapi.routing import APIRoute

ROOT = Path(__file__).resolve().parents[1]
CLIENT_FILES = (
    "web/src/business/client.ts",
    "web/src/business/api.ts",
    "web/src/business/content/contentClient.ts",
    "web/src/business/rooms/roomsClient.ts",
    "web/src/devices/zonePlayback.ts",
    "web/src/devices/useZoneSpeaker.ts",
    "web/src/business/start/StartPage.tsx",
)
COMMENTS = re.compile(r"/\*.*?\*/|(?<![:'\"`])//[^\n]*", re.S)
SLOT = "\u0001"
NEWLINE = "\n"


def _literals(text: str):
    """Every quoted or template string, with each `${...}` (nested ones too) as one SLOT."""
    i = 0
    while i < len(text):
        quote = text[i]
        if quote not in "'`":
            i += 1
            continue
        i += 1
        out = []
        while i < len(text) and text[i] != quote:
            if quote == "`" and text.startswith("${", i):
                depth, i = 1, i + 2
                while i < len(text) and depth:
                    if text.startswith("${", i):
                        depth, i = depth + 1, i + 2
                        continue
                    depth += {"{": 1, "}": -1}.get(text[i], 0)
                    i += 1
                out.append(SLOT)
                continue
            if text[i] == NEWLINE and quote == "'":
                break
            out.append(text[i])
            i += 1
        i += 1
        yield "".join(out)


def client_paths(text: str) -> set[str]:
    """Each path as a regex: a slot matches any characters but `/` (possibly none)."""
    found = set()
    for raw in _literals(COMMENTS.sub("", text)):
        if not raw.startswith("/") or raw.startswith("//") or raw in ("/", "/api"):
            continue
        path = raw.split("?", 1)[0].split("#", 1)[0].rstrip("/")
        if not path or NEWLINE in path or " " in path:
            continue
        found.add("^" + re.escape(path).replace(re.escape(SLOT), "[^/?]*") + "$")
    return found


def route_paths(app) -> list[str]:
    return [
        route.path
        for route in app.routes
        if isinstance(route, APIRoute) and route.path.startswith("/api/")
    ]


def _answered(client: str, routes: list[str]) -> bool:
    wanted = re.compile(client.replace("^", "^/api", 1))
    return any(wanted.match(re.sub(r"\{[^}]+\}", "p", route)) for route in routes)


@pytest.fixture(scope="module")
def patterns(tmp_path_factory):
    app, engine, _ = make_cloud_app(tmp_path_factory.mktemp("routes"))
    try:
        yield route_paths(app)
    finally:
        engine.dispose()


def test_the_scanner_reads_template_paths():
    text = (
        "a: `/business/venues/${enc(v)}/hours`, b: '/workspaces', c: `/zones/${z}?device_id=${d}`,"
        " d: `/business/kiosks${venue ? `?venue_id=${enc(venue)}` : ''}` // `/not/a/path`"
    )
    routes = [
        "/api/business/venues/{venue_id}/hours",
        "/api/workspaces",
        "/api/zones/{zone_id}",
        "/api/business/kiosks",
    ]
    found = client_paths(text)
    assert len(found) == 4
    assert all(_answered(path, routes) for path in found)
    assert not _answered(next(iter(client_paths("'/orgs/x'"))), routes)


@pytest.mark.parametrize("name", CLIENT_FILES)
def test_every_client_path_is_a_server_route(patterns, name):
    paths = client_paths((ROOT / name).read_text(encoding="utf-8"))
    assert paths, f"{name} names no paths; the scanner is broken"
    missing = sorted(p for p in paths if not _answered(p, patterns))
    assert missing == [], f"{name} calls paths no server route answers: {missing}"
