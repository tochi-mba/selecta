"""Completing an upload on the server (ADR-0398, spec 5.2 step 4, test plan 18.15).

The server lists every part, checks the total is exactly the declared, reserved size and the
parts follow the plan (one fixed 8 MiB size, every part but the last that size), then completes
the upload itself. Anything else is aborted and its reservation released. Includes a Hypothesis
property over random part lists, and a run against the real quota tables.
"""

from __future__ import annotations

import pytest
import sqlalchemy as sa
from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st
from test_cloud_storage_fakes import FakeS3, Limits, Quota, r2_would_accept

from selecta.persistence import transaction
from selecta.storage.objects import GiB, MiB, ObjectHead, Part, R2Error, R2NotFound
from selecta.storage.parts import MAX_PARTS, PART_SIZE, check_parts
from selecta.storage.schema import upload_sessions
from selecta.storage.uploads import (
    SESSION_TTL,
    FileSpec,
    Probe,
    Status,
    Uploads,
)
from selecta.usage import quota as real_quota

WS = "ws-a"
STAGING = "sel-staging"


@pytest.fixture
def fake() -> FakeS3:
    return FakeS3()


@pytest.fixture
def quota() -> Quota:
    return Quota()


@pytest.fixture
def uploads(fake, quota) -> Uploads:
    return Uploads(fake, quota=quota, limits=Limits(max_file_bytes=5 * GiB))


def start(engine, uploads: Uploads, size: int):
    with transaction(engine, WS) as conn:
        planned = uploads.plan_batch(conn, WS, [FileSpec("song.wav", size)])[0]
    assert planned.session is not None and planned.session.status is Status.UPLOADING
    return planned.session


def complete(engine, uploads: Uploads, session_id: str):
    with transaction(engine, WS) as conn:
        return uploads.complete(conn, session_id, workspace_id=WS)


def status_of(engine, uploads: Uploads, session_id: str) -> Status:
    with transaction(engine, WS) as conn:
        return uploads.get(conn, session_id, workspace_id=WS).status


def shift_expiry(engine, session_id: str, seconds: float) -> None:
    """Move a session's expiry, so time passes on either database."""
    with transaction(engine) as conn:
        conn.execute(
            sa.update(upload_sessions)
            .where(upload_sessions.c.id == session_id)
            .values(expires_at=upload_sessions.c.expires_at + seconds)
        )


