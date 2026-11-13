"""The real subject for the Lucy evaluation gate: a model deployment answering each case
(SC-0404-06).

`evaluation.run` needs a `Subject` that turns a case into what Lucy proposed. `ProviderSubject`
does that with one of Lucy's own providers (`selecta.lucy.providers`: Anthropic, any
OpenAI-compatible host, or the scripted provider in tests). It offers the model four of Lucy's
tools over the case's synthetic library:

- `tracks.search`: the library, filtered by an optional mood or text;
- `proposals.current`: the mix the person has now (empty when there is none);
- `transitions.readyFrom`: songs that follow the given ones well (same mood, in the library);
- `proposals.plan`: the model's final answer, `{"songs": [ids], "ask_permission": bool}`.

The loop runs at most the deployment's tool-cycle limit. Every call the model makes is kept, so
the gate can judge invalid tool calls, and cost comes from the deployment's own prices.
`provider_for(deployment)` builds the provider with the key from the deployment's secret
reference (`gateway.env_secrets`), never from anything typed.
"""

from __future__ import annotations

import asyncio
import json
import time
from collections.abc import Callable
from typing import Any

from selecta.ai.evaluation import Answer, Case, ToolCall
from selecta.ai.registry import Deployment, Provider

PLAN_TOOL = "proposals.plan"

_INSTRUCTIONS = (
    " The person's library is reachable only through "
    "your tools. Look songs up before you answer, and only ever name song ids the tools gave "
    "you. Respect every song or artist the person rules out. Keep the current mix exactly as it "
    "is, in order, unless the person asks for a big change; if they ask to replace most of it, "
    "do not change it: call proposals.plan with no songs and ask_permission true. Finish every "
    "answer by calling proposals.plan once with the song ids in play order."
)
SYSTEM = "You are Lucy, the DJ assistant in Selecta." + _INSTRUCTIONS
"""Local mode's wording."""
CLOUD_SYSTEM = "You are Lucy, the DJ assistant in SelectaDJ." + _INSTRUCTIONS
"""Cloud mode's: the product named as users see it."""


def system_prompt() -> str:
    """The system prompt for this process's mode (`SELECTA_MODE`)."""
    from selecta.modes.core import Mode, current_mode

    return CLOUD_SYSTEM if current_mode() is Mode.CLOUD else SYSTEM

TOOLS: dict[str, tuple[str, dict[str, Any]]] = {
    "tracks.search": (
        "Search the library. Returns id, title, artist, minutes and mood.",
        {
            "type": "object",
            "properties": {"mood": {"type": "string"}, "text": {"type": "string"}},
        },
    ),
    "proposals.current": (
        "The mix the person has now, in order.",
        {
            "type": "object",
            "properties": {},
        },
    ),
    "transitions.readyFrom": (
        "Songs that follow the given songs well.",
        {
            "type": "object",
            "properties": {"songs": {"type": "array", "items": {"type": "string"}}},
            "required": ["songs"],
        },
    ),
    PLAN_TOOL: (
        "Your final answer: the songs in play order, and whether you need the "
        "person's permission first.",
        {
            "type": "object",
            "properties": {
                "songs": {"type": "array", "items": {"type": "string"}},
                "ask_permission": {"type": "boolean"},
            },
            "required": ["songs", "ask_permission"],
        },
    ),
}


def _song(song) -> dict[str, Any]:
    return {
        "id": song.id,
        "title": song.title,
        "artist": song.artist,
        "minutes": song.minutes,
        "mood": song.mood,
    }


