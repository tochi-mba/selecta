"""HTTP coverage for the Rooms host, guest, moderation and display routes (ADR-0416)."""

# ruff: noqa: F811 -- imported pytest fixtures are intentionally requested by test arguments.

from __future__ import annotations

from cloud_party import ALICE, BOB, ORIGIN, auth, party  # noqa: F401


def join(party, code: str):
    client = party.guest_client()
    answer = client.post("/api/guest/join", json={"code": code})
    assert answer.status_code == 201, answer.text
    return client, answer.json()


def test_host_lifecycle_settings_and_workspace_isolation(party):
    assert party.client.get("/api/rooms/current", headers=auth(ALICE)).json() == {"room": None}

    opened = party.open_room(ALICE, request_mode="approve")
    room_id = opened["room"]["id"]
    original_code = opened["code"]
    assert opened["join_path"] == "/r/" + original_code.replace("-", "")
    assert opened["room"]["settings"]["request_mode"] == "approve"

    hidden = party.client.get(f"/api/rooms/{room_id}", headers=auth(BOB))
    missing = party.client.get(f"/api/rooms/{'0' * 32}", headers=auth(BOB))
    assert (hidden.status_code, hidden.json()) == (missing.status_code, missing.json())

    changed = party.client.patch(
        f"/api/rooms/{room_id}/settings",
        headers=auth(ALICE),
        json={"names_shown": True, "pending_per_guest": 2},
    )
    assert changed.status_code == 200, changed.text
    assert changed.json()["room"]["settings"]["names_shown"] is True
    assert changed.json()["room"]["settings"]["pending_per_guest"] == 2

    locked = party.client.post(f"/api/rooms/{room_id}/lock", headers=auth(ALICE))
    assert locked.status_code == 200 and locked.json()["room"]["status"] == "locked"
    unlocked = party.client.post(f"/api/rooms/{room_id}/unlock", headers=auth(ALICE))
    assert unlocked.status_code == 200 and unlocked.json()["room"]["status"] == "open"

    rotated = party.client.post(
        f"/api/rooms/{room_id}/code",
        headers=auth(ALICE),
        json={"remove_everyone": False},
    )
    assert rotated.status_code == 200, rotated.text
    assert rotated.json()["code"] != original_code

    ended = party.client.post(f"/api/rooms/{room_id}/end", headers=auth(ALICE))
    assert ended.status_code == 200 and ended.json()["room"]["status"] == "ended"
    assert ended.json()["code"] is None and ended.json()["join_path"] is None
    assert party.client.get("/api/rooms/current", headers=auth(ALICE)).json() == {"room": None}


def test_guest_search_request_vote_withdraw_nickname_and_leave(party):
    opened = party.open_room(ALICE, pending_per_guest=2, names_shown=True)
    room_id, code = opened["room"]["id"], opened["code"]
    first, first_join = join(party, code)
    second, _ = join(party, code)

    view = first.get(f"/api/guest/rooms/{room_id}")
    assert view.status_code == 200 and view.json()["guest_status"] == "active"
    assert view.json()["room_name"] == "Garden party"

    found = first.get(f"/api/guest/rooms/{room_id}/search", params={"q": "song 5"})
    assert found.status_code == 200 and found.json()["songs"][0]["song_id"] == 5

    asked = first.post(f"/api/guest/rooms/{room_id}/requests", json={"song_id": 5})
    assert asked.status_code == 201, asked.text
    request_id = asked.json()["request_id"]
    assert asked.json()["status"] == "accepted"

    voted = second.post(f"/api/guest/rooms/{room_id}/requests/{request_id}/vote")
    assert voted.status_code == 200, voted.text
    item = next(item for item in voted.json()["coming_up"] if item["request_id"] == request_id)
    assert item["votes"] == 2 and item["voted"] is True
    unvoted = second.delete(f"/api/guest/rooms/{room_id}/requests/{request_id}/vote")
    item = next(item for item in unvoted.json()["coming_up"] if item["request_id"] == request_id)
    assert item["votes"] == 1 and item["voted"] is False

    choices = first.get(f"/api/guest/rooms/{room_id}/nicknames")
    nickname = choices.json()["nicknames"][0]
    renamed = first.put(f"/api/guest/rooms/{room_id}/nickname", json={"nickname": nickname})
    assert renamed.status_code == 200 and renamed.json()["nickname"] == nickname

    withdrawn = first.delete(f"/api/guest/rooms/{room_id}/requests/{request_id}")
    assert withdrawn.status_code == 200
    mine = next(
        item for item in withdrawn.json()["my_requests"] if item["request_id"] == request_id
    )
    assert mine["status"] == "withdrawn"

    left = first.post(f"/api/guest/rooms/{room_id}/leave")
    assert left.status_code == 200 and left.json() == {"left": True}
    refused = first.get(f"/api/guest/rooms/{room_id}")
    assert refused.status_code == 401 and refused.json()["detail"]["code"] == "not_a_guest"
    assert first_join["nickname"]


