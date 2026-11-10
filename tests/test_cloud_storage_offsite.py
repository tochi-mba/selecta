"""The offsite tombstone mirror (ADR-0412, spec 5.5 and 12.4, test plan 18.15).

Tombstones are copied out of the database through a transactional outbox, read back with every
copy checked, and replayed after a restore so a backup can never bring deleted music back.
"""

from __future__ import annotations

import hashlib
import json

import pytest
import sqlalchemy as sa
from test_cloud_storage_fakes import FakeS3

from selecta.persistence import transaction
from selecta.storage.deletion import mark_backup_done, mark_physical_done, tombstone
from selecta.storage.keys import original_key
from selecta.storage.objects import PutResult, R2Error
from selecta.storage.offsite_ledger import (
    MAX_EVENT_BYTES,
    PREFIX,
    TombstoneLedgerError,
    _canonical,
    _validated,
    drain_deletion_mirror,
    read_storage_tombstone_ledger,
    replay_storage_tombstones_after_restore,
)
from selecta.storage.schema import assets, deletion_mirror_outbox, deletions
from selecta.usage import quota

WS = "ws-a"
OTHER = "ws-b"
BUCKET = "sel-tombstones"
T0 = 1_800_000_000.0
DAY = 24 * 3600


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


@pytest.fixture
def library(cloud_engine):
    with transaction(cloud_engine) as conn:
        add_asset(conn, WS, "song-1", 100)
        add_asset(conn, WS, "song-2", 200)
        add_asset(conn, OTHER, "song-9", 900)
    return cloud_engine


def event(**changes) -> dict:
    value = {
        "id": "del-1",
        "workspace_id": WS,
        "kind": "song",
        "ref": "song-1",
        "bytes_released": 100,
        "requested_at": T0,
        "physical_after": T0 + 30 * DAY,
        "physical_done_at": None,
        "backup_done_at": None,
    }
    value.update(changes)
    return value


def canonical(value: dict) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()


def store_event(fake: FakeS3, value: dict, *, key: str | None = None, raw: bytes | None = None):
    data = raw if raw is not None else canonical(value)
    digest = hashlib.sha256(data).hexdigest()
    key = key or f"{PREFIX}{value['workspace_id']}/{value['id']}/{digest}.json"
    fake.put_bytes(BUCKET, key, data)
    return key


def outbox(engine) -> list[dict]:
    with transaction(engine) as conn:
        query = sa.select(deletion_mirror_outbox).order_by(deletion_mirror_outbox.c.created_at)
        return [dict(row) for row in conn.execute(query).mappings()]


# -- writing the mirror -----------------------------------------------------------------------


def test_every_tombstone_change_is_mirrored_as_a_canonical_checked_event(library):
    with transaction(library, WS) as conn:
        record = tombstone(conn, WS, "song", "song-1").deletion
        # Thirty-one days pass before maintenance erases it (backdated, so both databases agree).
        conn.execute(
            sa.update(deletions).values(
                requested_at=deletions.c.requested_at - 31 * DAY,
                physical_after=deletions.c.physical_after - 31 * DAY,
            )
        )
        mark_physical_done(conn, record.id)
        mark_backup_done(conn, record.id)
    fake = FakeS3()
    report = drain_deletion_mirror(library, fake, BUCKET)
    assert (report.examined, report.delivered, report.failed, report.pending) == (3, 3, 0, 0)
    stored = {key: obj for (bucket, key), obj in fake.objects.items() if bucket == BUCKET}
    assert len(stored) == 3
    for key, obj in stored.items():
        digest = hashlib.sha256(obj.data).hexdigest()
        assert key == f"{PREFIX}{WS}/{record.id}/{digest}.json"
        assert obj.metadata == {"sha256": digest, "format": "1"}
        assert obj.content_type == "application/json"
        assert json.loads(obj.data)["id"] == record.id
    assert all(row["delivered_at"] is not None for row in outbox(library))
    assert drain_deletion_mirror(library, fake, BUCKET).examined == 0


def test_mirror_events_are_drained_in_bounded_batches(library):
    with transaction(library, WS) as conn:
        tombstone(conn, WS, "song", "song-1")
        tombstone(conn, WS, "song", "song-2")
    report = drain_deletion_mirror(library, FakeS3(), BUCKET, limit=1)
    assert (report.delivered, report.pending) == (1, 1)
    for limit in (0, 1001):
        with pytest.raises(ValueError, match="1 to 1000"):
            drain_deletion_mirror(library, FakeS3(), BUCKET, limit=limit)


def test_a_failed_mirror_write_is_counted_and_retried_later(library):
    with transaction(library, WS) as conn:
        tombstone(conn, WS, "song", "song-1")
    fake = FakeS3()
    fake.fail_next("put_object", R2Error("down", status=503))
    report = drain_deletion_mirror(library, fake, BUCKET)
    assert (report.delivered, report.failed, report.pending) == (0, 1, 1)
    (row,) = outbox(library)
    assert row["attempt_count"] == 1 and row["last_error"] == "R2Error"
    assert drain_deletion_mirror(library, fake, BUCKET).delivered == 1
    (row,) = outbox(library)
    assert row["last_error"] is None and row["delivered_at"] is not None


