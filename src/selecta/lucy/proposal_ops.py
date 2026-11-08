"""Proposal operations: plan, revise, relax a rule, read the current one (propose tier).

They write proposal revisions only, never drafts, the mix or the player. Each write names the
revision it expects to replace; a superseded turn never publishes (LU-311-05), and a revision
from another tab or a newer turn wins over an older generation finishing late (LU-334-04).
"""

from __future__ import annotations

from typing import Any

from weftai import value
from weftai.schema.spec import (
    any_schema,
    array_schema,
    integer_schema,
    object_schema,
    string_schema,
)

from selecta.lucy import catalog, conversations, intent, planning, proposals, readiness, repair
from selecta.lucy.intent import HARD_KINDS, KINDS, Constraint
from selecta.lucy.planning import Outcome
from selecta.lucy.tools import ProposalSong, ProposalSongs, Seam, Seams, define

RULE_KINDS_TEXT = ", ".join(sorted(KINDS))


def _coerce(kind: str, raw: Any) -> Any:
    if kind == "count":
        number = int(raw)
        if not 1 <= number <= 100:
            raise ValueError("A mix has 1 to 100 songs.")
        return number
    if kind in {"duration", "max_duration"}:
        minutes = float(raw)
        if not 5 <= minutes <= 600:
            raise ValueError("Durations are in minutes, between 5 and 600.")
        return minutes
    if kind == "tempo_range":
        low, high = sorted(float(x) for x in raw)
        return [low, high]
    if kind == "tempo_near":
        return float(raw)
    if kind in {"ready_only", "prefer_ready"}:
        return True
    return raw if isinstance(raw, list) else str(raw)


def rules_from(items: list | None, text: str | None, turn: str | None) -> list[Constraint]:
    rules: list[Constraint] = []
    for item in items or []:
        if not isinstance(item, dict) or item.get("kind") not in KINDS:
            raise ValueError(f"Unknown rule kind {item!r}. Known kinds: {RULE_KINDS_TEXT}.")
        kind = item["kind"]
        raw = item.get("value", item.get("target"))
        coerced = _coerce(kind, raw)
        target = str(item.get("target") or (coerced if isinstance(coerced, str) else ""))
        rules.append(Constraint(kind, target.casefold().strip(), coerced,
                                "hard" if kind in HARD_KINDS else "soft", source="model",
                                created_turn=turn, text=str(item.get("text") or "")[:200]))
    if text:
        rules += intent.parse(str(text), turn)
    return rules


def visual_of(revision: dict | None, outcome: Outcome) -> dict:
    if revision is None:
        return {"rules": [], "songs": [], "count": 0, "duration": None, "ready_only": False}
    snap = revision["snapshot"]
    duration = snap.get("evaluation", {}).get("duration")
    return {
        "number": revision["number"],
        "counts": (snap.get("diff") or {}).get("counts"),
        "songs": [
            {"id": s["song_id"], "title": s["title"], "artist": s["artist"],
             "energy": s["energy"]} for s in snap["songs"][:40]
        ],
        "count": len(snap["songs"]),
        "duration": {"low": duration["low"], "high": duration["high"]} if duration else None,
        "ready_only": bool(snap.get("ready_only")),
        "rules": [
            {"id": rule["id"], "label": rule["label"], "strength": rule["strength"],
             "status": "pass"}
            for rule in snap["constraints"] if rule["status"] == "active"
        ],
    }


