"""Giving and taking staff roles, the last Owner, bootstrap, and support content grants (§7.3).

Every role change revokes the target's sessions and is audited; nobody gives themselves a role;
Owner and Admin are platform-wide only; the last Owner can't be revoked or deleted. Content access
comes only from a delayed, consented grant tied to one workspace and one support case.
"""

from __future__ import annotations

import dataclasses

import pytest
import sqlalchemy as sa
import test_cloud_authz_kit as kit
from test_cloud_authz_kit import (
    add_grant,
    add_user,
    audit_rows,
    delete_user,
    give,
    revoked_before,
    session,
    staff,
    workspace_ref,
)

from selecta.authz import assignments, delayed, grants
from selecta.authz.assignments import (
    BOOTSTRAP_ISSUER,
    assign_owner,
    assign_role,
    bootstrap_owner,
    get_assignment,
    propose_owner,
    revoke_assignment,
    revoke_user_sessions,
)
from selecta.authz.check import (
    active_assignments,
    authorize,
    ensure_not_last_owner,
    platform_owners,
)
from selecta.authz.errors import (
    ActionNotFound,
    AuthzError,
    DelayedActionRequired,
    Forbidden,
    InvalidScope,
    LastOwner,
    SelfApproval,
    StepUpRequired,
)
from selecta.authz.roles import StaffRole
from selecta.authz.schema import access_grants
from selecta.authz.scopes import Scope
from selecta.identity.accounts import start_account_deletion
from selecta.persistence import db_now

REASON = "covering the support rota"

db = kit.db
sdb = kit.sdb


def roles_of(conn, user_id):
    return sorted((a.role.value, str(a.scope)) for a in active_assignments(conn, user_id))


# Assigning roles below Owner


def test_an_admin_assigns_a_role_below_owner_and_it_is_audited(db):
    admin = staff(db, StaffRole.ADMIN)
    target = add_user(db)
    actor = session(db, admin)
    assignment = assign_role(
        db,
        actor,
        user_id=target,
        role="support",
        reason=f"  {REASON} ",
        scope=Scope.workspace("w1"),
    )
    assert (assignment.role, assignment.scope) == (StaffRole.SUPPORT, Scope.workspace("w1"))
    assert assignment.issued_by == admin and assignment.reason == REASON
    assert roles_of(db, target) == [("support", "workspace:w1")]
    (row,) = audit_rows(db, action="role.assigned")
    assert row["actor_id"] == admin and row["resource_id"] == target
    assert row["metadata"]["assignment_id"] == assignment.id
    assert row["metadata"]["scope"] == "workspace:w1"
    # assigning is dangerous, so the allow itself is audited too
    assert audit_rows(db, action="security.roles.assign", result="allow")


def test_a_role_change_revokes_the_targets_sessions(db):
    admin = staff(db, StaffRole.ADMIN)
    target = staff(db, StaffRole.ANALYST)
    before = session(db, target, age=10)
    assert authorize(db, before, "jobs.read")
    assign_role(db, session(db, admin), user_id=target, role="operator", reason=REASON)
    assert revoked_before(db, target) is not None
    with pytest.raises(Forbidden, match="session revoked"):
        authorize(db, before, "jobs.read")
    assert audit_rows(db, action="sessions.revoked", resource_id=target)


def test_assigning_owner_directly_is_refused(db):
    actor = session(db, staff(db))
    with pytest.raises(DelayedActionRequired):
        assign_role(db, actor, user_id=add_user(db), role=StaffRole.OWNER, reason=REASON)


def test_self_assignment_is_refused_and_audited(db):
    admin = staff(db, StaffRole.ADMIN)
    with pytest.raises(SelfApproval):
        assign_role(db, session(db, admin), user_id=admin, role="operator", reason=REASON)
    (row,) = audit_rows(db, result="deny")
    assert (row["actor_id"], row["reason"]) == (admin, "self-assignment")
    assert row["action"] == "security.roles.assign"
    assert roles_of(db, admin) == [("admin", "platform:*")]


@pytest.mark.parametrize(
    "scope", [Scope.platform("operations"), Scope.workspace("w1"), Scope.support_case("c1")]
)
def test_admin_is_only_assigned_platform_wide(db, scope):
    actor = session(db, staff(db))
    with pytest.raises(InvalidScope):
        assign_role(db, actor, user_id=add_user(db), role="admin", reason=REASON, scope=scope)


