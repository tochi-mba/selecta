"""ADR-0475: the default speaker, and rooms that offer only the speaker's songs.

The person marks one of their devices as the default speaker; it is listed with the devices and
the holdings, cleared when that device signs out, and refused for a device that is not theirs.
A browser-first room offers its guests only the songs held by the device that makes the sound,
chosen by the revised R1 (the session's speaker, else the default when online with music, else
the only online device with music, else nobody until the person chooses).
"""

from __future__ import annotations

import pytest
from cloud_party import ALICE, BOB, auth

from selecta import flags
from selecta.local_media.catalog import LocalMediaCatalog
from selecta.persistence import transaction
from selecta.playback.schema import devices as playback_devices

pytest_plugins = ("cloud_party",)


@pytest.fixture
def on():
    flags.use("+cloud.local_media,+devices,+devices.remote_control")
    yield
    flags.use(None)


def _songs(party, token: str, count: int) -> list[int]:
    made = party.client.post(
        "/api/local-media/songs",
        headers=auth(token),
        json={"songs": [
            {"content_sha256": f"{index + 1:x}" * 64, "title": f"Song {index}", "artist": "Rex"}
            for index in range(count)
        ]},
    )
    assert made.status_code == 200, made.text
    return [entry["song_id"] for entry in made.json()["songs"]]


def _holds(party, device: str, present: list[int]) -> None:
    sent = party.client.post(
        "/api/local-media/availability",
        headers=auth(ALICE),
        json={"device_id": device, "present": present, "absent": [], "snapshot": True},
    )
    assert sent.status_code == 200, sent.text


def _default(party, token: str, device_id: str | None):
    return party.client.put(
        "/api/devices/default-speaker", headers=auth(token), json={"device_id": device_id}
    )


def _away(party, device: str, seconds: float = 120) -> None:
    with transaction(party.engine, party.workspaces[ALICE]) as conn:
        conn.execute(
            playback_devices.update()
            .where(playback_devices.c.id == device)
            .values(last_seen_at=playback_devices.c.last_seen_at - seconds)
        )


def test_the_default_is_listed_cleared_on_sign_out_and_only_ever_my_own_device(party, on):
    laptop = party.register(ALICE, "Laptop")["device"]["id"]
    theirs = party.register(BOB, "Bob phone")["device"]["id"]
    assert _default(party, ALICE, laptop).json() == {"default_speaker_id": laptop}
    listed = party.client.get("/api/devices", headers=auth(ALICE)).json()
    assert listed["default_speaker_id"] == laptop
    held = party.client.get("/api/local-media/holdings", headers=auth(ALICE)).json()
    assert held["default_speaker_id"] == laptop
    # another person's device, or one that is not signed in here, is not this account's
    assert _default(party, ALICE, theirs).status_code == 404
    assert _default(party, ALICE, "missing").status_code == 404
    # signed out: no longer the default
    signed_out = party.client.post(f"/api/devices/{laptop}/sign-out", headers=auth(ALICE))
    assert signed_out.status_code == 200
    listed = party.client.get("/api/devices", headers=auth(ALICE)).json()
    assert listed["default_speaker_id"] is None
    # null clears it
    phone = party.register(ALICE, "Phone")["device"]["id"]
    assert _default(party, ALICE, phone).status_code == 200
    assert _default(party, ALICE, None).json() == {"default_speaker_id": None}


def test_the_default_needs_remote_control(party):
    flags.use("+cloud.local_media,+devices,-devices.remote_control")
    try:
        laptop = party.register(ALICE, "Laptop")["device"]["id"]
        assert _default(party, ALICE, laptop).status_code == 403
    finally:
        flags.use(None)


def test_a_room_offers_only_the_speakers_songs_by_the_revised_rule(party, on):
    one, two, three = _songs(party, ALICE, 3)
    laptop = party.register(ALICE, "Laptop")["device"]["id"]
    phone = party.register(ALICE, "Phone")["device"]["id"]
    _holds(party, laptop, [one, two])
    _holds(party, phone, [three])
    catalog = LocalMediaCatalog(party.engine)
    workspace = party.workspaces[ALICE]
    offered = lambda: sorted(song.song_id for song in catalog.search(workspace, "", None, 20))  # noqa: E731

    # two devices with music online and no default: the host chooses, nothing is offered yet
    assert catalog.music_state(workspace) == "choosing"
    assert offered() == [] and not catalog.is_requestable(workspace, one)
    # the default, online with music: its songs and no others
    assert _default(party, ALICE, phone).status_code == 200
    assert catalog.music_state(workspace) == "ready"
    assert offered() == [three] and catalog.count_requestable(workspace, None) == 1
    assert not catalog.is_requestable(workspace, one)
    # the default not open: the only other online device with music plays
    _away(party, phone)
    assert offered() == [one, two]
    # no device with music open: nothing
    _away(party, laptop)
    assert catalog.music_state(workspace) == "none" and offered() == []


def test_the_sessions_speaker_comes_first_and_a_lapsed_one_is_reconnecting(party, on):
    one, two = _songs(party, ALICE, 2)
    laptop = party.register(ALICE, "Laptop")["device"]["id"]
    phone = party.register(ALICE, "Phone")["device"]["id"]
    _holds(party, laptop, [one])
    _holds(party, phone, [two])
    assert _default(party, ALICE, phone).status_code == 200
    took = party.client.post(
        "/api/playback/take-over", headers=auth(ALICE), json={"device_id": laptop}
    )
    assert took.status_code == 200, took.text
    catalog = LocalMediaCatalog(party.engine)
    workspace = party.workspaces[ALICE]
    # the laptop plays: its songs, not the default's
    assert [song.song_id for song in catalog.search(workspace, "", None, 20)] == [one]
    # its lease lapsed a moment ago: reconnecting, nothing offered in its place
    from selecta.playback.schema import playback_sessions

    with transaction(party.engine, workspace) as conn:
        conn.execute(
            playback_sessions.update()
            .where(playback_sessions.c.workspace_id == workspace)
            .values(lease_expires_at=playback_sessions.c.lease_expires_at - 60)
        )
    assert catalog.music_state(workspace) == "reconnecting"
    assert catalog.search(workspace, "", None, 20) == []
