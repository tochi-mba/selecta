"""Lucy's WeftAI registry: typed music collections, the runtime, and hooks that own card state.

The model writes a declarative plan of named steps; WeftAI validates it against these typed
operations and runs independent steps together, dependent ones in order. Every step's lifecycle
(queued, started, progress, completed, failed, skipped, cancelled) is appended to Lucy's durable
event log from the runtime's own hooks, so activity cards show what really ran, not what the
model says ran (ADR-0304, ADR-0312, ADR-0313).
"""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass, field
from typing import Any

from weftai import (
    BaseModel,
    FieldSpec,
    collection,
    create_memory_store,
    create_registry,
    create_runtime,
    define_operation,
    standard_operations,
)

from selecta.lucy import events, policy
from selecta.lucy.catalog import Library

STEP_LIMITS = {"maxSteps": 12, "stepTimeoutMs": 60_000, "planTimeoutMs": 150_000, "maxParallel": 3}
PREVIEW = 30
RESULT_TTL_MS = 30 * 60 * 1000


class Track(BaseModel):
    id: int
    title: str
    artist: str
    genre: str | None = None
    family: str | None = None
    bpm: float | None = None
    key: str | None = None
    energy: float | None = None
    minutes: float | None = None
    year: int | None = None
    plays: int | None = None
    mix_ready: bool = True


class Seam(BaseModel):
    key: str
    a: int
    b: int
    a_title: str
    b_title: str
    requested: str
    rendered: str | None = None
    status: str
    verified: bool = False
    history: str = "unknown"


class ProposalSong(BaseModel):
    position: int
    occurrence: str
    song_id: int
    title: str
    artist: str
    bpm: float | None = None
    key: str | None = None
    energy: float | None = None
    locked: bool = False


def _fields(names: list[str]):
    return lambda _ctx: [FieldSpec(name, lambda item, name=name: getattr(item, name))
                         for name in names]


Tracks = collection(
    "tracks",
    Track,
    label=lambda t: f"{t.artist} – {t.title}",
    key=lambda t: str(t.id),
    description="Songs in this person's library (only measured facts; unknown is null).",
    fields=_fields(["title", "artist", "genre", "family", "bpm", "key", "energy", "minutes",
                    "year", "plays", "mix_ready"]),
)
Seams = collection(
    "seams",
    Seam,
    label=lambda s: f"{s.a_title} → {s.b_title} ({s.status})",
    key=lambda s: s.key,
    description="Directed transitions A → B. 'already_rendered' means verified playable now.",
    fields=_fields(["a", "b", "a_title", "b_title", "requested", "rendered", "status",
                    "verified", "history"]),
)
ProposalSongs = collection(
    "proposalSongs",
    ProposalSong,
    label=lambda s: f"{s.position}. {s.artist} – {s.title}" + (" (locked)" if s.locked else ""),
    key=lambda s: s.occurrence,
    description="The songs of the current proposal, in order. A proposal is not built.",
    fields=_fields(["position", "song_id", "title", "artist", "bpm", "key", "energy", "locked"]),
)


@dataclass
class LucyCtx:
    """What every handler and hook gets: one conversation, one run, one data home."""

    conn: sqlite3.Connection
    app: Any
    conversation: str
    turn: str | None = None
    run: str | None = None
    turn_text: str = ""
    turn_kind: str = "chat"
    selection: dict = field(default_factory=dict)
    expected: str | None = None
    plan: str | None = None
    outcomes: list[dict] = field(default_factory=list)
    revisions: list[str] = field(default_factory=list)
    permissions: list[str] = field(default_factory=list)
    finished_steps: set[str] = field(default_factory=set)
    steps_run: int = 0
    _lib: Library | None = None

    def lib(self) -> Library:
        if self._lib is None:
            from selecta.lucy import catalog

            self._lib = catalog.load(self.conn, self.app)
        return self._lib

    def emit(self, type: str, payload: dict, step: str | None = None) -> None:
        events.append(self.conn, self.conversation, type, payload, turn=self.turn, run=self.run,
                      plan=self.plan, step=step)

    def progress(self, step: str, done: int, total: int | None, unit: str, label: str) -> None:
        """A measured step of a long operation: real counts, never an invented percentage."""
        self.emit("step.progress", {
            "status": "progress",
            "progress": {"done": done, "total": total, "unit": unit},
            "note": label,
        }, step=step)


