"""The deletions ledger and physical purge (ADR-0412, spec 5.5, test plan 18.15).

A tombstone hides the item at once and returns its bytes; physical deletion is due 30 days later;
backups clear by 60; replay after a restore re-applies every deletion; and a race between two
deletes is settled by the unique (workspace, kind, ref) row.
"""

from __future__ import annotations

import threading

import pytest
import sqlalchemy as sa
from sqlalchemy.exc import IntegrityError
from test_cloud_storage_fakes import FakeS3

from selecta.persistence import transaction
from selecta.storage import deletion as ledger
from selecta.storage.deletion import (
    RECOVERY_WINDOW_S,
    Deletion,
    DeletionKind,
    due_backup,
    due_physical,
    is_deleted,
    mark_backup_done,
    mark_physical_done,
    physical_targets,
    read_ledger,
    replay_after_restore,
    tombstone,
)
from selecta.storage.keys import (
    Bucket,
    derived_key,
    export_key,
    original_key,
    workspace_prefix,
)
from selecta.storage.maintenance import DELETE_BATCH_SIZE, drain_physical_deletions
from selecta.storage.objects import R2Error
from selecta.storage.schema import assets, deletion_mirror_outbox, deletions, upload_sessions

WS = "ws-a"
OTHER = "ws-b"
DAY = 24 * 3600
T0 = 1_800_000_000.0


class Released:
    """A `StorageReleasePort` that records what it was asked to give back."""

    def __init__(self) -> None:
        self.calls: list[tuple[str, int, str]] = []

    def release_committed(self, conn, workspace_id: str, size: int, ref: str) -> None:
        self.calls.append((workspace_id, size, ref))


def add_asset(conn, workspace: str, asset_id: str, size: int) -> None:
    conn.execute(
        sa.insert(assets).values(
            id=asset_id,
            workspace_id=workspace,
            original_key=original_key(workspace, asset_id),
            size=size,
            sha256="a" * 64,
            format="mp3",
            created_at=T0,
        )
    )


def add_session(conn, workspace: str, session_id: str) -> None:
    conn.execute(
        sa.insert(upload_sessions).values(
            id=session_id,
            workspace_id=workspace,
            display_name="Private Name.mp3",
            declared_size=10,
            content_type="audio/mpeg",
            part_size=8 * 1024 * 1024,
            staging_key=f"s/{session_id}/object",
            status="accepted",
            created_at=T0,
            updated_at=T0,
            expires_at=T0 + 2 * DAY,
        )
    )


@pytest.fixture
def library(cloud_engine):
    with transaction(cloud_engine) as conn:
        add_asset(conn, WS, "song-1", 100)
        add_asset(conn, WS, "song-2", 250)
        add_asset(conn, OTHER, "song-9", 999)
        for session_id, workspace in (("song-1", WS), ("song-2", WS), ("song-9", OTHER)):
            add_session(conn, workspace, session_id)
    return cloud_engine


def hidden(engine, asset_id: str) -> bool:
    with transaction(engine) as conn:
        value = conn.execute(sa.select(assets.c.deleted_at).where(assets.c.id == asset_id))
        return value.scalar_one() is not None


def count(engine, table) -> int:
    with transaction(engine) as conn:
        return conn.execute(sa.select(sa.func.count()).select_from(table)).scalar_one()


def delete(engine, kind, ref, workspace: str = WS, **kwargs):
    with transaction(engine, workspace) as conn:
        return tombstone(conn, workspace, kind, ref, **kwargs)


# -- tombstones -------------------------------------------------------------------------------


def test_a_tombstone_hides_the_song_at_once_and_returns_its_bytes(library):
    released = Released()
    result = delete(library, DeletionKind.SONG, "song-1", quota=released)
    assert result.created and result.bytes_to_release == 100
    assert hidden(library, "song-1") and not hidden(library, "song-2")
    record = result.deletion
    assert released.calls == [(WS, 100, f"deletion:{record.id}")]
    assert record.bytes_released == 100
    assert record.physical_after - record.requested_at == RECOVERY_WINDOW_S == 30 * DAY
    with transaction(library) as conn:
        assert is_deleted(conn, WS, "song", "song-1")
        assert not is_deleted(conn, WS, "song", "song-2")
        row = conn.execute(sa.select(assets).where(assets.c.id == "song-1")).mappings().one()
    assert row["deleted_at"] == record.requested_at
    assert row["physical_delete_after"] == record.physical_after
    assert count(library, deletion_mirror_outbox) == 1


