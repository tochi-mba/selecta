"""Lucy's API: conversations, turns, the replayable event stream, proposals, approvals,
commits, permissions, memory and listening history (ADR-0300..0339).

Every route is local-only like the rest of the API. Turning Lucy off stops model work and new
writes but leaves reading history, drafts and the music untouched (LU-338-05).
"""

from __future__ import annotations

import asyncio
import json

from fastapi import Request
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel

from selecta.lucy import (
    agent,
    catalog,
    commit,
    conversations,
    events,
    memory,
    permissions,
    policy,
    proposal_ops,
    proposals,
    readiness,
    schema,
)
from selecta.lucy import settings as lucy_settings

STREAM_WAIT_SECONDS = 15.0


class LucyProblem(Exception):
    """An answer the page can act on: plain words plus a stable code."""

    def __init__(self, status: int, detail: str, code: str) -> None:
        super().__init__(detail)
        self.status = status
        self.detail = detail
        self.code = code


class NewConversation(BaseModel):
    title: str = ""
    scope: dict | None = None


class ConversationPatch(BaseModel):
    title: str | None = None
    archived: bool | None = None


class TurnBody(BaseModel):
    client_id: str
    text: str
    expected_revision: str | None = None
    selection: dict | None = None


class RetryBody(BaseModel):
    turn: str


class BranchBody(BaseModel):
    message: str


class Expected(BaseModel):
    expected: str | None = None


class CurrentBody(BaseModel):
    revision: str
    expected: str | None = None


class EditBody(BaseModel):
    expected: str | None = None
    op: dict


class ApprovalBody(BaseModel):
    revision: str
    hash: str
    action: str


class CommitBody(BaseModel):
    token: str
    idempotency_key: str
    confirm_play: bool = False


class DecisionBody(BaseModel):
    decision: str


class FactBody(BaseModel):
    subject: str
    value: str


class FactPatch(BaseModel):
    value: str


class ClearBody(BaseModel):
    kind: str


class ListeningBody(BaseModel):
    song_id: int
    session: str
    source: str = "player"
    event: str
    heard: float = 0.0
    position: float = 0.0


