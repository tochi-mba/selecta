"""Staff roles, the permission registry, scopes and workspace roles (ADR-0401, §7.3, §11B.9).

Everything here is pure code: no database. The checks that read assignments live in
`test_cloud_authz_check.py`.
"""

from __future__ import annotations

import dataclasses

import pytest

from selecta.authz import permissions, roles
from selecta.authz.check import require_workspace_action
from selecta.authz.errors import (
    Forbidden,
    InvalidScope,
    StepUpRequired,
    UnknownPermission,
    UnknownRole,
)
from selecta.authz.permissions import PERMISSIONS, Danger, Permission
from selecta.authz.roles import (
    FLAG_PREFIXES,
    ROLE_PERMISSIONS,
    StaffRole,
    WorkspaceAction,
    WorkspaceRole,
    check_scope,
    may_change_flag,
    permissions_for,
    roles_with,
    staff_role,
    workspace_allows,
    workspace_role,
)
from selecta.authz.scopes import ResourceRef, Scope

READ = "flags.read"
PREVIEW = "flags.preview_self"
OVERRIDE = "flags.user_override"
KILL = "flags.kill_switch"
PROPOSE = "flags.rules.propose"
APPLY = "flags.rules.apply"
EMERGENCY = "platform.emergency_controls.manage"
FLAG_POWERS = frozenset({READ, PREVIEW, OVERRIDE, KILL, PROPOSE, APPLY, EMERGENCY})

# §11B.9, the role table: exactly these flag powers, no more.
FLAG_POWERS_BY_ROLE = {
    StaffRole.OWNER: FLAG_POWERS,
    StaffRole.ADMIN: FLAG_POWERS,
    StaffRole.OPERATOR: frozenset({READ, PREVIEW, OVERRIDE, KILL, EMERGENCY}),
    StaffRole.AI_ADMIN: frozenset({READ, PREVIEW, KILL, PROPOSE, APPLY}),
    StaffRole.SUPPORT: frozenset({READ, PREVIEW, OVERRIDE}),
    StaffRole.BILLING: frozenset({READ}),
    StaffRole.ANALYST: frozenset({READ}),
    StaffRole.AUDITOR: frozenset({READ}),
}

# §11B.9, the permission table: what each flag power costs.
FLAG_DANGER = {
    READ: Danger.READ,
    PREVIEW: Danger.CHANGE,
    OVERRIDE: Danger.SENSITIVE,
    KILL: Danger.DANGEROUS,
    PROPOSE: Danger.CHANGE,
    APPLY: Danger.DANGEROUS,
    EMERGENCY: Danger.DANGEROUS,
}

# §7.3: operations covers running the service, not accounts, billing or security.
OPERATIONS_AREAS = {"jobs", "queues", "workers", "models", "storage", "flags"}
OPERATIONS_PLATFORM = {
    "platform.dashboard.read",
    "platform.incidents.manage",
    "platform.emergency_controls.manage",
}


# Roles and the registry


def test_every_staff_role_has_a_bundle_and_a_title():
    assert set(ROLE_PERMISSIONS) == set(StaffRole)
    titles = {role.title for role in StaffRole}
    assert titles == {
        "Owner",
        "Admin",
        "Operator",
        "AI Admin",
        "Support",
        "Billing",
        "Analyst",
        "Auditor",
    }


@pytest.mark.parametrize("role", list(StaffRole))
def test_every_permission_in_a_role_exists_in_the_registry(role):
    bundle = ROLE_PERMISSIONS[role]
    assert bundle, f"{role} grants nothing"
    assert bundle <= permissions.all_names()
    assert permissions.require_known(bundle) == bundle


def test_no_role_holds_storage_content_read():
    for role, bundle in ROLE_PERMISSIONS.items():
        assert "storage.content.read" not in bundle, role
    assert permissions.grant_only() == {"storage.content.read"}
    assert roles_with("storage.content.read") == frozenset()


