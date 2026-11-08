"""Critiques as the smallest change that satisfies them (ADR-0324, LU-324-01..07).

Edits are resolved against one exact base revision and, when given, the person's selected
occurrence. Songs nobody asked about keep their place and their occurrence ids; each change
re-checks the seams on both sides of what moved; hard rules are validated on the result, and if
anything fails nothing is written. When a change really needs a new route (say, switching to
ready-only), it says so instead of passing a replan off as a small edit.
"""

from __future__ import annotations

import re
from typing import Any

from selecta.lucy import catalog, planning, readiness
from selecta.lucy.catalog import Library
from selecta.lucy.intent import Constraint, active, describe, merge
from selecta.lucy.planning import Outcome

ORDINALS = {
    "first": 1, "second": 2, "third": 3, "fourth": 4, "fifth": 5, "sixth": 6, "seventh": 7,
    "eighth": 8, "ninth": 9, "tenth": 10, "eleventh": 11, "twelfth": 12,
}
THIS = {"this", "this one", "it", "that", "that one", "the selected one", "the selected song",
        "this song", "this track", "the one i picked"}
SLOWER = re.compile(r"\b(slower|calmer|chill(er)?|softer|less energy|mellow(er)?)\b", re.I)
FASTER = re.compile(r"\b(faster|bigger|harder|more energy|hype|upbeat|livelier)\b", re.I)


class Edit:
    """A working copy of one revision's order, carrying identities through every change."""

    def __init__(self, snapshot: dict) -> None:
        self.ids = [song["song_id"] for song in snapshot["songs"]]
        self.occ = [song["occurrence"] for song in snapshot["songs"]]
        self.locked = [bool(song.get("locked")) for song in snapshot["songs"]]
        self.settings = {
            (seam["a_occ"], seam["b_occ"]): seam.get("settings") or {}
            for seam in snapshot["seams"]
        }
        self.notes: list[str] = []
        self.replanned = False
        self.removed: set[int] = set(snapshot.get("left_out", []))
        """Songs the person took out stay out of later suggestions unless they ask for them."""
        self.resized = False

    def insert(self, at: int, song_id: int) -> None:
        from selecta.lucy.ids import new_id

        self.ids.insert(at, song_id)
        self.occ.insert(at, new_id("occurrence"))
        self.locked.insert(at, False)

    def pop(self, at: int) -> int:
        self.occ.pop(at)
        self.locked.pop(at)
        return self.ids.pop(at)

    def seam_settings(self, ready: Any | None) -> list[dict] | None:
        settings = []
        for index in range(len(self.ids) - 1):
            pair = (self.occ[index], self.occ[index + 1])
            if pair in self.settings:
                settings.append(self.settings[pair])
            elif ready is not None:
                edge = ready.edge(self.ids[index], self.ids[index + 1])
                if edge is None:
                    return None
                settings.append(edge.settings)
            else:
                settings.append({})
        return settings


def resolve_target(snapshot: dict, text: str, selection: dict | None) -> dict:
    """Which exact occurrence a critique means: the selection, a position, or a name."""
    songs = snapshot["songs"]
    words = " ".join(text.casefold().split()).strip(" .,!?\"'")
    if words.isdigit():
        words = f"song {words}"
    if words in THIS or not words:
        occurrence = (selection or {}).get("occurrence")
        if occurrence and any(song["occurrence"] == occurrence for song in songs):
            return {"status": "ok", "occurrences": [occurrence]}
        return {"status": "clarify", "text": "Which song do you mean? Select it in your mix."}
    match = re.search(r"\b(?:song|track|number|no\.?|#)\s*(\d{1,3})\b|\b(\d{1,3})(?:st|nd|rd|th)\b",
                      words)
    position = None
    if match:
        position = int(match.group(1) or match.group(2))
    else:
        for word, number in ORDINALS.items():
            if re.search(rf"\b{word}\b", words):
                position = number
                break
        if re.search(r"\blast\b", words):
            position = len(songs)
    if position is not None:
        if 1 <= position <= len(songs):
            return {"status": "ok", "occurrences": [songs[position - 1]["occurrence"]]}
        return {"status": "clarify", "text": f"There are only {len(songs)} songs."}
    words = re.sub(r"^(the )?(song|track) (called |named )?", "", words)
    hits = [
        song for song in songs
        if words in song["title"].casefold() or words in song["artist"].casefold()
    ]
    if len(hits) == 1:
        return {"status": "ok", "occurrences": [hits[0]["occurrence"]]}
    if hits:
        return {
            "status": "clarify",
            "text": f"“{text}” could mean several songs here.",
            "options": [
                {"occurrence": song["occurrence"], "position": songs.index(song) + 1,
                 "title": song["title"], "artist": song["artist"]}
                for song in hits
            ],
        }
    return {"status": "clarify", "text": f"I can't find “{text}” in this mix."}


