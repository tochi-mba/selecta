"""The metadata-only song catalogue (ADR-0458, BF-0458-03): registration, listing, soft delete
and device availability under `cloud.local_media`, with no raw path ever accepted; Rooms'
requestability follows availability through `LocalMediaCatalog`; and the ADR-0456 read carve-out
holds: the `cloud.stored_media` routes stay open for an account whose `cloud.hosted_media` grant
a USERS rule revoked, while the upload writes answer 403 `flag_off`.

Migration up and down for `local_songs` and `local_song_availability` is covered by
`tests/test_cloud_migrations.py`, which walks every revision; nothing is duplicated here.
"""

from __future__ import annotations

import pytest
from cloud_party import ALICE, BOB, CAROL, auth

from selecta import flags
from selecta.flags import rules as flag_rules
from selecta.flags.matching import Rule, RuleKind
from selecta.local_media import store
from selecta.local_media.catalog import LocalMediaCatalog
from selecta.persistence import transaction

pytest_plugins = ("cloud_party",)

SHA_A = "a" * 64
SHA_B = "b" * 64
SHA_C = "c" * 64

UPLOAD_ROUTES = (
    "POST /api/uploads/plan",
    "GET /api/uploads",
    "GET /api/uploads/{session_id}",
    "POST /api/uploads/{session_id}/parts",
    "POST /api/uploads/{session_id}/complete",
    "DELETE /api/uploads/{session_id}",
)
STORED_MEDIA_ROUTES = (
    "GET /api/assets",
    "GET /api/assets/{asset_id}",
    "DELETE /api/assets/{asset_id}",
    "GET /api/assets/{asset_id}/playback-url",
    "POST /api/assets/{asset_id}/playback-proxy",
    "GET /api/assets/{asset_id}/playback-proxy",
    "POST /api/storage/derived-playback-url",
)


@pytest.fixture
def local_media_on():
    """`cloud.local_media` ships dark; these tests switch the build flag on, as a rollout
    would, and put the process flags back afterwards."""
    flags.use("+cloud.local_media")
    yield
    flags.use(None)


def _rules(party, flag_id: str, rules) -> None:
    with transaction(party.engine) as conn:
        flag_rules.save(conn, flag_id, rules, author="tests", reason="local media test")
    party.app.state.flag_rules.invalidate()


def _user_id(party, token: str) -> str:
    return party.client.get("/api/account", headers=auth(token)).json()["user"]["id"]


def _register(party, token: str, songs: list[dict]) -> list[dict]:
    answer = party.client.post("/api/local-media/songs", headers=auth(token), json={"songs": songs})
    assert answer.status_code == 200, answer.text
    return answer.json()["songs"]


def song(sha: str, title: str = "Night Drive", artist: str = "Rex", **extra) -> dict:
    return {"content_sha256": sha, "title": title, "artist": artist, **extra}


# -- the round trip ----------------------------------------------------------------------------


def test_register_list_get_and_delete_round_trip(party, local_media_on):
    made = _register(
        party,
        ALICE,
        [song(SHA_A, duration_s=201.5, codec="flac", sample_rate=44_100), song(SHA_B, "Dawn")],
    )
    assert [entry["content_sha256"] for entry in made] == [SHA_A, SHA_B]
    ids = [entry["song_id"] for entry in made]
    assert all(isinstance(song_id, int) for song_id in ids)

    listed = party.client.get("/api/local-media/songs", headers=auth(ALICE)).json()
    assert [entry["id"] for entry in listed["songs"]] == ids
    assert "next" not in listed
    first = listed["songs"][0]
    assert (first["title"], first["artist"]) == ("Night Drive", "Rex")
    assert first["duration_s"] == 201.5
    assert first["available_on"] == 0

    one = party.client.get(f"/api/local-media/songs/{ids[0]}", headers=auth(ALICE))
    assert one.status_code == 200
    assert one.json()["song"]["content_sha256"] == SHA_A

    gone = party.client.delete(f"/api/local-media/songs/{ids[0]}", headers=auth(ALICE))
    assert gone.status_code == 200
    assert gone.json() == {"id": ids[0], "deleted": True, "already_deleted": False}
    again = party.client.delete(f"/api/local-media/songs/{ids[0]}", headers=auth(ALICE))
    assert again.json()["already_deleted"] is True
    left = party.client.get("/api/local-media/songs", headers=auth(ALICE)).json()["songs"]
    assert [entry["id"] for entry in left] == [ids[1]]


def test_registering_the_same_hash_again_returns_the_same_id(party, local_media_on):
    [first] = _register(party, ALICE, [song(SHA_A)])
    [second] = _register(party, ALICE, [song(SHA_A, "Night Drive (tagged)")])
    assert second["song_id"] == first["song_id"]
    listed = party.client.get("/api/local-media/songs", headers=auth(ALICE)).json()["songs"]
    assert len(listed) == 1
    assert listed[0]["title"] == "Night Drive (tagged)"