def test_a_write_r2_did_not_confirm_is_not_marked_delivered(library):
    class Unconfirmed(FakeS3):
        def put_object(self, bucket, key, source, **kwargs):
            super().put_object(bucket, key, source, **kwargs)
            return PutResult(len(source), "0" * 64, "etag")

    with transaction(library, WS) as conn:
        tombstone(conn, WS, "song", "song-1")
    report = drain_deletion_mirror(library, Unconfirmed(), BUCKET)
    assert report.failed == 1
    assert outbox(library)[0]["last_error"] == "TombstoneLedgerError"


@pytest.mark.parametrize(
    "tamper",
    [
        {"payload": {"id": "x"}},
        {"event_key": "f" * 64},
        {"payload": event(kind="export", bytes_released=10**4000)},
    ],
    ids=["malformed-payload", "key-mismatch", "oversized"],
)
def test_a_tampered_outbox_row_is_never_mirrored(library, tamper):
    with transaction(library, WS) as conn:
        tombstone(conn, WS, "song", "song-1")
        conn.execute(sa.update(deletion_mirror_outbox).values(**tamper))
    fake = FakeS3()
    report = drain_deletion_mirror(library, fake, BUCKET)
    assert report.failed == 1 and fake.objects == {}


# -- validating events ------------------------------------------------------------------------


@pytest.mark.parametrize(
    "bad",
    [
        {"extra": 1},
        {"id": "../x"},
        {"id": 7},
        {"workspace_id": ""},
        {"ref": "a/b"},
        {"kind": "playlist"},
        {"kind": "account", "ref": "song-1"},
        {"bytes_released": -1},
        {"bytes_released": True},
        {"bytes_released": 1.5},
        {"requested_at": "yesterday"},
        {"requested_at": float("inf")},
        {"requested_at": False},
        {"physical_after": None},
        {"physical_after": T0 - 1},
        {"physical_done_at": T0 + 29 * DAY},
        {"backup_done_at": T0 + 40 * DAY},
        {"physical_done_at": T0 + 31 * DAY, "backup_done_at": T0 + 30 * DAY},
    ],
)
def test_malformed_tombstone_events_are_refused(bad):
    with pytest.raises(TombstoneLedgerError):
        _validated(event(**bad))


@pytest.mark.parametrize("value", [{"x": float("nan")}, {"x": object()}])
def test_an_event_that_has_no_canonical_form_is_refused(value):
    with pytest.raises(TombstoneLedgerError, match="canonically"):
        _canonical(value)


def test_a_missing_field_is_refused():
    value = event()
    del value["ref"]
    with pytest.raises(TombstoneLedgerError, match="missing"):
        _validated(value)


def test_valid_events_have_their_times_made_floats():
    value = _validated(event(requested_at=int(T0), physical_after=int(T0) + 30 * DAY,
                             physical_done_at=T0 + 31 * DAY, backup_done_at=T0 + 32 * DAY))
    assert isinstance(value["requested_at"], float)
    assert _validated(event(kind="account", ref=WS))["kind"] == "account"


# -- reading the mirror -----------------------------------------------------------------------


def test_reading_the_mirror_merges_copies_of_one_tombstone(library):
    fake = FakeS3()
    store_event(fake, event())
    store_event(fake, event(physical_done_at=T0 + 31 * DAY))
    store_event(fake, event(physical_done_at=T0 + 31 * DAY, backup_done_at=T0 + 50 * DAY))
    store_event(fake, event(id="del-2", ref="song-2", bytes_released=200))
    count, events = read_storage_tombstone_ledger(fake, BUCKET)
    assert count == 4
    merged = {item["id"]: item for item in events}
    assert merged["del-1"]["physical_done_at"] == T0 + 31 * DAY
    assert merged["del-1"]["backup_done_at"] == T0 + 50 * DAY
    assert merged["del-2"]["physical_done_at"] is None


def test_copies_that_disagree_about_a_tombstone_are_refused():
    fake = FakeS3()
    store_event(fake, event())
    store_event(fake, event(bytes_released=1))
    with pytest.raises(TombstoneLedgerError, match="share a tombstone id"):
        read_storage_tombstone_ledger(fake, BUCKET)


def test_two_tombstones_for_one_target_are_refused():
    fake = FakeS3()
    store_event(fake, event())
    store_event(fake, event(id="del-2"))
    with pytest.raises(TombstoneLedgerError, match="share a deletion target"):
        read_storage_tombstone_ledger(fake, BUCKET)


