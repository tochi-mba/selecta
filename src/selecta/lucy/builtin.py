"""The built-in Lucy: no AI service, nothing leaves the computer (the default, constrained mode).

It reads requests with the same typed grammar a model's tool input goes through, runs real
WeftAI plans against the library, and writes its reply as each result comes back, so the text
streams because it is being produced, not replayed (LU-303-02). It answers questions without
creating revisions, and it never pretends to understand what it can't: it says what it can do.
"""

from __future__ import annotations

import re
from collections.abc import Awaitable, Callable
from typing import Any

from selecta.lucy import intent

Say = Callable[[str], Awaitable[None]]
RunPlan = Callable[[dict], Awaitable[dict]]

HELP = (
    "I can plan a mix from a description, like “12 songs that build up slowly”, “an hour of "
    "Afrobeats, no Drake” or “only transitions that are already ready”. Then tell me what to "
    "change: “swap the third one for something calmer”, “remove Burna Boy”, “move the last song "
    "earlier”, “add two more songs”. I can also answer questions about your library and the "
    "proposal. Nothing is built until you approve it."
)


def _minutes(value: dict) -> str:
    low, high = value.get("minutes", [0, 0])
    if value.get("minutes_exact") or low == high:
        return f"about {high} minutes"
    return f"about {low}–{high} minutes"


def _rephrase(asked: str, count: int | None = None, relax: bool = False) -> str | None:
    """The person's own request with only the song count changed, or the ready-only rule
    swapped for permission to render, so every other rule they gave still applies."""
    text = asked.strip().rstrip(".!?")
    if count is not None:
        text, changed = intent.COUNT.subn(lambda match: f"{count} {match.group(2)}", text, 1)
        if not changed:
            return None
    if relax:
        # The rule's clause ends at punctuation or at "and"/"then"/"but", so a rule written
        # after it in the same sentence ("... and make 10 songs") stays.
        text, changed = re.subn(r"[,;]?\s*(?:" + intent.READY_ONLY.pattern
                                + r")[^,.;!?]*?(?=\s+(?:and|then|but)\b|[,.;!?]|$)", "",
                                text, count=1, flags=re.I)
        if not changed:
            return None
        text = re.sub(r"^(?:and|then|but)\b|\b(?:and|then|but)$", "", text.strip(" ,;"),
                      flags=re.I).strip(" ,;")
        if not text:
            return None
        text += ", you can render new ones"
    return text


def describe_outcome(value: dict, asked: str = "") -> str:
    """Plain sentences from a planning result. Only facts the result contains."""
    status = value.get("status")
    if status == "ok":
        songs = value.get("songs", [])
        parts = []
        if value.get("replanned"):
            parts.append(value["replanned"])
        changes = value.get("changes")
        lead = (f"Revision {value['revision']}: {changes}." if value.get("revision", 1) > 1 and
                changes else f"Here’s a proposal: {len(songs)} songs, {_minutes(value)}.")
        parts.append(lead)
        for note in value.get("notes") or []:
            parts.append(note)
        ready = value.get("transitions_ready_now", "")
        if ready:
            done, _, total = ready.partition(" of ")
            if total and total != "0":
                if done == total:
                    parts.append(f"All {total} transitions are already ready to play.")
                else:
                    parts.append(f"{done} of {total} transitions are ready now; the rest would "
                                 "be rendered after you approve it.")
        if value.get("warnings"):
            parts.append("Worth knowing: " + " ".join(value["warnings"][:2]))
        if value.get("variants"):
            parts.append(f"I also made {len(value['variants'])} other version"
                         f"{'s' if len(value['variants']) > 1 else ''} you can switch to.")
        parts.append("It’s proposed, not built: approve it to save it as a draft.")
        return " ".join(parts)
    message = value.get("message") or "That didn’t work."
    details = value.get("details") or {}
    lines = [message]
    if status == "no_route":
        # Each plan reads only its own words, so an offer quotes a whole request that keeps the
        # person's other rules (LX-0359-06); a bare "make it 6 songs" would quietly drop them.
        shorter = details.get("shorter")
        fewer = _rephrase(asked, count=shorter["songs"]) if shorter and asked else None
        if shorter:
            lines.append(f"I can make a {shorter['songs']}-song mix from ready transitions right "
                         "now that keeps your other rules; say "
                         + (f"“{fewer}” for that." if fewer else
                            f"your request again with {shorter['songs']} songs for that."))
        relaxed = _rephrase(asked, relax=True) if asked else None
        lines.append(f"Or say “{relaxed}” and I’ll allow new transitions." if relaxed else
                     "Or say “you can render new ones” and I’ll allow new transitions.")
    elif status == "clarify":
        for item in details.get("clarify", []) + [{"options": details.get("options", [])}]:
            for option in (item.get("options") or [])[:6]:
                where = f"song {option['position']}: " if "position" in option else ""
                lines.append(f"• {where}{option.get('artist', '')} – {option.get('title', '')}")
    elif status == "conflict":
        for conflict in details.get("conflicts", []):
            lines.append(f"• {conflict['text']}")
        lines.append("Tell me which rule to change, or remove one from the proposal.")
    elif status == "stale":
        lines.append("Have a look at the latest proposal and tell me again.")
    return "\n".join(lines)


