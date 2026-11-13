"""Venue health: audio instruments, operator alerts, runbooks, redaction and recovery rehearsal.

ADR-0436 (AV-0436-01 to AV-0436-05). Five parts:

1. Instruments (`VENUE_SERIES`). Gap length, buffer underruns, seconds of audio ready ahead, the
   speaker lease state, render queue lag and model latency, written as `observability.metrics`
   `Series` so the same names, kinds and label rules apply (no ids in labels). They are kept in
   their own table rather than added to `metrics.SERIES`, whose owner checks every series there
   against the cloud alert rules; `HealthMonitor` holds the latest values in process, and
   `metrics_snapshot()` hands them to any exporter.
2. Alerts (`ALERTS`). Each instrument has warning and critical thresholds and the direction that
   is bad; `evaluate()` turns a snapshot into alerts. Planned, prepared, playing and audible are
   reported separately (`PlaybackStatus`), so "playing" on screen with silence in the room is an
   alert of its own.
3. Runbooks. Every alert links to `docs/autopilot/runbooks/<id>.md`, written for the person on
   shift: what it means, what to check, what to do, when to escalate. A test checks every link.
4. Redaction (`redact`, `redact_text`). Built on `authz.audit.scrub`, plus what a venue log adds:
   file paths, guest nicknames and, when the venue's policy says so, song titles and artists.
5. Rehearsal (`rehearse`). A deterministic simulator injects each incident into a simulated night,
   lets the alerts fire, applies the runbook's first action after a set response time and records
   time to detect and time to recover. A real rehearsal with a person on shift is a person step.

Flag: `venue.health`.
"""

from __future__ import annotations

import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from enum import StrEnum
from pathlib import Path

from selecta.authz.audit import REDACTED, scrub, scrub_text
from selecta.observability.metrics import Series

FLAG = "venue.health"
RUNBOOKS = Path(__file__).resolve().parents[3] / "docs" / "autopilot" / "runbooks"

VENUE_SERIES: Mapping[str, Series] = {
    s.name: s
    for s in (
        Series("selecta_venue_gap_ms", "histogram",
               "Silence between two songs that reached a speaker, in milliseconds.", unit="ms"),
        Series("selecta_venue_underruns_total", "counter",
               "Audio buffer underruns on the playing speaker, by zone.", ("zone",)),
        Series("selecta_venue_buffer_ahead_seconds", "gauge",
               "Seconds of audio ready to play ahead of the playhead, by zone.", ("zone",), "s"),
        Series("selecta_venue_lease_state", "gauge",
               "Speaker lease: 1 held by one speaker, 0 none, 2 or more contested, by zone.",
               ("zone",)),
        Series("selecta_venue_render_queue_lag_seconds", "gauge",
               "How far the oldest needed render is behind when it is needed.", unit="s"),
        Series("selecta_venue_model_latency_seconds", "histogram",
               "Planner or analysis model call time, by model kind.", ("model",), "s"),
        Series("selecta_venue_audible", "gauge",
               "1 when the room monitor hears audio while the player says playing, by zone.",
               ("zone",)),
    )
}


class Severity(StrEnum):
    INFO = "info"
    WARNING = "warning"
    CRITICAL = "critical"


@dataclass(frozen=True)
class AlertRule:
    alert_id: str
    signal: str
    """A key in a health snapshot."""
    warning: float
    critical: float
    bad_when: str
    """"above" or "below"."""
    summary: str

    @property
    def runbook(self) -> str:
        return f"docs/autopilot/runbooks/{self.alert_id}.md"

    def severity(self, value: float) -> Severity | None:
        worse = (lambda v, t: v >= t) if self.bad_when == "above" else (lambda v, t: v <= t)
        if worse(value, self.critical):
            return Severity.CRITICAL
        if worse(value, self.warning):
            return Severity.WARNING
        return None


