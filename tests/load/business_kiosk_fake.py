"""An in-process fake venue server for the business kiosk simulator (ADR-0454 BZ-0454-06).

`FakeVenueServer` answers the kiosk routes `business_kiosk_sim.ROUTES` names with the contract
the simulator expects (pairing by code with a P-256 key, signed nonces, a 20 s speaker lease,
bundles of opening windows, billing stops, rule snapshots and volume caps, horizon manifests,
idempotent play-log upload and staff zone commands), on the simulator's clock. It holds no audio
and no database: it exists so the scaled-down stress scenarios (`business_scenarios.py`) and the
unit tests can run 1,000 kiosks in one process. Full-size runs talk to staging through
`HttpTransport` instead; nothing here stands in for the product's own tests.

`FakeTransport` wraps it: it raises `TransportDown` while the API is down (an outage), admits
resyncs at a paced rate (503 with `retry_after_s` beyond it, like the real reconnect admission),
and models latency from the load in the current second so p95 thresholds mean something.
"""

from __future__ import annotations

import hashlib
import random
import secrets
from collections import defaultdict
from collections.abc import Iterable
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import parse_qs, urlsplit

from business_kiosk_support import (
    KIOSK_COOKIE,
    Answer,
    LatencyBook,
    TransportDown,
    dt,
    from_iso,
    iso,
    load_public_jwk,
    verify_signature,
)

from selecta.audit.business_trace import BusinessTrace, OpenWindow, PlayLogRow

LEASE_S = 20.0
LIBRARY = 600
SONG_BYTES_PER_S = 40_000  # 320 kbit/s
HORIZON_BATCH = 90  # about 5 hours of songs per manifest


@dataclass
class FakeZone:
    zone_id: str
    venue_id: str
    holder: str | None = None
    lease_expires: float = 0.0
    previous: set[str] = field(default_factory=set)
    position_seq: int = 0
    bundle_version: int = 1
    snapshot_id: str = "snap-0"
    refused: frozenset[str] = frozenset()
    volume: float = 0.7
    cap: float = 1.0
    pending: dict[str, list[dict]] = field(default_factory=lambda: defaultdict(list))
    applied_commands: list[str] = field(default_factory=list)


@dataclass
class FakeVenue:
    venue_id: str
    org_id: str
    windows: list[tuple[float, float | None]] = field(default_factory=list)
    stop_at: float | None = None
    schedule_version: int = 1
    zones: list[str] = field(default_factory=list)


@dataclass
class FakeDevice:
    device_id: str
    token: str
    zone_id: str
    role: str
    jwk: dict[str, str]
    machine_id: str
    nonce: str = ""
    acked_seq: int = 0
    revoked: bool = False


def song_for(zone_id: str, seq: int) -> tuple[str, float]:
    """A deterministic song id and length (150 to 270 s) for a zone's horizon slot."""
    digest = hashlib.sha256(f"{zone_id}:{seq}".encode()).digest()
    return f"song-{int.from_bytes(digest[:4], 'big') % LIBRARY}", 150.0 + digest[4] % 121


