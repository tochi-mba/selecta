"""Storage quotas: reservations at, under and over the limit, commit, release and expiry, deletions
and over-quota read-only (ADR-0398, ADR-0402; docs/saas/05-storage-uploads-playback.md §5.3 to
§5.5; docs/saas/18-test-plan.md §18.9)."""

from __future__ import annotations

import random
import threading
import uuid

import pytest
import sqlalchemy as sa
from hypothesis import settings
from hypothesis import strategies as st
from hypothesis.stateful import (
    Bundle,
    RuleBasedStateMachine,
    initialize,
    invariant,
    rule,
    run_state_machine_as_test,
)

from selecta.billing.plans import GB, MB, plan_for
from selecta.persistence import transaction
from selecta.usage import ledger, quota
from selecta.usage.quota import QuotaExceeded, QuotaStatus, ReservationClosed, ReservationState
from selecta.usage.schema import storage_reservations

FREE = plan_for("free")
STANDARD = plan_for("standard")
PREMIUM = plan_for("premium")
WS = "ws-quota"


def run(engine, action, *args, workspace=WS, **kwargs):
    with transaction(engine, workspace) as conn:
        return action(conn, *args, **kwargs)


def reserve(engine, size, session="upload-1", workspace=WS, **kwargs) -> quota.Reservation:
    return run(engine, quota.reserve, workspace, size, session, workspace=workspace, **kwargs)


def usage(engine, workspace=WS) -> quota.Usage:
    return run(engine, quota.usage, workspace, workspace=workspace)


def set_plan(engine, plan, workspace=WS, **kwargs) -> quota.Usage:
    return run(engine, quota.set_limit, workspace, plan, workspace=workspace, **kwargs)


def commit(engine, reservation, workspace=WS) -> quota.Reservation:
    return run(engine, quota.commit, reservation.id, workspace=workspace)


def release(engine, reservation, workspace=WS) -> quota.Reservation:
    return run(engine, quota.release, reservation.id, workspace=workspace)


def delete(engine, size, workspace=WS, ref=None) -> quota.Usage:
    return run(engine, quota.release_deleted, workspace, size, ref=ref, workspace=workspace)


def filled(engine, size, workspace=WS, plan=FREE) -> None:
    """Commit `size` bytes on `plan`."""
    set_plan(engine, plan, workspace)
    commit(engine, reserve(engine, size, f"fill-{uuid.uuid4()}", workspace), workspace)


def storage_ledger(engine, workspace=WS) -> float:
    with transaction(engine, workspace) as conn:
        return ledger.totals(conn, workspace).get("storage_bytes", 0.0)


def active_bytes(engine, workspace=WS) -> int:
    with transaction(engine, workspace) as conn:
        query = sa.select(sa.func.coalesce(sa.func.sum(storage_reservations.c.bytes), 0)).where(
            (storage_reservations.c.workspace_id == workspace)
            & (storage_reservations.c.state == ReservationState.ACTIVE.value)
        )
        return int(conn.execute(query).scalar_one())


# Where a workspace stands


def test_a_workspace_with_no_quota_row_is_on_the_free_plan_with_nothing_used(cloud_engine):
    found = usage(cloud_engine)
    assert (found.plan_id, found.plan_version, found.limit_bytes) == ("free", 1, 10 * GB)
    assert (found.committed_bytes, found.reserved_bytes, found.used_bytes) == (0, 0, 0)
    assert found.state is QuotaStatus.OK
    assert not found.read_only
    assert found.available_bytes == 10 * GB
    assert found.over_since is None


def test_usage_is_committed_plus_reserved_and_never_shows_negative_space():
    found = quota.Usage("w", "free", 1, 10, 8, 4, QuotaStatus.OK, None)
    assert found.used_bytes == 12
    assert found.available_bytes == 0
    assert found.over_by_bytes == 0
    over = quota.Usage("w", "free", 1, 10, 15, 0, QuotaStatus.OVER, 1.0)
    assert over.over_by_bytes == 5
    assert over.read_only


@pytest.mark.parametrize(
    ("size", "text"),
    [(18_400_000_000, "18.4 GB"), (10 * GB, "10 GB"), (0, "0 GB"), (35 * GB, "35 GB")],
)
def test_sizes_are_shown_in_decimal_gigabytes(size, text):
    assert quota.gigabytes(size) == text


