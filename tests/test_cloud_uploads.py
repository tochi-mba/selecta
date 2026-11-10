"""The upload protocol (ADR-0398, spec 5.2, test plan 18.15): planning, transfer, accepting,
rejecting, cancelling and expiry, on both databases.

Completion itself is in `test_cloud_uploads_completion.py`.
"""

from __future__ import annotations

import hashlib
import logging
import unicodedata

import pytest
import sqlalchemy as sa
from test_cloud_storage_fakes import FakeS3, Limits, Quota

from selecta.persistence import transaction
from selecta.storage.keys import original_key, staging_key
from selecta.storage.names import MAX_DISPLAY_NAME, display_name
from selecta.storage.objects import GiB, MiB, R2Error
from selecta.storage.parts import PART_SIZE
from selecta.storage.ports import PlanLimits, QuotaExceeded
from selecta.storage.schema import assets, upload_sessions
from selecta.storage.uploads import (
    ACTIVE,
    MAX_BATCH,
    SESSION_TTL,
    BatchTooLarge,
    FileSpec,
    InvalidState,
    Outcome,
    Probe,
    SessionNotFound,
    Status,
    UploadError,
    Uploads,
    _minutes_text,
    _size_text,
)

WS = "ws-a"
OTHER = "ws-b"
STAGING = "sel-staging"
ORIGINALS = "sel-originals"
DIGEST = hashlib.sha256(b"song").hexdigest()


class Duplicates:
    def __init__(self, known: dict[str, str] | None = None) -> None:
        self.known = known or {}
        self.asked: list[tuple[str, str]] = []

    def find_by_sha256(self, conn, workspace_id: str, sha256: str) -> str | None:
        self.asked.append((workspace_id, sha256))
        return self.known.get(sha256)


@pytest.fixture
def fake() -> FakeS3:
    return FakeS3()


@pytest.fixture
def quota() -> Quota:
    return Quota()


@pytest.fixture
def limits() -> Limits:
    return Limits()


@pytest.fixture
def duplicates() -> Duplicates:
    return Duplicates()


@pytest.fixture
def uploads(fake, quota, limits, duplicates) -> Uploads:
    return Uploads(fake, quota=quota, limits=limits, duplicates=duplicates)


def plan(engine, uploads: Uploads, *files: FileSpec, workspace: str = WS):
    with transaction(engine, workspace) as conn:
        return uploads.plan_batch(conn, workspace, list(files))


def one(engine, uploads: Uploads, spec: FileSpec, workspace: str = WS):
    planned = plan(engine, uploads, spec, workspace=workspace)[0]
    assert planned.session is not None, planned.refused
    return planned.session


def send_as_planned(fake: FakeS3, session) -> None:
    plan_ = session.part_count
    sizes = [session.part_size] * (plan_ - 1)
    sizes.append(session.declared_size - session.part_size * (plan_ - 1))
    fake.upload_sizes(session.upload_id, sizes)


def call(engine, method, *args, workspace: str = WS, **kwargs):
    with transaction(engine, workspace) as conn:
        return method(conn, *args, workspace_id=workspace, **kwargs)


def count_sessions(engine) -> int:
    with transaction(engine) as conn:
        return conn.execute(sa.select(sa.func.count()).select_from(upload_sessions)).scalar_one()


def probe(size: int, sha: str = DIGEST, **changes) -> Probe:
    values = {"format": "flac", "duration_s": 200.0, "sample_rate": 44_100, "channels": 2}
    values.update(changes)
    return Probe(values["format"], values["duration_s"], values["sample_rate"],
                 values["channels"], sha, size)


def completed(engine, uploads: Uploads, fake: FakeS3, size: int = 10 * MiB, **spec):
    session = one(engine, uploads, FileSpec("song.flac", size, **spec))
    send_as_planned(fake, session)
    outcome = call(engine, uploads.complete, session.id)
    assert outcome.status is Status.COMPLETED, outcome.error
    return outcome.session


# -- planning ---------------------------------------------------------------------------------


def test_a_batch_of_more_than_500_files_is_refused(cloud_engine, uploads, fake):
    files = [FileSpec(f"{n}.mp3", 100) for n in range(MAX_BATCH + 1)]
    with pytest.raises(BatchTooLarge, match="at most 500"):
        plan(cloud_engine, uploads, *files)
    assert count_sessions(cloud_engine) == 0
    assert fake.calls == []