def test_host_moderates_pending_guests_and_requests(party):
    opened = party.open_room(ALICE, join_mode="approve", request_mode="approve")
    room_id, code = opened["room"]["id"], opened["code"]
    guest, joined = join(party, code)
    guest_id = opened_guest_id = party.client.get(
        f"/api/rooms/{room_id}", headers=auth(ALICE)
    ).json()["guests"][0]["id"]
    assert joined["guest_status"] == "pending"

    pending = guest.get(f"/api/guest/rooms/{room_id}")
    assert pending.status_code == 200 and pending.json()["guest_status"] == "pending"
    refused = guest.post(f"/api/guest/rooms/{room_id}/requests", json={"song_id": 8})
    assert refused.status_code == 403
    assert refused.json()["detail"]["code"] == "awaiting_approval"
    approved = party.client.post(
        f"/api/rooms/{room_id}/guests/{guest_id}/approve", headers=auth(ALICE)
    )
    assert approved.status_code == 200

    asked = guest.post(f"/api/guest/rooms/{room_id}/requests", json={"song_id": 8})
    assert asked.status_code == 201 and asked.json()["status"] == "sent"
    request_id = asked.json()["request_id"]
    decided = party.client.post(
        f"/api/rooms/{room_id}/requests/{request_id}/approve", headers=auth(ALICE)
    )
    assert decided.status_code == 200
    assert decided.json()["coming_up"][0]["status"] == "accepted"
    passed = party.client.post(
        f"/api/rooms/{room_id}/requests/{request_id}/pass", headers=auth(ALICE)
    )
    assert passed.status_code == 200 and passed.json()["coming_up"] == []

    banned = party.client.post(
        f"/api/rooms/{room_id}/guests/{opened_guest_id}/ban", headers=auth(ALICE)
    )
    assert banned.status_code == 200
    refused = guest.get(f"/api/guest/rooms/{room_id}")
    assert refused.status_code == 403 and refused.json()["detail"]["code"] == "banned"


def test_display_pairs_reads_and_is_ended_by_the_host(party):
    opened = party.open_room(ALICE)
    room_id = opened["room"]["id"]
    display = party.guest_client()

    started = display.post("/api/display/pairings")
    assert started.status_code == 201, started.text
    waiting = display.get("/api/display/view")
    assert waiting.status_code == 200 and waiting.json()["state"] == "waiting"

    paired = party.client.post(
        f"/api/rooms/{room_id}/displays",
        headers=auth(ALICE),
        json={"pairing_code": started.json()["pairing_code"]},
    )
    assert paired.status_code == 200, paired.text
    assert paired.json()["displays"] == 1
    shown = display.get("/api/display/view")
    assert shown.status_code == 200 and shown.json()["state"] == "paired"
    assert shown.json()["room_name"] == "Garden party"
    assert shown.json()["join_path"] == opened["join_path"]

    unpaired = party.client.delete(f"/api/rooms/{room_id}/displays", headers=auth(ALICE))
    assert unpaired.status_code == 200 and unpaired.json()["displays"] == 0
    ended = display.get("/api/display/view")
    assert ended.status_code == 200 and ended.json()["state"] == "ended"


def test_cookie_authenticated_writes_reject_a_cross_site_origin(party):
    opened = party.open_room(ALICE)
    room_id, code = opened["room"]["id"], opened["code"]
    guest, _ = join(party, code)
    answer = guest.post(
        f"/api/guest/rooms/{room_id}/requests",
        headers={"Origin": "https://attacker.example"},
        json={"song_id": 3},
    )
    assert answer.status_code == 403
    assert answer.json()["detail"]["code"] == "origin_not_allowed"
    assert ORIGIN != "https://attacker.example"
