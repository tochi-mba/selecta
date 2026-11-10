"""`authorize()`: deny by default, scopes, assignment life, staff sessions, MFA and grants (§7.3).

Each test runs on SQLite and, in CI, on PostgreSQL (`db`). Times are built from the database's own
clock, so a test means the same thing on both. The Hypothesis property at the end checks that
`authorize()` never allows anything the actor's active roles don't hold at a covering scope.
"""

from __future__ import annotations

import pytest
import test_cloud_authz_kit as kit
from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st
from test_cloud_authz_kit import (
    add_grant,
    add_user,
    audit_rows,
    case_ref,
    delete_user,
    give,
    revoke_before,
    session,
    staff,
    workspace_ref,
)

from selecta.authz import check
from selecta.authz.check import (
    CLOCK_LEEWAY,
    MFA_BEFORE_SESSION_SECONDS,
    STAFF_SESSION_SECONDS,
    AccessGrant,
    Assignment,
    active_assignments,
    active_grant,
    authorize,
    ensure_not_self_approval,
    find_assignment,
    staff_holding,
)
from selecta.authz.errors import Forbidden, SelfApproval, StepUpRequired, UnknownPermission
from selecta.authz.permissions import PERMISSIONS
from selecta.authz.roles import ROLE_PERMISSIONS, StaffRole
from selecta.authz.scopes import PLATFORM_RESOURCE, ResourceRef, Scope
from selecta.identity import privileged
from selecta.persistence import db_now

SENSITIVE = "accounts.suspend"  # audited, no step-up
STEP_UP = "flags.kill_switch"  # DANGEROUS: MFA within five minutes

db = kit.db
sdb = kit.sdb


def deny_reason(conn, actor, permission, resource=PLATFORM_RESOURCE, **kw) -> Forbidden:
    with pytest.raises(Forbidden) as caught:
        authorize(conn, actor, permission, resource, **kw)
    return caught.value


# Deny by default


def test_no_assignment_means_denied_and_the_deny_is_audited(db):
    user = add_user(db)
    actor = session(db, user)
    error = deny_reason(db, actor, "jobs.read", ResourceRef("job", "j1", "w1", "c1"))
    assert error.reason == "no role grants this at this scope"
    assert not isinstance(error, StepUpRequired)
    (row,) = audit_rows(db, result="deny")
    assert row["id"] == error.audit_id
    assert row["actor_id"] == user
    assert row["action"] == "jobs.read"
    assert (row["resource_type"], row["resource_id"], row["workspace_id"]) == ("job", "j1", "w1")
    assert row["request_id"] == actor.request_id
    assert row["reason"] == error.reason
    assert row["metadata"] == {"staff_session_id": actor.staff_session_id, "support_case_id": "c1"}


def test_an_unknown_permission_raises_instead_of_denying(db):
    actor = session(db, staff(db))
    with pytest.raises(UnknownPermission):
        authorize(db, actor, "jobs.explode")
    assert audit_rows(db) == []


def test_an_unknown_user_is_denied(db):
    error = deny_reason(db, session(db, "no-such-user"), "jobs.read")
    assert error.reason == "unknown user"
    assert len(audit_rows(db, result="deny")) == 1


def test_a_deleted_user_is_denied_even_with_a_role(db):
    user = staff(db)
    actor = session(db, user)
    delete_user(db, user)
    assert deny_reason(db, actor, "jobs.read").reason == "account deleted"


def test_holding_a_role_allows_what_it_holds_and_nothing_more(db):
    user = staff(db, StaffRole.ANALYST)
    actor = session(db, user)
    match = authorize(db, actor, "jobs.read")
    assert isinstance(match, Assignment) and match.role is StaffRole.ANALYST
    assert deny_reason(db, actor, "jobs.retry").reason == "no role grants this at this scope"


# Staff sessions


def test_a_request_without_a_staff_session_is_denied(db):
    actor = session(db, staff(db), staff_session_id=None)
    assert deny_reason(db, actor, "jobs.read").reason == "staff session required"


