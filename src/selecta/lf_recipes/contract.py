"""Portable, immutable, metadata-only mix recipes (local-first schema v2).

This module has no dependency on cloud audio or local file paths. Recording verification
is an explicit device-scoped input, never inferred from titles or catalogue entries.
"""
from __future__ import annotations

import hashlib
import json
import math
import re
import uuid
from dataclasses import dataclass, replace
from collections.abc import Mapping, Sequence
from enum import StrEnum
from typing import Any, Protocol

SCHEMA_VERSION = 2
MAX_OCCURRENCES = 200
_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$")
_SHA = re.compile(r"^[0-9a-f]{64}$")
_TIMEBASES = frozenset({"source_seconds", "beats"})
_TRANSITIONS = frozenset({"cut", "crossfade", "beatmatched_crossfade", "planned"})
_ALLOWED_KEYS = frozenset({
    "schema_version", "recipe_id", "name", "revision_number", "parent_revision",
    "draft", "occurrences", "cues", "transitions", "revision_id",
})


class RecipeError(ValueError):
    """Malformed or unsupported recipe; fail closed rather than guessing."""


class AvailabilityState(StrEnum):
    READY = "ready"
    MISSING = "missing"
    CANDIDATE = "candidate"
    VERSION_MISMATCH = "version_mismatch"
    BLOCKED = "blocked"
    UNKNOWN = "unknown"


def _id(value: Any, label: str) -> str:
    if not isinstance(value, str) or not _ID.fullmatch(value) or _SHA.fullmatch(value):
        raise RecipeError(f"{label} must be an opaque identifier, not a path or fingerprint")
    return value


def _optional_id(value: Any, label: str) -> str | None:
    return None if value is None else _id(value, label)