def test_a_batch_of_exactly_500_files_is_planned(cloud_engine, uploads, fake, quota):
    results = plan(cloud_engine, uploads, *[FileSpec(f"{n}.mp3", 100) for n in range(MAX_BATCH)])
    assert [r.index for r in results] == list(range(MAX_BATCH))
    assert all(r.session and r.session.status is Status.UPLOADING for r in results)
    assert fake.count("create_multipart_upload") == MAX_BATCH
    assert len({r.session.upload_id for r in results}) == MAX_BATCH
    assert quota.used == 100 * MAX_BATCH


def test_an_empty_batch_plans_nothing(cloud_engine, uploads, fake):
    assert plan(cloud_engine, uploads) == []
    assert fake.calls == []


def test_each_file_is_checked_against_the_plans_per_file_limit(cloud_engine, fake, quota):
    uploads = Uploads(fake, quota=quota, limits=Limits(max_file_bytes=200_000_000))
    results = plan(
        cloud_engine,
        uploads,
        FileSpec("small.mp3", 200_000_000),
        FileSpec("big.wav", 200_000_001),
        FileSpec("bigger.wav", 1_500_000_000),
    )
    assert results[0].session is not None
    assert results[1].session is None
    assert results[1].refused == "This file is 200 MB, over the 200 MB limit per file."
    assert results[2].refused == "This file is 1.5 GB, over the 200 MB limit per file."
    assert quota.used == 200_000_000
    assert count_sessions(cloud_engine) == 1


def test_even_a_generous_plan_is_capped_at_the_single_copy_limit(cloud_engine, fake, quota):
    uploads = Uploads(fake, quota=quota, limits=Limits(max_file_bytes=50 * GiB))
    ok, refused = plan(cloud_engine, uploads, FileSpec("a", 5 * GiB), FileSpec("b", 5 * GiB + 1))
    assert ok.session is not None and ok.session.part_count == 640
    assert refused.refused == "This file is 5.4 GB, over the 5.4 GB limit per file."


@pytest.mark.parametrize("size", [0, -1, -(10**9)])
def test_zero_byte_and_negative_files_are_refused(cloud_engine, uploads, quota, fake, size):
    result = plan(cloud_engine, uploads, FileSpec("empty.mp3", size))[0]
    assert result.session is None and result.refused == "This file is empty."
    assert quota.reserved == {}
    assert fake.calls == []


@pytest.mark.parametrize("size", [None, 1.5, True, "10"])
def test_a_file_without_a_whole_number_size_is_refused(cloud_engine, uploads, size):
    result = plan(cloud_engine, uploads, FileSpec("x.mp3", size))[0]  # type: ignore[arg-type]
    assert result.refused == "This file's size wasn't given."


def test_planning_reserves_bytes_and_starts_a_staging_multipart_upload(
    cloud_engine, uploads, fake, quota
):
    session = one(cloud_engine, uploads, FileSpec("Music/01 Intro.MP3", 1234, "Audio/MPEG"))
    assert session.status is Status.UPLOADING
    assert session.upload_id in fake.uploads
    assert fake.uploads[session.upload_id].bucket == STAGING
    assert fake.uploads[session.upload_id].content_type == "audio/mpeg"
    assert session.staging_key == staging_key(session.id)
    assert session.part_size == PART_SIZE == 8 * MiB
    assert session.declared_size == 1234
    assert session.display_name == "01 Intro.MP3"
    assert quota.reserved == {session.reservation_id: 1234}
    assert session.expires_at == session.created_at + SESSION_TTL
    assert SESSION_TTL == 2 * 24 * 3600
    stored = call(cloud_engine, uploads.get, session.id)
    assert stored.status is Status.UPLOADING and stored.reservation_id == session.reservation_id


def test_the_part_size_is_fixed_at_8_mib_so_a_gib_is_128_parts(cloud_engine, uploads):
    big = one(cloud_engine, uploads, FileSpec("big.wav", 1 * GiB))
    small = one(cloud_engine, uploads, FileSpec("small.mp3", 3 * MiB))
    edge = one(cloud_engine, uploads, FileSpec("edge.mp3", PART_SIZE + 1))
    assert (big.part_size, big.part_count) == (PART_SIZE, 128)
    assert small.part_count == 1
    assert edge.part_count == 2


def test_no_key_ever_contains_the_file_name(cloud_engine, uploads, fake):
    name = "Secret Demo - Do Not Leak.flac"
    session = one(cloud_engine, uploads, FileSpec(name, 100))
    send_as_planned(fake, session)
    call(cloud_engine, uploads.complete, session.id)
    call(cloud_engine, uploads.accept, session.id, probe(100))
    every_key = [key for (_, key) in fake.objects] + [session.staging_key]
    every_key += [upload.key for upload in fake.uploads.values()]
    assert every_key
    for key in every_key:
        assert "Secret" not in key and "Demo" not in key and ".flac" not in key
    assert (ORIGINALS, original_key(WS, session.id)) in fake.objects