ALERTS: tuple[AlertRule, ...] = (
    AlertRule("dead-air", "gap_ms", 250, 2_000, "above",
              "Silence between songs longer than a tight cut."),
    AlertRule("buffer-low", "buffer_ahead_s", 20, 5, "below",
              "Little audio is ready ahead of the playhead."),
    AlertRule("underruns", "underruns_per_min", 1, 5, "above",
              "The speaker ran out of audio mid-song."),
    AlertRule("lease-conflict", "lease_holders", 2, 2, "above",
              "More than one speaker thinks it owns the zone."),
    AlertRule("render-lag", "render_queue_lag_s", 30, 120, "above",
              "Transitions are not rendered before they are needed."),
    AlertRule("model-slow", "model_latency_s", 5, 20, "above",
              "The planner or an analysis model is answering slowly."),
    AlertRule("not-audible", "silent_while_playing_s", 3, 10, "above",
              "The player says playing but the room monitor hears nothing."),
    AlertRule("rights-expiring", "rights_expiring_days", 7, 1, "below",
              "A licence the night depends on expires soon."),
    AlertRule("device-fault", "device_faults", 1, 3, "above",
              "Paired devices are reporting faults."),
)


@dataclass(frozen=True)
class Alert:
    alert_id: str
    severity: Severity
    value: float
    summary: str
    runbook: str


def evaluate(snapshot: Mapping[str, float], rules: Sequence[AlertRule] = ALERTS) -> list[Alert]:
    """Alerts for one health snapshot, critical first. Missing signals raise nothing."""
    found = []
    for rule in rules:
        if rule.signal not in snapshot:
            continue
        severity = rule.severity(float(snapshot[rule.signal]))
        if severity is not None:
            found.append(Alert(rule.alert_id, severity, float(snapshot[rule.signal]),
                               rule.summary, rule.runbook))
    return sorted(found, key=lambda a: a.severity is not Severity.CRITICAL)


class PlaybackStatus(StrEnum):
    PLANNED = "planned"
    PREPARED = "prepared"
    PLAYING = "playing"
    AUDIBLE = "audible"


def status(*, planned: bool, prepared: bool, playing: bool, audible: bool | None) -> PlaybackStatus:
    """The furthest honest status: audible only when the room monitor confirms it."""
    if playing and audible:
        return PlaybackStatus.AUDIBLE
    if playing:
        return PlaybackStatus.PLAYING
    if prepared:
        return PlaybackStatus.PREPARED
    if planned:
        return PlaybackStatus.PLANNED
    raise ValueError("Nothing is planned.")


@dataclass
class HealthMonitor:
    """Latest instrument values, in process. Label values must be zone or model kinds, not ids."""

    values: dict[tuple[str, tuple[tuple[str, str], ...]], float] = field(default_factory=dict)

    def record(self, name: str, value: float, **labels: str) -> None:
        series = VENUE_SERIES.get(name)
        if series is None:
            raise KeyError(f"{name} is not a venue health series.")
        if set(labels) != set(series.labels):
            raise ValueError(f"{name} takes the labels {series.labels}, not {tuple(labels)}.")
        key = (name, tuple(sorted(labels.items())))
        if series.kind == "counter":
            self.values[key] = self.values.get(key, 0.0) + value
        else:
            self.values[key] = value

    def metrics_snapshot(self) -> list[dict[str, object]]:
        return [
            {"name": name, "labels": dict(labels), "value": value}
            for (name, labels), value in sorted(self.values.items())
        ]


# ---- AV-0436-04: redaction --------------------------------------------------------------------


@dataclass(frozen=True)
class RedactionPolicy:
    hide_titles: bool = True
    """Song titles and artists leave logs unless the venue's policy allows them."""
    guest_names: frozenset[str] = frozenset()
    """Nicknames guests gave tonight; removed wherever they appear."""


_PATH = re.compile(r"(?:[A-Za-z]:[\\/]|\\\\|/(?:home|Users|mnt|var|tmp|srv|media)/)[^\s\"',;]+")
_MEDIA_KEYS = re.compile(r"(title|artist|album|path|file|filename|guest|nickname)", re.I)
MEDIA = "[media]"
PATH = "[path]"
GUEST = "[guest]"


def redact_text(text: str, policy: RedactionPolicy | None = None,
                titles: Sequence[str] = ()) -> str:
    """Free text with secrets, paths, guest names and (by policy) known titles removed."""
    if policy is None:
        policy = RedactionPolicy()
    out = scrub_text(text) or ""
    out = _PATH.sub(PATH, out)
    for name in sorted(policy.guest_names, key=len, reverse=True):
        if name:
            out = re.sub(re.escape(name), GUEST, out, flags=re.I)
    if policy.hide_titles:
        for title in sorted(titles, key=len, reverse=True):
            if title:
                out = re.sub(re.escape(title), MEDIA, out, flags=re.I)
    return out