# Reserving


def test_a_reservation_within_the_limit_succeeds(cloud_engine):
    found = reserve(cloud_engine, 100 * MB)
    assert found.state is ReservationState.ACTIVE
    assert (found.workspace_id, found.upload_session_id, found.bytes) == (WS, "upload-1", 100 * MB)
    assert found.expires_at == pytest.approx(found.created_at + quota.RESERVATION_TTL)
    assert found.settled_at is None
    assert usage(cloud_engine).reserved_bytes == 100 * MB


def test_a_reservation_exactly_at_the_limit_succeeds(cloud_engine):
    filled(cloud_engine, 9 * GB)
    reserve(cloud_engine, 1 * GB)
    found = usage(cloud_engine)
    assert found.used_bytes == found.limit_bytes
    assert found.available_bytes == 0
    assert found.state is QuotaStatus.OK


def test_a_reservation_one_byte_over_the_limit_is_refused(cloud_engine):
    filled(cloud_engine, 9 * GB)
    with pytest.raises(QuotaExceeded) as refused:
        reserve(cloud_engine, 1 * GB + 1)
    assert refused.value.requested == 1 * GB + 1
    assert not refused.value.read_only
    assert str(refused.value) == "That needs 1.0 GB, and 9 GB of 10 GB is in use."
    assert usage(cloud_engine).reserved_bytes == 0
    assert active_bytes(cloud_engine) == 0


def test_a_whole_empty_allowance_can_be_reserved_at_once_but_not_a_byte_more(cloud_engine):
    with pytest.raises(QuotaExceeded):
        reserve(cloud_engine, 10 * GB + 1)
    reserve(cloud_engine, 10 * GB)
    with pytest.raises(QuotaExceeded):
        reserve(cloud_engine, 1, session="upload-2")


def test_reservations_in_flight_count_against_the_limit(cloud_engine):
    reserve(cloud_engine, 6 * GB, session="a")
    with pytest.raises(QuotaExceeded, match="needs 4.5 GB, and 6 GB of 10 GB is in use"):
        reserve(cloud_engine, 4_500_000_000, session="b")
    reserve(cloud_engine, 4 * GB, session="c")
    assert usage(cloud_engine).reserved_bytes == 10 * GB


@pytest.mark.parametrize("size", [0, -1, -(10 * GB), True, False, 1.5, 1e9, "100", None])
def test_a_reservation_of_zero_negative_or_not_whole_bytes_is_refused(cloud_engine, size):
    with pytest.raises(ValueError, match="whole number of bytes above 0"):
        reserve(cloud_engine, size)
    assert usage(cloud_engine).used_bytes == 0


@pytest.mark.parametrize("ttl", [0, -1])
def test_a_reservation_needs_a_time_to_live(cloud_engine, ttl):
    with pytest.raises(ValueError, match="time to live"):
        reserve(cloud_engine, 1, ttl=ttl)


def test_asking_again_for_the_same_upload_returns_the_same_reservation(cloud_engine):
    first = reserve(cloud_engine, 1 * GB)
    again = reserve(cloud_engine, 2 * GB)
    assert again == first
    assert usage(cloud_engine).reserved_bytes == 1 * GB
    commit(cloud_engine, first)
    after = reserve(cloud_engine, 1 * GB)
    assert (after.id, after.state) == (first.id, ReservationState.COMMITTED)
    assert usage(cloud_engine).used_bytes == 1 * GB


def test_the_same_upload_id_in_another_workspace_is_another_reservation(cloud_engine):
    mine = reserve(cloud_engine, 1 * GB, workspace="ws-a")
    theirs = reserve(cloud_engine, 1 * GB, workspace="ws-b")
    assert mine.id != theirs.id
    assert usage(cloud_engine, "ws-a").reserved_bytes == 1 * GB
    assert usage(cloud_engine, "ws-b").reserved_bytes == 1 * GB


# Commit and release


