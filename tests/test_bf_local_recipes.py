"""Portable recipes over the metadata-only catalogue (ADR-0458, BF-0462-05): a mix made in the
browser is saved as immutable revisions of the shared mix contract, read back on any device,
edited only from its latest revision, and kept apart per workspace. Rides on
`cloud.local_media`. Migration up and down is covered by `tests/test_cloud_migrations.py`.
"""

from __future__ import annotations

import pytest
from cloud_party import ALICE, BOB, auth

from selecta import flags

pytest_plugins = ("cloud_party",)


@pytest.fixture
def local_media_on():
    flags.use("+cloud.local_media")
    yield
    flags.use(None)


def _songs(party, token: str, count: int = 3) -> list[int]:
    answer = party.client.post(
        "/api/local-media/songs",
        headers=auth(token),
        json={
            "songs": [
                {
                    "content_sha256": f"{index + 1:x}" * 64,
                    "title": f"Song {index + 1}",
                    "artist": "Rex",
                    "duration_s": 180.0 + index,
                }
                for index in range(count)
            ]
        },
    )
    assert answer.status_code == 200, answer.text
    return [entry["song_id"] for entry in answer.json()["songs"]]


def _make(party, token: str, song_ids: list[int], name: str = "Friday") -> dict:
    answer = party.client.post(
        "/api/local-media/recipes", headers=auth(token), json={"name": name, "song_ids": song_ids}
    )
    assert answer.status_code == 200, answer.text
    return answer.json()["mix"]


def test_recipes_ship_on_and_the_build_can_turn_them_off(party):
    assert party.client.get("/api/local-media/recipes", headers=auth(ALICE)).status_code == 200
    flags.use("-cloud.local_media")
    answer = party.client.get("/api/local-media/recipes", headers=auth(ALICE))
    assert answer.status_code == 403
    assert answer.json()["flag"] == "cloud.local_media"


def test_a_recipe_holds_identities_and_an_honest_plan(party, local_media_on):
    ids = _songs(party, ALICE)
    mix = _make(party, ALICE, ids)
    assert [song["song_id"] for song in mix["songs"]] == ids
    assert [song["title"] for song in mix["songs"]] == ["Song 1", "Song 2", "Song 3"]
    assert all(len(song["sha256"]) == 64 for song in mix["songs"])
    assert all(song["in_library"] for song in mix["songs"])
    # no analysis facts on the server: every seam is a plain crossfade, never called intelligent
    assert [seam["basis"] for seam in mix["seams"]] == ["unanalysed", "unanalysed"]
    assert mix["intelligent_seams"] == 0
    assert mix["number"] == 1 and mix["parent"] is None

    listed = party.client.get("/api/local-media/recipes", headers=auth(ALICE)).json()["recipes"]
    assert [(entry["mix_id"], entry["songs"]) for entry in listed] == [(mix["mix_id"], 3)]


def test_edits_make_new_revisions_and_refuse_a_stale_base(party, local_media_on):
    ids = _songs(party, ALICE)
    first = _make(party, ALICE, ids)
    path = f"/api/local-media/recipes/{first['mix_id']}/revisions"
    edited = party.client.post(
        path,
        headers=auth(ALICE),
        json={"base_revision": first["revision"], "song_ids": ids[:2], "name": "Friday short"},
    )
    assert edited.status_code == 200, edited.text
    second = edited.json()["mix"]
    assert second["number"] == 2 and second["parent"] == first["revision"]
    assert second["name"] == "Friday short"

    stale = party.client.post(
        path, headers=auth(ALICE), json={"base_revision": first["revision"], "name": "x"}
    )
    assert stale.status_code == 409
    assert stale.json()["detail"]["code"] == "stale_revision"

    read = party.client.get(
        f"/api/local-media/recipes/{first['mix_id']}", headers=auth(ALICE)
    ).json()
    assert read["mix"]["revision"] == second["revision"]
    # the earlier revision is kept exactly as it was
    assert [entry["number"] for entry in read["history"]] == [2, 1]
    assert read["history"][1]["songs"] == 3


def test_a_chosen_move_follows_its_two_songs_and_a_copy_keeps_it(party, local_media_on):
    ids = _songs(party, ALICE, 4)
    first = _make(party, ALICE, ids)
    path = f"/api/local-media/recipes/{first['mix_id']}/revisions"

    def moves(mix: dict) -> list:
        return [seam["settings"].get("move") for seam in mix["seams"]]

    chosen = party.client.post(
        path,
        headers=auth(ALICE),
        json={"base_revision": first["revision"], "seam_moves": {"2": "echo_out"}},
    )
    assert chosen.status_code == 200, chosen.text
    second = chosen.json()["mix"]
    assert moves(second) == [None, "echo_out", None]
    # still unanalysed: a member's choice never dresses the seam up as SelectaDJ's analysis
    assert [seam["basis"] for seam in second["seams"]] == ["unanalysed"] * 3
    assert second["revision"] != first["revision"]

    # moving the last song to the front keeps songs 2 and 3 together, so their move stays
    reordered = party.client.post(
        path,
        headers=auth(ALICE),
        json={"base_revision": second["revision"], "song_ids": [ids[3], ids[0], ids[1], ids[2]]},
    ).json()["mix"]
    assert moves(reordered) == [None, None, "echo_out"]
    # parting them lets the move go: it belonged to that pair
    parted = party.client.post(
        path,
        headers=auth(ALICE),
        json={"base_revision": reordered["revision"], "song_ids": [ids[1], ids[3], ids[2], ids[0]]},
    ).json()["mix"]
    assert moves(parted) == [None, None, None]

    kept = party.client.post(
        path,
        headers=auth(ALICE),
        json={"base_revision": parted["revision"], "seam_moves": {"1": "reverb_wash"}},
    ).json()["mix"]
    copied = party.client.post(
        f"/api/local-media/recipes/{first['mix_id']}/duplicate", headers=auth(ALICE)
    ).json()["mix"]
    assert moves(copied) == moves(kept) == ["reverb_wash", None, None]

    # 'auto' (or null) is SelectaDJ picking again, stored as no move at all
    again = party.client.post(
        path,
        headers=auth(ALICE),
        json={"base_revision": kept["revision"], "seam_moves": {"1": "auto"}},
    ).json()["mix"]
    assert moves(again) == [None, None, None]


