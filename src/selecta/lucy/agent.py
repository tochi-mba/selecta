"""The agent run: one bounded, cancellable, durable attempt to answer one turn (ADR-0311).

States: queued, interpreting, running_tools, evaluating, preparing, streaming, awaiting_user,
awaiting_permission, then completed, failed, cancelled, interrupted or superseded. A run may take
several cycles of model and tool work, but never more than its fixed ceilings of cycles, steps,
seconds and spend. Stopping affects only that run: it never pauses music or undoes a write. A
newer turn supersedes an older run, which then stops publishing. Runs execute on their own
threads with their own event loop and database connection, so the audio and the API never wait
on them; at most two run at once (LU-331-08, LU-332-05).
"""

from __future__ import annotations

import asyncio
import json
import threading
import time
from dataclasses import dataclass
from typing import Any

from weftai._abort import AbortController
from weftai.adapter.bind import bind_tool, format_invalid_plan
from weftai.plan.types import PlanSchema

from selecta.lucy import builtin, context, conversations, events, intent, policy, schema, tools
from selecta.lucy import settings as lucy_settings
from selecta.lucy.ids import new_id, now_iso
from selecta.lucy.providers import (
    AnthropicProvider,
    OpenAICompatibleProvider,
    ProviderError,
    cost_estimate,
)

TERMINAL = {"completed", "failed", "cancelled", "interrupted", "superseded"}
FLUSH_CHARS = 24
FLUSH_SECONDS = 0.05
PERSIST_SECONDS = 1.0
SLOTS = threading.Semaphore(2)
TOOL_NAME = "selecta"


@dataclass
class Active:
    run: str
    turn: str
    conversation: str
    cancel: threading.Event
    abort: AbortController


class Runner:
    """Runs in this process, one live run per conversation."""

    def __init__(self) -> None:
        self.active: dict[str, Active] = {}
        self.lock = threading.Lock()
        self.threads: list[threading.Thread] = []

    def start(self, app: Any, conn, conversation: str, turn: dict, attempt: int = 1) -> str:
        config = lucy_settings.get(conn)
        status = lucy_settings.status(conn, app.settings.home)
        run = new_id("run")
        conn.execute(
            "INSERT INTO lucy_runs(id,turn_id,conversation_id,attempt,state,provider,limits,"
            "started_at) VALUES(?,?,?,?,?,?,?,?)",
            (run, turn["id"], conversation, attempt, "queued", status["provider"]["kind"],
             json.dumps(config["budgets"]), now_iso()),
        )
        conn.commit()
        with self.lock:
            older = self.active.get(conversation)
            if older is not None:
                older.cancel.set()
                older.abort.abort("superseded by a newer message")
            active = Active(run, turn["id"], conversation, threading.Event(), AbortController())
            self.active[conversation] = active
        events.append(conn, conversation, "run.state", {"state": "queued", "cycles": 0,
                                                        "steps": 0}, turn=turn["id"], run=run)
        thread = threading.Thread(target=self._thread, args=(app, active), daemon=True,
                                  name=f"lucy-{run}")
        self.threads = [t for t in self.threads if t.is_alive()] + [thread]
        thread.start()
        return run

    def stop(self, conversation: str) -> bool:
        with self.lock:
            active = self.active.get(conversation)
        if active is None:
            return False
        active.cancel.set()
        active.abort.abort("stopped by the person")
        return True

    def wait(self, timeout: float = 30.0) -> None:
        """For tests and shutdown: let running threads finish."""
        deadline = time.monotonic() + timeout
        for thread in list(self.threads):
            thread.join(max(0.0, deadline - time.monotonic()))

    def _thread(self, app: Any, active: Active) -> None:
        with SLOTS:
            try:
                asyncio.run(_run(app, active))
            finally:
                with self.lock:
                    if self.active.get(active.conversation) is active:
                        del self.active[active.conversation]


RUNNER = Runner()


def recover(conn) -> int:
    """After a restart nothing is running: say so truthfully instead of spinning forever
    (LU-302-03). Partial replies keep the text they had."""
    schema.ensure(conn)
    stuck = conn.execute(
        "SELECT id, conversation_id, turn_id FROM lucy_runs WHERE state NOT IN "
        "('completed','failed','cancelled','interrupted','superseded')").fetchall()
    for row in stuck:
        conn.execute("UPDATE lucy_runs SET state='interrupted', ended_at=? WHERE id=?",
                     (now_iso(), row["id"]))
        conn.execute("UPDATE lucy_messages SET status='interrupted' WHERE run_id=? AND "
                     "status='streaming'", (row["id"],))
        conn.execute("UPDATE lucy_turns SET status='interrupted' WHERE id=? AND status IN "
                     "('queued','running')", (row["turn_id"],))
        events.append(conn, row["conversation_id"], "run.state",
                      {"state": "interrupted", "cycles": 0, "steps": 0,
                       "error": "Selecta restarted while Lucy was working."},
                      turn=row["turn_id"], run=row["id"], commit=False)
    conn.commit()
    return len(stuck)


