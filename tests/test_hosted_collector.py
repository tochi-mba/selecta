"""The derived-files collector (`storage.derived_gc`, T-20261125-7e14), on a fake object store.

A live artifact's file survives, a failed attempt's files go, a running (or just finished)
attempt's files survive, another workspace's files are untouched, a dry run deletes nothing, a
second run finds nothing more, and an idle playback file is expired while a used one stays.
"""

from __future__ import annotations

import datetime as dt

import sqlalchemy as sa
from test_cloud_storage_fakes import FakeS3
from test_hosted_stuck_jobs import hosted  # noqa: F401 - the shared hosted fixture

from selecta.authz.schema import audit_events
from selecta.persistence import db_now, new_id, transaction
from selecta.storage import derived_gc
from selecta.storage.keys import derived_key
from selecta.storage.objects import ListedObject
from selecta.work.schema import artifacts, job_attempts, jobs

BUCKET = "derived"
HOUR = 3_600.0


class DatedS3(FakeS3):
    """FakeS3 whose listing carries each object's write time, as R2's does."""

    def __init__(self, **kwargs) -> None:
        super().__init__(**kwargs)
        self.written: dict[str, float] = {}

    def put_at(self, key: str, at: float, size: int = 100) -> str:
        self.put_size(BUCKET, key, size)
        self.written[key] = at
        return key

    def list_objects_v2(self, bucket, prefix="", *, page_size=1000):
        for item in super().list_objects_v2(bucket, prefix, page_size=page_size):
            at = self.written.get(item.key)
            stamp = dt.datetime.fromtimestamp(at, dt.UTC).isoformat().replace("+00:00", "Z") \
                if at is not None else None
            yield ListedObject(item.key, item.size, item.etag, stamp)

    def has(self, key: str) -> bool:
        return (BUCKET, key) in self.objects


def attempt(engine, workspace: str, *, ended_ago: float | None, outcome: str | None) -> str:
    attempt_id = new_id()
    with transaction(engine, workspace) as conn:
        now = db_now(conn)
        conn.execute(job_attempts.insert().values(
            id=attempt_id, workspace_id=workspace, job_id=new_id(), pool="cpu-heavy",
            lane="standard", fencing_token=1, est_cost_s=40.0, started_at=now - 10 * HOUR,
            lease_expires_at=now + 60, deadline_at=now + 600,
            ended_at=None if ended_ago is None else now - ended_ago, outcome=outcome))
    return attempt_id


def key(workspace: str, attempt_id: str, kind: str = "analysis", digest: str = "a" * 64,
        name: str = "analysis.npz") -> str:
    return derived_key(workspace, kind, digest, attempt_id, name)


def row(engine, workspace: str, kind: str, digest: str, keys: list[str], attempt_id: str, *,
        used_ago: float = 0.0, size: int = 100) -> str:
    artifact_id = new_id()
    with transaction(engine, workspace) as conn:
        now = db_now(conn)
        conn.execute(artifacts.insert().values(
            id=artifact_id, workspace_id=workspace, kind=kind, input_hash=digest, keys=keys,
            checksum="c" * 64, size_bytes=size, provenance={"inputs": {"source": "s"}},
            attempt_id=attempt_id, created_at=now - used_ago, last_used_at=now - used_ago))
    return artifact_id


def collector(engine, store: DatedS3, *, dry: bool = False) -> derived_gc.Collector:
    return derived_gc.Collector(engine, lambda: store, BUCKET, dry_run=lambda: dry)


def now_of(engine) -> float:
    with transaction(engine) as conn:
        return db_now(conn)


def test_only_unnamed_files_of_long_ended_attempts_go(hosted):  # noqa: F811
    engine, _work, mine = hosted
    store, now = DatedS3(), now_of(engine)
    old = now - 7 * HOUR
    won = attempt(engine, mine, ended_ago=7 * HOUR, outcome="succeeded")
    lost = attempt(engine, mine, ended_ago=7 * HOUR, outcome="failed")
    running = attempt(engine, mine, ended_ago=None, outcome=None)
    just = attempt(engine, mine, ended_ago=600, outcome="succeeded")
    live = store.put_at(key(mine, won), old)
    row(engine, mine, "analysis", "a" * 64, [live], won)
    failed = [store.put_at(key(mine, lost), old),
              store.put_at(key(mine, lost, name="scratch.wav"), old)]
    busy = store.put_at(key(mine, running, digest="b" * 64), now)  # an upload in progress
    fresh = store.put_at(key(mine, just, digest="d" * 64), now - 600)  # its row is due
    features = store.put_at(derived_key(mine, "features", "e" * 64, "current", "features.npz"),
                            old)
    report = collector(engine, store).run()
    assert not any(store.has(k) for k in failed)
    assert all(store.has(k) for k in (live, busy, fresh, features))
    assert (report.deleted, report.kept_named, report.kept_running, report.kept_unknown) == (
        2, 1, 2, 1)
    with engine.connect() as conn:
        event = conn.execute(sa.select(audit_events.c.action, audit_events.c.workspace_id)
                             .where(audit_events.c.action == derived_gc.AUDIT_ACTION)).one()
    assert tuple(event) == (derived_gc.AUDIT_ACTION, mine)
    again = collector(engine, store).run()
    assert again.deleted == 0, "safe to run twice"


