"""Copying songs from a person's own library into their organisation (ADR-0453 BZ-0453-06).

Copy, never move: the personal asset stays as it was; the organisation gets its own asset under
its own storage key, named the same, with the person as uploader and the bytes on the
organisation's quota. Songs the organisation already holds (same content) are skipped, and ids
that are not the person's songs copy nothing.
"""

from __future__ import annotations

import sqlalchemy as sa

from selecta.business import library_copy, orgs
from selecta.identity.schema import users, workspace_members, workspaces
from selecta.persistence import new_id, transaction
from selecta.storage.keys import original_key
from selecta.storage.schema import assets, upload_sessions


class _Objects:
    def __init__(self):
        self.copies = []

    def copy_object(self, src_bucket, src_key, dst_bucket, dst_key, **_):
        self.copies.append((src_key, dst_key))
        return "etag"


def _personal_song(conn, ws: str, sha: str, name: str) -> str:
    asset_id = new_id()
    conn.execute(upload_sessions.insert().values(
        id=asset_id, workspace_id=ws, display_name=name, declared_size=1000,
        content_type="audio/mpeg", sha256=sha, part_size=8 * 1024 * 1024,
        staging_key=f"s/{asset_id}", status="accepted", created_at=1, updated_at=1,
        expires_at=1))
    conn.execute(assets.insert().values(
        id=asset_id, workspace_id=ws, original_key=original_key(ws, asset_id), size=1000,
        sha256=sha, format="mp3", duration_s=180.0, sample_rate=44100, channels=2,
        created_at=1))
    return asset_id


def test_songs_are_copied_never_moved(sqlite_engine, clock):
    personal = new_id()
    with transaction(sqlite_engine) as conn:
        conn.execute(users.insert().values(
            id="sam", auth_subject="auth|sam", email_verified=True, timezone="UTC",
            age_confirmed=True, created_at=0.0))
        conn.execute(workspaces.insert().values(
            id=personal, name="Sam", kind="personal", owner_user_id="sam", created_at=1))
        conn.execute(workspace_members.insert().values(
            workspace_id=personal, user_id="sam", role="owner", created_at=1))
        org = orgs.create(conn, owner_user_id="sam", name="Harbour Cafe", now=1)["id"]
    with transaction(sqlite_engine, personal) as conn:
        first = _personal_song(conn, personal, "1" * 64, "Harbour Lights")
        second = _personal_song(conn, personal, "2" * 64, "Slow Tide")
    objects = _Objects()
    result = library_copy.copy_songs(
        sqlite_engine, org_id=org, personal_id=personal, user_id="sam",
        song_ids=[first, second, "not-mine"], client=objects, originals="sel-originals")
    assert (result["copied"], result["skipped"], result["missing"]) == (2, 0, 1)
    again = library_copy.copy_songs(
        sqlite_engine, org_id=org, personal_id=personal, user_id="sam", song_ids=[first],
        client=objects, originals="sel-originals")
    assert (again["copied"], again["skipped"]) == (0, 1)
    with transaction(sqlite_engine, personal) as conn:
        assert conn.execute(sa.select(sa.func.count()).select_from(assets).where(
            assets.c.workspace_id == personal, assets.c.deleted_at.is_(None))).scalar() == 2
    with transaction(sqlite_engine, org) as conn:
        copied = conn.execute(sa.select(assets.c.id, assets.c.original_key, assets.c.uploaded_by)
                              .where(assets.c.workspace_id == org)).all()
        names = set(conn.execute(sa.select(upload_sessions.c.display_name).where(
            upload_sessions.c.workspace_id == org)).scalars())
    assert len(copied) == 2 and all(row.uploaded_by == "sam" for row in copied)
    assert all(row.original_key.startswith(f"w/{org}/") for row in copied)
    assert names == {"Harbour Lights", "Slow Tide"}
    assert [src for src, _ in objects.copies] == [
        original_key(personal, first), original_key(personal, second)]