def test_a_role_is_never_given_at_a_scope_it_does_not_allow(db):
    actor = session(db, staff(db))
    with pytest.raises(InvalidScope):
        assign_role(
            db,
            actor,
            user_id=add_user(db),
            role="operator",
            reason=REASON,
            scope=Scope.workspace("w"),
        )


def test_assigning_needs_security_roles_assign(db):
    actor = session(db, staff(db, StaffRole.OPERATOR))
    target = add_user(db)
    with pytest.raises(Forbidden):
        assign_role(db, actor, user_id=target, role="analyst", reason=REASON)
    assert roles_of(db, target) == []


def test_assigning_needs_mfa_within_five_minutes(db):
    actor = session(db, staff(db), mfa_age=600)
    with pytest.raises(StepUpRequired):
        assign_role(db, actor, user_id=add_user(db), role="analyst", reason=REASON)


def test_a_role_is_only_given_to_a_live_user(db):
    actor = session(db, staff(db))
    with pytest.raises(ActionNotFound):
        assign_role(db, actor, user_id="nobody", role="analyst", reason=REASON)
    with pytest.raises(ActionNotFound):
        assign_role(db, actor, user_id=add_user(db, deleted=True), role="analyst", reason=REASON)


def test_an_assignment_needs_a_reason_and_a_future_expiry(db):
    actor = session(db, staff(db))
    target = add_user(db)
    with pytest.raises(ValueError, match="reason"):
        assign_role(db, actor, user_id=target, role="analyst", reason="  ")
    with pytest.raises(ValueError, match="past"):
        assign_role(db, actor, user_id=target, role="analyst", reason=REASON, expires_at=1.0)


def test_an_assignment_with_an_expiry_stops_granting_when_it_ends(sdb, clock):
    admin = staff(sdb, StaffRole.ADMIN)
    target = add_user(sdb)
    assign_role(
        sdb,
        session(sdb, admin),
        user_id=target,
        role="analyst",
        reason=REASON,
        expires_at=clock.now + 3600,
    )
    assert authorize(sdb, session(sdb, target), "jobs.read")
    clock.advance(3600)
    with pytest.raises(Forbidden):
        authorize(sdb, session(sdb, target), "jobs.read")


# Revoking roles


def test_revoking_a_role_takes_effect_at_once_and_revokes_sessions(db):
    admin = staff(db, StaffRole.ADMIN)
    target = add_user(db)
    assignment_id = give(db, target, StaffRole.OPERATOR)
    before = session(db, target, age=10)
    revoked = revoke_assignment(db, session(db, admin), assignment_id, reason="left the team")
    assert revoked.revoked_at is not None
    assert roles_of(db, target) == []
    with pytest.raises(Forbidden):
        authorize(db, before, "jobs.read")
    with pytest.raises(Forbidden):
        authorize(db, session(db, target), "jobs.read")
    (row,) = audit_rows(db, action="role.revoked")
    assert row["reason"] == "left the team"
    assert row["metadata"] == {
        "assignment_id": assignment_id,
        "role": "operator",
        "scope": "platform:*",
    }


def test_revoking_an_already_revoked_assignment_changes_nothing(db):
    admin = staff(db, StaffRole.ADMIN)
    assignment_id = give(db, add_user(db), StaffRole.OPERATOR)
    first = revoke_assignment(db, session(db, admin), assignment_id, reason="first")
    again = revoke_assignment(db, session(db, admin), assignment_id, reason="second")
    assert again == first
    assert len(audit_rows(db, action="role.revoked")) == 1


def test_an_unauthorized_revoke_is_denied_even_when_already_revoked(db):
    # Asking about an assignment you may not touch is denied and audited, whatever its state.
    admin = staff(db, StaffRole.ADMIN)
    assignment_id = give(db, add_user(db), StaffRole.OPERATOR)
    revoke_assignment(db, session(db, admin), assignment_id, reason="done")
    outsider = session(db, staff(db, StaffRole.ANALYST))
    with pytest.raises(Forbidden):
        revoke_assignment(db, outsider, assignment_id, reason="peek")
    assert audit_rows(db, result="deny", actor_id=outsider.user_id)


def test_revoking_needs_security_roles_assign(db):
    assignment_id = give(db, add_user(db), StaffRole.OPERATOR)
    with pytest.raises(Forbidden):
        revoke_assignment(db, session(db, staff(db, StaffRole.OPERATOR)), assignment_id, reason="x")
    assert get_assignment(db, assignment_id).revoked_at is None


