"""Delayed dangerous actions: 15 minutes with one operator, or a second approver (§7.4).

Tests that need time to pass run on SQLite with the frozen clock (`sdb`). The rest run on both
databases (`db`); there, two-person approval lets an action run at once without waiting.
PostgreSQL-only behaviour (`SKIP LOCKED`) runs on `postgres_engine`.
"""

from __future__ import annotations

import dataclasses
import math

import pytest
import sqlalchemy as sa
import test_cloud_authz_kit as kit
from test_cloud_authz_kit import (
    RecordingNotifier,
    add_user,
    audit_rows,
    delete_user,
    give,
    revoke_before,
    session,
    staff,
    workspace_ref,
)

from selecta.authz import audit, delayed
from selecta.authz.delayed import (
    DELAY_SECONDS,
    EXPIRY_SECONDS,
    RULES,
    ActionKind,
    ActionStatus,
    Outcome,
)
from selecta.authz.errors import (
    ActionNotFound,
    ActionStateError,
    Forbidden,
    NotReady,
    PayloadMismatch,
    SelfApproval,
    StepUpRequired,
)
from selecta.authz.roles import StaffRole
from selecta.authz.schema import dangerous_actions, role_assignments
from selecta.authz.scopes import Scope
from selecta.persistence import db_now

db = kit.db
sdb = kit.sdb

WEIGHTS = {"tiers": {"free": 1, "standard": 3, "premium": 6}}


class Recorder:
    """An executor that records what it ran."""

    def __init__(self) -> None:
        self.ran: list[str] = []

    def __call__(self, conn, action):
        self.ran.append(action.id)
        return f"ran {action.kind.value}"


def propose_as(conn, user, kind=ActionKind.QUEUE_WEIGHTS_CHANGE, payload=None, **kw):
    kw.setdefault("reason", "rebalance after the incident")
    return delayed.propose(conn, session(conn, user), kind, payload or WEIGHTS, **kw)


def set_row(conn, action_id, **values):
    conn.execute(
        dangerous_actions.update().where(dangerous_actions.c.id == action_id).values(**values)
    )


def two_operators(conn):
    """Two live staff holding security.roles.assign platform-wide: two-person mode."""
    return staff(conn, StaffRole.OWNER), staff(conn, StaffRole.ADMIN)


def approve_as(conn, user, action):
    return delayed.approve(conn, session(conn, user), action.id, payload_hash=action.payload_hash)


# Pure rules


def test_every_listed_kind_has_a_rule_naming_real_permissions():
    from selecta.authz import permissions

    assert set(RULES) == set(ActionKind)
    for rule in RULES.values():
        permissions.get(rule.propose)
        permissions.get(rule.apply)
        assert rule.description


def test_the_hash_covers_the_kind_and_the_canonical_payload():
    text = delayed.canonical_payload({"b": 1, "a": [1, 2]})
    assert text == '{"a":[1,2],"b":1}'
    assert text == delayed.canonical_payload({"a": [1, 2], "b": 1})
    same = delayed.payload_hash(ActionKind.BULK_DELETE, text)
    assert same == delayed.payload_hash("storage.bulk_delete", text)
    assert len(same) == 64
    assert same != delayed.payload_hash(ActionKind.QUEUE_WEIGHTS_CHANGE, text)
    assert same != delayed.payload_hash(ActionKind.BULK_DELETE, '{"a":[1,2],"b":2}')


def test_a_payload_must_be_a_finite_json_object():
    with pytest.raises(TypeError):
        delayed.canonical_payload([1, 2])  # type: ignore[arg-type]
    with pytest.raises(ValueError):
        delayed.canonical_payload({"weight": math.nan})