def test_commit_moves_reserved_bytes_to_committed_and_records_them(cloud_engine):
    held = reserve(cloud_engine, 300 * MB)
    done = commit(cloud_engine, held)
    assert done.state is ReservationState.COMMITTED
    assert done.settled_at is not None
    found = usage(cloud_engine)
    assert (found.committed_bytes, found.reserved_bytes) == (300 * MB, 0)
    with transaction(cloud_engine, WS) as conn:
        rows = conn.execute(sa.select(ledger.usage_ledger)).all()
    assert len(rows) == 1
    assert (rows[0].kind, rows[0].amount, rows[0].ref) == ("storage_bytes", 300 * MB, held.id)
    assert rows[0].detail == {"upload_session_id": "upload-1"}


def test_committing_twice_changes_nothing_the_second_time(cloud_engine):
    held = reserve(cloud_engine, 300 * MB)
    first = commit(cloud_engine, held)
    second = commit(cloud_engine, held)
    assert second == first
    assert usage(cloud_engine).committed_bytes == 300 * MB
    assert storage_ledger(cloud_engine) == 300 * MB


def test_release_frees_the_bytes_and_releasing_twice_changes_nothing(cloud_engine):
    held = reserve(cloud_engine, 2 * GB)
    first = release(cloud_engine, held)
    assert first.state is ReservationState.RELEASED
    second = release(cloud_engine, held)
    assert second == first
    found = usage(cloud_engine)
    assert (found.committed_bytes, found.reserved_bytes) == (0, 0)
    assert storage_ledger(cloud_engine) == 0


def test_a_released_reservation_cannot_be_committed(cloud_engine):
    held = reserve(cloud_engine, 2 * GB)
    release(cloud_engine, held)
    with pytest.raises(ReservationClosed, match="was released, so it can't be committed"):
        commit(cloud_engine, held)
    assert usage(cloud_engine).committed_bytes == 0


def test_releasing_a_committed_reservation_leaves_it_committed(cloud_engine):
    held = reserve(cloud_engine, 2 * GB)
    commit(cloud_engine, held)
    assert release(cloud_engine, held).state is ReservationState.COMMITTED
    assert usage(cloud_engine).committed_bytes == 2 * GB


def test_settling_a_reservation_that_does_not_exist_is_a_lookup_error(cloud_engine):
    missing = quota.Reservation("nope", WS, "s", 1, ReservationState.ACTIVE, 0, 0, None)
    with pytest.raises(LookupError, match="no reservation nope"):
        commit(cloud_engine, missing)
    with pytest.raises(LookupError):
        release(cloud_engine, missing)


# Expiry


def test_reservations_that_ran_out_are_released_by_the_maintenance_leader(cloud_engine, clock):
    ran_out = reserve(cloud_engine, 1 * GB, session="old", ttl=1e-6)
    other = reserve(cloud_engine, 1 * GB, session="other", workspace="ws-other", ttl=1e-6)
    alive = reserve(cloud_engine, 2 * GB, session="new")
    clock.advance(1)
    assert quota.expire_reservations(cloud_engine) == 2
    assert usage(cloud_engine).reserved_bytes == 2 * GB
    assert usage(cloud_engine, "ws-other").reserved_bytes == 0
    assert active_bytes(cloud_engine) == alive.bytes
    with pytest.raises(ReservationClosed, match="was expired"):
        commit(cloud_engine, ran_out)
    assert release(cloud_engine, other, "ws-other").state is ReservationState.EXPIRED
    assert quota.expire_reservations(cloud_engine) == 0


def test_expiry_works_through_workspaces_in_batches(cloud_engine, clock):
    for n in range(3):
        reserve(cloud_engine, 1 * GB, session="s", workspace=f"ws-{n}", ttl=1e-6)
    clock.advance(1)
    assert quota.expire_reservations(cloud_engine, batch=2) == 2
    assert quota.expire_reservations(cloud_engine, batch=2) == 1
    assert quota.expire_reservations(cloud_engine, batch=2) == 0


def test_a_reservation_committed_just_before_expiry_is_not_expired(cloud_engine, clock):
    held = reserve(cloud_engine, 1 * GB, ttl=1e-6)
    commit(cloud_engine, held)
    clock.advance(1)
    assert quota.expire_reservations(cloud_engine) == 0
    assert usage(cloud_engine).committed_bytes == 1 * GB


