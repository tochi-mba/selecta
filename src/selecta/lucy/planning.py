"""Evidence-backed mix proposals from typed rules (ADR-0318, ADR-0322, LU-319-04).

Lucy never invents a song order. Normal proposals come from Selecta's own planner (`build_vibe`
over a pool filtered by the hard rules and weighted by the soft ones); strict ready-only
proposals come from the graph of verified, playable, directed clips on disk, with no render or
analysis queued. Every candidate is checked against every hard rule before anyone sees it, and
when nothing qualifies the answer is the computed limits and a choice, never a quiet relaxation.
"""

from __future__ import annotations

import sqlite3
import statistics
from dataclasses import dataclass, field
from typing import Any

from selecta.analysis.key import camelot_distance
from selecta.config import ANALYSIS_VERSION
from selecta.lucy import PLANNER_VERSION, catalog, readiness
from selecta.lucy.catalog import Library, Pool
from selecta.lucy.ids import new_id
from selecta.lucy.intent import Constraint, active, contradictions, describe
from selecta.planner.memory import RULES_VERSION
from selecta.seam_kinds import RENDER_VERSION, request_from

DEFAULT_SONGS = 12
SECONDS_PER_SONG_GUESS = 40.0
ARCS = {
    "slow_burn": ("slow_burn", None),
    "lift_off": ("climb", None),
    "cool_down": ("wind_down", None),
    "no_dips": ("steady", None),
    "steady_low": ("slow_burn", [0.36, 0.42, 0.44, 0.4, 0.32]),
}
FAR_TEMPO = 0.08
FAR_KEY = 5


@dataclass
class Outcome:
    status: str
    """ok, no_route, conflict, clarify or empty."""
    snapshots: list[dict] = field(default_factory=list)
    message: str = ""
    details: dict = field(default_factory=dict)


def rule_dicts(rules: list[Constraint]) -> list[dict]:
    return [{**rule.as_dict(), "label": describe(rule)} for rule in rules]


def title_for(rules: list[Constraint]) -> str:
    live = active(rules)
    parts = [describe(rule) for rule in live if rule.kind in {"family_only", "family"}]
    parts += [describe(rule) for rule in live if rule.kind == "energy_arc"]
    if any(rule.kind == "ready_only" for rule in live):
        parts.append("ready now")
    text = ", ".join(part.replace("Only ", "").replace("Lean ", "") for part in parts[:3])
    return (text[:1].upper() + text[1:]) if text else "Lucy’s mix"


def _per_song(pool: list[Any]) -> float:
    lengths = [float(song.duration) for song in pool if song.duration]
    return max(90.0, (statistics.median(lengths) if lengths else 210.0) - SECONDS_PER_SONG_GUESS)


def target_count(rules: list[Constraint], pool: list[Any]) -> int:
    live = active(rules)
    count = next((rule.value for rule in live if rule.kind == "count"), None)
    if count is None:
        minutes = next(
            (rule.value for rule in live if rule.kind in {"duration", "max_duration"}), None
        )
        count = round(minutes * 60 / _per_song(pool)) if minutes else DEFAULT_SONGS
    return int(max(1, min(100, count)))


def _tempo_gap(a: Any, b: Any) -> float | None:
    if not a or not b or not a.bpm or not b.bpm:
        return None
    return min(abs(a.bpm * factor / b.bpm - 1.0) for factor in (0.5, 1.0, 2.0))


def _key_distance(a: Any, b: Any) -> int | None:
    try:
        return camelot_distance(a.camelot, b.camelot)
    except (AttributeError, TypeError, ValueError, IndexError):
        return None


