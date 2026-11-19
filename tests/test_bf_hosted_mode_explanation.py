"""The admin account explanation reports the effective hosted/local-first mode (ADR-0455).

The explanation is the same targeting decision that drives each account's Cloud experience; it
must also retain the reason from each flag layer so an operator can tell why a mode is present.
"""

from __future__ import annotations

import pytest
from cloud_admin_kit import make_world

from selecta import flags
from selecta.flags import rules as flag_rules
from selecta.flags.matching import Rule, RuleKind
from selecta.persistence import transaction

PATH = "/api/admin/flags/explain/{user_id}"


@pytest.fixture
def world(cloud_engine):
    # The build flag must be on for account targeting rules to decide the local-first mode.
    flags.use("+cloud.local_first")
    built = make_world(cloud_engine, staff=("owner",))
    yield built
    built.http.__exit__(None, None, None)
    flags.use(None)


def _set_for_user(world, flag_id: str, user_id: str, enabled: bool) -> None:
    with transaction(world.engine) as conn:
        flag_rules.save(
            conn,
            flag_id,
            [Rule(RuleKind.USERS, {"ids": [user_id], "on": enabled})],
            author="test",
            reason="account experience explanation test",
        )


@pytest.mark.parametrize(
    ("local_first", "hosted", "expected_mode"),
    [
        (False, False, "neither"),
        (False, True, "hosted"),
        (True, False, "local_first"),
        (True, True, "both"),
    ],
)
def test_explain_endpoint_names_effective_mode_and_both_decision_reasons(
    world, local_first: bool, hosted: bool, expected_mode: str
):
    user_id = world.users["customer"]
    _set_for_user(world, "cloud.local_first", user_id, local_first)
    _set_for_user(world, "cloud.hosted_media", user_id, hosted)

    answer = world.get(PATH.format(user_id=user_id), who="owner")
    assert answer.status_code == 200, answer.text
    decision = answer.json()["browser_first_experience"]
    assert decision == {
        "mode": expected_mode,
        "local_first_on": local_first,
        "local_first_reason": "rule_on" if local_first else "rule_off",
        "hosted_media_on": hosted,
        "hosted_media_reason": "rule_on" if hosted else "rule_off",
    }