def test_owner_holds_every_permission_a_role_can_hold():
    assert ROLE_PERMISSIONS[StaffRole.OWNER] == permissions.all_names() - permissions.grant_only()


def test_admin_holds_everything_the_owner_does_except_owner_assignment():
    owner = ROLE_PERMISSIONS[StaffRole.OWNER]
    assert owner - ROLE_PERMISSIONS[StaffRole.ADMIN] == {"security.owners.assign"}
    assert roles_with("security.owners.assign") == {StaffRole.OWNER}


def test_analyst_and_auditor_only_read():
    for role in (StaffRole.ANALYST, StaffRole.AUDITOR):
        for name in ROLE_PERMISSIONS[role]:
            assert PERMISSIONS[name].danger is Danger.READ, (role, name)
    assert "audit.read" in ROLE_PERMISSIONS[StaffRole.AUDITOR]
    assert "audit.read" not in ROLE_PERMISSIONS[StaffRole.ANALYST]


def test_support_can_request_content_access_but_not_approve_it():
    support = ROLE_PERMISSIONS[StaffRole.SUPPORT]
    assert "support.content_access.request" in support
    assert "support.content_access.approve" not in support


def test_billing_can_propose_overrides_but_not_approve_them():
    billing = ROLE_PERMISSIONS[StaffRole.BILLING]
    assert "billing.overrides.create" in billing
    assert "billing.overrides.approve" not in billing


def test_only_owner_and_admin_may_assign_roles():
    assert roles_with("security.roles.assign") == {StaffRole.OWNER, StaffRole.ADMIN}


# Flag powers (§11B.9)


@pytest.mark.parametrize("role", list(StaffRole))
def test_each_role_has_exactly_its_flag_powers(role):
    assert ROLE_PERMISSIONS[role] & FLAG_POWERS == FLAG_POWERS_BY_ROLE[role]


@pytest.mark.parametrize("name", sorted(FLAG_DANGER))
def test_each_flag_power_has_its_documented_danger(name):
    assert PERMISSIONS[name].danger is FLAG_DANGER[name]


def test_flag_danger_decides_audit_and_step_up():
    assert not PERMISSIONS[READ].audited and PERMISSIONS[READ].fresh_mfa_seconds is None
    assert PERMISSIONS[OVERRIDE].audited and PERMISSIONS[OVERRIDE].fresh_mfa_seconds is None
    for name in (KILL, APPLY, EMERGENCY):
        assert PERMISSIONS[name].audited
        assert PERMISSIONS[name].fresh_mfa_seconds == permissions.STEP_UP_SECONDS == 300


@pytest.mark.parametrize(
    ("role", "flag", "allowed"),
    [
        (StaffRole.OWNER, "rooms", True),
        (StaffRole.OWNER, "lucy.voice", True),
        (StaffRole.ADMIN, "cloud.uploads", True),
        (StaffRole.OPERATOR, "rooms", True),
        (StaffRole.SUPPORT, "devices.remote_control", True),
        (StaffRole.AI_ADMIN, "lucy", True),
        (StaffRole.AI_ADMIN, "lucy.voice", True),
        (StaffRole.AI_ADMIN, "lucy.voice.beta", True),
        (StaffRole.AI_ADMIN, "lucyx", False),
        (StaffRole.AI_ADMIN, "lucy_beta", False),
        (StaffRole.AI_ADMIN, "rooms", False),
        (StaffRole.AI_ADMIN, "cloud.lucy", False),
        (StaffRole.BILLING, "lucy.voice", False),
        (StaffRole.BILLING, "rooms", False),
        (StaffRole.ANALYST, "rooms", False),
        (StaffRole.AUDITOR, "lucy.voice", False),
    ],
)
def test_may_change_flag_follows_the_role_table(role, flag, allowed):
    assert may_change_flag(role, flag) is allowed