def _candidates(lib: Library, pool: catalog.Pool, work: Edit, at: int, hint: str | None,
                replacing: int | None, ready: Any | None) -> list[int]:
    from selecta.planner.beam import rank_candidates

    before = lib.by_id.get(work.ids[at - 1]) if at > 0 else None
    after = lib.by_id.get(work.ids[at]) if at < len(work.ids) else None
    options = [song for song in pool.songs
               if song.id not in set(work.ids) and song.id not in work.removed]
    old = lib.by_id.get(replacing) if replacing is not None else None
    if hint:
        named = catalog.resolve(lib, hint, options)
        if named["status"] in {"song", "artist", "ambiguous"}:
            wanted = set(named["ids"])
            options = [song for song in options if song.id in wanted]
        elif SLOWER.search(hint) and old is not None:
            options = [song for song in options if (lib.traits[song.id].energy <
                       lib.traits[old.id].energy) or song.bpm < old.bpm * 0.97]
        elif FASTER.search(hint) and old is not None:
            options = [song for song in options if (lib.traits[song.id].energy >
                       lib.traits[old.id].energy) or song.bpm > old.bpm * 1.03]
    if ready is not None:
        options = [
            song for song in options
            if (before is None or ready.edge(before.id, song.id))
            and (after is None or ready.edge(song.id, after.id))
        ]
    if not options:
        return []
    ranked = rank_candidates(before, after, options, set(work.ids), lib.phrases,
                             belongs=pool.belongs, memory=lib.memory)
    return [suggestion.song.id for suggestion in ranked[:5]]


