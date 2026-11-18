"""`dev.cmd cloud` shows the browser-first Cloud (ADR-0455/0456): the build runs the BF flags
and hosted media is admin-granted only, unless the developer asks for the hosted posture."""

from __future__ import annotations

from selecta.devstack.cloud_app import BROWSER_FIRST_FLAGS, HOSTED_DEV_ENV, browser_first_posture
from selecta.flags import rules as flag_rules
from selecta.flags.matching import RuleKind
from selecta.persistence import make_engine, migrate, transaction


def _engine(tmp_path):
    engine = make_engine(f"sqlite:///{tmp_path / 'dev.sqlite'}")
    migrate.upgrade(engine)
    return engine


def test_dev_defaults_to_the_browser_first_experience(tmp_path, monkeypatch):
    monkeypatch.delenv("SELECTA_FLAGS", raising=False)
    monkeypatch.delenv(HOSTED_DEV_ENV, raising=False)
    engine = _engine(tmp_path)
    try:
        browser_first_posture(engine)
        import os

        assert os.environ["SELECTA_FLAGS"] == BROWSER_FIRST_FLAGS
        for flag in ("cloud.local_first", "cloud.local_media", "devices.browser_player", "cloud.hosted_shell"):
            assert f"+{flag}" in BROWSER_FIRST_FLAGS
        with transaction(engine) as conn:
            rules = flag_rules.current_rules(conn, "cloud.hosted_media")
        assert [rule.kind for rule in rules] == [RuleKind.PERCENTAGE]
        assert rules[0].params["percent"] == 0
        # Running again changes nothing: the rule list keeps its single catch-all.
        browser_first_posture(engine)
        with transaction(engine) as conn:
            assert len(flag_rules.current_rules(conn, "cloud.hosted_media")) == 1
    finally:
        engine.dispose()


def test_a_developers_own_flags_and_the_hosted_switch_win(tmp_path, monkeypatch):
    engine = _engine(tmp_path)
    try:
        monkeypatch.setenv("SELECTA_FLAGS", "+lucy")
        monkeypatch.delenv(HOSTED_DEV_ENV, raising=False)
        browser_first_posture(engine)
        import os

        assert os.environ["SELECTA_FLAGS"] == "+lucy", "an explicit SELECTA_FLAGS is kept whole"

        monkeypatch.setenv(HOSTED_DEV_ENV, "1")
        monkeypatch.delenv("SELECTA_FLAGS", raising=False)
        (tmp_path / "hosted").mkdir(exist_ok=True)
        hosted_engine = _engine(tmp_path / "hosted")
        try:
            browser_first_posture(hosted_engine)
            assert "SELECTA_FLAGS" not in os.environ
            with transaction(hosted_engine) as conn:
                assert flag_rules.current_rules(conn, "cloud.hosted_media") == ()
        finally:
            hosted_engine.dispose()
    finally:
        engine.dispose()
