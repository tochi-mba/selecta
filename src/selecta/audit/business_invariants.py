"""The nine business invariants B1 to B9 of ADR-0454, judged over a `BusinessTrace`.

ADR-0454 asks for B1 to B9 "next to the ten Cloud invariants" in `selecta.audit.invariants`,
"or registered proofs where the database cannot show them". Today every one of them is a
registered proof over a trace: B1, B3, B6 and B9 are about moments in time that no table holds,
and the business schema the others would read (play log, content snapshots, offboarding) has not
landed yet. So this module has no `check_db(connection)`; `NOT_CHECKED_IN_DB` says why for each
invariant, and the final test pass adds database checks once BZ-1 to BZ-5 have shipped tables.

Tests, the simulated kiosk client and the stress scenarios record what they observe into a
`selecta.audit.business_trace.BusinessTrace`; `check_trace` returns every violation and
`assert_trace_clean` fails with all of them at once (ADR-0454 gate P3).
"""

from __future__ import annotations

import re
from collections import Counter, defaultdict
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

from selecta.audit.business_trace import (
    AudioSpan,
    BusinessTrace,
    HorizonReport,
    OpenWindow,
    Stop,
)

NAMES: dict[str, str] = {
    "B1": (
        "No platform-caused silence. No zone inside opening hours is silent for more than 60 s "
        "while a playable cached horizon exists on its kiosk."
    ),
    "B2": (
        "No refused song plays. Every play-log row's song was allowed by the content snapshot "
        "it names (ADR-0450)."
    ),
    "B3": "One speaker per zone. No two devices hold or act on one zone's lease at once.",
    "B4": (
        "No manager state on customer screens. Kiosk, guest and display payloads contain only "
        "allowlisted fields."
    ),
    "B5": (
        "No cross-organisation or out-of-scope access succeeds, for people, kiosks or tablets."
    ),
    "B6": (
        "Billing and pilots never stop music mid-service. Playback stops for billing or a pilot "
        "end only at a venue's closing time after the grace or end date, and only after the "
        "72 h and 24 h warnings were sent."
    ),
    "B7": (
        "Play log exactly once. Every played song appears once in the play log, including songs "
        "played offline and uploaded later."
    ),
    "B8": (
        "Offboarding is complete. A removed person has no working session, device or PIN 30 s "
        "after removal."
    ),
    "B9": (
        "Volume never exceeds the cap reported by the kiosk at any time, including quiet-hours "
        "transitions."
    ),
}

NOT_CHECKED_IN_DB: dict[str, str] = {
    "B1": "Silence is a moment in time; only a trace of audio spans and horizons shows it.",
    "B2": "No business play-log or content-snapshot tables yet (ADR-0449, ADR-0450).",
    "B3": "Lease overlaps are moments in time; the lease table keeps only the current holder.",
    "B4": "Payloads are responses, not rows; checked on what customer surfaces received.",
    "B5": "Access attempts are requests, not rows; checked on what the tests attempted.",
    "B6": "Stops and warning sends are events in time; no business billing tables yet.",
    "B7": "No business play-log table yet (ADR-0449); checked on plays versus uploaded rows.",
    "B8": "Last working access is observed by probing after removal, not stored.",
    "B9": "Output level is reported by the kiosk at a moment; nothing stores it.",
}

MAX_SILENCE = timedelta(seconds=60)
"""B1: a zone may be silent this long inside opening hours, not longer."""
STOP_AT_CLOSE_TOLERANCE = timedelta(seconds=5)
"""B6: a billing or pilot stop counts as "at close" within this of the window's close."""
OFFBOARDING_LIMIT = timedelta(seconds=30)
"""B8: access must stop working this soon after removal."""
VOLUME_EPSILON = 1e-6
"""B9: float noise allowed above the cap."""

ENDING_REASONS = frozenset({"billing", "pilot_end"})