def test_revoking_an_owner_needs_owner_assignment_permission(db):
    staff(db)
    other_owner = staff(db)
    (owner_row,) = active_assignments(db, other_owner)
    admin = session(db, staff(db, StaffRole.ADMIN))
    with pytest.raises(Forbidden):
        revoke_assignment(db, admin, owner_row.id, reason="coup")
    assert get_assignment(db, owner_row.id).revoked_at is None


def test_the_last_owner_cannot_be_revoked(db):
    owner = staff(db)
    (row,) = active_assignments(db, owner)
    with pytest.raises(LastOwner):
        revoke_assignment(db, session(db, owner), row.id, reason="stepping down")
    assert get_assignment(db, row.id).revoked_at is None


def test_an_owner_can_be_revoked_while_another_owner_remains(db):
    first, second = staff(db), staff(db)
    (row,) = active_assignments(db, second)
    revoke_assignment(db, session(db, first), row.id, reason="handover")
    assert platform_owners(db) == {first}


def test_an_owner_with_two_owner_assignments_may_drop_one(db):
    owner = staff(db)
    extra = give(db, owner, StaffRole.OWNER)
    revoke_assignment(db, session(db, owner), extra, reason="duplicate")
    assert platform_owners(db) == {owner}


def test_a_missing_assignment_is_not_found(db):
    with pytest.raises(ActionNotFound):
        get_assignment(db, "nope")


# The last Owner and account deletion


def test_the_last_owner_cannot_delete_their_account(db):
    owner = staff(db)
    with pytest.raises(LastOwner):
        start_account_deletion(db, owner)
    assert platform_owners(db) == {owner}


def test_an_owner_may_leave_when_another_owner_remains(db):
    first, second = staff(db), staff(db)
    ensure_not_last_owner(db, first)
    give(db, first, StaffRole.OWNER)  # two rows for one person still count as one Owner
    ensure_not_last_owner(db, second)


def test_a_user_who_is_not_an_owner_is_never_the_last_owner(db):
    staff(db)
    analyst = staff(db, StaffRole.ANALYST)
    ensure_not_last_owner(db, analyst)
    ensure_not_last_owner(db, "nobody", assignment_id="nothing")


def test_platform_owners_ignores_owner_rows_below_platform_wide(db):
    owner = staff(db)
    odd = add_user(db)
    give(db, odd, StaffRole.OWNER, Scope.platform("operations"))
    deleted = staff(db)
    delete_user(db, deleted)
    assert platform_owners(db) == {owner}
    assert platform_owners(db, excluding_user=owner) == frozenset()


# Bootstrap


def test_bootstrap_owner_makes_the_first_owner(db):
    user = add_user(db)
    assignment = bootstrap_owner(db, user, reason="first deploy")
    assert (assignment.role, assignment.scope) == (StaffRole.OWNER, Scope.platform())
    assert assignment.issued_by == BOOTSTRAP_ISSUER
    assert platform_owners(db) == {user}
    assert audit_rows(db, action="role.assigned", actor_id=BOOTSTRAP_ISSUER)


def test_bootstrap_owner_works_only_while_no_owner_exists(db):
    bootstrap_owner(db, add_user(db), reason="first deploy")
    late = add_user(db)
    with pytest.raises(AuthzError, match="already exists"):
        bootstrap_owner(db, late, reason="second try")
    assert roles_of(db, late) == []


def test_bootstrap_owner_needs_a_live_user(db):
    with pytest.raises(ActionNotFound):
        bootstrap_owner(db, add_user(db, deleted=True), reason="first deploy")
    assert platform_owners(db) == frozenset()


# Making an Owner is a delayed action


def test_making_an_owner_waits_fifteen_minutes_then_assigns(sdb, clock):
    owner = staff(sdb)
    target = add_user(sdb)
    action = propose_owner(sdb, session(sdb, owner), user_id=target, reason="second owner")
    assert action.kind is delayed.ActionKind.OWNER_ASSIGN
    assert action.payload == {"user_id": target}
    with pytest.raises(delayed.NotReady):
        delayed.execute(sdb, action.id, assign_owner)
    clock.advance(delayed.DELAY_SECONDS)
    outcome = delayed.execute(sdb, action.id, assign_owner, executed_by=owner)
    assert outcome.ok
    assert outcome.result.approval_id == action.id
    assert outcome.result.issued_by == owner
    assert platform_owners(sdb) == {owner, target}


def test_proposing_yourself_as_owner_is_refused_and_audited(db):
    owner = staff(db)
    with pytest.raises(SelfApproval):
        propose_owner(db, session(db, owner), user_id=owner, reason="more power")
    (row,) = audit_rows(db, result="deny")
    assert (row["action"], row["reason"]) == ("security.owners.assign", "self-assignment")


