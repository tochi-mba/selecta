"""Model providers for Lucy: Anthropic, OpenAI-compatible hosts, and a scripted one for tests.

Each streams the model's real text deltas as they arrive (never a finished answer replayed one
character at a time, LU-303-02), returns complete tool calls only after the stream ends (partial
tool arguments are never executed, LU-303-08), and reports usage. Keys stay on the server and
are never put in events or traces (LU-330-03). The built-in Lucy, which needs no model at all,
lives in builtin.py.
"""

from __future__ import annotations

import json
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any

OnText = Callable[[str], Awaitable[None]]

PRICES_PER_MILLION = {
    "claude-fable-5-1": (10.0, 50.0),
    "claude-opus-5-5": (4.0, 20.0),
    "claude-opus-5": (5.0, 25.0),
    "claude-sonnet-5-5": (2.0, 10.0),
    "claude-sonnet-5": (2.0, 10.0),
    "claude-haiku-5-5": (0.10, 0.50),
}
"""List prices for an estimate only; anything not listed is reported as unknown (LU-333-03)."""

FALLBACK_MODELS = {"claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"}


class ProviderError(Exception):
    def __init__(self, message: str, code: str, recoverable: bool) -> None:
        super().__init__(message)
        self.code = code
        self.recoverable = recoverable


@dataclass
class ToolCall:
    id: str
    name: str
    input: Any
    problem: str | None = None


@dataclass
class TurnResult:
    text: str = ""
    calls: list[ToolCall] = field(default_factory=list)
    stop: str = "end_turn"
    tokens_in: int = 0
    tokens_out: int = 0
    assistant: Any = None
    """The provider-native assistant message to append before tool results."""


def cost_estimate(model: str, tokens_in: int, tokens_out: int) -> float | None:
    price = PRICES_PER_MILLION.get(model)
    if price is None:
        return None
    return round(tokens_in / 1e6 * price[0] + tokens_out / 1e6 * price[1], 6)


class AnthropicProvider:
    name = "anthropic"

    def __init__(self, api_key: str, model: str, base_url: str | None, max_tokens: int) -> None:
        import anthropic

        self.model = model
        self.max_tokens = max_tokens
        self.default_host = not base_url or "api.anthropic.com" in base_url
        self.client = anthropic.AsyncAnthropic(
            api_key=api_key, base_url=None if self.default_host else base_url,
            max_retries=2, timeout=120.0,
        )

    def tool(self, name: str, description: str, schema: dict) -> dict:
        return {"name": name, "description": description, "input_schema": schema,
                "eager_input_streaming": True}

    def user(self, text: str) -> dict:
        return {"role": "user", "content": text}

    def results(self, turn: TurnResult, outputs: list[tuple[ToolCall, str, bool]]) -> list[dict]:
        return [
            {"role": "assistant", "content": turn.assistant},
            {"role": "user", "content": [
                {"type": "tool_result", "tool_use_id": call.id, "content": text,
                 "is_error": not ok}
                for call, text, ok in outputs
            ]},
        ]

    async def turn(self, system: list[str], messages: list[dict], tools: list[dict],
                   on_text: OnText) -> TurnResult:
        import anthropic

        extra: dict[str, Any] = {}
        if self.default_host and self.model in FALLBACK_MODELS:
            # on a policy decline the API reruns the same request on a fallback model
            extra = {"betas": ["server-side-fallback-2026-07-01"], "fallbacks": "default"}
        blocks = [{"type": "text", "text": system[0], "cache_control": {"type": "ephemeral"}}]
        blocks += [{"type": "text", "text": text} for text in system[1:]]
        try:
            async with self.client.beta.messages.stream(
                model=self.model,
                max_tokens=self.max_tokens,
                system=blocks,
                messages=messages,
                tools=tools,
                thinking={"type": "adaptive"},
                output_config={"effort": "medium"},
                **extra,
            ) as stream:
                async for event in stream:
                    if event.type == "content_block_delta" and event.delta.type == "text_delta":
                        await on_text(event.delta.text)
                final = await stream.get_final_message()
        except ValueError as problem:
            # tool JSON the SDK could not parse at all: nothing complete to run
            raise ProviderError(f"The model sent unreadable tool input: {problem}",
                                "bad_tool_input", True) from problem
        except anthropic.AuthenticationError as problem:
            raise ProviderError("The API key was refused.", "auth", False) from problem
        except anthropic.PermissionDeniedError as problem:
            raise ProviderError("This key can't use that model.", "permission", False) from problem
        except anthropic.NotFoundError as problem:
            raise ProviderError("That model isn't available.", "model", False) from problem
        except anthropic.RateLimitError as problem:
            raise ProviderError("The provider is rate limiting; try again shortly.",
                                "rate_limit", True) from problem
        except anthropic.APITimeoutError as problem:
            raise ProviderError("The provider took too long.", "timeout", True) from problem
        except anthropic.APIConnectionError as problem:
            raise ProviderError("Can't reach the provider (offline?).", "offline",
                                True) from problem
        except anthropic.APIStatusError as problem:
            recoverable = problem.status_code >= 500
            raise ProviderError(f"The provider returned an error ({problem.status_code}).",
                                "provider", recoverable) from problem
        result = TurnResult(stop=final.stop_reason or "end_turn", assistant=final.content,
                            tokens_in=(final.usage.input_tokens or 0)
                            + (getattr(final.usage, "cache_read_input_tokens", 0) or 0)
                            + (getattr(final.usage, "cache_creation_input_tokens", 0) or 0),
                            tokens_out=final.usage.output_tokens or 0)
        result.text = "".join(b.text for b in final.content if b.type == "text")
        if result.stop in {"refusal", "max_tokens"}:
            return result  # a truncated or declined tool call is never run
        for block in final.content:
            if block.type == "tool_use":
                result.calls.append(ToolCall(block.id, block.name, block.input))
        return result