def test_duplicates_of_songs_already_kept_are_flagged(cloud_engine, fake, quota):
    duplicates = Duplicates({DIGEST: "asset-old"})
    uploads = Uploads(fake, quota=quota, limits=Limits(), duplicates=duplicates)
    result = plan(cloud_engine, uploads, FileSpec("again.mp3", 100, sha256=DIGEST.upper()))[0]
    assert result.duplicate_of == "asset-old"
    assert result.session.duplicate_of == "asset-old"
    assert result.session.sha256 == DIGEST
    assert duplicates.asked == [(WS, DIGEST)]
    assert call(cloud_engine, uploads.get, result.session.id).duplicate_of == "asset-old"


def test_the_same_file_twice_in_one_batch_is_flagged(cloud_engine, uploads):
    first, second, other = plan(
        cloud_engine,
        uploads,
        FileSpec("a.mp3", 100, sha256=DIGEST),
        FileSpec("a copy.mp3", 100, sha256=DIGEST),
        FileSpec("b.mp3", 100, sha256="b" * 64),
    )
    assert first.same_as is None
    assert second.same_as == first.session.id
    assert other.same_as is None


def test_a_file_already_uploading_from_another_tab_is_flagged(cloud_engine, uploads):
    earlier = one(cloud_engine, uploads, FileSpec("a.mp3", 100, sha256=DIGEST))
    later = plan(cloud_engine, uploads, FileSpec("a.mp3", 100, sha256=DIGEST))[0]
    assert later.same_as == earlier.id
    elsewhere = plan(cloud_engine, uploads, FileSpec("a.mp3", 100, sha256=DIGEST), workspace=OTHER)
    assert elsewhere[0].same_as is None


def test_an_upload_that_ended_no_longer_counts_as_in_flight(cloud_engine, uploads):
    earlier = one(cloud_engine, uploads, FileSpec("a.mp3", 100, sha256=DIGEST))
    call(cloud_engine, uploads.cancel, earlier.id)
    assert plan(cloud_engine, uploads, FileSpec("a.mp3", 100, sha256=DIGEST))[0].same_as is None


def test_a_malformed_browser_hash_is_ignored(cloud_engine, uploads, duplicates):
    result = plan(cloud_engine, uploads, FileSpec("a.mp3", 100, sha256="not-a-hash"))[0]
    assert result.session.sha256 is None and result.same_as is None
    assert duplicates.asked == []


def test_duplicates_are_not_looked_up_without_a_duplicate_port(cloud_engine, fake, quota):
    uploads = Uploads(fake, quota=quota, limits=Limits())
    result = plan(cloud_engine, uploads, FileSpec("a.mp3", 100, sha256=DIGEST))[0]
    assert result.duplicate_of is None and result.session is not None


def test_a_file_over_the_quota_is_refused_alone_and_leaves_no_session(cloud_engine, fake):
    quota = Quota(limit=250)
    uploads = Uploads(fake, quota=quota, limits=Limits())
    results = plan(
        cloud_engine, uploads, FileSpec("a", 100), FileSpec("b", 200), FileSpec("c", 150)
    )
    assert results[0].session is not None
    assert results[1].session is None
    assert results[1].refused.startswith("There isn't enough storage left for this file")
    assert results[2].session is not None
    assert count_sessions(cloud_engine) == 2
    assert fake.count("create_multipart_upload") == 2


def test_planning_while_r2_is_down_leaves_the_session_planned_until_start(
    cloud_engine, uploads, fake, caplog
):
    caplog.set_level(logging.WARNING)
    fake.fail_next("create_multipart_upload", R2Error("down", status=503))
    session = one(cloud_engine, uploads, FileSpec("a.mp3", 100))
    assert session.status is Status.PLANNED and session.upload_id is None
    assert f"Couldn't start upload {session.id} yet: 503" in caplog.text
    started = call(cloud_engine, uploads.start, session.id)
    assert started.status is Status.UPLOADING and started.upload_id in fake.uploads
    assert call(cloud_engine, uploads.start, session.id) == call(
        cloud_engine, uploads.get, session.id
    )
    assert fake.count("create_multipart_upload") == 2


def test_starting_an_expired_planned_upload_is_refused(cloud_engine, uploads, fake):
    fake.fail_next("create_multipart_upload", R2Error("down", code="SlowDown"))
    session = one(cloud_engine, uploads, FileSpec("a.mp3", 100))
    age(cloud_engine, session.id, SESSION_TTL)
    with pytest.raises(InvalidState, match="expired"):
        call(cloud_engine, uploads.start, session.id)


