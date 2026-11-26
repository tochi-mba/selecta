"""Rooms offer songs in the cloud library (`rooms.cloud_songs`, phase 3 of the two-places plan).

With the flag and the cloud library grant, a room also offers a song with a live upload of the
same workspace under one of its hashes (`store.cloud_copies`'s rule), because the device playing
the room plays it from there; any signed-in browser of the person can then be the speaker. Songs
kept only on another device stay out. Off, or without the grant, a room offers only the
speaker's songs, as before. Never another workspace's upload, a venue's, or a deleted one.
"""

from __future__ import annotations

import pytest
import sqlalchemy as sa
from cloud_helpers import grant_hosted_media
from cloud_party import ALICE, BOB, auth

from selecta import flags
from selecta.local_media import store
from selecta.local_media.catalog import LocalMediaCatalog, _in_cloud
from selecta.local_media.hashes_schema import local_song_hashes
from selecta.local_media.schema import local_songs
from selecta.persistence import transaction
from selecta.playback.schema import devices as playback_devices
from selecta.storage.keys import original_key
from selecta.storage.schema import assets

pytest_plugins = ("cloud_party",)

BASE = "+cloud.local_media,+devices,+devices.remote_control"


@pytest.fixture
def cloud_on():
    flags.use(f"{BASE},+rooms.cloud_songs")
    yield
    flags.use(None)


@pytest.fixture
def cloud_off():
    flags.use(BASE)
    yield
    flags.use(None)


def sha(n: int) -> str:
    return f"{n:064x}"


def _songs(party, token: str, numbers: list[int]) -> list[int]:
    made = party.client.post(
        "/api/local-media/songs",
        headers=auth(token),
        json={"songs": [
            {"content_sha256": sha(n), "title": f"Song {n}", "artist": "Rex"} for n in numbers
        ]},
    )
    assert made.status_code == 200, made.text
    return [entry["song_id"] for entry in made.json()["songs"]]


def _holds(party, token: str, device: str, present: list[int]) -> None:
    sent = party.client.post(
        "/api/local-media/availability",
        headers=auth(token),
        json={"device_id": device, "present": present, "absent": [], "snapshot": True},
    )
    assert sent.status_code == 200, sent.text


def _upload(party, token: str, asset_id: str, n: int, *, deleted: bool = False,
            venue: str | None = None) -> None:
    workspace = party.workspaces[token]
    with transaction(party.engine, workspace) as conn:
        conn.execute(assets.insert().values(
            id=asset_id, workspace_id=workspace, original_key=original_key(workspace, asset_id),
            size=100, sha256=sha(n), format="flac", created_at=10,
            deleted_at=11 if deleted else None, venue_id=venue,
        ))


def _away(party, device: str, seconds: float = 120) -> None:
    with transaction(party.engine, party.workspaces[ALICE]) as conn:
        conn.execute(
            playback_devices.update()
            .where(playback_devices.c.id == device)
            .values(last_seen_at=playback_devices.c.last_seen_at - seconds)
        )


def _offered(party, token: str = ALICE) -> list[int]:
    catalog = LocalMediaCatalog(party.engine)
    return sorted(song.song_id for song in catalog.search(party.workspaces[token], "", None, 50))


def _a_laptop_with_one_song_and_one_song_in_the_cloud(party) -> tuple[int, int]:
    on_laptop, in_cloud = _songs(party, ALICE, [1, 2])
    laptop = party.register(ALICE, "Laptop")["device"]["id"]
    _holds(party, ALICE, laptop, [on_laptop])
    _upload(party, ALICE, "up-2", 2)
    return on_laptop, in_cloud


def test_with_the_flag_and_the_grant_a_song_in_the_cloud_library_is_offered(party, cloud_on):
    grant_hosted_media(party.engine, party.app)
    on_laptop, in_cloud = _a_laptop_with_one_song_and_one_song_in_the_cloud(party)
    catalog = LocalMediaCatalog(party.engine)
    workspace = party.workspaces[ALICE]
    assert _offered(party) == [on_laptop, in_cloud]
    assert catalog.is_requestable(workspace, in_cloud)
    assert catalog.count_requestable(workspace, None) == 2
    assert catalog.count_requestable(workspace, frozenset({in_cloud})) == 1


def test_off_by_default_only_the_speakers_songs_are_offered(party, cloud_off):
    grant_hosted_media(party.engine, party.app)
    on_laptop, in_cloud = _a_laptop_with_one_song_and_one_song_in_the_cloud(party)
    assert _offered(party) == [on_laptop]
    assert not LocalMediaCatalog(party.engine).is_requestable(party.workspaces[ALICE], in_cloud)


def test_without_the_grant_nothing_new_is_offered(party, cloud_on):
    on_laptop, in_cloud = _a_laptop_with_one_song_and_one_song_in_the_cloud(party)
    assert _offered(party) == [on_laptop]
    assert not LocalMediaCatalog(party.engine).is_requestable(party.workspaces[ALICE], in_cloud)


