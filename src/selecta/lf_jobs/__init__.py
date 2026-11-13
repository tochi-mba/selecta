"""Device-local DSP scheduling contracts (ADR-0463).

No cloud path or hosted storage capability is imported by this package. Existing
Selecta handlers remain the single implementation of audio DSP.
"""

from .contract import (
    ExecutionReceipt,
    ExecutionRequest,
    JobKind,
    JobPriority,
    LocalSource,
    SourceResolver,
    ZoneDemand,
    validate_sources,
)
from .governor import DeviceResources, LocalResourceGovernor, Reservation

__all__ = [
    "ExecutionRequest",
    "ExecutionReceipt",
    "LocalSource",
    "JobPriority",
    "JobKind",
    "SourceResolver",
    "ZoneDemand",
    "validate_sources",
    "DeviceResources",
    "LocalResourceGovernor",
    "Reservation",
]