def test_ai_admin_may_change_only_lucy_flags():
    assert FLAG_PREFIXES[StaffRole.AI_ADMIN] == ("lucy",)
    assert may_change_flag("ai_admin", "lucy.voice")
    assert not may_change_flag("ai_admin", "billing.checkout")


def test_roles_without_flag_powers_beyond_read_may_change_no_flag():
    for role in (StaffRole.BILLING, StaffRole.ANALYST, StaffRole.AUDITOR):
        assert role not in FLAG_PREFIXES


def test_may_change_flag_refuses_an_unknown_role():
    with pytest.raises(UnknownRole):
        may_change_flag("wizard", "rooms")


# The permission registry


def test_every_permission_is_well_formed_and_described():
    for name, permission in PERMISSIONS.items():
        assert permissions.NAME.match(name)
        assert permission.name == name
        assert permission.description.strip()


def test_a_permission_knows_its_area():
    assert PERMISSIONS["jobs.retry"].area == "jobs"
    assert PERMISSIONS["platform.dashboard.read"].area == "platform"


@pytest.mark.parametrize(
    ("danger", "audited", "fresh"),
    [
        (Danger.READ, False, None),
        (Danger.CHANGE, False, None),
        (Danger.SENSITIVE, True, None),
        (Danger.DANGEROUS, True, 300),
    ],
)
def test_danger_decides_audit_and_mfa_freshness(danger, audited, fresh):
    permission = Permission("x.y", "a thing", danger)
    assert permission.audited is audited
    assert permission.fresh_mfa_seconds == fresh


def test_an_unknown_permission_raises_with_the_closest_real_name():
    with pytest.raises(UnknownPermission) as caught:
        permissions.get("jobs.retyr")
    assert caught.value.suggestion == "jobs.retry"
    assert "did you mean 'jobs.retry'" in str(caught.value)
    assert isinstance(caught.value, LookupError)


def test_an_unknown_permission_with_nothing_close_raises_without_a_hint():
    with pytest.raises(UnknownPermission) as caught:
        permissions.get("zzzz")
    assert caught.value.suggestion is None
    assert "did you mean" not in str(caught.value)


def test_require_known_refuses_any_unknown_name():
    with pytest.raises(UnknownPermission):
        permissions.require_known(["jobs.read", "jobs.explode"])


@pytest.mark.parametrize(
    ("declared", "problem"),
    [
        ([Permission("Jobs.read", "x", Danger.READ)], "badly formed"),
        ([Permission("jobs", "x", Danger.READ)], "badly formed"),
        (
            [Permission("jobs.read", "x", Danger.READ), Permission("jobs.read", "y", Danger.READ)],
            "declared twice",
        ),
        ([Permission("jobs.read", "  ", Danger.READ)], "no description"),
    ],
)
def test_the_registry_refuses_bad_declarations(declared, problem):
    with pytest.raises(ValueError, match=problem):
        permissions._build(declared)


def test_the_registry_cannot_be_edited_at_runtime():
    with pytest.raises(TypeError):
        PERMISSIONS["jobs.read"] = PERMISSIONS["jobs.retry"]  # type: ignore[index]


# Bundle validation


def test_validation_refuses_a_role_without_a_bundle():
    bundles = dict(ROLE_PERMISSIONS)
    del bundles[StaffRole.AUDITOR]
    with pytest.raises(ValueError, match="without a permission bundle"):
        roles.validate(bundles)


def test_validation_refuses_a_role_naming_an_unknown_permission():
    bundles = dict(ROLE_PERMISSIONS)
    bundles[StaffRole.ANALYST] = frozenset({"jobs.read", "jobs.explode"})
    with pytest.raises(UnknownPermission):
        roles.validate(bundles)


def test_validation_refuses_a_role_holding_a_grant_only_permission():
    bundles = dict(ROLE_PERMISSIONS)
    bundles[StaffRole.SUPPORT] = bundles[StaffRole.SUPPORT] | {"storage.content.read"}
    with pytest.raises(ValueError, match="grant-only"):
        roles.validate(bundles)