def revise(
    conn: Any,
    app: Any,
    lib: Library,
    base: dict,
    ops: list[dict],
    new_rules: list[Constraint],
    selection: dict | None,
) -> Outcome:
    """Apply critiques and new rules to one exact base revision, minimally."""
    old_rules = [Constraint.from_dict(rule) for rule in base.get("constraints", [])]
    rules = merge(old_rules, new_rules)
    ready_only = any(rule.kind == "ready_only" for rule in active(rules))
    pool = catalog.build_pool(lib, rules)
    if pool.clarify:
        return Outcome("clarify", message="Which one do you mean?",
                       details={"clarify": pool.clarify})
    if pool.problems:
        return Outcome("conflict", message=" ".join(pool.problems),
                       details={"problems": pool.problems})
    inv = readiness.inventory(conn, app.store, pool.songs)
    ready = inv if ready_only else None
    if ready_only and not base.get("ready_only"):
        stays = Edit(base).seam_settings(None)
        snap = planning.build_snapshot(
            lib, [s["song_id"] for s in base["songs"]], stays or [], rules, ready_only=True,
            title=base["title"], occurrences=[s["occurrence"] for s in base["songs"]],
            locked=[s["locked"] for s in base["songs"]])
        planning.evaluate(lib, snap, app.store, inv)
        if planning.validate(lib, snap, rules, app.store, inv):
            locked = [s for s in base["songs"] if s["locked"]]
            outcome = planning.plan(conn, app, lib, rules, title=base["title"])
            if outcome.status == "ok":
                outcome.details["replanned"] = (
                    "Not every transition in the old order was ready, so this is a new route "
                    "made only of transitions that are ready now."
                    + (" Locked songs couldn't all be kept." if locked else "")
                )
            return outcome
    work = Edit(base)
    for op in ops:
        problem = _apply(lib, pool, work, op, selection, base, ready)
        if problem is not None:
            return problem
    count = next((rule for rule in active(rules) if rule.kind == "count"), None)
    if work.resized and count is not None and count.value != len(work.ids) and not any(
            rule.kind == "count" for rule in new_rules):
        # the person changed the length by hand: that is the newer, more specific instruction
        rules = merge(rules, [Constraint("count", "", len(work.ids), "hard", source="edit",
                                         created_turn=count.created_turn,
                                         text="changed by an edit")])
        work.notes.append(f"Now {len(work.ids)} songs.")
    problem = _enforce(lib, pool, work, rules, ready)
    if problem is not None:
        return problem
    settings = work.seam_settings(ready)
    if settings is None:
        return Outcome("conflict", message="That change would need a transition that isn't "
                       "ready yet, and this mix only uses ready ones.",
                       details={"rule": "ready_only"})
    snap = planning.build_snapshot(lib, work.ids, settings, rules, ready_only=ready_only,
                                   title=base["title"], variant=base.get("variant", "balanced"),
                                   occurrences=work.occ, locked=work.locked)
    snap["left_out"] = sorted(work.removed - set(work.ids))
    planning.evaluate(lib, snap, app.store, inv)
    problems = planning.validate(lib, snap, rules, app.store, inv)
    if problems:
        return Outcome("conflict", message=" ".join(problems), details={"problems": problems})
    return Outcome("ok", [snap], details={"notes": work.notes})


def _index(work: Edit, occurrence: str) -> int:
    return work.occ.index(occurrence)


def _apply(lib, pool, work: Edit, op: dict, selection, base, ready) -> Outcome | None:
    kind = op["op"]
    if kind in {"grow", "shrink"}:
        work.resized = True
        return _resize(lib, pool, work, int(op.get("by") or 1) * (1 if kind == "grow" else -1),
                       ready)
    occurrence = op.get("occurrence")
    if occurrence is None:
        found = resolve_target(base, op.get("target", ""), selection)
        if found["status"] != "ok":
            return Outcome("clarify", message=found["text"],
                           details={"options": found.get("options", [])})
        occurrence = found["occurrences"][0]
    if occurrence not in work.occ:
        return Outcome("conflict", message="That song is no longer in this proposal.")
    at = _index(work, occurrence)
    name = lib.label(work.ids[at])["title"]
    if kind in {"lock", "unlock"}:
        work.locked[at] = kind == "lock"
        work.notes.append(f"{'Locked' if kind == 'lock' else 'Unlocked'} {name}.")
        return None
    if work.locked[at]:
        return Outcome("conflict", message=f"{name} is locked. Unlock it first to change it.")
    if kind == "remove":
        if len(work.ids) <= 1:
            return Outcome("conflict", message="A mix needs at least one song.")
        work.removed.add(work.pop(at))
        work.resized = True
        work.notes.append(f"Removed {name}.")
        return None
    if kind == "replace":
        # ranked for the gap the old song leaves, between its two neighbours
        old = work.pop(at)
        work.removed.add(old)
        options = [
            song for song in _candidates(lib, pool, work, at, op.get("with"), old, ready)
            if song != old
        ]
        if not options:
            return Outcome("conflict", message=f"Nothing fits in place of {name} under these "
                           "rules.")
        work.insert(at, options[0])
        work.notes.append(f"Replaced {name} with {lib.label(options[0])['title']}.")
        return None
    if kind == "move":
        if "to" in op and op["to"] is not None:
            target = max(0, min(len(work.ids) - 1, int(op["to"])))
        elif op.get("to_edge"):
            target = 0 if op.get("direction") == "earlier" else len(work.ids) - 1
        else:
            target = at - 1 if op.get("direction") == "earlier" else at + 1
        target = max(0, min(len(work.ids) - 1, target))
        if target == at:
            return None
        song, lock = work.ids[at], work.locked[at]
        work.pop(at)
        work.ids.insert(target, song)
        work.occ.insert(target, occurrence)
        work.locked.insert(target, lock)
        work.notes.append(f"Moved {name} to position {target + 1}.")
        return None
    return Outcome("conflict", message=f"I can't do “{kind}” to a proposal.")


