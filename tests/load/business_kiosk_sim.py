"""Simulated kiosk players for the business stress scenarios (ADR-0454 BZ-0454-06).

A simulated kiosk is a lightweight client that does what a venue's player page does, without
audio: it pairs by code with an ECDSA P-256 device key (ADR-0445), heartbeats every 5 s while its
venue is in service (warming or open; every 60 s while closed), signs each server nonce, holds or
loses its zone's speaker lease (ADR-0443), downloads horizon manifests (entries and byte counts,
never audio) at its own bandwidth into a capped cache (ADR-0446), plays the horizon on a virtual
clock, goes offline when its network or the API does, keeps playing saved music (then the
fallback reel), and reports plays through its device log, uploaded exactly once on reconnect.
`StaffRemote` is a staff tablet that queues commands while offline and drops those older than
2 minutes (ADR-0446, ADR-0453 D10).

Every kiosk records what it observes into a shared `selecta.audit.business_trace.BusinessTrace`
(audio spans, lease spans, plays, horizon, volume, kiosk payloads, billing stops) so that
`selecta.audit.business_invariants.check_trace` can judge B1 to B9 after the run.

Kiosks talk to a pluggable transport with one method, `call(method, path, ...)`:
- `HttpTransport` (httpx) speaks to a real server: the business routes in `ROUTES`;
- `FakeTransport` (`business_kiosk_fake.py`, also importable from here) is an in-process fake
  venue server, for unit tests and `--fake` scenario runs.

Time comes from a clock: `VirtualClock` runs 1,000 kiosks through hours of venue time in
seconds (the clock only moves when every kiosk is waiting on it), `RealClock` is wall time for
staging runs.

Contract assumptions (the final pass checks these against the product; ADR names win):
- Routes from ADR-0445 / ADR-0446 / ADR-0443 as written: `POST /api/kiosk/pairings`,
  `GET /api/kiosk/pairings/status`, `POST /api/kiosk/pair`, `POST /api/kiosk/heartbeat`,
  `POST /api/kiosk/health`, `GET /api/kiosk/view`, `POST /api/kiosk/resync`,
  `POST /api/zones/{zone_id}/playback/commands`.
- Assumed (not named by an ADR): `GET /api/kiosk/horizon?after_seq=` (the horizon manifest),
  `GET /api/venues/{venue_id}/play-log` (ADR-0449 export as JSON), the kiosk cookie name
  `selecta_kiosk`, the public key sent as a JWK, signatures as base64url raw r||s (what WebCrypto
  produces), and the heartbeat fields `claim`, `release`, `log`, `bundle_version` with answer
  fields `lease` (`held`, `remote`, `moved`), `nonce`, `server_time`, `position_seq`,
  `horizon_revision`, `bundle`, `commands`, `acked_seq`.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import math
import random
import sys
import uuid
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from selecta.audit.business_kiosk_support import (
    SAFE_HOSTS as SAFE_HOSTS,
    KIOSK_COOKIE as KIOSK_COOKIE,
    refuse_production as refuse_production,
    percentile as percentile,
    iso as iso,
    from_iso as from_iso,
    dt as dt,
    Clock as Clock,
    VirtualClock as VirtualClock,
    RealClock as RealClock,
    b64url as b64url,
    unb64url as unb64url,
    DeviceKey as DeviceKey,
    load_public_jwk as load_public_jwk,
    verify_signature as verify_signature,
    TransportDown as TransportDown,
    Answer as Answer,
    LatencyBook as LatencyBook,
    Transport as Transport,
    HttpTransport as HttpTransport,
)

from selecta.audit.business_trace import (
    AudioSpan,
    BusinessTrace,
    HorizonReport,
    LeaseSpan,
    Payload,
    Play,
    Stop,
    VolumeReport,
)

HEARTBEAT_S = 5.0
"""ADR-0443 / ADR-0445: the speaker heartbeats every 5 s."""
CLOSED_HEARTBEAT_S = 60.0
"""Assumed: while closed and not warming, only the 60 s health cadence (ADR-0445)."""
HEALTH_S = 60.0
"""ADR-0445: a health report every 60 s and on every state change."""
LEASE_S = 20.0
"""ADR-0443 / ADR-0415: the lease is 20 s."""
WARMING_S = 30 * 60.0
"""ADR-0448: render-ahead starts 30 minutes before opening."""
HORIZON_TARGET_S = 4 * 3600.0
"""ADR-0446: 4 hours rendered and downloaded ahead."""
COMMAND_MAX_AGE_S = 120.0
"""ADR-0446 / ADR-0453 D10: queued staff commands older than 2 minutes are dropped."""
VOLUME_RAMP_S = 30.0
"""ADR-0450: quiet hours ramp down over 30 seconds."""
CACHE_CAP_BYTES = 4 * 1024**3
"""ADR-0446: at most the smaller of 4 GB and 50% of quota."""

ROUTES = {
    "pairings": "/api/kiosk/pairings",
    "pairing_status": "/api/kiosk/pairings/status",
    "pair": "/api/kiosk/pair",
    "heartbeat": "/api/kiosk/heartbeat",
    "health": "/api/kiosk/health",
    "view": "/api/kiosk/view",
    "resync": "/api/kiosk/resync",
    "horizon": "/api/kiosk/horizon",
    "zone_command": "/api/zones/{zone_id}/playback/commands",
    "play_log": "/api/venues/{venue_id}/play-log",
}


def __getattr__(name: str) -> Any:
    """`FakeTransport` and `FakeVenueServer` live in `business_kiosk_fake.py` (size limit)."""
    if name in ("FakeTransport", "FakeVenueServer"):
        sys.path.insert(0, str(Path(__file__).resolve().parent))
        import business_kiosk_fake

        return getattr(business_kiosk_fake, name)
    raise AttributeError(name)


# ------------------------------------------------------------------------------- command queue


@dataclass
class QueuedCommand:
    made_at: float
    zone_id: str
    command: str
    args: dict[str, Any]
    idempotency_key: str


@dataclass
class CommandQueue:
    """A staff device's offline queue: kept in order, dropped after 2 minutes (ADR-0446)."""

    max_age_s: float = COMMAND_MAX_AGE_S
    items: list[QueuedCommand] = field(default_factory=list)
    dropped: list[QueuedCommand] = field(default_factory=list)

    def add(self, item: QueuedCommand) -> None:
        self.items.append(item)

    def due(self, now: float) -> list[QueuedCommand]:
        """The commands still young enough to send, oldest first; the rest are dropped."""
        keep = [item for item in self.items if now - item.made_at <= self.max_age_s]
        self.dropped.extend(item for item in self.items if now - item.made_at > self.max_age_s)
        self.items = keep
        return list(keep)


