"""The `bz_trace` fixture and small builders for recording venue behaviour (ADR-0454 gate P3).

Every business test that observes venue behaviour records what it saw into `bz_trace`; at
teardown the fixture runs `selecta.audit.business_invariants.assert_trace_clean`, so B1 to B9
hold after every business test. Use it in a test module with

    from bz_contract.invariants import bz_trace  # noqa: F401

The builders append one fact each and return it, so a test can read top to bottom like the
scenario it plays. All times must be aware datetimes; `at(...)` makes UTC ones quickly.

Contracts: `selecta.audit.business_trace` and `selecta.audit.business_invariants` are written
(not product code under construction), so they are imported directly.
"""

from __future__ import annotations

from collections.abc import Iterable, Iterator
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest

from selecta.audit.business_invariants import assert_trace_clean
from selecta.audit.business_trace import (
    AccessAttempt,
    AudioSpan,
    BusinessTrace,
    HorizonReport,
    LeaseSpan,
    Offboarding,
    OpenWindow,
    Payload,
    Play,
    PlayLogRow,
    Stop,
    StopReason,
    VolumeReport,
    Warning,
)

BASE = datetime(2026, 11, 13, 0, 0, tzinfo=UTC)


@pytest.fixture
def bz_trace() -> Iterator[BusinessTrace]:
    """A fresh trace for one test; B1 to B9 must hold over it when the test ends."""
    trace = BusinessTrace()
    yield trace
    assert_trace_clean(trace)


def at(hours: float = 0, minutes: float = 0, seconds: float = 0) -> datetime:
    """A UTC moment counted from 2026-11-13 00:00 UTC."""
    return BASE + timedelta(hours=hours, minutes=minutes, seconds=seconds)


def record_venue(
    trace: BusinessTrace, venue_id: str, org_id: str, zones: Iterable[str] = ()
) -> None:
    """Say which organisation a venue belongs to, and which zones it has."""
    trace.venue_orgs[venue_id] = org_id
    for zone_id in zones:
        trace.zone_venues[zone_id] = venue_id


def record_window(
    trace: BusinessTrace, venue_id: str, opens: datetime, closes: datetime | None
) -> OpenWindow:
    window = OpenWindow(venue_id, opens, closes)
    trace.windows.append(window)
    return window


def record_audio(
    trace: BusinessTrace, zone_id: str, device_id: str, start: datetime, end: datetime
) -> AudioSpan:
    span = AudioSpan(zone_id, device_id, start, end)
    trace.audio.append(span)
    return span


def record_horizon(
    trace: BusinessTrace, zone_id: str, device_id: str, moment: datetime, seconds_ahead: float
) -> HorizonReport:
    report = HorizonReport(zone_id, device_id, moment, seconds_ahead)
    trace.horizons.append(report)
    return report


def record_lease(
    trace: BusinessTrace, zone_id: str, device_id: str, start: datetime, end: datetime
) -> LeaseSpan:
    lease = LeaseSpan(zone_id, device_id, start, end)
    trace.leases.append(lease)
    return lease


def allow_snapshot(trace: BusinessTrace, snapshot_id: str, song_ids: Iterable[str]) -> None:
    trace.snapshot_allows[snapshot_id] = frozenset(song_ids)


def record_play(
    trace: BusinessTrace,
    play_id: str,
    *,
    zone_id: str,
    song_id: str,
    started: datetime,
    snapshot_id: str,
    venue_id: str | None = None,
    offline: bool = False,
    logged: bool = True,
) -> Play:
    """Record a play and, unless `logged=False`, its one play-log row (B7)."""
    venue = venue_id if venue_id is not None else trace.zone_venues.get(zone_id, "")
    play = Play(play_id, zone_id, venue, song_id, started, snapshot_id, offline)
    trace.plays.append(play)
    if logged:
        record_play_log(trace, play)
    return play


def record_play_log(trace: BusinessTrace, play: Play) -> PlayLogRow:
    row = PlayLogRow(play.play_id, play.venue_id, play.song_id, play.started)
    trace.play_log.append(row)
    return row


def record_payload(
    trace: BusinessTrace, surface: Any, body: Any, moment: datetime | None = None
) -> Payload:
    payload = Payload(surface, body, moment)
    trace.payloads.append(payload)
    return payload


def record_access(
    trace: BusinessTrace,
    *,
    actor_kind: Any,
    actor_id: str,
    actor_org: str,
    resource_org: str,
    in_scope: bool,
    succeeded: bool,
    moment: datetime | None = None,
) -> AccessAttempt:
    attempt = AccessAttempt(
        actor_kind, actor_id, actor_org, resource_org, in_scope, succeeded, moment
    )
    trace.access.append(attempt)
    return attempt


def record_warning(
    trace: BusinessTrace, org_id: str, kind: Any, moment: datetime, cause: Any = "billing"
) -> Warning:
    warning = Warning(org_id, kind, moment, cause)
    trace.warnings.append(warning)
    return warning


def record_grace_end(trace: BusinessTrace, org_id: str, moment: datetime) -> None:
    trace.grace_ends[org_id] = moment


def record_stop(
    trace: BusinessTrace,
    venue_id: str,
    moment: datetime,
    reason: StopReason,
    *,
    mid_song: bool = False,
) -> Stop:
    stop = Stop(venue_id, moment, reason, mid_song)
    trace.stops.append(stop)
    return stop


def record_offboarding(
    trace: BusinessTrace, person_id: str, removed_at: datetime, last_success: datetime | None
) -> Offboarding:
    record = Offboarding(person_id, removed_at, last_success)
    trace.offboardings.append(record)
    return record


def record_volume(
    trace: BusinessTrace,
    zone_id: str,
    device_id: str,
    moment: datetime,
    level: float,
    cap: float,
) -> VolumeReport:
    report = VolumeReport(zone_id, device_id, moment, level, cap)
    trace.volumes.append(report)
    return report