@pytest.mark.parametrize(
    ("before", "after", "dangerous"),
    [
        ({"free": 1, "pro": 4}, {"free": 1, "pro": 4}, False),
        ({"free": 1, "pro": 4}, {"free": 1.5, "pro": 2}, False),  # exactly 50% is allowed
        ({"free": 1, "pro": 4}, {"free": 1, "pro": 6.1}, True),
        ({"free": 1, "pro": 4}, {"free": 0.4, "pro": 4}, True),
        ({"free": 1}, {"free": 1, "pro": 4}, True),
        ({"free": 1, "pro": 4}, {"free": 1}, True),
        ({"free": 0, "pro": 4}, {"free": 0, "pro": 4}, False),
        ({"free": 0, "pro": 4}, {"free": 0.1, "pro": 4}, True),
    ],
)
def test_tier_weight_changes_over_half_are_dangerous(before, after, dangerous):
    assert delayed.is_dangerous_weight_change(before, after) is dangerous


# Proposing


def test_proposing_queues_the_action_with_its_delay_and_expiry(db):
    owner = staff(db)
    notifier = RecordingNotifier()
    action = propose_as(db, owner, notifier=notifier, reason="  rebalance  ")
    assert action.status is ActionStatus.PENDING and not action.two_person
    assert action.reason == "rebalance"
    assert action.execute_after == action.created_at + DELAY_SECONDS
    assert action.expires_at == action.execute_after + EXPIRY_SECONDS == action.created_at + 87300
    assert action.payload == WEIGHTS and action.rule is RULES[action.kind]
    assert action.payload_hash == delayed.payload_hash(action.kind, action.payload_text)
    assert notifier.events == [("proposed", action.id)]
    (row,) = audit_rows(db, action="dangerous_action.proposed")
    assert row["approval_id"] == action.id and row["actor_id"] == owner
    assert row["metadata"]["payload_hash"] == action.payload_hash
    assert delayed.pending(db) == [action]


def test_a_dangerous_action_needs_a_reason_and_a_known_kind(db):
    owner = staff(db)
    with pytest.raises(ValueError, match="reason"):
        propose_as(db, owner, reason="   ")
    with pytest.raises(ValueError):
        propose_as(db, owner, kind="storage.burn_it_all")
    assert delayed.pending(db) == []


def test_a_caller_can_lengthen_the_delay_but_never_shorten_it(db):
    owner = staff(db)
    short = propose_as(db, owner, delay_seconds=1)
    assert short.execute_after - short.created_at == DELAY_SECONDS
    long = propose_as(db, owner, delay_seconds=3600)
    assert long.execute_after - long.created_at == 3600
    assert long.expires_at == long.execute_after + EXPIRY_SECONDS


def test_proposing_a_dangerous_action_needs_fresh_mfa(db):
    staff(db)
    operator = staff(db, StaffRole.OPERATOR)
    with pytest.raises(StepUpRequired):
        delayed.propose(
            db,
            session(db, operator, mfa_age=600),
            ActionKind.EMERGENCY_CONTROL_DISABLE,
            {"control": "uploads_paused"},
            reason="incident over",
        )


def test_with_one_operator_the_proposer_needs_the_approving_permission_too(db):
    staff(db)  # the one operator
    operator = staff(db, StaffRole.OPERATOR)  # may propose a queue change, not approve one
    with pytest.raises(Forbidden) as caught:
        propose_as(db, operator)
    assert caught.value.permission == "queues.policy.approve"
    assert delayed.pending(db) == []


def test_with_two_operators_a_proposer_needs_only_the_proposing_permission(db):
    two_operators(db)
    operator = staff(db, StaffRole.OPERATOR)
    action = propose_as(db, operator)
    assert action.two_person


# Running: due, early, cancelled, expired


def test_running_before_it_is_due_is_refused_and_changes_nothing(sdb, clock):
    action = propose_as(sdb, staff(sdb))
    executor = Recorder()
    clock.advance(DELAY_SECONDS - 1)
    with pytest.raises(NotReady, match="runs in 1 s"):
        delayed.execute(sdb, action.id, executor)
    assert executor.ran == []
    assert delayed.get(sdb, action.id).status is ActionStatus.PENDING
    assert delayed.due(sdb) == []
    assert audit_rows(sdb, action="dangerous_action.executed") == []


