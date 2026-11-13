"""Thin local-first bridge to the existing immutable Autopilot horizon model.

This adapter does not change Agent 08's audio ownership or Agent 05's job scheduler.
"""
from __future__ import annotations

from selecta.autopilot.horizon import Horizon
from selecta.lf_venue import VenueEngine


def submit_horizon(engine: VenueEngine, workspace_id: str, venue_id: str, zone_id: str,
                   horizon: Horizon) -> dict:
    """Preserve committed/locked IDs; send metadata to device-local preflight only."""
    return engine.plan(workspace_id, venue_id, zone_id,
                       [slot.track_id for slot in horizon.sequence])
