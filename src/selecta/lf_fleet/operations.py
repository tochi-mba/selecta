"""Derived operational alerts without local media metadata or high-cardinality metric labels."""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
from datetime import datetime

from .telemetry import EngineReport, Health, assess


@dataclass(frozen=True, slots=True)
class FleetAlert:
    code: str
    affected: int
    severity: str

    def public_view(self) -> dict[str, object]:
        return {"code": self.code, "affected": self.affected, "severity": self.severity}


def fleet_alerts(
    reports: list[EngineReport],
    *,
    now: datetime,
    protocol_version: int = 1,
    supported_engine_major: int = 1,
) -> list[FleetAlert]:
    """An operator supplies already-authorised reports; the result contains counts only.

    Distinct venue counting is scoped by workspace, not just by a reused venue identifier.
    Device reconnect bursts are deduplicated by authenticated identity and server receipt.
    """
    newest: dict[tuple[str, str], EngineReport] = {}
    for report in reports:
        key = (report.workspace_id, report.device_id)
        if key not in newest or report.received_at > newest[key].received_at:
            newest[key] = report
    counts: Counter[str] = Counter()
    failing_venues: set[tuple[str, str]] = set()
    for report in newest.values():
        state = assess(report, now=now)
        if state.status in {Health.UNKNOWN, Health.OFFLINE}:
            counts["stale_agents"] += 1
        if state.status == Health.SILENT:
            counts["silent_outputs"] += 1
        if report.credential_expires_at is not None:
            if now >= report.credential_expires_at:
                counts["expired_credentials"] += 1
            elif (report.credential_expires_at - now).total_seconds() <= 86400:
                counts["expiring_credentials"] += 1
        if (
            report.protocol_version != protocol_version
            or int(report.engine_version.split(".")[0]) != supported_engine_major
        ):
            counts["incompatible_versions"] += 1
        if report.venue_id is not None and state.status != Health.HEALTHY:
            failing_venues.add((report.workspace_id, report.venue_id))
    counts["failing_venues"] = len(failing_venues)
    order = (
        ("stale_agents", "ticket"),
        ("silent_outputs", "page"),
        ("failing_venues", "page"),
        ("expired_credentials", "page"),
        ("expiring_credentials", "ticket"),
        ("incompatible_versions", "ticket"),
    )
    return [
        FleetAlert(code, counts[code], severity) for code, severity in order if counts[code] > 0
    ]