_SONG = frozenset({"song_id", "title", "artist", "length_s"})
_UPCOMING_ITEM = frozenset(
    {"request_id", "song", "status", "votes", "nickname", "voted", "mine", "text"}
)
_BRANDING = frozenset({"venue_name", "logo_url", "zone_name", "welcome_line", "accent", "theme"})

CUSTOMER_FIELDS: dict[str, frozenset[str]] = {
    # ADR-0445 kiosk view (`GET /api/kiosk/view`) and ADR-0453 D11: the S5 states, the calm
    # now-playing view, a silent saved-music mark, the Closed line with its opening time, a
    # small diagnostic code, the pairing screen (code, device name, QR) and the playback
    # settings the player needs (volume cap, fade).
    "kiosk": _SONG
    | _BRANDING
    | frozenset(
        {
            "state",
            "zone_id",
            "now_playing",
            "up_next",
            "position_s",
            "started_at",
            "ends_at",
            "saved_music",
            "offline",
            "opens_at",
            "next_opening",
            "time_zone",
            "message",
            "problem_code",
            "pairing_code",
            "expires_at",
            "paired",
            "device_name",
            "qr",
            "needs_tap",
            "paused",
            "updating",
            "screen_sleep",
            "volume_cap",
            "fade_s",
            "error",
        }
    ),
    # ADR-0416 guest view (`rooms/views.py` GuestView, `rooms/api_guest.py`) extended by
    # ADR-0451 (BrandedGuestHeader, requests paused, closed hours) and ADR-0453 D12.
    "guest": _SONG
    | _UPCOMING_ITEM
    | _BRANDING
    | frozenset(
        {
            "state",
            "status",
            "room",
            "room_id",
            "room_name",
            "room_status",
            "code",
            "join_path",
            "guest",
            "guest_status",
            "nickname",
            "nicknames",
            "names_shown",
            "votes_on",
            "requests_open",
            "requests_paused",
            "music_paused",
            "now_playing",
            "up_next",
            "coming_up",
            "waiting",
            "my_requests",
            "minutes_until",
            "songs",
            "results",
            "query",
            "already_queued",
            "became_vote",
            "banned",
            "song_gone",
            "room_ended",
            "opens_at",
            "message",
            "error",
        }
    ),
    # ADR-0416 zone display (`rooms/display.py` DisplayView) and ADR-0453 D12: the QR,
    # "Scan to request a song", now playing and upcoming requests.
    "display": _SONG
    | _UPCOMING_ITEM
    | _BRANDING
    | frozenset(
        {
            "state",
            "room_name",
            "code",
            "join_path",
            "qr",
            "now_playing",
            "up_next",
            "upcoming",
            "music_paused",
            "paired",
            "pairing_code",
            "expires_at",
            "flag",
            "message",
            "error",
        }
    ),
}

MANAGER_ONLY_KEYS: frozenset[str] = frozenset(
    {
        # Billing, seats, plans and pilots (ADR-0447, ADR-0448, ADR-0453 D4).
        "billing",
        "billing_state",
        "grace",
        "grace_ends_at",
        "grace_end",
        "invoice",
        "invoices",
        "card",
        "card_last4",
        "last4",
        "payment",
        "payment_state",
        "payment_method",
        "subscription",
        "stripe",
        "stripe_customer_id",
        "plan",
        "plan_locked",
        "seats",
        "seat_count",
        "over_seats",
        "pilot",
        "pilot_ends_at",
        "pilot_state",
        "trial",
        "po_number",
        "vat",
        "tax_id",
        # Licensing (ADR-0449).
        "licence",
        "license",
        "licence_state",
        "licence_expires_at",
        # Staff and people (ADR-0452).
        "staff",
        "staff_name",
        "staff_names",
        "manager",
        "manager_name",
        "owner",
        "owner_email",
        "email",
        "emails",
        "person_id",
        "people",
        "role",
        "roles",
        "permissions",
        "pin",
        "staff_pin",
        "session_token",
        "audit",
        "audit_log",
        # Device health and errors (ADR-0445, ADR-0453 D4).
        "health",
        "kiosk_health",
        "battery",
        "ip",
        "ip_address",
        "network",
        "app_version",
        "last_sync",
        "error_detail",
        "traceback",
        "stack",
        "exception",
        "manager_notice",
        "alerts",
        "org_id",
        "organisation",
        "organization",
    }
)
"""Keys that tell of manager, billing, staff or device state; never on a customer screen."""

