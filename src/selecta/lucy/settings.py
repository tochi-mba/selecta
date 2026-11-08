"""Lucy's switches, provider choice, budgets and privacy, plus server-only secrets.

Each rollout phase switches on and off on its own (chat, proposals, commit, memory, voice), and
turning Lucy off stops model work without deleting a single draft or song (ADR-0338). A remote
provider needs an explicit choice and consent before any prompt leaves the computer; its key is
kept in a separate file in the data home and is never sent to the browser, an event or a trace
(ADR-0330, LU-330-02/03).
"""

from __future__ import annotations

import copy
import json
import os
import sqlite3
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

from selecta import db

PREFERENCE = "lucy"
SECRETS_FILE = "lucy-secrets.json"
API_VERSION = 1

DEFAULTS: dict[str, Any] = {
    "enabled": True,
    "phases": {"chat": True, "proposals": True, "commit": True, "memory": False, "voice": False},
    "provider": {"kind": "builtin", "model": None, "base_url": None, "consent": False},
    "budgets": {
        "max_cycles": 6,
        "max_steps": 40,
        "max_seconds": 120,
        "max_output_tokens": 4000,
        "spend_cap_usd": None,
    },
    "privacy": {"share_lyrics": False, "share_history": False},
}

LIMITS = {
    "max_cycles": (1, 12),
    "max_steps": (1, 120),
    "max_seconds": (10, 900),
    "max_output_tokens": (256, 32000),
}

PROVIDERS = {
    "builtin": "Built-in (on this computer, no AI service)",
    "anthropic": "Anthropic",
    "openai": "OpenAI-compatible",
}

DEFAULT_MODELS = {"anthropic": "claude-sonnet-5-5", "openai": "gpt-5"}
DEFAULT_URLS = {"anthropic": "https://api.anthropic.com", "openai": "https://api.openai.com/v1"}
LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1"}

DATA_CLASSES = [
    ("messages", "What you type, and Lucy's replies"),
    ("song_facts", "Titles, artists, tempo, key and energy of songs Lucy looks at"),
    ("seam_status", "Transition statuses and counts (never audio)"),
    ("rules", "The rules of the current proposal"),
    ("history", "A summary of your most-played songs"),
    ("lyrics", "Short lyric phrases for word links"),
]


def _merge(base: dict, extra: dict) -> dict:
    merged = copy.deepcopy(base)
    for key, value in (extra or {}).items():
        if key in merged and isinstance(merged[key], dict) and isinstance(value, dict):
            merged[key] = _merge(merged[key], value)
        elif key in merged:
            merged[key] = value
    return merged


def get(conn: sqlite3.Connection) -> dict:
    stored = db.preference(conn, PREFERENCE, {}) or {}
    config = _merge(DEFAULTS, stored)
    config["provider"]["remote"] = is_remote(config["provider"])
    return config


def is_remote(provider: dict) -> bool:
    kind = provider.get("kind", "builtin")
    if kind == "builtin":
        return False
    url = provider.get("base_url") or DEFAULT_URLS.get(kind, "")
    return (urlsplit(url).hostname or "") not in LOCAL_HOSTS


def _secrets_path(home: Path) -> Path:
    return home / SECRETS_FILE


def read_secret(home: Path, kind: str) -> str | None:
    env = {"anthropic": "ANTHROPIC_API_KEY", "openai": "OPENAI_API_KEY"}.get(kind)
    try:
        stored = json.loads(_secrets_path(home).read_text("utf-8"))
    except (OSError, ValueError):
        stored = {}
    return stored.get(kind) or (os.environ.get(env) if env else None) or None


def _write_secret(home: Path, kind: str, key: str | None) -> None:
    path = _secrets_path(home)
    try:
        stored = json.loads(path.read_text("utf-8"))
    except (OSError, ValueError):
        stored = {}
    if key:
        stored[kind] = key.strip()
    else:
        stored.pop(kind, None)
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(stored), "utf-8")
    os.replace(temporary, path)