# --------------------------------------------------------------------------------- the kiosk


@dataclass
class KioskSpec:
    org_id: str
    venue_id: str
    zone_id: str
    role: str = "home"
    """`home` or `standby` (ADR-0443)."""
    bandwidth_bps: float = 2_000_000.0
    """Bytes a second the venue line gives this kiosk's downloads (16 Mbit/s)."""
    quota_bytes: float = 16 * 1024**3
    offline: tuple[tuple[float, float], ...] = ()
    """Intervals (epoch seconds) when this kiosk's own network is down."""
    start_at: float | None = None
    """When the kiosk is switched on (default: the run start)."""
    crash_at: float | None = None
    """A power cut: the kiosk stops acting at this moment and stays off until `revive_at`."""
    revive_at: float | None = None
    fault: str | None = None
    """Planted faults for checker tests: `silent_with_horizon@<t>`, `duplicate_upload`,
    `ignore_cap`, `mid_song_stop`, `ignore_moved`."""


@dataclass
class Entry:
    seq: int
    song_id: str
    duration_s: float
    bytes: int
    sha256: str = ""
    artifact_key: str = ""
    cached: bool = False
    received: int = 0
    played: bool = False


class KioskSim:
    """One simulated kiosk. Run it with `clock.spawn(kiosk.run(until))`."""

    def __init__(
        self,
        spec: KioskSpec,
        clock: Any,
        transport: Transport,
        trace: BusinessTrace,
        *,
        manager_token: str,
        sign_every: int = 1,
        rng: random.Random | None = None,
    ) -> None:
        self.spec = spec
        self.clock = clock
        self.transport = transport
        self.trace = trace
        self.manager_token = manager_token
        self.sign_every = max(1, sign_every)
        self.rng = rng or random.Random(hash((spec.zone_id, spec.role)))
        self.key = DeviceKey()
        self.machine_id = uuid.uuid4().hex
        self.device_id = ""
        self.token = ""
        self.nonce = ""
        self.beats = 0
        self.online = True
        self.offline_since: float | None = None
        self.reconnects: list[tuple[float, float]] = []
        """(went offline, resynced) pairs."""
        self.need_resync = False
        self.holder = False
        self.lease_started: float | None = None
        self.audio_started: float | None = None
        self.windows: list[tuple[float, float | None]] = []
        self.stop_at: float | None = None
        self.bundle_version = -1
        self.snapshot_id = ""
        self.refused: frozenset[str] = frozenset()
        self.volume = 0.7
        self.cap = 1.0
        self.level = 0.0
        self.schedule_version = 0
        self.schedule_seen: list[tuple[float, int]] = []
        self.horizon_revision = -1
        self.entries: dict[int, Entry] = {}
        self.position_seq = 0
        self.current: Entry | None = None
        self.current_end = 0.0
        self.current_play: Play | None = None
        self.fallback_cursor = 0
        self.log: list[dict[str, Any]] = []
        self.next_log_seq = 1
        self.acked_seq = 0
        self.hand_back = False
        self.next_hb = 0.0
        self.next_health = 0.0
        self.last_dl = 0.0
        self.state = "closed"
        self.first_audio: dict[float, float] = {}
        """window opening -> first audible moment."""
        self.horizon_full: dict[float, float] = {}
        """window opening -> moment the horizon reached 4 h (or the close)."""
        self.plays_started: list[tuple[float, str, str]] = []
        """(started, song id, snapshot id) for rule-change checks."""
        self.errors: list[str] = []
        self.dead = False
        self.silenced_from: float | None = None
        if spec.fault and spec.fault.startswith("silent_with_horizon@"):
            self.silenced_from = float(spec.fault.split("@", 1)[1])

    # ------------------------------------------------------------------ helpers

    def _network_up(self, t: float) -> bool:
        return not any(start <= t < end for start, end in self.spec.offline)

    def _crashed(self, t: float) -> bool:
        spec = self.spec
        return spec.crash_at is not None and spec.crash_at <= t < (spec.revive_at or math.inf)

    def window_at(self, t: float) -> tuple[float, float | None] | None:
        for opens, closes in self.windows:
            if opens <= t and (closes is None or t < closes):
                return opens, closes
        return None

    def in_service(self, t: float) -> bool:
        for opens, closes in self.windows:
            if opens - WARMING_S <= t and (closes is None or t < closes):
                return True
        return False

    def next_edge(self, t: float) -> float:
        edges = [math.inf]
        for opens, closes in self.windows:
            for edge in (opens - WARMING_S, opens, closes):
                if edge is not None and edge > t:
                    edges.append(edge)
        if self.stop_at is not None and self.stop_at > t:
            edges.append(self.stop_at)
        for edge in (self.spec.crash_at, self.spec.revive_at, self.silenced_from):
            if edge is not None and edge > t:
                edges.append(edge)
        for start, end in self.spec.offline:
            for edge in (start, end):
                if edge > t:
                    edges.append(edge)
        return min(edges)

    def may_play(self, t: float) -> bool:
        if self.window_at(t) is None or self._crashed(t) or self.dead:
            return False
        if self.stop_at is not None and t >= self.stop_at:
            return False
        return self.holder

    def _allowed(self, entry: Entry) -> bool:
        return entry.song_id not in self.refused

    def seconds_ahead(self, t: float) -> float:
        """Playable saved music from now (the rest of this song plus cached allowed entries)."""
        if self.stop_at is not None and t >= self.stop_at:
            return 0.0
        ahead = max(0.0, self.current_end - t) if self.current else 0.0
        seq = self.position_seq
        while True:
            entry = self.entries.get(seq)
            if entry is None or not entry.cached:
                break
            if self._allowed(entry) and not entry.played:
                ahead += entry.duration_s
            seq += 1
        return ahead

    def cached_bytes(self) -> int:
        return sum(entry.received for entry in self.entries.values())

    # ------------------------------------------------------------------ the run

    async def run(self, until: float) -> None:
        start = self.spec.start_at if self.spec.start_at is not None else self.clock.t()
        if start > self.clock.t():
            await self.clock.sleep_until(start)
        while not self.device_id:
            try:
                await self.pair()
            except TransportDown:
                await self.clock.sleep_until(self.clock.t() + HEARTBEAT_S)
        now = self.clock.t()
        self.next_hb = self.next_health = now
        self.last_dl = now
        while now < until:
            await self.step(now)
            wake = min(self.next_hb, self.next_health, self.next_edge(now), until)
            if self.current is not None:
                wake = min(wake, self.current_end)
            await self.clock.sleep_until(max(wake, now + 0.001))
            now = self.clock.t()
        self.finish(until)

    async def pair(self) -> None:
        made = await self.transport.call(
            "POST",
            ROUTES["pairings"],
            body={"public_key": self.key.public_jwk(), "machine_id": self.machine_id},
            label="pairing",
        )
        if made.status >= 400:
            raise TransportDown(f"pairing refused: {made.status}")
        code, pairing_id = made.body["code"], made.body.get("pairing_id", "")
        paired = await self.transport.call(
            "POST",
            ROUTES["pair"],
            body={"code": code, "zone_id": self.spec.zone_id, "role": self.spec.role},
            bearer=self.manager_token,
            label="pair",
        )
        if paired.status >= 400:
            raise TransportDown(f"manager pairing refused: {paired.status} {paired.body}")
        status = await self.transport.call(
            "GET", f"{ROUTES['pairing_status']}?pairing_id={pairing_id}", label="pairing"
        )
        self.token = status.cookies.get(KIOSK_COOKIE) or status.body.get("kiosk_token", "")
        self.device_id = status.body["device_id"]
        self.nonce = status.body.get("nonce", "")

    async def step(self, now: float) -> None:
        if self._crashed(now) or self.dead:
            self._stop_audio(now, reason=None)
            self._end_lease(now)
            self.state = "off"
            self.next_hb = self.next_health = self.next_edge(now)
            return
        self._advance_downloads(now)
        await self._advance_playback(now)
        if now >= self.next_hb:
            await self.heartbeat(now)
            cadence = HEARTBEAT_S if self.in_service(now) else CLOSED_HEARTBEAT_S
            self.next_hb = now + cadence
        if now >= self.next_health:
            await self.health(now)
            self.next_health = now + HEALTH_S

    def finish(self, until: float) -> None:
        self._stop_audio(until, reason=None)
        self._end_lease(until)

    # ------------------------------------------------------------------ network

    async def _send(self, method: str, path: str, body: Any, label: str) -> Answer | None:
        now = self.clock.t()
        if not self._network_up(now):
            self._went_offline(now)
            return None
        try:
            answer = await self.transport.call(
                method, path, body=body, cookie=self.token, label=label
            )
        except TransportDown:
            self._went_offline(now)
            return None
        return answer

    def _went_offline(self, now: float) -> None:
        if self.online:
            self.online = False
            self.offline_since = now
            self.need_resync = True

    async def heartbeat(self, now: float) -> None:
        if self.need_resync:
            if not await self.resync(now):
                return
        self.beats += 1
        body: dict[str, Any] = {
            "device_id": self.device_id,
            "zone_id": self.spec.zone_id,
            "nonce": self.nonce,
            "claim": self.in_service(now) and not self.hand_back,
            "release": False,
            "playing": self.current is not None,
            "position": {"seq": self.position_seq},
            "level": self.level,
            "bundle_version": self.bundle_version,
            "log": self.log[:50],
        }
        if self.beats % self.sign_every == 1 or self.sign_every == 1:
            body["signature"] = self.key.sign(self.nonce)
        answer = await self._send("POST", ROUTES["heartbeat"], body, "heartbeat")
        if answer is None:
            return
        if answer.status == 503:
            return
        if answer.status >= 400:
            self.errors.append(f"heartbeat {answer.status} {answer.body}")
            code = (answer.body or {}).get("error") if isinstance(answer.body, dict) else None
            if code in ("kiosk_revoked", "kiosk_key_mismatch"):
                self.dead = True
                self._stop_audio(now, reason=None)
                self._end_lease(now)
            return
        self.online = True
        await self._apply_answer(now, answer.body)

    async def resync(self, now: float) -> bool:
        """ADR-0446: upload the device log once, then carry on or fade out."""
        body = {
            "device_id": self.device_id,
            "zone_id": self.spec.zone_id,
            "nonce": self.nonce,
            "signature": self.key.sign(self.nonce),
            "log": self.log,
            "position": {"seq": self.position_seq},
            "bundle_version": self.bundle_version,
            "cached": sorted(seq for seq, entry in self.entries.items() if entry.cached),
        }
        answer = await self._send("POST", ROUTES["resync"], body, "resync")
        if answer is None:
            return False
        if answer.status == 503:
            retry = float((answer.body or {}).get("retry_after_s", 5))
            self.next_hb = now + retry * self.rng.uniform(0.5, 1.5)
            return False
        if answer.status >= 400:
            self.errors.append(f"resync {answer.status} {answer.body}")
            if (answer.body or {}).get("error") in ("kiosk_revoked", "kiosk_key_mismatch"):
                self.dead = True
            return False
        self.online = True
        self.need_resync = False
        if self.offline_since is not None:
            self.reconnects.append((self.offline_since, now))
            self.offline_since = None
        await self._apply_answer(now, answer.body)
        if self.spec.fault == "duplicate_upload":
            for entry in list(self.log_uploaded_offline):
                again = dict(entry, device_seq=self.next_log_seq)
                again["idempotency_key"] = f"{self.device_id}:{self.next_log_seq}"
                self.next_log_seq += 1
                self.log.append(again)
            self.log_uploaded_offline = []
        return True

    log_uploaded_offline: list[dict[str, Any]] = []

    async def _apply_answer(self, now: float, body: dict[str, Any]) -> None:
        if body.get("nonce"):
            self.nonce = body["nonce"]
        acked = int(body.get("acked_seq", self.acked_seq))
        if acked > self.acked_seq:
            if self.spec.fault == "duplicate_upload":
                self.log_uploaded_offline = [
                    entry for entry in self.log if entry["device_seq"] <= acked and entry["offline"]
                ]
            self.acked_seq = acked
            self.log = [entry for entry in self.log if entry["device_seq"] > acked]
        bundle = body.get("bundle")
        if bundle:
            self._apply_bundle(now, bundle)
        for command in body.get("commands", ()):
            if command.get("kind") == "hand_back":
                self.hand_back = True
        lease = body.get("lease")
        if lease == "held" and not self.hand_back:
            if not self.holder:
                self.holder = True
                self.lease_started = now
                if self.current is None:
                    self.position_seq = max(self.position_seq, int(body.get("position_seq", 0)))
        elif lease == "moved" and self.holder and self.spec.fault != "ignore_moved":
            self._stop_audio(now + 1.0, reason=None)
            self._end_lease(now + 1.0)
        elif lease == "remote" and self.holder and not self.hand_back:
            self._stop_audio(now, reason=None)
            self._end_lease(now)
        revision = int(body.get("horizon_revision", self.horizon_revision))
        if revision != self.horizon_revision:
            await self._fetch_horizon(now, revision)

    def _apply_bundle(self, now: float, bundle: dict[str, Any]) -> None:
        version = int(bundle.get("version", 0))
        if version <= self.bundle_version:
            return
        self.bundle_version = version
        self.windows = [(from_iso(o) or 0.0, from_iso(c)) for o, c in bundle.get("windows", [])]
        self.stop_at = from_iso(bundle.get("stop_at"))
        snapshot = bundle.get("snapshot") or {}
        if snapshot.get("id"):
            self.snapshot_id = snapshot["id"]
            self.refused = frozenset(snapshot.get("refused", ()))
            self.trace_snapshot(self.snapshot_id, self.refused)
        self.volume = float(bundle.get("volume", self.volume))
        self.cap = float(bundle.get("cap", self.cap))
        schedule = int(bundle.get("schedule_version", self.schedule_version))
        if schedule != self.schedule_version:
            self.schedule_version = schedule
            self.schedule_seen.append((now, schedule))
        self._set_level(now)

    def trace_snapshot(self, snapshot_id: str, refused: frozenset[str]) -> None:
        """Remember which songs a snapshot refused; `Fleet` turns this into allow sets."""
        refusals = getattr(self.trace, "_refusals", None)
        if refusals is None:
            refusals = {}
            self.trace._refusals = refusals  # type: ignore[attr-defined]
        refusals[snapshot_id] = refused

    async def _fetch_horizon(self, now: float, revision: int) -> None:
        known = max(self.entries, default=-1)
        path = f"{ROUTES['horizon']}?after_seq={known}"
        answer = await self._send("GET", path, None, "horizon")
        if answer is None or answer.status >= 400:
            return
        self.horizon_revision = revision
        for item in answer.body.get("entries", ()):
            seq = int(item["seq"])
            if seq in self.entries and self.entries[seq].song_id == item["song_id"]:
                continue
            self.entries[seq] = Entry(
                seq,
                item["song_id"],
                float(item["duration_s"]),
                int(item["bytes"]),
                item.get("sha256", ""),
                item.get("artifact_key", ""),
            )

    async def health(self, now: float) -> None:
        ahead = self.seconds_ahead(now)
        zone, device = self.spec.zone_id, self.device_id
        self.trace.horizons.append(HorizonReport(zone, device, dt(now), ahead))
        self.trace.volumes.append(VolumeReport(zone, device, dt(now), self.level, self.cap))
        window = self.window_at(now)
        if window is not None and window[0] not in self.horizon_full:
            closes = window[1]
            want = HORIZON_TARGET_S if closes is None else min(HORIZON_TARGET_S, closes - now)
            if ahead >= want - 1:
                self.horizon_full[window[0]] = now
        await self._send(
            "POST",
            ROUTES["health"],
            {
                "device_id": device,
                "kiosk_version": "sim-1",
                "audio_context": "running",
                "autoplay_allowed": True,
                "wake_lock": True,
                "output_level": self.level if self.current else 0.0,
                "playing": self.current is not None,
                "hours_saved_ahead": round(ahead / 3600, 3),
                "storage_used": self.cached_bytes(),
                "storage_available": self.spec.quota_bytes,
            },
            "health",
        )

    async def fetch_view(self, now: float) -> None:
        answer = await self._send("GET", ROUTES["view"], None, "view")
        if answer is not None and answer.status == 200:
            self.trace.payloads.append(Payload("kiosk", answer.body, dt(now)))

    # ------------------------------------------------------------------ downloads

    def _advance_downloads(self, now: float) -> None:
        elapsed, self.last_dl = now - self.last_dl, now
        if elapsed <= 0 or not self._network_up(now) or not self.online:
            return
        budget = self.spec.bandwidth_bps * elapsed
        cap = min(CACHE_CAP_BYTES, 0.5 * self.spec.quota_bytes)
        for seq in sorted(self.entries):
            if budget <= 0:
                break
            entry = self.entries[seq]
            if entry.cached or entry.played or seq < self.position_seq:
                continue
            if self.cached_bytes() + entry.bytes > cap and not self._evict(entry.bytes, cap):
                break
            take = min(budget, entry.bytes - entry.received)
            entry.received += int(take)
            budget -= take
            if entry.received >= entry.bytes:
                entry.received = entry.bytes
                entry.cached = True

    def _evict(self, wanted: int, cap: float) -> bool:
        """ADR-0446: played files first, oldest first; never the committed window."""
        for seq in sorted(self.entries):
            entry = self.entries[seq]
            if entry.played and entry.received and self.cached_bytes() + wanted > cap:
                entry.received = 0
                entry.cached = False
        return self.cached_bytes() + wanted <= cap

    # ------------------------------------------------------------------ playback

    def _set_level(self, now: float) -> None:
        target = self.volume if self.spec.fault == "ignore_cap" else min(self.volume, self.cap)
        if abs(target - self.level) > 1e-9:
            self.level = target
            self.trace.volumes.append(
                VolumeReport(self.spec.zone_id, self.device_id, dt(now), self.level, self.cap)
            )

    async def _advance_playback(self, now: float) -> None:
        if self.current is not None and now >= self.current_end:
            self._song_ended(self.current_end)
        window = self.window_at(now)
        if self.current is not None:
            hard_stop = self.stop_at is not None and now >= self.stop_at
            silenced = self.silenced_from is not None and now >= self.silenced_from
            if window is None or hard_stop or not self.holder or silenced:
                self._stop_audio(now, reason="billing" if hard_stop else None)
            return
        if self.hand_back and self.holder:
            await self._release(now)
            return
        if not self.may_play(now):
            return
        if self.silenced_from is not None and now >= self.silenced_from:
            return
        if self.online and self.state == "playing" and self.current_play is not None:
            await self.heartbeat(now)  # refresh the rules before the next song (ADR-0450)
            self.next_hb = now + HEARTBEAT_S
            if not self.may_play(now):
                return
        self._start_next(now, window)

    def _start_next(self, now: float, window: tuple[float, float | None] | None) -> None:
        entry, fallback = self._next_entry()
        if entry is None:
            self._stop_audio(now, reason=None)
            self.state = "back_shortly"
            return
        closes = window[1] if window else None
        length = entry.duration_s
        if closes is not None:
            length = min(length, closes - now)  # the planned closing fade lands on the close
        if self.stop_at is not None:
            length = min(length, self.stop_at - now)
        if length <= 0:
            return
        if self.audio_started is None:
            self.audio_started = now
            if window is not None and window[0] not in self.first_audio:
                self.first_audio[window[0]] = now
        self.current = entry
        self.current_end = now + length
        if not fallback:
            self.position_seq = entry.seq + 1
        offline = not self.online
        play = Play(
            play_id=uuid.uuid4().hex,
            zone_id=self.spec.zone_id,
            venue_id=self.spec.venue_id,
            song_id=entry.song_id,
            started=dt(now),
            snapshot_id=self.snapshot_id,
            offline=offline,
        )
        self.current_play = play
        self.trace.plays.append(play)
        self.plays_started.append((now, entry.song_id, self.snapshot_id))
        self.log.append(
            {
                "device_seq": self.next_log_seq,
                "idempotency_key": f"{self.device_id}:{self.next_log_seq}",
                "kind": "offline_fallback" if fallback else "play",
                "play_id": play.play_id,
                "song_id": entry.song_id,
                "started": iso(now),
                "duration_s": length,
                "offline": offline,
                "snapshot_id": self.snapshot_id,
            }
        )
        self.next_log_seq += 1
        if self.state != "playing":
            self.state = "playing"
            self.clock.spawn(self.fetch_view(now)) if False else None

    def _next_entry(self) -> tuple[Entry | None, bool]:
        seq = self.position_seq
        while seq in self.entries:
            entry = self.entries[seq]
            if not entry.cached:
                break
            if self._allowed(entry) and not entry.played:
                return entry, False
            seq += 1
            self.position_seq = seq
        played = [e for e in self.entries.values() if e.played and e.cached and self._allowed(e)]
        if not played:
            return None, False
        self.fallback_cursor = (self.fallback_cursor + 1) % len(played)
        return played[self.fallback_cursor], True

    def _song_ended(self, at: float) -> None:
        if self.current is not None:
            self.current.played = True
        self.current = None
        self.current_play = None
        window = self.window_at(at)
        stopped = self.stop_at is not None and at >= self.stop_at
        if window is None or stopped or not self.may_play(at):
            if stopped and window is None or stopped:
                self.trace.stops.append(Stop(self.spec.venue_id, dt(at), "billing", False))
            self._stop_audio(at, reason=None)
            if window is None:
                self.state = "closed"

    def _stop_audio(self, at: float, reason: str | None) -> None:
        if self.current is not None:
            mid_song = at < self.current_end - 1e-6
            if reason == "billing" or self.spec.fault == "mid_song_stop":
                self.trace.stops.append(Stop(self.spec.venue_id, dt(at), "billing", mid_song))
            if not mid_song:
                self.current.played = True
            self.current = None
            self.current_play = None
        if self.audio_started is not None and at > self.audio_started:
            self.trace.audio.append(
                AudioSpan(self.spec.zone_id, self.device_id, dt(self.audio_started), dt(at))
            )
        self.audio_started = None
        if self.state == "playing":
            self.state = "closed" if self.window_at(at) is None else "idle"

    def _end_lease(self, at: float) -> None:
        if self.holder and self.lease_started is not None and at > self.lease_started:
            self.trace.leases.append(
                LeaseSpan(self.spec.zone_id, self.device_id, dt(self.lease_started), dt(at))
            )
        self.holder = False
        self.lease_started = None

    async def _release(self, now: float) -> None:
        """Hand the zone back at a song boundary (ADR-0443 `hand_back`)."""
        self._stop_audio(now, reason=None)
        self._end_lease(now)
        self.hand_back = False
        await self._send(
            "POST",
            ROUTES["heartbeat"],
            {
                "device_id": self.device_id,
                "zone_id": self.spec.zone_id,
                "nonce": self.nonce,
                "signature": self.key.sign(self.nonce),
                "claim": False,
                "release": True,
                "position": {"seq": self.position_seq},
                "bundle_version": self.bundle_version,
                "log": self.log[:50],
            },
            "heartbeat",
        )
        self.hand_back_done = now

    hand_back_done: float | None = None