def test_a_session_that_did_not_start_with_mfa_gives_step_up_required(db):
    actor = session(db, staff(db), mfa_at=None)
    error = deny_reason(db, actor, "jobs.read")
    assert isinstance(error, StepUpRequired)
    assert error.reason == "MFA required"
    assert error.max_age == STAFF_SESSION_SECONDS
    assert audit_rows(db, result="deny")[0]["id"] == error.audit_id


def test_a_session_without_an_end_is_denied(db):
    actor = session(db, staff(db), privileged_until=None)
    assert deny_reason(db, actor, "jobs.read").reason == "staff session expired"


def test_an_ended_session_is_denied(db):
    now = db_now(db)
    actor = session(db, staff(db), age=STAFF_SESSION_SECONDS + 5, privileged_until=now - 5)
    assert deny_reason(db, actor, "jobs.read").reason == "staff session expired"


def test_a_session_ending_more_than_an_hour_from_now_is_denied(db):
    now = db_now(db)
    actor = session(db, staff(db), privileged_until=now + 2 * STAFF_SESSION_SECONDS)
    assert deny_reason(db, actor, "jobs.read").reason == "staff session lasts longer than an hour"


def test_a_session_longer_than_an_hour_is_denied_even_with_little_time_left(db):
    # Started 50 minutes ago and runs for 50 more: 100 minutes long, so it was never a valid
    # staff session, however little of it remains.
    now = db_now(db)
    actor = session(db, staff(db), age=50 * 60, privileged_until=now + 50 * 60)
    assert deny_reason(db, actor, "jobs.read").reason == "staff session lasts longer than an hour"


def test_a_session_of_one_hour_is_allowed_until_it_ends(db):
    user = staff(db)
    assert authorize(db, session(db, user), "jobs.read")
    assert authorize(db, session(db, user, age=STAFF_SESSION_SECONDS - 60), "jobs.read")


def test_a_session_without_a_start_time_is_refused(db):
    actor = session(db, staff(db), session_issued_at=None)
    assert deny_reason(db, actor, "jobs.read").reason == "staff session has no start time"


def test_a_session_issued_in_the_future_is_refused(db):
    now = db_now(db)
    user = staff(db)
    future = session(db, user, session_issued_at=now + 10 * CLOCK_LEEWAY)
    assert deny_reason(db, future, "jobs.read").reason == "staff session starts in the future"
    within_leeway = session(db, user, session_issued_at=now + CLOCK_LEEWAY / 2)
    assert authorize(db, within_leeway, "jobs.read")


def test_an_mfa_time_in_the_future_is_refused(db):
    now = db_now(db)
    user = staff(db)
    future = session(db, user, mfa_at=now + 10 * CLOCK_LEEWAY)
    error = deny_reason(db, future, "jobs.read")
    assert error.reason == "MFA time is in the future"
    assert not isinstance(error, StepUpRequired)
    assert authorize(db, session(db, user, mfa_at=now + CLOCK_LEEWAY / 2), "jobs.read")


def test_an_mfa_from_before_the_session_began_does_not_count(db):
    # It belongs to an earlier session, so this session never had MFA of its own.
    now = db_now(db)
    user = staff(db)
    stale = now - 60 - MFA_BEFORE_SESSION_SECONDS - CLOCK_LEEWAY - 1
    actor = session(db, user, age=60, mfa_at=stale)
    error = deny_reason(db, actor, "jobs.read")
    assert isinstance(error, StepUpRequired)
    assert error.reason == "MFA is from an earlier session"
    assert error.max_age == STAFF_SESSION_SECONDS


def test_the_sign_in_mfa_that_started_the_session_counts(db):
    # An admin session starts from a sign-in at most five minutes old, and that sign-in is its MFA
    # (identity.privileged.start), so the MFA may precede the session by that much.
    assert MFA_BEFORE_SESSION_SECONDS == privileged.FRESH_SIGN_IN_SECONDS
    now = db_now(db)
    user = staff(db)
    actor = session(db, user, age=0, mfa_at=now - MFA_BEFORE_SESSION_SECONDS)
    assert authorize(db, actor, "jobs.read")
    stepped_up = session(db, user, age=1800, mfa_at=now - 10)
    assert authorize(db, stepped_up, "jobs.read")


