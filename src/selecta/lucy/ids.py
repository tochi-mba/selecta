"""Stable identifiers, canonical hashing and time for Lucy's durable objects (LU-302-01)."""

from __future__ import annotations

import hashlib
import json
import secrets
import time
from datetime import UTC, datetime
from typing import Any

PREFIXES = {
    "conversation": "cv",
    "message": "msg",
    "turn": "turn",
    "run": "run",
    "plan": "plan",
    "proposal": "prop",
    "revision": "rev",
    "occurrence": "occ",
    "memory": "mem",
    "permission": "perm",
    "rule": "rule",
    "commit": "commit",
}


def new_id(kind: str) -> str:
    """An opaque, unguessable, never-reused identifier for one kind of object."""
    return f"{PREFIXES[kind]}_{secrets.token_hex(8)}"


def canonical(value: Any) -> str:
    """One spelling of a JSON value, so equal content always hashes equally."""
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def content_hash(value: Any) -> str:
    return hashlib.sha256(canonical(value).encode("utf-8")).hexdigest()


def now_iso() -> str:
    return datetime.now(UTC).isoformat(timespec="milliseconds")


def now_ms() -> int:
    return int(time.time() * 1000)
