from __future__ import annotations

import pytest

from selecta.flags import Flag
from selecta.flags import rules as flag_rules
from selecta.identity import accounts
from selecta.identity.tokens import Claims
from selecta.persistence import make_engine, metadata, transaction
from selecta.persistence.registry import load_all_tables


@pytest.fixture
def database(tmp_path):
    load_all_tables()
    engine = make_engine(f"sqlite:///{tmp_path / 'flags.sqlite'}")
    metadata.create_all(engine)
    with transaction(engine) as conn:
        provisioned = accounts.provision(
            conn,
            Claims("auth0|labs", 1_000, 10_000, "labs@example.test", True),
            age_confirmed=True,
        )
    yield engine, provisioned.user.id
    engine.dispose()


def test_user_preferences_are_beta_only_and_cannot_cross_plan_entitlements(database):
    engine, user_id = database
    beta = Flag(
        id="cloud.preview",
        area="Cloud",
        label="Preview",
        about="A preview feature",
        modes=("cloud",),
        kind="beta",
    )
    release = Flag(
        id="cloud.release",
        area="Cloud",
        label="Release",
        about="A normal feature",
        modes=("cloud",),
        kind="release",
    )
    registry = {beta.id: beta, release.id: release}
    gated = {beta.id}

    with transaction(engine) as conn:
        with pytest.raises(flag_rules.RuleError):
            flag_rules.set_user_preference(
                conn, user_id, beta.id, True, entitled=set(), plan_gated=gated, registry=registry
            )
        with pytest.raises(flag_rules.RuleError):
            flag_rules.set_user_preference(
                conn,
                user_id,
                release.id,
                True,
                entitled={release.id},
                plan_gated=set(),
                registry=registry,
            )
        with pytest.raises(flag_rules.RuleError):
            flag_rules.set_user_preference(
                conn, user_id, beta.id, 1, entitled={beta.id}, plan_gated=gated, registry=registry
            )
        flag_rules.set_user_preference(
            conn, user_id, beta.id, False, entitled=set(), plan_gated=gated, registry=registry
        )
        assert flag_rules.user_preferences(conn, user_id) == {beta.id: False}
        flag_rules.set_user_preference(
            conn, user_id, beta.id, True, entitled={beta.id}, plan_gated=gated, registry=registry
        )
        assert flag_rules.user_preferences(conn, user_id) == {beta.id: True}