class FakeVenueServer:
    """The kiosk side of a venue server, in memory. `t()` is the shared clock."""

    def __init__(self, clock: Any, trace: BusinessTrace, *, verify_every: int = 1) -> None:
        self.clock = clock
        self.trace = trace
        self.verify_every = max(1, verify_every)
        self.venues: dict[str, FakeVenue] = {}
        self.zones: dict[str, FakeZone] = {}
        self.devices: dict[str, FakeDevice] = {}
        self.by_token: dict[str, str] = {}
        self.pairings: dict[str, dict[str, Any]] = {}
        self.codes: dict[str, str] = {}
        self.managers: dict[str, str] = {}  # bearer -> org id
        self.play_log: dict[str, dict[str, Any]] = {}
        self.play_ids: set[str] = set()
        self.duplicates_refused = 0
        self.beats = 0
        self.rng = random.Random(7)

    # ---------------------------------------------------------------- the world

    def add_venue(self, org_id: str, venue_id: str, zones: Iterable[str],
                  windows: Iterable[tuple[float, float | None]] = ()) -> FakeVenue:
        venue = FakeVenue(venue_id, org_id, list(windows))
        for zone_id in zones:
            venue.zones.append(zone_id)
            self.zones[zone_id] = FakeZone(zone_id, venue_id)
            self.trace.zone_venues[zone_id] = venue_id
        self.venues[venue_id] = venue
        self.trace.venue_orgs[venue_id] = org_id
        for opens, closes in venue.windows:
            closing = dt(closes) if closes else None
            self.trace.windows.append(OpenWindow(venue_id, dt(opens), closing))
        return venue

    def manager_token(self, org_id: str) -> str:
        token = f"mgr-{org_id}"
        self.managers[token] = org_id
        return token

    def _bump(self, venue: FakeVenue) -> None:
        for zone_id in venue.zones:
            self.zones[zone_id].bundle_version += 1

    def set_stop(self, venue_id: str, stop_at: float | None) -> None:
        venue = self.venues[venue_id]
        venue.stop_at = stop_at
        self._bump(venue)

    def set_rules(self, zone_ids: Iterable[str], snapshot_id: str, refused: Iterable[str]) -> None:
        for zone_id in zone_ids:
            zone = self.zones[zone_id]
            zone.snapshot_id, zone.refused = snapshot_id, frozenset(refused)
            zone.bundle_version += 1

    def set_schedule(self, venue_id: str, version: int) -> None:
        venue = self.venues[venue_id]
        venue.schedule_version = version
        self._bump(venue)

    def set_cap(self, zone_id: str, cap: float) -> None:
        zone = self.zones[zone_id]
        zone.cap = cap
        zone.bundle_version += 1

    # ---------------------------------------------------------------- routing

    def handle(self, method: str, path: str, body: Any, bearer: str | None,
               cookie: str | None) -> Answer:
        parts = urlsplit(path)
        query = {k: v[0] for k, v in parse_qs(parts.query).items()}
        route = parts.path
        if route == "/api/kiosk/pairings" and method == "POST":
            return self._start_pairing(body)
        if route == "/api/kiosk/pair" and method == "POST":
            return self._pair(body, bearer)
        if route == "/api/kiosk/pairings/status":
            return self._status(query.get("pairing_id", ""))
        if route.startswith("/api/zones/") and route.endswith("/playback/commands"):
            return self._command(route.split("/")[3], body, bearer)
        device = self.devices.get(self.by_token.get(cookie or "", ""))
        if device is None or device.revoked:
            return Answer(401, {"error": "kiosk_revoked"}, 0)
        if route == "/api/kiosk/heartbeat":
            return self._heartbeat(device, body)
        if route == "/api/kiosk/resync":
            return self._heartbeat(device, body, resync=True)
        if route == "/api/kiosk/horizon":
            return self._horizon(device, int(query.get("after_seq", -1)))
        if route == "/api/kiosk/health":
            return Answer(204, {}, 0)
        if route == "/api/kiosk/view":
            zone = self.zones[device.zone_id]
            return Answer(200, {"zone": zone.zone_id, "state": "playing",
                                "now_playing": {"title": "Song", "artist": "Artist"}}, 0)
        return Answer(404, {"error": "not_found"}, 0)

    # ---------------------------------------------------------------- pairing

    def _start_pairing(self, body: dict[str, Any]) -> Answer:
        pairing_id = secrets.token_hex(8)
        code = f"{self.rng.randrange(10**8):08d}"
        self.pairings[pairing_id] = {"jwk": body["public_key"], "machine_id": body["machine_id"]}
        self.codes[code] = pairing_id
        return Answer(201, {"code": code, "pairing_id": pairing_id}, 0)

    def _pair(self, body: dict[str, Any], bearer: str | None) -> Answer:
        org_id = self.managers.get(bearer or "")
        pairing_id = self.codes.pop(body.get("code", ""), None)
        zone = self.zones.get(body.get("zone_id", ""))
        if org_id is None or pairing_id is None or zone is None:
            return Answer(403, {"error": "pairing_refused"}, 0)
        if self.venues[zone.venue_id].org_id != org_id:
            return Answer(404, {"error": "not_found"}, 0)
        pending = self.pairings[pairing_id]
        device_id = f"dev-{secrets.token_hex(6)}"
        token = secrets.token_hex(16)
        self.devices[device_id] = FakeDevice(device_id, token, zone.zone_id,
                                             body.get("role", "home"), pending["jwk"],
                                             pending["machine_id"], nonce=secrets.token_hex(8))
        self.by_token[token] = device_id
        pending["device_id"] = device_id
        return Answer(201, {"device_id": device_id}, 0)

    def _status(self, pairing_id: str) -> Answer:
        pending = self.pairings.get(pairing_id)
        if pending is None or "device_id" not in pending:
            return Answer(404, {"error": "not_paired"}, 0)
        device = self.devices[pending["device_id"]]
        return Answer(200, {"device_id": device.device_id, "nonce": device.nonce},
                      0, cookies={KIOSK_COOKIE: device.token})

    # ---------------------------------------------------------------- heartbeat and resync

    def _heartbeat(self, device: FakeDevice, body: dict[str, Any], *, resync: bool = False
                   ) -> Answer:
        now = self.clock.t()
        self.beats += 1
        signature = body.get("signature")
        if body.get("nonce") != device.nonce:
            return Answer(409, {"error": "stale_nonce"}, 0)
        must_verify = resync or self.beats % self.verify_every == 0
        if signature and must_verify and not verify_signature(
            load_public_jwk(device.jwk), device.nonce, signature
        ):
            return Answer(401, {"error": "kiosk_key_mismatch"}, 0)
        zone = self.zones[device.zone_id]
        venue = self.venues[zone.venue_id]
        self._ingest(device, venue, body.get("log") or ())
        lease = self._lease(device, zone, body, now)
        position = int((body.get("position") or {}).get("seq", 0))
        if lease == "held":
            zone.position_seq = max(zone.position_seq, position)
        device.nonce = secrets.token_hex(8)
        answer: dict[str, Any] = {
            "nonce": device.nonce,
            "server_time": iso(now),
            "lease": lease,
            "position_seq": zone.position_seq,
            "horizon_revision": zone.position_seq // 20,
            "acked_seq": device.acked_seq,
            "commands": zone.pending.pop(device.device_id, []),
        }
        if int(body.get("bundle_version", -1)) < zone.bundle_version:
            answer["bundle"] = {
                "version": zone.bundle_version,
                "windows": [[iso(o), iso(c) if c else None] for o, c in venue.windows],
                "stop_at": iso(venue.stop_at) if venue.stop_at else None,
                "snapshot": {"id": zone.snapshot_id, "refused": sorted(zone.refused)},
                "volume": zone.volume,
                "cap": zone.cap,
                "schedule_version": venue.schedule_version,
            }
        return Answer(200, answer, 0)

    def _lease(self, device: FakeDevice, zone: FakeZone, body: dict[str, Any], now: float) -> str:
        if body.get("release") and zone.holder == device.device_id:
            zone.holder, zone.lease_expires = None, 0.0
            return "remote"
        if not body.get("claim"):
            return "held" if zone.holder == device.device_id else "remote"
        if zone.holder in (None, device.device_id) or now >= zone.lease_expires:
            if zone.holder and zone.holder != device.device_id:
                zone.previous.add(zone.holder)
            zone.holder, zone.lease_expires = device.device_id, now + LEASE_S
            return "held"
        return "moved" if device.device_id in zone.previous else "remote"

    def _ingest(self, device: FakeDevice, venue: FakeVenue, entries: Iterable[dict]) -> None:
        for entry in entries:
            seq = int(entry.get("device_seq", 0))
            key = entry.get("idempotency_key") or f"{device.device_id}:{seq}"
            if entry.get("kind") not in ("play", "offline_fallback"):
                device.acked_seq = max(device.acked_seq, seq)
                continue
            if key in self.play_log or entry.get("play_id") in self.play_ids:
                self.duplicates_refused += 1
            else:
                row = {"play_id": entry.get("play_id"), "song_id": entry.get("song_id"),
                       "started": entry.get("started"), "venue_id": venue.venue_id,
                       "device_id": device.device_id}
                self.play_log[key] = row
                self.play_ids.add(row["play_id"])
                started = from_iso(entry.get("started")) or self.clock.t()
                self.trace.play_log.append(PlayLogRow(row["play_id"], venue.venue_id,
                                                      row["song_id"], dt(started)))
            device.acked_seq = max(device.acked_seq, seq)

    # ---------------------------------------------------------------- horizon and commands

    def _horizon(self, device: FakeDevice, after_seq: int) -> Answer:
        zone = self.zones[device.zone_id]
        first = after_seq + 1
        last = max(first, zone.position_seq) + HORIZON_BATCH
        entries = []
        for seq in range(first, last):
            song_id, length = song_for(zone.zone_id, seq)
            entries.append({"seq": seq, "song_id": song_id, "duration_s": length,
                            "bytes": int(length * SONG_BYTES_PER_S)})
        return Answer(200, {"entries": entries}, 0)

    def _command(self, zone_id: str, body: dict[str, Any], bearer: str | None) -> Answer:
        org_id = self.managers.get(bearer or "")
        zone = self.zones.get(zone_id)
        if org_id is None or zone is None or self.venues[zone.venue_id].org_id != org_id:
            return Answer(404, {"error": "not_found"}, 0)
        key = body.get("idempotency_key", "")
        if key in zone.applied_commands:
            return Answer(200, {"outcome": "applied", "duplicate": True}, 0)
        made_at = from_iso(body.get("made_at")) or self.clock.t()
        if self.clock.t() - made_at > 120:
            return Answer(409, {"outcome": "dropped", "reason": "too_old"}, 0)
        zone.applied_commands.append(key)
        if body.get("command") == "volume":
            zone.volume = float((body.get("args") or {}).get("level", zone.volume))
            zone.bundle_version += 1
        return Answer(200, {"outcome": "applied"}, 0)