def test_only_an_owner_may_propose_an_owner(db):
    staff(db)
    admin = staff(db, StaffRole.ADMIN)
    with pytest.raises(Forbidden):
        propose_owner(db, session(db, admin), user_id=add_user(db), reason="promote")
    assert delayed.pending(db) == []


def test_an_owner_is_only_proposed_for_a_live_user(db):
    with pytest.raises(ActionNotFound):
        propose_owner(db, session(db, staff(db)), user_id="nobody", reason="ghost")


def test_assign_owner_refuses_anything_but_an_owner_proposal(db):
    owner = staff(db)
    action = propose_owner(db, session(db, owner), user_id=add_user(db), reason="second owner")
    with pytest.raises(ValueError, match="not an Owner"):
        assign_owner(db, dataclasses.replace(action, kind=delayed.ActionKind.BULK_DELETE))
    with pytest.raises(SelfApproval):
        assign_owner(db, dataclasses.replace(action, payload={"user_id": owner}))


def test_an_owner_proposal_fails_when_the_target_is_deleted_before_it_runs(sdb, clock):
    owner = staff(sdb)
    target = add_user(sdb)
    action = propose_owner(sdb, session(sdb, owner), user_id=target, reason="second owner")
    delete_user(sdb, target)
    clock.advance(delayed.DELAY_SECONDS)
    outcome = delayed.execute(sdb, action.id, assign_owner)
    assert outcome.action.status is delayed.ActionStatus.FAILED
    assert outcome.action.note.startswith("ActionNotFound")
    assert platform_owners(sdb) == {owner}


# Signing a user out everywhere


def test_staff_sign_a_user_out_everywhere(db):
    admin = staff(db, StaffRole.ADMIN)
    target = staff(db, StaffRole.ANALYST)
    before = session(db, target, age=10)
    cutoff = revoke_user_sessions(db, session(db, admin), target, reason="stolen laptop")
    assert revoked_before(db, target) == cutoff
    with pytest.raises(Forbidden, match="session revoked"):
        authorize(db, before, "jobs.read")


def test_signing_others_out_needs_security_sessions_revoke(db):
    target = add_user(db)
    with pytest.raises(Forbidden):
        revoke_user_sessions(db, session(db, staff(db, StaffRole.SUPPORT)), target, reason="x")
    assert revoked_before(db, target) is None


# Support content access


def request(conn, actor, **overrides):
    fields = {
        "workspace_id": "w1",
        "support_case_id": "c1",
        "consent_ref": "ticket-7 consent",
        "reason": "customer reports a click at 1:32",
    }
    fields.update(overrides)
    return grants.request_content_access(conn, actor, **fields)


def test_support_cannot_request_content_access_alone_at_launch(db):
    staff(db)  # the one operator
    support = session(db, staff(db, StaffRole.SUPPORT, Scope.support_case("c1")))
    with pytest.raises(Forbidden) as caught:
        request(db, support)
    assert caught.value.permission == "support.content_access.approve"
    assert delayed.pending(db) == []


@pytest.mark.parametrize(
    "overrides",
    [
        {"workspace_id": ""},
        {"support_case_id": ""},
        {"consent_ref": "  "},
        {"minutes": 0},
        {"minutes": grants.MAX_MINUTES + 1},
        {"minutes": True},
        {"minutes": 30.0},
    ],
)
def test_a_content_access_request_needs_a_case_consent_and_a_short_window(db, overrides):
    with pytest.raises(ValueError):
        request(db, session(db, staff(db)), **overrides)


def test_one_operator_gets_content_access_after_the_delay(sdb, clock):
    owner = staff(sdb)
    actor = session(sdb, owner)
    action = request(sdb, actor, minutes=30)
    assert action.resource == grants.content_resource("w1", "c1")
    with pytest.raises(Forbidden):
        authorize(sdb, actor, "storage.content.read", workspace_ref("w1", "c1"))
    clock.advance(delayed.DELAY_SECONDS)
    outcome = delayed.execute(sdb, action.id, grants.issue_grant, executed_by=owner)
    grant = outcome.result
    assert (grant.staff_user_id, grant.workspace_id, grant.support_case_id) == (owner, "w1", "c1")
    assert grant.expires_at == clock.now + 30 * 60
    assert grant.approval_id == action.id and grant.approved_by is None
    assert audit_rows(sdb, action="support.content_access.granted")
    reader = session(sdb, owner)
    assert authorize(sdb, reader, "storage.content.read", workspace_ref("w1", "c1"))
    clock.advance(30 * 60)
    with pytest.raises(Forbidden):
        authorize(sdb, session(sdb, owner), "storage.content.read", workspace_ref("w1", "c1"))