def outcome_value(outcome: Outcome, revision: dict | None, variants: list[dict]) -> dict:
    """What the model reads back: exact facts it can cite, nothing it should invent."""
    if outcome.status != "ok" or revision is None:
        shown = {key: value for key, value in outcome.details.items()
                 if key in {"conflicts", "problems", "clarify", "options", "longest",
                            "ready_edges", "candidate_tracks", "search_limited", "shorter",
                            "excluded", "rule"}}
        return {"status": outcome.status, "message": outcome.message, "details": shown,
                "visual": visual_of(None, outcome)}
    snap = revision["snapshot"]
    evaluation = snap["evaluation"]
    needed = max(0, len(snap["songs"]) - 1)
    ready = sum(1 for seam in snap["seams"] if seam["ready"]["verified"]
                or seam["ready"]["status"] == "ready")
    return {
        "status": "ok",
        "state": "proposed, not built",
        "revision": revision["number"],
        "title": snap["title"],
        "songs": [f"{i}. {s['artist']} – {s['title']}" for i, s in enumerate(snap["songs"], 1)],
        "transitions_ready_now": f"{ready} of {needed}",
        "minutes": [round(evaluation["duration"]["low"] / 60), round(
            evaluation["duration"]["high"] / 60)],
        "minutes_exact": evaluation["duration"]["exact"],
        "rules": [rule["label"] for rule in snap["constraints"] if rule["status"] == "active"],
        "warnings": evaluation["warnings"][:6],
        "changes": revision["summary"],
        "notes": outcome.details.get("notes", []),
        "replanned": outcome.details.get("replanned"),
        "variants": [
            {"revision": v["number"], "variant": v["snapshot"].get("variant"),
             "songs": len(v["snapshot"]["songs"])} for v in variants
        ],
        "visual": visual_of(revision, outcome),
    }


def publish(conn, conversation: str, outcome: Outcome, kind: str, expected: str | None,
            turn: str | None = None) -> tuple[dict, list[dict]]:
    proposal = proposals.ensure_proposal(conn, conversation)
    base = proposals.current(conn, proposal)
    first = outcome.snapshots[0]
    if base is not None and kind in {"plan", "restore"}:
        carry_identity(base["snapshot"], first)
    change = proposals.diff(base["snapshot"] if base else None, first)
    first["diff"] = change if base else None
    summary = proposals.summary_text(change) if base else f"{len(first['songs'])} songs"
    if outcome.details.get("replanned"):
        summary = "New route: " + summary
    revision = proposals.add_revision(
        conn, proposal, first, kind=kind, expected_current=expected, turn=turn, summary=summary,
        branch=base["branch"] if base and kind == "revise" else "main")
    variants = []
    for index, snap in enumerate(outcome.snapshots[1:], start=2):
        snap["diff"] = proposals.diff(first, snap)
        variants.append(proposals.add_revision(
            conn, proposal, snap, kind="variant", expected_current=None, make_current=False,
            parent=revision["id"], branch=f"variant-{revision['number']}-{index}", turn=turn,
            summary=f"Variant: {snap.get('variant', index)}"))
    return revision, variants


def carry_identity(base: dict, snap: dict) -> None:
    """A song that stays across a replan keeps its occurrence id, so a selection follows it and
    the diff says kept or moved rather than replaced (LU-306-04, LU-325-01)."""
    spare: dict[int, list[str]] = {}
    for song in base.get("songs", []):
        spare.setdefault(song["song_id"], []).append(song["occurrence"])
    renamed: dict[str, str] = {}
    for song in snap["songs"]:
        reuse = spare.get(song["song_id"])
        if reuse:
            renamed[song["occurrence"]] = reuse.pop(0)
            song["occurrence"] = renamed[song["occurrence"]]
    for seam in snap["seams"]:
        seam["a_occ"] = renamed.get(seam["a_occ"], seam["a_occ"])
        seam["b_occ"] = renamed.get(seam["b_occ"], seam["b_occ"])


def _guarded(run, make: Any, kind: str) -> dict:
    ctx = run.ctx
    if ctx.turn and conversations.is_superseded(ctx.conn, ctx.turn):
        return {"status": "superseded", "message": "A newer message replaced this one; nothing "
                "was written."}
    run.ctx.progress(run.step.id, 1, 3, "stages", "Choosing songs that fit the rules")
    outcome = make()
    run.ctx.progress(run.step.id, 2, 3, "stages", "Checking every rule and transition")
    revision, variants = None, []
    if outcome.status == "ok":
        if ctx.turn and conversations.is_superseded(ctx.conn, ctx.turn):
            return {"status": "superseded", "message": "A newer message replaced this one; "
                    "nothing was written."}
        try:
            revision, variants = publish(ctx.conn, ctx.conversation, outcome, kind, ctx.expected,
                                         ctx.turn)
        except proposals.StaleRevision:
            return {"status": "stale", "message": "The proposal changed in another tab or by "
                    "a newer message, so this result was not saved."}
        ctx.expected = revision["id"]
        ctx.revisions.append(revision["id"])
    run.ctx.progress(run.step.id, 3, 3, "stages", "Done")
    ctx.outcomes.append({"kind": kind, "status": outcome.status, "message": outcome.message,
                         "details": outcome.details,
                         "revision": revision["id"] if revision else None})
    return outcome_value(outcome, revision, variants)


