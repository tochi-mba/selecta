"""Which allowance model a workspace is on (`selecta.ai.usage_mode`, ADR-0487).

A workspace is on the enforced model only when a rule grants it `lucy.usage_windows` and its
cutover time has passed. Everything short of that is the shadow model, and a build with
`lucy.usage_shadow` off is on the turn model alone.
"""

from __future__ import annotations

import pytest
import sqlalchemy as sa

from selecta import flags
from selecta.ai import usage_mode
from selecta.ai.usage_mode import ENFORCED, LEGACY, SHADOW, WINDOWS_FLAG
from selecta.ai.usage_schema import lucy_usage_state
from selecta.flags import rules as flag_rules
from selecta.flags.matching import Rule, RuleKind, RuleSnapshot
from selecta.identity.schema import users, workspace_members, workspaces
from selecta.persistence import transaction

NOW = 1_800_000_000.0
BUILD = "+cloud.local_media +lucy.cloud_conversation"
WORKSPACE, OWNER, MEMBER = "ws-mode", "user-owner", "user-member"
NO_RULES = RuleSnapshot(1, {})


def grant(*workspace_ids: str) -> RuleSnapshot:
    rule = Rule(RuleKind.WORKSPACES, {"ids": list(workspace_ids), "on": True})
    return RuleSnapshot(1, {WINDOWS_FLAG: (rule,)})


def grant_people(*user_ids: str) -> RuleSnapshot:
    rule = Rule(RuleKind.USERS, {"ids": list(user_ids), "on": True})
    return RuleSnapshot(1, {WINDOWS_FLAG: (rule,)})


@pytest.fixture
def shadow_build():
    flags.use(f"{BUILD} +lucy.usage_shadow")
    yield
    flags.use(None)


@pytest.fixture
def engine(cloud_engine):
    """One workspace with its owner and a second member."""
    with transaction(cloud_engine) as conn:
        for user in (OWNER, MEMBER):
            conn.execute(users.insert().values(
                id=user, auth_subject=f"auth|{user}", email_verified=True, timezone="UTC",
                age_confirmed=True, created_at=NOW - 86_400,
            ))
        conn.execute(workspaces.insert().values(
            id=WORKSPACE, name="Mine", kind="personal", owner_user_id=OWNER,
            created_at=NOW - 86_400,
        ))
        for user, role in ((OWNER, "owner"), (MEMBER, "editor")):
            conn.execute(workspace_members.insert().values(
                workspace_id=WORKSPACE, user_id=user, role=role, created_at=NOW - 86_400,
            ))
    return cloud_engine


def mode(engine, rules, now=NOW, workspace=WORKSPACE) -> str:
    with transaction(engine, workspace) as conn:
        return usage_mode.mode_for(conn, workspace, rules, now)


def granted(engine, rules, now=NOW, workspace=WORKSPACE) -> bool:
    with transaction(engine, workspace) as conn:
        return usage_mode.granted(conn, workspace, rules, now)


def cut_over(engine, at, workspace=WORKSPACE, now=NOW) -> None:
    with transaction(engine, workspace) as conn:
        usage_mode.set_cutover(conn, workspace, at=at, plan_id="free", now=now)


def state(engine, workspace=WORKSPACE) -> dict:
    with transaction(engine, workspace) as conn:
        row = conn.execute(
            sa.select(lucy_usage_state).where(lucy_usage_state.c.workspace_id == workspace)
        ).first()
    return dict(row._mapping)


def test_a_workspace_is_on_the_shadow_model_by_default_once_the_build_measures(
    engine, shadow_build
):
    assert mode(engine, NO_RULES) == SHADOW


def test_with_the_shadow_flag_off_every_workspace_is_on_the_turn_model(engine):
    flags.use(f"{BUILD} -lucy.usage_shadow")
    try:
        cut_over(engine, NOW - 10)
        assert flags.on(usage_mode.SHADOW_FLAG) is False
        assert mode(engine, grant(WORKSPACE)) == LEGACY
        assert mode(engine, None) == LEGACY
    finally:
        flags.use(None)


def test_a_flag_the_build_does_not_know_counts_as_off(engine, shadow_build, monkeypatch):
    monkeypatch.setattr(usage_mode, "SHADOW_FLAG", "lucy.no_such_flag")

    assert mode(engine, grant(WORKSPACE)) == LEGACY