def test_a_session_issued_before_the_last_revocation_is_denied(db):
    now = db_now(db)
    user = staff(db)
    revoke_before(db, user, now - 100)
    old = session(db, user, age=200)
    assert deny_reason(db, old, "jobs.read").reason == "session revoked"
    assert authorize(db, session(db, user, age=50), "jobs.read")


def test_a_later_mfa_step_up_does_not_revive_a_revoked_session(db):
    now = db_now(db)
    user = staff(db)
    revoke_before(db, user, now - 100)
    stepped_up = session(db, user, age=200, mfa_age=0)
    assert deny_reason(db, stepped_up, "jobs.read").reason == "session revoked"


def test_dangerous_permissions_need_mfa_within_five_minutes(db):
    user = staff(db)
    assert authorize(db, session(db, user, mfa_age=280), STEP_UP)
    error = deny_reason(db, session(db, user, mfa_age=320), STEP_UP)
    assert isinstance(error, StepUpRequired)
    assert error.reason == "MFA isn't fresh enough"
    assert error.max_age == 300


def test_other_permissions_accept_any_mfa_in_the_session(db):
    user = staff(db)
    actor = session(db, user, age=3000, mfa_age=3000)
    assert authorize(db, actor, "jobs.read")
    assert authorize(db, actor, SENSITIVE)


def test_a_caller_can_tighten_the_mfa_window(db):
    actor = session(db, staff(db), mfa_age=120)
    error = deny_reason(db, actor, "jobs.read", fresh_mfa_seconds=60)
    assert isinstance(error, StepUpRequired) and error.max_age == 60
    assert authorize(db, actor, "jobs.read", fresh_mfa_seconds=600)


def test_a_caller_cannot_loosen_the_mfa_window(db):
    actor = session(db, staff(db), mfa_age=400)
    error = deny_reason(db, actor, STEP_UP, fresh_mfa_seconds=3600)
    assert isinstance(error, StepUpRequired) and error.max_age == 300


# Assignments: life, retired roles, unknown scopes


def test_an_expired_assignment_is_denied(db):
    now = db_now(db)
    user = add_user(db)
    give(db, user, StaffRole.OWNER, expires_at=now - 1)
    assert deny_reason(db, session(db, user), "jobs.read").reason.startswith("no role")


def test_an_assignment_expiring_later_still_allows(db):
    now = db_now(db)
    user = add_user(db)
    give(db, user, StaffRole.OWNER, expires_at=now + 600)
    assert authorize(db, session(db, user), "jobs.read").expires_at == now + 600


def test_a_revoked_assignment_is_denied(db):
    now = db_now(db)
    user = add_user(db)
    give(db, user, StaffRole.OWNER, revoked_at=now - 1)
    assert deny_reason(db, session(db, user), "jobs.read").reason.startswith("no role")


def test_assignment_expiry_takes_effect_without_any_write(sdb, clock):
    user = add_user(sdb)
    give(sdb, user, StaffRole.OWNER, expires_at=clock.now + 60)
    assert authorize(sdb, session(sdb, user), "jobs.read")
    clock.advance(60)
    assert deny_reason(sdb, session(sdb, user), "jobs.read").reason.startswith("no role")


def test_a_role_retired_from_the_code_grants_nothing(db):
    user = add_user(db)
    give(db, user, "wizard")
    assert active_assignments(db, user) == []
    assert deny_reason(db, session(db, user), "jobs.read").reason.startswith("no role")


def test_an_assignment_at_a_scope_the_code_does_not_understand_grants_nothing(db):
    # The table only checks the scope type, so `platform:billing` (an area that doesn't exist, or
    # one retired from the code) can be stored. It must deny, not crash every check.
    user = add_user(db)
    give(db, user, StaffRole.OWNER, scope_type="platform", scope_id="billing")
    give(db, user, StaffRole.ANALYST)
    assert [a.role for a in active_assignments(db, user)] == [StaffRole.ANALYST]
    assert authorize(db, session(db, user), "jobs.read").role is StaffRole.ANALYST
    assert deny_reason(db, session(db, user), "accounts.list").reason.startswith("no role")


def test_a_deleted_users_assignments_are_not_active(db):
    user = staff(db)
    delete_user(db, user)
    assert active_assignments(db, user) == []
    assert find_assignment(db, user, "jobs.read") is None