async def _say_step_failures(result: dict, say: Say) -> bool:
    failed = [step for step in result.get("steps", []) if step["status"] == "error"]
    for step in failed[:2]:
        await say(f"I couldn’t finish that: {step.get('error') or 'something went wrong'}. ")
    if not result.get("ok") and not result.get("steps"):
        await say("I couldn’t run that plan. ")
        return True
    return bool(failed)


def _value(result: dict, step: str) -> Any:
    return next((s.get("data") for s in result.get("steps", []) if s["id"] == step), None)


async def respond(ctx: Any, say: Say, run_plan: RunPlan) -> None:
    text = ctx.turn_text
    kind = ctx.turn_kind
    if kind == "approve":
        await say("Saving or playing is yours to do: use “Save as draft” or “Save and play” on "
                  "the proposal. I can’t save, play or change anything myself.")
        return
    if kind == "remember":
        match = intent.REMEMBER.search(text)
        what = (match.group(2) if match else text).strip().rstrip(".")
        result = await run_plan({"steps": [{"id": "keep", "op": "memory.remember",
                                            "input": {"subject": "Preference", "value": what}}]})
        if not await _say_step_failures(result, say):
            kept = _value(result, "keep") or {}
            where = ("for this conversation only, because long-term memory is off in Lucy’s "
                     "settings" if kept.get("kind") == "session" else "from now on")
            await say(f"Got it, I’ll keep that in mind {where}: “{what}”. You can see or "
                      "forget it in Lucy’s memory.")
        return
    if kind == "forget":
        await say("You can forget anything I remember from Lucy’s memory panel. I don’t delete "
                  "things myself.")
        return
    if kind == "question":
        await _answer(ctx, text, say, run_plan)
        return
    if kind == "chat":
        await say(HELP)
        return
    scoped = _scope(ctx)
    about_it = re.search(r"\b(this|my|the) (mix|draft|one)\b|\bit\b", text, re.I)
    if scoped and about_it and not _has_proposal(ctx) and kind in {"plan", "revise"}:
        await say("Copying your mix into a proposal first, so the original stays as it is… ")
        steps = [{"id": "copy", "op": "proposals.fromScope"}]
        if intent.critique_ops(text) or intent.parse(text):
            steps.append({"id": "revise", "op": "proposals.revise", "input": {"text": text}})
        result = await run_plan({"steps": steps})
        if await _say_step_failures(result, say):
            return
        await say(describe_outcome(_value(result, steps[-1]["id"]) or {}))
        return
    if kind == "plan":
        rules = intent.parse(text, ctx.turn)
        steps: list[dict] = []
        if any(rule.kind == "ready_only" for rule in rules):
            await say("Only transitions that are already ready, then. Checking what’s on disk… ")
            steps.append({"id": "ready", "op": "transitions.readyInventory"})
        else:
            await say("Planning that now… ")
        variants = 2 if re.search(r"\b(options|versions|variants|alternatives)\b", text, re.I) \
            else 1
        steps.append({"id": "plan", "op": "proposals.plan",
                      "input": {"text": text, "variants": variants}})
        result = await run_plan({"steps": steps})
        if await _say_step_failures(result, say):
            return
        await say(describe_outcome(_value(result, "plan") or {}, text))
        return
    await say("Changing that… ")
    result = await run_plan({"steps": [{"id": "revise", "op": "proposals.revise",
                                        "input": {"text": text}}]})
    if await _say_step_failures(result, say):
        return
    await say(describe_outcome(_value(result, "revise") or {}))


def _scope(ctx: Any) -> dict:
    import json

    row = ctx.conn.execute("SELECT scope FROM lucy_conversations WHERE id=?",
                           (ctx.conversation,)).fetchone()
    return json.loads(row["scope"]) if row else {}


def _has_proposal(ctx: Any) -> bool:
    row = ctx.conn.execute("SELECT proposal_id FROM lucy_conversations WHERE id=?",
                           (ctx.conversation,)).fetchone()
    return bool(row and row["proposal_id"])