def test_r2_failures_while_planning_many_files_leave_just_those_planned(cloud_engine, fake, quota):
    uploads = Uploads(fake, quota=quota, limits=Limits(), max_workers=1)
    fake.fail_next("create_multipart_upload", R2Error("down", status=500))
    results = plan(cloud_engine, uploads, FileSpec("a", 1), FileSpec("b", 1))
    assert sorted(r.session.status for r in results) == [Status.PLANNED, Status.UPLOADING]


def test_sessions_are_only_found_in_their_own_workspace(cloud_engine, uploads):
    session = one(cloud_engine, uploads, FileSpec("a.mp3", 100))
    with pytest.raises(SessionNotFound):
        call(cloud_engine, uploads.get, session.id, workspace=OTHER)
    with pytest.raises(SessionNotFound):
        call(cloud_engine, uploads.complete, session.id, workspace=OTHER)
    with pytest.raises(SessionNotFound):
        call(cloud_engine, uploads.cancel, "no-such-session")
    with transaction(cloud_engine) as conn:
        assert uploads.get(conn, session.id).id == session.id


def test_active_sessions_are_listed_oldest_first_per_workspace(cloud_engine, uploads, clock):
    first = one(cloud_engine, uploads, FileSpec("1.mp3", 100))
    clock.advance(5)
    second = one(cloud_engine, uploads, FileSpec("2.mp3", 100))
    one(cloud_engine, uploads, FileSpec("3.mp3", 100), workspace=OTHER)
    clock.advance(5)
    third = one(cloud_engine, uploads, FileSpec("4.mp3", 100))
    call(cloud_engine, uploads.cancel, third.id)
    with transaction(cloud_engine, WS) as conn:
        active = uploads.active_sessions(conn, WS)
    assert [s.id for s in active] == [first.id, second.id]
    assert all(s.status in ACTIVE for s in active)


# -- transfer ---------------------------------------------------------------------------------


def test_part_urls_are_handed_out_per_part_number(cloud_engine, uploads, fake):
    session = one(cloud_engine, uploads, FileSpec("a.wav", PART_SIZE * 3))
    urls = uploads.presign_parts(session, [3, 1, 1, 2])
    assert list(urls) == [1, 2, 3]
    assert all(f"partNumber={n}&" in url for n, url in urls.items())
    assert all("X-Amz-Expires=900" in url for url in urls.values())
    short = uploads.presign_parts(session, [1], ttl=60)
    assert "X-Amz-Expires=60" in short[1]


@pytest.mark.parametrize(
    ("numbers", "ttl", "message"),
    [
        ([], 900, "1 to 100 parts"),
        (list(range(1, 102)), 900, "1 to 100 parts"),
        ([0], 900, "parts 1 to 3"),
        ([4], 900, "parts 1 to 3"),
        ([1], 901, "1 to 900 seconds"),
        ([1], 0, "1 to 900 seconds"),
    ],
)
def test_part_url_requests_are_bounded(cloud_engine, uploads, numbers, ttl, message):
    session = one(cloud_engine, uploads, FileSpec("a.wav", PART_SIZE * 3))
    with pytest.raises(ValueError, match=message):
        uploads.presign_parts(session, numbers, ttl=ttl)


def test_part_urls_are_only_for_uploads_in_progress(cloud_engine, uploads, fake):
    fake.fail_next("create_multipart_upload", R2Error("down", status=503))
    planned = one(cloud_engine, uploads, FileSpec("a.mp3", 100))
    with pytest.raises(InvalidState, match="planned"):
        uploads.presign_parts(planned, [1])
    session = completed(cloud_engine, uploads, fake)
    with pytest.raises(InvalidState, match="completed"):
        uploads.presign_parts(session, [1])


def test_a_refreshed_page_sees_the_parts_that_already_arrived(cloud_engine, uploads, fake):
    session = one(cloud_engine, uploads, FileSpec("a.wav", PART_SIZE * 3))
    fake.upload_sizes(session.upload_id, [PART_SIZE, PART_SIZE])
    assert [p.number for p in uploads.uploaded_parts(session)] == [1, 2]
    fake.abort_multipart_upload(STAGING, session.staging_key, session.upload_id)
    assert uploads.uploaded_parts(session) == []


def test_uploads_not_in_progress_have_no_parts_to_resume(cloud_engine, uploads, fake):
    session = completed(cloud_engine, uploads, fake)
    before = fake.count("list_parts")
    assert uploads.uploaded_parts(session) == []
    assert fake.count("list_parts") == before


# -- accepting --------------------------------------------------------------------------------