def test_running_after_it_is_due_works_once(sdb, clock):
    owner = staff(sdb)
    action = propose_as(sdb, owner)
    executor, notifier = Recorder(), RecordingNotifier()
    clock.advance(DELAY_SECONDS)
    assert delayed.due(sdb) == [action]
    outcome = delayed.execute(sdb, action.id, executor, executed_by=owner, notifier=notifier)
    assert outcome.ok and outcome.result == "ran queues.weights.change"
    assert executor.ran == [action.id]
    done = outcome.action
    assert (done.status, done.finished_by, done.finished_at) == (
        ActionStatus.EXECUTED,
        owner,
        clock.now,
    )
    assert notifier.events == [("executed", action.id)]
    assert audit_rows(sdb, action="dangerous_action.executed", result="success")
    assert delayed.due(sdb) == [] and delayed.pending(sdb) == []
    with pytest.raises(ActionStateError, match="executed"):
        delayed.execute(sdb, action.id, executor)
    assert executor.ran == [action.id]


def test_a_due_action_runs_on_either_database(db):
    owner = staff(db)
    action = propose_as(db, owner)
    set_row(db, action.id, execute_after=db_now(db) - 1)
    assert [a.id for a in delayed.due(db)] == [action.id]
    assert delayed.execute(db, action.id, Recorder()).ok


def test_a_cancelled_action_never_runs(sdb, clock):
    owner = staff(sdb)
    action = propose_as(sdb, owner)
    notifier = RecordingNotifier()
    cancelled = delayed.cancel(
        sdb, session(sdb, owner), action.id, reason="wrong numbers", notifier=notifier
    )
    assert (cancelled.status, cancelled.note) == (ActionStatus.CANCELLED, "wrong numbers")
    assert notifier.events == [("cancelled", action.id)]
    clock.advance(DELAY_SECONDS)
    executor = Recorder()
    assert delayed.due(sdb) == []
    with pytest.raises(ActionStateError, match="cancelled"):
        delayed.execute(sdb, action.id, executor)
    with pytest.raises(ActionStateError):
        delayed.cancel(sdb, session(sdb, owner), action.id, reason="again")
    assert executor.ran == []
    assert audit_rows(sdb, action="dangerous_action.cancelled")


def test_others_need_the_approving_permission_to_cancel(db):
    owner = staff(db)
    action = propose_as(db, owner)
    analyst = staff(db, StaffRole.ANALYST)
    with pytest.raises(Forbidden):
        delayed.cancel(db, session(db, analyst), action.id, reason="nope")
    admin = staff(db, StaffRole.ADMIN)
    cancelled = delayed.cancel(db, session(db, admin), action.id, reason="not today")
    assert cancelled.finished_by == admin


def test_an_expired_action_never_runs(sdb, clock):
    owner = staff(sdb)
    action = propose_as(sdb, owner)
    executor, notifier = Recorder(), RecordingNotifier()
    clock.advance(DELAY_SECONDS + EXPIRY_SECONDS)
    assert delayed.due(sdb) == []
    outcome = delayed.execute(sdb, action.id, executor, executed_by=owner, notifier=notifier)
    assert not outcome.ok and outcome.result is None
    assert outcome.action.status is ActionStatus.EXPIRED
    assert outcome.action.note == "not run before it expired"
    assert notifier.events == [("expired", action.id)]
    assert executor.ran == []
    assert audit_rows(sdb, action="dangerous_action.expired", result="failure")
    with pytest.raises(ActionStateError, match="expired"):
        delayed.execute(sdb, action.id, executor)


