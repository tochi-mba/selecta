"""One immutable mix contract shared by the local app and SelectaDJ Cloud (ADR-0418, AV-0418-02).

A mix revision is a frozen value: an ordered list of songs, the seam planned into each song after
the first, and where the plan came from. Nothing in a contract changes after it is made: an edit
makes a new revision whose `parent` names the one it was made from, and every revision's id is a
hash of its contents, so the same songs and seams always carry the same revision id and two
different revisions never share one.

Both sides speak it:

- the local app through `from_local_mix`, which reads what `mix.read_mix` returns (the local
  planner's own seam settings, untouched) without changing the local mix or its storage;
- the Cloud through `selecta.cloud_mixes`, which builds contracts from Cloud Library assets.

Seams are honest about what they know. `plan_seam` only calls a seam intelligent when both songs
have tempo and key facts; otherwise it is a plain crossfade with `basis="unanalysed"`, never
dressed up as DJ mixing (ADR-0418 decision). The local app's richer planner (`planner/`) stays the
authority for local seams: `from_local_mix` records its settings with `basis="planner"`.
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field, replace
from typing import Any

CONTRACT_VERSION = 1
SOURCES = ("local", "cloud")
BASES = ("planner", "tempo_key", "unanalysed")
NAME_LIMIT = 60
MAX_SONGS = 200

# Tempo ratio and key distance a seam can bridge with a beat-matched blend.
BLEND_TEMPO_GAP = 0.06
SHORT_BLEND_TEMPO_GAP = 0.12


class ContractError(ValueError):
    """A contract that would break one of its own rules."""


@dataclass(frozen=True)
class SongFacts:
    """What the planner needs to know about a song. Any field may be unknown (None)."""

    bpm: float | None = None
    camelot: str | None = None
    energy: float | None = None

    @property
    def analysed(self) -> bool:
        return bool(self.bpm and self.bpm > 0 and _camelot_ok(self.camelot))


@dataclass(frozen=True)
class SongRef:
    """One song in a mix. `id` is a local song id or a Cloud asset id, as text."""

    source: str
    id: str
    title: str
    artist: str | None = None
    duration: float | None = None
    sha256: str | None = None
    facts: SongFacts = field(default_factory=SongFacts)

    def __post_init__(self) -> None:
        if self.source not in SOURCES:
            raise ContractError(f"Unknown song source {self.source!r}")
        if not self.id:
            raise ContractError("A song needs an id")


@dataclass(frozen=True)
class SeamPlan:
    """The planned way into song `into` from the song before it."""

    into: int
    method: str
    bars: int
    basis: str
    intelligent: bool
    reason: str
    settings: str = "{}"  # canonical JSON of the local planner's seam settings, when it has any

    def __post_init__(self) -> None:
        if self.basis not in BASES:
            raise ContractError(f"Unknown seam basis {self.basis!r}")
        if self.into < 1:
            raise ContractError("A seam leads into the second song or later")
        if self.intelligent and self.basis == "unanalysed":
            raise ContractError("An unanalysed seam cannot claim to be intelligent")


@dataclass(frozen=True)
class MixContract:
    mix_id: str
    name: str
    source: str
    songs: tuple[SongRef, ...]
    seams: tuple[SeamPlan, ...]
    number: int = 1
    parent: str | None = None
    version: int = CONTRACT_VERSION

    def __post_init__(self) -> None:
        if self.version != CONTRACT_VERSION or isinstance(self.version, bool):
            raise ContractError(f"Unsupported legacy mix contract version {self.version!r}")
        if self.source not in SOURCES:
            raise ContractError(f"Unknown mix source {self.source!r}")
        if not self.name.strip() or len(self.name) > NAME_LIMIT:
            raise ContractError(f"A mix name is 1 to {NAME_LIMIT} characters")
        if len(self.songs) > MAX_SONGS:
            raise ContractError(f"A mix holds at most {MAX_SONGS} songs")
        if any(song.source != self.source for song in self.songs):
            raise ContractError("Every song in a mix comes from the mix's own source")
        if tuple(seam.into for seam in self.seams) != tuple(range(1, len(self.songs))):
            raise ContractError("Each song after the first needs exactly one seam into it")
        if self.number < 1 or (self.number == 1) != (self.parent is None):
            raise ContractError("Only the first revision has no parent")

    @property
    def revision(self) -> str:
        """The content hash: same contents, same id; any change, a new id."""
        return hashlib.sha256(canonical(self.body()).encode("utf-8")).hexdigest()

    @property
    def intelligent_seams(self) -> int:
        return sum(1 for seam in self.seams if seam.intelligent)

    def body(self) -> dict[str, Any]:
        return {
            "version": self.version,
            "mix_id": self.mix_id,
            "name": self.name,
            "source": self.source,
            "number": self.number,
            "parent": self.parent,
            "songs": [_song_json(song) for song in self.songs],
            "seams": [_seam_json(seam) for seam in self.seams],
        }

    def to_json(self) -> dict[str, Any]:
        return {
            **self.body(),
            "revision": self.revision,
            "intelligent_seams": self.intelligent_seams,
        }

    def edited(self, *, songs: Sequence[SongRef], name: str | None = None) -> MixContract:
        """The next revision with these songs, re-planned; this one is left exactly as it was."""
        return replace(
            self,
            name=self.name if name is None else name,
            songs=tuple(songs),
            seams=plan_seams(songs),
            number=self.number + 1,
            parent=self.revision,
        )


def canonical(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def _camelot_ok(code: str | None) -> bool:
    if not code or len(code) < 2 or code[-1] not in "AB" or not code[:-1].isdigit():
        return False
    return 1 <= int(code[:-1]) <= 12


def _song_json(song: SongRef) -> dict[str, Any]:
    return {
        "source": song.source,
        "id": song.id,
        "title": song.title,
        "artist": song.artist,
        "duration": song.duration,
        "sha256": song.sha256,
        "facts": {
            "bpm": song.facts.bpm,
            "camelot": song.facts.camelot,
            "energy": song.facts.energy,
        },
    }


def _seam_json(seam: SeamPlan) -> dict[str, Any]:
    return {
        "into": seam.into,
        "method": seam.method,
        "bars": seam.bars,
        "basis": seam.basis,
        "intelligent": seam.intelligent,
        "reason": seam.reason,
        "settings": json.loads(seam.settings),
    }


def plan_seam(into: int, a: SongFacts, b: SongFacts) -> SeamPlan:
    """A seam from tempo and key alone, or a plain crossfade when either song is unanalysed."""
    if not (a.analysed and b.analysed):
        return SeamPlan(
            into,
            "crossfade",
            0,
            "unanalysed",
            False,
            "Plain crossfade: tempo and key are not known for both songs yet.",
        )
    from selecta.analysis.key import camelot_distance

    gap = abs(float(a.bpm) / float(b.bpm) - 1.0)  # type: ignore[arg-type]
    distance = camelot_distance(str(a.camelot), str(b.camelot))
    if gap <= BLEND_TEMPO_GAP and distance <= 1:
        return SeamPlan(into, "blend", 16, "tempo_key", True, "Close tempo and matching key.")
    if gap <= SHORT_BLEND_TEMPO_GAP:
        return SeamPlan(
            into, "blend", 4, "tempo_key", True, "Close tempo; a short blend keeps keys apart."
        )
    return SeamPlan(into, "cut", 0, "tempo_key", True, "Tempos too far apart to blend.")


def plan_seams(songs: Sequence[SongRef]) -> tuple[SeamPlan, ...]:
    return tuple(
        plan_seam(index, songs[index - 1].facts, songs[index].facts)
        for index in range(1, len(songs))
    )


def new_contract(mix_id: str, name: str, source: str, songs: Iterable[SongRef]) -> MixContract:
    songs = tuple(songs)
    return MixContract(mix_id, name.strip(), source, songs, plan_seams(songs))


def from_json(data: Mapping[str, Any]) -> MixContract:
    """Read a stored contract back. Refuses one whose contents no longer match its revision id."""
    songs = tuple(
        SongRef(
            source=song["source"],
            id=str(song["id"]),
            title=song["title"],
            artist=song.get("artist"),
            duration=song.get("duration"),
            sha256=song.get("sha256"),
            facts=SongFacts(**(song.get("facts") or {})),
        )
        for song in data["songs"]
    )
    seams = tuple(
        SeamPlan(
            into=seam["into"],
            method=seam["method"],
            bars=seam["bars"],
            basis=seam["basis"],
            intelligent=seam["intelligent"],
            reason=seam["reason"],
            settings=canonical(seam.get("settings") or {}),
        )
        for seam in data["seams"]
    )
    contract = MixContract(
        mix_id=data["mix_id"],
        name=data["name"],
        source=data["source"],
        songs=songs,
        seams=seams,
        number=data["number"],
        parent=data.get("parent"),
        version=data.get("version", CONTRACT_VERSION),
    )
    stored = data.get("revision")
    if stored is not None and stored != contract.revision:
        raise ContractError("This revision's contents do not match its id")
    return contract


def from_local_mix(mix_id: str, name: str, items: Sequence[Mapping[str, Any]]) -> MixContract:
    """The local mix as `mix.read_mix` returns it, as a contract. Read-only: the local planner's
    seam settings are recorded as they are, never re-planned, and nothing local is written."""
    songs = tuple(
        SongRef(
            source="local",
            id=str(item["song_id"]),
            title=item.get("title") or "Untitled",
            artist=item.get("artist"),
            duration=item.get("duration"),
            facts=SongFacts(item.get("bpm"), item.get("key"), item.get("energy")),
        )
        for item in items
    )
    seams = []
    for index in range(1, len(items)):
        seam = items[index].get("seam") or {}
        settings = dict(seam.get("settings") or {})
        method = str(settings.get("method") or settings.get("style") or "planner")
        seams.append(
            SeamPlan(
                into=index,
                method=method,
                bars=int(settings.get("bars") or 0),
                basis="planner",
                intelligent=True,
                reason="Planned by the local SelectaDJ planner.",
                settings=canonical(settings),
            )
        )
    return MixContract(mix_id, name, "local", songs, tuple(seams))


__all__ = [
    "BASES",
    "CONTRACT_VERSION",
    "ContractError",
    "MixContract",
    "SeamPlan",
    "SongFacts",
    "SongRef",
    "canonical",
    "from_json",
    "from_local_mix",
    "new_contract",
    "plan_seam",
    "plan_seams",
]
