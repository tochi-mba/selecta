"""Song facts, planning and seam routes (`cloud.brain`, ADR-0479) for the tenant isolation matrix
(tests/test_cloud_tenant_isolation.py), kept apart so that file stays under the length limit.

Each one reads or writes only the caller's own workspace through the engine store, so naming
another workspace is refused before anything happens. The bodies are valid enough to get past
validation; the facts upload reads its body only after the workspace check, so it needs none.
`tests/test_cloud_brain_routes.py` proves a second account can't read, write or plan with the
first one's songs.
"""

from __future__ import annotations

BRAIN_SCOPED: dict[tuple[str, str], dict | None] = {
    ("PUT", "/api/song-facts/{song_id}"): None,
    ("GET", "/api/song-facts"): None,
    ("PUT", "/api/song-facts/{song_id}/correction"): {"bpm": 120.0},
    ("DELETE", "/api/song-facts/{song_id}/correction"): None,
    ("POST", "/api/planning/candidates"): {"a": 1, "b": 2},
    ("POST", "/api/planning/candidates/script"): {
        "a": 1, "b": 2, "option": 0, "fingerprint": "0" * 64,
    },
    ("POST", "/api/planning/next-step"): {"options": [], "attempts": []},
    ("POST", "/api/planning/take-step"): {"first": {"passed": True}},
    ("POST", "/api/planning/order"): {"songs": [1, 2]},
    ("POST", "/api/planning/ideas"): {"songs": [1]},
    # seams in Cloud (engine_store.seams); the report reads its body after the workspace check
    ("PUT", "/api/seams/{key}"): None,
    ("GET", "/api/seams"): None,
    ("POST", "/api/seams/{key}/rate"): {"rating": "good"},
    ("GET", "/api/memory/ratings"): None,
}