MANAGER_KEY_TOKENS: frozenset[str] = frozenset(
    {
        "billing",
        "grace",
        "invoice",
        "card",
        "payment",
        "stripe",
        "subscription",
        "seat",
        "seats",
        "pilot",
        "licence",
        "license",
        "staff",
        "manager",
        "email",
        "role",
        "roles",
        "health",
        "audit",
        "traceback",
    }
)
"""A key with any of these `_`-separated words is manager state, whatever its full name."""

MANAGER_VALUE_WORDS: frozenset[str] = frozenset(
    {
        "billing",
        "invoice",
        "payment",
        "overdue",
        "grace",
        "stripe",
        "subscription",
        "licence",
        "license",
        "pilot",
        "seat",
        "seats",
        "traceback",
        "exception",
    }
)
"""Words a customer-facing string never contains (ADR-0453: never name a cause)."""

FREE_TEXT_KEYS: frozenset[str] = frozenset(
    {"title", "artist", "nickname", "room_name", "venue_name", "zone_name", "welcome_line"}
)
"""Values chosen by people (song metadata, names); not scanned for words ("Amazing Grace")."""

_EMAIL = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")
_WORD = re.compile(r"[a-z]+")


@dataclass(frozen=True)
class BusinessViolation:
    invariant: str
    detail: str

    def __str__(self) -> str:
        return f"{self.invariant}: {self.detail}"


class BusinessInvariantBroken(AssertionError):
    """One or more of B1 to B9 failed over a trace."""


def _when(moment: datetime | None) -> str:
    return moment.isoformat() if moment is not None else "unknown time"


# B1 ---------------------------------------------------------------------------------------


def _window_end(window: OpenWindow, trace: BusinessTrace, zone_spans: list[AudioSpan]) -> datetime:
    ends = [moment for moment in (window.closes, trace.observed_until) if moment is not None]
    if ends:
        return min(ends)
    later = [span.end for span in zone_spans if span.end > window.opens]
    return max(later, default=window.opens)


def _latest_horizon(reports: list[HorizonReport], before: datetime) -> HorizonReport | None:
    latest: HorizonReport | None = None
    for report in reports:
        if report.at <= before and (latest is None or report.at >= latest.at):
            latest = report
    return latest


def _gaps(
    spans: Iterable[AudioSpan], start: datetime, end: datetime
) -> list[tuple[datetime, datetime]]:
    gaps: list[tuple[datetime, datetime]] = []
    cursor = start
    for span in sorted(spans, key=lambda item: item.start):
        if span.end <= cursor:
            continue
        if span.start >= end:
            break
        if span.start > cursor:
            gaps.append((cursor, span.start))
        cursor = max(cursor, span.end)
    if cursor < end:
        gaps.append((cursor, end))
    return gaps