def test_role_lookups_by_name():
    assert staff_role("ai_admin") is StaffRole.AI_ADMIN
    assert permissions_for("analyst") == ROLE_PERMISSIONS[StaffRole.ANALYST]
    with pytest.raises(UnknownRole):
        staff_role("superuser")
    with pytest.raises(UnknownPermission):
        roles_with("jobs.explode")


# Which scopes a role may be given


@pytest.mark.parametrize(
    "scope", [Scope.platform("operations"), Scope.workspace("w1"), Scope.support_case("c1")]
)
@pytest.mark.parametrize("role", [StaffRole.OWNER, StaffRole.ADMIN])
def test_owner_and_admin_are_only_assigned_platform_wide(role, scope):
    check_scope(role, Scope.platform())
    with pytest.raises(InvalidScope):
        check_scope(role, scope)


@pytest.mark.parametrize(
    ("role", "allowed"),
    [
        (StaffRole.OPERATOR, {"platform:*", "platform:operations"}),
        (StaffRole.AI_ADMIN, {"platform:*", "platform:operations"}),
        (StaffRole.ANALYST, {"platform:*", "platform:operations"}),
        (StaffRole.AUDITOR, {"platform:*", "platform:operations"}),
        (
            StaffRole.SUPPORT,
            {"platform:*", "platform:operations", "workspace:w1", "support_case:c1"},
        ),
        (StaffRole.BILLING, {"platform:*", "platform:operations", "workspace:w1"}),
    ],
)
def test_each_role_is_assigned_only_at_the_scopes_it_allows(role, allowed):
    every = ["platform:*", "platform:operations", "workspace:w1", "support_case:c1"]
    for text in every:
        scope = Scope.parse(text)
        if text in allowed:
            check_scope(role, scope)
        else:
            with pytest.raises(InvalidScope):
                check_scope(role, scope)


def test_check_scope_refuses_an_unknown_role():
    with pytest.raises(UnknownRole):
        check_scope("wizard", Scope.platform())


# Scopes


def test_scopes_are_written_type_colon_id():
    for text in ("platform:*", "platform:operations", "workspace:w1", "support_case:c1"):
        assert str(Scope.parse(text)) == text
    assert Scope.platform() == Scope("platform", "*")
    assert Scope.workspace("w1") == Scope("workspace", "w1")
    assert Scope.support_case("c1") == Scope("support_case", "c1")
    assert Scope.platform().is_platform_wide
    assert not Scope.platform("operations").is_platform_wide
    assert not Scope.workspace("w1").is_platform_wide


@pytest.mark.parametrize(
    "text", ["platform", "account:1", "workspace:", "platform:billing", "platform:", ":x"]
)
def test_a_scope_the_code_does_not_know_is_refused(text):
    with pytest.raises(InvalidScope):
        Scope.parse(text)


def test_platform_wide_covers_every_permission_on_every_resource():
    scope = Scope.platform()
    for name in PERMISSIONS:
        assert scope.covers(name, ResourceRef("anything", "1", "w9", "c9"))
        assert scope.covers(name, ResourceRef("platform"))


def test_operations_covers_running_the_service_and_nothing_else():
    scope = Scope.platform("operations")
    for name in PERMISSIONS:
        expected = name.split(".", 1)[0] in OPERATIONS_AREAS or name in OPERATIONS_PLATFORM
        assert scope.covers(name, ResourceRef("platform")) is expected, name
    for name in (
        "accounts.suspend",
        "billing.overrides.approve",
        "security.roles.assign",
        "audit.read",
        "support.cases.read",
        "platform.deployments.approve",
    ):
        assert not scope.covers(name, ResourceRef("platform"))