def test_accept_copies_to_originals_deletes_staging_records_the_asset_and_commits(
    cloud_engine, uploads, fake, quota
):
    session = completed(cloud_engine, uploads, fake, size=10 * MiB, sha256=DIGEST)
    outcome = call(cloud_engine, uploads.accept, session.id, probe(10 * MiB, format="mp3"))
    assert isinstance(outcome, Outcome)
    assert outcome.status is Status.ACCEPTED and outcome.asset_id == session.id
    assert outcome.error is None
    key = original_key(WS, session.id)
    original = fake.objects[(ORIGINALS, key)]
    assert original.size == 10 * MiB
    assert original.metadata == {"sha256": DIGEST}
    assert original.content_type == "audio/mpeg"
    assert (STAGING, session.staging_key) not in fake.objects
    assert quota.commits == [session.reservation_id] and quota.committed == 10 * MiB
    assert quota.released == []
    with transaction(cloud_engine, WS) as conn:
        row = conn.execute(sa.select(assets)).mappings().one()
    assert row["id"] == session.id and row["workspace_id"] == WS
    assert row["original_key"] == key and row["size"] == 10 * MiB
    assert (row["format"], row["sample_rate"], row["channels"]) == ("mp3", 44_100, 2)
    assert row["deleted_at"] is None


def test_an_unknown_format_is_kept_as_octet_stream(cloud_engine, uploads, fake):
    session = completed(cloud_engine, uploads, fake, size=100)
    call(cloud_engine, uploads.accept, session.id, probe(100, format="wv"))
    assert fake.objects[(ORIGINALS, original_key(WS, session.id))].content_type == (
        "application/octet-stream"
    )


def test_accepting_twice_returns_the_same_outcome_and_commits_once(
    cloud_engine, uploads, fake, quota
):
    session = completed(cloud_engine, uploads, fake, size=100)
    first = call(cloud_engine, uploads.accept, session.id, probe(100))
    copies = fake.count("copy_object")
    again = call(cloud_engine, uploads.accept, session.id, probe(100))
    assert again.status is Status.ACCEPTED and again.asset_id == first.asset_id
    assert fake.count("copy_object") == copies
    assert quota.commits == [session.reservation_id]
    assert call(cloud_engine, uploads.complete, session.id).asset_id == session.id


def test_a_retried_accept_after_a_lost_transaction_finds_the_copy(cloud_engine, uploads, fake):
    session = completed(cloud_engine, uploads, fake, size=100)
    with pytest.raises(RuntimeError):
        with transaction(cloud_engine, WS) as conn:
            uploads.accept(conn, session.id, probe(100), workspace_id=WS)
            raise RuntimeError("the response was lost")
    # The copy happened and the staged object is gone, but nothing was recorded.
    assert (STAGING, session.staging_key) not in fake.objects
    assert call(cloud_engine, uploads.get, session.id).status is Status.COMPLETED
    outcome = call(cloud_engine, uploads.accept, session.id, probe(100))
    assert outcome.status is Status.ACCEPTED


def _forget_reservation(engine, session_id: str) -> None:
    with transaction(engine) as conn:
        conn.execute(
            sa.update(upload_sessions)
            .where(upload_sessions.c.id == session_id)
            .values(reservation_id=None)
        )


def test_a_session_without_a_recorded_reservation_settles_without_touching_quota(
    cloud_engine, uploads, fake, quota
):
    accepted = completed(cloud_engine, uploads, fake, size=100)
    aborted = one(cloud_engine, uploads, FileSpec("b.mp3", 100))
    _forget_reservation(cloud_engine, accepted.id)
    _forget_reservation(cloud_engine, aborted.id)
    assert call(cloud_engine, uploads.accept, accepted.id, probe(100)).status is Status.ACCEPTED
    assert call(cloud_engine, uploads.complete, aborted.id).status is Status.ABORTED
    assert quota.commits == [] and quota.released == []


def test_accept_never_records_an_asset_twice(cloud_engine, uploads, fake):
    session = completed(cloud_engine, uploads, fake, size=100)
    with transaction(cloud_engine) as conn:
        conn.execute(
            sa.insert(assets).values(
                id=session.id, workspace_id=WS, original_key=original_key(WS, session.id),
                size=100, sha256=DIGEST, format="flac", created_at=1.0,
            )
        )
    assert call(cloud_engine, uploads.accept, session.id, probe(100)).status is Status.ACCEPTED
    with transaction(cloud_engine) as conn:
        assert conn.execute(sa.select(sa.func.count()).select_from(assets)).scalar_one() == 1


def test_only_a_completed_upload_can_be_accepted(cloud_engine, uploads):
    session = one(cloud_engine, uploads, FileSpec("a.mp3", 100))
    with pytest.raises(InvalidState, match="uploading"):
        call(cloud_engine, uploads.accept, session.id, probe(100))


