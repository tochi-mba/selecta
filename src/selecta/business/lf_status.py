"""Privacy-safe venue HQ status contract. This never includes local media paths."""
from __future__ import annotations

from selecta.lf_venue import VenueEngine


def device_status(engine: VenueEngine, workspace: str, venue_id: str, zone_id: str) -> dict:
    health = engine.diagnose(workspace, venue_id, zone_id)
    return {
        'zone_id': zone_id,
        'state': health.state,
        'actual_output': health.actual_output,
        'fallback_runway_seconds': health.fallback_runway_s,
        'missing_recording_ids': list(health.missing_sources),
        'committed_ids': list(health.committed),
        'prepared_ids': list(health.prepared),
        'planned_ids': list(health.planned),
        'last_physical_output_verification': health.last_verified_at,
        'reason': health.reason,
        'physical_hardware_gate': health.physical_hardware_gate,
    }