def run_tool(case: Case, name: str, arguments: Any) -> tuple[str, bool]:
    """What one of the offered tools returns for this case, and whether the call was valid."""
    if name not in TOOLS or not isinstance(arguments, dict):
        return json.dumps({"error": "unknown tool or arguments not an object"}), False
    if name == "tracks.search":
        mood, text = arguments.get("mood"), str(arguments.get("text") or "").lower()
        found = [
            _song(s)
            for s in case.library
            if (not mood or s.mood == mood)
            and (not text or text in s.title.lower() or text in s.artist.lower())
        ]
        return json.dumps({"items": found}), True
    if name == "proposals.current":
        library = {s.id: s for s in case.library}
        return json.dumps({"items": [_song(library[i]) for i in case.current_mix]}), True
    if name == "transitions.readyFrom":
        given = {s.id: s for s in case.library if s.id in set(arguments.get("songs") or ())}
        moods = {s.mood for s in given.values()}
        follow = [_song(s) for s in case.library if s.mood in moods and s.id not in given]
        return json.dumps({"items": follow}), True
    return json.dumps({"ok": True}), True


class ProviderSubject:
    """Answers each case by running a Lucy provider through the four tools above."""

    def __init__(self, provider: Any, clock: Callable[[], float] = time.monotonic) -> None:
        self.provider = provider
        self.clock = clock

    def answer(self, deployment: Deployment, case: Case) -> Answer:
        return asyncio.run(self._answer(deployment, case))

    async def _answer(self, deployment: Deployment, case: Case) -> Answer:
        provider = self.provider
        tools = [provider.tool(name, about, schema) for name, (about, schema) in TOOLS.items()]
        messages: list[Any] = [provider.user(case.request)]
        calls: list[ToolCall] = []
        tokens_in = tokens_out = 0
        songs: tuple[str, ...] = ()
        asked = False
        began = self.clock()

        async def ignore(_text: str) -> None:
            return None

        for _cycle in range(max(1, deployment.max_tool_cycles)):
            turn = await provider.turn([system_prompt()], messages, tools, ignore)
            tokens_in += turn.tokens_in
            tokens_out += turn.tokens_out
            if not turn.calls:
                break
            outputs = []
            for call in turn.calls:
                calls.append(ToolCall(call.name, call.input))
                if call.name == PLAN_TOOL and isinstance(call.input, dict):
                    songs = tuple(str(song) for song in call.input.get("songs") or ())
                    asked = bool(call.input.get("ask_permission"))
                text, ok = run_tool(case, call.name, call.input)
                outputs.append((call, text, ok))
            if any(call.name == PLAN_TOOL for call in turn.calls):
                break
            messages.extend(provider.results(turn, outputs))
        return Answer(
            songs=songs,
            asked_permission=asked,
            tool_calls=tuple(calls),
            cost_usd=deployment.prices.cost(tokens_in, tokens_out),
            latency_s=max(self.clock() - began, 0.0),
        )


def provider_for(deployment: Deployment, secrets: Callable[[str], str | None] | None = None):
    """Lucy's provider for a hosted deployment, keyed from its secret reference."""
    from selecta.ai.gateway import env_secrets
    from selecta.lucy.providers import AnthropicProvider, OpenAICompatibleProvider

    lookup = secrets or env_secrets
    key = lookup(deployment.secret_ref) if deployment.secret_ref else None
    if deployment.provider is Provider.ANTHROPIC:
        if not key:
            raise ValueError(f"No key found for deployment {deployment.id}.")
        return AnthropicProvider(
            key,
            deployment.model_id,
            deployment.base_url,
            deployment.max_output_tokens,
            deployment.effort,
        )
    if deployment.provider is Provider.OPENAI:
        if not deployment.base_url:
            raise ValueError(f"Deployment {deployment.id} has no base URL.")
        return OpenAICompatibleProvider(
            key,
            deployment.model_id,
            deployment.base_url,
            deployment.max_output_tokens,
            deployment.effort,
        )
    raise ValueError("The built-in planner is not a model deployment and is not evaluated.")


__all__ = ["CLOUD_SYSTEM", "PLAN_TOOL", "SYSTEM", "TOOLS", "ProviderSubject", "provider_for",
           "run_tool", "system_prompt"]