def test_a_song_over_the_plans_duration_is_rejected_and_released(
    cloud_engine, fake, quota
):
    uploads = Uploads(fake, quota=quota, limits=Limits(max_duration_s=1200))
    session = completed(cloud_engine, uploads, fake, size=100)
    outcome = call(cloud_engine, uploads.accept, session.id, probe(100, duration_s=1201))
    assert outcome.status is Status.REJECTED
    assert outcome.error == "This song is 20 minutes long, over your plan's 20 minutes limit."
    assert quota.released == [session.reservation_id]
    assert (STAGING, session.staging_key) not in fake.objects


def test_a_plan_without_a_duration_cap_accepts_any_length(cloud_engine, fake, quota):
    uploads = Uploads(fake, quota=quota, limits=Limits(max_duration_s=None))
    session = completed(cloud_engine, uploads, fake, size=100)
    outcome = call(cloud_engine, uploads.accept, session.id, probe(100, duration_s=86_400))
    assert outcome.status is Status.ACCEPTED


def test_a_staged_file_lost_before_accepting_is_rejected(cloud_engine, uploads, fake, quota):
    session = completed(cloud_engine, uploads, fake, size=100)
    del fake.objects[(STAGING, session.staging_key)]
    outcome = call(cloud_engine, uploads.accept, session.id, probe(100))
    assert outcome.status is Status.REJECTED and "lost" in outcome.error
    assert quota.released == [session.reservation_id]


def test_an_original_of_the_wrong_size_stops_acceptance(cloud_engine, uploads, fake):
    session = completed(cloud_engine, uploads, fake, size=100)
    del fake.objects[(STAGING, session.staging_key)]
    fake.put_size(ORIGINALS, original_key(WS, session.id), 99, sha256=DIGEST)
    with pytest.raises(UploadError, match="isn't the size"):
        call(cloud_engine, uploads.accept, session.id, probe(100))


# -- rejecting and cancelling -----------------------------------------------------------------


def test_reject_deletes_the_staged_file_releases_the_bytes_and_keeps_the_reason(
    cloud_engine, uploads, fake, quota
):
    session = completed(cloud_engine, uploads, fake, size=100)
    outcome = call(cloud_engine, uploads.reject, session.id, "Not audio.")
    assert outcome.status is Status.REJECTED and outcome.error == "Not audio."
    assert (STAGING, session.staging_key) not in fake.objects
    assert quota.released == [session.reservation_id] and quota.used == 0
    again = call(cloud_engine, uploads.reject, session.id, "Other reason.")
    assert again.error == "Not audio."
    assert quota.released == [session.reservation_id]


def test_reject_without_a_reason_gives_a_default_and_long_reasons_are_cut(
    cloud_engine, uploads, fake
):
    first = completed(cloud_engine, uploads, fake, size=100)
    assert call(cloud_engine, uploads.reject, first.id, "").error == "This file couldn't be used."
    second = completed(cloud_engine, uploads, fake, size=100)
    assert len(call(cloud_engine, uploads.reject, second.id, "x" * 5000).error) == 500


def test_an_accepted_upload_cannot_be_rejected_or_cancelled(cloud_engine, uploads, fake):
    session = completed(cloud_engine, uploads, fake, size=100)
    call(cloud_engine, uploads.accept, session.id, probe(100))
    with pytest.raises(InvalidState, match="delete the song"):
        call(cloud_engine, uploads.reject, session.id, "late")
    with pytest.raises(InvalidState, match="delete the song"):
        call(cloud_engine, uploads.cancel, session.id)


def test_cancel_aborts_an_upload_in_progress_and_is_repeatable(cloud_engine, uploads, fake, quota):
    session = one(cloud_engine, uploads, FileSpec("a.mp3", 100))
    outcome = call(cloud_engine, uploads.cancel, session.id, "Skipped duplicate.")
    assert outcome.status is Status.ABORTED and outcome.error == "Skipped duplicate."
    assert session.upload_id not in fake.uploads
    assert quota.released == [session.reservation_id]
    assert call(cloud_engine, uploads.cancel, session.id).error == "Skipped duplicate."


def test_cancelling_a_session_that_never_started_touches_nothing_in_r2(
    cloud_engine, uploads, fake, quota
):
    fake.fail_next("create_multipart_upload", R2Error("down", status=503))
    session = one(cloud_engine, uploads, FileSpec("a.mp3", 100))
    assert call(cloud_engine, uploads.cancel, session.id).status is Status.ABORTED
    assert fake.count("abort_multipart_upload") == 0 and fake.count("delete_object") == 0
    assert quota.released == [session.reservation_id]