# --------------------------------------------------------------------------- the staff remote


class StaffRemote:
    """A staff tablet steering zones; offline it queues and drops commands after 2 minutes."""

    def __init__(self, clock: Any, transport: Transport, bearer: str) -> None:
        self.clock = clock
        self.transport = transport
        self.bearer = bearer
        self.queue = CommandQueue()
        self.sent: list[tuple[QueuedCommand, Answer]] = []
        self.network_down = False

    def command(self, zone_id: str, command: str, **args: Any) -> QueuedCommand:
        item = QueuedCommand(self.clock.t(), zone_id, command, args, uuid.uuid4().hex)
        self.queue.add(item)
        return item

    async def flush(self) -> None:
        """Send what is due, in order; stop at the first network failure."""
        if self.network_down:
            return
        for item in self.queue.due(self.clock.t()):
            try:
                answer = await self.transport.call(
                    "POST",
                    ROUTES["zone_command"].format(zone_id=item.zone_id),
                    body={
                        "command": item.command,
                        "args": item.args,
                        "idempotency_key": item.idempotency_key,
                        "made_at": iso(item.made_at),
                    },
                    bearer=self.bearer,
                    label="zone_command",
                )
            except TransportDown:
                return
            self.queue.items.remove(item)
            self.sent.append((item, answer))