def planned_sizes(size: int) -> list[int]:
    count = -(-size // PART_SIZE)
    return [PART_SIZE] * (count - 1) + [size - PART_SIZE * (count - 1)]


# -- the happy path ---------------------------------------------------------------------------


@pytest.mark.parametrize("size", [1, 5 * MiB, PART_SIZE, PART_SIZE + 1, 3 * PART_SIZE, 1 * GiB])
def test_correct_parts_complete(cloud_engine, uploads, fake, quota, size):
    session = start(cloud_engine, uploads, size)
    fake.upload_sizes(session.upload_id, planned_sizes(size))
    outcome = complete(cloud_engine, uploads, session.id)
    assert outcome.status is Status.COMPLETED and outcome.error is None
    assert fake.objects[(STAGING, session.staging_key)].size == size
    assert session.upload_id not in fake.uploads
    assert quota.released == [] and quota.reserved == {session.reservation_id: size}
    assert status_of(cloud_engine, uploads, session.id) is Status.COMPLETED


def test_completion_reads_every_page_of_parts(cloud_engine, quota):
    fake = FakeS3(list_page_size=10)
    uploads = Uploads(fake, quota=quota, limits=Limits(max_file_bytes=5 * GiB))
    session = start(cloud_engine, uploads, 1 * GiB)
    fake.upload_sizes(session.upload_id, planned_sizes(1 * GiB))
    assert complete(cloud_engine, uploads, session.id).status is Status.COMPLETED
    assert fake.pages_read == 13


def test_the_server_lists_parts_itself_and_ignores_nothing(cloud_engine, uploads, fake):
    session = start(cloud_engine, uploads, 2 * PART_SIZE)
    fake.upload_sizes(session.upload_id, [PART_SIZE, PART_SIZE])
    complete(cloud_engine, uploads, session.id)
    names = [call[0] for call in fake.calls]
    assert names.index("list_parts") < names.index("complete_multipart_upload")
    assert names[-1] == "head_object"


# -- refusals that abort and release ----------------------------------------------------------


REFUSALS = [
    pytest.param(
        3 * PART_SIZE, [PART_SIZE, PART_SIZE, PART_SIZE - 1],
        "Less data arrived than the file's declared size.", id="total-short",
    ),
    pytest.param(
        3 * PART_SIZE, [PART_SIZE, PART_SIZE, PART_SIZE, 1],
        "More data arrived than the file's declared size.", id="total-over",
    ),
    pytest.param(
        3 * PART_SIZE, [PART_SIZE, PART_SIZE - MiB, PART_SIZE + MiB],
        "The file's parts weren't the agreed size.", id="unequal-middle-parts",
    ),
    pytest.param(
        2 * PART_SIZE + MiB, [PART_SIZE, PART_SIZE + MiB],
        "The file's last part wasn't the expected size.", id="last-part-larger",
    ),
    pytest.param(
        3 * PART_SIZE, {1: PART_SIZE, 3: PART_SIZE},
        "Some parts of the file are missing.", id="missing-part-number",
    ),
    pytest.param(
        4 * PART_SIZE, {1: PART_SIZE, 2: PART_SIZE, 4: 2 * PART_SIZE},
        "Some parts of the file are missing.", id="gap",
    ),
    pytest.param(3 * PART_SIZE, [], "No data arrived for this file.", id="nothing-sent"),
]


@pytest.mark.parametrize(("declared", "sent", "reason"), REFUSALS)
def test_a_bad_upload_is_aborted_and_its_reservation_released(
    cloud_engine, uploads, fake, quota, declared, sent, reason
):
    session = start(cloud_engine, uploads, declared)
    sizes = sent if isinstance(sent, dict) else dict(enumerate(sent, start=1))
    for number, size in sizes.items():
        fake.upload_part(session.upload_id, number, size)
    outcome = complete(cloud_engine, uploads, session.id)
    assert outcome.status is Status.ABORTED
    assert outcome.error == reason
    assert quota.released == [session.reservation_id] and quota.used == 0
    assert session.upload_id not in fake.uploads
    assert fake.count("complete_multipart_upload") == 0
    assert (STAGING, session.staging_key) not in fake.objects
    assert status_of(cloud_engine, uploads, session.id) is Status.ABORTED


def test_completing_twice_gives_the_same_outcome(cloud_engine, uploads, fake):
    good = start(cloud_engine, uploads, PART_SIZE + 5)
    fake.upload_sizes(good.upload_id, planned_sizes(PART_SIZE + 5))
    first = complete(cloud_engine, uploads, good.id)
    calls = len(fake.calls)
    second = complete(cloud_engine, uploads, good.id)
    assert second.status is first.status is Status.COMPLETED
    assert second.session.expires_at == first.session.expires_at
    assert len(fake.calls) == calls

    bad = start(cloud_engine, uploads, PART_SIZE + 5)
    fake.upload_sizes(bad.upload_id, [PART_SIZE])
    first = complete(cloud_engine, uploads, bad.id)
    second = complete(cloud_engine, uploads, bad.id)
    assert first.status is second.status is Status.ABORTED
    assert first.error == second.error


def test_an_expired_session_cannot_complete(cloud_engine, uploads, fake, quota):
    session = start(cloud_engine, uploads, PART_SIZE)
    fake.upload_sizes(session.upload_id, [PART_SIZE])
    shift_expiry(cloud_engine, session.id, -SESSION_TTL)
    outcome = complete(cloud_engine, uploads, session.id)
    assert outcome.status is Status.EXPIRED
    assert "expired" in outcome.error
    assert fake.count("complete_multipart_upload") == 0
    assert (STAGING, session.staging_key) not in fake.objects
    assert session.upload_id not in fake.uploads
    assert quota.released == [session.reservation_id]
    # And it stays that way: asking again changes nothing.
    assert complete(cloud_engine, uploads, session.id).status is Status.EXPIRED


def test_a_session_just_inside_its_two_days_still_completes(cloud_engine, uploads, fake):
    session = start(cloud_engine, uploads, PART_SIZE)
    fake.upload_sizes(session.upload_id, [PART_SIZE])
    shift_expiry(cloud_engine, session.id, -(SESSION_TTL - 600))
    assert complete(cloud_engine, uploads, session.id).status is Status.COMPLETED


def test_a_session_that_never_started_has_nothing_to_complete(cloud_engine, uploads, fake, quota):
    fake.fail_next("create_multipart_upload", R2Error("down", status=503))
    with transaction(cloud_engine, WS) as conn:
        session = uploads.plan_batch(conn, WS, [FileSpec("a.wav", 10)])[0].session
    assert session.status is Status.PLANNED
    outcome = complete(cloud_engine, uploads, session.id)
    assert outcome.status is Status.ABORTED and outcome.error == "No data arrived for this file."
    assert quota.released == [session.reservation_id]


# -- R2 answering in the middle ---------------------------------------------------------------


def test_an_upload_r2_already_completed_is_recognised_by_its_object(cloud_engine, uploads, fake):
    session = start(cloud_engine, uploads, PART_SIZE)
    fake.upload_sizes(session.upload_id, [PART_SIZE])
    # An earlier call completed it in R2, then lost its transaction.
    fake.complete_multipart_upload(
        STAGING, session.staging_key, session.upload_id,
        fake.list_parts(STAGING, session.staging_key, session.upload_id),
    )
    assert complete(cloud_engine, uploads, session.id).status is Status.COMPLETED


def test_an_upload_lost_from_r2_is_aborted(cloud_engine, uploads, fake, quota):
    session = start(cloud_engine, uploads, PART_SIZE)
    fake.abort_multipart_upload(STAGING, session.staging_key, session.upload_id)
    outcome = complete(cloud_engine, uploads, session.id)
    assert outcome.status is Status.ABORTED and "lost before it finished" in outcome.error
    assert quota.released == [session.reservation_id]


def test_an_upload_completed_between_listing_and_completing_is_settled(
    cloud_engine, uploads, fake
):
    session = start(cloud_engine, uploads, PART_SIZE)
    fake.upload_sizes(session.upload_id, [PART_SIZE])
    fake.fail_next("complete_multipart_upload", R2NotFound("gone", code="NoSuchUpload"))
    fake.put_size(STAGING, session.staging_key, PART_SIZE)
    assert complete(cloud_engine, uploads, session.id).status is Status.COMPLETED


@pytest.mark.parametrize("code", ["InvalidPart", "InvalidPartOrder", "EntityTooSmall"])
def test_parts_r2_refuses_abort_the_upload(cloud_engine, uploads, fake, quota, code):
    session = start(cloud_engine, uploads, PART_SIZE)
    fake.upload_sizes(session.upload_id, [PART_SIZE])
    fake.fail_next("complete_multipart_upload", R2Error("bad", status=400, code=code))
    outcome = complete(cloud_engine, uploads, session.id)
    assert outcome.status is Status.ABORTED
    assert outcome.error == "The file's parts didn't fit together."
    assert quota.released == [session.reservation_id]


@pytest.mark.parametrize("operation", ["list_parts", "complete_multipart_upload", "head_object"])
def test_a_retryable_r2_error_leaves_the_session_as_it_was(
    cloud_engine, uploads, fake, quota, operation
):
    session = start(cloud_engine, uploads, PART_SIZE)
    fake.upload_sizes(session.upload_id, [PART_SIZE])
    fake.fail_next(operation, R2Error("busy", status=503, code="SlowDown"))
    with pytest.raises(R2Error) as caught:
        complete(cloud_engine, uploads, session.id)
    assert caught.value.retryable
    assert status_of(cloud_engine, uploads, session.id) is Status.UPLOADING
    assert quota.released == []
    if operation != "head_object":
        assert complete(cloud_engine, uploads, session.id).status is Status.COMPLETED


def test_a_finished_object_of_the_wrong_size_is_aborted(cloud_engine, uploads, fake, quota):
    session = start(cloud_engine, uploads, PART_SIZE)
    fake.upload_sizes(session.upload_id, [PART_SIZE])
    real_head = fake.head_object

    def replaced_after_listing(bucket, key):
        head = real_head(bucket, key)
        return ObjectHead(head.key, head.size + 1, head.etag)

    fake.head_object = replaced_after_listing  # type: ignore[method-assign]
    outcome = complete(cloud_engine, uploads, session.id)
    assert outcome.status is Status.ABORTED
    assert outcome.error == "The finished file wasn't the size that was declared."
    assert quota.released == [session.reservation_id]


# -- the property -----------------------------------------------------------------------------


def _follows_the_plan(parts: list[Part], declared: int) -> bool:
    """The oracle, written independently of `check_parts`: R2's rules with the agreed size."""
    if not parts or len(parts) > MAX_PARTS:
        return False
    ordered = sorted(parts, key=lambda part: part.number)
    if [part.number for part in ordered] != list(range(1, len(ordered) + 1)):
        return False
    if sum(part.size for part in ordered) != declared:
        return False
    if any(part.size != PART_SIZE for part in ordered[:-1]):
        return False
    return 1 <= ordered[-1].size <= PART_SIZE


SIZES = st.one_of(
    st.just(PART_SIZE),
    st.integers(1, 2 * PART_SIZE),
    st.sampled_from([5 * MiB, 5 * MiB - 1, PART_SIZE - 1, PART_SIZE + 1, 1]),
)


@st.composite
def part_lists(draw) -> tuple[int, list[Part]]:
    declared = draw(st.integers(1, 6 * PART_SIZE))
    sizes = planned_sizes(declared)
    mutation = draw(
        st.sampled_from(["none", "resize", "drop", "extra", "renumber", "shuffle", "random"])
    )
    if mutation == "resize":
        index = draw(st.integers(0, len(sizes) - 1))
        sizes[index] = draw(SIZES)
    elif mutation == "drop" and len(sizes) > 1:
        sizes.pop(draw(st.integers(0, len(sizes) - 1)))
    elif mutation == "extra":
        sizes.append(draw(SIZES))
    elif mutation == "random":
        sizes = draw(st.lists(SIZES, min_size=0, max_size=8))
    numbers = list(range(1, len(sizes) + 1))
    if mutation == "renumber" and numbers:
        numbers[draw(st.integers(0, len(numbers) - 1))] = draw(st.integers(0, 12))
    parts = [Part(n, f"e{n}", size) for n, size in zip(numbers, sizes, strict=True)]
    if mutation == "shuffle":
        parts = draw(st.permutations(parts))
    return declared, parts


class Scripted(FakeS3):
    """ListParts answers with exactly the part list under test, in part-number order as the
    `ObjectClient` contract (and R2) promise."""

    def __init__(self, parts: list[Part]) -> None:
        super().__init__()
        self.scripted = parts

    def list_parts(self, bucket, key, upload_id):
        self._enter("list_parts", bucket, key, upload_id)
        return sorted(self.scripted, key=lambda part: part.number)

    def complete_multipart_upload(self, bucket, key, upload_id, parts):
        self._enter("complete_multipart_upload", bucket, key, upload_id)
        if not r2_would_accept(list(parts)):
            raise R2Error("R2 refused", status=400, code="InvalidPart")
        self.put_size(bucket, key, sum(part.size for part in parts))
        return "final"


@settings(suppress_health_check=[HealthCheck.function_scoped_fixture])
@given(case=part_lists())
def test_property_completion_succeeds_exactly_when_the_r2_rules_hold_and_the_total_matches(
    sqlite_engine, case
):
    declared, parts = case
    fake = Scripted(parts)
    quota = Quota()
    uploads = Uploads(fake, quota=quota, limits=Limits(max_file_bytes=5 * GiB))
    session = start(sqlite_engine, uploads, declared)
    outcome = complete(sqlite_engine, uploads, session.id)

    expected = _follows_the_plan(parts, declared)
    assert (outcome.status is Status.COMPLETED) is expected
    assert (check_parts(parts, declared, PART_SIZE) is None) is expected
    if expected:
        # Whatever the server completes, R2 would have accepted too.
        assert r2_would_accept(sorted(parts, key=lambda p: p.number))
        assert quota.released == []
    else:
        assert outcome.status is Status.ABORTED
        assert quota.released == [session.reservation_id]
        assert fake.count("complete_multipart_upload") == 0


# -- against the real quota tables ------------------------------------------------------------


class RealQuota:
    def reserve(self, conn, workspace_id, size, session_id):
        return real_quota.reserve(conn, workspace_id, size, session_id).id

    def commit(self, conn, reservation_id):
        real_quota.commit(conn, reservation_id)

    def release(self, conn, reservation_id):
        real_quota.release(conn, reservation_id)


def _usage(engine):
    with transaction(engine, WS) as conn:
        return real_quota.usage(conn, WS)


def test_an_abort_gives_the_reserved_bytes_back_in_the_database(cloud_engine, fake):
    uploads = Uploads(fake, quota=RealQuota(), limits=Limits())
    session = start(cloud_engine, uploads, 3 * PART_SIZE)
    assert _usage(cloud_engine).reserved_bytes == 3 * PART_SIZE
    fake.upload_sizes(session.upload_id, [PART_SIZE, PART_SIZE + 1, PART_SIZE - 1])
    assert complete(cloud_engine, uploads, session.id).status is Status.ABORTED
    usage = _usage(cloud_engine)
    assert (usage.reserved_bytes, usage.committed_bytes) == (0, 0)


def test_an_accepted_upload_turns_its_reservation_into_committed_bytes(cloud_engine, fake):
    uploads = Uploads(fake, quota=RealQuota(), limits=Limits())
    session = start(cloud_engine, uploads, PART_SIZE + 10)
    fake.upload_sizes(session.upload_id, planned_sizes(PART_SIZE + 10))
    complete(cloud_engine, uploads, session.id)
    digest = "d" * 64
    with transaction(cloud_engine, WS) as conn:
        outcome = uploads.accept(
            conn, session.id, Probe("wav", 60.0, 44_100, 2, digest, PART_SIZE + 10),
            workspace_id=WS,
        )
    assert outcome.status is Status.ACCEPTED
    usage = _usage(cloud_engine)
    assert (usage.reserved_bytes, usage.committed_bytes) == (0, PART_SIZE + 10)
    with transaction(cloud_engine, WS) as conn:
        states = conn.execute(
            sa.select(real_quota.storage_reservations.c.state)
        ).scalars().all()
    assert states == ["committed"]