def test_deleting_twice_returns_the_first_tombstone_and_releases_nothing(library):
    released = Released()
    first = delete(library, "song", "song-1", quota=released)
    second = delete(library, "song", "song-1", quota=released)
    assert not second.created and second.bytes_to_release == 0
    assert second.deletion == first.deletion
    assert len(released.calls) == 1
    assert count(library, deletions) == 1
    assert count(library, deletion_mirror_outbox) == 1


def test_a_tombstone_without_a_quota_port_still_says_what_to_release(library):
    assert delete(library, "song", "song-2").bytes_to_release == 250


def test_deleting_an_account_hides_every_asset_in_that_workspace_only(library):
    released = Released()
    result = delete(library, DeletionKind.ACCOUNT, WS, quota=released)
    assert result.bytes_to_release == 350
    assert hidden(library, "song-1") and hidden(library, "song-2")
    assert not hidden(library, "song-9")
    with transaction(library) as conn:
        assert is_deleted(conn, WS, "song", "never-existed")
        assert is_deleted(conn, WS, "export", "x1")
        assert not is_deleted(conn, OTHER, "song", "song-9")


def test_an_account_deletions_ref_is_its_own_workspace(library):
    with pytest.raises(ValueError, match="workspace id"):
        delete(library, "account", OTHER)


def test_deleting_an_export_releases_the_size_its_owner_gives(library):
    released = Released()
    result = delete(library, "export", "export-1", size=4096, quota=released)
    assert result.bytes_to_release == 4096
    assert not hidden(library, "song-1")
    assert released.calls[0][1] == 4096
    for bad in (None, -1):
        with pytest.raises(ValueError, match="size in bytes"):
            delete(library, "export", "export-2", size=bad)


def test_an_empty_export_releases_nothing(library):
    released = Released()
    assert delete(library, "export", "export-0", size=0, quota=released).bytes_to_release == 0
    assert released.calls == []


def test_a_song_must_exist_in_the_deleting_workspace(library):
    with pytest.raises(LookupError):
        delete(library, "song", "no-such-song")
    with pytest.raises(LookupError):
        delete(library, "song", "song-9")
    assert not hidden(library, "song-9")


def test_an_unknown_kind_is_refused(library):
    with pytest.raises(ValueError):
        delete(library, "playlist", "p1")


def test_a_song_already_hidden_releases_nothing_more(library):
    with transaction(library) as conn:
        conn.execute(sa.update(assets).where(assets.c.id == "song-1").values(deleted_at=T0))
    assert delete(library, "song", "song-1").bytes_to_release == 0


# -- races ------------------------------------------------------------------------------------


def test_a_racing_tombstone_loses_to_the_unique_row_and_releases_nothing(library, monkeypatch):
    first = delete(library, "song", "song-1")
    real_find = ledger._find
    calls = []

    def find_after_the_other_committed(conn, workspace_id, kind, ref):
        calls.append(ref)
        # The first look happens before the other transaction committed: it sees nothing.
        return None if len(calls) == 1 else real_find(conn, workspace_id, kind, ref)

    monkeypatch.setattr(ledger, "_find", find_after_the_other_committed)
    released = Released()
    loser = delete(library, "song", "song-1", quota=released)
    assert not loser.created and loser.bytes_to_release == 0
    assert loser.deletion.id == first.deletion.id
    assert released.calls == []
    assert count(library, deletions) == 1


def test_an_integrity_error_with_no_winning_row_is_raised(library, monkeypatch):
    delete(library, "song", "song-1")
    monkeypatch.setattr(ledger, "_find", lambda *args: None)
    with pytest.raises(IntegrityError):
        delete(library, "song", "song-1")