def build_snapshot(
    lib: Library,
    ids: list[int],
    settings: list[dict],
    rules: list[Constraint],
    *,
    ready_only: bool,
    title: str,
    variant: str = "balanced",
    occurrences: list[str] | None = None,
    locked: list[bool] | None = None,
) -> dict:
    occurrences = occurrences or [new_id("occurrence") for _ in ids]
    locked = locked or [False] * len(ids)
    songs = []
    for occ, song_id, lock in zip(occurrences, ids, locked, strict=True):
        song = lib.by_id.get(song_id)
        traits = lib.traits.get(song_id)
        songs.append(
            {
                "occurrence": occ,
                "song_id": song_id,
                "artist": (song.artist if song else "") or "Unknown artist",
                "title": (song.title if song else "Unavailable song") or "Untitled",
                "duration": float(song.duration) if song else 0.0,
                "bpm": round(float(song.bpm), 1) if song and song.bpm else None,
                "key": getattr(song, "camelot", None) or None,
                "energy": round(float(traits.energy), 3) if traits is not None else None,
                "locked": bool(lock),
            }
        )
    seams = []
    for index, seam in enumerate(settings):
        a, b = ids[index], ids[index + 1]
        clean = {key: value for key, value in (seam or {}).items() if value is not None}
        move = clean.get("move") or "auto"
        seams.append(
            {
                "a_occ": occurrences[index],
                "b_occ": occurrences[index + 1],
                "a": a,
                "b": b,
                "key": request_from(a, b, clean).key,
                "settings": clean,
                "requested": move,
                "requested_label": readiness.move_label(move),
            }
        )
    return {
        "title": title,
        "ready_only": ready_only,
        "variant": variant,
        "songs": songs,
        "seams": seams,
        "constraints": rule_dicts(rules),
        "versions": {
            "planner": PLANNER_VERSION,
            "analysis": ANALYSIS_VERSION,
            "seam_rules": RULES_VERSION,
            "render": RENDER_VERSION,
            "library_songs": len(lib.songs),
        },
    }


def evaluate(lib: Library, snapshot: dict, store: Any, inv: Any | None) -> dict:
    """Attach real evidence: seam readiness from disk, measured tempo and key gaps, what history
    says (and only that), duration and energy with unknowns kept as unknown (LU-322-04/05/07)."""
    verified = inv.by_key() if inv is not None else {}
    total_ready = 0
    warnings: list[str] = []
    gaps: list[float] = []
    for seam in snapshot["seams"]:
        a, b = lib.by_id.get(seam["a"]), lib.by_id.get(seam["b"])
        state = store.status(seam["key"])
        is_verified = seam["key"] in verified
        seam["ready"] = readiness.seam_ready(seam, state, is_verified)
        gap, distance = _tempo_gap(a, b), _key_distance(a, b)
        known = lib.memory.best_known(seam["a"], seam["b"]) if lib.memory else None
        history = {"liked": "liked", "clean": "clean", "disliked": "failed"}.get(
            known[1] if known else "", "unknown"
        )
        if is_verified:
            provenance = "playable"
        elif state.get("rating"):
            provenance = "user_rated"
        elif history != "unknown":
            provenance = "history_only"
        else:
            provenance = "predicted"
        seam["evidence"] = {
            "tempo_gap": round(gap, 3) if gap is not None else None,
            "key_distance": distance,
            "history": history,
            "provenance": provenance,
        }
        notes = []
        if gap is not None and gap > FAR_TEMPO:
            notes.append(f"Tempos are {round(gap * 100)}% apart.")
        if distance is not None and distance >= FAR_KEY:
            notes.append("Their keys are far apart.")
        if known and known[1] == "disliked":
            notes.append("You rated a transition between these two as bad before.")
        if state.get("status") == "failed":
            notes.append("The last attempt to render this one failed.")
        seam["warnings"] = notes
        if gap is not None:
            gaps.append(gap)
        if is_verified or state.get("status") == "ready":
            total_ready += 1
        warnings += [
            f"{_name(lib, seam['a'])} → {_name(lib, seam['b'])}: {note}" for note in notes
        ]
    snapshot["evaluation"] = {
        "duration": _duration(lib, snapshot, verified),
        "energy": [song["energy"] for song in snapshot["songs"]],
        "warnings": warnings,
        "objective": _objective(lib, snapshot, total_ready, gaps),
    }
    return snapshot


def _name(lib: Library, song_id: int) -> str:
    song = lib.by_id.get(song_id)
    return f"{song.title}" if song else "a song"