def test_a_reservation_expires_at_the_end_of_its_upload_session(sqlite_engine, clock):
    reserve(sqlite_engine, 1 * GB)
    clock.advance(quota.RESERVATION_TTL - 1)
    assert quota.expire_reservations(sqlite_engine) == 0
    clock.advance(1)
    assert quota.expire_reservations(sqlite_engine) == 1


def test_expiry_skips_a_workspace_whose_reservations_were_settled_meanwhile(
    sqlite_engine, clock, monkeypatch
):
    held = reserve(sqlite_engine, 1 * GB, ttl=10)
    clock.advance(20)
    calls = []

    def settle_first(engine, workspace_id=None):
        calls.append(workspace_id)
        if workspace_id is not None:
            # Another transaction commits the upload between the scan and the lock.
            commit(sqlite_engine, held)
        return transaction(engine, workspace_id)

    monkeypatch.setattr(quota.persistence, "transaction", settle_first)
    assert quota.expire_reservations(sqlite_engine) == 0
    monkeypatch.undo()
    assert calls == [None, WS]
    assert usage(sqlite_engine).committed_bytes == 1 * GB


# Deletions


def test_deleting_releases_its_bytes_at_once_and_records_them(cloud_engine):
    filled(cloud_engine, 3 * GB)
    after = delete(cloud_engine, 1 * GB, ref="song-1")
    assert after.committed_bytes == 2 * GB
    assert storage_ledger(cloud_engine) == 2 * GB
    with transaction(cloud_engine, WS) as conn:
        row = conn.execute(
            sa.select(ledger.usage_ledger).where(ledger.usage_ledger.c.ref == "song-1")
        ).one()
    assert (row.amount, row.detail) == (-1 * GB, None)


def test_a_deletion_never_takes_committed_bytes_below_zero(cloud_engine):
    filled(cloud_engine, 1 * GB)
    after = delete(cloud_engine, 3 * GB, ref="drifted")
    assert after.committed_bytes == 0
    with transaction(cloud_engine, WS) as conn:
        row = conn.execute(
            sa.select(ledger.usage_ledger).where(ledger.usage_ledger.c.ref == "drifted")
        ).one()
    assert (row.amount, row.detail) == (-1 * GB, {"asked": 3 * GB})
    nothing = delete(cloud_engine, 1 * GB, ref="nothing-left")
    assert nothing.committed_bytes == 0
    assert storage_ledger(cloud_engine) == 0


@pytest.mark.parametrize("size", [0, -5, True, 2.5, None])
def test_a_deletion_releases_a_whole_number_of_bytes_above_zero(cloud_engine, size):
    with pytest.raises(ValueError, match="whole number of bytes above 0"):
        delete(cloud_engine, size)


# Over quota


def test_a_downgrade_below_whats_committed_makes_the_workspace_read_only(cloud_engine):
    filled(cloud_engine, 45 * GB, plan=STANDARD)
    assert not usage(cloud_engine).read_only
    after = set_plan(cloud_engine, FREE)
    assert after.state is QuotaStatus.OVER
    assert after.read_only
    assert after.over_since is not None
    assert (after.plan_id, after.limit_bytes, after.committed_bytes) == ("free", 10 * GB, 45 * GB)
    with pytest.raises(QuotaExceeded) as refused:
        reserve(cloud_engine, 1)
    assert refused.value.read_only
    assert str(refused.value) == (
        "You're 35 GB over your plan's 10 GB. Free up space or upgrade to add more."
    )
    with pytest.raises(QuotaExceeded):
        run(cloud_engine, quota.require_writable, WS)


def test_nothing_is_deleted_and_deleting_still_works_while_read_only(cloud_engine):
    filled(cloud_engine, 45 * GB, plan=STANDARD)
    set_plan(cloud_engine, FREE)
    still_over = delete(cloud_engine, 30 * GB)
    assert still_over.read_only
    assert still_over.committed_bytes == 15 * GB