def no_platform_silence(trace: BusinessTrace) -> list[BusinessViolation]:
    """B1: silence over 60 s inside an open window while the last horizon before it was > 0 s."""
    audio: dict[str, list[AudioSpan]] = defaultdict(list)
    for span in trace.audio:
        audio[span.zone_id].append(span)
    horizons: dict[str, list[HorizonReport]] = defaultdict(list)
    for report in trace.horizons:
        horizons[report.zone_id].append(report)
    windows: dict[str, list[OpenWindow]] = defaultdict(list)
    for window in trace.windows:
        windows[window.venue_id].append(window)

    found: list[BusinessViolation] = []
    for zone_id, venue_id in sorted(trace.zone_venues.items()):
        spans = audio.get(zone_id, [])
        for window in windows.get(venue_id, []):
            end = _window_end(window, trace, spans)
            for gap_start, gap_end in _gaps(spans, window.opens, end):
                if gap_end - gap_start <= MAX_SILENCE:
                    continue
                horizon = _latest_horizon(horizons.get(zone_id, []), gap_start)
                if horizon is None or horizon.seconds_ahead <= 0:
                    continue
                silent = (gap_end - gap_start).total_seconds()
                found.append(
                    BusinessViolation(
                        "B1",
                        f"zone {zone_id} silent {silent:.0f} s from {_when(gap_start)} to "
                        f"{_when(gap_end)} inside opening hours while its kiosk "
                        f"{horizon.device_id} had {horizon.seconds_ahead:.0f} s saved "
                        f"(reported {_when(horizon.at)})",
                    )
                )
    return found


# B2 ---------------------------------------------------------------------------------------


def no_refused_song(trace: BusinessTrace) -> list[BusinessViolation]:
    """B2: every play's song was allowed by the content snapshot it names."""
    found: list[BusinessViolation] = []
    for play in trace.plays:
        allowed = trace.snapshot_allows.get(play.snapshot_id)
        if allowed is None:
            found.append(
                BusinessViolation(
                    "B2",
                    f"play {play.play_id} in zone {play.zone_id} names unknown content "
                    f"snapshot {play.snapshot_id}",
                )
            )
        elif play.song_id not in allowed:
            found.append(
                BusinessViolation(
                    "B2",
                    f"play {play.play_id} in zone {play.zone_id} played song {play.song_id}, "
                    f"refused by snapshot {play.snapshot_id}",
                )
            )
    return found


# B3 ---------------------------------------------------------------------------------------


def one_speaker_per_zone(trace: BusinessTrace) -> list[BusinessViolation]:
    """B3: no overlapping lease spans of different devices on one zone (touching is fine)."""
    by_zone: dict[str, list[Any]] = defaultdict(list)
    for lease in trace.leases:
        by_zone[lease.zone_id].append(lease)
    found: list[BusinessViolation] = []
    for zone_id in sorted(by_zone):
        active: list[Any] = []
        for lease in sorted(by_zone[zone_id], key=lambda item: (item.start, item.end)):
            active = [held for held in active if held.end > lease.start]
            for held in active:
                if held.device_id != lease.device_id and lease.start < lease.end:
                    found.append(
                        BusinessViolation(
                            "B3",
                            f"zone {zone_id}: devices {held.device_id} and {lease.device_id} "
                            f"both held the lease from {_when(lease.start)} to "
                            f"{_when(min(held.end, lease.end))}",
                        )
                    )
            active.append(lease)
    return found


# B4 ---------------------------------------------------------------------------------------


def _key_is_manager(key: str) -> bool:
    lowered = key.lower()
    if lowered in MANAGER_ONLY_KEYS:
        return True
    return any(token in MANAGER_KEY_TOKENS for token in re.split(r"[_\W]+", lowered) if token)


def _value_tells(text: str) -> str | None:
    if _EMAIL.search(text):
        return "an email address"
    for word in _WORD.findall(text.lower()):
        if word in MANAGER_VALUE_WORDS:
            return f"the word {word!r}"
    return None


def _scan(surface: str, value: Any, path: str, allowed: frozenset[str]) -> list[str]:
    problems: list[str] = []
    if isinstance(value, dict):
        for key, inner in value.items():
            key_text = str(key)
            where = f"{path}.{key_text}" if path else key_text
            if _key_is_manager(key_text):
                problems.append(f"manager-only key {where}")
            elif key_text not in allowed:
                problems.append(f"key {where} is not allowlisted for {surface}")
            if key_text in FREE_TEXT_KEYS and isinstance(inner, str):
                continue
            problems.extend(_scan(surface, inner, where, allowed))
    elif isinstance(value, (list, tuple, set, frozenset)):
        for index, inner in enumerate(value):
            problems.extend(_scan(surface, inner, f"{path}[{index}]", allowed))
    elif isinstance(value, str):
        tell = _value_tells(value)
        if tell is not None:
            problems.append(f"value at {path or '(root)'} contains {tell}")
    return problems


