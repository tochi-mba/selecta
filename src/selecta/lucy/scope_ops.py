"""The mix Lucy was opened from (ADR-0327, LU-327-01..04).

Lucy reads the current mix or a draft through Selecta's own `read_mix`, and never edits it.
"Start from this mix" copies its exact order and seam settings into a proposal; approving that
later builds a NEW draft, so a manual edit made meanwhile is never overwritten by stale AI work.
"""

from __future__ import annotations

import json

from weftai import value
from weftai.schema.spec import any_schema, object_schema

from selecta import mix
from selecta.lucy import planning, readiness
from selecta.lucy.ids import new_id
from selecta.lucy.planning import Outcome
from selecta.lucy.tools import ProposalSong, ProposalSongs, define


def scope_of(ctx) -> dict:
    row = ctx.conn.execute("SELECT scope FROM lucy_conversations WHERE id=?",
                           (ctx.conversation,)).fetchone()
    return json.loads(row["scope"]) if row else {}


def _items(ctx) -> tuple[list[dict], str]:
    scope = scope_of(ctx)
    if scope.get("kind") not in {"current", "draft"}:
        raise ValueError("This conversation wasn't opened from a mix.")
    draft = int(scope["draft"]) if scope.get("kind") == "draft" else None
    try:
        items = mix.read_mix(ctx.conn, ctx.app.store, draft)
    except mix.NoSuchDraft as problem:
        raise ValueError("That draft isn't there any more.") from problem
    return items, mix.mix_name(ctx.conn, draft)


def _read(run) -> list[ProposalSong]:
    items, name = _items(run.ctx)
    run.notice(f"“{name}”, read only. Lucy can't change it; it can copy it into a proposal.")
    selected = scope_of(run.ctx).get("occurrence")
    if selected is not None:
        run.notice(f"The person is asking about song {int(selected) + 1}.")
    return [
        ProposalSong(position=i + 1, occurrence=f"pos{i}", song_id=item["song_id"],
                     title=item["title"], artist=item["artist"], bpm=item["bpm"],
                     key=item["key"], energy=item.get("energy"), locked=item["locked"])
        for i, item in enumerate(items)
    ]


def _copy(run) -> dict:
    from selecta.lucy import conversations, proposal_ops

    ctx = run.ctx
    if ctx.turn and conversations.is_superseded(ctx.conn, ctx.turn):
        return {"status": "superseded", "message": "A newer message replaced this one."}
    items, name = _items(ctx)
    if not items:
        raise ValueError("That mix is empty.")
    lib = ctx.lib()
    ids = [item["song_id"] for item in items]
    settings = [item["seam"]["settings"] for item in items[1:]]
    snap = planning.build_snapshot(lib, ids, settings, [], ready_only=False,
                                   title=f"{name} (with Lucy)", variant="from_mix",
                                   occurrences=[new_id("occurrence") for _ in ids],
                                   locked=[item["locked"] for item in items])
    inv = readiness.inventory(ctx.conn, ctx.app.store, lib.songs)
    planning.evaluate(lib, snap, ctx.app.store, inv)
    outcome = Outcome("ok", [snap], details={"notes": [f"Copied “{name}” as it is; it stays "
                                                      "unchanged."]})
    try:
        revision, variants = proposal_ops.publish(ctx.conn, ctx.conversation, outcome, "plan",
                                                  ctx.expected, ctx.turn)
    except Exception as problem:  # noqa: BLE001 - reported to the model as a failed step
        return {"status": "stale", "message": str(problem)}
    ctx.expected = revision["id"]
    ctx.revisions.append(revision["id"])
    return proposal_ops.outcome_value(outcome, revision, variants)


def operations() -> list:
    return [
        define("mix.scope", "The songs of the mix this conversation was opened from (the "
               "current mix or a draft), read only.", object_schema({}), ProposalSongs, _read),
        define("proposals.fromScope", "Copy the mix this conversation was opened from into a "
               "proposal, exactly as it is, so it can be revised. The original never changes.",
               object_schema({}), value(any_schema()), _copy, tier="propose"),
    ]
