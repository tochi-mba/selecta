"""Idea cards and builds past 60 songs in a Cloud account (T-20261126-6e24).

The cards are made from each song's numbers without its stored arrays, so they are the same cards
the planner core gives the full songs; a build over a big library plans over the songs that suit
the idea best (`Vibe.belongs`), keeping a chosen first song, and names nothing it passed over as
missing or kept out. Synthetic catalogue rows and facts only.
"""

# ruff: noqa: F811  (each test takes the `cloud` fixture imported below)
from __future__ import annotations

from test_cloud_brain_routes import ALICE, _auth, _infos, cloud  # noqa: F401  (the fixture)

from selecta.cloud_brain import idea_songs, planning
from selecta.engine_store import EngineStore
from selecta.planner_core.vibes import eligible, resolve_vibe, traits_of


def _store(cloud) -> EngineStore:
    from selecta.engine_store.schema import analysis

    with cloud["engine"].connect() as connection:
        row = connection.execute(analysis.select().limit(1)).mappings().first()
    workspace = row["workspace_id"]
    return EngineStore(cloud["engine"], workspace)


def test_the_cards_from_numbers_are_the_cards_from_the_whole_songs(cloud):
    answer = cloud["client"].post(
        "/api/planning/ideas", headers=_auth(ALICE), json={"songs": [*cloud["ids"], 999_999]}
    )
    assert answer.status_code == 200, answer.text
    assert answer.json()["ideas"] == planning.ideas(_infos(cloud["ids"]))
    assert answer.json()["not_measured"] == [999_999]
    summed = idea_songs.summaries(_store(cloud), cloud["ids"])
    assert [(s.id, s.bpm, s.camelot, s.energy) for s in summed] == [
        (s.id, s.bpm, s.camelot, s.energy) for s in _infos(cloud["ids"])
    ]


def test_a_build_over_a_big_library_plans_the_songs_that_suit_it_best(cloud, monkeypatch):
    monkeypatch.setattr(planning, "MAX_ORDER_SONGS", 6)
    ids = cloud["ids"]
    answer = cloud["client"].post(
        "/api/planning/order", headers=_auth(ALICE),
        json={"songs": [*ids, 999_999], "count": 6, "seed": 3, "start": ids[-1]},
    )
    assert answer.status_code == 200, answer.text
    body = answer.json()
    songs = _infos(ids)
    traits = traits_of(songs, {})
    vibe = resolve_vibe("pick")
    fits = eligible(vibe, songs, traits)
    ranked = sorted(fits, key=lambda s: (-vibe.belongs(s, traits[s.id]), s.id))
    allowed = {ids[-1], *[s.id for s in ranked if s.id != ids[-1]][:5]}
    assert body["order"][0] == ids[-1] and set(body["order"]) <= allowed
    assert (body["not_measured"], body["never_play"], body["set_aside"]) == ([999_999], [], [])


def test_more_names_than_the_bound_are_refused(cloud):
    too_many = list(range(1, idea_songs.MOST_NAMED + 2))
    answer = cloud["client"].post(
        "/api/planning/ideas", headers=_auth(ALICE), json={"songs": too_many}
    )
    assert answer.status_code == 422