def _duration(lib: Library, snapshot: dict, verified: dict) -> dict:
    songs = snapshot["songs"]
    source = sum(song["duration"] for song in songs)
    seams = snapshot["seams"]
    if seams and all(seam["key"] in verified for seam in seams):
        total = 0.0
        for index, song in enumerate(songs):
            enters = verified[seams[index - 1]["key"]].b_source_end if index else 0.0
            leaves = (
                verified[seams[index]["key"]].a_source_start if index < len(seams)
                else song["duration"]
            )
            total += max(0.0, leaves - enters)
        total += sum(verified[seam["key"]].duration for seam in seams)
        return {"source_seconds": round(source), "low": round(total), "high": round(total),
                "exact": True}
    low = high = source
    for seam in seams:
        a, b = lib.by_id.get(seam["a"]), lib.by_id.get(seam["b"])
        beat = 60.0 / a.bpm if a and a.bpm else 0.5
        # an overlap (and the trimmed intro and outro around it) can't eat more than half of
        # the shorter song
        room = 0.5 * min(float(a.duration) if a else 240.0, float(b.duration) if b else 240.0)
        low -= min(32 * 4 * beat + 30.0, room)
        high -= min(8 * 4 * beat, room)
    return {
        "source_seconds": round(source),
        "low": round(max(0.0, low)),
        "high": round(max(0.0, high)),
        "exact": False,
    }


def _objective(lib: Library, snapshot: dict, ready: int, gaps: list[float]) -> dict:
    songs = snapshot["songs"]
    needed = max(0, len(songs) - 1)
    artists = {song["artist"].casefold() for song in songs}
    return {
        "ready_share": round(ready / needed, 3) if needed else 1.0,
        "tempo_flow": round(1 - statistics.fmean(min(g, 0.2) / 0.2 for g in gaps), 3)
        if gaps else 0.0,
        "artist_variety": round(len(artists) / len(songs), 3) if songs else 0.0,
    }


def validate(lib: Library, snapshot: dict, rules: list[Constraint], store: Any,
             inv: Any | None = None) -> list[str]:
    """Every hard rule, checked on the finished order. Any failure keeps it from being shown."""
    problems: list[str] = []
    ids = [song["song_id"] for song in snapshot["songs"]]
    if len(set(ids)) != len(ids):
        problems.append("A song appears twice.")
    gone = [song["title"] for song in snapshot["songs"] if song["song_id"] not in lib.by_id]
    if gone:
        problems.append(f"No longer mix-ready: {', '.join(gone[:3])}.")
    for rule in active(rules):
        if rule.strength != "hard":
            continue
        value = rule.value
        if rule.kind == "count" and len(ids) != value:
            problems.append(f"It has {len(ids)} songs, not {value}.")
        elif rule.kind in {"exclude_artist", "exclude_song"}:
            found = catalog.resolve(lib, str(value))
            hit = set(found["ids"]) & set(ids) if found["status"] != "missing" else set()
            if hit:
                problems.append(f"It still has {value} in it.")
        elif rule.kind == "family_only":
            off = [s for s in ids if getattr(lib.by_id.get(s), "family", None) != value]
            if off:
                problems.append(f"{len(off)} songs aren't {value}.")
        elif rule.kind == "tempo_range":
            off = [s for s in ids if lib.by_id.get(s) and not value[0] <= lib.by_id[s].bpm
                   <= value[1]]
            if off:
                problems.append(f"{len(off)} songs are outside {value[0]:.0f}–{value[1]:.0f} BPM.")
        elif rule.kind in {"start_with", "end_with", "include_song"}:
            found = catalog.resolve(lib, str(value))
            wanted = set(found["ids"])
            spot = ids[:1] if rule.kind == "start_with" else ids[-1:] if rule.kind == "end_with" \
                else ids
            if not wanted & set(spot):
                problems.append(f"{describe(rule)} isn't met.")
        elif rule.kind == "max_duration":
            duration = snapshot.get("evaluation", {}).get("duration", {})
            middle = (duration.get("low", 0) + duration.get("high", 0)) / 2
            if middle > value * 60:
                problems.append(f"It runs about {round(middle / 60)} minutes, over {value:.0f}.")
        elif rule.kind == "ready_only":
            verified = inv.by_key() if inv is not None else {}
            if any(seam["key"] not in verified for seam in snapshot["seams"]):
                problems.append("A transition in it isn't ready to play now.")
            elif not readiness.chain_is_stable(snapshot, store, lib.by_id):
                problems.append("A transition would need re-rendering to fit this order.")
    return problems