def _resize(lib, pool, work: Edit, change: int, ready) -> Outcome | None:
    ends_fixed = bool(pool.anchors.get("end_with"))
    if change > 0:
        for _ in range(change):
            at = len(work.ids) - 1 if ends_fixed and len(work.ids) > 1 else len(work.ids)
            options = _candidates(lib, pool, work, at, None, None, ready)
            if not options:
                return Outcome("conflict", message="No more songs fit these rules.")
            work.insert(at, options[0])
            work.notes.append(f"Added {lib.label(options[0])['title']}.")
        return None
    for _ in range(-change):
        last = len(work.ids) - (2 if ends_fixed else 1)
        removable = [i for i in range(last, 0, -1) if not work.locked[i]]
        if not removable:
            return Outcome("conflict", message="Every song left is locked or required.")
        name = lib.label(work.pop(removable[0]))["title"]
        work.notes.append(f"Removed {name}.")
    return None


def _enforce(lib, pool, work: Edit, rules: list[Constraint], ready) -> Outcome | None:
    """Make the order meet newly added hard rules by changing only the songs that break them."""
    allowed = {song.id for song in pool.songs}
    for at in range(len(work.ids)):
        if work.ids[at] in allowed:
            continue
        if work.locked[at]:
            return Outcome("conflict", message=f"{lib.label(work.ids[at])['title']} is locked, "
                           "but a rule now rules it out. Unlock it or remove the rule.")
        old = work.pop(at)
        options = _candidates(lib, pool, work, at, None, old, ready)
        if not options:
            return Outcome("conflict", message="Nothing fits in its place under these rules.")
        work.insert(at, options[0])
        work.notes.append(f"Swapped out {lib.label(old)['title']} to meet the new rules.")
    for kind, at_start in (("start_with", True), ("end_with", False)):
        anchor = set(pool.anchors.get(kind, []))
        spot = 0 if at_start else len(work.ids) - 1
        if not anchor or work.ids[spot] in anchor:
            continue
        chosen = next((song for song in pool.anchors[kind] if song not in work.ids), None)
        if chosen is None:
            present = next(i for i, song in enumerate(work.ids) if song in anchor)
            occurrence = work.occ[present]
            song, lock = work.ids[present], work.locked[present]
            work.pop(present)
            work.ids.insert(spot if at_start else len(work.ids), song)
            work.occ.insert(spot if at_start else len(work.occ), occurrence)
            work.locked.insert(spot if at_start else len(work.locked), lock)
        elif work.locked[spot]:
            return Outcome("conflict", message="The song in that spot is locked.")
        else:
            work.pop(spot)
            work.insert(spot if at_start else len(work.ids), chosen)
        work.notes.append(describe(next(r for r in active(rules) if r.kind == kind)) + ".")
    for song_id in pool.required:
        if song_id not in work.ids:
            work.insert(len(work.ids) - (1 if pool.anchors.get("end_with") else 0), song_id)
            work.notes.append(f"Added {lib.label(song_id)['title']}.")
    count = next((rule.value for rule in active(rules) if rule.kind == "count"), None)
    if count is not None and count != len(work.ids):
        return _resize(lib, pool, work, count - len(work.ids), ready)
    return None