def no_manager_state_on_customer_screens(trace: BusinessTrace) -> list[BusinessViolation]:
    """B4: customer payloads carry only allowlisted keys and no manager words, at any depth."""
    found: list[BusinessViolation] = []
    for payload in trace.payloads:
        allowed = CUSTOMER_FIELDS.get(payload.surface)
        if allowed is None:
            found.append(BusinessViolation("B4", f"unknown customer surface {payload.surface!r}"))
            continue
        for problem in _scan(payload.surface, payload.body, "", allowed):
            found.append(
                BusinessViolation("B4", f"{payload.surface} payload at {_when(payload.at)}: "
                                  f"{problem}")
            )
    return found


# B5 ---------------------------------------------------------------------------------------


def no_out_of_scope_access(trace: BusinessTrace) -> list[BusinessViolation]:
    """B5: no successful access across organisations or outside the actor's role scope."""
    found: list[BusinessViolation] = []
    for attempt in trace.access:
        if not attempt.succeeded:
            continue
        reasons = []
        if attempt.actor_org != attempt.resource_org:
            reasons.append(
                f"crossed from organisation {attempt.actor_org} to {attempt.resource_org}"
            )
        if not attempt.in_scope:
            reasons.append("was outside its role or venue scope")
        if reasons:
            found.append(
                BusinessViolation(
                    "B5",
                    f"{attempt.actor_kind} {attempt.actor_id} succeeded at "
                    f"{_when(attempt.at)} but {' and '.join(reasons)}",
                )
            )
    return found


# B6 ---------------------------------------------------------------------------------------


def _open_window_at(trace: BusinessTrace, stop: Stop) -> OpenWindow | None:
    for window in trace.windows:
        if window.venue_id != stop.venue_id or stop.at < window.opens:
            continue
        if window.closes is None or stop.at < window.closes:
            return window
    return None


def _near_close(trace: BusinessTrace, stop: Stop) -> bool:
    return any(
        window.venue_id == stop.venue_id
        and window.closes is not None
        and abs(stop.at - window.closes) <= STOP_AT_CLOSE_TOLERANCE
        for window in trace.windows
    )


def billing_never_stops_mid_service(trace: BusinessTrace) -> list[BusinessViolation]:
    """B6: billing and pilot stops only at close, after grace, never mid-song, after warnings."""
    found: list[BusinessViolation] = []
    for stop in trace.stops:
        if stop.reason not in ENDING_REASONS:
            continue
        label = f"{stop.reason} stop of venue {stop.venue_id} at {_when(stop.at)}"

        def fail(detail: str, label: str = label) -> None:
            found.append(BusinessViolation("B6", f"{label} {detail}"))

        if stop.mid_song:
            fail("cut a song mid-play")
        if not _near_close(trace, stop):
            window = _open_window_at(trace, stop)
            if window is not None:
                closes = "no close (open 24 hours)" if window.closes is None else _when(
                    window.closes
                )
                fail(f"came inside an open window (opened {_when(window.opens)}, {closes})")
        org = trace.venue_orgs.get(stop.venue_id)
        if org is None:
            fail("is for a venue with no known organisation")
            continue
        grace_end = trace.grace_ends.get(org)
        if grace_end is None:
            fail(f"came with no recorded grace or pilot end for organisation {org}")
        elif stop.at < grace_end:
            fail(f"came before organisation {org}'s grace or pilot end {_when(grace_end)}")
        for kind in ("72h", "24h"):
            sent = [
                warning
                for warning in trace.warnings
                if warning.org_id == org
                and warning.cause == stop.reason
                and warning.kind == kind
                and warning.at <= stop.at
            ]
            if not sent:
                fail(f"came without a {kind} {stop.reason} warning to organisation {org}")
            elif len(sent) > 1:
                fail(f"followed {len(sent)} {kind} {stop.reason} warnings to {org}, not one")
    return found