def test_two_people_let_support_listen_once_a_second_person_approves(db):
    first, second = staff(db), staff(db, StaffRole.ADMIN)
    support = staff(db, StaffRole.SUPPORT, Scope.support_case("c1"))
    action = request(db, session(db, support))
    assert action.two_person
    approved = delayed.approve(db, session(db, second), action.id, payload_hash=action.payload_hash)
    outcome = delayed.execute(db, approved.id, grants.issue_grant, executed_by=first)
    assert outcome.ok and outcome.result.approved_by == second
    assert authorize(db, session(db, support), "storage.content.read", workspace_ref("w1", "c1"))


def test_issue_grant_refuses_other_actions_and_mismatched_resources(db):
    owner = staff(db)
    action = request(db, session(db, owner))
    with pytest.raises(ValueError, match="not a content access"):
        grants.issue_grant(db, dataclasses.replace(action, kind=delayed.ActionKind.BULK_DELETE))
    moved = dataclasses.replace(action, resource=grants.content_resource("w2", "c1"))
    with pytest.raises(ValueError, match="disagree"):
        grants.issue_grant(db, moved)
    other_case = dataclasses.replace(action, resource=grants.content_resource("w1", "c2"))
    with pytest.raises(ValueError, match="disagree"):
        grants.issue_grant(db, other_case)


def test_grants_are_listed_by_workspace_and_liveness(db):
    holder = add_user(db)
    live = add_grant(db, holder, "w1", "c1")
    add_grant(db, holder, "w1", "c2", expires_in=-5)
    other = add_grant(db, holder, "w2", "c3")
    assert [g.id for g in grants.list_grants(db, workspace_id="w1")] == [live]
    assert {g.id for g in grants.list_grants(db)} == {live, other}
    assert len(grants.list_grants(db, workspace_id="w1", active_only=False)) == 2


def revoked_by(conn, grant_id):
    t = access_grants
    return conn.execute(sa.select(t.c.revoked_by).where(t.c.id == grant_id)).scalar_one()


def test_the_holder_may_end_their_own_grant_early(db):
    holder = add_user(db)
    grant_id = add_grant(db, holder, "w1", "c1")
    revoked = grants.revoke_grant(db, session(db, holder), grant_id, reason="done listening")
    assert revoked.revoked_at is not None and revoked_by(db, grant_id) == holder
    with pytest.raises(Forbidden):
        authorize(db, session(db, holder), "storage.content.read", workspace_ref("w1"))
    (row,) = audit_rows(db, action="support.content_access.revoked")
    assert row["metadata"] == {"grant_id": grant_id, "support_case_id": "c1"}


def test_others_need_the_approving_permission_to_end_a_grant(db):
    grant_id = add_grant(db, add_user(db), "w1", "c1")
    with pytest.raises(Forbidden):
        grants.revoke_grant(db, session(db, staff(db, StaffRole.SUPPORT)), grant_id, reason="x")
    owner = session(db, staff(db))
    assert grants.revoke_grant(db, owner, grant_id, reason="case closed").revoked_at
    again = grants.revoke_grant(db, owner, grant_id, reason="twice")
    assert again.revoked_at is not None and revoked_by(db, grant_id) == owner.user_id
    assert len(audit_rows(db, action="support.content_access.revoked")) == 1


def test_an_unauthorized_grant_revoke_is_denied_even_when_already_revoked(db):
    holder = add_user(db)
    grant_id = add_grant(db, holder, "w1", "c1", revoked=True)
    outsider = session(db, staff(db, StaffRole.ANALYST))
    with pytest.raises(Forbidden):
        grants.revoke_grant(db, outsider, grant_id, reason="peek")
    assert audit_rows(db, result="deny", actor_id=outsider.user_id)


def test_a_missing_grant_is_not_found(db):
    with pytest.raises(ActionNotFound):
        grants.get_grant(db, "nope")


def test_the_modules_are_wired_to_the_documented_permissions():
    assert assignments.BOOTSTRAP_ISSUER == "bootstrap"
    assert grants.MAX_MINUTES == 240 and grants.DEFAULT_MINUTES == 60
    rule = delayed.RULES[delayed.ActionKind.CONTENT_ACCESS_GRANT]
    assert (rule.propose, rule.apply) == (
        "support.content_access.request",
        "support.content_access.approve",
    )
    assert db_now  # imported for the module notes' time rules
