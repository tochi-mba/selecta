"""Rooms and site security checks from the rc security audit (SEC-RX).

- SEC-RX-1: the Cloudflare brute-force rule for room joins names the route joins really use.
- SEC-RX-2: the deployed API reads the visitor's address from Cloudflare's header, so one
  address guessing codes is locked out without locking out every other guest.
- SEC-RX-3: a host can't try display pairing codes as fast as it likes.
- SEC-RX-4: the static site forbids framing and sniffing.
"""

# ruff: noqa: F811 -- imported pytest fixtures are intentionally requested by test arguments.

from __future__ import annotations

import re
from pathlib import Path

import yaml
from cloud_party import ALICE, auth, party  # noqa: F401

from selecta.rooms import limits
from selecta.rooms.api_common import CLIENT_IP_HEADER
from selecta.rooms.codes import generate

ROOT = Path(__file__).resolve().parents[1]


def _route_paths(app) -> set[str]:
    return {getattr(route, "path", "") for route in app.routes}


def test_sec_rx_1_edge_join_rule_matches_the_real_join_route(party):
    tofu = (ROOT / "infra" / "cloudflare" / "main.tf").read_text("utf-8")
    block = tofu.split('"Room joins: brute-force protection"', 1)[1].split("ratelimit", 1)[0]
    paths = re.findall(r'\\"(/api/[^\\"]+)\\"', block)
    assert paths, block
    routes = _route_paths(party.app)
    assert all(path in routes for path in paths), (paths, "join is /api/guest/join")


def _deployed_ip_header() -> str | None:
    blueprint = yaml.safe_load((ROOT / "infra" / "render" / "render.yaml").read_text("utf-8"))
    for group in blueprint["envVarGroups"]:
        if group["name"].endswith("-api"):
            for item in group["envVars"]:
                if item["key"] == CLIENT_IP_HEADER:
                    return item.get("value")
    return None


def test_sec_rx_2_one_guesser_does_not_lock_every_guest_out(party, monkeypatch):
    header = _deployed_ip_header()
    if header:
        monkeypatch.setenv(CLIENT_IP_HEADER, header)
    else:
        monkeypatch.delenv(CLIENT_IP_HEADER, raising=False)
    code = party.open_room(ALICE)["code"]
    attacker = party.guest_client()
    for _ in range(limits.GUESSES_PER_IP.limit):
        guess = generate()
        attacker.post("/api/guest/join", json={"code": guess},
                      headers={"cf-connecting-ip": "203.0.113.66"})
    assert attacker.post("/api/guest/join", json={"code": code},
                         headers={"cf-connecting-ip": "203.0.113.66"}).status_code == 429
    party_guest = party.guest_client()
    answer = party_guest.post("/api/guest/join", json={"code": code},
                              headers={"cf-connecting-ip": "198.51.100.7"})
    assert answer.status_code == 201, answer.text


def test_sec_rx_3_host_pairing_code_guesses_are_rate_limited(party):
    room_id = party.open_room(ALICE)["room"]["id"]
    statuses = [
        party.client.post(
            f"/api/rooms/{room_id}/displays", headers=auth(ALICE),
            json={"pairing_code": generate(6)},
        ).status_code
        for _ in range(limits.DISPLAY_CONFIRM_PER_WORKSPACE.limit + 5)
    ]
    assert 429 in statuses, statuses
    assert statuses.index(429) == limits.DISPLAY_CONFIRM_PER_WORKSPACE.limit


def test_sec_rx_4_static_site_forbids_framing_and_sniffing():
    headers = (ROOT / "web" / "public" / "_headers").read_text("utf-8")
    assert "/*" in headers
    assert "frame-ancestors 'none'" in headers
    assert "X-Frame-Options: DENY" in headers
    assert "X-Content-Type-Options: nosniff" in headers
