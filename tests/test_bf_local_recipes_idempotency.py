"""A mix made offline is sent when the connection comes back. If the answer to that create is
lost, the queue sends it again: with the same `Idempotency-Key` the server gives back the mix the
first send made, never a second copy (web/src/cloud/outbox.ts sends the local mix id as the key).
"""

from __future__ import annotations

from cloud_party import ALICE, BOB, auth

pytest_plugins = ("cloud_party",)


def _songs(party, token: str) -> list[int]:
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
                for index in range(3)
            ]
        },
    )
    assert answer.status_code == 200, answer.text
    return [entry["song_id"] for entry in answer.json()["songs"]]


def _make(party, token: str, song_ids: list[int], key: str | None, name: str = "Friday"):
    headers = auth(token) | ({"Idempotency-Key": key} if key else {})
    answer = party.client.post(
        "/api/local-media/recipes", headers=headers, json={"name": name, "song_ids": song_ids}
    )
    assert answer.status_code == 200, answer.text
    return answer.json()["mix"]


def _listed(party, token: str) -> list[str]:
    recipes = party.client.get("/api/local-media/recipes", headers=auth(token)).json()["recipes"]
    return [entry["mix_id"] for entry in recipes]


def test_a_create_sent_twice_with_one_key_makes_one_mix(party):
    ids = _songs(party, ALICE)
    first = _make(party, ALICE, ids, "local-mix-1")
    again = _make(party, ALICE, ids, "local-mix-1")
    assert again["mix_id"] == first["mix_id"]
    assert again["revision"] == first["revision"]
    assert _listed(party, ALICE) == [first["mix_id"]]


def test_the_repeat_gets_the_first_mix_even_after_it_was_edited(party):
    ids = _songs(party, ALICE)
    first = _make(party, ALICE, ids, "local-mix-2")
    edited = party.client.post(
        f"/api/local-media/recipes/{first['mix_id']}/revisions",
        headers=auth(ALICE),
        json={"base_revision": first["revision"], "song_ids": ids[:2]},
    )
    assert edited.status_code == 200, edited.text
    again = _make(party, ALICE, ids, "local-mix-2")
    assert (again["mix_id"], again["number"]) == (first["mix_id"], 1)
    assert _listed(party, ALICE) == [first["mix_id"]]


def test_other_keys_no_key_and_other_workspaces_each_make_their_own(party):
    ids = _songs(party, ALICE)
    one = _make(party, ALICE, ids, "local-mix-3")
    two = _make(party, ALICE, ids, "local-mix-4")
    plain = [_make(party, ALICE, ids, None), _make(party, ALICE, ids, None)]
    assert len({one["mix_id"], two["mix_id"], *(mix["mix_id"] for mix in plain)}) == 4
    # Bob's key is his own: the same words never reach Alice's mix
    bobs = _make(party, BOB, _songs(party, BOB), "local-mix-3")
    assert bobs["mix_id"] != one["mix_id"]
    assert one["mix_id"] not in _listed(party, BOB)