def add_routes(app, ctx) -> None:
    connect_base = ctx.connect
    # per app, so one data home's flood can't block another's (LU-331-08)
    turn_limit = policy.RateLimit()
    home = ctx.settings.home

    def connect():
        return schema.ensure(connect_base())

    with connect() as conn:
        agent.recover(conn)

    def fail(status: int, detail: str, code: str):
        raise LucyProblem(status, detail, code)

    @app.exception_handler(LucyProblem)
    def lucy_problem(_request, problem: LucyProblem) -> JSONResponse:
        return JSONResponse({"detail": problem.detail, "code": problem.code}, problem.status)

    @app.exception_handler(conversations.NotFound)
    def lucy_missing(_request, _problem) -> JSONResponse:
        return JSONResponse({"detail": "That isn't there any more.", "code": "missing"}, 404)

    @app.exception_handler(proposals.NotFound)
    def proposal_missing(_request, _problem) -> JSONResponse:
        return JSONResponse({"detail": "That proposal isn't there any more.", "code": "missing"},
                            404)

    @app.exception_handler(proposals.StaleRevision)
    def stale(_request, problem) -> JSONResponse:
        return JSONResponse({"detail": str(problem), "code": "stale_revision",
                             "current": problem.current}, 409)

    @app.exception_handler(commit.CommitError)
    def commit_problem(_request, problem) -> JSONResponse:
        return JSONResponse({"detail": str(problem), "code": problem.code}, problem.status)

    def writable(conn) -> dict:
        config = lucy_settings.get(conn)
        if not config["enabled"]:
            fail(403, "Lucy is turned off. Make a Mix works as usual.", "lucy_off")
        return config

    @app.get("/api/lucy/status")
    def lucy_status() -> dict:
        with connect() as conn:
            return lucy_settings.status(conn, home)

    @app.put("/api/lucy/settings")
    def lucy_settings_update(body: dict) -> dict:
        with connect() as conn:
            try:
                lucy_settings.update(conn, home, body)
            except (ValueError, TypeError) as problem:
                fail(400, str(problem), "invalid")
            return lucy_settings.status(conn, home)

    @app.get("/api/lucy/conversations")
    def list_conversations(q: str = "", archived: int = 0) -> dict:
        with connect() as conn:
            return {"conversations": conversations.listing(conn, q, bool(archived))}

    @app.post("/api/lucy/conversations")
    def create_conversation(body: NewConversation) -> dict:
        with connect() as conn:
            writable(conn)
            scope = {key: value for key, value in (body.scope or {}).items()
                     if key in {"kind", "draft", "occurrence", "seam"}}
            return conversations.create(conn, body.title, scope)

    def snapshot(conn, conversation: str) -> dict:
        convo = conversations.get(conn, conversation)
        proposal = None
        if convo["proposal_id"]:
            current = proposals.current(conn, convo["proposal_id"])
            if current is not None:
                current["ledger"] = readiness.ledger(conn, ctx.store, current["snapshot"],
                                                     catalog.load(conn, ctx).songs)
            proposal = {"id": convo["proposal_id"], "current": current,
                        "history": proposals.history(conn, convo["proposal_id"])}
        run = conn.execute("SELECT * FROM lucy_runs WHERE conversation_id=? ORDER BY started_at "
                           "DESC LIMIT 1", (conversation,)).fetchone()
        return {
            "conversation": convo,
            "messages": conversations.messages(conn, conversation),
            "proposal": proposal,
            "run": None if run is None else {
                "id": run["id"], "turn": run["turn_id"], "state": run["state"],
                "cycles": run["cycles"], "steps": run["steps"],
                "limits": json.loads(run["limits"]), "usage": json.loads(run["usage"]),
                "error": run["error"],
            },
            "permissions": permissions.pending(conn, conversation),
            "cards": cards(conn, conversation),
            "cursor": events.latest_id(conn, conversation),
            "event_schema": 1,
        }

    def cards(conn, conversation: str, keep: int = 120) -> list[dict]:
        """Fold step events into each card's latest state: the same answer a live client
        reaches by replaying them (LU-303-07)."""
        rows = conn.execute(
            "SELECT * FROM lucy_events WHERE conversation_id=? AND type LIKE 'step.%' "
            "ORDER BY id", (conversation,)).fetchall()
        folded: dict[tuple[str, str], dict] = {}
        for row in rows:
            payload = json.loads(row["payload"])
            slot = (row["plan_id"], row["step_id"])
            card = folded.setdefault(slot, {"plan": row["plan_id"], "step": row["step_id"],
                                            "run": row["run_id"], "turn": row["turn_id"],
                                            "notices": [], "visual": {}, "attempt": 1})
            for name, value in payload.items():
                if value is not None or name not in card:
                    card[name] = value
        return list(folded.values())[-keep:]

    @app.get("/api/lucy/conversations/{conversation}")
    def get_conversation(conversation: str) -> dict:
        with connect() as conn:
            return snapshot(conn, conversation)

    @app.patch("/api/lucy/conversations/{conversation}")
    def patch_conversation(conversation: str, body: ConversationPatch) -> dict:
        with connect() as conn:
            found = conversations.get(conn, conversation)
            if body.title is not None:
                found = conversations.rename(conn, conversation, body.title)
            if body.archived is not None:
                found = conversations.set_archived(conn, conversation, body.archived)
            return found

    @app.delete("/api/lucy/conversations/{conversation}")
    def delete_conversation(conversation: str) -> dict:
        agent.RUNNER.stop(conversation)
        with connect() as conn:
            return conversations.delete(conn, conversation)

    @app.post("/api/lucy/conversations/{conversation}/branch")
    def branch_conversation(conversation: str, body: BranchBody) -> dict:
        with connect() as conn:
            writable(conn)
            created = conversations.branch(conn, conversation, body.message)
            source = conversations.get(conn, conversation)
            message = conversations.message_by_id(conn, body.message)
            revision = message["revision"]
            if revision is None and source["proposal_id"]:
                row = conn.execute(
                    "SELECT revision_id FROM lucy_messages WHERE conversation_id=? AND seq<=? AND "
                    "revision_id IS NOT NULL ORDER BY seq DESC LIMIT 1",
                    (conversation, message["seq"])).fetchone()
                revision = row["revision_id"] if row else None
            if revision is not None:
                old = proposals.get_revision(conn, revision)
                proposal = proposals.ensure_proposal(conn, created["id"])
                proposals.add_revision(conn, proposal, {k: v for k, v in old["snapshot"].items()
                                                        if k != "diff"}, kind="branch",
                                       expected_current=None, parent=revision,
                                       summary=f"Branched from revision {old['number']}")
            return conversations.get(conn, created["id"])

    @app.post("/api/lucy/conversations/{conversation}/turns")
    def send_turn(conversation: str, body: TurnBody) -> dict:
        with connect() as conn:
            config = writable(conn)
            if not config["phases"]["chat"]:
                fail(403, "Chatting with Lucy is turned off in Lucy’s settings.", "phase_off")
            conversations.get(conn, conversation)
            try:
                turn, new = conversations.accept_turn(conn, conversation, body.client_id,
                                                      body.text, body.expected_revision,
                                                      body.selection)
            except ValueError as problem:
                fail(400, str(problem), "invalid")
            run = None
            if new:
                if not turn_limit.allow(conversation):
                    conversations.set_turn_status(conn, turn["id"], "failed")
                    fail(429, "That's a lot of messages at once. Wait a moment.", "rate_limited")
                run = agent.RUNNER.start(ctx, conn, conversation, turn)
            else:
                row = conn.execute("SELECT id FROM lucy_runs WHERE turn_id=? ORDER BY "
                                   "started_at DESC LIMIT 1", (turn["id"],)).fetchone()
                run = row["id"] if row else None
            return {"turn": {"id": turn["id"], "seq": turn["seq"], "status": turn["status"]},
                    "new": new, "run": run}

    @app.post("/api/lucy/conversations/{conversation}/stop")
    def stop_turn(conversation: str) -> dict:
        return {"stopped": agent.RUNNER.stop(conversation)}

    @app.post("/api/lucy/conversations/{conversation}/retry")
    def retry_turn(conversation: str, body: RetryBody) -> dict:
        with connect() as conn:
            writable(conn)
            turn = conversations.turn_by_id(conn, body.turn)
            if turn["conversation"] != conversation:
                fail(404, "That message isn't in this conversation.", "missing")
            latest = conn.execute("SELECT id FROM lucy_turns WHERE conversation_id=? ORDER BY "
                                  "seq DESC LIMIT 1", (conversation,)).fetchone()
            if latest["id"] != turn["id"]:
                fail(409, "Only the latest message can be retried.", "superseded")
            if turn["status"] not in {"failed", "interrupted", "cancelled"}:
                fail(409, "That message isn't stuck, so there's nothing to retry.", "not_failed")
            attempts = conn.execute("SELECT COUNT(*) FROM lucy_runs WHERE turn_id=?",
                                    (turn["id"],)).fetchone()[0]
            conn.execute("UPDATE lucy_turns SET status='queued' WHERE id=?", (turn["id"],))
            conn.commit()
            run = agent.RUNNER.start(ctx, conn, conversation, turn, attempt=attempts + 1)
            return {"turn": {"id": turn["id"], "seq": turn["seq"], "status": "queued"},
                    "new": True, "run": run}

    @app.get("/api/lucy/conversations/{conversation}/events.json")
    def events_json(conversation: str, after: int = 0) -> dict:
        with connect() as conn:
            found = events.since(conn, conversation, after)
            if found["missing"]:
                fail(404, "That conversation isn't there any more.", "missing")
            return {"events": found["events"], "gap": found["gap"], "cursor": found["cursor"]}

    @app.get("/api/lucy/conversations/{conversation}/events")
    async def events_stream(conversation: str, request: Request, after: int = 0):
        """Server-sent events, resumable by Last-Event-ID or ?after= (LU-303-03)."""
        header = request.headers.get("last-event-id")
        cursor = int(header) if header and header.isdigit() else after
        with connect() as conn:
            if events.since(conn, conversation, cursor, limit=1)["missing"]:
                fail(404, "That conversation isn't there any more.", "missing")

        async def frames():
            nonlocal cursor
            yield "retry: 2000\n\n"
            while True:
                if await request.is_disconnected():
                    return
                conn = connect()
                try:
                    found = events.since(conn, conversation, cursor)
                finally:
                    conn.close()
                if found["missing"]:
                    return
                if found["gap"]:
                    gap = {"id": cursor, "v": 1, "type": "stream.gap", "conversation":
                           conversation, "turn": None, "run": None, "plan": None, "step": None,
                           "payload": {"text": "Some events were compacted; take a snapshot."},
                           "at": ""}
                    yield f"event: lucy\ndata: {json.dumps(gap)}\n\n"
                if found["events"]:
                    cursor = found["cursor"]
                    yield events.sse(found["events"])
                    continue
                newest = await asyncio.to_thread(events.LATEST.wait, conversation, cursor,
                                                 STREAM_WAIT_SECONDS)
                if newest <= cursor:
                    yield ": still here\n\n"

        return StreamingResponse(frames(), media_type="text/event-stream",
                                 headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

    def revision_with_ledger(conn, revision_id: str) -> dict:
        revision = proposals.get_revision(conn, revision_id)
        revision["ledger"] = readiness.ledger(conn, ctx.store, revision["snapshot"],
                                              catalog.load(conn, ctx).songs)
        return revision

    @app.get("/api/lucy/revisions/{revision}")
    def get_revision(revision: str) -> dict:
        with connect() as conn:
            return revision_with_ledger(conn, revision)

    @app.get("/api/lucy/revisions/{revision}/readiness")
    def get_readiness(revision: str) -> dict:
        with connect() as conn:
            return revision_with_ledger(conn, revision)["ledger"]

    @app.get("/api/lucy/revisions/{revision}/diff")
    def get_diff(revision: str, against: str | None = None) -> dict:
        with connect() as conn:
            after = proposals.get_revision(conn, revision)
            before = proposals.get_revision(conn, against) if against else None
            if before is not None and before["proposal"] != after["proposal"]:
                fail(400, "Those revisions belong to different proposals.", "invalid")
            return proposals.diff(before["snapshot"] if before else None, after["snapshot"])

    @app.post("/api/lucy/proposals/{proposal}/current")
    def make_current(proposal: str, body: CurrentBody) -> dict:
        with connect() as conn:
            writable(conn)
            proposals.set_current(conn, proposal, body.revision, body.expected)
            return revision_with_ledger(conn, body.revision)

    def publish(conn, revision: dict, outcome, expected: str | None) -> dict:
        if outcome.status != "ok":
            fail(409, outcome.message or "That change can't be made.", outcome.status)
        conversation = conn.execute("SELECT conversation_id FROM lucy_proposals WHERE id=?",
                                    (revision["proposal"],)).fetchone()["conversation_id"]
        created, _ = proposal_ops.publish(conn, conversation, outcome, "revise", expected)
        return revision_with_ledger(conn, created["id"])

    def editable(conn, revision_id: str, expected: str | None) -> dict:
        writable(conn)
        revision = proposals.get_revision(conn, revision_id)
        current = conn.execute("SELECT current_revision FROM lucy_proposals WHERE id=?",
                               (revision["proposal"],)).fetchone()["current_revision"]
        if expected != current:
            raise proposals.StaleRevision(expected, current)
        return revision

    @app.post("/api/lucy/revisions/{revision}/edit")
    def edit_revision(revision: str, body: EditBody) -> dict:
        with connect() as conn:
            base = editable(conn, revision, body.expected)
            if base["id"] != body.expected:
                fail(409, "Edit the current revision; make this one current first.",
                     "not_current")
            outcome = proposal_ops.direct_edit(conn, ctx, None, base, body.op)
            return publish(conn, base, outcome, body.expected)

    @app.post("/api/lucy/revisions/{revision}/rules/{rule}/remove")
    def remove_rule(revision: str, rule: str, body: Expected) -> dict:
        with connect() as conn:
            base = editable(conn, revision, body.expected)
            outcome = proposal_ops.relax_rule(conn, ctx, catalog.load(conn, ctx),
                                              base["snapshot"], rule)
            return publish(conn, base, outcome, body.expected)

    @app.post("/api/lucy/revisions/{revision}/restore")
    def restore_revision(revision: str, body: Expected) -> dict:
        with connect() as conn:
            writable(conn)
            old = proposals.get_revision(conn, revision)
            outcome = proposal_ops.restore_snapshot(conn, ctx, old)
            if outcome.status != "ok":
                fail(409, outcome.message, outcome.status)
            conversation = conn.execute("SELECT conversation_id FROM lucy_proposals WHERE id=?",
                                        (old["proposal"],)).fetchone()["conversation_id"]
            created, _ = proposal_ops.publish(conn, conversation, outcome, "restore",
                                              body.expected)
            return revision_with_ledger(conn, created["id"])

    @app.post("/api/lucy/revisions/{revision}/branch")
    def branch_revision(revision: str, body: Expected) -> dict:
        with connect() as conn:
            writable(conn)
            old = proposals.get_revision(conn, revision)
            snap = {key: value for key, value in old["snapshot"].items() if key != "diff"}
            created = proposals.add_revision(
                conn, old["proposal"], snap, kind="branch", expected_current=body.expected,
                parent=old["id"], branch=f"branch-{old['number']}",
                summary=f"A branch of revision {old['number']}")
            return revision_with_ledger(conn, created["id"])

    @app.post("/api/lucy/approvals")
    def approve(body: ApprovalBody) -> dict:
        with connect() as conn:
            return commit.issue(conn, ctx, body.revision, body.hash, body.action)

    @app.post("/api/lucy/commits")
    def make_commit(body: CommitBody) -> dict:
        with connect() as conn:
            writable(conn)
            return commit.commit(conn, ctx, body.token, body.idempotency_key, body.confirm_play)

    @app.get("/api/lucy/commits/{key}")
    def commit_status(key: str) -> dict:
        with connect() as conn:
            found = commit.status_of(conn, key)
            if found is None:
                fail(404, "No save was received with that key.", "missing")
            return found

    @app.post("/api/lucy/permissions/{permission}")
    def decide(permission: str, body: DecisionBody) -> dict:
        with connect() as conn:
            writable(conn)
            try:
                return permissions.decide(conn, permission, body.decision)
            except KeyError:
                fail(404, "That request isn't there any more.", "missing")
            except ValueError as problem:
                fail(400, str(problem), "invalid")

    @app.get("/api/lucy/memory")
    def get_memory() -> dict:
        with connect() as conn:
            memory.infer(conn, ctx.store.remembered())
            enabled = memory.history_enabled(conn)
            top = memory.most_played(conn) if enabled else {"top": [], "events": 0,
                                                             "period": None}
            return {"facts": memory.facts(conn, every_conversation=True),
                    "history": {"enabled": enabled, **top},
                    "provider_receives": memory.provider_receives(conn)}

    @app.post("/api/lucy/memory")
    def add_memory(body: FactBody) -> dict:
        with connect() as conn:
            writable(conn)
            try:
                return memory.add_fact(conn, body.subject, body.value, "explicit",
                                       {"from": "Lucy’s memory panel"})
            except ValueError as problem:
                fail(400, str(problem), "invalid")

    @app.patch("/api/lucy/memory/{fact}")
    def edit_memory(fact: str, body: FactPatch) -> dict:
        with connect() as conn:
            try:
                return memory.update_fact(conn, fact, body.value)
            except KeyError:
                fail(404, "That memory isn't there any more.", "missing")
            except ValueError as problem:
                fail(400, str(problem), "invalid")

    @app.delete("/api/lucy/memory/{fact}")
    def forget_memory(fact: str) -> dict:
        with connect() as conn:
            try:
                memory.forget_fact(conn, fact)
            except KeyError:
                fail(404, "That memory isn't there any more.", "missing")
            return {"forgotten": True}

    @app.post("/api/lucy/memory/clear")
    def clear_memory(body: ClearBody) -> dict:
        with connect() as conn:
            try:
                return {"cleared": memory.clear(conn, body.kind)}
            except ValueError:
                fail(400, "Clear explicit, inferred or history.", "invalid")

    @app.post("/api/listening/events")
    def listening_event(body: ListeningBody) -> dict:
        with connect() as conn:
            try:
                recorded = memory.record_listening(conn, body.song_id, body.session,
                                                   body.source, body.event, body.heard,
                                                   body.position)
            except KeyError:
                fail(404, "That song isn't in the library.", "missing")
            except ValueError as problem:
                fail(400, str(problem), "invalid")
            return {"recorded": recorded}

    @app.get("/api/lucy/diagnostics")
    def lucy_diagnostics(limit: int = 30) -> dict:
        """Run traces without message text, lyrics, paths or keys (LU-333-04)."""
        with connect() as conn:
            rows = conn.execute(
                "SELECT id,conversation_id,state,provider,cycles,steps,tokens_in,tokens_out,"
                "usage,error,started_at,ended_at FROM lucy_runs ORDER BY started_at DESC "
                "LIMIT ?", (max(1, min(limit, 200)),)).fetchall()
            failures = conn.execute(
                "SELECT type, COUNT(*) n FROM lucy_events WHERE type IN ('step.failed','error',"
                "'run.limit') GROUP BY type").fetchall()
            return {
                "runs": [{**{k: row[k] for k in row.keys() if k != "usage"},
                          "usage": json.loads(row["usage"])} for row in rows],
                "problems": {row["type"]: row["n"] for row in failures},
            }

    ctx.lucy_snapshot = snapshot
    app.state.lucy = ctx
