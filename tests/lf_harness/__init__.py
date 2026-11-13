"""Reusable, standard-library-only Selecta local-first fault and contract harness.

These utilities test *harness behaviour*. They do not verify Selecta production
behaviour until an explicitly supplied real adapter is run through acceptance.
"""

from .audio import AudioFixture, corrupt_wave, make_synthetic_wave
from .contracts import (
    ContractViolation,
    EngineAdapter,
    assert_availability_contract,
    assert_command_contract,
)
from .evidence import Evidence, EvidenceLedger
from .fixtures import Device, Fleet, make_five_of_eight_fleet
from .network import DeterministicNetwork, VirtualClock
from .playback import OutputSafetyMonitor, PlaybackObservation, TakeoverScenario
from .venues import OpeningHours, VenueClock, VenueSimulation

__all__ = [
    "AudioFixture",
    "ContractViolation",
    "DeterministicNetwork",
    "Device",
    "EngineAdapter",
    "Evidence",
    "EvidenceLedger",
    "Fleet",
    "OpeningHours",
    "OutputSafetyMonitor",
    "PlaybackObservation",
    "TakeoverScenario",
    "VenueClock",
    "VenueSimulation",
    "VirtualClock",
    "assert_availability_contract",
    "assert_command_contract",
    "corrupt_wave",
    "make_five_of_eight_fleet",
    "make_synthetic_wave",
]