class RunStopped(Exception):
    """Stop or a newer turn arrived: unwinding closes the provider's stream at once."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


class Writer:
    """Real deltas, batched a little so the browser isn't asked to redraw per token."""

    def __init__(self, ctx: tools.LucyCtx, message: str, should_stop=None) -> None:
        self.should_stop = should_stop or (lambda: None)
        self.ctx = ctx
        self.message = message
        self.content = ""
        self.buffer = ""
        self.flushed_at = time.monotonic()
        self.persisted_at = time.monotonic()

    async def write(self, text: str) -> None:
        reason = self.should_stop()
        if reason:
            raise RunStopped(reason)
        if not text:
            return
        self.buffer += text
        now = time.monotonic()
        if len(self.buffer) >= FLUSH_CHARS or now - self.flushed_at >= FLUSH_SECONDS:
            self.flush()
        await asyncio.sleep(0)

    def flush(self) -> None:
        if not self.buffer:
            return
        self.ctx.emit("message.delta", {"message": self.message, "text": self.buffer})
        self.content += self.buffer
        self.buffer = ""
        self.flushed_at = time.monotonic()
        if self.flushed_at - self.persisted_at >= PERSIST_SECONDS:
            self.ctx.conn.execute("UPDATE lucy_messages SET content=? WHERE id=?",
                                  (self.content, self.message))
            self.ctx.conn.commit()
            self.persisted_at = self.flushed_at


def _set_state(ctx: tools.LucyCtx, state: str, cycles: int = 0, error: str | None = None) -> None:
    ended = now_iso() if state in TERMINAL else None
    ctx.conn.execute(
        "UPDATE lucy_runs SET state=?, cycles=?, steps=?, error=coalesce(?,error), "
        "ended_at=coalesce(?,ended_at) WHERE id=?",
        (state, cycles, ctx.steps_run, error, ended, ctx.run),
    )
    ctx.conn.commit()
    payload = {"state": state, "cycles": cycles, "steps": ctx.steps_run}
    if error:
        payload["error"] = error
    ctx.emit("run.state", payload)


def make_provider(app: Any, conn, config: dict):
    override = getattr(app, "lucy_provider", None)
    if override is not None:
        return override() if callable(override) else override
    status = lucy_settings.status(conn, app.settings.home)
    provider = status["provider"]
    if provider["kind"] == "builtin":
        return None
    if provider["mode"] != "full":
        raise ProviderError(provider["reason"] or "This provider isn't set up.", "setup", False)
    budget = config["budgets"]["max_output_tokens"]
    key = lucy_settings.read_secret(app.settings.home, provider["kind"])
    if provider["kind"] == "anthropic":
        return AnthropicProvider(key or "", provider["model"], provider["base_url"], budget)
    return OpenAICompatibleProvider(key, provider["model"], provider["base_url"], budget)


def _include(config: dict):
    def include(operation: Any) -> bool:
        if not policy.offered(operation):
            return False
        tier = policy.tier_of(operation.name)
        if tier == "propose" and not config["phases"]["proposals"]:
            return False
        return True

    return include