def test_the_tightest_matching_assignment_is_the_one_returned(db):
    user = add_user(db)
    give(db, user, StaffRole.SUPPORT)
    narrow = give(db, user, StaffRole.SUPPORT, Scope.support_case("c1"))
    give(db, user, StaffRole.SUPPORT, Scope.platform("operations"))
    scopes = [a.scope.specificity() for a in active_assignments(db, user)]
    assert scopes == sorted(scopes)
    assert authorize(db, session(db, user), "support.cases.read", case_ref("c1")).id == narrow
    assert authorize(db, session(db, user), "support.cases.read").scope == Scope.platform()


# Scopes, through the real check


def test_platform_wide_covers_any_resource(db):
    actor = session(db, staff(db, StaffRole.SUPPORT))
    for resource in (PLATFORM_RESOURCE, workspace_ref("w1"), case_ref("c1", "w2")):
        assert authorize(db, actor, "support.diagnostics.read", resource)


def test_operations_covers_running_the_service_but_not_accounts(db):
    actor = session(db, staff(db, StaffRole.SUPPORT, Scope.platform("operations")))
    assert authorize(db, actor, "jobs.retry", ResourceRef("job", "j1", "w1"))
    assert authorize(db, actor, "flags.user_override", workspace_ref("w1"))
    deny_reason(db, actor, "accounts.read_metadata", workspace_ref("w1"))
    deny_reason(db, actor, "support.cases.read", case_ref("c1"))


def test_a_workspace_scope_covers_only_that_workspace(db):
    actor = session(db, staff(db, StaffRole.BILLING, Scope.workspace("w1")))
    assert authorize(db, actor, "billing.subscriptions.reconcile", workspace_ref("w1"))
    assert authorize(db, actor, "billing.subscriptions.reconcile", case_ref("c9", "w1"))
    deny_reason(db, actor, "billing.subscriptions.reconcile", workspace_ref("w2"))
    deny_reason(db, actor, "billing.subscriptions.reconcile", PLATFORM_RESOURCE)


def test_a_support_case_scope_covers_only_that_case(db):
    actor = session(db, staff(db, StaffRole.SUPPORT, Scope.support_case("c1")))
    assert authorize(db, actor, "support.diagnostics.read", case_ref("c1", "w1"))
    deny_reason(db, actor, "support.diagnostics.read", case_ref("c2", "w1"))
    deny_reason(db, actor, "support.diagnostics.read", workspace_ref("w1"))
    deny_reason(db, actor, "support.diagnostics.read", PLATFORM_RESOURCE)


def test_support_overrides_flags_only_where_assigned(db):
    actor = session(db, staff(db, StaffRole.SUPPORT, Scope.workspace("w1")))
    assert authorize(db, actor, "flags.user_override", workspace_ref("w1"))
    deny_reason(db, actor, "flags.user_override", workspace_ref("w2"))
    deny_reason(db, actor, "flags.kill_switch", workspace_ref("w1"))


# What is audited


def test_sensitive_allows_are_audited_with_the_matching_assignment(db):
    user = add_user(db)
    assignment = give(db, user, StaffRole.SUPPORT, Scope.workspace("w1"))
    actor = session(db, user)
    authorize(db, actor, "accounts.read_metadata", workspace_ref("w1"))
    (row,) = audit_rows(db, result="allow")
    assert row["action"] == "accounts.read_metadata"
    assert row["workspace_id"] == "w1"
    assert row["metadata"] == {
        "assignment_id": assignment,
        "role": "support",
        "scope": "workspace:w1",
        "staff_session_id": actor.staff_session_id,
    }


def test_read_and_change_allows_are_not_audited(db):
    actor = session(db, staff(db))
    authorize(db, actor, "jobs.read")
    authorize(db, actor, "jobs.retry")
    assert audit_rows(db) == []


