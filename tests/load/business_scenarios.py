"""The business stress scenarios ST1 to ST10 (ADR-0454 BZ-0454-07 to -11).

Each scenario has a scaled-down local run on the virtual clock against the in-process fake venue
server (`business_kiosk_fake.py`), judged by the business invariants B1 to B9
(`selecta.audit.business_invariants.check_trace`) plus the scenario's own pass thresholds, and a
full-size run on staging (`python infra/staging/run.py <name>`), which drives the same kiosk
simulator through `HttpTransport` against the real product.

What a local run proves and does not prove is stated per scenario in `SCENARIOS[...].local_note`:
the fake models the kiosk contract (leases, bundles, horizons, play-log upload, paced resync), so
a local pass shows the kiosk side behaves and the checks fire; it never stands in for the full
run, and no gate in docs/verification/bz-gate-register.md is passed by it.

    uv run python tests/load/business_scenarios.py list
    uv run python tests/load/business_scenarios.py run business_peak --fake [--venues 20]
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))

from business_kiosk_fake import FakeTransport, FakeVenueServer  # noqa: E402
from business_kiosk_sim import (  # noqa: E402
    Fleet,
    KioskSpec,
    StaffRemote,
    VirtualClock,
    percentile,
    run_fleet,
)

from selecta.audit.business_invariants import check_trace  # noqa: E402
from selecta.audit.business_trace import BusinessTrace, Warning  # noqa: E402

HOUR = 3600.0
DAY = 24 * HOUR
# Friday 2026-11-20 00:00 UTC: every local run starts on this day.
T0 = datetime(2026, 11, 20, tzinfo=UTC).timestamp()


def at(day: int, hour: float) -> float:
    return T0 + day * DAY + hour * HOUR


@dataclass
class Report:
    name: str
    scale: dict[str, Any]
    checks: list[dict[str, Any]] = field(default_factory=list)
    numbers: dict[str, Any] = field(default_factory=dict)
    not_measured: list[str] = field(default_factory=list)

    def check(self, name: str, ok: bool, detail: str = "") -> None:
        self.checks.append({"check": name, "ok": bool(ok), "detail": detail})

    @property
    def passed(self) -> bool:
        return all(item["ok"] for item in self.checks)

    def as_dict(self) -> dict[str, Any]:
        return {"scenario": self.name, "scale": self.scale, "passed": self.passed,
                "checks": self.checks, "numbers": self.numbers,
                "not_measured_locally": self.not_measured}


@dataclass
class World:
    clock: VirtualClock
    trace: BusinessTrace
    server: FakeVenueServer
    transport: FakeTransport
    fleet: Fleet


def make_world(start: float, *, verify_every: int = 25, resyncs_per_s: int = 50) -> World:
    clock = VirtualClock(start)
    trace = BusinessTrace()
    server = FakeVenueServer(clock, trace, verify_every=verify_every)
    transport = FakeTransport(server, resyncs_per_s=resyncs_per_s)
    return World(clock, trace, server, transport, Fleet(clock, transport, trace))


def add_venues(world: World, count: int, zones: int,
               windows: Callable[[int], list[tuple[float, float | None]]],
               offline: Callable[[int], tuple[tuple[float, float], ...]] = lambda _i: (),
               org_of: Callable[[int], str] = lambda i: f"org-{i // 10}") -> None:
    for i in range(count):
        org_id, venue_id = org_of(i), f"venue-{i}"
        zone_ids = [f"{venue_id}-z{z}" for z in range(zones)]
        world.server.add_venue(org_id, venue_id, zone_ids, windows(i))
        token = world.server.manager_token(org_id)
        for zone_id in zone_ids:
            world.fleet.add(KioskSpec(org_id, venue_id, zone_id, offline=offline(i)), token,
                            sign_every=25)


def drain(world: World) -> None:
    """The final log upload at shutdown, so plays in the last seconds are not counted missing."""
    for kiosk in world.fleet.kiosks:
        device = world.server.devices.get(kiosk.device_id)
        if device is not None and kiosk.log:
            zone = world.server.zones[device.zone_id]
            world.server._ingest(device, world.server.venues[zone.venue_id], kiosk.log)
            kiosk.log = []


def judge_invariants(report: Report, world: World) -> None:
    found = check_trace(world.trace)
    by_rule: dict[str, int] = {}
    for violation in found:
        by_rule[violation.invariant] = by_rule.get(violation.invariant, 0) + 1
    report.check("B1 to B9 hold", not found,
                 "; ".join(f"{v.invariant}: {v.detail}" for v in found[:5]))
    report.numbers["violations"] = by_rule


def heartbeat_p95(report: Report, world: World, limit_ms: float = 300.0) -> None:
    p95 = world.transport.latency.p("heartbeat", 95)
    report.numbers["heartbeat_p95_ms_modeled"] = round(p95, 1)
    report.numbers["peak_calls_per_s"] = world.transport.peak_calls_per_s
    report.check("heartbeat p95 under 300 ms (modeled)", p95 < limit_ms, f"{p95:.1f} ms")


def first_audio_and_horizon(report: Report, world: World, until: float) -> None:
    delays, fills = [], []
    for kiosk in world.fleet.kiosks:
        for opens, _closes in kiosk.windows:
            if opens > until - 120:
                continue
            heard = kiosk.first_audio.get(opens)
            delays.append((heard - opens) if heard is not None else float("inf"))
            if opens <= until - 1800:
                full = kiosk.horizon_full.get(opens)
                fills.append((full - opens) if full is not None else float("inf"))
    p99 = percentile(delays, 99)
    report.numbers["audible_after_opening_p99_s"] = p99
    report.check("every zone audible within 60 s of opening (p99)", p99 <= 60, f"{p99} s")
    within = sum(1 for f in fills if f <= 1800)
    share = within / len(fills) if fills else 1.0
    report.numbers["horizon_4h_within_30min_share"] = round(share, 4)
    report.check("4-hour horizon complete within 30 minutes for 99% of zones", share >= 0.99,
                 f"{share:.2%} of {len(fills)}")


# --------------------------------------------------------------------------------- ST1


def st1_peak(venues: int = 20, zones: int = 3) -> Report:
    """500 venues x 3 zones at full size; most open between 16:55 and 17:05."""
    report = Report("business_peak", {"venues": venues, "zones_per_venue": zones})
    world = make_world(at(0, 15.0))

    def windows(i: int) -> list[tuple[float, float | None]]:
        share = i / max(1, venues)
        if share < 0.7:
            opens = at(0, 17.0) + ((i * 37) % 601) - 300
        elif share < 0.9:
            opens = at(0, 16.0)  # the 10:00 cohort, moved inside the short local run
        else:
            opens = at(0, 16.0) + (i % 4) * 1800
        return [(opens, at(0, 23.5))]

    add_venues(world, venues, zones, windows)
    until = at(0, 18.5)
    asyncio.run(run_fleet(world.fleet, until))
    drain(world)
    first_audio_and_horizon(report, world, until)
    heartbeat_p95(report, world)
    judge_invariants(report, world)
    report.not_measured += ["weight-8 interactive share and Premium fairness (real scheduler)",
                            "zero duplicate renders (real render workers)"]
    return report


# --------------------------------------------------------------------------------- ST2


def st2_reconnect(kiosks: int = 100, venues: int = 40) -> Report:
    """1,000 kiosks across 400 venues lose the API for 30 minutes, then all come back."""
    report = Report("business_reconnect", {"kiosks": kiosks, "venues": venues})
    world = make_world(at(0, 9.0), resyncs_per_s=max(2, kiosks // 40))
    per_venue = max(1, kiosks // venues)
    add_venues(world, venues, per_venue, lambda _i: [(at(0, 10.0), at(0, 23.0))])
    down_from, down_to = at(0, 12.0), at(0, 12.5)
    world.transport.api_down(down_from, down_to)
    remote = StaffRemote(world.clock, world.transport, world.server.manager_token("org-0"))
    first_zone = world.fleet.kiosks[0].spec.zone_id

    async def staff() -> None:
        await world.clock.sleep_until(at(0, 12.0) + 600)
        remote.command(first_zone, "volume", level=0.4)  # 20 minutes old at return: dropped
        await world.clock.sleep_until(down_to - 30)
        remote.command(first_zone, "volume", level=0.5)  # 30 s old: applied once
        for moment in (down_to + 5, down_to + 60):
            await world.clock.sleep_until(moment)
            await remote.flush()

    until = at(0, 13.0)
    asyncio.run(run_fleet(world.fleet, until, extra=[staff]))
    drain(world)
    late = []
    for kiosk in world.fleet.kiosks:
        back = [done for went, done in kiosk.reconnects if down_from <= went < down_to]
        if not back or back[0] - down_to > 120:
            late.append(kiosk.spec.zone_id)
    report.check("every kiosk reconnected within 2 minutes", not late,
                 f"{len(late)} late, first {late[:3]}")
    report.numbers["resyncs_paced"] = world.transport.refused_resyncs
    report.check("reconnect admission was paced", world.transport.refused_resyncs > 0,
                 f"{world.transport.refused_resyncs} resyncs told to retry")
    applied = [a for _item, a in remote.sent if a.status == 200]
    report.check("command older than 2 minutes dropped, newer one applied once",
                 len(remote.queue.dropped) == 1 and len(applied) == 1,
                 f"dropped {len(remote.queue.dropped)}, applied {len(applied)}")
    report.numbers["duplicate_uploads_refused"] = world.server.duplicates_refused
    heartbeat_p95(report, world)
    judge_invariants(report, world)
    report.not_measured += ["the real API's connection budget (staging)"]
    return report


# --------------------------------------------------------------------------------- ST3


def apply_bulk(server: FakeVenueServer, venue_ids: list[str], expected: dict[str, int],
               new_version: int, applied: dict[str, dict[str, str]], apply_id: str
               ) -> dict[str, str]:
    """One schedule edit across venues: each venue atomically, a version conflict refused, and a
    retry with the same id answers the first result without applying twice."""
    if apply_id in applied:
        return applied[apply_id]
    result: dict[str, str] = {}
    for venue_id in venue_ids:
        venue = server.venues[venue_id]
        if venue.schedule_version != expected[venue_id]:
            result[venue_id] = "conflict"
        else:
            server.set_schedule(venue_id, new_version)
            result[venue_id] = "applied"
    applied[apply_id] = result
    return result


def st3_bulk_schedule(venues: int = 40) -> Report:
    """An HQ admin applies a new evening daypart to 200 venues while a second admin edits 5."""
    report = Report("business_bulk_schedule", {"venues": venues})
    world = make_world(at(0, 18.0))
    open_count, offline_count = int(venues * 0.3), max(1, venues // 10)
    concurrent = max(1, venues * 5 // 200)
    edit_at = at(0, 19.0)

    def windows(i: int) -> list[tuple[float, float | None]]:
        # The rest open at 19:15, so they are warming (in service) when the edit lands.
        return [(at(0, 18.5), at(0, 23.0))] if i < open_count else [(at(0, 19.25), at(0, 23.0))]

    def offline(i: int) -> tuple[tuple[float, float], ...]:
        return ((edit_at - 120, edit_at + 1200),) if i >= venues - offline_count else ()

    add_venues(world, venues, 1, windows, offline)
    ids = [f"venue-{i}" for i in range(venues)]
    outcome: dict[str, Any] = {}

    async def admins() -> None:
        await world.clock.sleep_until(edit_at - 1)
        for venue_id in ids[1:1 + concurrent]:
            world.server.set_schedule(venue_id, 2)  # the second admin saves first
        await world.clock.sleep_until(edit_at)
        expected = {venue_id: 1 for venue_id in ids}
        began = time.perf_counter()
        ledger: dict[str, dict[str, str]] = {}
        first = apply_bulk(world.server, ids, expected, 3, ledger, "apply-1")
        again = apply_bulk(world.server, ids, expected, 3, ledger, "apply-1")
        outcome.update(result=first, retry_same=first == again,
                       wall_ms=(time.perf_counter() - began) * 1000)

    until = at(0, 19.75)
    asyncio.run(run_fleet(world.fleet, until, extra=[admins]))
    drain(world)
    result = outcome["result"]
    conflicts = {v for v, r in result.items() if r == "conflict"}
    report.check("concurrent edit refused with a version conflict, the rest applied",
                 conflicts == set(ids[1:1 + concurrent]),
                 f"{len(conflicts)} conflicts, {len(result) - len(conflicts)} applied")
    report.check("a retry with the same apply id is idempotent", outcome["retry_same"])
    report.numbers["audit_events"] = {"parent": 1, "children": len(result)}
    late_online, late_offline = [], []
    for kiosk in world.fleet.kiosks:
        if result.get(kiosk.spec.venue_id) != "applied":
            continue
        seen = [t for t, version in kiosk.schedule_seen if version == 3]
        if kiosk.spec.offline:
            back = kiosk.spec.offline[0][1]
            if not seen or seen[0] - back > 30:
                late_offline.append(kiosk.spec.zone_id)
        elif not seen or seen[0] - edit_at > 30:
            late_online.append(kiosk.spec.zone_id)
    report.check("online kiosks got the new schedule within 30 s", not late_online,
                 f"{len(late_online)} late")
    report.check("offline kiosks got it on reconnect", not late_offline,
                 f"{len(late_offline)} late")
    report.numbers["apply_wall_ms"] = round(outcome["wall_ms"], 1)
    judge_invariants(report, world)
    report.not_measured += ["the product's POST /api/business/schedules/apply under load",
                            "switch at the next block boundary (needs the real programme)"]
    return report


# --------------------------------------------------------------------------------- ST4

GRACE_CASES = ("before_opening", "mid_service", "at_close", "minute_after_close", "overnight",
               "dst_night", "paid_last_minute", "late_duplicate_webhook", "paid_after_stop")


def _grace_end(case: str) -> float:
    return {
        "before_opening": at(0, 8.0), "mid_service": at(0, 15.0), "at_close": at(0, 23.0),
        "minute_after_close": at(0, 23.0) + 60, "overnight": at(1, 1.5),
        "dst_night": at(0, 21.0), "paid_last_minute": at(0, 15.0),
        "late_duplicate_webhook": at(0, 15.0), "paid_after_stop": at(0, 15.0),
    }[case]


def st4_grace_close(orgs: int = 27) -> Report:
    """300 organisations whose billing grace ends at assorted times around closing."""
    report = Report("business_grace_close", {"organisations": orgs})
    world = make_world(at(0, 9.0))

    def case_of(i: int) -> str:
        return GRACE_CASES[i % len(GRACE_CASES)]

    def windows(i: int) -> list[tuple[float, float | None]]:
        if case_of(i) == "overnight":
            return [(at(0, 18.0), at(1, 2.0)), (at(1, 18.0), at(2, 2.0))]
        return [(at(0, 10.0), at(0, 23.0)), (at(1, 10.0), at(1, 23.0))]

    add_venues(world, orgs, 1, windows, org_of=lambda i: f"org-{i}")
    plans: dict[str, tuple[str, float]] = {}
    for i in range(orgs):
        venue_id, org_id, grace = f"venue-{i}", f"org-{i}", _grace_end(case_of(i))
        closes = [c for _o, c in windows(i) if c is not None and c >= grace]
        stop_at = closes[0]
        plans[venue_id] = (case_of(i), stop_at)
        world.trace.grace_ends[org_id] = datetime.fromtimestamp(grace, UTC)
        for kind, before in (("72h", 72 * HOUR), ("24h", 24 * HOUR)):
            world.trace.warnings.append(
                Warning(org_id, kind, datetime.fromtimestamp(stop_at - before, UTC)))

    async def billing() -> None:
        await world.clock.sleep_until(at(0, 9.5))
        for venue_id, (case, stop_at) in plans.items():
            world.server.set_stop(venue_id, stop_at)
            if case == "late_duplicate_webhook":
                world.server.set_stop(venue_id, stop_at)
        await world.clock.sleep_until(at(0, 23.0) - 60)
        for venue_id, (case, _stop) in plans.items():
            if case == "paid_last_minute":
                world.server.set_stop(venue_id, None)
        await world.clock.sleep_until(at(1, 8.0))
        for venue_id, (case, _stop) in plans.items():
            if case == "paid_after_stop":
                world.server.set_stop(venue_id, None)

    until = at(1, 12.0)
    asyncio.run(run_fleet(world.fleet, until, extra=[billing]))
    drain(world)
    wrong = []
    for kiosk in world.fleet.kiosks:
        case, stop_at = plans[kiosk.spec.venue_id]
        next_day = [o for o, _c in kiosk.windows if o > stop_at]
        if not next_day or next_day[0] >= until:
            continue
        heard = any(span.zone_id == kiosk.spec.zone_id and span.start.timestamp() >= next_day[0]
                    for span in world.trace.audio)
        should_play = case in ("paid_last_minute", "paid_after_stop")
        if heard != should_play:
            wrong.append(f"{kiosk.spec.venue_id}:{case}")
    report.check("unpaid venues stay stopped at the next opening; paid ones play", not wrong,
                 ", ".join(wrong[:5]))
    report.check("no billing stop cut a song", not any(s.mid_song for s in world.trace.stops))
    judge_invariants(report, world)
    report.not_measured += ["Stripe test-mode webhooks and the real dunning.tick warnings "
                            "(staging, with Stripe test mode)",
                            "venue-local DST arithmetic (tests/test_business_grace.py covers it)"]
    return report


# --------------------------------------------------------------------------------- ST9, ST10


def st9_rule_change(venues: int = 20, zones: int = 3) -> Report:
    """A rule change for a whole organisation during peak reaches every kiosk before its next
    song."""
    report = Report("business_rule_change", {"venues": venues, "zones_per_venue": zones})
    world = make_world(at(0, 16.0))
    add_venues(world, venues, zones, lambda _i: [(at(0, 17.0), at(0, 23.0))],
               org_of=lambda _i: "org-0")
    change_at = at(0, 18.0)
    refused = [f"song-{n}" for n in range(0, 600, 3)]

    async def change() -> None:
        await world.clock.sleep_until(change_at)
        world.server.set_rules(list(world.server.zones), "snap-1", refused)

    until = at(0, 18.75)
    asyncio.run(run_fleet(world.fleet, until, extra=[change]))
    drain(world)
    stale = []
    for kiosk in world.fleet.kiosks:
        after = [snap for started, _song, snap in kiosk.plays_started if started > change_at + 1]
        if after and after[0] != "snap-1":
            stale.append(kiosk.spec.zone_id)
    report.check("every kiosk's next song after the change used the new rules", not stale,
                 f"{len(stale)} stale")
    judge_invariants(report, world)
    return report


def st10_soak(venues: int = 10, days: int = 3) -> Report:
    """50 venues through three opening and closing cycles with network flaps on 10% of kiosks."""
    report = Report("business_soak", {"venues": venues, "days": days})
    world = make_world(at(0, 9.0))

    def windows(_i: int) -> list[tuple[float, float | None]]:
        return [(at(d, 10.0), at(d, 23.0)) for d in range(days)]

    def flaps(i: int) -> tuple[tuple[float, float], ...]:
        if i % 10:
            return ()
        # Locally a 30 s drop every 5 minutes in opening hours (full size: every 30 s).
        return tuple((at(d, 10.0) + k * 300, at(d, 10.0) + k * 300 + 30)
                     for d in range(days) for k in range(13 * 12))

    add_venues(world, venues, 1, windows, flaps)
    until = at(days - 1, 23.5)
    asyncio.run(run_fleet(world.fleet, until))
    drain(world)
    judge_invariants(report, world)
    errors = sum(len(k.errors) for k in world.fleet.kiosks)
    report.check("no kiosk errors", errors == 0, f"{errors} errors")
    report.not_measured += ["memory growth on a real device (BZ-0454-12 real-device soak)"]
    return report


# --------------------------------------------------------------------------------- the list


@dataclass(frozen=True)
class Scenario:
    id: str
    name: str
    title: str
    local: Callable[..., Report] | None
    full: dict[str, int]
    staging_inputs: tuple[str, ...]
    local_note: str


SCENARIOS: dict[str, Scenario] = {s.name: s for s in (
    Scenario("ST1", "business_peak", "Opening-hour peak", st1_peak,
             {"venues": 500, "zones": 3}, ("SELECTA_STAGING_URL", "BUSINESS_SEED"),
             "kiosk side on the fake; scheduler fairness and renders need staging"),
    Scenario("ST2", "business_reconnect", "1,000 kiosks reconnect after an outage",
             st2_reconnect, {"kiosks": 1000, "venues": 400},
             ("SELECTA_STAGING_URL", "BUSINESS_SEED"),
             "paced admission modeled by the fake; the real budget needs staging"),
    Scenario("ST3", "business_bulk_schedule", "One schedule edit across 200 venues",
             st3_bulk_schedule, {"venues": 200}, ("SELECTA_STAGING_URL", "BUSINESS_SEED"),
             "apply semantics modeled; the product route runs at full size on staging"),
    Scenario("ST4", "business_grace_close", "Billing grace expiring at closing time",
             st4_grace_close, {"orgs": 300},
             ("SELECTA_STAGING_URL", "BUSINESS_SEED", "STRIPE_TEST_SECRET_KEY"),
             "stops at close on the fake; Stripe test-mode webhooks need staging"),
    Scenario("ST5", "business_request_flood", "Lunch request flood", None,
             {"zones": 500, "guests_per_zone": 50}, ("SELECTA_STAGING_URL", "BUSINESS_SEED"),
             "staging only: the real guest request path, k6 tests/load/k6/rooms.js"),
    Scenario("ST6", "business_sso_outage", "SSO outage at shift change", None,
             {"venues": 100}, ("SELECTA_STAGING_URL", "WORKOS_STAGING_ORG"),
             "staging only: needs a test identity provider to switch off"),
    Scenario("ST7", "business_mass_offboard", "Directory Sync offboards 2,000 people", None,
             {"people": 2000}, ("SELECTA_STAGING_URL", "WORKOS_STAGING_ORG"),
             "staging only: needs Directory Sync events from the test identity provider"),
    Scenario("ST8", "business_playlog_export", "Play-log export of a month", None,
             {"rows": 8_000_000}, ("SELECTA_STAGING_URL", "BUSINESS_SEED"),
             "local bounded-memory proof is tests/test_business_stress.py (real export code)"),
    Scenario("ST9", "business_rule_change", "Rule change during peak", st9_rule_change,
             {"venues": 500, "zones": 3}, ("SELECTA_STAGING_URL", "BUSINESS_SEED"),
             "kiosk side on the fake"),
    Scenario("ST10", "business_soak", "72-hour soak with network flaps", st10_soak,
             {"venues": 50, "days": 3}, ("SELECTA_STAGING_URL", "BUSINESS_SEED"),
             "virtual-clock soak; real devices are BZ-0454-12"),
)}


# --------------------------------------------------------------------------------- staging


async def seed_staging(base_url: str, staff_token: str, owner_user_id: str, venues: int,
                       zones: int, out: Path) -> dict[str, Any]:
    """Create pilot organisations of up to 20 venues on staging through the staff pilot route
    (`POST /api/admin/business/pilots`) and write the seed file the staging runs read."""
    from business_kiosk_sim import HttpTransport

    transport = HttpTransport(base_url)
    world: dict[str, Any] = {"orgs": []}
    try:
        await transport.call("POST", "/api/admin/session", bearer=staff_token, label="seed")
        for start in range(0, venues, 20):
            body = {"owner_user_id": owner_user_id, "org_name": f"Stress group {start // 20}",
                    "pilot_days": 30,
                    "venues": [{"name": f"Stress venue {n}", "timezone": "Europe/London",
                                "country": "GB", "zones": [f"Zone {z}" for z in range(zones)]}
                               for n in range(start, min(venues, start + 20))]}
            made = await transport.call("POST", "/api/admin/business/pilots", body=body,
                                        bearer=staff_token, label="seed")
            if made.status != 201:
                raise SystemExit(f"Pilot creation refused: {made.status} {made.body}")
            pilot = made.body["pilot"]
            world["orgs"].append({
                "id": pilot["org"]["id"], "manager_token": "<owner token>",
                "venues": [{"id": v["id"], "zones": [z["id"] for z in v["zones"]]}
                           for v in pilot["venues"]],
            })
    finally:
        await transport.aclose()
    out.write_text(json.dumps(world, indent=1), "utf-8")
    return world


async def run_staging(name: str, base_url: str, seed: Path, owner_token: str, minutes: float,
                      out: Path) -> Report:
    """The full-size run: a real-time fleet against staging for `minutes`, while the person
    injects the scenario's event as infra/staging/README.md lists; then B1 to B9 and the
    heartbeat p95 are judged from what the kiosks observed."""
    from business_kiosk_sim import HttpTransport, RealClock

    scenario = SCENARIOS[name]
    world = json.loads(seed.read_text("utf-8"))
    transport = HttpTransport(base_url)
    clock = RealClock()
    trace = BusinessTrace()
    fleet = Fleet(clock, transport, trace)
    for org in world["orgs"]:
        for venue in org["venues"]:
            trace.venue_orgs[venue["id"]] = org["id"]
            for zone_id in venue["zones"]:
                trace.zone_venues[zone_id] = venue["id"]
                fleet.add(KioskSpec(org["id"], venue["id"], zone_id), owner_token, sign_every=1)
    report = Report(name, {"kiosks": len(fleet.kiosks), "minutes": minutes, "full": scenario.full})
    try:
        await run_fleet(fleet, clock.t() + minutes * 60)
    finally:
        await transport.aclose()
    from selecta.audit.business_trace import OpenWindow

    seen = {(k.spec.venue_id, opens, closes) for k in fleet.kiosks for opens, closes in k.windows}
    for venue_id, opens, closes in sorted(seen, key=lambda w: (w[0], w[1])):
        ends = datetime.fromtimestamp(closes, UTC) if closes else None
        trace.windows.append(OpenWindow(venue_id, datetime.fromtimestamp(opens, UTC), ends))
    p95 = transport.latency.p("heartbeat", 95)
    report.numbers["heartbeat_p95_ms"] = round(p95, 1)
    report.check("heartbeat p95 under 300 ms", p95 < 300, f"{p95:.1f} ms")
    found = check_trace(trace)
    report.check("B1 to B9 hold", not found, "; ".join(map(str, found[:5])))
    report.not_measured.append(f"scenario events are injected by the person: {scenario.title}")
    out.write_text(json.dumps(report.as_dict(), indent=2, default=str), "utf-8")
    return report


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = parser.add_subparsers(dest="mode", required=True)
    sub.add_parser("list")
    run = sub.add_parser("run")
    run.add_argument("name", choices=sorted(SCENARIOS))
    run.add_argument("--fake", action="store_true", required=True,
                     help="local scaled-down run; full size is infra/staging/run.py")
    run.add_argument("--out", type=Path)
    staging = sub.add_parser("staging", help="full-size run against staging (real time)")
    staging.add_argument("name", choices=sorted(SCENARIOS))
    staging.add_argument("--base-url", required=True)
    staging.add_argument("--seed", required=True, type=Path)
    staging.add_argument("--owner-token", required=True)
    staging.add_argument("--minutes", type=float, default=60)
    staging.add_argument("--out", required=True, type=Path)
    seed = sub.add_parser("seed", help="create pilot organisations on staging for the runs")
    seed.add_argument("--base-url", required=True)
    seed.add_argument("--staff-token", required=True)
    seed.add_argument("--owner-user-id", required=True)
    seed.add_argument("--venues", type=int, default=500)
    seed.add_argument("--zones", type=int, default=3)
    seed.add_argument("--out", required=True, type=Path)
    args, extra = parser.parse_known_args(argv)
    if args.mode in ("staging", "seed"):
        from business_kiosk_support import refuse_production

        refuse_production(args.base_url)
    if args.mode == "seed":
        asyncio.run(seed_staging(args.base_url, args.staff_token, args.owner_user_id,
                                 args.venues, args.zones, args.out))
        return 0
    if args.mode == "staging":
        done = asyncio.run(run_staging(args.name, args.base_url, args.seed, args.owner_token,
                                       args.minutes, args.out))
        return 0 if done.passed else 1
    if args.mode == "list":
        for s in SCENARIOS.values():
            print(f"{s.id:5} {s.name:26} {s.title} - local: {s.local_note}")
        return 0
    scenario = SCENARIOS[args.name]
    if scenario.local is None:
        print(f"{scenario.name} has no local run: {scenario.local_note}")
        return 2
    sizes = {extra[i].lstrip("-"): int(extra[i + 1]) for i in range(0, len(extra) - 1, 2)}
    report = scenario.local(**sizes).as_dict()
    text = json.dumps(report, indent=2, default=str)
    if args.out:
        args.out.write_text(text, "utf-8")
    print(text)
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
