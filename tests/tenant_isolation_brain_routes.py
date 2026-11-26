"""Song facts, planning, seam, mix and request routes (`cloud.brain`, ADR-0479) for the tenant
isolation matrix (tests/test_cloud_tenant_isolation.py), kept apart so that file stays under the
length limit.

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
    # the account's mixes and drafts (cloud_brain.mixes_routes, cloud.account_mixes)
    ("GET", "/api/mix"): None,
    ("GET", "/api/drafts"): None,
    ("GET", "/api/drafts/names"): None,
    ("POST", "/api/drafts"): {"name": "Mine"},
    ("POST", "/api/drafts/restore"): None,
    ("POST", "/api/drafts/{draft}/name"): {"name": "Mine"},
    ("POST", "/api/drafts/{draft}/duplicate"): None,
    ("DELETE", "/api/drafts/{draft}"): None,
    ("POST", "/api/drafts/{draft}/play"): None,
    ("POST", "/api/mix/songs"): {"song_id": 1},
    ("DELETE", "/api/mix/songs/{position}"): None,
    ("POST", "/api/mix/move"): {"source": 0, "target": 1},
    ("POST", "/api/mix/{position}/seam"): {"move": "auto"},
    ("POST", "/api/mix/{position}/lock"): None,
    ("POST", "/api/mix/undo"): None,
    ("POST", "/api/mix/clear"): None,
    # the account's song requests (cloud_brain.requests_routes, the same flags)
    ("GET", "/api/requests"): None,
    ("POST", "/api/requests"): {"song_id": 1},
    ("DELETE", "/api/requests/{request_id}"): None,
    ("POST", "/api/requests/{request_id}/bridge"): {"allow": False},
    ("POST", "/api/requests/{request_id}/add"): {},
    ("POST", "/api/requests/consider"): {
        "order": [1], "position": 0, "phase": "playing", "seconds_left": 60.0,
    },
    ("POST", "/api/requests/insert"): {
        "order": [1], "position": 0, "phase": "playing", "seconds_left": 60.0, "offer": "0" * 64,
    },
    # the account's harmonic discovery (cloud_brain.discovery_routes, discover.harmonic)
    ("GET", "/api/discoveries"): None,
    ("POST", "/api/discoveries/sweep"): {"song_ids": [1, 2]},
    ("POST", "/api/discoveries/{discovery_id}/review"): {"verdict": "approved"},
}