# ----------------------------------------------------------------------------------- the fleet


@dataclass
class Fleet:
    """Many kiosks on one clock and one transport, sharing one trace."""

    clock: Any
    transport: Transport
    trace: BusinessTrace
    kiosks: list[KioskSim] = field(default_factory=list)

    def add(self, spec: KioskSpec, manager_token: str, **options: Any) -> KioskSim:
        kiosk = KioskSim(spec, self.clock, self.transport, self.trace, manager_token=manager_token,
                         **options)
        self.kiosks.append(kiosk)
        return kiosk

    def start(self, until: float) -> None:
        for kiosk in self.kiosks:
            self.clock.spawn(kiosk.run(until))

    def finish_trace(self, until: float) -> None:
        """Turn snapshot refusals into allow sets over every song any manifest named."""
        songs = {e.song_id for k in self.kiosks for e in k.entries.values()}
        songs |= {play.song_id for play in self.trace.plays}
        refusals = getattr(self.trace, "_refusals", {})
        for snapshot_id, refused in refusals.items():
            self.trace.snapshot_allows[snapshot_id] = frozenset(songs - set(refused))
        self.trace.observed_until = dt(until)


async def run_fleet(
    fleet: Fleet, until: float, extra: Sequence[Callable[[], Awaitable[None]]] = ()
) -> None:
    fleet.start(until)
    for job in extra:
        fleet.clock.spawn(job())
    await fleet.clock.run_until(until)
    fleet.finish_trace(until)


