"""ADR-0466: fenced local-engine playback ownership and safe transfers.

This opt-in module is independent of the legacy cloud heartbeat lease, which
remains untouched until local engine/control integration and release gates pass.
"""

from .contracts import (
    EnginePort,
    OutputObservation,
    Preflight,
    Scope,
    TransferRejected,
    TransferRequest,
    TransferSnapshot,
    TransferStage,
)
from .coordinator import TransferCoordinator
from .device import FencedLocalOutput, PhysicalAudioOutput
from .ledger import SQLiteOwnershipLedger
from .registry import LocalEngineRegistry

__all__ = [
    "EnginePort",
    "OutputObservation",
    "Preflight",
    "Scope",
    "TransferCoordinator",
    "TransferRejected",
    "TransferRequest",
    "TransferSnapshot",
    "TransferStage",
    "SQLiteOwnershipLedger",
    "FencedLocalOutput",
    "PhysicalAudioOutput",
    "LocalEngineRegistry",
]