def test_actions_expire_a_day_after_falling_due(sdb, clock):
    owner = staff(sdb)
    late = propose_as(sdb, owner)
    on_time = propose_as(sdb, owner)
    clock.advance(DELAY_SECONDS + EXPIRY_SECONDS - 1)
    assert delayed.execute(sdb, on_time.id, Recorder()).ok
    clock.advance(1)
    assert delayed.execute(sdb, late.id, Recorder()).action.status is ActionStatus.EXPIRED


def test_expire_stale_marks_every_overdue_action_expired(sdb, clock):
    owner = staff(sdb)
    stale = propose_as(sdb, owner)
    cancelled = propose_as(sdb, owner)
    delayed.cancel(sdb, session(sdb, owner), cancelled.id, reason="no")
    clock.advance(DELAY_SECONDS + 600)
    fresh = propose_as(sdb, owner)
    notifier = RecordingNotifier()
    assert delayed.expire_stale(sdb, clock.now + EXPIRY_SECONDS - 601, notifier) == []
    clock.advance(EXPIRY_SECONDS - 600)
    expired = delayed.expire_stale(sdb, notifier=notifier)
    assert [a.id for a in expired] == [stale.id]
    assert expired[0].status is ActionStatus.EXPIRED and expired[0].finished_by is None
    assert notifier.events == [("expired", stale.id)]
    assert delayed.get(sdb, cancelled.id).status is ActionStatus.CANCELLED
    assert delayed.get(sdb, fresh.id).status is ActionStatus.PENDING
    assert delayed.expire_stale(sdb) == []


def test_a_missing_action_is_not_found(db):
    with pytest.raises(ActionNotFound):
        delayed.get(db, "nope")
    with pytest.raises(ActionNotFound):
        delayed.execute(db, "nope", Recorder())
    with pytest.raises(ActionNotFound):
        delayed.approve(db, session(db, staff(db)), "nope", payload_hash="x")


def test_an_action_another_transaction_holds_is_refused_not_waited_on(db, monkeypatch):
    action = propose_as(db, staff(db))
    # What `FOR UPDATE SKIP LOCKED` returns while another transaction holds the row: nothing.
    monkeypatch.setattr(delayed, "lock_rows", lambda query: query.where(sa.false()))
    with pytest.raises(ActionStateError, match="another transaction"):
        delayed.execute(db, action.id, Recorder())


def test_postgres_skips_an_action_locked_by_another_transaction(postgres_engine):
    with postgres_engine.begin() as conn:
        action = propose_as(conn, staff(conn))
    t = dangerous_actions
    with postgres_engine.connect() as holder, holder.begin():
        holder.execute(sa.select(t.c.id).where(t.c.id == action.id).with_for_update())
        with postgres_engine.connect() as other, other.begin():
            with pytest.raises(ActionStateError, match="another transaction"):
                delayed.execute(other, action.id, Recorder())


# Payload integrity


def test_a_changed_payload_is_refused_when_it_runs(sdb, clock):
    action = propose_as(sdb, staff(sdb))
    set_row(sdb, action.id, payload='{"tiers":{"free":100}}')
    clock.advance(DELAY_SECONDS)
    executor = Recorder()
    outcome = delayed.execute(sdb, action.id, executor)
    assert outcome.action.status is ActionStatus.FAILED
    assert outcome.action.note == "payload hash mismatch"
    assert executor.ran == []
    (row,) = audit_rows(sdb, action="dangerous_action.failed")
    assert row["reason"] == "payload hash mismatch"


def test_approvers_must_pass_the_hash_they_saw(db):
    first, second = two_operators(db)
    action = propose_as(db, first)
    with pytest.raises(PayloadMismatch):
        delayed.approve(db, session(db, second), action.id, payload_hash="0" * 64)
    set_row(db, action.id, payload='{"tiers":{"free":100}}')
    with pytest.raises(PayloadMismatch):
        approve_as(db, second, action)
    assert delayed.get(db, action.id).approver_id is None


# The proposer and approver are checked again when it runs