def test_a_workspace_scope_covers_only_resources_in_that_workspace():
    scope = Scope.workspace("w1")
    assert scope.covers("billing.subscriptions.read", ResourceRef("sub", "s", "w1"))
    assert scope.covers("billing.subscriptions.read", ResourceRef("sub", "s", "w1", "c1"))
    assert not scope.covers("billing.subscriptions.read", ResourceRef("sub", "s", "w2"))
    assert not scope.covers("billing.subscriptions.read", ResourceRef("sub", "s"))
    assert not scope.covers("billing.subscriptions.read", ResourceRef("sub", "w1"))


def test_a_support_case_scope_covers_only_resources_in_that_case():
    scope = Scope.support_case("c1")
    assert scope.covers("support.diagnostics.read", ResourceRef("case", "c1", None, "c1"))
    assert scope.covers("support.diagnostics.read", ResourceRef("account", "a", "w1", "c1"))
    assert not scope.covers("support.diagnostics.read", ResourceRef("case", "c2", None, "c2"))
    assert not scope.covers("support.diagnostics.read", ResourceRef("account", "a", "w1"))
    assert not scope.covers("support.diagnostics.read", ResourceRef("case", "c1"))


def test_a_scope_type_the_code_does_not_understand_covers_nothing():
    # A scope can only get here by skipping validation; it must still deny.
    scope = object.__new__(Scope)
    object.__setattr__(scope, "type", "galaxy")
    object.__setattr__(scope, "id", "*")
    assert not scope.covers("jobs.read", ResourceRef("platform"))


def test_narrower_scopes_sort_first():
    scopes = [
        Scope.platform(),
        Scope.platform("operations"),
        Scope.workspace("w"),
        Scope.support_case("c"),
    ]
    ordered = sorted(scopes, key=Scope.specificity)
    assert [s.specificity() for s in ordered] == [0, 0, 1, 2]
    assert ordered[-1] == Scope.platform()


def test_a_resource_is_a_plain_value():
    ref = ResourceRef("workspace", "w1", "w1")
    assert dataclasses.replace(ref) == ref
    assert ref.support_case_id is None


# Workspace roles (a separate system from staff roles)


def test_workspace_roles_allow_what_their_names_say():
    every = set(WorkspaceAction)
    view = {WorkspaceAction.LIBRARY_READ, WorkspaceAction.MIXES_READ}
    edit = view | {WorkspaceAction.LIBRARY_WRITE, WorkspaceAction.MIXES_EDIT}
    expected = {WorkspaceRole.OWNER: every, WorkspaceRole.EDITOR: edit, WorkspaceRole.VIEWER: view}
    for role, allowed in expected.items():
        for action in every:
            assert workspace_allows(role, action) is (action in allowed), (role, action)


def test_only_a_workspace_owner_manages_members_and_billing():
    for action in ("members.manage", "billing.manage"):
        assert workspace_allows("owner", action)
        assert not workspace_allows("editor", action)
        assert not workspace_allows("viewer", action)


def test_an_unknown_workspace_action_is_never_allowed():
    assert not workspace_allows("owner", "library.burn")


def test_an_unknown_workspace_role_raises():
    with pytest.raises(UnknownRole):
        workspace_allows("admin", "library.read")
    assert workspace_role("viewer") is WorkspaceRole.VIEWER


def test_require_workspace_action_raises_forbidden_when_not_allowed():
    require_workspace_action("editor", "mixes.edit")
    with pytest.raises(Forbidden) as caught:
        require_workspace_action(WorkspaceRole.VIEWER, WorkspaceAction.MIXES_EDIT)
    assert caught.value.permission == "workspace.mixes.edit"
    assert caught.value.audit_id is None


def test_step_up_required_is_a_forbidden_carrying_its_window():
    error = StepUpRequired("jobs.read", "MFA isn't fresh enough", 300, "audit-1")
    assert isinstance(error, Forbidden)
    assert (error.permission, error.reason, error.max_age, error.audit_id) == (
        "jobs.read",
        "MFA isn't fresh enough",
        300,
        "audit-1",
    )
    assert str(error) == "jobs.read: MFA isn't fresh enough"
