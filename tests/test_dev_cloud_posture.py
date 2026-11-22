"""`dev.cmd cloud` shows the browser-first Cloud that ships (ADR-0455/0456): the browser-first
flags default on and hosted media is a grant, unless the developer asks for the hosted posture."""

from __future__ import annotations

import os

from selecta import flags
from selecta.devstack.cloud_app import (
    BROWSER_FIRST,
    HOSTED_DEV_ENV,
    HOSTED_FLAGS,
    browser_first_posture,
)
from selecta.flags import rules as flag_rules
from selecta.flags.matching import RuleKind
from selecta.persistence import make_engine, migrate, transaction


def _engine(tmp_path):
    engine = make_engine(f"sqlite:///{tmp_path / 'dev.sqlite'}")
    migrate.upgrade(engine)
    return engine


def test_the_shipped_defaults_are_the_browser_first_experience():
    registry = flags.registry()
    for flag in BROWSER_FIRST:
        assert registry[flag].default is True, flag
    assert registry["cloud.hosted_media"].rules_default is False


def test_dev_needs_no_setup_for_browser_first(tmp_path, monkeypatch):
    monkeypatch.delenv("SELECTA_FLAGS", raising=False)
    monkeypatch.delenv(HOSTED_DEV_ENV, raising=False)
    engine = _engine(tmp_path)
    try:
        browser_first_posture(engine)
        assert "SELECTA_FLAGS" not in os.environ
        with transaction(engine) as conn:
            assert flag_rules.current_rules(conn, "cloud.hosted_media") == ()
    finally:
        engine.dispose()


def test_the_hosted_switch_drops_browser_first_and_grants_hosted_media(tmp_path, monkeypatch):
    monkeypatch.setenv(HOSTED_DEV_ENV, "1")
    monkeypatch.delenv("SELECTA_FLAGS", raising=False)
    engine = _engine(tmp_path)
    try:
        browser_first_posture(engine)
        assert os.environ["SELECTA_FLAGS"] == HOSTED_FLAGS
        with transaction(engine) as conn:
            rules = flag_rules.current_rules(conn, "cloud.hosted_media")
        assert [rule.kind for rule in rules] == [RuleKind.PERCENTAGE]
        assert rules[0].params["percent"] == 100
        # Running again changes nothing.
        browser_first_posture(engine)
        with transaction(engine) as conn:
            assert len(flag_rules.current_rules(conn, "cloud.hosted_media")) == 1
    finally:
        engine.dispose()


def test_a_developers_own_flags_win_in_the_hosted_posture(tmp_path, monkeypatch):
    monkeypatch.setenv(HOSTED_DEV_ENV, "1")
    monkeypatch.setenv("SELECTA_FLAGS", "+lucy")
    engine = _engine(tmp_path)
    try:
        browser_first_posture(engine)
        assert os.environ["SELECTA_FLAGS"] == "+lucy"
    finally:
        engine.dispose()