def _anchor(pool: Pool, kind: str, lib: Library, at_start: bool) -> list[int]:
    ids = pool.anchors.get(kind, [])
    if len(ids) <= 1:
        return ids
    ranked = sorted(ids, key=lambda song_id: -pool.belongs.get(song_id, 0.5))
    if at_start:
        ranked.sort(key=lambda song_id: getattr(lib.traits.get(song_id), "energy", 0.5))
    return ranked[:5]


def plan(
    conn: sqlite3.Connection,
    app: Any,
    lib: Library,
    rules: list[Constraint],
    *,
    title: str | None = None,
    variants: int = 1,
    seed: int | None = None,
) -> Outcome:
    """One or more validated proposals, or exactly why not."""
    conflicts = contradictions(rules)
    if conflicts:
        return Outcome("conflict", message="Some of these rules can't all hold.",
                       details={"conflicts": conflicts})
    pool = catalog.build_pool(lib, rules)
    if pool.clarify:
        return Outcome("clarify", message="Which one do you mean?",
                       details={"clarify": pool.clarify})
    if pool.problems:
        return Outcome("conflict", message=" ".join(pool.problems),
                       details={"problems": pool.problems, "excluded": pool.excluded})
    if not pool.songs:
        return Outcome("empty", message="No mix-ready songs fit these rules.",
                       details={"excluded": pool.excluded})
    count = min(target_count(rules, pool.songs), len(pool.songs))
    name = title or title_for(rules)
    ready_only = any(rule.kind == "ready_only" for rule in active(rules))
    if ready_only:
        return _plan_ready(conn, app, lib, rules, pool, count, name)
    return _plan_normal(conn, app, lib, rules, pool, count, name, variants, seed)


