"""'Never play' for browser-first Cloud: one account-wide flag per catalogue song.

The Library's batch action ("Never play" / "Allow in mixes") and its row toggle write it; the mix
SelectaDJ builds leaves those songs out. A change is all or none: a song that is gone, or that
changed on another screen since it was shown, refuses the whole batch and changes nothing.
"""

from __future__ import annotations

import pytest
from cloud_party import ALICE, BOB, auth

from selecta import flags

pytest_plugins = ("cloud_party",)

ROUTE = "/api/local-media/songs/never"


@pytest.fixture
def local_media_on():
    flags.use("+cloud.local_media")
    yield
    flags.use(None)


def _songs(party, token: str, count: int) -> list[int]:
    body = {
        "songs": [
            {"content_sha256": f"{index:064x}", "title": f"Song {index}", "artist": "Rex"}
            for index in range(1, count + 1)
        ]
    }
    answer = party.client.post("/api/local-media/songs", headers=auth(token), json=body)
    assert answer.status_code == 200, answer.text
    return [made["song_id"] for made in answer.json()["songs"]]


def _never_flags(party, token: str) -> dict[int, bool]:
    listed = party.client.get("/api/local-media/songs?limit=100", headers=auth(token))
    assert listed.status_code == 200, listed.text
    return {song["id"]: song["never"] for song in listed.json()["songs"]}


def _set(party, token: str, never: bool, entries: list[tuple[int, bool]]):
    return party.client.post(
        ROUTE,
        headers=auth(token),
        json={"never": never, "entries": [{"id": i, "expected": e} for i, e in entries]},
    )


def test_a_new_song_can_play_and_the_list_says_so(party, local_media_on):
    ids = _songs(party, ALICE, 2)
    assert _never_flags(party, ALICE) == {ids[0]: False, ids[1]: False}


def test_never_play_then_allow_round_trip_reports_only_what_changed(party, local_media_on):
    one, two, three = _songs(party, ALICE, 3)
    answer = _set(party, ALICE, True, [(one, False), (two, False)])
    assert answer.status_code == 200, answer.text
    assert answer.json() == {"never": True, "changed": [one, two]}
    assert _never_flags(party, ALICE) == {one: True, two: True, three: False}

    # already set: accepted, nothing listed as changed
    again = _set(party, ALICE, True, [(one, True)])
    assert again.json() == {"never": True, "changed": []}

    back = _set(party, ALICE, False, [(one, True), (two, True)])
    assert back.json() == {"never": False, "changed": [one, two]}
    assert _never_flags(party, ALICE) == {one: False, two: False, three: False}


def test_a_song_changed_elsewhere_refuses_the_whole_batch(party, local_media_on):
    one, two = _songs(party, ALICE, 2)
    assert _set(party, ALICE, True, [(two, False)]).status_code == 200
    # this page still shows song two as playable
    stale = _set(party, ALICE, True, [(one, False), (two, False)])
    assert stale.status_code == 409
    assert stale.json()["detail"]["code"] == "library_changed"
    assert stale.json()["detail"]["ids"] == [two]
    # nothing changed: song one is still playable
    assert _never_flags(party, ALICE)[one] is False


def test_a_song_that_is_gone_refuses_the_whole_batch(party, local_media_on):
    one, two = _songs(party, ALICE, 2)
    assert party.client.delete(f"/api/local-media/songs/{two}", headers=auth(ALICE)).status_code
    gone = _set(party, ALICE, True, [(one, False), (two, False)])
    assert gone.status_code == 404
    assert gone.json()["detail"]["code"] == "song_not_found"
    assert gone.json()["detail"]["ids"] == [two]
    assert _never_flags(party, ALICE) == {one: False}


def test_another_account_cannot_touch_my_songs(party, local_media_on):
    [mine] = _songs(party, ALICE, 1)
    refused = _set(party, BOB, True, [(mine, False)])
    assert refused.status_code == 404
    assert _never_flags(party, ALICE) == {mine: False}


def test_a_batch_names_each_song_once_and_has_a_limit(party, local_media_on):
    [one] = _songs(party, ALICE, 1)
    assert _set(party, ALICE, True, [(one, False), (one, False)]).status_code == 422
    assert _set(party, ALICE, True, []).status_code == 422
    too_many = [(index, False) for index in range(1, 202)]
    assert _set(party, ALICE, True, too_many).status_code == 422
