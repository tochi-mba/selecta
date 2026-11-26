"""A member's "Is it music?" mark in a device-music Cloud account (T-20261126-3f92).

The mark sits with the corrections (`song_overrides.is_music`): set and cleared on the
correction route, kept when tempo and key are cleared, said on the catalogue for the Library,
honoured by the planner where the Desktop's honours it (only music is planned), and exported with
the account. Synthetic numbers only, no audio.
"""

from __future__ import annotations

import io
import json
import zipfile

from test_cloud_brain_routes import ALICE, BOB, _auth, cloud  # noqa: F401 (the fixture)


def _catalogue(client, token=ALICE) -> dict[int, dict]:
    answer = client.get("/api/local-media/songs?limit=500", headers=_auth(token))
    assert answer.status_code == 200, answer.text
    return {song["id"]: song for song in answer.json()["songs"]}


def test_set_aside_is_kept_apart_from_tempo_and_key(cloud):  # noqa: F811
    client, song = cloud["client"], cloud["ids"][0]
    fix = client.put(
        f"/api/song-facts/{song}/correction", headers=_auth(ALICE), json={"bpm": 121.0}
    )
    assert fix.status_code == 200, fix.text
    aside = client.put(
        f"/api/song-facts/{song}/correction", headers=_auth(ALICE), json={"is_music": False}
    )
    assert aside.status_code == 200, aside.text
    assert aside.json() == {"song_id": song, "bpm": 121.0, "camelot": None, "is_music": False}
    assert _catalogue(client)[song]["set_aside"] is True
    assert "set_aside" not in _catalogue(client)[cloud["ids"][1]]
    # clearing tempo and key keeps the mark
    cleared = client.delete(f"/api/song-facts/{song}/correction", headers=_auth(ALICE))
    assert cleared.status_code == 200
    assert _catalogue(client)[song]["set_aside"] is True
    # null clears the mark
    cleared = client.put(
        f"/api/song-facts/{song}/correction", headers=_auth(ALICE), json={"is_music": None}
    )
    assert cleared.json() == {"song_id": song, "bpm": None, "camelot": None}
    assert "set_aside" not in _catalogue(client)[song]


def test_the_mark_is_strict_and_the_accounts_own(cloud):  # noqa: F811
    client, song = cloud["client"], cloud["ids"][0]
    for wrong in ("no", 0, 1, "false"):
        answer = client.put(
            f"/api/song-facts/{song}/correction", headers=_auth(ALICE), json={"is_music": wrong}
        )
        assert answer.status_code == 422, wrong
    other = client.put(
        f"/api/song-facts/{song}/correction", headers=_auth(BOB), json={"is_music": False}
    )
    assert other.status_code == 404
    assert "set_aside" not in _catalogue(client)[song]


def test_the_planner_leaves_a_set_aside_song_out(cloud):  # noqa: F811
    client, ids = cloud["client"], cloud["ids"]
    client.put(
        f"/api/song-facts/{ids[0]}/correction", headers=_auth(ALICE), json={"is_music": False}
    )
    order = client.post(
        "/api/planning/order", headers=_auth(ALICE), json={"songs": ids, "count": 6, "seed": 7}
    )
    assert order.status_code == 200, order.text
    body = order.json()
    assert ids[0] not in body["order"]
    assert (body["set_aside"], body["never_play"]) == ([ids[0]], [])
    # the idea cards read the songs as if it were not there
    ideas = client.post("/api/planning/ideas", headers=_auth(ALICE), json={"songs": ids})
    without = client.post("/api/planning/ideas", headers=_auth(ALICE), json={"songs": ids[1:]})
    assert ideas.json() == without.json()


def test_the_export_carries_the_mark(cloud):  # noqa: F811
    client, song = cloud["client"], cloud["ids"][0]
    client.put(f"/api/song-facts/{song}/correction", headers=_auth(ALICE), json={"is_music": False})
    answer = client.get("/api/account/export", headers=_auth(ALICE))
    assert answer.status_code == 200, answer.text
    with zipfile.ZipFile(io.BytesIO(answer.content)) as archive:
        kept = json.loads(archive.read("song-facts.json"))
    assert [(row["song_id"], row["is_music"]) for row in kept["corrections"]] == [(song, False)]