class OpenAICompatibleProvider:
    """Any host speaking Chat Completions with tool calls: OpenAI, Ollama, LM Studio and others."""

    name = "openai"

    def __init__(self, api_key: str | None, model: str, base_url: str, max_tokens: int) -> None:
        self.model = model
        self.max_tokens = max_tokens
        self.base_url = base_url.rstrip("/")
        self.headers = {"Content-Type": "application/json"}
        if api_key:
            self.headers["Authorization"] = f"Bearer {api_key}"

    def tool(self, name: str, description: str, schema: dict) -> dict:
        return {"type": "function",
                "function": {"name": name, "description": description, "parameters": schema}}

    def user(self, text: str) -> dict:
        return {"role": "user", "content": text}

    def results(self, turn: TurnResult, outputs: list[tuple[ToolCall, str, bool]]) -> list[dict]:
        return [turn.assistant] + [
            {"role": "tool", "tool_call_id": call.id, "content": text}
            for call, text, _ok in outputs
        ]

    async def turn(self, system: list[str], messages: list[dict], tools: list[dict],
                   on_text: OnText) -> TurnResult:
        import httpx

        body = {
            "model": self.model,
            "stream": True,
            "stream_options": {"include_usage": True},
            "max_tokens": self.max_tokens,
            "messages": [{"role": "system", "content": "\n\n".join(system)}, *messages],
            "tools": tools,
        }
        text: list[str] = []
        calls: dict[int, dict] = {}
        result = TurnResult()
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(120.0, connect=10.0)) as client:
                async with client.stream("POST", f"{self.base_url}/chat/completions",
                                         headers=self.headers, json=body) as response:
                    if response.status_code >= 400:
                        await response.aread()
                        code = response.status_code
                        raise ProviderError(
                            "The API key was refused." if code in {401, 403} else
                            "The provider is rate limiting; try again shortly." if code == 429
                            else f"The provider returned an error ({code}).",
                            "auth" if code in {401, 403} else "rate_limit" if code == 429
                            else "provider", code == 429 or code >= 500)
                    async for line in response.aiter_lines():
                        if not line.startswith("data:"):
                            continue
                        data = line[5:].strip()
                        if data == "[DONE]":
                            break
                        chunk = json.loads(data)
                        usage = chunk.get("usage") or {}
                        if usage:
                            result.tokens_in = usage.get("prompt_tokens", 0) or 0
                            result.tokens_out = usage.get("completion_tokens", 0) or 0
                        for choice in chunk.get("choices") or []:
                            delta = choice.get("delta") or {}
                            if delta.get("content"):
                                text.append(delta["content"])
                                await on_text(delta["content"])
                            for part in delta.get("tool_calls") or []:
                                slot = calls.setdefault(part.get("index", 0),
                                                        {"id": "", "name": "", "arguments": ""})
                                slot["id"] = part.get("id") or slot["id"]
                                function = part.get("function") or {}
                                slot["name"] += function.get("name") or ""
                                slot["arguments"] += function.get("arguments") or ""
                            if choice.get("finish_reason"):
                                result.stop = choice["finish_reason"]
        except httpx.TimeoutException as problem:
            raise ProviderError("The provider took too long.", "timeout", True) from problem
        except httpx.TransportError as problem:
            raise ProviderError("Can't reach the provider (offline?).", "offline",
                                True) from problem
        result.text = "".join(text)
        native_calls = []
        for index in sorted(calls):
            slot = calls[index]
            native_calls.append({"id": slot["id"] or f"call_{index}", "type": "function",
                                 "function": {"name": slot["name"],
                                              "arguments": slot["arguments"]}})
            if result.stop == "length":
                continue  # a cut-off argument string is never run
            try:
                parsed = json.loads(slot["arguments"] or "{}")
                result.calls.append(ToolCall(slot["id"] or f"call_{index}", slot["name"], parsed))
            except json.JSONDecodeError:
                result.calls.append(ToolCall(slot["id"] or f"call_{index}", slot["name"], None,
                                             "The tool arguments were not valid JSON."))
        result.assistant = {"role": "assistant", "content": result.text or None}
        if native_calls:
            result.assistant["tool_calls"] = native_calls
        return result