# ------------------------------------------------------------------------------------- the CLI


async def _export(base_url: str, seed: Path, count: int, out: Path) -> None:
    """Pair `count` kiosks on staging from a seed file and write them out for k6."""
    world = json.loads(seed.read_text("utf-8"))
    transport = HttpTransport(base_url)
    clock = RealClock()
    trace = BusinessTrace()
    zones = [
        (org, venue, zone)
        for org in world["orgs"]
        for venue in org["venues"]
        for zone in venue["zones"]
    ]
    rows = []
    try:
        for org, venue, zone in zones[:count]:
            spec = KioskSpec(org["id"], venue["id"], zone)
            kiosk = KioskSim(spec, clock, transport, trace, manager_token=org["manager_token"])
            await kiosk.pair()
            rows.append(
                {
                    "token": kiosk.token,
                    "device_id": kiosk.device_id,
                    "zone_id": zone,
                    "nonce": kiosk.nonce,
                    "private_jwk": kiosk.key.private_jwk(),
                }
            )
    finally:
        await transport.aclose()
    out.write_text(json.dumps(rows), "utf-8")
    print(f"Paired {len(rows)} kiosks into {out}")


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = parser.add_subparsers(dest="mode", required=True)
    export = sub.add_parser("export-kiosks", help="pair kiosks on staging for the k6 scripts")
    export.add_argument("--base-url", required=True)
    export.add_argument("--seed", required=True, type=Path)
    export.add_argument("--count", type=int, default=1000)
    export.add_argument("--out", required=True, type=Path)
    args = parser.parse_args(argv)
    refuse_production(args.base_url)
    asyncio.run(_export(args.base_url, args.seed, args.count, args.out))
    return 0


if __name__ == "__main__":
    sys.exit(main())
