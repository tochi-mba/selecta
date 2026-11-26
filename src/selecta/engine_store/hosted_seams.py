"""A seam the cloud studio rendered (`cloud.hosted_render`), kept in the seam tables with
provenance `worker`, so the planner's memory and the member's verdicts cover it too.

`record_worker_seam` is the adapter. The hosted session calls it where a finished seam artifact
is first found (`hosted_render.mix_state` through `hosted_brain.keep_seams`, behind
`cloud.brain`). The hosted plane keeps its own artifact rows as before; this only adds the seam's
facts, never its audio.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from selecta.engine_store import EngineStore
from selecta.engine_store import seams as stored
from selecta.engine_store.facts_store import song_with_hash


def worker_seam_key(digest: str) -> str:
    """The seam key of a hosted seam artifact (`hosted_render.seam_hash`)."""
    return "w" + digest[:39]


def record_worker_seam(
    store: EngineStore,
    *,
    a_sha256: str,
    b_sha256: str,
    digest: str,
    move: str | None,
    cues: Mapping[str, Any],
    clip_sha256: str,
    worker_id: str,
    implementation: str,
    passed: bool,
) -> str | None:
    """Keep a hosted seam as this workspace's: the record the first time, and the worker's
    attestation. `passed` is the worker's audit verdict; `cues` is the artifact's
    `a_source_start`, `b_source_end` and `seconds`. Returns the seam key, or None when either
    song isn't in this workspace's catalogue."""
    from selecta.planner_core.memory import RULES_VERSION

    a, b = song_with_hash(store, a_sha256), song_with_hash(store, b_sha256)
    if a is None or b is None or a == b:
        return None
    seconds = float(cues["seconds"])
    key = worker_seam_key(digest)
    record = {
        "status": "ready",
        "key": key,
        "request": {"a": a, "b": b, "move": move or "auto"},
        "style": move,
        "tried": [],
        "rules": RULES_VERSION,
        "a_source_start": float(cues["a_source_start"]),
        "b_source_end": float(cues["b_source_end"]),
        "duration": seconds,
        "passed": passed,
        "implementation": implementation,
    }
    with store.write() as connection:
        if stored.record_of_in(connection, store, key) is None:
            stored.keep_in(connection, store, record, source=stored.WORKER)
        stored.attest(
            store,
            key,
            studio=stored.WORKER,
            studio_id=worker_id,
            implementation=implementation,
            clip_sha256=clip_sha256,
            clip_seconds=seconds,
            connection=connection,
        )
    return key


__all__ = ["record_worker_seam", "worker_seam_key"]