def test_the_proposer_losing_the_permission_makes_it_fail(sdb, clock):
    owner = add_user(sdb)
    assignment = give(sdb, owner, StaffRole.OWNER)
    action = propose_as(sdb, owner)
    sdb.execute(
        role_assignments.update()
        .where(role_assignments.c.id == assignment)
        .values(revoked_at=clock.now)
    )
    clock.advance(DELAY_SECONDS)
    outcome = delayed.execute(sdb, action.id, Recorder())
    assert outcome.action.status is ActionStatus.FAILED
    assert outcome.action.note == "the proposer no longer holds queues.policy.propose"


def test_the_proposer_losing_only_the_approving_permission_makes_it_fail(sdb, clock):
    owner = add_user(sdb)
    owner_row = give(sdb, owner, StaffRole.OWNER)
    give(sdb, owner, StaffRole.OPERATOR)  # can still propose, can't approve
    action = propose_as(sdb, owner)
    sdb.execute(
        role_assignments.update()
        .where(role_assignments.c.id == owner_row)
        .values(revoked_at=clock.now)
    )
    clock.advance(DELAY_SECONDS)
    note = delayed.execute(sdb, action.id, Recorder()).action.note
    assert note == "the proposer no longer holds queues.policy.approve"


def test_the_proposer_being_deleted_makes_it_fail(sdb, clock):
    owner = staff(sdb)
    action = propose_as(sdb, owner)
    delete_user(sdb, owner)
    clock.advance(DELAY_SECONDS)
    note = delayed.execute(sdb, action.id, Recorder()).action.note
    assert note == "the proposer's account is gone"


def test_a_proposer_with_no_account_at_all_makes_it_fail(sdb, clock):
    action = propose_as(sdb, staff(sdb))
    set_row(sdb, action.id, proposer_id="ghost")
    clock.advance(DELAY_SECONDS)
    assert delayed.execute(sdb, action.id, Recorder()).action.note == (
        "the proposer's account is gone"
    )


def test_the_proposers_sessions_revoked_after_proposing_make_it_fail(sdb, clock):
    owner = staff(sdb)
    action = propose_as(sdb, owner)
    clock.advance(1)
    revoke_before(sdb, owner, clock.now)
    clock.advance(DELAY_SECONDS)
    note = delayed.execute(sdb, action.id, Recorder()).action.note
    assert note == "the proposer's sessions were revoked after proposing"


def test_sessions_revoked_before_proposing_do_not_stop_it(sdb, clock):
    owner = staff(sdb)
    revoke_before(sdb, owner, clock.now - 60)
    action = propose_as(sdb, owner)
    clock.advance(DELAY_SECONDS)
    assert delayed.execute(sdb, action.id, Recorder()).ok


def test_the_approver_losing_the_permission_makes_it_fail(db):
    first = staff(db)
    second = add_user(db)
    row = give(db, second, StaffRole.ADMIN)
    action = propose_as(db, first)
    approve_as(db, second, action)
    db.execute(
        role_assignments.update().where(role_assignments.c.id == row).values(revoked_at=db_now(db))
    )
    note = delayed.execute(db, action.id, Recorder()).action.note
    assert note == "the approver no longer holds queues.policy.approve"


def test_the_approver_being_deleted_makes_it_fail(db):
    first, second = two_operators(db)
    action = propose_as(db, first)
    approve_as(db, second, action)
    delete_user(db, second)
    assert delayed.execute(db, action.id, Recorder()).action.note == (
        "the approver's account is gone"
    )


def test_the_approvers_sessions_revoked_after_approving_make_it_fail(sdb, clock):
    first, second = two_operators(sdb)
    action = propose_as(sdb, first)
    approve_as(sdb, second, action)
    clock.advance(1)
    revoke_before(sdb, second, clock.now)
    note = delayed.execute(sdb, action.id, Recorder()).action.note
    assert note == "the approver's sessions were revoked after approving"