def test_cleanup_failures_in_r2_are_logged_without_urls_and_do_not_block(
    cloud_engine, uploads, fake, quota, caplog
):
    caplog.set_level(logging.DEBUG)
    session = one(cloud_engine, uploads, FileSpec("a.mp3", 100))
    url = uploads.presign_parts(session, [1])[1]
    fake.fail_next("abort_multipart_upload", R2Error("down", status=503))
    fake.fail_next("delete_object", R2Error("denied", status=403, code="AccessDenied"))
    outcome = call(cloud_engine, uploads.cancel, session.id)
    assert outcome.status is Status.ABORTED
    assert quota.released == [session.reservation_id]
    assert f"Couldn't abort upload {session.id}: 503" in caplog.text
    assert f"Couldn't delete staged upload {session.id}: AccessDenied" in caplog.text
    assert url not in caplog.text and "X-Amz-Signature" not in caplog.text


# -- expiry -----------------------------------------------------------------------------------


def age(engine, session_id: str, seconds: float) -> None:
    """Move a session's clock back by `seconds`, so time passes on either database."""
    with transaction(engine) as conn:
        conn.execute(
            sa.update(upload_sessions)
            .where(upload_sessions.c.id == session_id)
            .values(
                created_at=upload_sessions.c.created_at - seconds,
                expires_at=upload_sessions.c.expires_at - seconds,
            )
        )


def test_sessions_past_their_two_days_expire_and_release_their_bytes(
    cloud_engine, uploads, fake, quota
):
    old = one(cloud_engine, uploads, FileSpec("old.mp3", 100))
    young = one(cloud_engine, uploads, FileSpec("young.mp3", 100))
    done = completed(cloud_engine, uploads, fake, size=100)
    call(cloud_engine, uploads.accept, done.id, probe(100))
    age(cloud_engine, old.id, SESSION_TTL)
    age(cloud_engine, young.id, SESSION_TTL - 600)
    age(cloud_engine, done.id, SESSION_TTL * 2)
    with transaction(cloud_engine) as conn:
        assert uploads.expire_sessions(conn) == 1
    expired = call(cloud_engine, uploads.get, old.id)
    assert expired.status is Status.EXPIRED and "expired" in expired.error
    assert old.upload_id not in fake.uploads
    assert old.reservation_id in quota.released
    assert call(cloud_engine, uploads.get, young.id).status is Status.UPLOADING
    assert call(cloud_engine, uploads.get, done.id).status is Status.ACCEPTED


def test_expiry_runs_in_bounded_batches(cloud_engine, uploads):
    sessions = [one(cloud_engine, uploads, FileSpec(f"{n}.mp3", 100)) for n in range(5)]
    for session in sessions:
        age(cloud_engine, session.id, SESSION_TTL)
    with transaction(cloud_engine) as conn:
        assert uploads.expire_sessions(conn, limit=3) == 3
    latest = max(session.expires_at for session in sessions)
    with transaction(cloud_engine) as conn:
        assert uploads.expire_sessions(conn, now=latest) == 2
        assert uploads.expire_sessions(conn) == 0


def test_expiry_can_be_asked_about_a_given_moment(cloud_engine, uploads):
    session = one(cloud_engine, uploads, FileSpec("a.mp3", 100))
    with transaction(cloud_engine) as conn:
        assert uploads.expire_sessions(conn, now=session.expires_at - 1) == 0
        assert uploads.expire_sessions(conn, now=session.expires_at) == 1


def test_a_completed_upload_gets_two_more_days_to_be_checked(cloud_engine, uploads, fake):
    session = one(cloud_engine, uploads, FileSpec("a.mp3", 100))
    age(cloud_engine, session.id, SESSION_TTL - 600)
    send_as_planned(fake, session)
    done = call(cloud_engine, uploads.complete, session.id)
    assert done.session.expires_at == done.session.updated_at + SESSION_TTL
    assert done.session.expires_at > session.expires_at
    with transaction(cloud_engine) as conn:
        assert uploads.expire_sessions(conn, now=session.expires_at + 600) == 0


# -- display names and probes -----------------------------------------------------------------


@pytest.mark.parametrize(
    ("raw", "shown"),
    [
        ("song\x00.mp3", "song.mp3"),
        ("photo‮3pm.exe", "photo3pm.exe"),
        ("\U0001f3a7 Mix \U0001f525.mp3", "\U0001f3a7 Mix \U0001f525.mp3"),
        ("Beyoncé.mp3", "Beyoncé.mp3"),
        ("", "Untitled"),
    ],
)
def test_display_names_are_sanitised_before_they_are_stored(cloud_engine, uploads, raw, shown):
    session = one(cloud_engine, uploads, FileSpec(raw, 100))
    assert session.display_name == shown
    assert call(cloud_engine, uploads.get, session.id).display_name == shown