def _plan_ready(conn, app, lib, rules, pool, count, name) -> Outcome:
    inv = readiness.inventory(conn, app.store, pool.songs)
    allowed = set(inv.songs) & {song.id for song in pool.songs}
    starts = _anchor(pool, "start_with", lib, True) or [None]
    ends = _anchor(pool, "end_with", lib, False) or [None]
    best, longest, limited, found = None, 0, False, {}
    for start in starts:
        for end in ends:
            if start is not None and start not in allowed or end is not None and end not in \
                    allowed:
                continue
            found = readiness.plan_path(inv, count, start, end, allowed,
                                        max_steps=50000 // (len(starts) * len(ends)))
            longest = max(longest, found["longest"])
            limited = limited or found["search_limited"]
            if found["ids"] and set(pool.required) <= set(found["ids"]):
                best = found
                break
        if best:
            break
    details = {
        "candidate_tracks": len(allowed),
        "ready_edges": sum(len(e) for a, e in inv.adjacency.items() if a in allowed),
        "seams_examined": inv.counts.get("seams_examined", 0),
        "longest": longest,
        "search_limited": limited,
        "inventory_version": inv.version,
    }
    if best is None:
        if longest >= 2 and longest < count:
            shorter = readiness.plan_path(inv, longest, starts[0], None, allowed)
            if shorter["ids"]:
                snap = build_snapshot(lib, shorter["ids"], [e.settings for e in shorter["edges"]],
                                      rules, ready_only=True, title=name, variant="shorter")
                details["shorter"] = {"songs": len(shorter["ids"]),
                                      "titles": [s["title"] for s in snap["songs"]]}
        why = (
            f"I searched {details['candidate_tracks']} songs and {details['ready_edges']} "
            f"ready transitions. The longest connected run of already-ready transitions is "
            f"{longest} song{'s' if longest != 1 else ''}"
            + (" (I stopped searching at my limit, so a longer one may exist)" if limited else "")
            + "."
        )
        return Outcome("no_route", message=why, details=details)
    settings = [edge.settings for edge in best["edges"]]
    snap = build_snapshot(lib, best["ids"], settings, rules, ready_only=True, title=name,
                          variant="ready_now")
    evaluate(lib, snap, app.store, inv)
    problems = validate(lib, snap, rules, app.store, inv)
    if problems:
        return Outcome("conflict", message=" ".join(problems), details={"problems": problems})
    return Outcome("ok", [snap], details=details)


def _vibe_for(name: str, pool: Pool, rules: list[Constraint]):
    from selecta.planner.vibes import Vibe

    live = active(rules)
    arc = next((rule.value for rule in live if rule.kind == "energy_arc"), "slow_burn")
    style = next((rule.value for rule in live if rule.kind == "mix_style"), "balanced")
    ids = {song.id for song in pool.songs}
    preset, custom = ARCS.get(arc, ("slow_burn", None))
    vibe = Vibe(
        "lucy",
        name,
        "A mix planned with Lucy.",
        lambda song, _traits: song.id in ids,
        belongs=lambda song, _traits: pool.belongs.get(song.id, 0.5),
        language=style if style in {"seamless", "punchy", "wordplay"} else "balanced",
        arc=preset,
        wordplay=style == "wordplay",
        steady=0.55 if style == "seamless" else 0.35,
    )
    return vibe, custom


def _plan_normal(conn, app, lib, rules, pool, count, name, variants, seed) -> Outcome:
    from selecta.planner.vibes import build_vibe
    from selecta.session import get_steering

    vibe, custom = _vibe_for(name, pool, rules)
    steering = get_steering(conn)
    starts = _anchor(pool, "start_with", lib, True)
    ends = _anchor(pool, "end_with", lib, False)
    snapshots: list[dict] = []
    problems: list[str] = []
    attempts = [("balanced", vibe)]
    if variants > 1 and vibe.language != "seamless":
        from dataclasses import replace

        attempts.append(("smoother", replace(vibe, language="seamless", steady=0.6)))
    if variants > 2:
        from dataclasses import replace

        attempts.append(("different", replace(vibe, steady=0.2)))
    inv = readiness.inventory(conn, app.store, pool.songs)
    for index, (variant, chosen) in enumerate(attempts):
        try:
            planned, seams = build_vibe(
                chosen, lib.songs, lib.traits, lib.phrases, count,
                starts[0] if starts else None,
                seed=None if seed is None else seed + index,
                memory=lib.memory,
                mix_language=chosen.language if chosen.language != "balanced" else None,
                end_id=ends[0] if ends else None,
                stems=steering.stems,
                energy_arc=custom,
            )
        except ValueError as problem:
            problems.append(str(problem))
            continue
        planned_ids = [item.song.id for item in planned]
        planned_pairs = set(zip(planned_ids, planned_ids[1:], strict=False))
        ids = _with_required(lib, planned_ids, pool.required, count,
                             {ends[0]} if ends else set())
        # the planner's seam choice only stands for a pair it actually planned side by side
        settings = [seams.get(b, {}) if (a, b) in planned_pairs else {}
                    for a, b in zip(ids, ids[1:], strict=False)]
        snap = build_snapshot(lib, ids, settings, rules, ready_only=False, title=name,
                              variant=variant)
        evaluate(lib, snap, app.store, inv)
        found = validate(lib, snap, rules, app.store, inv)
        if found:
            problems += found
            continue
        if any(_similar(snap, other) for other in snapshots):
            continue
        snapshots.append(snap)
    if not snapshots:
        text = problems[0] if problems else "Nothing fit these rules."
        return Outcome("conflict", message=text, details={"problems": problems})
    return Outcome("ok", snapshots, details={"pool": len(pool.songs), "excluded": pool.excluded})


def _similar(one: dict, other: dict) -> bool:
    a = {song["song_id"] for song in one["songs"]}
    b = {song["song_id"] for song in other["songs"]}
    return len(a & b) / max(1, len(a | b)) > 0.8


def _with_required(lib: Library, ids: list[int], required: list[int], count: int,
                   keep: set[int]) -> list[int]:
    """Put each must-include song where its neighbours suit it best, dropping the weakest-fitting
    unanchored song if that would make it too long."""
    ids = list(ids)
    for song_id in required:
        if song_id in ids or song_id not in lib.by_id:
            continue
        song = lib.by_id[song_id]
        best, best_cost = len(ids), float("inf")
        for at in range(1, len(ids) + 1):
            before = lib.by_id.get(ids[at - 1])
            after = lib.by_id.get(ids[at]) if at < len(ids) else None
            cost = (_tempo_gap(before, song) or 0.1) + ((_tempo_gap(song, after) or 0.1)
                                                       if after else 0)
            if cost < best_cost:
                best, best_cost = at, cost
        ids.insert(best, song_id)
        while len(ids) > count:
            removable = [s for s in ids[1:] if s not in required and s not in keep]
            if not removable:
                break
            ids.remove(removable[-1])
    return ids