def test_an_action_recorded_as_self_approved_never_runs(db):
    first, _ = two_operators(db)
    action = propose_as(db, first)
    set_row(db, action.id, approver_id=first, approved_at=db_now(db))
    executor = Recorder()
    assert delayed.execute(db, action.id, executor).action.note == "self-approval"
    assert executor.ran == []


def test_an_approval_without_a_time_still_needs_a_live_approver_with_the_permission(db):
    first, second = two_operators(db)
    action = propose_as(db, first)
    set_row(db, action.id, approver_id=second, approved_at=None)
    assert delayed.execute(db, action.id, Recorder()).ok


# One operator, then two


def test_one_operator_waits_out_the_delay_without_any_approval(sdb, clock):
    owner = staff(sdb)
    action = propose_as(sdb, owner)
    assert not delayed.two_person_mode(sdb)
    assert not action.two_person and action.approver_id is None
    clock.advance(DELAY_SECONDS)
    assert delayed.execute(sdb, action.id, Recorder()).ok


def test_two_operators_need_a_different_approver_and_then_run_at_once(db):
    first, second = two_operators(db)
    assert delayed.two_person_mode(db) and delayed.two_person_mode(db, db_now(db))
    action = propose_as(db, first)
    assert action.two_person
    with pytest.raises(NotReady, match="second person"):
        delayed.execute(db, action.id, Recorder())
    with pytest.raises(SelfApproval):
        approve_as(db, first, action)
    (deny,) = audit_rows(db, action="dangerous_action.approve", result="deny")
    assert (deny["actor_id"], deny["reason"], deny["approval_id"]) == (
        first,
        "self-approval",
        action.id,
    )
    notifier = RecordingNotifier()
    approved = delayed.approve(
        db, session(db, second), action.id, payload_hash=action.payload_hash, notifier=notifier
    )
    assert approved.approver_id == second and approved.approved_at is not None
    assert notifier.events == [("approved", action.id)]
    assert audit_rows(db, action="dangerous_action.approved", actor_id=second)
    assert [a.id for a in delayed.due(db)] == [action.id]
    outcome = delayed.execute(db, action.id, Recorder())
    assert outcome.ok
    assert db_now(db) < action.execute_after  # no waiting once approved


def test_an_approval_is_given_once(db):
    first, second = two_operators(db)
    third = staff(db, StaffRole.ADMIN)
    action = propose_as(db, first)
    approve_as(db, second, action)
    with pytest.raises(ActionStateError, match="already approved"):
        approve_as(db, third, action)


def test_the_approver_needs_the_approving_permission(db):
    first, _ = two_operators(db)
    action = propose_as(db, first)
    operator = staff(db, StaffRole.OPERATOR)
    with pytest.raises(Forbidden):
        approve_as(db, operator, action)
    assert delayed.get(db, action.id).approver_id is None


def test_an_expired_action_cannot_be_approved(sdb, clock):
    first, second = two_operators(sdb)
    action = propose_as(sdb, first)
    clock.advance(DELAY_SECONDS + EXPIRY_SECONDS)
    with pytest.raises(ActionStateError, match="expired"):
        approve_as(sdb, second, action)


def test_a_second_staff_member_appearing_mid_way_makes_approval_required(sdb, clock):
    owner = staff(sdb)
    action = propose_as(sdb, owner)
    assert not action.two_person
    admin = staff(sdb, StaffRole.ADMIN)
    clock.advance(DELAY_SECONDS)
    assert delayed.due(sdb) == []  # not runnable, so a runner must not pick it up
    with pytest.raises(NotReady, match="second person"):
        delayed.execute(sdb, action.id, Recorder())
    approve_as(sdb, admin, action)
    assert [a.id for a in delayed.due(sdb)] == [action.id]
    assert delayed.execute(sdb, action.id, Recorder()).ok


