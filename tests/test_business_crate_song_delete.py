"""Deleting a song through `DELETE /api/assets/{id}` takes it out of every crate (BZ-0442-06)."""

from __future__ import annotations

import sqlalchemy as sa
from cloud_world import HEADERS, add_asset, signed_up

from selecta.business import crates
from selecta.business.schema import crate_songs
from selecta.persistence import transaction


def test_a_deleted_song_leaves_every_crate_and_keeps_its_tombstone(tmp_path, monkeypatch):
    with signed_up(tmp_path, monkeypatch) as world:
        ws = world.workspace_id
        gone = add_asset(world.engine, world.objects, ws, b"RIFF-one")
        kept = add_asset(world.engine, world.objects, ws, b"RIFF-two")
        with transaction(world.engine, ws) as conn:
            first = crates.create(conn, ws, name="Brunch", now=1)["id"]
            second = crates.create(conn, ws, name="Late", now=1)["id"]
            crates.set_songs(conn, ws, first, [gone, kept])
            crates.set_songs(conn, ws, second, [gone])

        answer = world.client.delete(f"/api/assets/{gone}", headers=HEADERS)
        assert answer.status_code < 300, answer.text

        with transaction(world.engine, ws) as conn:
            assert crates.song_ids(conn, ws, first) == [kept]
            assert crates.song_ids(conn, ws, second) == []
            stones = conn.execute(sa.select(crate_songs.c.removed_at).where(
                crate_songs.c.song_id == gone)).scalars().all()
        assert len(stones) == 2 and all(stone is not None for stone in stones)
