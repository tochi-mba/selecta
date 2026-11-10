"""The registry fields only the cloud reads: their defaults keep today's behaviour, and every
invalid value is reported (ADR-0414; docs/saas/11b-feature-flags.md §11B.6;
docs/saas/18-test-plan.md §18.8)."""

from __future__ import annotations

import datetime as dt

import pytest

from selecta import flags
from selecta.flags import KINDS, MODES, SCOPES, WHEN_LOCKED, WHEN_OFF, Flag


def make(flag_id: str = "feature", **fields) -> Flag:
    return Flag(id=flag_id, area="Test", label="Feature", about="A feature", **fields)


def test_a_flag_that_leaves_out_the_cloud_fields_keeps_todays_behaviour():
    flag = make()
    assert (flag.scope, flag.modes, flag.when_off, flag.when_locked, flag.kind) == (
        "global",
        ("local", "cloud"),
        "drain",
        "hide",
        "release",
    )
    assert flag.owner is None
    assert flag.review_by is None
    assert flags.problems({flag.id: flag}) == []


def test_the_cloud_fields_never_change_what_selecta_flags_resolves_to():
    plain = {"a": make("a"), "b": make("b", requires=("a",))}
    dressed = {
        "a": make("a", scope="user", modes=("cloud",), when_off="stop", kind="beta"),
        "b": make("b", requires=("a",), when_locked="teaser", owner="team", review_by="2027-01-31"),
    }
    for text in ("", "-a", "minimal", "all", "-b"):
        assert flags.resolve(text, plain) == flags.resolve(text, dressed)


def test_every_real_flag_uses_only_allowed_values_and_the_registry_has_no_problems():
    for flag in flags.registry().values():
        assert flag.scope in SCOPES
        assert flag.when_off in WHEN_OFF
        assert flag.when_locked in WHEN_LOCKED
        assert flag.kind in KINDS
        assert flag.modes
        assert set(flag.modes) <= set(MODES)
    assert flags.problems() == []


@pytest.mark.parametrize(
    ("field", "value", "problem"),
    [
        ("scope", "team", "feature: scope is 'team'; it can be global, workspace, user, guest"),
        ("when_off", "pause", "feature: when_off is 'pause'; it can be drain, stop"),
        ("when_locked", "blur", "feature: when_locked is 'blur'; it can be hide, teaser"),
        ("kind", "canary", "feature: kind is 'canary'; it can be release, ops, experiment, beta"),
        ("modes", (), "feature: modes can't be empty; leave it out to mean every mode"),
        ("modes", ("desktop",), "feature: 'desktop' isn't a mode; modes are local, cloud"),
        ("modes", ("cloud", "cloud"), "feature: modes lists the same mode twice"),
        ("owner", "  ", "feature: owner should be a name, or left out"),
        ("owner", 7, "feature: owner should be a name, or left out"),
        (
            "review_by",
            "next spring",
            "feature: review_by 'next spring' isn't a date like 2027-01-31",
        ),
        ("review_by", "2027-02-30", "feature: review_by '2027-02-30' isn't a date like 2027-01-31"),
    ],
)
def test_an_invalid_cloud_field_is_reported(field, value, problem):
    flag = make(**{field: value})
    assert flags.problems({flag.id: flag}) == [problem]


def test_every_invalid_cloud_field_is_reported_at_once():
    flag = make(scope="team", kind="canary", modes=("desktop",), review_by="soon")
    assert len(flags.problems({flag.id: flag})) == 4


def test_a_cloud_only_core_flag_is_core_where_it_exists():
    flag = make(core="Needed to delete an account", modes=("cloud",))
    assert flags.problems({flag.id: flag}) == []
    assert flags.resolve("", {flag.id: flag})[flag.id] == flags.State(True, "core")


def test_flags_past_their_review_date_are_listed_and_the_rest_are_not():
    registry = {
        flag.id: flag
        for flag in (
            make("late", review_by="2026-11-08"),
            make("today", review_by="2026-11-09"),
            make("later", review_by="2027-01-01"),
            make("never"),
            make("garbled", review_by="soon"),
        )
    }
    found = flags.overdue(dt.date(2026, 11, 9), registry)
    assert found == ["late: was due for review on 2026-11-08"]


def test_the_review_check_defaults_to_today_and_the_real_registry():
    assert isinstance(flags.overdue(), list)
