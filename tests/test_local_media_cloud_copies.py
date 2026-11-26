"""A song's copy in the cloud library (`store.cloud_copies`, plan phase 0).

A cloud copy is a live upload of the same workspace whose file hash is one of the song's: its
own `content_sha256` or a hash recorded for it in `local_song_hashes` (a re-tagged file). There is
no new song identity. Deleted uploads, venue uploads and another workspace's upload of the same
bytes never count; two kept copies of one song are one entry with their bytes summed. The answer
for a whole catalogue page is one indexed query, never one per song.
"""

from __future__ import annotations

import time

import pytest

from selecta.identity.schema import users, workspaces
from selecta.local_media import store
from selecta.local_media.hashes_schema import local_song_hashes
from selecta.local_media.schema import local_songs
from selecta.persistence import transaction
from selecta.storage.keys import original_key
from selecta.storage.schema import assets

ME = "ws-me"
THEM = "ws-them"


def sha(n: int) -> str:
    return f"{n:064x}"


def _account(conn, workspace: str, user: str) -> None:
    conn.execute(users.insert().values(
        id=user, auth_subject=f"auth-{user}", email_verified=True, timezone="UTC",
        age_confirmed=True, created_at=1,
    ))
    conn.execute(workspaces.insert().values(
        id=workspace, name="Name", kind="personal", owner_user_id=user, created_at=1,
    ))


def _song(conn, workspace: str, n: int) -> int:
    return int(conn.execute(local_songs.insert().values(
        workspace_id=workspace, content_sha256=sha(n), title=f"Song {n}", artist="Artist",
        created_at=1, updated_at=1,
    ).returning(local_songs.c.id)).scalar_one())


def _asset(conn, workspace: str, asset_id: str, n: int, *, size: int = 100, fmt: str = "flac",
           created_at: float = 10, deleted: bool = False, venue: str | None = None) -> None:
    conn.execute(assets.insert().values(
        id=asset_id, workspace_id=workspace, original_key=original_key(workspace, asset_id),
        size=size, sha256=sha(n), format=fmt, created_at=created_at,
        deleted_at=created_at + 1 if deleted else None, venue_id=venue,
    ))


@pytest.fixture
def engine(cloud_engine):
    with transaction(cloud_engine) as conn:
        _account(conn, ME, "user-me")
        _account(conn, THEM, "user-them")
    return cloud_engine


def test_an_upload_of_the_songs_own_file_is_its_cloud_copy(engine):
    with transaction(engine) as conn:
        song = _song(conn, ME, 1)
        lonely = _song(conn, ME, 2)
        _asset(conn, ME, "asset-1", 1, size=4_000, fmt="mp3")
        found = store.cloud_copies(conn, ME, [song, lonely])
    assert found == {song: {"asset_id": "asset-1", "bytes": 4_000, "format": "mp3", "copies": 1}}


def test_an_upload_under_an_older_hash_of_the_song_counts(engine):
    with transaction(engine) as conn:
        song = _song(conn, ME, 1)
        conn.execute(local_song_hashes.insert().values(
            workspace_id=ME, content_sha256=sha(99), song_id=song, created_at=1,
        ))
        _asset(conn, ME, "asset-retagged", 99, size=500)
        found = store.cloud_copies(conn, ME, [song])
    assert found[song]["asset_id"] == "asset-retagged"
    assert found[song]["bytes"] == 500


def test_a_deleted_upload_is_no_cloud_copy(engine):
    with transaction(engine) as conn:
        song = _song(conn, ME, 1)
        _asset(conn, ME, "asset-gone", 1, deleted=True)
        assert store.cloud_copies(conn, ME, [song]) == {}


def test_two_kept_copies_are_one_entry_with_their_bytes_summed(engine):
    with transaction(engine) as conn:
        song = _song(conn, ME, 1)
        conn.execute(local_song_hashes.insert().values(
            workspace_id=ME, content_sha256=sha(77), song_id=song, created_at=1,
        ))
        # the oldest upload names the copy; a second copy of the same bytes, and one under the
        # song's other hash, add to its size
        _asset(conn, ME, "asset-b", 1, size=300, created_at=20)
        _asset(conn, ME, "asset-a", 1, size=200, created_at=10, fmt="wav")
        _asset(conn, ME, "asset-c", 77, size=50, created_at=30)
        found = store.cloud_copies(conn, ME, [song])
    assert found == {song: {"asset_id": "asset-a", "bytes": 550, "format": "wav", "copies": 3}}


def test_another_workspaces_upload_of_the_same_bytes_never_counts(engine):
    with transaction(engine) as conn:
        mine = _song(conn, ME, 1)
        theirs = _song(conn, THEM, 1)
        _asset(conn, THEM, "asset-theirs", 1)
        assert store.cloud_copies(conn, ME, [mine]) == {}
        # nor does asking with their song's id from my workspace
        assert store.cloud_copies(conn, ME, [theirs]) == {}
        assert store.cloud_copies(conn, THEM, [theirs])[theirs]["asset_id"] == "asset-theirs"


def test_a_venue_upload_never_counts(engine):
    with transaction(engine) as conn:
        song = _song(conn, ME, 1)
        _asset(conn, ME, "asset-venue", 1, venue="venue-1")
        assert store.cloud_copies(conn, ME, [song]) == {}


def test_no_ids_asks_nothing(engine):
    with transaction(engine) as conn:
        assert store.cloud_copies(conn, ME, []) == {}


def test_ten_thousand_songs_answer_quickly(engine):
    count = 10_000
    with transaction(engine) as conn:
        conn.execute(local_songs.insert(), [
            {"workspace_id": ME, "content_sha256": sha(n), "title": f"Song {n}", "artist": "A",
             "created_at": 1, "updated_at": 1}
            for n in range(1, count + 1)
        ])
        # every other song has a cloud copy
        conn.execute(assets.insert(), [
            {"id": f"asset-{n}", "workspace_id": ME, "original_key": original_key(ME, f"asset-{n}"),
             "size": 100, "sha256": sha(n), "format": "mp3", "created_at": 10}
            for n in range(1, count + 1, 2)
        ])
        ids = list(conn.execute(
            local_songs.select().with_only_columns(local_songs.c.id)
            .where(local_songs.c.workspace_id == ME)
        ).scalars())
        started = time.perf_counter()
        found = store.cloud_copies(conn, ME, ids)
        took = time.perf_counter() - started
    assert len(found) == count // 2
    # ten pages of a thousand ids; one query per song would take far longer than this
    assert took < 5, f"cloud_copies took {took:.2f} s for {count} songs"
