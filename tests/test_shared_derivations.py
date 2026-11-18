"""Shared machine derivations by fingerprint (ADR-0469).

A workspace reads a shared row only for bytes it holds as a live, server-hashed asset; a
client-claimed hash grants nothing; refusal looks like absence; only verified machine data is
written; erasing the last holder drops what was derived from the bytes; the flag off shares
nothing.
"""

from __future__ import annotations

import pytest
import sqlalchemy as sa

from selecta import flags
from selecta.local_media.schema import local_songs
from selecta.persistence import transaction
from selecta.storage import shared_derivations as shared
from selecta.storage.deletion import mark_physical_done, tombstone
from selecta.storage.keys import original_key
from selecta.storage.schema import assets

SHA = "a" * 64
OTHER_SHA = "b" * 64
T0 = 1_800_000_000.0
GRID = {"bpm": 124.0, "beats": [0.1, 0.58, 1.06]}


@pytest.fixture(autouse=True)
def dedupe_on():
    flags.use("+cloud.hosted_dedupe")
    yield
    flags.use(None)


def add_asset(conn, workspace: str, asset_id: str, sha: str = SHA) -> None:
    conn.execute(
        sa.insert(assets).values(
            id=asset_id,
            workspace_id=workspace,
            original_key=original_key(workspace, asset_id),
            size=100,
            sha256=sha,
            format="mp3",
            created_at=T0,
        )
    )


def write(conn, **overrides):
    values = {
        "workspace_id": "ws-a",
        "asset_id": "asset-a",
        "sha256": SHA,
        "kind": "beat_grid",
        "analysis_version": "1",
        "payload": GRID,
        "source": "server",
    }
    values.update(overrides)
    return shared.write_shared(conn, **values)


@pytest.fixture
def held(cloud_engine):
    with transaction(cloud_engine) as conn:
        add_asset(conn, "ws-a", "asset-a")
        add_asset(conn, "ws-b", "asset-b")
        write(conn)
    return cloud_engine


def read(engine, workspace: str, sha: str = SHA):
    with transaction(engine, workspace) as conn:
        return shared.read_shared(conn, workspace, sha, "beat_grid", "1")


def test_a_workspace_holding_the_same_bytes_reuses_the_derivation(held):
    assert read(held, "ws-b") == GRID


def test_a_client_claimed_hash_grants_no_read(held):
    with transaction(held, "ws-c") as conn:
        conn.execute(
            sa.insert(local_songs).values(
                workspace_id="ws-c",
                content_sha256=SHA,
                title="Claimed",
                artist="X",
                created_at=T0,
                updated_at=T0,
            )
        )
    assert read(held, "ws-c") is None


def test_refused_and_absent_look_the_same(held):
    # no possession, or no row: both None, so the table is no oracle for who holds a file
    assert read(held, "ws-c") is None
    assert read(held, "ws-c", OTHER_SHA) is None
    assert read(held, "ws-a", OTHER_SHA) is None


def test_a_deleted_asset_is_no_longer_possession(held):
    with transaction(held, "ws-b") as conn:
        tombstone(conn, "ws-b", "song", "asset-b")
    assert read(held, "ws-b") is None


@pytest.mark.parametrize("source", ["client", "browser", ""])
def test_only_server_computed_or_verified_results_are_written(held, source):
    with transaction(held) as conn, pytest.raises(shared.NotShareable):
        write(conn, kind="waveform", payload={"peaks": [1, 2]}, source=source)


def test_a_write_needs_bytes_the_server_holds_in_that_workspace(held):
    with transaction(held) as conn:
        with pytest.raises(shared.NotShareable):
            write(conn, workspace_id="ws-c", kind="waveform", source="verified")
        with pytest.raises(shared.NotShareable):
            write(conn, sha256=OTHER_SHA, kind="waveform", source="verified")


@pytest.mark.parametrize(
    "payload",
    [
        {"title": "Mine"},
        {"bpm": 120, "meta": {"Artist": "Me"}},
        {"rating": 5},
        {"x": [{"note": "n"}]},
    ],
)
def test_user_entered_or_usage_data_never_joins(held, payload):
    with transaction(held) as conn, pytest.raises(shared.NotShareable):
        write(conn, kind="analysis", payload=payload)


def test_the_flag_off_shares_nothing(held):
    flags.use("-cloud.hosted_dedupe")
    assert read(held, "ws-b") is None
    with transaction(held) as conn:
        assert not write(conn, kind="waveform", payload={"peaks": [1]})


def test_the_reference_count_follows_live_assets(held):
    with transaction(held) as conn:
        assert shared.content_references(conn, SHA) == 2
    with transaction(held, "ws-a") as conn:
        tombstone(conn, "ws-a", "song", "asset-a")
    with transaction(held) as conn:
        assert shared.content_references(conn, SHA) == 1
        assert not shared.last_reference_gone(conn, SHA)


def test_erasing_the_last_holder_drops_the_shared_rows(held):
    rows = sa.select(sa.func.count()).select_from(shared.shared_derivations)
    with transaction(held, "ws-a") as conn:
        first = tombstone(conn, "ws-a", "song", "asset-a").deletion
    with transaction(held) as conn:
        mark_physical_done(conn, first.id)
        assert conn.execute(rows).scalar_one() == 1  # ws-b still holds the bytes
    with transaction(held, "ws-b") as conn:
        last = tombstone(conn, "ws-b", "account", "ws-b").deletion
    with transaction(held) as conn:
        mark_physical_done(conn, last.id)
        assert conn.execute(rows).scalar_one() == 0