def test_a_move_the_browser_cannot_play_or_a_missing_seam_is_refused(party, local_media_on):
    ids = _songs(party, ALICE)
    first = _make(party, ALICE, ids)
    path = f"/api/local-media/recipes/{first['mix_id']}/revisions"
    unknown = party.client.post(
        path,
        headers=auth(ALICE),
        json={"base_revision": first["revision"], "seam_moves": {"1": "word_cut"}},
    )
    assert unknown.status_code == 400
    assert unknown.json()["detail"]["code"] == "invalid_move"
    missing = party.client.post(
        path,
        headers=auth(ALICE),
        json={"base_revision": first["revision"], "seam_moves": {"3": "echo_out"}},
    )
    assert missing.status_code == 409
    assert missing.json()["detail"]["code"] == "invalid_seam"


def test_duplicate_starts_an_independent_recipe_from_latest_revision(party, local_media_on):
    ids = _songs(party, ALICE)
    original = _make(party, ALICE, ids)
    edited = party.client.post(
        f"/api/local-media/recipes/{original['mix_id']}/revisions",
        headers=auth(ALICE),
        json={"base_revision": original["revision"], "name": "Friday final", "song_ids": ids[:2]},
    )
    assert edited.status_code == 200, edited.text
    latest = edited.json()["mix"]

    copied = party.client.post(
        f"/api/local-media/recipes/{original['mix_id']}/duplicate", headers=auth(ALICE)
    )
    assert copied.status_code == 200, copied.text
    duplicate = copied.json()["mix"]
    assert duplicate["mix_id"] != original["mix_id"]
    assert duplicate["name"] == "Friday final copy"
    assert duplicate["number"] == 1 and duplicate["parent"] is None
    assert [song["song_id"] for song in duplicate["songs"]] == [
        song["song_id"] for song in latest["songs"]
    ]


def test_delete_removes_all_revisions_only_for_the_callers_workspace(party, local_media_on):
    ids = _songs(party, ALICE)
    mix = _make(party, ALICE, ids)
    edit = party.client.post(
        f"/api/local-media/recipes/{mix['mix_id']}/revisions",
        headers=auth(ALICE),
        json={"base_revision": mix["revision"], "name": "Friday revised"},
    )
    assert edit.status_code == 200, edit.text

    refused = party.client.delete(f"/api/local-media/recipes/{mix['mix_id']}", headers=auth(BOB))
    assert refused.status_code == 404
    deleted = party.client.delete(f"/api/local-media/recipes/{mix['mix_id']}", headers=auth(ALICE))
    assert deleted.status_code == 204
    missing = party.client.get(f"/api/local-media/recipes/{mix['mix_id']}", headers=auth(ALICE))
    assert missing.status_code == 404


def test_a_deleted_song_stays_in_the_recipe_and_reads_as_not_in_the_library(party, local_media_on):
    ids = _songs(party, ALICE)
    mix = _make(party, ALICE, ids)
    party.client.delete(f"/api/local-media/songs/{ids[1]}", headers=auth(ALICE))
    read = party.client.get(f"/api/local-media/recipes/{mix['mix_id']}", headers=auth(ALICE)).json()
    assert [song["in_library"] for song in read["mix"]["songs"]] == [True, False, True]


def test_a_recipe_refuses_songs_it_cannot_name(party, local_media_on):
    ids = _songs(party, ALICE, 2)
    too_few = party.client.post(
        "/api/local-media/recipes", headers=auth(ALICE), json={"name": "x", "song_ids": ids[:1]}
    )
    assert too_few.status_code == 422
    unknown = party.client.post(
        "/api/local-media/recipes",
        headers=auth(ALICE),
        json={"name": "x", "song_ids": [ids[0], 999_999]},
    )
    assert unknown.status_code == 404
    assert unknown.json()["detail"]["missing"] == [999_999]
    # no path or audio detail can ride along
    extra = party.client.post(
        "/api/local-media/recipes",
        headers=auth(ALICE),
        json={"name": "x", "song_ids": ids, "path": "C:/Music"},
    )
    assert extra.status_code == 422


def test_bob_cannot_list_read_or_edit_alices_recipes(party, local_media_on):
    ids = _songs(party, ALICE)
    mix = _make(party, ALICE, ids)
    assert party.client.get("/api/local-media/recipes", headers=auth(BOB)).json()["recipes"] == []
    read = party.client.get(f"/api/local-media/recipes/{mix['mix_id']}", headers=auth(BOB))
    assert read.status_code == 404
    edit = party.client.post(
        f"/api/local-media/recipes/{mix['mix_id']}/revisions",
        headers=auth(BOB),
        json={"base_revision": mix["revision"], "name": "Mine now"},
    )
    assert edit.status_code == 404
    # and Bob cannot build a recipe from Alice's songs
    stolen = party.client.post(
        "/api/local-media/recipes", headers=auth(BOB), json={"name": "x", "song_ids": ids}
    )
    assert stolen.status_code == 404