def define(name: str, description: str, input: Any, output: Any, run: Any,
           tier: str = "read", examples: list | None = None):
    """Register an operation with its host-enforced tier; effects follow from the tier."""
    if tier not in policy.TIERS or tier in policy.NEVER_TOOLS:
        raise ValueError(f"{name}: tier {tier!r} can't be a tool")
    policy.OPERATION_TIERS[name] = tier
    spec: dict = {
        "name": name,
        "description": description,
        "input": input,
        "output": output,
        "run": run,
        "effects": "read" if tier == "read" else "write",
        "annotations": {"openWorld": False} if tier == "read"
        else {"openWorld": False, "destructive": False, "idempotent": False},
    }
    if examples:
        spec["examples"] = examples
    return define_operation(spec)


FAMILY_BY_PREFIX = {
    "tracks.mostPlayed": "history",
    "tracks.eligibility": "analysis",
    "tracks": "search",
    "analysis": "analysis",
    "transitions": "transition",
    "seams": "transition",
    "proposals.plan": "planning",
    "proposals.revise": "revision",
    "proposals.removeRule": "constraints",
    "proposals.seams": "render",
    "proposals": "planning",
    "proposalSongs": "planning",
    "memory": "memory",
}

TITLES = {
    "tracks.search": "Searching your library",
    "tracks.find": "Looking up songs",
    "tracks.resolveName": "Finding that song",
    "tracks.excluded": "Songs you ruled out",
    "tracks.duplicates": "Duplicate songs",
    "tracks.eligibility": "Checking which songs can be mixed",
    "tracks.mostPlayed": "Your most-played songs",
    "analysis.features": "Reading measured features",
    "analysis.health": "Checking library analysis",
    "analysis.request": "Asking to analyse songs",
    "transitions.readyInventory": "Checking transitions ready to play",
    "transitions.readyFrom": "Ready transitions out of these songs",
    "transitions.readyTo": "Ready transitions into these songs",
    "transitions.evaluate": "Checking how these songs connect",
    "transitions.bridges": "Looking for songs to bridge a gap",
    "transitions.history": "What happened with these transitions before",
    "proposals.current": "Reading the current proposal",
    "proposals.seams": "Checking the proposal's transitions",
    "proposals.plan": "Planning a mix",
    "proposals.revise": "Revising the proposal",
    "proposals.removeRule": "Removing a rule",
    "memory.facts": "Reading what Lucy remembers",
    "memory.remember": "Remembering what you said",
}


def family_of(operation: str) -> str:
    for prefix in sorted(FAMILY_BY_PREFIX, key=len, reverse=True):
        if operation == prefix or operation.startswith(prefix + "."):
            return FAMILY_BY_PREFIX[prefix]
    return "other"


def title_of(operation: str) -> str:
    if operation in TITLES:
        return TITLES[operation]
    kind = operation.split(".")[-1]
    subject = {"tracks": "songs", "seams": "transitions", "proposalSongs": "proposal songs"}.get(
        operation.split(".")[0], "results")
    verbs = {"filter": "Filtering", "count": "Counting", "countBy": "Grouping",
             "distinct": "Listing different", "mostCommon": "Finding the most common",
             "first": "Taking the first", "pick": "Picking", "details": "Showing details of"}
    return f"{verbs.get(kind, 'Working on')} {subject}"


def _label(item: Any) -> dict:
    if isinstance(item, Track):
        return {"id": item.id, "title": item.title, "artist": item.artist}
    if isinstance(item, ProposalSong):
        return {"id": item.song_id, "title": item.title, "artist": item.artist,
                "energy": item.energy}
    if isinstance(item, Seam):
        return {"a": {"id": item.a, "title": item.a_title}, "b": {"id": item.b,
                "title": item.b_title}, "requested": item.requested, "rendered": item.rendered,
                "status": "ready" if item.verified else
                ("history_only" if item.history != "unknown" else "unknown")}
    return {"label": str(item)[:80]}