def test_read_only_clears_when_usage_falls_back_to_the_limit(cloud_engine, clock):
    filled(cloud_engine, 12 * GB, plan=STANDARD)
    went_over = set_plan(cloud_engine, FREE).over_since
    clock.advance(60)
    assert delete(cloud_engine, 1 * GB).over_since == went_over
    back = delete(cloud_engine, 1 * GB)
    assert back.committed_bytes == back.limit_bytes
    assert back.state is QuotaStatus.OK
    assert back.over_since is None
    assert run(cloud_engine, quota.require_writable, WS).state is QuotaStatus.OK
    with pytest.raises(QuotaExceeded) as full:
        reserve(cloud_engine, 1)
    assert not full.value.read_only


def test_upgrading_clears_read_only_at_once(cloud_engine):
    filled(cloud_engine, 45 * GB, plan=STANDARD)
    set_plan(cloud_engine, FREE)
    after = set_plan(cloud_engine, PREMIUM)
    assert after.state is QuotaStatus.OK
    assert (after.plan_id, after.limit_bytes) == ("premium", 100 * GB)
    reserve(cloud_engine, 55 * GB)


def test_an_upload_accepted_after_a_downgrade_can_take_the_workspace_over(cloud_engine):
    set_plan(cloud_engine, STANDARD)
    held = reserve(cloud_engine, 20 * GB)
    set_plan(cloud_engine, FREE)
    assert not usage(cloud_engine).read_only
    commit(cloud_engine, held)
    assert usage(cloud_engine).read_only


def test_an_entitlement_override_sets_its_own_limit(cloud_engine):
    after = set_plan(cloud_engine, FREE, limit_bytes=25 * GB)
    assert (after.plan_id, after.limit_bytes) == ("free", 25 * GB)
    reserve(cloud_engine, 25 * GB)
    with pytest.raises(ValueError, match="can't be negative"):
        set_plan(cloud_engine, FREE, limit_bytes=-1)
    zero = set_plan(cloud_engine, FREE, limit_bytes=0)
    assert zero.limit_bytes == 0
    assert not zero.read_only


# Many uploads at once