@pytest.mark.parametrize(
    ("key", "raw", "message"),
    [
        (f"{PREFIX}{WS}/del-1/../x.json", None, "path or size"),
        (f"{PREFIX}{WS}//x.json", None, "path or size"),
        (f"{PREFIX}{WS}\\del-1\\x.json", None, "path or size"),
        (f"{PREFIX}{WS}/del-1/{'0' * 64}.json", None, "checksum"),
        (None, b"not json", "not valid JSON"),
        (None, b"[1, 2]", "must be an object"),
        (None, json.dumps(event(), indent=1).encode(), "not canonical"),
        (f"{PREFIX}{OTHER}/del-1/DIGEST.json", None, "does not match its identifiers"),
        (f"{PREFIX}{WS}/del-9/DIGEST.json", None, "does not match its identifiers"),
    ],
)
def test_a_damaged_or_misplaced_copy_is_refused(key, raw, message):
    fake = FakeS3()
    data = raw if raw is not None else canonical(event())
    digest = hashlib.sha256(data).hexdigest()
    if key is None:
        key = f"{PREFIX}{WS}/del-1/{digest}.json"
    store_event(fake, event(), key=key.replace("DIGEST", digest), raw=data)
    with pytest.raises(TombstoneLedgerError, match=message):
        read_storage_tombstone_ledger(fake, BUCKET)


@pytest.mark.parametrize("size", [0, MAX_EVENT_BYTES + 1])
def test_copies_of_impossible_sizes_are_refused_before_downloading(size):
    fake = FakeS3()
    fake.put_size(BUCKET, f"{PREFIX}{WS}/del-1/{'a' * 64}.json", size)
    with pytest.raises(TombstoneLedgerError, match="path or size"):
        read_storage_tombstone_ledger(fake, BUCKET)
    assert fake.count("get_object") == 0


def test_a_copy_that_changed_after_listing_is_refused():
    class Shifting(FakeS3):
        def get_object(self, bucket, key, dest):
            result = super().get_object(bucket, key, dest)
            dest.write_bytes(dest.read_bytes() + b" ")
            return result

    fake = Shifting()
    store_event(fake, event())
    with pytest.raises(TombstoneLedgerError, match="checksum or size"):
        read_storage_tombstone_ledger(fake, BUCKET)


def test_an_empty_mirror_reads_as_no_tombstones():
    assert read_storage_tombstone_ledger(FakeS3(), BUCKET) == (0, [])


# -- replay after a restore, end to end -------------------------------------------------------


def _commit_bytes(engine, workspace: str, size: int, session: str) -> None:
    with transaction(engine, workspace) as conn:
        quota.commit(conn, quota.reserve(conn, workspace, size, session).id)


def test_replay_after_restore_re_applies_every_mirrored_deletion(library):
    _commit_bytes(library, WS, 300, "s1")
    _commit_bytes(library, OTHER, 900, "s9")
    with transaction(library, WS) as conn:
        tombstone(conn, WS, "song", "song-1")
    with transaction(library, OTHER) as conn:
        tombstone(conn, OTHER, "account", OTHER)
    fake = FakeS3()
    assert drain_deletion_mirror(library, fake, BUCKET).delivered == 2

    # The restore: a backup from before both deletions, with the usage it had then.
    with transaction(library) as conn:
        conn.execute(sa.delete(deletions))
        conn.execute(sa.update(assets).values(deleted_at=None, physical_delete_after=None))

    replay = replay_storage_tombstones_after_restore(library, fake, BUCKET)
    assert replay.snapshots_read == 2 and replay.tombstones_replayed == 2
    assert replay.storage.inserted == 2 and replay.storage.assets_hidden == 2
    assert replay.storage.bytes_released == 1000
    with transaction(library) as conn:
        deleted = dict(conn.execute(sa.select(assets.c.id, assets.c.deleted_at)).all())
        usage_a = quota.usage(conn, WS)
        usage_b = quota.usage(conn, OTHER)
    assert deleted["song-1"] is not None and deleted["song-9"] is not None
    assert deleted["song-2"] is None
    assert usage_a.committed_bytes == 200 and usage_b.committed_bytes == 0

    again = replay_storage_tombstones_after_restore(library, fake, BUCKET)
    assert again.storage.inserted == 0 and again.storage.merged == 2
    assert again.storage.bytes_released == 0


def test_replay_carries_completion_times_from_the_mirror(library):
    with transaction(library, WS) as conn:
        record = tombstone(conn, WS, "song", "song-1").deletion
    # The restored database still has the tombstone, but not that its objects were erased.
    fake = FakeS3()
    erased = record.physical_after + DAY
    store_event(fake, {**record.as_dict(), "physical_done_at": erased})
    replay = replay_storage_tombstones_after_restore(library, fake, BUCKET)
    assert (replay.storage.inserted, replay.storage.merged) == (0, 1)
    with transaction(library) as conn:
        done = conn.execute(sa.select(deletions.c.physical_done_at)).scalar_one()
    assert done == erased