def test_with_one_operator_another_permitted_person_may_approve_early(db):
    owner = staff(db)
    operator = staff(db, StaffRole.OPERATOR)
    action = delayed.propose(
        db,
        session(db, operator),
        ActionKind.EMERGENCY_CONTROL_DISABLE,
        {"control": "uploads_paused"},
        reason="incident over",
    )
    approve_as(db, owner, action)
    assert delayed.execute(db, action.id, Recorder()).ok


# A failing executor


def test_an_executor_that_raises_fails_while_the_status_and_audit_rows_commit(cloud_engine):
    with cloud_engine.begin() as conn:
        first, second = two_operators(conn)
        action = propose_as(conn, first)
        approve_as(conn, second, action)

    def explode(conn, action):
        audit.record(conn, action="executor.half_done", result=audit.AuditResult.SUCCESS)
        raise RuntimeError("provider said no")

    notifier = RecordingNotifier()
    with cloud_engine.begin() as conn:
        outcome = delayed.execute(conn, action.id, explode, executed_by=first, notifier=notifier)
    assert not outcome.ok
    assert outcome.action.status is ActionStatus.FAILED
    assert outcome.action.note == "RuntimeError: provider said no"
    assert notifier.events == [("failed", action.id)]
    with cloud_engine.connect() as conn:
        stored = delayed.get(conn, action.id)
        assert (stored.status, stored.finished_by) == (ActionStatus.FAILED, first)
        (row,) = audit_rows(conn, action="dangerous_action.failed")
        assert row["reason"] == "RuntimeError: provider said no"
        assert audit_rows(conn, action="executor.half_done") == []


def test_a_failed_actions_error_note_keeps_no_secrets(db):
    # Libraries put whole request URLs and headers in their errors.
    first, second = two_operators(db)
    action = propose_as(db, first)
    approve_as(db, second, action)
    signed = "https://r2.example/o/a.flac?X-Amz-Credential=AKIDSECRET&X-Amz-Signature=5ec7e7"

    def leak(conn, action):
        raise RuntimeError(f"GET {signed} failed; sent Authorization: Bearer tok3n-value")

    note = delayed.execute(db, action.id, leak).action.note
    (row,) = audit_rows(db, action="dangerous_action.failed")
    for text in (note, delayed.get(db, action.id).note, row["reason"]):
        for secret in ("AKIDSECRET", "5ec7e7", "tok3n-value"):
            assert secret not in text, text
        assert text.startswith("RuntimeError: GET https://r2.example/o/a.flac?<redacted> failed")


# Flag rules (`flags.rules.broad`) and emergency controls


BROAD_RULE = {"flag": "lucy.voice", "rule": {"plan": "free", "value": False}}


def test_broad_flag_rules_are_proposed_and_applied_with_the_flag_permissions():
    rule = RULES[ActionKind.FLAG_BROAD_RULE]
    assert ActionKind.FLAG_BROAD_RULE.value == "flags.rules.broad"
    assert (rule.propose, rule.apply) == ("flags.rules.propose", "flags.rules.apply")


def test_an_ai_admin_alone_can_propose_a_broad_flag_rule_and_it_waits(sdb, clock):
    staff(sdb)
    ai_admin = staff(sdb, StaffRole.AI_ADMIN)
    action = propose_as(sdb, ai_admin, ActionKind.FLAG_BROAD_RULE, BROAD_RULE)
    with pytest.raises(NotReady):
        delayed.execute(sdb, action.id, Recorder())
    clock.advance(DELAY_SECONDS)
    assert delayed.execute(sdb, action.id, Recorder()).ok


@pytest.mark.parametrize("role", [StaffRole.OPERATOR, StaffRole.SUPPORT, StaffRole.ANALYST])
def test_roles_without_flag_rule_powers_cannot_propose_a_broad_rule(db, role):
    staff(db)
    with pytest.raises(Forbidden) as caught:
        propose_as(db, staff(db, role), ActionKind.FLAG_BROAD_RULE, BROAD_RULE)
    assert caught.value.permission == "flags.rules.propose"