def test_paging_hands_back_a_cursor(party, local_media_on):
    _register(party, ALICE, [song(f"{index:064x}", f"Song {index}") for index in range(1, 5)])
    first = party.client.get(
        "/api/local-media/songs", headers=auth(ALICE), params={"limit": 3}
    ).json()
    assert len(first["songs"]) == 3
    rest = party.client.get(
        "/api/local-media/songs", headers=auth(ALICE), params={"after": first["next"]}
    ).json()
    assert len(rest["songs"]) == 1
    assert "next" not in rest


# -- flag gating -------------------------------------------------------------------------------


def test_the_catalogue_ships_dark_in_the_build(party):
    answer = party.client.get("/api/local-media/songs", headers=auth(ALICE))
    assert answer.status_code == 403
    assert answer.json()["code"] == "flag_off"
    assert answer.json()["flag"] == "cloud.local_media"


def test_a_users_rule_refuses_the_catalogue_with_flag_off(party, local_media_on):
    _rules(
        party,
        "cloud.local_media",
        [Rule(RuleKind.USERS, {"ids": [_user_id(party, CAROL)], "on": False})],
    )
    refused = party.client.post(
        "/api/local-media/songs", headers=auth(CAROL), json={"songs": [song(SHA_A)]}
    )
    assert refused.status_code == 403
    assert refused.json()["detail"] == {
        "code": "flag_off",
        "message": "Local media catalogue isn't available on this account right now.",
        "flag": "cloud.local_media",
    }
    # Only the targeted account is refused.
    _register(party, ALICE, [song(SHA_A)])


# -- identity ----------------------------------------------------------------------------------


def test_a_different_hash_with_the_same_title_and_artist_is_marked_not_merged(
    party, local_media_on
):
    [first] = _register(party, ALICE, [song(SHA_A, "Night Drive", "Rex")])
    [twin] = _register(party, ALICE, [song(SHA_B, " night  DRIVE ", "REX")])
    assert twin["song_id"] != first["song_id"]
    assert twin["duplicate_of"] == first["song_id"]
    # Marked, never merged: both entries list, and the detail carries the mark.
    listed = party.client.get("/api/local-media/songs", headers=auth(ALICE)).json()["songs"]
    assert len(listed) == 2
    detail = party.client.get(
        f"/api/local-media/songs/{twin['song_id']}", headers=auth(ALICE)
    ).json()["song"]
    assert detail["duplicate_of"] == first["song_id"]
    # A third song with its own title is no duplicate of anything.
    [other] = _register(party, ALICE, [song(SHA_C, "Dawn")])
    assert "duplicate_of" not in other


def test_no_payload_with_a_path_in_it_is_accepted(party, local_media_on):
    for stowaway in ("path", "file_path", "sourcePath"):
        answer = party.client.post(
            "/api/local-media/songs",
            headers=auth(ALICE),
            json={"songs": [{**song(SHA_A), stowaway: "C:/Music/a.flac"}]},
        )
        assert answer.status_code == 422, f"{stowaway} rode along: {answer.text}"
    # The availability report forbids unknown fields the same way.
    answer = party.client.post(
        "/api/local-media/availability",
        headers=auth(ALICE),
        json={"device_id": "device-a", "present": [], "absent": [], "path": "C:/Music"},
    )
    assert answer.status_code == 422
    # Defence in depth: the store refuses path-bearing keys even when called directly.
    with transaction(party.engine, party.workspaces[ALICE]) as conn:
        with pytest.raises(ValueError, match="path"):
            store.register_songs(
                conn, party.workspaces[ALICE], [{**song(SHA_A), "Path": "C:/Music/a.flac"}]
            )


# -- availability and Rooms requestability -----------------------------------------------------


def test_availability_flips_requestability_through_the_catalog(party, local_media_on):
    [made] = _register(party, ALICE, [song(SHA_A, "Night Drive", "Rex", duration_s=180.0)])
    song_id, workspace_id = made["song_id"], party.workspaces[ALICE]
    catalog = LocalMediaCatalog(party.engine)
    assert catalog.is_requestable(workspace_id, song_id) is False
    assert catalog.count_requestable(workspace_id, None) == 0

    reported = party.client.post(
        "/api/local-media/availability",
        headers=auth(ALICE),
        json={"device_id": "device-a", "present": [song_id], "absent": []},
    )
    assert reported.status_code == 200
    assert reported.json()["present"] == 1
    assert catalog.is_requestable(workspace_id, song_id) is True
    assert catalog.count_requestable(workspace_id, None) == 1
    found = catalog.search(workspace_id, "night", None, 10)
    assert [(entry.song_id, entry.title, entry.length_s) for entry in found] == [
        (song_id, "Night Drive", 180.0)
    ]
    assert catalog.describe(workspace_id, [song_id])[song_id].artist == "Rex"
    assert catalog.last_played_at(workspace_id, song_id) is None
    listed = party.client.get("/api/local-media/songs", headers=auth(ALICE)).json()["songs"]
    assert listed[0]["available_on"] == 1

    # The device reports the file gone: the song leaves the requestable list.
    party.client.post(
        "/api/local-media/availability",
        headers=auth(ALICE),
        json={"device_id": "device-a", "present": [], "absent": [song_id]},
    )
    assert catalog.is_requestable(workspace_id, song_id) is False
    assert catalog.search(workspace_id, "night", None, 10) == []


