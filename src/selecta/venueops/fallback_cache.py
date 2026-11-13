"""Ready-to-play fallback songs, fetched ahead of need (ADR-0429, AV-0429-02).

When the next planned song can't arrive in time (the network drops, the model stalls, a render
fails), the speaker plays a fallback instead of going silent. A fallback only counts if it is:

- rights-cleared for this venue,
- already rendered and analysed (no work left to do at the moment of need), and
- verified playable now: the file is there, it is not empty, it starts like audio and its
  content hash still matches the one recorded when it was analysed.

The cache never writes to an original song. It holds read-only references and re-reads the hash
before handing a song out, so a changed or missing file is dropped rather than played. A song
handed out is not offered again until the no-repeat window has passed, which keeps the
duplicate targets in `continuity` intact.
"""

from __future__ import annotations

import hashlib
from collections import deque
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from pathlib import Path

from selecta import flags
from selecta.venueops.continuity import NO_REPEAT_WINDOW_MIN

FLAG = "venue.continuity"
DEFAULT_DEPTH = 3  # how many verified fallbacks to keep ready

# First bytes of the audio containers Selecta reads. Anything else is not counted as playable.
AUDIO_MAGIC: tuple[bytes, ...] = (b"RIFF", b"ID3", b"fLaC", b"OggS", b"\xff\xfb", b"\xff\xf3",
                                  b"\xff\xf2", b"\xff\xf1", b"\xff\xf9")
_M4A_MARK = b"ftyp"


@dataclass(frozen=True)
class Candidate:
    """A song that might serve as a fallback. `sha256` is the hash recorded at analysis time."""

    song_id: str
    path: Path
    sha256: str
    rights_cleared: bool
    rendered: bool
    analysed: bool
    duration_s: float = 0.0


@dataclass(frozen=True)
class Rejection:
    song_id: str
    reason: str


def file_hash(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:  # read-only, never "r+b"
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def looks_like_audio(path: Path) -> bool:
    with path.open("rb") as handle:
        head = handle.read(12)
    if any(head.startswith(magic) for magic in AUDIO_MAGIC):
        return True
    return head[4:8] == _M4A_MARK


def check_playable(candidate: Candidate) -> str | None:
    """Why this candidate can't be played right now, or None when it can."""
    if not candidate.rights_cleared:
        return "not rights-cleared for this venue"
    if not candidate.rendered:
        return "not rendered yet"
    if not candidate.analysed:
        return "not analysed yet"
    path = Path(candidate.path)
    if not path.is_file():
        return "file is missing"
    if path.stat().st_size == 0:
        return "file is empty"
    if not looks_like_audio(path):
        return "file does not start like audio"
    if file_hash(path) != candidate.sha256:
        return "file changed since it was analysed"
    return None


Checker = Callable[[Candidate], "str | None"]


@dataclass
class FallbackCache:
    """Keeps `depth` verified fallbacks ready and hands them out without repeats."""

    depth: int = DEFAULT_DEPTH
    window_s: float = NO_REPEAT_WINDOW_MIN * 60.0
    checker: Checker = check_playable
    ready: deque[Candidate] = field(default_factory=deque)
    rejected: list[Rejection] = field(default_factory=list)
    handed_out: dict[str, float] = field(default_factory=dict)  # song_id -> night clock

    def _recent(self, song_id: str, now_s: float) -> bool:
        at = self.handed_out.get(song_id)
        return at is not None and now_s - at < self.window_s

    def prefetch(
        self,
        candidates: Iterable[Candidate],
        *,
        now_s: float = 0.0,
        avoid: Iterable[str] = (),
    ) -> int:
        """Top the ready list up to `depth` with verified songs. Returns how many are ready.

        `avoid` is the songs already planned or just played, so a fallback never duplicates them.
        """
        flags.require(FLAG)
        avoid_set = set(avoid) | {c.song_id for c in self.ready}
        for candidate in candidates:
            if len(self.ready) >= self.depth:
                break
            if candidate.song_id in avoid_set or self._recent(candidate.song_id, now_s):
                continue
            reason = self.checker(candidate)
            if reason is not None:
                self.rejected.append(Rejection(candidate.song_id, reason))
                continue
            self.ready.append(candidate)
            avoid_set.add(candidate.song_id)
        return len(self.ready)

    def take(self, *, now_s: float, avoid: Iterable[str] = ()) -> Candidate | None:
        """The next fallback to play, re-verified at the moment of need, or None if none is.

        A song that stopped being playable since prefetch (deleted, edited, rights withdrawn) is
        dropped and the next one is tried.
        """
        flags.require(FLAG)
        avoid_set = set(avoid)
        skipped: list[Candidate] = []
        chosen: Candidate | None = None
        while self.ready:
            candidate = self.ready.popleft()
            if candidate.song_id in avoid_set or self._recent(candidate.song_id, now_s):
                skipped.append(candidate)
                continue
            reason = self.checker(candidate)
            if reason is not None:
                self.rejected.append(Rejection(candidate.song_id, reason))
                continue
            chosen = candidate
            break
        self.ready.extendleft(reversed(skipped))
        if chosen is not None:
            self.handed_out[chosen.song_id] = now_s
        return chosen

    def withdraw(self, song_id: str, reason: str) -> None:
        """Drop a ready song, for example when its licence is withdrawn mid-night."""
        kept = [c for c in self.ready if c.song_id != song_id]
        if len(kept) != len(self.ready):
            self.rejected.append(Rejection(song_id, reason))
        self.ready = deque(kept)

    @property
    def ready_ids(self) -> list[str]:
        return [c.song_id for c in self.ready]

    def healthy(self) -> bool:
        """True when the cache is full, which is what a soak checks every few minutes."""
        return len(self.ready) >= self.depth
