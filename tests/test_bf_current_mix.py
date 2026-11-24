"""The account's current mix (ADR-0475 R8): one per workspace, set by compare-and-set, cleared
when the mix is deleted, published as `mix.current`, and kept apart per workspace."""

from __future__ import annotations

import pytest
import sqlalchemy as sa
from cloud_party import ALICE, BOB, auth

from selecta import flags
from selecta.persistence import transaction
from selecta.work.schema import outbox_events

pytest_plugins = ("cloud_party",)


@pytest.fixture
def local_media_on():
    flags.use("+cloud.local_media")
    yield
    flags.use(None)


def _mix(party, token: str, name: str = "Friday") -> str:
    made = party.client.post(
        "/api/local-media/songs",
        headers=auth(token),
        json={"songs": [
            {"content_sha256": f"{index + 1:x}" * 64, "title": f"Song {index}", "artist": "Rex"}
            for index in range(2)
        ]},
    )
    assert made.status_code == 200, made.text
    ids = [entry["song_id"] for entry in made.json()["songs"]]
    answer = party.client.post(
        "/api/local-media/recipes", headers=auth(token), json={"name": name, "song_ids": ids}
    )
    assert answer.status_code == 200, answer.text
    return answer.json()["mix"]["mix_id"]


def _choose(party, token: str, mix_id: str | None, expected: str | None, device=None):
    body = {"mix_id": mix_id, "expected_mix_id": expected}
    if device:
        body["device_id"] = device
    return party.client.put("/api/local-media/current", headers=auth(token), json=body)


def _current(party, token: str) -> dict:
    answer = party.client.get("/api/local-media/current", headers=auth(token))
    assert answer.status_code == 200, answer.text
    return answer.json()


def test_set_and_read_names_the_device_that_chose(party, local_media_on):
    assert _current(party, ALICE)["mix_id"] is None
    mix = _mix(party, ALICE)
    phone = party.register(ALICE, "Phone")["device"]["id"]
    chosen = _choose(party, ALICE, mix, None, phone)
    assert chosen.status_code == 200, chosen.text
    now = _current(party, ALICE)
    assert now["mix_id"] == mix and now["updated_by_device_name"] == "Phone"
    assert now["revision"] == 1
    # choosing it again changes nothing
    assert _choose(party, ALICE, mix, None).json()["revision"] == 1


def test_two_devices_choosing_at_once_never_overwrite_each_other(party, local_media_on):
    first, second = _mix(party, ALICE, "One"), _mix(party, ALICE, "Two")
    assert _choose(party, ALICE, first, None).status_code == 200
    # the second device last saw no current mix: refused, with the mix that stands
    late = _choose(party, ALICE, second, None)
    assert late.status_code == 409
    detail = late.json()["detail"]
    assert detail["code"] == "current_mix_changed" and detail["current"]["mix_id"] == first
    # having seen it, the second device may choose
    assert _choose(party, ALICE, second, first).status_code == 200
    assert _current(party, ALICE)["mix_id"] == second
    # null clears it
    assert _choose(party, ALICE, None, second).status_code == 200
    assert _current(party, ALICE)["mix_id"] is None


def test_another_workspace_cannot_read_or_set_it(party, local_media_on):
    mine = _mix(party, ALICE)
    assert _choose(party, ALICE, mine, None).status_code == 200
    assert _current(party, BOB)["mix_id"] is None
    # Bob naming Alice's mix: not in his account
    assert _choose(party, BOB, mine, None).status_code == 404
    assert _current(party, ALICE)["mix_id"] == mine


def test_deleting_the_current_mix_clears_it_and_every_change_is_published(party, local_media_on):
    mix = _mix(party, ALICE)
    assert _choose(party, ALICE, mix, None).status_code == 200
    gone = party.client.delete(f"/api/local-media/recipes/{mix}", headers=auth(ALICE))
    assert gone.status_code == 204, gone.text
    assert _current(party, ALICE)["mix_id"] is None
    workspace = party.workspaces[ALICE]
    with transaction(party.engine, workspace) as conn:
        told = conn.execute(
            sa.select(outbox_events.c.payload)
            .where(outbox_events.c.topic == "mix.current")
            .where(outbox_events.c.workspace_id == workspace)
            .order_by(outbox_events.c.id)
        ).scalars().all()
    assert [event["mix_id"] for event in told] == [mix, None]


def test_the_flag_off_turns_both_routes_off(party):
    flags.use("-cloud.local_media")
    try:
        assert party.client.get("/api/local-media/current", headers=auth(ALICE)).status_code == 403
        assert _choose(party, ALICE, None, None).status_code == 403
    finally:
        flags.use(None)