def test_two_connections_deleting_one_song_make_one_tombstone(postgres_engine):
    """PostgreSQL only: real row locks on the unique index decide the race."""
    with transaction(postgres_engine) as conn:
        add_asset(conn, WS, "song-1", 100)
    barrier = threading.Barrier(2)
    results, errors = [], []

    def worker():
        try:
            with transaction(postgres_engine, WS) as conn:
                barrier.wait(timeout=10)
                results.append(tombstone(conn, WS, "song", "song-1"))
        except Exception as exc:  # pragma: no cover - reported below
            errors.append(exc)

    threads = [threading.Thread(target=worker) for _ in range(2)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    assert errors == []
    assert sorted(result.created for result in results) == [False, True]
    assert sum(result.bytes_to_release for result in results) == 100
    assert count(postgres_engine, deletions) == 1


# -- physical deletion and backups ------------------------------------------------------------


def test_physical_deletion_is_due_30_days_after_the_tombstone(library):
    record = delete(library, "song", "song-1").deletion
    with transaction(library) as conn:
        assert due_physical(conn, now=record.requested_at + 30 * DAY - 1) == []
        due = due_physical(conn, now=record.requested_at + 30 * DAY)
    assert [item.id for item in due] == [record.id]


def test_due_physical_follows_database_time(library, clock):
    record = delete(library, "song", "song-1").deletion
    if record.requested_at != clock.now:
        pytest.skip("only SQLite follows the clock fixture")
    clock.advance(30 * DAY - 1)
    with transaction(library) as conn:
        assert due_physical(conn) == []
    clock.advance(1)
    with transaction(library) as conn:
        assert [item.id for item in due_physical(conn)] == [record.id]


def test_due_deletions_come_oldest_first_in_bounded_batches(library):
    first = delete(library, "song", "song-1").deletion
    second = delete(library, "song", "song-2").deletion
    third = delete(library, "song", "song-9", workspace=OTHER).deletion
    later = max(first.physical_after, second.physical_after, third.physical_after) + 1
    with transaction(library) as conn:
        assert len(due_physical(conn, now=later, limit=2)) == 2
        due = due_physical(conn, now=later)
    assert [d.physical_after for d in due] == sorted(d.physical_after for d in due)
    assert len(due) == 3


def test_marking_a_song_erased_drops_its_upload_session_and_queues_a_mirror_event(library):
    record = delete(library, "song", "song-1").deletion
    with transaction(library) as conn:
        assert mark_physical_done(conn, record.id)
        assert not mark_physical_done(conn, record.id)
        sessions = conn.execute(sa.select(upload_sessions.c.id)).scalars().all()
        assert due_physical(conn, now=record.physical_after + DAY) == []
    assert sorted(sessions) == ["song-2", "song-9"]
    assert count(library, deletion_mirror_outbox) == 2


def test_marking_an_account_erased_drops_every_upload_session_it_had(library):
    record = delete(library, "account", WS).deletion
    with transaction(library) as conn:
        mark_physical_done(conn, record.id)
        sessions = conn.execute(sa.select(upload_sessions.c.id)).scalars().all()
    assert sessions == ["song-9"]


def test_marking_an_export_erased_keeps_upload_sessions(library):
    record = delete(library, "export", "export-1", size=1).deletion
    with transaction(library) as conn:
        mark_physical_done(conn, record.id)
    assert count(library, upload_sessions) == 3


def test_marking_an_unknown_deletion_is_an_error(library):
    with transaction(library) as conn:
        with pytest.raises(LookupError):
            mark_physical_done(conn, "no-such-deletion")
        assert not mark_backup_done(conn, "no-such-deletion")


def test_backups_clear_by_60_days(library):
    record = delete(library, "song", "song-1").deletion
    with transaction(library) as conn:
        assert due_backup(conn) == []
        mark_physical_done(conn, record.id)
        waiting = due_backup(conn)
        assert [item.id for item in waiting] == [record.id]
        assert mark_backup_done(conn, record.id)
        assert not mark_backup_done(conn, record.id)
        assert due_backup(conn) == []
    done = read_ledger_one(library)
    assert done.physical_done_at is not None and done.backup_done_at is not None
    # The backup copy goes within one more recovery window after the live objects, so by 60
    # days at the latest; nothing in the ledger lets a backup outlive that.
    assert done.physical_after + RECOVERY_WINDOW_S == done.requested_at + 60 * DAY
    assert count(library, deletion_mirror_outbox) == 3


def read_ledger_one(engine) -> Deletion:
    with transaction(engine) as conn:
        (only,) = read_ledger(conn)
    return only


def test_due_backups_come_in_bounded_batches(library):
    with transaction(library) as conn:
        for asset_id in ("song-1", "song-2"):
            record = tombstone(conn, WS, "song", asset_id).deletion
            mark_physical_done(conn, record.id)
        assert len(due_backup(conn, limit=1)) == 1


def test_physical_targets_are_built_from_ids_alone():
    song = Deletion("d1", WS, DeletionKind.SONG, "song-1", 1, T0, T0 + 1)
    export = Deletion("d2", WS, DeletionKind.EXPORT, "export-1", 1, T0, T0 + 1)
    account = Deletion("d3", WS, DeletionKind.ACCOUNT, WS, 1, T0, T0 + 1)
    assert physical_targets(song).keys == {Bucket.ORIGINALS: [original_key(WS, "song-1")]}
    assert physical_targets(song).prefixes == {}
    assert physical_targets(export).keys == {Bucket.EXPORTS: [export_key(WS, "export-1")]}
    prefixes = physical_targets(account).prefixes
    assert set(prefixes) == {Bucket.ORIGINALS, Bucket.DERIVED, Bucket.EXPORTS}
    assert all(value == [workspace_prefix(WS)] for value in prefixes.values())


# -- the ledger and replay after a restore ----------------------------------------------------


def test_the_ledger_reads_oldest_first_and_since_a_time(library):
    first = delete(library, "song", "song-1").deletion
    second = delete(library, "export", "e1", size=5).deletion
    with transaction(library) as conn:
        everything = read_ledger(conn)
        latest = max(first.requested_at, second.requested_at)
        assert [row.id for row in read_ledger(conn, since=latest)] == [
            row.id for row in everything if row.requested_at >= latest
        ]
        assert read_ledger(conn, since=latest + 1) == []
    assert {row.id for row in everything} == {first.id, second.id}
    order = [(row.requested_at, row.id) for row in everything]
    assert order == sorted(order)
    assert everything[0].as_dict()["kind"] in {"song", "export"}


def _restore(engine) -> None:
    """Put the database back as a backup from before the deletions would have it."""
    with transaction(engine) as conn:
        conn.execute(sa.delete(deletions))
        conn.execute(sa.update(assets).values(deleted_at=None, physical_delete_after=None))


def test_replay_after_restore_re_applies_every_deletion(library):
    delete(library, "song", "song-1")
    delete(library, "account", OTHER, workspace=OTHER)
    delete(library, "export", "export-1", size=64)
    with transaction(library) as conn:
        copy = read_ledger(conn)
    _restore(library)
    assert not hidden(library, "song-1") and not hidden(library, "song-9")

    released = Released()
    with transaction(library) as conn:
        report = replay_after_restore(conn, copy, quota=released)
    assert (report.seen, report.inserted, report.merged) == (3, 3, 0)
    assert report.assets_hidden == 2
    assert report.bytes_released == 100 + 999 + 64
    assert sorted(size for _, size, _ in released.calls) == [64, 100, 999]
    assert {ref for _, _, ref in released.calls} == {f"deletion:{row.id}" for row in copy}
    assert hidden(library, "song-1") and hidden(library, "song-9")
    assert not hidden(library, "song-2")
    with transaction(library) as conn:
        assert {row.id for row in read_ledger(conn)} == {row.id for row in copy}


def test_replaying_twice_changes_nothing_more(library):
    delete(library, "song", "song-1")
    with transaction(library) as conn:
        copy = [row.as_dict() for row in read_ledger(conn)]
    _restore(library)
    with transaction(library) as conn:
        replay_after_restore(conn, copy)
    released = Released()
    with transaction(library) as conn:
        again = replay_after_restore(conn, copy, quota=released)
    assert (again.inserted, again.merged, again.assets_hidden, again.bytes_released) == (0, 1, 0, 0)
    assert released.calls == []
    assert count(library, deletions) == 1


def test_replay_keeps_the_later_completion_times(library):
    record = delete(library, "song", "song-1").deletion
    with transaction(library) as conn:
        mark_physical_done(conn, record.id)
        restored = read_ledger(conn)[0]
    offsite = Deletion(**{**record.__dict__, "physical_done_at": None,
                          "backup_done_at": T0 + 90 * DAY})
    with transaction(library) as conn:
        replay_after_restore(conn, [offsite])
        merged = read_ledger(conn)[0]
    assert merged.physical_done_at == restored.physical_done_at
    assert merged.backup_done_at == T0 + 90 * DAY


def test_replay_matches_a_restored_row_by_its_target_when_the_id_differs(library):
    present = delete(library, "song", "song-1").deletion
    offsite = Deletion("other-id", WS, DeletionKind.SONG, "song-1", 100, T0, T0 + 30 * DAY,
                       physical_done_at=T0 + 31 * DAY)
    with transaction(library) as conn:
        report = replay_after_restore(conn, [offsite])
        rows = read_ledger(conn)
    assert (report.inserted, report.merged) == (0, 1)
    assert [row.id for row in rows] == [present.id]
    assert rows[0].physical_done_at == T0 + 31 * DAY


def test_replay_of_an_empty_ledger_reports_nothing(library):
    with transaction(library) as conn:
        report = replay_after_restore(conn, [])
    assert report == ledger.ReplayReport(0, 0, 0, 0, 0)


# -- physical purge (maintenance) -------------------------------------------------------------


def _due_now(engine) -> None:
    with transaction(engine) as conn:
        conn.execute(sa.update(deletions).values(physical_after=0.0))


def test_purge_erases_due_songs_and_marks_them_done(library):
    fake = FakeS3()
    for asset in ("song-1", "song-2"):
        fake.put_size("sel-originals", original_key(WS, asset), 10)
    delete(library, "song", "song-1")
    delete(library, "song", "song-2")
    with transaction(library) as conn:
        conn.execute(sa.update(deletions).where(deletions.c.ref == "song-1")
                     .values(physical_after=0.0))
    report = drain_physical_deletions(library, fake)
    assert (report.examined, report.completed, report.failed, report.objects_deleted) == (
        1, 1, 0, 1
    )
    assert ("sel-originals", original_key(WS, "song-1")) not in fake.objects
    assert ("sel-originals", original_key(WS, "song-2")) in fake.objects
    with transaction(library) as conn:
        done = {row.ref: row.physical_done_at for row in read_ledger(conn)}
    assert done["song-1"] is not None and done["song-2"] is None


def test_purging_an_account_erases_its_prefixes_in_batches_and_spares_others(library):
    fake = FakeS3()
    hash_ = "e" * 64
    for n in range(DELETE_BATCH_SIZE + 5):
        fake.put_size("sel-derived", derived_key(WS, "features", hash_, f"t{n}", "f.npz"), 1)
    fake.put_size("sel-originals", original_key(WS, "song-1"), 1)
    fake.put_size("sel-exports", export_key(WS, "x1"), 1)
    fake.put_size("sel-originals", original_key(OTHER, "song-9"), 1)
    fake.put_size("sel-originals", original_key(WS + "x", "song-1"), 1)
    delete(library, "account", WS)
    _due_now(library)
    report = drain_physical_deletions(library, fake)
    assert report.completed == 1 and report.objects_deleted == DELETE_BATCH_SIZE + 7
    assert sorted(key for (_, key) in fake.objects) == sorted(
        [original_key(OTHER, "song-9"), original_key(WS + "x", "song-1")]
    )
    assert fake.count("delete_objects") >= 3


def test_purging_many_exact_keys_flushes_full_batches(library, monkeypatch):
    from selecta.storage import maintenance

    fake = FakeS3()
    monkeypatch.setattr(maintenance, "DELETE_BATCH_SIZE", 1)
    for asset in ("song-1", "song-2"):
        fake.put_size("sel-originals", original_key(WS, asset), 10)
    delete(library, "export", "export-1", size=1)
    delete(library, "song", "song-1")
    _due_now(library)
    report = drain_physical_deletions(library, fake)
    assert report.completed == 2
    assert ("sel-originals", original_key(WS, "song-1")) not in fake.objects


def test_a_purge_that_r2_refuses_is_retried_later_not_marked(library):
    fake = FakeS3()
    key = original_key(WS, "song-1")
    fake.put_size("sel-originals", key, 10)
    fake.forbidden_delete_keys.add(key)
    delete(library, "song", "song-1")
    _due_now(library)
    report = drain_physical_deletions(library, fake)
    assert (report.completed, report.failed) == (0, 1)
    fake.forbidden_delete_keys.clear()
    assert drain_physical_deletions(library, fake).completed == 1
    assert drain_physical_deletions(library, fake).examined == 0


def test_a_purge_interrupted_by_an_r2_outage_is_not_marked(library):
    fake = FakeS3()
    fake.fail_next("delete_objects", R2Error("down", status=503))
    delete(library, "song", "song-1")
    _due_now(library)
    assert drain_physical_deletions(library, fake).failed == 1
    with transaction(library) as conn:
        assert read_ledger(conn)[0].physical_done_at is None


def test_a_faulty_listing_can_never_widen_an_account_purge(library):
    class Faulty(FakeS3):
        def list_objects_v2(self, bucket, prefix="", *, page_size=1000):
            yield from super().list_objects_v2(bucket, "", page_size=page_size)

    fake = Faulty()
    fake.put_size("sel-originals", original_key(OTHER, "song-9"), 1)
    fake.put_size("sel-originals", original_key(WS, "song-1"), 1)
    delete(library, "account", WS)
    _due_now(library)
    report = drain_physical_deletions(library, fake)
    assert (report.completed, report.failed) == (0, 1)
    assert ("sel-originals", original_key(OTHER, "song-9")) in fake.objects


@pytest.mark.parametrize("limit", [0, 1001])
def test_purge_batches_are_1_to_1000(library, limit):
    with pytest.raises(ValueError, match="1 to 1000"):
        drain_physical_deletions(library, FakeS3(), limit=limit)