def test_a_phone_with_no_music_of_its_own_can_play_the_room(party, cloud_on):
    grant_hosted_media(party.engine, party.app)
    (in_cloud,) = _songs(party, ALICE, [3])
    party.register(ALICE, "Phone")
    _upload(party, ALICE, "up-3", 3)
    catalog = LocalMediaCatalog(party.engine)
    workspace = party.workspaces[ALICE]
    assert catalog.music_state(workspace) == "ready"
    assert _offered(party) == [in_cloud]
    assert catalog.songs_waiting_for_a_speaker(workspace, None) == 0
    # off: a phone with no music of its own is no speaker, as before
    flags.use(f"{BASE}")
    assert catalog.music_state(workspace) == "none"
    assert _offered(party) == []


def test_songs_only_on_another_device_stay_out(party, cloud_on):
    grant_hosted_media(party.engine, party.app)
    on_laptop, in_cloud, on_phone = _songs(party, ALICE, [4, 5, 6])
    laptop = party.register(ALICE, "Laptop")["device"]["id"]
    phone = party.register(ALICE, "Phone")["device"]["id"]
    _holds(party, ALICE, laptop, [on_laptop])
    _holds(party, ALICE, phone, [on_phone])
    _upload(party, ALICE, "up-5", 5)
    took = party.client.post(
        "/api/playback/take-over", headers=auth(ALICE), json={"device_id": laptop}
    )
    assert took.status_code == 200, took.text
    assert _offered(party) == [on_laptop, in_cloud]
    assert not LocalMediaCatalog(party.engine).is_requestable(party.workspaces[ALICE], on_phone)


def test_with_no_device_open_nothing_is_offered(party, cloud_on):
    grant_hosted_media(party.engine, party.app)
    (in_cloud,) = _songs(party, ALICE, [7])
    phone = party.register(ALICE, "Phone")["device"]["id"]
    _upload(party, ALICE, "up-7", 7)
    _away(party, phone)
    catalog = LocalMediaCatalog(party.engine)
    workspace = party.workspaces[ALICE]
    assert catalog.music_state(workspace) == "none"
    assert _offered(party) == [] and not catalog.is_requestable(workspace, in_cloud)
    assert catalog.songs_waiting_for_a_speaker(workspace, None) == 1


def test_never_another_workspaces_a_venues_or_a_deleted_upload(party, cloud_on):
    grant_hosted_media(party.engine, party.app)
    theirs, venues, gone = _songs(party, ALICE, [8, 9, 10])
    party.register(ALICE, "Phone")
    # Bob uploaded the same bytes as Alice's song: still not Alice's copy
    _upload(party, BOB, "bob-8", 8)
    _upload(party, ALICE, "venue-9", 9, venue="venue-1")
    _upload(party, ALICE, "gone-10", 10, deleted=True)
    catalog = LocalMediaCatalog(party.engine)
    assert _offered(party) == []
    for song in (theirs, venues, gone):
        assert not catalog.is_requestable(party.workspaces[ALICE], song)
    # Bob's room offers nothing of Alice's either: his upload has no song in his catalogue
    party.register(BOB, "Bob phone")
    assert _offered(party, BOB) == []


def test_an_upload_under_an_older_hash_of_the_song_counts(party, cloud_on):
    grant_hosted_media(party.engine, party.app)
    (song,) = _songs(party, ALICE, [11])
    party.register(ALICE, "Phone")
    workspace = party.workspaces[ALICE]
    with transaction(party.engine, workspace) as conn:
        conn.execute(local_song_hashes.insert().values(
            workspace_id=workspace, content_sha256=sha(111), song_id=song, created_at=1,
        ))
    _upload(party, ALICE, "up-retagged", 111)
    assert _offered(party) == [song]


def test_the_rooms_test_is_the_same_rule_as_cloud_copies(party, cloud_on):
    """`_in_cloud` and `store.cloud_copies` agree on every case above, so a room and the
    Library never disagree about which songs are in the cloud library."""
    own, older, theirs, venues, gone, none = _songs(party, ALICE, [12, 13, 14, 15, 16, 17])
    workspace = party.workspaces[ALICE]
    with transaction(party.engine, workspace) as conn:
        conn.execute(local_song_hashes.insert().values(
            workspace_id=workspace, content_sha256=sha(130), song_id=older, created_at=1,
        ))
    _upload(party, ALICE, "c-12", 12)
    _upload(party, ALICE, "c-130", 130)
    _upload(party, BOB, "c-14", 14)
    _upload(party, ALICE, "c-15", 15, venue="venue-1")
    _upload(party, ALICE, "c-16", 16, deleted=True)
    ids = [own, older, theirs, venues, gone, none]
    with transaction(party.engine, workspace) as conn:
        member = local_songs.alias("member")
        tested = set(conn.execute(
            sa.select(member.c.id).where(member.c.workspace_id == workspace, member.c.id.in_(ids))
            .where(_in_cloud(member))
        ).scalars())
        copies = set(store.cloud_copies(conn, workspace, ids))
    assert tested == copies == {own, older}