def test_very_long_display_names_fit_the_column(cloud_engine, uploads):
    session = one(cloud_engine, uploads, FileSpec("é" * 10_000 + ".mp3", 100))
    stored = call(cloud_engine, uploads.get, session.id).display_name
    assert len(stored) == MAX_DISPLAY_NAME
    assert unicodedata.is_normalized("NFC", stored)


@pytest.mark.parametrize(
    "changes",
    [
        {"format": "MP3"},
        {"format": ""},
        {"format": "x" * 17},
        {"sha": "ABC"},
        {"duration_s": 0.0},
        {"duration_s": -1.0},
        {"duration_s": float("nan")},
        {"duration_s": float("inf")},
        {"sample_rate": 0},
        {"channels": 0},
    ],
)
def test_a_probe_must_describe_real_audio(changes):
    sha = changes.pop("sha", DIGEST)
    with pytest.raises(ValueError):
        probe(100, sha, **changes)


def test_sizes_and_durations_are_said_plainly():
    assert _size_text(1) == "1 MB"
    assert _size_text(200_000_000) == "200 MB"
    assert _size_text(1_000_000_000) == "1 GB"
    assert _size_text(2_500_000_000) == "2.5 GB"
    assert _minutes_text(30) == "1 minute"
    assert _minutes_text(150) == "2 minutes"


INJECTIONS = [
    "'; DROP TABLE upload_sessions; --",
    '" OR 1=1 --',
    "Robert'); DELETE FROM assets; --",
    "%' OR '1'='1",
    "\\'; SELECT pg_sleep(10); --",
    "x" * 5000,
    "名前'--",
    "\x00'; --",
]


@pytest.mark.parametrize("payload", INJECTIONS)
def test_injection_payloads_in_file_details_are_stored_as_plain_text(cloud_engine, uploads,
                                                                     payload):
    other = one(cloud_engine, uploads, FileSpec("keep.mp3", 100), workspace=OTHER)
    session = one(cloud_engine, uploads, FileSpec(payload, 100, payload, payload))
    stored = call(cloud_engine, uploads.get, session.id)
    assert stored.display_name == display_name(payload)
    assert stored.content_type == "application/octet-stream"
    assert stored.sha256 is None
    assert count_sessions(cloud_engine) == 2
    assert call(cloud_engine, uploads.get, other.id, workspace=OTHER).display_name == "keep.mp3"


@pytest.mark.parametrize("payload", [p for p in INJECTIONS if "\x00" not in p])
def test_injection_payloads_as_ids_find_nothing(cloud_engine, uploads, payload):
    session = one(cloud_engine, uploads, FileSpec("a.mp3", 100))
    with pytest.raises(SessionNotFound):
        call(cloud_engine, uploads.get, payload)
    with pytest.raises(SessionNotFound):
        call(cloud_engine, uploads.complete, payload)
    with pytest.raises(SessionNotFound):
        call(cloud_engine, uploads.get, session.id, workspace=payload)
    with transaction(cloud_engine) as conn:
        assert uploads.active_sessions(conn, payload) == []
    assert call(cloud_engine, uploads.get, session.id).status is Status.UPLOADING


def test_a_nul_in_an_id_finds_nothing_on_sqlite(sqlite_engine, uploads):
    with pytest.raises(SessionNotFound):
        call(sqlite_engine, uploads.get, "\x00'; --")


def test_quota_refusals_say_what_is_free_or_use_the_quota_packages_words():
    assert str(QuotaExceeded("w", 10)) == "There isn't enough storage left for this file."
    assert str(QuotaExceeded("w", 10, -5)) == (
        "There isn't enough storage left for this file: it needs 10 bytes and 0 are free."
    )
    refused = QuotaExceeded("w", 10, 3, message="That needs 10 B, and 7 B of 10 B is in use.")
    assert str(refused) == "That needs 10 B, and 7 B of 10 B is in use."
    assert (refused.workspace_id, refused.requested, refused.available) == ("w", 10, 3)


def test_plan_limits_come_from_the_workspace_each_time(cloud_engine, fake, quota):
    asked: list[str] = []

    class Recording:
        def limits(self, conn, workspace_id):
            asked.append(workspace_id)
            return PlanLimits(1000)

    uploads = Uploads(fake, quota=quota, limits=Recording())
    plan(cloud_engine, uploads, FileSpec("a", 1), FileSpec("b", 1))
    plan(cloud_engine, uploads, FileSpec("c", 1), workspace=OTHER)
    assert asked == [WS, OTHER]
