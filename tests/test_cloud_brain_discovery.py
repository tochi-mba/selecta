"""A Cloud account's harmonic discovery (`cloud.brain` with `discover.harmonic`, ADR-0479).

The Desktop's sweep runs over Alice's stored song facts through the engine store: it finds the
same links the search finds over the same songs, a second call finds every pair already compared,
and the list and review answer in Desktop's shapes. Bob sees and changes none of it; with the
owner flag off the routes answer flag_off. Synthetic catalogue rows only. PostgreSQL's policy is
in tests/test_engine_store_discovery_postgres.py.
"""

# ruff: noqa: F811  (each test takes the `cloud` fixture imported below)
from __future__ import annotations

from itertools import combinations

from test_cloud_brain_mixes import _workspace
from test_cloud_brain_routes import ALICE, BOB, _auth, _infos, cloud  # noqa: F401  (the fixture)

from selecta import flags
from selecta.discovery.search import audio_links


def _ok(answer) -> dict | list:
    assert answer.status_code == 200, answer.text
    return answer.json()


def _sweep(client, token, song_ids, pair_limit=200):
    body = {"song_ids": song_ids, "pair_limit": pair_limit}
    return client.post("/api/discoveries/sweep", headers=_auth(token), json=body)


def test_the_sweep_finds_what_the_search_finds_and_resumes(cloud):
    client, ids = cloud["client"], cloud["ids"]
    expected = 0
    for a, b in combinations(sorted(_infos(ids), key=lambda song: song.id), 2):
        expected += audio_links([a, b], 2, lambda *row: None, seed=0)
    first = _ok(_sweep(client, ALICE, [*ids, cloud["unmeasured"]], pair_limit=10))
    assert first == {"checked": 10, "cached": 0, "remaining": 18, "added": first["added"],
                     "unmeasured": [cloud["unmeasured"]]}
    rest = _ok(_sweep(client, ALICE, ids))
    assert rest["checked"] == 18 and rest["cached"] == 10 and rest["remaining"] == 0
    assert first["added"] + rest["added"] == expected
    again = _ok(_sweep(client, ALICE, ids))
    assert again["checked"] == 0 and again["cached"] == 28 and again["added"] == 0


def test_the_list_and_review_are_desktops_and_stay_in_the_workspace(cloud):
    client, ids = cloud["client"], cloud["ids"]
    _ok(_sweep(client, ALICE, ids))
    found = _ok(client.get("/api/discoveries", headers=_auth(ALICE)))
    for row in found:
        assert row["kind"] == "harmonic_sequence_candidate" and row["status"] == "new"
        assert set(row) == {"id", "song_a", "song_b", "kind", "payload", "score", "status",
                            "artist_a", "title_a", "artist_b", "title_b"}
        assert isinstance(row["payload"], dict)
    assert _ok(client.get("/api/discoveries", headers=_auth(BOB))) == []
    # Bob can't sweep Alice's songs: they aren't his, so nothing is measured for him
    bob = _ok(_sweep(client, BOB, ids))
    assert bob["checked"] == 0 and sorted(bob["unmeasured"]) == sorted(ids)
    workspace = _workspace(cloud)
    from selecta.cloud_brain.export import kept
    from selecta.persistence import transaction

    with transaction(cloud["engine"], workspace) as connection:
        rows = kept(connection, workspace)
    assert len(rows["discovery_comparisons"]) == 28
    links = rows["seam_book"]
    assert len([row for row in links if row["kind"] == "harmonic_sequence_candidate"]) == len(
        found
    )
    if links:
        first = links[0]["id"]
        refused = client.post(f"/api/discoveries/{first}/review", headers=_auth(BOB),
                              json={"verdict": "approved"})
        assert refused.status_code == 404
    missing = client.post("/api/discoveries/999999/review", headers=_auth(ALICE),
                          json={"verdict": "approved"})
    assert missing.status_code == 404
    wrong = client.post("/api/discoveries/1/review", headers=_auth(ALICE),
                        json={"verdict": "maybe"})
    assert wrong.status_code == 400
    for row in found[:1]:
        answer = _ok(client.post(f"/api/discoveries/{row['id']}/review", headers=_auth(ALICE),
                                 json={"verdict": "approved"}))
        assert answer == {"id": row["id"], "status": "approved"}


def test_the_sweep_is_bounded(cloud):
    client = cloud["client"]
    too_many = _sweep(client, ALICE, list(range(1, 42)))
    assert too_many.status_code == 422
    too_far = _sweep(client, ALICE, cloud["ids"], pair_limit=201)
    assert too_far.status_code == 422


def test_the_routes_answer_flag_off_without_harmonic_matches(cloud):
    flags.use("-discover.harmonic")
    try:
        client, ids = cloud["client"], cloud["ids"]
        for answer in (
            client.get("/api/discoveries", headers=_auth(ALICE)),
            _sweep(client, ALICE, ids),
            client.post("/api/discoveries/1/review", headers=_auth(ALICE),
                        json={"verdict": "new"}),
        ):
            # the build's own gate answers first, for the flag that owns the route
            assert answer.status_code == 403, answer.text
            assert answer.json()["code"] == "flag_off", answer.text
            assert answer.json()["flag"] == "discover.harmonic"
    finally:
        flags.use(None)


def test_the_routes_answer_flag_off_without_the_brain(cloud):
    flags.use("-cloud.brain")
    try:
        answer = cloud["client"].get("/api/discoveries", headers=_auth(ALICE))
        assert answer.status_code == 403, answer.text
        assert answer.json()["detail"]["code"] == "flag_off", answer.text
    finally:
        flags.use(None)