def test_a_superseded_file_waits_until_its_replacement_is_old_too(hosted):  # noqa: F811
    engine, _work, mine = hosted
    store, now = DatedS3(), now_of(engine)
    first = attempt(engine, mine, ended_ago=30 * HOUR, outcome="succeeded")
    second = attempt(engine, mine, ended_ago=HOUR, outcome="succeeded")
    old_file = store.put_at(key(mine, first, kind="playback", name="play.flac"), now - 30 * HOUR)
    new_file = store.put_at(key(mine, second, kind="playback", name="play.flac"), now - HOUR)
    row(engine, mine, "playback", "a" * 64, [new_file], second)
    collector(engine, store).run()
    assert store.has(old_file), "a player may still hold a link to the file it replaced"
    with transaction(engine, mine) as conn:
        conn.execute(job_attempts.update().where(job_attempts.c.id == second)
                     .values(ended_at=now - 7 * HOUR))
    collector(engine, store).run()
    assert not store.has(old_file) and store.has(new_file)


def test_a_file_a_live_job_names_is_kept(hosted):  # noqa: F811
    """A queued export names a playback file by key; it stays even with no row naming it."""
    engine, _work, mine = hosted
    store, now = DatedS3(), now_of(engine)
    lost = attempt(engine, mine, ended_ago=9 * HOUR, outcome="failed")
    held = store.put_at(key(mine, lost, kind="playback", name="play.flac"), now - 9 * HOUR)
    with transaction(engine, mine) as conn:
        conn.execute(jobs.insert().values(
            id=new_id(), workspace_id=mine, type="export.render", pool="export", lane="standard",
            base_lane="standard", urgency=2, base_urgency=2, est_cost_s=60.0, state="queued",
            max_attempts=6, max_run_s=1800.0, input_ref={"objects": [held]},
            created_at=now, updated_at=now))
    report = collector(engine, store).run()
    assert store.has(held) and report.kept_named == 1


def test_another_workspace_is_never_touched(hosted):  # noqa: F811
    engine, _work, mine = hosted
    theirs = new_id()
    store, now = DatedS3(), now_of(engine)
    their_attempt = attempt(engine, theirs, ended_ago=9 * HOUR, outcome="failed")
    their_file = store.put_at(key(theirs, their_attempt), now - 9 * HOUR)
    my_attempt = attempt(engine, mine, ended_ago=9 * HOUR, outcome="failed")
    my_file = store.put_at(key(mine, my_attempt), now - 9 * HOUR)
    report = collector(engine, store).run(only=mine)
    assert not store.has(my_file) and store.has(their_file)
    assert report.workspaces == 1

    class Leaky(DatedS3):
        """A listing that wrongly returns another workspace's key under this prefix."""

        def list_objects_v2(self, bucket, prefix="", *, page_size=1000):
            yield from super().list_objects_v2(bucket, prefix, page_size=page_size)
            yield ListedObject(their_file, 100, "x", "2020-01-01T00:00:00Z")

    leaky = Leaky()
    leaky.put_at(their_file, now - 9 * HOUR)
    report = collector(engine, leaky).run(only=mine)
    assert leaky.has(their_file) and report.kept_foreign == 1


def test_a_dry_run_deletes_nothing_and_says_what_it_would(hosted):  # noqa: F811
    engine, _work, mine = hosted
    store, now = DatedS3(), now_of(engine)
    lost = attempt(engine, mine, ended_ago=9 * HOUR, outcome="failed")
    gone = store.put_at(key(mine, lost), now - 9 * HOUR, size=5_000)
    report = collector(engine, store, dry=True).run()
    assert store.has(gone)
    assert (report.dry_run, report.deleted, report.deleted_bytes) == (True, 1, 5_000)
    assert "Would delete 1" in report.lines()[0]
    with transaction(engine) as conn:
        assert derived_gc.last_run(conn)["dry_run"] is True


def test_a_run_is_bounded_and_the_next_carries_on(hosted):  # noqa: F811
    engine, _work, mine = hosted
    store, now = DatedS3(), now_of(engine)
    lost = attempt(engine, mine, ended_ago=9 * HOUR, outcome="failed")
    files = [store.put_at(key(mine, lost, name=f"f{n}.npz"), now - 9 * HOUR) for n in range(5)]
    bounded = derived_gc.Collector(engine, lambda: store, BUCKET, dry_run=lambda: False,
                                   max_delete=2)
    first = bounded.run()
    assert first.deleted == 2 and first.stopped == "delete"
    bounded.run()
    bounded.run()
    assert not any(store.has(k) for k in files)


def test_an_idle_playback_file_is_expired_and_a_used_one_stays(hosted):  # noqa: F811
    engine, _work, mine = hosted
    store, now = DatedS3(), now_of(engine)
    won = attempt(engine, mine, ended_ago=40 * 24 * HOUR, outcome="succeeded")
    idle = store.put_at(key(mine, won, kind="playback", digest="1" * 64, name="p.flac"),
                        now - 40 * 24 * HOUR)
    used = store.put_at(key(mine, won, kind="playback", digest="2" * 64, name="p.flac"),
                        now - 40 * 24 * HOUR)
    idle_row = row(engine, mine, "playback", "1" * 64, [idle], won, used_ago=31 * 24 * HOUR)
    row(engine, mine, "playback", "2" * 64, [used], won, used_ago=24 * HOUR)
    report = collector(engine, store).run()
    assert not store.has(idle) and store.has(used)
    assert report.playback_expired == 1
    with engine.connect() as conn:
        left = conn.execute(sa.select(artifacts.c.id).where(
            artifacts.c.kind == "playback")).scalars().all()
    assert idle_row not in left and len(left) == 1


def test_times_from_a_listing_and_a_head_are_both_read():
    assert derived_gc.parse_time("2026-11-25T10:00:00.000Z") == dt.datetime(
        2026, 11, 25, 10, tzinfo=dt.UTC).timestamp()
    assert derived_gc.parse_time("Wed, 25 Nov 2026 10:00:00 GMT") == dt.datetime(
        2026, 11, 25, 10, tzinfo=dt.UTC).timestamp()
    assert derived_gc.parse_time(None) is None and derived_gc.parse_time("soon") is None