class ScriptedProvider:
    """A deterministic provider for tests and local evaluation: it replays scripted model turns,
    streaming each text chunk as a separate delta, exactly as a real provider would."""

    name = "scripted"

    def __init__(self, script: list[dict], model: str = "scripted") -> None:
        self.script = list(script)
        self.model = model
        self.seen: list[list[dict]] = []

    def tool(self, name: str, description: str, schema: dict) -> dict:
        return {"name": name, "description": description, "input_schema": schema}

    def user(self, text: str) -> dict:
        return {"role": "user", "content": text}

    def results(self, turn: TurnResult, outputs: list[tuple[ToolCall, str, bool]]) -> list[dict]:
        return [{"role": "assistant", "content": turn.text},
                {"role": "user", "content": [{"tool_result": text, "ok": ok}
                                             for _call, text, ok in outputs]}]

    async def turn(self, system: list[str], messages: list[dict], tools: list[dict],
                   on_text: OnText) -> TurnResult:
        import asyncio

        self.seen.append(list(messages))
        if not self.script:
            return TurnResult(text="", stop="end_turn")
        step = self.script.pop(0)
        if step.get("error"):
            raise ProviderError(step["error"], step.get("code", "provider"),
                                step.get("recoverable", True))
        chunks = step.get("chunks", [])
        for chunk in chunks:
            await on_text(chunk)
            await asyncio.sleep(step.get("delay", 0))
        calls = [ToolCall(f"call_{i}", call.get("name", "selecta"), call.get("input"))
                 for i, call in enumerate(step.get("calls", []))]
        return TurnResult(text="".join(chunks), calls=calls, stop=step.get("stop", "end_turn"),
                          tokens_in=step.get("tokens_in", 0), tokens_out=step.get("tokens_out", 0))