def visual(operation: str, step_input: Any, result: dict) -> dict:
    """What the card's mini view draws: only fields that exist in the real result."""
    family = family_of(operation)
    items = list(result.get("items") or ())
    count = result.get("count")
    data = result.get("data")
    if family in {"search", "history"} and items is not None:
        filters = []
        if isinstance(step_input, dict):
            for item in step_input.get("filters") or []:
                if isinstance(item, dict):
                    filters.append({"field": item.get("field"), "op": item.get("op", "eq"),
                                    "value": item.get("value")})
        return {"filters": filters, "matched": count or 0,
                "returned": min(count or 0, PREVIEW), "capped": (count or 0) > PREVIEW,
                "items": [_label(item) for item in items[:5]]}
    if family == "transition" and items:
        edges = [_label(item) for item in items[:6]]
        return {"edges": edges, "total": count or len(items)}
    if family in {"planning", "revision", "constraints"} and isinstance(data, dict):
        return data.get("visual") or {}
    if family == "planning" and items:
        return {"songs": [_label(item) for item in items[:24]], "count": count,
                "duration": None, "ready_only": False}
    if family == "render" and items:
        statuses = [{"key": item.key, "status": item.status} for item in items]
        return {"seams": statuses, "ready": sum(1 for item in items if item.verified),
                "needed": len(items)}
    if isinstance(data, dict) and "visual" in data:
        return data["visual"]
    return {}


def _status(result: dict) -> str:
    if result["status"] == "ok":
        return "completed"
    if result["status"] == "skipped":
        reason = (result.get("skippedBecause") or "").casefold()
        return "cancelled" if "cancel" in reason or "abort" in reason else "skipped"
    return "failed"


def card_payload(step: Any, result: dict) -> dict:
    count = result.get("count")
    shown = count if result.get("present") == "full" or count is None else min(count, PREVIEW)
    return {
        "op": result["operation"],
        "family": family_of(result["operation"]),
        "title": title_of(result["operation"]),
        "status": _status(result),
        "attempt": 1,
        "count": count,
        "returned": shown,
        "capped": count is not None and shown is not None and shown < count,
        "notices": [policy.clean_text(n, 300) for n in result.get("notices") or ()],
        "error": policy.clean_text(result.get("error"), 400) if result.get("error") else None,
        "skipped_because": result.get("skippedBecause"),
        "duration_ms": result.get("durationMs"),
        "note": result.get("note"),
        "progress": None,
        "visual": visual(result["operation"], getattr(step, "input", None), result),
    }


async def _before(args: dict) -> None:
    ctx: LucyCtx = args["ctx"]
    step = args["step"]
    ctx.steps_run += 1
    name = step.operation.name
    ctx.emit("step.started", {
        "op": name, "family": family_of(name), "title": title_of(name), "status": "running",
        "attempt": 1, "note": step.note, "notices": [], "visual": {}, "progress": None,
    }, step=step.id)


async def _after(args: dict) -> None:
    ctx: LucyCtx = args["ctx"]
    result = args.get("result")
    if result is None:
        return
    payload = card_payload(args["step"], result)
    ctx.finished_steps.add(args["step"].id)
    ctx.emit(f"step.{payload['status']}", payload, step=args["step"].id)


def build_runtime():
    from selecta.lucy import tools_ops

    operations = tools_ops.operations()
    for operation in standard_operations(Tracks) + standard_operations(Seams) + \
            standard_operations(ProposalSongs):
        policy.OPERATION_TIERS.setdefault(operation.name, "read")
        operations.append(operation)
    problems = policy.audit(operations)
    if problems:
        raise RuntimeError("Lucy's tool permissions don't line up: " + " ".join(problems))
    registry = create_registry({"operations": operations})
    return create_runtime({
        "registry": registry,
        "store": create_memory_store({"ttlMs": RESULT_TTL_MS, "maxResults": 200}),
        "hooks": {"beforeStep": _before, "afterStep": _after},
        "limits": STEP_LIMITS,
    })


_runtime = None


def runtime():
    """One runtime per process; results and plans are namespaced by session id, which is
    derived from the data home and the conversation (LU-313-01)."""
    global _runtime
    if _runtime is None:
        _runtime = build_runtime()
    return _runtime


def session_id(app: Any, conversation: str) -> str:
    from selecta.lucy.ids import content_hash

    return f"{content_hash(str(app.settings.home))[:12]}:{conversation}"