def test_every_deny_is_audited(db):
    user = add_user(db)
    give(db, user, StaffRole.ANALYST)
    for actor, permission in (
        (session(db, user), "jobs.retry"),
        (session(db, user, mfa_at=None), "jobs.read"),
        (session(db, user, staff_session_id=None), "jobs.read"),
        (session(db, user, mfa_age=600), "jobs.read"),
    ):
        kw = {"fresh_mfa_seconds": 60} if actor.mfa_at is not None else {}
        with pytest.raises(Forbidden):
            authorize(db, actor, permission, **kw)
    assert len(audit_rows(db, result="deny", actor_id=user)) == 4


# Content access: grants only, never roles


def test_no_role_lets_staff_read_customer_audio(db):
    actor = session(db, staff(db))
    error = deny_reason(db, actor, "storage.content.read", workspace_ref("w1", "c1"))
    assert error.reason == "no active support grant"
    assert find_assignment(db, actor.user_id, "storage.content.read") is None


def test_an_active_grant_allows_reading_that_workspaces_audio_and_is_audited(db):
    user = add_user(db)
    grant_id = add_grant(db, user, "w1", "c1")
    actor = session(db, user)
    grant = authorize(db, actor, "storage.content.read", workspace_ref("w1", "c1"))
    assert isinstance(grant, AccessGrant) and grant.id == grant_id
    (row,) = audit_rows(db, result="allow")
    assert row["action"] == "storage.content.read"
    assert row["metadata"] == {"grant_id": grant_id, "support_case_id": "c1"}


def test_a_grant_covers_only_its_own_workspace_and_holder(db):
    holder, other = add_user(db), add_user(db)
    add_grant(db, holder, "w1", "c1")
    deny_reason(db, session(db, holder), "storage.content.read", workspace_ref("w2", "c1"))
    deny_reason(db, session(db, other), "storage.content.read", workspace_ref("w1", "c1"))


def test_a_grant_is_scoped_to_its_support_case(db):
    user = add_user(db)
    add_grant(db, user, "w1", "c1")
    actor = session(db, user)
    deny_reason(db, actor, "storage.content.read", workspace_ref("w1", "c2"))
    assert authorize(db, actor, "storage.content.read", workspace_ref("w1"))


def test_a_resource_without_a_workspace_never_matches_a_grant(db):
    user = add_user(db)
    add_grant(db, user, "w1", "c1")
    deny_reason(db, session(db, user), "storage.content.read", case_ref("c1"))
    assert active_grant(db, user, case_ref("c1")) is None


def test_expired_and_revoked_grants_allow_nothing(db):
    user = add_user(db)
    add_grant(db, user, "w1", "c1", expires_in=-1)
    add_grant(db, user, "w1", "c1", revoked=True)
    deny_reason(db, session(db, user), "storage.content.read", workspace_ref("w1", "c1"))


def test_a_grant_stops_allowing_when_it_expires(sdb, clock):
    user = add_user(sdb)
    add_grant(sdb, user, "w1", "c1", expires_in=600)
    assert authorize(sdb, session(sdb, user), "storage.content.read", workspace_ref("w1"))
    clock.advance(600)
    deny_reason(sdb, session(sdb, user), "storage.content.read", workspace_ref("w1"))


def test_reading_audio_still_needs_mfa_within_five_minutes(db):
    user = add_user(db)
    add_grant(db, user, "w1", "c1")
    error = deny_reason(
        db, session(db, user, mfa_age=400), "storage.content.read", workspace_ref("w1")
    )
    assert isinstance(error, StepUpRequired)


def test_the_longest_live_grant_is_the_one_used(db):
    user = add_user(db)
    add_grant(db, user, "w1", "c1", expires_in=60)
    longest = add_grant(db, user, "w1", "c2", expires_in=7200)
    assert active_grant(db, user, workspace_ref("w1")).id == longest
    assert active_grant(db, user, workspace_ref("w1"), db_now(db)).id == longest


# Helpers other modules rely on


def test_staff_holding_counts_distinct_live_platform_wide_holders(db):
    now = db_now(db)
    owner, admin = staff(db, StaffRole.OWNER), staff(db, StaffRole.ADMIN)
    give(db, admin, StaffRole.ADMIN)  # a second row for the same person
    expired = add_user(db)
    give(db, expired, StaffRole.ADMIN, expires_at=now - 1)
    deleted = staff(db, StaffRole.ADMIN)
    delete_user(db, deleted)
    support = staff(db, StaffRole.SUPPORT, Scope.workspace("w1"))
    assert staff_holding(db, "security.roles.assign") == {owner, admin}
    # Support holds flags.read, but only in one workspace, so it isn't counted.
    assert staff_holding(db, "flags.read", now) == {owner, admin}
    assert support not in staff_holding(db, "flags.read")


