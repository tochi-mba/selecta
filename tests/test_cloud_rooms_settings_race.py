"""Two room settings changes sent close together both land (the page saves each as it is made).

The settings route used to read the room, merge the change in, and write the whole result back
with nothing held between the read and the write, so a change that landed in between was
overwritten by the settings the route had read before it."""

# ruff: noqa: F811 -- imported pytest fixtures are intentionally requested by test arguments.

from __future__ import annotations

from cloud_party import ALICE, auth, party  # noqa: F401

from selecta.rooms.service import Rooms


def test_a_change_that_lands_during_another_is_not_overwritten(party, monkeypatch):
    room_id = party.open_room(ALICE)["room"]["id"]
    read = Rooms.host_view
    state = {"raced": False}

    def host_view(self, workspace_id, room, **kwargs):
        seen = read(self, workspace_id, room, **kwargs)
        if not state["raced"]:
            # another press of the host's lands just after this read of the room
            state["raced"] = True
            self.update_settings(workspace_id, room, {"names_shown": True}, partial=True)
        return seen

    monkeypatch.setattr(Rooms, "host_view", host_view)
    changed = party.client.patch(
        f"/api/rooms/{room_id}/settings", headers=auth(ALICE), json={"pending_per_guest": 2}
    )
    assert changed.status_code == 200, changed.text

    settings = party.client.get(f"/api/rooms/{room_id}", headers=auth(ALICE)).json()
    settings = settings["room"]["settings"]
    assert settings["pending_per_guest"] == 2
    assert settings["names_shown"] is True


def test_a_setting_that_is_not_allowed_is_still_refused(party):
    room_id = party.open_room(ALICE)["room"]["id"]
    refused = party.client.patch(
        f"/api/rooms/{room_id}/settings", headers=auth(ALICE), json={"join_mode": "everyone"}
    )
    assert refused.status_code == 422, refused.text
    assert refused.json()["detail"]["code"] == "invalid_settings"