def test_a_broad_flag_rule_needs_a_second_flag_applier_once_there_are_two(db):
    two_operators(db)
    ai_admin, other_ai_admin = staff(db, StaffRole.AI_ADMIN), staff(db, StaffRole.AI_ADMIN)
    support = staff(db, StaffRole.SUPPORT)
    action = propose_as(db, ai_admin, ActionKind.FLAG_BROAD_RULE, BROAD_RULE)
    with pytest.raises(SelfApproval):
        approve_as(db, ai_admin, action)
    with pytest.raises(Forbidden):
        approve_as(db, support, action)
    approve_as(db, other_ai_admin, action)
    assert delayed.execute(db, action.id, Recorder()).ok


def test_emergency_controls_are_proposed_and_approved_with_one_permission():
    rule = RULES[ActionKind.EMERGENCY_CONTROL_DISABLE]
    assert rule.propose == rule.apply == "platform.emergency_controls.manage"


def test_an_operations_operator_alone_can_turn_off_an_emergency_control_after_the_delay(sdb, clock):
    staff(sdb)
    operator = staff(sdb, StaffRole.OPERATOR, Scope.platform("operations"))
    action = propose_as(sdb, operator, ActionKind.EMERGENCY_CONTROL_DISABLE, {"control": "x"})
    # propose and apply are the same permission, so it is checked (and audited) once
    assert len(audit_rows(sdb, action="platform.emergency_controls.manage")) == 1
    clock.advance(DELAY_SECONDS)
    assert delayed.execute(sdb, action.id, Recorder()).ok


@pytest.mark.parametrize(
    "role", [StaffRole.AI_ADMIN, StaffRole.SUPPORT, StaffRole.BILLING, StaffRole.AUDITOR]
)
def test_only_emergency_control_holders_may_turn_one_off(db, role):
    staff(db)
    with pytest.raises(Forbidden):
        propose_as(db, staff(db, role), ActionKind.EMERGENCY_CONTROL_DISABLE, {"control": "x"})


def test_an_emergency_control_proposal_is_approved_by_another_holder(db):
    two_operators(db)
    operator, other = staff(db, StaffRole.OPERATOR), staff(db, StaffRole.OPERATOR)
    action = propose_as(db, operator, ActionKind.EMERGENCY_CONTROL_DISABLE, {"control": "x"})
    with pytest.raises(Forbidden):
        approve_as(db, staff(db, StaffRole.BILLING), action)
    approve_as(db, other, action)
    assert delayed.execute(db, action.id, Recorder()).ok


# Listings and small types


def test_pending_and_due_list_actions_in_the_order_they_fall_due(sdb, clock):
    owner = staff(sdb)
    later = propose_as(sdb, owner, delay_seconds=DELAY_SECONDS + 60)
    sooner = propose_as(sdb, owner)
    assert [a.id for a in delayed.pending(sdb)] == [sooner.id, later.id]
    assert [a.id for a in delayed.due(sdb, clock.now + DELAY_SECONDS)] == [sooner.id]
    clock.advance(DELAY_SECONDS + 60)
    assert [a.id for a in delayed.due(sdb)] == [sooner.id, later.id]


def test_an_outcome_is_ok_only_when_executed(db):
    action = propose_as(db, staff(db))
    assert not Outcome(action).ok
    assert Outcome(dataclasses.replace(action, status=ActionStatus.EXECUTED)).ok


def test_content_access_proposals_carry_their_workspace_and_case(db):
    owner = staff(db)
    action = delayed.propose(
        db,
        session(db, owner),
        ActionKind.CONTENT_ACCESS_GRANT,
        {"workspace_id": "w1", "support_case_id": "c1"},
        reason="listen to the click",
        resource=workspace_ref("w1", "c1"),
    )
    assert (action.resource.workspace_id, action.resource.support_case_id) == ("w1", "c1")
    (row,) = audit_rows(db, action="dangerous_action.proposed")
    assert row["workspace_id"] == "w1"