def test_staff_holding_a_grant_only_permission_is_nobody(db):
    staff(db)
    assert staff_holding(db, "storage.content.read") == frozenset()
    with pytest.raises(UnknownPermission):
        staff_holding(db, "jobs.explode")


def test_find_assignment_checks_roles_not_sessions(db):
    user = staff(db, StaffRole.OPERATOR)
    revoke_before(db, user, db_now(db) + 1000)
    assert find_assignment(db, user, "jobs.retry").role is StaffRole.OPERATOR
    assert find_assignment(db, user, "accounts.suspend") is None


def test_nobody_may_approve_their_own_action():
    ensure_not_self_approval("a", "b")
    with pytest.raises(SelfApproval):
        ensure_not_self_approval("a", "a")


# The property: never more than the actor's active roles hold at a covering scope

SCOPES = [
    Scope.platform(),
    Scope.platform("operations"),
    Scope.workspace("w1"),
    Scope.workspace("w2"),
    Scope.support_case("c1"),
    Scope.support_case("c2"),
]
STATES = ["active", "expired", "revoked", "expires_later"]
OPERATIONS_AREAS = {"jobs", "queues", "workers", "models", "storage", "flags"}
OPERATIONS_PLATFORM = {
    "platform.dashboard.read",
    "platform.incidents.manage",
    "platform.emergency_controls.manage",
}


def covers(scope: Scope, permission: str, workspace: str | None, case: str | None) -> bool:
    """What §7.3 says each scope covers, written independently of `Scope.covers`."""
    if scope.type == "platform" and scope.id == "*":
        return True
    if scope.type == "platform":
        return permission.split(".")[0] in OPERATIONS_AREAS or permission in OPERATIONS_PLATFORM
    if scope.type == "workspace":
        return workspace == scope.id
    return case == scope.id


@settings(suppress_health_check=[HealthCheck.function_scoped_fixture], deadline=None)
@given(
    rows=st.lists(
        st.tuples(
            st.sampled_from(list(StaffRole)), st.sampled_from(SCOPES), st.sampled_from(STATES)
        ),
        max_size=4,
    ),
    permission=st.sampled_from(sorted(PERMISSIONS)),
    workspace=st.sampled_from([None, "w1", "w2"]),
    case=st.sampled_from([None, "c1", "c2"]),
)
def test_authorize_never_allows_beyond_the_actors_active_roles_at_a_covering_scope(
    sqlite_engine, rows, permission, workspace, case
):
    with sqlite_engine.connect() as conn:
        transaction = conn.begin()
        try:
            now = db_now(conn)
            user = add_user(conn)
            expected = False
            for role, scope, state in rows:
                give(
                    conn,
                    user,
                    role,
                    scope,
                    expires_at={"expired": now - 1, "expires_later": now + 3600}.get(state),
                    revoked_at=now - 1 if state == "revoked" else None,
                )
                live = state in ("active", "expires_later")
                holds = permission in ROLE_PERMISSIONS[role]
                if live and holds and covers(scope, permission, workspace, case):
                    expected = True
            if PERMISSIONS[permission].grant_only:
                expected = False
            resource = ResourceRef("thing", "t1", workspace, case)
            try:
                match = authorize(conn, session(conn, user), permission, resource)
            except StepUpRequired:  # pragma: no cover - a fresh session never needs it
                raise
            except Forbidden:
                allowed = False
            else:
                allowed = True
                assert isinstance(match, Assignment)
                assert permission in ROLE_PERMISSIONS[match.role]
                assert match.revoked_at is None
                assert match.expires_at is None or match.expires_at > now
                assert covers(match.scope, permission, workspace, case)
            assert allowed is expected
        finally:
            transaction.rollback()


def test_the_module_exports_what_it_promises():
    for name in check.__all__:
        assert hasattr(check, name), name