async def _run(app: Any, active: Active) -> None:
    conn = app.connect()
    schema.ensure(conn)
    turn = conversations.turn_by_id(conn, active.turn)
    has_proposal = bool(conversations.get(conn, active.conversation)["proposal_id"])
    ctx = tools.LucyCtx(
        conn=conn, app=app, conversation=active.conversation, turn=active.turn, run=active.run,
        turn_text=turn["text"], turn_kind=intent.classify(turn["text"], has_proposal),
        selection=turn["selection"], expected=turn["expected_revision"],
    )
    if ctx.expected is None and has_proposal:
        row = conn.execute("SELECT p.current_revision FROM lucy_proposals p JOIN "
                           "lucy_conversations c ON c.proposal_id=p.id WHERE c.id=?",
                           (active.conversation,)).fetchone()
        ctx.expected = row[0] if row else None
    config = lucy_settings.get(conn)
    budgets = config["budgets"]
    deadline = time.monotonic() + budgets["max_seconds"]
    message = conversations.add_message(conn, active.conversation, "assistant", "",
                                        status="streaming", turn=active.turn, run=active.run)
    ctx.emit("message.started", {"message": message["id"], "role": "assistant",
                                 "seq": message["seq"]})
    conversations.set_turn_status(conn, active.turn, "running")
    cycles = 0
    final_state, error = "completed", None
    usage = {"tokens_in": 0, "tokens_out": 0, "cost_usd": 0.0, "estimated": True}
    session = tools.session_id(app, active.conversation)
    runtime = tools.runtime()
    include = _include(config)

    def stopped() -> str | None:
        if active.cancel.is_set():
            superseded = conversations.is_superseded(conn, active.turn)
            return "superseded" if superseded else "cancelled"
        if conversations.is_superseded(conn, active.turn):
            return "superseded"
        return None

    writer = Writer(ctx, message["id"], stopped)

    async def run_plan(plan_input: Any) -> dict:
        parsed = PlanSchema.safe_parse(plan_input)
        if not parsed.success:
            text = format_invalid_plan([{"path": i.path, "message": i.message}
                                        for i in parsed.issues])
            return {"ok": False, "text": text, "steps": []}
        steps = parsed.data["steps"] if isinstance(parsed.data, dict) else []
        if ctx.steps_run + len(steps) > budgets["max_steps"]:
            ctx.emit("run.limit", {"limit": "steps", "used": ctx.steps_run,
                                   "max": budgets["max_steps"],
                                   "text": "Lucy reached its step limit for this message."})
            return {"ok": False, "steps": [], "text": f"Step limit reached ({budgets['max_steps']}"
                    " per message). Answer with what you have."}
        ctx.plan = new_id("plan")
        listed = [{"id": s.get("id"), "op": s.get("op"), "family": tools.family_of(
            str(s.get("op"))), "title": tools.title_of(str(s.get("op"))), "note": s.get("note")}
            for s in steps if isinstance(s, dict)]
        _set_state(ctx, "running_tools", cycles)
        ctx.emit("plan.started", {"steps": listed})
        for item in listed:
            ctx.emit("step.queued", {"op": item["op"], "family": item["family"],
                                     "title": item["title"], "status": "queued", "attempt": 1,
                                     "note": item["note"], "notices": [], "visual": {}},
                     step=item["id"])
        started = time.monotonic()
        result = await runtime.execute(parsed.data, {
            "ctx": ctx, "session": {"id": session}, "signal": active.abort.signal,
            "allowWrites": True, "include": include,
        })
        for step in result["steps"]:
            if step["id"] not in ctx.finished_steps:
                payload = tools.card_payload(None, step)
                ctx.emit(f"step.{payload['status']}", payload, step=step["id"])
        reported = {step["id"] for step in result["steps"]}
        for item in listed:
            if item["id"] not in reported:
                ctx.emit("step.failed", {**item, "status": "failed", "attempt": 1,
                                         "error": policy.clean_text(result["text"], 400),
                                         "notices": [], "visual": {}}, step=item["id"])
        ctx.emit("plan.completed", {"ok": result["ok"],
                                    "duration_ms": int((time.monotonic() - started) * 1000)})
        ctx.finished_steps.clear()
        ctx.plan = None
        return result

    try:
        _set_state(ctx, "interpreting")
        if not config["enabled"] or not config["phases"]["chat"]:
            await writer.write("Lucy is turned off. Make a Mix works as usual.")
        else:
            provider = make_provider(app, conn, config)
            if provider is None:
                _set_state(ctx, "streaming")
                await builtin.respond(ctx, writer.write, run_plan)
            else:
                lib_count = len(ctx.lib().songs)
                bound = bind_tool(runtime, {"name": TOOL_NAME, "include": include,
                                            "allowWrites": True,
                                            "dialect": "anthropic" if provider.name ==
                                            "anthropic" else "loose", "strict": False},
                                  {"ctx": ctx, "sessionId": session})
                tool_list = [provider.tool(TOOL_NAME, bound["description"], bound["schema"])]
                messages = [provider.user(m["content"]) if m["role"] == "user" else m
                            for m in context.history(conn, active.conversation, active.turn)]
                while True:
                    reason = stopped()
                    if reason:
                        final_state = reason
                        break
                    if cycles >= budgets["max_cycles"]:
                        ctx.emit("run.limit", {"limit": "cycles", "used": cycles,
                                               "max": budgets["max_cycles"],
                                               "text": "Lucy reached its limit of work rounds."})
                        await writer.write(f"\n\n(I stopped after {cycles} rounds of work, my "
                                           "limit for one message. Say “continue” to keep going."
                                           ")")
                        break
                    remaining = deadline - time.monotonic()
                    if remaining <= 0:
                        ctx.emit("run.limit", {"limit": "seconds", "used": budgets["max_seconds"],
                                               "max": budgets["max_seconds"],
                                               "text": "Lucy reached its time limit."})
                        await writer.write("\n\n(I ran out of time for this message. Say "
                                           "“continue” to pick up where I stopped.)")
                        break
                    cycles += 1
                    _set_state(ctx, "streaming", cycles)
                    system = [context.INVARIANT, context.dynamic(conn, app, active.conversation,
                                                                 ctx.selection, lib_count)]
                    if writer.content and not writer.content.endswith("\n"):
                        await writer.write("\n\n")
                    result = await asyncio.wait_for(
                        provider.turn(system, messages, tool_list, writer.write), remaining)
                    usage["tokens_in"] += result.tokens_in
                    usage["tokens_out"] += result.tokens_out
                    spent = cost_estimate(provider.model, usage["tokens_in"], usage["tokens_out"])
                    usage["cost_usd"] = spent
                    conn.execute("UPDATE lucy_runs SET tokens_in=?, tokens_out=?, usage=? "
                                 "WHERE id=?", (usage["tokens_in"], usage["tokens_out"],
                                                json.dumps(usage), active.run))
                    conn.commit()
                    ctx.emit("run.usage", dict(usage))
                    if result.stop == "refusal":
                        await writer.write("\n\n(The AI provider declined to answer that.)")
                        break
                    if not result.calls:
                        break
                    cap = budgets.get("spend_cap_usd")
                    if cap is not None and spent is not None and spent >= cap:
                        ctx.emit("run.limit", {"limit": "spend", "used": spent, "max": cap,
                                               "text": "Lucy reached the spending cap."})
                        await writer.write("\n\n(I stopped at your spending cap for one message.)")
                        break
                    outputs = []
                    for call in result.calls:
                        if call.name != TOOL_NAME:
                            outputs.append((call, f"Unknown tool '{call.name}'. Available tools: "
                                            f"{TOOL_NAME}.", False))
                        elif call.problem:
                            outputs.append((call, call.problem, False))
                        else:
                            ran = await run_plan(call.input)
                            outputs.append((call, ran["text"], bool(ran["ok"])))
                    messages += provider.results(result, outputs)
                    _set_state(ctx, "evaluating", cycles)
        reason = stopped()
        if reason and final_state == "completed":
            final_state = reason
    except RunStopped as stop:
        final_state = stop.reason
    except ProviderError as problem:
        final_state = "failed"
        error = str(problem)
        ctx.emit("error", {"code": problem.code, "message": str(problem),
                           "recoverable": problem.recoverable})
        await writer.write(("\n\n" if writer.content or writer.buffer else "") + str(problem)
                           + (" Your mixes and music are unaffected; try again." if
                              problem.recoverable else " Check Lucy’s settings."))
    except TimeoutError:
        final_state, error = "interrupted", "Lucy ran out of time."
        await writer.write("\n\n(Lucy ran out of time for this message.)")
    except asyncio.CancelledError:
        final_state = "cancelled"
    except Exception as problem:  # noqa: BLE001 - a run must always end truthfully
        final_state, error = "failed", f"Something went wrong inside Lucy: {problem}"
        ctx.emit("error", {"code": "internal", "message": "Something went wrong inside Lucy.",
                           "recoverable": True})
        await writer.write("\n\nSomething went wrong inside Lucy. Your mixes and music are safe; "
                           "try again.")
    finally:
        writer.flush()
        status = {"completed": "complete", "cancelled": "cancelled", "superseded": "cancelled",
                  "interrupted": "interrupted"}.get(final_state, "failed")
        conversations.finish_message(conn, message["id"], writer.content, status,
                                     revision=ctx.revisions[-1] if ctx.revisions else None)
        ctx.emit("message.completed", {"message": message["id"], "status": status,
                                       "content": writer.content})
        _set_state(ctx, final_state, cycles, error)
        turn_status = {"completed": "completed", "failed": "failed", "cancelled": "cancelled",
                       "interrupted": "interrupted"}.get(final_state)
        if turn_status:
            conversations.set_turn_status(conn, active.turn, turn_status)
        events.prune(conn, active.conversation)
        conn.close()