async def _answer(ctx: Any, text: str, say: Say, run_plan: RunPlan) -> None:
    lowered = text.casefold()
    if _scope(ctx) and not _has_proposal(ctx) and re.search(r"\b(this|my) (mix|draft)\b",
                                                             lowered):
        result = await run_plan({"steps": [{"id": "mix", "op": "mix.scope"},
                                           {"id": "check", "op": "transitions.evaluateOrder",
                                            "input": {"from": "$mix"}}]})
        if await _say_step_failures(result, say):
            return
        step = next((s for s in result["steps"] if s["id"] == "mix"), None)
        pairs = _value(result, "check") or []
        if step and step["status"] == "ok":
            far = [p for p in pairs if (p.get("tempo_gap_percent") or 0) > 8]
            ready = sum(1 for p in pairs if p.get("ready_clips"))
            await say(f"That mix has {step['count']} songs. {ready} of {len(pairs)} checked "
                      "transitions have a rendered clip ready. ")
            if far:
                await say("The biggest tempo jumps: " + "; ".join(
                    f"{p['a']} → {p['b']} ({p['tempo_gap_percent']}%)" for p in far[:3]) + ". ")
            await say("Say “improve this mix” and I’ll copy it into a proposal to work on; the "
                      "original stays as it is.")
        return
    if re.search(r"\b(ready|rendered|render|play now|wait)\b", lowered):
        result = await run_plan({"steps": [{"id": "ready", "op": "transitions.readyInventory"}]})
        step = next((s for s in result["steps"] if s["id"] == "ready"), None)
        if step and step["status"] == "ok":
            await say(f"{step['count']} transitions are verified ready to play right now (checked "
                      "on disk). Ones that worked before but whose audio is gone don’t count. ")
        result = await run_plan({"steps": [{"id": "seams", "op": "proposals.seams"}]})
        step = next((s for s in result["steps"] if s["id"] == "seams"), None)
        if step and step["status"] == "ok" and step["count"]:
            ready = sum(1 for item in step["items"] if item.verified)
            await say(f"In the current proposal, {ready} of {step['count']} are ready now.")
        return
    if re.search(r"\b(most played|play most|favou?rites?|listen to most)\b", lowered):
        result = await run_plan({"steps": [{"id": "top", "op": "tracks.mostPlayed"}]})
        step = result["steps"][0]
        if step["status"] == "ok" and step["count"]:
            names = ", ".join(f"{t.title} ({t.plays})" for t in step["items"][:5])
            await say(f"From recorded plays: {names}.")
        else:
            await say(" ".join(step.get("notices") or ["Nothing recorded yet."]))
        return
    if re.search(r"\b(how many|library|analy[sz]ed)\b", lowered):
        result = await run_plan({"steps": [{"id": "health", "op": "analysis.health"}]})
        data = _value(result, "health") or {}
        if data:
            await say(f"{data['mix_ready']} of your {data['music']} songs are ready to mix. "
                      f"{data['analysis_failed']} failed analysis, {data['ruled_out']} are ruled "
                      f"out and {data['duplicates']} are duplicates.")
        return
    named = re.search(r"\b(?:bpm|tempo|key|energy) (?:of|for) (.+?)[?.!]*$", text, re.I)
    if named:
        result = await run_plan({"steps": [
            {"id": "song", "op": "tracks.resolveName", "input": {"name": named.group(1)}},
            {"id": "facts", "op": "analysis.features", "input": {"from": "$song"}},
        ]})
        facts = _value(result, "facts") or []
        for fact in facts[:3]:
            fields = fact.get("fields", {})
            bpm = fields.get("bpm", {}).get("value")
            key = fields.get("key", {}).get("value")
            await say(f"{fact['title']}: tempo {bpm if bpm is not None else 'unknown'} BPM, key "
                      f"{key or 'unknown'} (measured by Selecta’s analysis). ")
        if not facts:
            await say("I couldn’t find that song among your mix-ready songs.")
        return
    result = await run_plan({"steps": [{"id": "now", "op": "proposals.current"}]})
    step = result["steps"][0]
    if step["status"] == "ok" and step["count"]:
        rules = [n.split(": ", 1)[-1].split(" [id")[0] for n in step["notices"] if "Rule" in n]
        await say(f"The proposal has {step['count']} songs"
                  + (f", made under these rules: {'; '.join(rules)}" if rules else "")
                  + ". Each song was chosen by Selecta’s planner for how well it hands over to "
                  "its neighbours and fits the rules; open a transition to see its evidence. ")
    else:
        await say(HELP)