def _current(ctx) -> dict | None:
    row = ctx.conn.execute("SELECT proposal_id FROM lucy_conversations WHERE id=?",
                           (ctx.conversation,)).fetchone()
    return proposals.current(ctx.conn, row["proposal_id"]) if row and row["proposal_id"] else None


def _plan(run) -> dict:
    ctx = run.ctx
    new = rules_from(run.input.get("rules"), run.input.get("text"), ctx.turn)
    base = _current(ctx)
    existing = [Constraint.from_dict(r) for r in base["snapshot"]["constraints"]] if base else []
    rules = intent.merge(existing, new)
    return _guarded(run, lambda: planning.plan(
        ctx.conn, ctx.app, ctx.lib(), rules, title=run.input.get("title") or None,
        variants=max(1, min(3, int(run.input.get("variants") or 1)))), "plan")


def _revise(run) -> dict:
    ctx = run.ctx
    base = _current(ctx)
    if base is None:
        raise ValueError("There is no proposal yet. Use proposals.plan first.")
    edits = [dict(edit) for edit in run.input.get("edits") or [] if isinstance(edit, dict)]
    text = run.input.get("text")
    if text:
        edits += intent.critique_ops(str(text))
    for edit in edits:
        if edit.get("op") not in {"remove", "replace", "move", "lock", "unlock", "grow",
                                  "shrink"}:
            raise ValueError("Edits are remove, replace, move, lock, unlock, grow or shrink.")
    new = rules_from(run.input.get("rules"), text, ctx.turn)
    if not edits and not new:
        raise ValueError("Say what to change: edits, rules or text.")
    return _guarded(run, lambda: repair.revise(ctx.conn, ctx.app, ctx.lib(), base["snapshot"],
                                               edits, new, ctx.selection), "revise")


def relax_rule(conn, app, lib, base: dict, rule_id: str) -> Outcome:
    """Remove one rule. Relaxing never needs a song to change, so none do (LU-321-07)."""
    rules = [Constraint.from_dict(r) for r in base["constraints"]]
    if not any(rule.id == rule_id and rule.status == "active" for rule in rules):
        return Outcome("conflict", message="That rule isn't active on this proposal.")
    rules = intent.remove(rules, rule_id)
    snap = dict(base)
    snap["constraints"] = planning.rule_dicts(rules)
    snap["ready_only"] = any(rule.kind == "ready_only" for rule in intent.active(rules))
    snap.pop("diff", None)
    inv = readiness.inventory(conn, app.store, lib.songs)
    planning.evaluate(lib, snap, app.store, inv)
    return Outcome("ok", [snap], details={"notes": ["Removed a rule; the songs stay as they "
                                                    "were."]})


def _remove_rule(run) -> dict:
    ctx = run.ctx
    base = _current(ctx)
    if base is None:
        raise ValueError("There is no proposal yet.")
    return _guarded(run, lambda: relax_rule(ctx.conn, ctx.app, ctx.lib(), base["snapshot"],
                                            str(run.input["rule"])), "revise")


def _read_current(run) -> list[ProposalSong]:
    base = _current(run.ctx)
    if base is None:
        run.notice("There is no proposal yet.")
        return []
    snap = base["snapshot"]
    run.notice(f"Revision {base['number']}: “{snap['title']}”, proposed and not built.")
    for rule in snap["constraints"]:
        if rule["status"] == "active":
            run.notice(f"Rule ({'must' if rule['strength'] == 'hard' else 'prefer'}): "
                       f"{rule['label']} [id {rule['id']}]")
    return [
        ProposalSong(position=i, occurrence=s["occurrence"], song_id=s["song_id"],
                     title=s["title"], artist=s["artist"], bpm=s["bpm"], key=s["key"],
                     energy=s["energy"], locked=s["locked"])
        for i, s in enumerate(snap["songs"], 1)
    ]