def test_a_grant_and_a_cutover_in_the_past_make_the_workspace_enforced(engine, shadow_build):
    cut_over(engine, NOW - 1)

    assert mode(engine, grant(WORKSPACE)) == ENFORCED


def test_the_workspace_becomes_enforced_at_the_cutover_instant_and_not_before(
    engine, shadow_build
):
    cut_over(engine, NOW + 100)
    rules = grant(WORKSPACE)

    assert mode(engine, rules, now=NOW + 99) == SHADOW
    assert mode(engine, rules, now=NOW + 100) == ENFORCED
    assert mode(engine, rules, now=NOW + 101) == ENFORCED


def test_a_grant_without_a_cutover_is_shadow(engine, shadow_build):
    assert granted(engine, grant(WORKSPACE)) is True
    assert mode(engine, grant(WORKSPACE)) == SHADOW


def test_a_cutover_without_a_grant_is_shadow(engine, shadow_build):
    cut_over(engine, NOW - 1)

    assert mode(engine, NO_RULES) == SHADOW
    assert mode(engine, grant("ws-someone-else")) == SHADOW


def test_no_rules_at_all_is_never_enforced(engine, shadow_build):
    cut_over(engine, NOW - 1)

    assert granted(engine, None) is False
    assert mode(engine, None) == SHADOW


def test_the_owner_decides_for_every_member_of_the_workspace(engine, shadow_build):
    """The answer takes no person: a rule naming the owner turns the whole workspace on, and a
    rule naming only another member turns it on for nobody."""
    cut_over(engine, NOW - 1)

    assert mode(engine, grant_people(OWNER)) == ENFORCED
    assert mode(engine, grant_people(MEMBER)) == SHADOW
    assert granted(engine, grant_people(MEMBER)) is False


def test_an_unknown_workspace_is_not_granted(engine, shadow_build):
    assert granted(engine, grant("ws-unknown"), workspace="ws-unknown") is False
    assert mode(engine, grant("ws-unknown"), workspace="ws-unknown") == SHADOW


def test_a_workspace_whose_owner_is_deleted_is_not_granted(engine, shadow_build):
    with transaction(engine) as conn:
        conn.execute(users.update().where(users.c.id == OWNER).values(deleted_at=NOW - 5))

    assert granted(engine, grant(WORKSPACE)) is False


def test_the_grant_needs_cloud_lucy_on_in_the_build(engine):
    flags.use("+cloud.local_media -lucy.cloud_conversation")
    try:
        assert granted(engine, grant(WORKSPACE)) is False
    finally:
        flags.use(None)


def test_rules_saved_by_staff_grant_the_named_workspace_only(engine, shadow_build):
    other = "ws-other"
    with transaction(engine) as conn:
        conn.execute(users.insert().values(
            id="user-other", auth_subject="auth|user-other", email_verified=True,
            timezone="UTC", age_confirmed=True, created_at=NOW,
        ))
        conn.execute(workspaces.insert().values(
            id=other, name="Theirs", kind="personal", owner_user_id="user-other",
            created_at=NOW,
        ))
        rule = Rule(RuleKind.WORKSPACES, {"ids": [WORKSPACE], "on": True})
        flag_rules.save(conn, WINDOWS_FLAG, [rule], author="test", reason="staff first")
        saved = flag_rules.load_snapshot(conn)
    cut_over(engine, NOW - 1)
    cut_over(engine, NOW - 1, workspace=other)

    assert mode(engine, saved) == ENFORCED
    assert mode(engine, saved, workspace=other) == SHADOW
    cache = flag_rules.RulesCache(engine)
    assert mode(engine, cache) == ENFORCED


def test_setting_a_cutover_makes_the_row_and_records_when_it_became_eligible(
    engine, shadow_build
):
    cut_over(engine, NOW + 500, now=NOW)
    cut_over(engine, NOW + 900, now=NOW + 50)

    row = state(engine)
    assert (row["cutover_at"], row["eligible_at"]) == (NOW + 900, NOW)
    assert (row["week_seq"], row["week_used"], row["plan_id"]) == (1, 0, "free")


def test_clearing_the_cutover_puts_the_workspace_back_on_the_shadow_model(engine, shadow_build):
    cut_over(engine, NOW - 1)
    assert mode(engine, grant(WORKSPACE)) == ENFORCED

    with transaction(engine, WORKSPACE) as conn:
        usage_mode.clear_cutover(conn, WORKSPACE)

    assert state(engine)["cutover_at"] is None
    assert mode(engine, grant(WORKSPACE)) == SHADOW