class FakeTransport:
    """Calls into a `FakeVenueServer` with outages, paced resync admission and modeled latency."""

    def __init__(self, server: FakeVenueServer, *, base_ms: float = 12.0,
                 per_call_ms: float = 0.05, resyncs_per_s: int = 50) -> None:
        self.server = server
        self.latency = LatencyBook()
        self.base_ms = base_ms
        self.per_call_ms = per_call_ms
        self.resyncs_per_s = resyncs_per_s
        self.down: list[tuple[float, float]] = []
        self._second = -1
        self._calls = 0
        self._resyncs = 0
        self.peak_calls_per_s = 0
        self.refused_resyncs = 0

    def api_down(self, start: float, end: float) -> None:
        self.down.append((start, end))

    async def call(self, method: str, path: str, *, body: Any = None,
                   bearer: str | None = None, cookie: str | None = None,
                   label: str = "") -> Answer:
        now = self.server.clock.t()
        if any(start <= now < end for start, end in self.down):
            raise TransportDown("the API is down")
        second = int(now)
        if second != self._second:
            self._second, self._calls, self._resyncs = second, 0, 0
        self._calls += 1
        self.peak_calls_per_s = max(self.peak_calls_per_s, self._calls)
        if label == "resync":
            self._resyncs += 1
            if self._resyncs > self.resyncs_per_s:
                self.refused_resyncs += 1
                answer = Answer(503, {"retry_after_s": 5}, self.base_ms)
                self.latency.add(label, answer.ms, 503)
                return answer
        answer = self.server.handle(method, path, body, bearer, cookie)
        answer.ms = self.base_ms + self.per_call_ms * self._calls
        self.latency.add(label or path, answer.ms, answer.status)
        return answer

    async def control(self, name: str, body: dict[str, Any]) -> Answer:
        raise NotImplementedError("fake runs drive the server directly")

    async def aclose(self) -> None:
        return None