# B7 ---------------------------------------------------------------------------------------


def play_log_exactly_once(trace: BusinessTrace) -> list[BusinessViolation]:
    """B7: every play has exactly one play-log row, and every row belongs to a play."""
    found: list[BusinessViolation] = []
    plays = Counter(play.play_id for play in trace.plays)
    rows = Counter(row.play_id for row in trace.play_log)
    for play_id, count in sorted(plays.items()):
        if count > 1:
            found.append(BusinessViolation("B7", f"play {play_id} was recorded {count} times"))
    by_id = {play.play_id: play for play in trace.plays}
    for play_id, play in sorted(by_id.items()):
        logged = rows.get(play_id, 0)
        how = " (played offline)" if play.offline else ""
        if logged == 0:
            found.append(
                BusinessViolation("B7", f"play {play_id}{how} of song {play.song_id} is missing "
                                  "from the play log")
            )
        elif logged > 1:
            found.append(
                BusinessViolation("B7", f"play {play_id}{how} appears {logged} times in the "
                                  "play log")
            )
    for row in trace.play_log:
        play = by_id.get(row.play_id)
        if play is None:
            found.append(
                BusinessViolation("B7", f"play-log row {row.play_id} has no matching play")
            )
        elif (row.venue_id, row.song_id) != (play.venue_id, play.song_id):
            found.append(
                BusinessViolation(
                    "B7",
                    f"play-log row {row.play_id} says song {row.song_id} in venue "
                    f"{row.venue_id}, but the play was song {play.song_id} in {play.venue_id}",
                )
            )
    return found


# B8 ---------------------------------------------------------------------------------------


def offboarding_complete(trace: BusinessTrace) -> list[BusinessViolation]:
    """B8: a removed person's last working access is no later than 30 s after removal."""
    found: list[BusinessViolation] = []
    for record in trace.offboardings:
        if record.last_success is None:
            continue
        late = record.last_success - record.removed_at
        if late > OFFBOARDING_LIMIT:
            found.append(
                BusinessViolation(
                    "B8",
                    f"person {record.person_id} still had working access "
                    f"{late.total_seconds():.0f} s after removal at {_when(record.removed_at)}",
                )
            )
    return found


# B9 ---------------------------------------------------------------------------------------


def volume_within_cap(trace: BusinessTrace) -> list[BusinessViolation]:
    """B9: every reported output level is at or under the cap reported with it."""
    return [
        BusinessViolation(
            "B9",
            f"zone {report.zone_id} on {report.device_id} at {_when(report.at)} played at "
            f"{report.level:.3f}, over its cap {report.cap:.3f}",
        )
        for report in trace.volumes
        if report.level > report.cap + VOLUME_EPSILON
    ]


CHECKS: dict[str, Callable[[BusinessTrace], list[BusinessViolation]]] = {
    "B1": no_platform_silence,
    "B2": no_refused_song,
    "B3": one_speaker_per_zone,
    "B4": no_manager_state_on_customer_screens,
    "B5": no_out_of_scope_access,
    "B6": billing_never_stops_mid_service,
    "B7": play_log_exactly_once,
    "B8": offboarding_complete,
    "B9": volume_within_cap,
}


def check_trace(trace: BusinessTrace) -> list[BusinessViolation]:
    """Every violation of B1 to B9 in the trace, in invariant order."""
    found: list[BusinessViolation] = []
    for check in CHECKS.values():
        found.extend(check(trace))
    return found


def assert_trace_clean(trace: BusinessTrace) -> None:
    """Raise `BusinessInvariantBroken` listing every violation, or return quietly."""
    found = check_trace(trace)
    if found:
        lines = "\n".join(f"  {violation} [{NAMES[violation.invariant]}]" for violation in found)
        raise BusinessInvariantBroken(f"{len(found)} business invariant violation(s):\n{lines}")
