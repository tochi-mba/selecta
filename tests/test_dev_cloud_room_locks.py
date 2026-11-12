"""Regression: a guest request must not nest a SQLite write transaction for a song lookup."""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from selecta.devstack import rooms as dev_rooms
from selecta.persistence import transaction
from selecta.rooms.errors import Refusal, RoomError
from selecta.rooms.requesting import _check_song


def test_guest_song_lookup_uses_the_existing_sqlite_transaction(cloud_engine, monkeypatch):
    """Previously this nested a second BEGIN IMMEDIATE and waited 30s for itself."""
    catalog = dev_rooms.LibraryCatalog(cloud_engine)
    # A second transaction through LibraryCatalog must never start inside _check_song.
    def forbid_new_transaction(*_args, **_kwargs):
        raise AssertionError("nested library transaction would deadlock SQLite")

    monkeypatch.setattr(dev_rooms, "transaction", forbid_new_transaction)
    ctx = SimpleNamespace(catalog=catalog)
    room = SimpleNamespace(
        workspace_id="dev-workspace",
        settings=SimpleNamespace(crate=None, replay_cooldown_minutes=0),
    )
    with transaction(cloud_engine, "dev-workspace") as conn:
        with pytest.raises(RoomError) as caught:
            _check_song(conn, ctx, room, song_id=1, now=0.0)
    assert caught.value.refusal is Refusal.NOT_REQUESTABLE


def test_guest_song_lookup_preserves_other_catalogue_implementations(cloud_engine):
    """The normal cloud and fake catalogues retain their simple check interface."""
    class FakeCatalog:
        def is_requestable(self, _workspace_id, song_id):
            return song_id == 1

    ctx = SimpleNamespace(catalog=FakeCatalog())
    room = SimpleNamespace(
        workspace_id="dev-workspace",
        settings=SimpleNamespace(crate=None, replay_cooldown_minutes=0),
    )
    with transaction(cloud_engine, "dev-workspace") as conn:
        _check_song(conn, ctx, room, song_id=1, now=0.0)