def test_a_deleted_song_is_not_requestable_even_while_reported_present(party, local_media_on):
    [made] = _register(party, ALICE, [song(SHA_A)])
    song_id, workspace_id = made["song_id"], party.workspaces[ALICE]
    party.client.post(
        "/api/local-media/availability",
        headers=auth(ALICE),
        json={"device_id": "device-a", "present": [song_id], "absent": []},
    )
    party.client.delete(f"/api/local-media/songs/{song_id}", headers=auth(ALICE))
    assert LocalMediaCatalog(party.engine).is_requestable(workspace_id, song_id) is False


def test_an_availability_report_for_someone_elses_song_is_ignored(party, local_media_on):
    [made] = _register(party, ALICE, [song(SHA_A)])
    answer = party.client.post(
        "/api/local-media/availability",
        headers=auth(BOB),
        json={"device_id": "device-b", "present": [made["song_id"]], "absent": []},
    )
    assert answer.status_code == 200
    assert answer.json() == {
        "device_id": "device-b",
        "present": 0,
        "absent": 0,
        "ignored": 1,
    }
    assert (
        LocalMediaCatalog(party.engine).is_requestable(party.workspaces[ALICE], made["song_id"])
        is False
    )


# -- workspace isolation -----------------------------------------------------------------------


def test_bob_cannot_read_or_delete_alices_songs(party, local_media_on):
    [made] = _register(party, ALICE, [song(SHA_A)])
    assert party.client.get("/api/local-media/songs", headers=auth(BOB)).json()["songs"] == []
    read = party.client.get(f"/api/local-media/songs/{made['song_id']}", headers=auth(BOB))
    assert read.status_code == 404
    assert read.json()["detail"] == {"code": "song_not_found"}
    gone = party.client.delete(f"/api/local-media/songs/{made['song_id']}", headers=auth(BOB))
    assert gone.status_code == 404
    # Alice's entry is untouched.
    assert (
        party.client.get(
            f"/api/local-media/songs/{made['song_id']}", headers=auth(ALICE)
        ).status_code
        == 200
    )


def test_the_same_hash_in_two_workspaces_is_two_entries(party, local_media_on):
    [alices] = _register(party, ALICE, [song(SHA_A)])
    [bobs] = _register(party, BOB, [song(SHA_A)])
    assert alices["song_id"] != bobs["song_id"]
    assert "duplicate_of" not in bobs


# -- the ADR-0456 read carve-out (Task A: cloud.stored_media) ----------------------------------


def test_the_stored_media_routes_moved_off_the_uploads_flag():
    owners = flags.route_owners()
    for route in STORED_MEDIA_ROUTES:
        assert owners[route] == "cloud.stored_media", route
    for route in UPLOAD_ROUTES:
        assert owners[route] == "cloud.uploads", route
    registry = flags.registry()
    assert registry["cloud.uploads"].routes == UPLOAD_ROUTES
    assert registry["cloud.uploads"].requires == ("cloud.hosted_media",)
    assert registry["cloud.stored_media"].requires == ()
    assert registry["cloud.stored_media"].default is True


def test_stored_media_reads_stay_open_while_hosted_media_is_ruled_off(party):
    """The read carve-out: revoking `cloud.hosted_media` darks the upload writes alone; listing
    and reading stored media keeps answering, so nobody's library goes dark (ADR-0456)."""
    _rules(
        party,
        "cloud.hosted_media",
        [Rule(RuleKind.USERS, {"ids": [_user_id(party, CAROL)], "on": False})],
    )
    refused = party.client.post(
        "/api/uploads/plan",
        headers=auth(CAROL),
        json={"files": [{"name": "a.wav", "size": 4}]},
    )
    assert refused.status_code == 403
    assert refused.json()["detail"]["code"] == "flag_off"
    assert refused.json()["detail"]["flag"] == "cloud.uploads"

    listing = party.client.get("/api/assets", headers=auth(CAROL))
    assert listing.status_code == 200, listing.text
    assert listing.json()["assets"] == []
    # A detail read reaches its handler (a plain 404, never a 403 flag refusal).
    detail = party.client.get("/api/assets/0123456789abcdef", headers=auth(CAROL))
    assert detail.status_code == 404
    assert detail.json()["detail"] == {"code": "asset_not_found"}
    # Accounts the rule doesn't name still upload.
    allowed = party.client.post(
        "/api/uploads/plan",
        headers=auth(ALICE),
        json={"files": [{"name": "a.wav", "size": 4}]},
    )
    assert allowed.status_code == 201, allowed.text