def race(engine, workspace: str, sizes: list[int]) -> tuple[list[int], list[int]]:
    """Start one reservation per size at the same moment. Returns the sizes that got through
    and those refused; any other error fails the test."""
    accepted: list[int] = []
    refused: list[int] = []
    errors: list[BaseException] = []
    start = threading.Barrier(len(sizes))
    lock = threading.Lock()

    def attempt(n: int, size: int) -> None:
        try:
            start.wait()
            with transaction(engine, workspace) as conn:
                quota.reserve(conn, workspace, size, f"upload-{n}")
            outcome = accepted
        except QuotaExceeded:
            outcome = refused
        except BaseException as error:  # noqa: BLE001
            errors.append(error)
            return
        with lock:
            outcome.append(size)

    threads = [threading.Thread(target=attempt, args=(n, s)) for n, s in enumerate(sizes)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    assert errors == []
    return accepted, refused


def assert_never_oversubscribed(engine, workspace, accepted, refused) -> None:
    found = usage(engine, workspace)
    assert found.used_bytes <= found.limit_bytes
    assert found.reserved_bytes == sum(accepted) == active_bytes(engine, workspace)
    # Usage only grew during the race, so every refusal really didn't fit.
    assert all(size > found.available_bytes for size in refused)


def test_two_hundred_reservations_for_the_last_gigabyte_never_oversubscribe(postgres_engine):
    filled(postgres_engine, 9 * GB, workspace="ws-race")
    accepted, refused = race(postgres_engine, "ws-race", [10 * MB] * 200)
    assert len(accepted) == 100
    assert len(refused) == 100
    assert_never_oversubscribed(postgres_engine, "ws-race", accepted, refused)
    assert usage(postgres_engine, "ws-race").used_bytes == 10 * GB


def test_uneven_reservations_for_the_last_gigabyte_never_oversubscribe(postgres_engine):
    filled(postgres_engine, 9 * GB, workspace="ws-uneven")
    sizes = [random.Random(n).randint(1, 40 * MB) for n in range(200)]
    accepted, refused = race(postgres_engine, "ws-uneven", sizes)
    assert refused
    assert_never_oversubscribed(postgres_engine, "ws-uneven", accepted, refused)


def test_first_uploads_racing_to_create_the_quota_row_never_oversubscribe(postgres_engine):
    accepted, refused = race(postgres_engine, "ws-new", [1 * GB] * 50)
    assert len(accepted) == 10
    assert_never_oversubscribed(postgres_engine, "ws-new", accepted, refused)


def test_reservations_racing_on_sqlite_never_oversubscribe(sqlite_engine):
    filled(sqlite_engine, 9 * GB, workspace="ws-race")
    accepted, refused = race(sqlite_engine, "ws-race", [50 * MB] * 30)
    assert len(accepted) == 20
    assert_never_oversubscribed(sqlite_engine, "ws-race", accepted, refused)


# Any sequence of operations keeps the books straight


class QuotaMachine(RuleBasedStateMachine):
    """A random life of one workspace, checked against a model after every step."""

    uploads = Bundle("uploads")

    def __init__(self, engine, clock) -> None:
        super().__init__()
        self.engine = engine
        self.clock = clock
        self.workspace = f"ws-{uuid.uuid4()}"
        self.limit = FREE.storage_bytes
        self.committed = 0
        self.states: dict[str, tuple[quota.Reservation, ReservationState]] = {}
        self.sessions = 0

    @initialize()
    def start(self) -> None:
        set_plan(self.engine, FREE, self.workspace)

    def reserved(self) -> int:
        return sum(r.bytes for r, state in self.states.values() if state is ReservationState.ACTIVE)

    @rule(target=uploads, size=st.integers(1, 6 * GB))
    def reserve_upload(self, size):
        self.sessions += 1
        session = f"s{self.sessions}"
        fits = (
            self.committed <= self.limit and self.committed + self.reserved() + size <= self.limit
        )
        try:
            found = reserve(self.engine, size, session, self.workspace)
        except QuotaExceeded:
            assert not fits
            return None
        assert fits
        self.states[found.id] = (found, ReservationState.ACTIVE)
        return found.id

    @rule(reservation_id=uploads)
    def commit_upload(self, reservation_id):
        if reservation_id is None:
            return
        held, state = self.states[reservation_id]
        if state in (ReservationState.RELEASED, ReservationState.EXPIRED):
            with pytest.raises(ReservationClosed):
                commit(self.engine, held, self.workspace)
            return
        assert commit(self.engine, held, self.workspace).state is ReservationState.COMMITTED
        if state is ReservationState.ACTIVE:
            self.committed += held.bytes
        self.states[reservation_id] = (held, ReservationState.COMMITTED)

    @rule(reservation_id=uploads)
    def release_upload(self, reservation_id):
        if reservation_id is None:
            return
        held, state = self.states[reservation_id]
        after = release(self.engine, held, self.workspace)
        if state is ReservationState.ACTIVE:
            state = ReservationState.RELEASED
        assert after.state is state
        self.states[reservation_id] = (held, state)

    @rule(size=st.integers(1, 8 * GB))
    def delete_something(self, size):
        delete(self.engine, size, self.workspace)
        self.committed -= min(size, self.committed)

    @rule(plan=st.sampled_from([FREE, STANDARD, PREMIUM]))
    def change_plan(self, plan):
        set_plan(self.engine, plan, self.workspace)
        self.limit = plan.storage_bytes

    @rule()
    def let_uploads_run_out(self):
        self.clock.advance(quota.RESERVATION_TTL)
        quota.expire_reservations(self.engine)
        for key, (held, state) in self.states.items():
            if state is ReservationState.ACTIVE:
                self.states[key] = (held, ReservationState.EXPIRED)

    @invariant()
    def books_agree(self):
        found = usage(self.engine, self.workspace)
        assert found.committed_bytes == self.committed
        assert found.reserved_bytes == self.reserved() == active_bytes(self.engine, self.workspace)
        assert found.limit_bytes == self.limit
        assert found.read_only is (self.committed > self.limit)
        assert storage_ledger(self.engine, self.workspace) == self.committed


def test_any_sequence_of_quota_operations_keeps_the_books_straight(sqlite_engine, clock):
    run_state_machine_as_test(
        lambda: QuotaMachine(sqlite_engine, clock),
        settings=settings(stateful_step_count=25, deadline=None),
    )