def update(conn: sqlite3.Connection, home: Path, changes: dict) -> dict:
    """Apply only known, validated settings. A new remote provider starts without consent."""
    config = get(conn)
    stored = {key: copy.deepcopy(config[key]) for key in DEFAULTS}
    if "enabled" in changes:
        stored["enabled"] = bool(changes["enabled"])
    for name, value in (changes.get("phases") or {}).items():
        if name in stored["phases"]:
            stored["phases"][name] = bool(value)
    provider = changes.get("provider") or {}
    if provider:
        kind = provider.get("kind", stored["provider"]["kind"])
        if kind not in PROVIDERS:
            raise ValueError("Choose the built-in Lucy, Anthropic or an OpenAI-compatible host.")
        changed_kind = kind != stored["provider"]["kind"]
        stored["provider"]["kind"] = kind
        for field in ("model", "base_url"):
            if field in provider:
                text = (provider[field] or "").strip() or None
                if field == "base_url" and text and urlsplit(text).scheme not in {"http", "https"}:
                    raise ValueError("The address must start with http:// or https://.")
                stored["provider"][field] = text
        if changed_kind or "base_url" in provider:
            stored["provider"]["consent"] = False
        if "consent" in provider:
            stored["provider"]["consent"] = bool(provider["consent"])
        if "api_key" in provider:
            _write_secret(home, kind, provider["api_key"])
    for name, value in (changes.get("budgets") or {}).items():
        if name == "spend_cap_usd":
            stored["budgets"][name] = None if value in (None, "") else max(0.0, float(value))
        elif name in LIMITS:
            low, high = LIMITS[name]
            stored["budgets"][name] = int(min(high, max(low, int(value))))
    for name, value in (changes.get("privacy") or {}).items():
        if name in stored["privacy"]:
            stored["privacy"][name] = bool(value)
    stored["provider"].pop("remote", None)
    db.set_preference(conn, PREFERENCE, stored)
    return get(conn)


def capabilities(kind: str) -> dict:
    """Known per provider family (LU-330-01). The built-in Lucy is honest about its limits."""
    if kind == "builtin":
        return {
            "streaming": True,
            "tools": True,
            "json_schema": False,
            "context_tokens": None,
            "cancellation": True,
        }
    return {
        "streaming": True,
        "tools": True,
        "json_schema": True,
        "context_tokens": 200000 if kind == "anthropic" else None,
        "cancellation": True,
    }


def status(conn: sqlite3.Connection, home: Path) -> dict:
    config = get(conn)
    provider = config["provider"]
    kind = provider["kind"]
    key_set = bool(read_secret(home, kind)) if kind != "builtin" else False
    mode, reason = "constrained", None
    if not config["enabled"]:
        mode, reason = "unavailable", "Lucy is turned off. Make a Mix works as usual."
    elif kind == "builtin":
        reason = (
            "The built-in Lucy understands common requests and edits; an AI provider "
            "understands more."
        )
    elif provider["remote"] and not provider["consent"]:
        mode, reason = "unavailable", "Agree to what is sent before Lucy can use this provider."
    elif kind == "anthropic" and not key_set:
        mode, reason = "unavailable", "Add an API key for Anthropic."
    elif kind == "openai" and provider["remote"] and not key_set:
        mode, reason = "unavailable", "Add an API key for this provider."
    else:
        mode = "full"
    shared = {
        "messages": provider["remote"],
        "song_facts": provider["remote"],
        "seam_status": provider["remote"],
        "rules": provider["remote"],
        "history": provider["remote"] and config["privacy"]["share_history"],
        "lyrics": provider["remote"] and config["privacy"]["share_lyrics"],
    }
    return {
        "enabled": config["enabled"],
        "phases": config["phases"],
        "provider": {
            "kind": kind,
            "label": PROVIDERS[kind],
            "model": provider["model"] or DEFAULT_MODELS.get(kind),
            "base_url": provider["base_url"] or DEFAULT_URLS.get(kind),
            "remote": provider["remote"],
            "consented": bool(provider["consent"]),
            "key_set": key_set,
            "mode": mode,
            "reason": reason,
            "capabilities": capabilities(kind),
        },
        "budgets": config["budgets"],
        "privacy": {
            **config["privacy"],
            "data_classes": [
                {"id": name, "label": label, "sent": shared[name]} for name, label in DATA_CLASSES
            ],
        },
        "event_schema": 1,
        "api_version": API_VERSION,
    }
