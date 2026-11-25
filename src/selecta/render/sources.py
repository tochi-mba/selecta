"""Where a part's audio comes from, named without a file path.

A script that travels to a cloud worker or a browser can't carry files, so each part names its
audio by song id and, for a separated stem, which stem and which stretch of the song. A
`SourceResolver` turns that name back into audio wherever the script is rendered.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

import numpy as np

STEM_NAMES = ("vocals", "drums", "bass", "other", "band")
"""The four separated stems, and `band`, which is drums, bass and other summed (`stems.band_of`)."""


@dataclass(frozen=True)
class SourceRef:
    """A song's full mix, or one stem of a window of it."""

    song: int | str
    role: str = "mix"
    stem: str | None = None
    start: float = 0.0
    duration: float = 0.0

    def __post_init__(self) -> None:
        if self.role not in ("mix", "stem"):
            raise ValueError(f"unknown source role {self.role!r}")
        if self.role == "stem" and self.stem not in STEM_NAMES:
            raise ValueError(f"unknown stem {self.stem!r}")

    def to_json(self) -> dict:
        # song ids are often numpy integers after a database read
        song = self.song if isinstance(self.song, str) else int(self.song)
        if self.role == "mix":
            return {"song": song, "role": "mix"}
        return {
            "song": song,
            "role": "stem",
            "stem": self.stem,
            "window": {"start": float(self.start), "duration": float(self.duration)},
        }

    @classmethod
    def from_json(cls, data: dict) -> SourceRef:
        if data.get("role") == "stem":
            window = data["window"]
            start, duration = float(window["start"]), float(window["duration"])
            return cls(data["song"], "stem", data["stem"], start, duration)
        return cls(data["song"], str(data.get("role", "mix")))


@dataclass(frozen=True)
class SongFacts:
    """The song facts a renderer needs for a part that came from JSON.

    Today that's only the loudness gain. It has no lyrics, so an audit of such a script needs
    vocal spans passed in, or it takes the careful path for unknown vocals.
    """

    id: int | str
    gain_db: float
    version: int = 0
    path: str | None = None
    vocals_known: bool = False
    lines: tuple = ()


class SourceResolver(Protocol):
    """Turns a source reference into decoded stereo audio at the engine rate, or a local path.

    `local_path` is the file the part was built with on this machine, if any."""

    def resolve(self, ref: SourceRef, local_path: str | None) -> np.ndarray | str: ...


class LocalFiles:
    """What Desktop has always done: the song's own file, or the stem file the part names."""

    def resolve(self, ref: SourceRef, local_path: str | None) -> np.ndarray | str:
        if not local_path:
            raise LookupError(f"no local file for {ref.to_json()}")
        return local_path