def _time(value: Any, label: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise RecipeError(f"{label} must be a finite non-negative number")
    number = float(value)
    if not math.isfinite(number) or number < 0 or number > 86400 * 7:
        raise RecipeError(f"{label} is out of range")
    return number


def _fields(raw: Any, expected: frozenset[str], label: str) -> Mapping[str, Any]:
    if not isinstance(raw, Mapping) or set(raw) - expected:
        raise RecipeError(f"{label} contains invalid fields")
    return raw


def _canonical(value: Any) -> str:
    return json.dumps(
        value, sort_keys=True, separators=(",", ":"), ensure_ascii=True, allow_nan=False
    )


@dataclass(frozen=True)
class Occurrence:
    occurrence_id: str
    canonical_track_id: str | None
    legacy_asset_id: str | None = None
    recording_version: str | None = None
    title: str = "Untitled"
    artist: str | None = None
    analysis_valid: bool = False

    def __post_init__(self) -> None:
        _id(self.occurrence_id, "occurrence_id")
        _optional_id(self.canonical_track_id, "canonical_track_id")
        _optional_id(self.legacy_asset_id, "legacy_asset_id")
        _optional_id(self.recording_version, "recording_version")
        if self.canonical_track_id is None and self.legacy_asset_id is None:
            raise RecipeError("Unresolved occurrences must retain their legacy asset reference")
        if not isinstance(self.title, str) or len(self.title) > 240:
            raise RecipeError("Invalid title")
        if self.artist is not None and (not isinstance(self.artist, str) or len(self.artist) > 240):
            raise RecipeError("Invalid artist")
        if not isinstance(self.analysis_valid, bool):
            raise RecipeError("analysis_valid must be boolean")

    def to_json(self) -> dict[str, Any]:
        return vars(self).copy()


@dataclass(frozen=True)
class Cue:
    occurrence_id: str
    at: float
    timebase: str = "source_seconds"
    requires_revalidation: bool = False

    def __post_init__(self) -> None:
        _id(self.occurrence_id, "cue occurrence_id")
        _time(self.at, "cue time")
        if self.timebase not in _TIMEBASES:
            raise RecipeError("Unknown cue timebase")
        if not isinstance(self.requires_revalidation, bool):
            raise RecipeError("Invalid cue validation state")

    def to_json(self) -> dict[str, Any]:
        return vars(self).copy()


@dataclass(frozen=True)
class Transition:
    from_occurrence_id: str
    to_occurrence_id: str
    type: str
    duration_seconds: float
    requires_rebuild: bool = True

    def __post_init__(self) -> None:
        _id(self.from_occurrence_id, "from_occurrence_id")
        _id(self.to_occurrence_id, "to_occurrence_id")
        if self.type not in _TRANSITIONS:
            raise RecipeError("Unknown transition type")
        _time(self.duration_seconds, "transition duration")
        if not isinstance(self.requires_rebuild, bool):
            raise RecipeError("Invalid transition validation state")

    def to_json(self) -> dict[str, Any]:
        return vars(self).copy()


@dataclass(frozen=True)
class Recipe:
    recipe_id: str
    name: str
    occurrences: tuple[Occurrence, ...]
    cues: tuple[Cue, ...] = ()
    transitions: tuple[Transition, ...] = ()
    revision_number: int = 1
    parent_revision: str | None = None
    draft: bool = True
    schema_version: int = SCHEMA_VERSION

    def __post_init__(self) -> None:
        _id(self.recipe_id, "recipe_id")
        if self.schema_version != SCHEMA_VERSION or isinstance(self.schema_version, bool):
            raise RecipeError("Unsupported recipe version")
        if not isinstance(self.name, str) or not (1 <= len(self.name.strip()) <= 60):
            raise RecipeError("Recipe name must contain 1 to 60 characters")
        if not 1 <= len(self.occurrences) <= MAX_OCCURRENCES:
            raise RecipeError("Recipe must contain 1 to 200 occurrences")
        ids = tuple(item.occurrence_id for item in self.occurrences)
        if len(set(ids)) != len(ids):
            raise RecipeError("Duplicate occurrence id")
        if (
            isinstance(self.revision_number, bool)
            or not isinstance(self.revision_number, int)
            or self.revision_number < 1
        ):
            raise RecipeError("Invalid revision number")
        if self.parent_revision is not None and not _SHA.fullmatch(self.parent_revision):
            raise RecipeError("Invalid parent revision")
        if (self.revision_number == 1) != (self.parent_revision is None):
            raise RecipeError("Only the initial revision has no parent")
        if not isinstance(self.draft, bool):
            raise RecipeError("draft must be boolean")
        if len({cue.occurrence_id for cue in self.cues}) != len(self.cues):
            raise RecipeError("Duplicate cue")
        if any(cue.occurrence_id not in ids for cue in self.cues):
            raise RecipeError("Cue references absent occurrence")
        ordered = tuple((ids[i - 1], ids[i]) for i in range(1, len(ids)))
        pairs = tuple((t.from_occurrence_id, t.to_occurrence_id) for t in self.transitions)
        if len(pairs) != len(set(pairs)) or any(pair not in ordered for pair in pairs):
            raise RecipeError("Transitions must connect adjacent occurrences once")

    def body(self) -> dict[str, Any]:
        return {
            "schema_version": self.schema_version, "recipe_id": self.recipe_id,
            "name": self.name, "revision_number": self.revision_number,
            "parent_revision": self.parent_revision, "draft": self.draft,
            "occurrences": [o.to_json() for o in self.occurrences],
            "cues": [c.to_json() for c in self.cues],
            "transitions": [t.to_json() for t in self.transitions],
        }

    @property
    def revision_id(self) -> str:
        return hashlib.sha256(_canonical(self.body()).encode("utf-8")).hexdigest()

    def to_json(self) -> dict[str, Any]:
        return {**self.body(), "revision_id": self.revision_id}

    def edited(
        self, *, occurrences: Sequence[Occurrence] | None = None,
        cues: Sequence[Cue] | None = None, transitions: Sequence[Transition] | None = None,
        name: str | None = None, draft: bool | None = None,
    ) -> Recipe:
        """Preserve historical content; invalidate only dependencies on changed recordings.

        Reordering an existing occurrence is not a recording change. A replacement, including
        a different version of the same canonical track, invalidates source-dependent cues,
        analysis and any transition touching that occurrence.
        """
        next_occ = tuple(self.occurrences if occurrences is None else occurrences)
        old = {o.occurrence_id: o for o in self.occurrences}
        changed = {
            o.occurrence_id for o in next_occ
            if o.occurrence_id not in old or (
                o.canonical_track_id, o.legacy_asset_id, o.recording_version
            ) != (
                old[o.occurrence_id].canonical_track_id, old[o.occurrence_id].legacy_asset_id,
                old[o.occurrence_id].recording_version
            )
        }
        next_occ = tuple(
            replace(o, analysis_valid=False) if o.occurrence_id in changed else o
            for o in next_occ
        )
        existing_cues = self.cues if cues is None else tuple(cues)
        next_cues = tuple(
            replace(c, requires_revalidation=True) if c.occurrence_id in changed else c
            for c in existing_cues
        )
        existing_trans = self.transitions if transitions is None else tuple(transitions)
        next_trans = tuple(
            replace(t, requires_rebuild=True)
            if t.from_occurrence_id in changed or t.to_occurrence_id in changed else t
            for t in existing_trans
        )
        return Recipe(
            recipe_id=self.recipe_id, name=self.name if name is None else name.strip(),
            occurrences=next_occ, cues=next_cues, transitions=next_trans,
            revision_number=self.revision_number + 1, parent_revision=self.revision_id,
            draft=self.draft if draft is None else draft,
        )


def parse_recipe(data: Mapping[str, Any]) -> Recipe:
    raw = _fields(data, _ALLOWED_KEYS, "recipe")
    if raw.get("schema_version") != SCHEMA_VERSION or isinstance(raw.get("schema_version"), bool):
        raise RecipeError("Unsupported recipe version")
    occ_keys = frozenset(Occurrence.__dataclass_fields__)
    cue_keys = frozenset(Cue.__dataclass_fields__)
    trans_keys = frozenset(Transition.__dataclass_fields__)
    try:
        occurrences = tuple(
            Occurrence(**_fields(item, occ_keys, "occurrence"))
            for item in raw["occurrences"]
        )
        cues = tuple(Cue(**_fields(item, cue_keys, "cue")) for item in raw.get("cues", ()))
        transitions = tuple(
            Transition(**_fields(item, trans_keys, "transition"))
            for item in raw.get("transitions", ())
        )
        recipe = Recipe(
            recipe_id=raw["recipe_id"], name=raw["name"], occurrences=occurrences,
            cues=cues, transitions=transitions, revision_number=raw["revision_number"],
            parent_revision=raw.get("parent_revision"), draft=raw.get("draft", True),
        )
        if raw.get("revision_id") is not None and raw["revision_id"] != recipe.revision_id:
            raise RecipeError("Recipe content does not match immutable revision id")
        return recipe
    except (KeyError, TypeError, AttributeError, OverflowError) as exc:
        raise RecipeError("Malformed recipe document") from exc


def new_recipe(
    name: str, tracks: Sequence[Mapping[str, Any]], recipe_id: str | None = None
) -> Recipe:
    """New metadata-only recipe; canonical IDs are supplied by authorised catalogue services."""
    if not isinstance(tracks, (list, tuple)):
        raise RecipeError("occurrences must be an array")
    occurrences = []
    for raw in tracks:
        values = _fields(
            raw,
            frozenset({
                "occurrence_id", "canonical_track_id", "recording_version",
                "title", "artist",
            }),
            "occurrence",
        )
        if not values.get("canonical_track_id"):
            raise RecipeError("New recipes require explicit canonical_track_id")
        occurrences.append(Occurrence(
            occurrence_id=values.get("occurrence_id") or uuid.uuid4().hex,
            canonical_track_id=values["canonical_track_id"],
            recording_version=values.get("recording_version"),
            title=values.get("title", "Untitled"), artist=values.get("artist"),
        ))
    return Recipe(
        recipe_id=recipe_id or uuid.uuid4().hex, name=name, occurrences=tuple(occurrences)
    )


def from_legacy(contract: Any) -> Recipe:
    """Read-only v2 view of a v1 cloud artifact; unresolved means *not* verified.

    Keep legacy IDs only for Agent 17's explicit backfill. No SHA, path, rendered
    file, title match or synthetic canonical track ID crosses the new contract.
    """
    counters: dict[str, int] = {}
    occurrences = []
    for song in contract.songs:
        counters[song.id] = counters.get(song.id, 0) + 1
        occurrence_id = uuid.uuid5(
            uuid.NAMESPACE_URL, f"selecta/{contract.mix_id}/{song.id}/{counters[song.id]}"
        ).hex
        occurrences.append(Occurrence(
            occurrence_id=occurrence_id, canonical_track_id=None,
            legacy_asset_id=song.id, title=song.title, artist=song.artist,
        ))
    return Recipe(
        recipe_id=contract.mix_id, name=contract.name,
        occurrences=tuple(occurrences), revision_number=contract.number,
        parent_revision=contract.parent, draft=True,
    )


@dataclass(frozen=True)
class DeviceBinding:
    canonical_track_id: str
    state: AvailabilityState
    recording_version: str | None = None
    reason: str | None = None

    def __post_init__(self) -> None:
        _id(self.canonical_track_id, "binding track id")
        if not isinstance(self.state, AvailabilityState):
            raise RecipeError("Unknown availability state")
        _optional_id(self.recording_version, "binding recording version")
        if self.reason is not None:
            _id(self.reason, "availability reason")


@dataclass(frozen=True)
class DeviceInventory:
    workspace_id: str
    target_device_id: str
    verified_at: float
    expires_at: float
    bindings: tuple[DeviceBinding, ...]
    policy_version: str | None = None

    def __post_init__(self) -> None:
        _id(self.workspace_id, "inventory workspace_id")
        _id(self.target_device_id, "inventory target_device_id")
        _optional_id(self.policy_version, "policy_version")
        if (
            not isinstance(self.verified_at, (int, float))
            or not isinstance(self.expires_at, (int, float))
            or not math.isfinite(self.verified_at)
            or not math.isfinite(self.expires_at)
        ):
            raise RecipeError("Invalid inventory freshness bounds")
        ids = [item.canonical_track_id for item in self.bindings]
        if len(ids) != len(set(ids)):
            raise RecipeError("Duplicate binding")


class RecordingResolver(Protocol):
    """Agent 03 adapter; never returns a filesystem path or raw media fingerprint."""
    def resolve(
        self, workspace_id: str, target_device_id: str,
        canonical_track_ids: tuple[str, ...],
    ) -> DeviceInventory: ...


def availability(
    recipe: Recipe, workspace_id: str, target_device_id: str,
    resolver: RecordingResolver | None, *, now: float,
) -> dict[str, Any]:
    """Strict per-device snapshot; absent or stale verification is Unknown, never Ready."""
    _id(target_device_id, "target_device_id")
    requested = tuple(
        sorted({o.canonical_track_id for o in recipe.occurrences if o.canonical_track_id})
    )
    snapshot = resolver.resolve(workspace_id, target_device_id, requested) if resolver else None
    fresh = bool(
        snapshot and snapshot.workspace_id == workspace_id
        and snapshot.target_device_id == target_device_id
        and math.isfinite(snapshot.verified_at) and math.isfinite(snapshot.expires_at)
        and snapshot.verified_at <= now <= snapshot.expires_at
        and snapshot.expires_at > snapshot.verified_at
    )
    bindings = {b.canonical_track_id: b for b in snapshot.bindings} if fresh and snapshot else {}
    tracks = []
    for item in recipe.occurrences:
        binding = bindings.get(item.canonical_track_id) if item.canonical_track_id else None
        state = binding.state if binding else AvailabilityState.UNKNOWN
        reason = (
            binding.reason if binding else (
                "unresolved_legacy_reference" if not item.canonical_track_id else "unverified"
            )
        )
        if state == AvailabilityState.READY and (
            item.recording_version is not None
            and binding.recording_version != item.recording_version
        ):
            state, reason = AvailabilityState.VERSION_MISMATCH, "recording_version_changed"
        if state == AvailabilityState.READY and not item.analysis_valid:
            # Local analysis can be re-run; a playable recording does not imply transitions ready.
            reason = "analysis_requires_local_verification"
        tracks.append({"occurrence_id": item.occurrence_id, "state": state.value, "reason": reason})
    transitions = [{
        "from_occurrence_id": t.from_occurrence_id,
        "to_occurrence_id": t.to_occurrence_id,
        # Recording readiness alone cannot certify a prepared transition. Agent 06/09
        # must provide a separately verified local transition status before enabling it.
        "state": "requires_local_rebuild",
    } for t in recipe.transitions]
    counts = {
        state.value: sum(t["state"] == state.value for t in tracks)
        for state in AvailabilityState
    }
    can_run = counts["ready"] == len(tracks) and all(t["state"] == "ready" for t in transitions)
    return {
        "target_device_id": target_device_id, "recipe_revision": recipe.revision_id,
        "policy_version": snapshot.policy_version if fresh and snapshot else None,
        "verified_at": snapshot.verified_at if fresh and snapshot else None,
        "fresh": fresh, "status": "ready" if can_run else "needs_attention",
        "can_run": can_run, "counts": counts, "tracks": tracks,
        "transition_states": transitions,
    }
