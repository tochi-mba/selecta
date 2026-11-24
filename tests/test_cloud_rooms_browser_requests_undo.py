"""Undo straight after Add next puts a room request back to waiting (rooms.browser_requests).

Adding a guest's song to the mix reports it `played`, so the guest's page says so. Undo took
the song back out of the mix but left the request played: the guest was told a song played
that never did, and the host could no longer add it."""

# ruff: noqa: F811 -- imported pytest fixtures are intentionally requested by test arguments.

from __future__ import annotations

from cloud_party import ALICE, BOB, auth
from test_cloud_rooms_browser_requests import (  # noqa: F401
    WAITING,
    ask,
    join,
    my_request,
    party,
    waiting,
)


def test_a_played_request_goes_back_to_waiting_and_the_guest_sees_it_accepted(party):
    party.speaker_on(ALICE)
    opened = party.open_room(ALICE)
    room_id = opened["room"]["id"]
    guest = join(party, opened["code"])
    asked = ask(guest, room_id, 1)
    party.client.post(f"{WAITING}/{asked}/played", headers=auth(ALICE))
    assert my_request(guest, room_id, asked)["status"] == "played"
    assert waiting(party) == []

    back = party.client.post(f"{WAITING}/{asked}/waiting", headers=auth(ALICE))

    assert back.status_code == 200, back.text
    assert [entry["id"] for entry in back.json()["requests"]] == [asked]
    assert my_request(guest, room_id, asked)["status"] == "accepted"
    again = party.client.post(f"{WAITING}/{asked}/waiting", headers=auth(ALICE))
    assert again.status_code == 200, "saying it twice is harmless"
    assert [entry["id"] for entry in again.json()["requests"]] == [asked]


def test_a_request_the_host_let_go_is_not_brought_back(party):
    party.speaker_on(ALICE)
    opened = party.open_room(ALICE)
    room_id = opened["room"]["id"]
    guest = join(party, opened["code"])
    asked = ask(guest, room_id, 1)
    party.client.post(f"{WAITING}/{asked}/dismiss", headers=auth(ALICE))

    back = party.client.post(f"{WAITING}/{asked}/waiting", headers=auth(ALICE))

    assert back.status_code == 200 and back.json()["requests"] == []
    assert my_request(guest, room_id, asked)["status"] == "passed"


def test_another_workspace_cannot_bring_a_request_back(party):
    party.speaker_on(ALICE)
    opened = party.open_room(ALICE)
    guest = join(party, opened["code"])
    asked = ask(guest, opened["room"]["id"], 1)
    party.client.post(f"{WAITING}/{asked}/played", headers=auth(ALICE))

    refused = party.client.post(f"{WAITING}/{asked}/waiting", headers=auth(BOB))

    assert refused.status_code == 404
    assert my_request(guest, opened["room"]["id"], asked)["status"] == "played"
