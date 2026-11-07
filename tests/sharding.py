"""Deterministic, exhaustive partition of Python tests, including parametrized IDs."""

from __future__ import annotations

import hashlib


def in_shard(nodeid: str, number: int, total: int) -> bool:
    digest = hashlib.sha256(nodeid.encode("utf-8")).digest()
    return int.from_bytes(digest[:8], "big") % total == number - 1
