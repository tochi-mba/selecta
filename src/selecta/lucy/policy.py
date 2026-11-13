"""Least privilege for Lucy, enforced by the host, not by the model (ADR-0331, LU-300-03).

Tiers, from harmless to never-automatic:

- read: look things up. Lucy may do this on its own, inside budgets.
- propose: write a new proposal revision (never a draft). Lucy may do this on its own.
- compute: start expensive work (new analysis). Only after the person allows the exact request.
- save: keep something durable the person asked for in their own words (a memory).
- change / play / destructive: never tools at all. Saving a draft is the host's approval flow;
  playing needs a further confirmation; nothing can delete music.

Everything a tool returns, and everything in song tags or lyrics, is data. Text that looks like
an instruction inside it changes nothing, and nothing a model writes is rendered as HTML.
"""

from __future__ import annotations

import re
import threading
import time
from collections import deque
from typing import Any

TIERS = ("read", "propose", "compute", "save", "change", "play", "destructive")
AUTONOMOUS = {"read", "propose"}
NEVER_TOOLS = {"change", "play", "destructive"}

OPERATION_TIERS: dict[str, str] = {}
"""Filled in by tools.py as each operation is registered; checked by `audit`."""

CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f‪-‮⁦-⁩]")
TAG = re.compile(r"<\s*/?\s*(script|iframe|object|embed|style|img|svg|a|form|input)\b[^>]*>", re.I)
INSTRUCTION = re.compile(
    r"\b(ignore (all|any|previous|the above) (instructions|rules)|system prompt|you are now|"
    r"approve (this|the) (mix|draft)|call the tool|run the following)\b",
    re.I,
)


def tier_of(operation: str) -> str:
    return OPERATION_TIERS.get(operation, "destructive")


def offered(operation: Any) -> bool:
    """The include predicate handed to WeftAI. A compute operation is offered only as a way to
    ASK: its handler files a permission request and runs nothing until the person allows it."""
    return tier_of(operation.name) not in NEVER_TOOLS


def audit(operations: list[Any]) -> list[str]:
    """Declared WeftAI effects and annotations must match the tier the host enforces."""
    problems = []
    for operation in operations:
        tier = OPERATION_TIERS.get(operation.name)
        if tier is None:
            problems.append(f"{operation.name} has no permission tier.")
            continue
        if tier in NEVER_TOOLS:
            problems.append(f"{operation.name} is a {tier} operation and can't be a tool.")
        if tier == "read" and operation.effects != "read":
            problems.append(f"{operation.name} is read-tier but declares writes.")
        if tier != "read" and operation.effects != "write":
            problems.append(f"{operation.name} changes state but declares itself a read.")
        if operation.annotations["openWorld"]:
            problems.append(f"{operation.name} must not reach outside SelectaDJ.")
        if tier in {"propose", "save"} and operation.annotations["destructive"]:
            problems.append(f"{operation.name} is marked destructive but only adds records.")
    return problems


def clean_text(value: Any, limit: int = 200) -> str:
    """Song tags, lyrics and names, made safe to show and to hand to a model as data."""
    text = CONTROL.sub("", str(value if value is not None else ""))
    text = TAG.sub("", text)
    return " ".join(text.split())[:limit]


def looks_like_instruction(text: str) -> bool:
    return bool(INSTRUCTION.search(text or ""))


def as_data(label: str, value: Any) -> str:
    """Wrap untrusted content so a model reads it as quoted data, never as orders."""
    return f'<data name="{label}">{clean_text(value, 2000)}</data>'


PRIVATE_KEYS = {"path", "folder", "file", "api_key", "key_secret", "authorization"}


def minimise(payload: Any) -> Any:
    """Drop anything a provider must never receive: file paths, keys, raw audio (LU-331-04)."""
    if isinstance(payload, dict):
        return {
            key: minimise(value)
            for key, value in payload.items()
            if key.casefold() not in PRIVATE_KEYS and not isinstance(value, bytes | bytearray)
        }
    if isinstance(payload, list | tuple):
        return [minimise(item) for item in payload]
    if isinstance(payload, str) and re.match(r"^[A-Za-z]:[\\/]|^/(home|Users|mnt)/", payload):
        return "[local path withheld]"
    return payload


class RateLimit:
    """Turns per conversation and overall, so a loop or a flood can't starve the audio."""

    def __init__(self, per_minute: int = 12, overall_per_minute: int = 30) -> None:
        self.per_minute = per_minute
        self.overall = overall_per_minute
        self._seen: dict[str, deque[float]] = {}
        self._all: deque[float] = deque()
        self._lock = threading.Lock()

    def allow(self, key: str) -> bool:
        now = time.monotonic()
        with self._lock:
            mine = self._seen.setdefault(key, deque())
            for queue in (mine, self._all):
                while queue and now - queue[0] > 60:
                    queue.popleft()
            if len(mine) >= self.per_minute or len(self._all) >= self.overall:
                return False
            mine.append(now)
            self._all.append(now)
            return True