def redact(record: Mapping[str, object], policy: RedactionPolicy | None = None) -> dict:
    """A structured log record made safe: secrets via `authz.audit.scrub`, media and guest
    fields by key, and free-text values through `redact_text`."""
    if policy is None:
        policy = RedactionPolicy()
    titles = [str(v) for k, v in record.items() if re.search("title|artist", k, re.I) and v]
    cleaned = scrub(dict(record))
    out: dict[str, object] = {}
    for key, value in cleaned.items():
        if value == REDACTED:
            out[key] = value
        elif _MEDIA_KEYS.search(key):
            if re.search("guest|nickname", key, re.I):
                out[key] = GUEST
            elif re.search("path|file", key, re.I):
                out[key] = PATH
            else:
                out[key] = MEDIA if policy.hide_titles else value
        elif isinstance(value, str):
            out[key] = redact_text(value, policy, titles)
        else:
            out[key] = value
    return out


# ---- AV-0436-05: incident recovery rehearsal --------------------------------------------------


@dataclass(frozen=True)
class Scenario:
    name: str
    alert_id: str
    """The alert this incident should raise."""
    signal: str
    bad_value: float
    good_value: float
    recovery: str
    """The runbook's first action, applied in the simulation."""
    fix_s: float
    """How long that action takes to restore health once started."""


SCENARIOS: tuple[Scenario, ...] = (
    Scenario("network loss", "buffer-low", "buffer_ahead_s", 3, 60,
             "play from the offline fallback set", 4),
    Scenario("render stall", "render-lag", "render_queue_lag_s", 180, 0,
             "switch to plain crossfades until the queue drains", 6),
    Scenario("two speakers own the zone", "lease-conflict", "lease_holders", 2, 1,
             "fence the stale speaker by bumping the lease epoch", 2),
    Scenario("model timeout", "model-slow", "model_latency_s", 30, 1,
             "use the rule-based next-song choice", 3),
    Scenario("speaker silent", "not-audible", "silent_while_playing_s", 12, 0,
             "move the zone to the standby speaker", 8),
)


@dataclass(frozen=True)
class RehearsalResult:
    scenario: str
    alert_raised: bool
    detected_after_s: float | None
    recovered_after_s: float | None
    action: str


def rehearse(
    scenarios: Sequence[Scenario] = SCENARIOS,
    *,
    poll_s: float = 1.0,
    response_s: float = 5.0,
    fault_at_s: float = 10.0,
    horizon_s: float = 300.0,
) -> list[RehearsalResult]:
    """Run each incident in simulated time: health is polled every `poll_s`, the fault starts at
    `fault_at_s`, the on-shift response starts `response_s` after the first alert and takes the
    scenario's `fix_s`. Records time to detect and time to recover from the fault's start."""
    rules = {r.alert_id: r for r in ALERTS}
    results = []
    for sc in scenarios:
        rule = rules[sc.alert_id]
        detected = recovered = None
        fixed_at = None
        t = 0.0
        while t <= horizon_s:
            faulty = t >= fault_at_s and (fixed_at is None or t < fixed_at)
            value = sc.bad_value if faulty else sc.good_value
            alerts = evaluate({sc.signal: value}, (rule,))
            if alerts and detected is None:
                detected = t
                fixed_at = t + response_s + sc.fix_s
            if detected is not None and not alerts and recovered is None:
                recovered = t
                break
            t += poll_s
        results.append(RehearsalResult(
            sc.name, detected is not None,
            None if detected is None else detected - fault_at_s,
            None if recovered is None else recovered - fault_at_s,
            sc.recovery,
        ))
    return results


def rehearsal_report(results: Sequence[RehearsalResult]) -> str:
    lines = ["| Incident | Alert raised | Detected after (s) | Recovered after (s) | Action |",
             "|---|---|---|---|---|"]
    for r in results:
        lines.append(f"| {r.scenario} | {'yes' if r.alert_raised else 'no'} | "
                     f"{r.detected_after_s} | {r.recovered_after_s} | {r.action} |")
    return "\n".join(lines)


__all__ = [
    "ALERTS", "FLAG", "RUNBOOKS", "SCENARIOS", "VENUE_SERIES", "Alert", "AlertRule",
    "HealthMonitor", "PlaybackStatus", "RedactionPolicy", "RehearsalResult", "Scenario",
    "Severity", "evaluate", "redact", "redact_text", "rehearsal_report", "rehearse", "status",
]


def main() -> None:
    print(rehearsal_report(rehearse()))


if __name__ == "__main__":
    main()
