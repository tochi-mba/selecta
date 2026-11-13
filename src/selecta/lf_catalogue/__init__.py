"""Independent, private local-first catalogue for engine, venue and recipe consumers.

The legacy `selecta.library` browse/search/correction/analysis APIs stay intact.
No cloud database migrations or hosted-media routes are required.
"""
from .catalogue import LocalCatalogue, ScanCancelled, UnsafeRecording
from .types import (
    Availability,
    MatchState,
    MixOccurrence,
    RecipeAvailability,
    RecordingRef,
    ScanProgress,
    SourceState,
)

__all__ = [
    "Availability",
    "LocalCatalogue",
    "MatchState",
    "MixOccurrence",
    "RecipeAvailability",
    "RecordingRef",
    "ScanCancelled",
    "ScanProgress",
    "SourceState",
    "UnsafeRecording",
]