def _read_seams(run) -> list[Seam]:
    ctx = run.ctx
    base = _current(ctx)
    if base is None:
        run.notice("There is no proposal yet.")
        return []
    snap = base["snapshot"]
    lib = ctx.lib()
    found = readiness.ledger(ctx.conn, ctx.app.store, snap, lib.songs)
    run.notice(f"{found['ready']} of {found['needed']} transitions ready; "
               f"{'playable now without waiting' if found['playable_now'] else 'not all ready'}.")
    rows = []
    for seam, row in zip(snap["seams"], found["seams"], strict=True):
        rows.append(Seam(key=row["key"], a=seam["a"], b=seam["b"],
                         a_title=lib.label(seam["a"])["title"],
                         b_title=lib.label(seam["b"])["title"], requested=row["requested"],
                         rendered=row["rendered"], status=row["status"],
                         verified=row["verified"], history=seam["evidence"]["history"]))
    return rows


def direct_edit(conn, app, conversation: str, revision: dict, op: dict) -> Outcome:
    """The touch and keyboard alternatives in the proposal pane: lock, unlock, remove, move."""
    lib = catalog.load(conn, app)
    if op.get("op") not in {"lock", "unlock", "remove", "move"}:
        return Outcome("conflict", message="Choose lock, unlock, remove or move.")
    return repair.revise(conn, app, lib, revision["snapshot"], [op], [], None)


def restore_snapshot(conn, app, revision: dict) -> Outcome:
    """An old revision brought back as a new one, re-evaluated against today's facts."""
    lib = catalog.load(conn, app)
    snap = {key: value for key, value in revision["snapshot"].items() if key != "diff"}
    rules = [Constraint.from_dict(r) for r in snap["constraints"]]
    inv = readiness.inventory(conn, app.store, lib.songs)
    planning.evaluate(lib, snap, app.store, inv)
    problems = planning.validate(lib, snap, rules, app.store, inv)
    if problems:
        return Outcome("conflict", message=" ".join(problems), details={"problems": problems})
    return Outcome("ok", [replace_variant(snap, "restored")])


def replace_variant(snap: dict, variant: str) -> dict:
    return {**snap, "variant": variant}


def operations() -> list:
    rule_item = any_schema()
    return [
        define("proposals.current", "The current proposal's songs in order, its revision, rules "
               "(with ids) and that it is not built.", object_schema({}), ProposalSongs,
               _read_current),
        define("proposals.seams", "The current proposal's transitions, checked now: which are "
               "ready to play and which still need rendering.", object_schema({}), Seams,
               _read_seams),
        define("proposals.plan", "Plan a new proposal (not a draft) from rules. Rules are "
               "objects {kind, target?, value}; kinds: " + RULE_KINDS_TEXT + ". Hard kinds are "
               "never relaxed. Or pass the person's words as `text`. Existing rules carry over "
               "unless replaced.",
               object_schema({
                   "rules": array_schema(rule_item).optional(),
                   "text": string_schema().optional(),
                   "title": string_schema().optional(),
                   "variants": integer_schema().optional(),
               }), value(any_schema()), _plan, tier="propose"),
        define("proposals.revise", "Change the current proposal as little as possible. Edits: "
               "{op: remove|replace|move|lock|unlock|grow|shrink, target (a position like "
               "'song 3', a title, or 'this one' for the selection), with?, direction?: "
               "earlier|later, by?}. New rules may be added too.",
               object_schema({
                   "edits": array_schema(any_schema()).optional(),
                   "rules": array_schema(rule_item).optional(),
                   "text": string_schema().optional(),
               }), value(any_schema()), _revise, tier="propose"),
        define("proposals.removeRule", "Remove one rule (by its id from proposals.current); the "
               "songs stay.", object_schema({"rule": string_schema()}), value(any_schema()),
               _remove_rule, tier="propose"),
    ]


__all__ = ["direct_edit", "operations", "outcome_value", "publish", "relax_rule",
           "restore_snapshot", "rules_from"]
