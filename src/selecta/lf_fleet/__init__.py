"""Privacy-bounded local-engine fleet assessment and retirement planning (ADR-0479/0481).

No module in this package controls playback, retires services or accesses local media.
"""

from .operations import fleet_alerts
from .telemetry import EngineReport, FleetAssessment, Health, assess, fleet_summary

__all__ = [
    "EngineReport",
    "FleetAssessment",
    "Health",
    "assess",
    "fleet_summary",
    "fleet_alerts",
]
