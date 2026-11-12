"""The feature-flag registry: it's complete, it's consistent, and settings mean what they say."""

from __future__ import annotations

from pathlib import Path

import pytest
from cloud_helpers import make_cloud_app
from fastapi.routing import APIRoute
from typer.main import get_command

from selecta import flags
from selecta.api import create_app
from selecta.cli import app as cli_app
from selecta.config import Settings

ROOT = Path(__file__).resolve().parents[1]


def test_the_registry_has_no_problems():
    assert flags.problems() == []


def test_every_core_flag_says_why_it_cant_be_turned_off():
    core = [flag for flag in flags.registry().values() if flag.core]
    assert core and all(len(flag.core) > 10 for flag in core)


def _served(app) -> set[str]:
    return {
        f"{method} {route.path}"
        for route in app.routes
        if isinstance(route, APIRoute) and route.path.startswith("/api/")
        for method in route.methods
    }


def test_every_api_route_belongs_to_exactly_one_flag(tmp_path):
    """Both apps: every route has an owning flag that exists in that app's mode, and every
    route a flag owns is served by an app in one of the flag's modes."""
    cloud_app, engine, _ = make_cloud_app(tmp_path)
    try:
        served = {
            "local": _served(create_app(Settings(tmp_path), tmp_path / "no-web")),
            "cloud": _served(cloud_app),
        }
    finally:
        engine.dispose()
    owners = flags.route_owners()
    registry = flags.registry()
    for mode, routes in served.items():
        assert sorted(routes - set(owners)) == [], f"{mode}: add these to a flag's routes"
        owned = routes & set(owners)
        wrong_mode = sorted(r for r in owned if mode not in registry[owners[r]].modes)
        assert wrong_mode == [], f"{mode} app serves routes of flags that aren't in {mode} mode"
    gone = sorted(
        route
        for route, owner in owners.items()
        if not any(route in served[mode] for mode in registry[owner].modes)
    )
    assert gone == [], "these routes don't exist any more"


def test_every_cli_command_belongs_to_a_flag():
    commands = set(get_command(cli_app).commands)
    owners = flags.cli_owners()
    assert sorted(commands - set(owners)) == [], "add these to a flag's cli"
    assert sorted(set(owners) - commands) == [], "these commands don't exist any more"


def test_the_catalog_in_docs_is_up_to_date():
    written = (ROOT / "docs" / "flags.md").read_text("utf-8")
    assert written == flags.markdown(), "run: uv run selecta flags --markdown docs/flags.md"


def test_nothing_set_means_every_flag_is_on():
    """Except a flag the registry marks off by default (`"default": false`), which stays off."""
    registry = flags.registry()
    states = flags.resolve("")
    assert all(state.on for flag_id, state in states.items() if registry[flag_id].default)
    off = [flag_id for flag_id, state in states.items() if not state.on]
    assert all(states[flag_id].why == "off by default" for flag_id in off)


def test_turning_one_off_turns_off_what_needs_it():
    states = flags.resolve("-stems")
    assert states["stems"] == flags.State(False, flags.ENV)
    assert states["stem_studio"] == flags.State(False, "needs stems")
    assert not states["move.word_blend"].on and states["move.bass_swap_blend"].on


def test_minimal_leaves_only_core_on_and_reads_left_to_right():
    states = flags.resolve("minimal +requests")
    on = {flag_id for flag_id, state in states.items() if state.on}
    core = {flag.id for flag in flags.registry().values() if flag.core}
    assert on == core | {"requests"}
    assert not states["requests.bridges"].on


def test_a_wildcard_reaches_every_flag_in_an_area_but_not_core():
    states = flags.resolve("-move.*")
    moves = [flag_id for flag_id in states if flag_id.startswith("move.")]
    assert [flag_id for flag_id in moves if states[flag_id].on] == ["move.cut"]


def test_commas_and_spaces_both_separate():
    assert flags.parse("-requests, -lucy  +lucy") == {"requests": False, "lucy": True}


def test_a_misspelt_flag_is_refused_with_a_suggestion():
    with pytest.raises(flags.FlagError, match="Did you mean requests"):
        flags.resolve("-request")


def test_a_core_flag_cant_be_turned_off():
    with pytest.raises(flags.FlagError, match="can't be turned off"):
        flags.resolve("-core.playback")


def test_a_wildcard_matching_nothing_is_refused():
    with pytest.raises(flags.FlagError, match="no flag"):
        flags.resolve("-nothing.*")


def test_the_environment_is_read_once_and_use_replaces_it(monkeypatch):
    monkeypatch.setenv(flags.ENV, "-requests")
    flags.use(None)
    assert not flags.on("requests")
    monkeypatch.setenv(flags.ENV, "")
    assert not flags.on("requests"), "read once per process"
    flags.use("")
    assert flags.on("requests")


def test_asking_for_a_flag_that_doesnt_exist_is_a_mistake():
    with pytest.raises(KeyError):
        flags.on("no.such.flag")


def test_require_names_the_feature():
    flags.use("-export")
    with pytest.raises(flags.FlagOff, match="Export is turned off"):
        flags.require("export")


def test_cycles_and_missing_needs_are_found():
    made = {
        "a": flags.Flag("a", "A", "A", "a", requires=("b",)),
        "b": flags.Flag("b", "A", "B", "b", requires=("a",)),
        "c": flags.Flag("c", "A", "C", "c", requires=("gone",), surfaces=("nowhere",)),
    }
    found = "\n".join(flags.problems(made))
    assert "circle" in found and "gone" in found and "nowhere" in found


def test_a_turned_off_command_says_so_and_stops(monkeypatch):
    from typer.testing import CliRunner

    flags.use("-listening_study")
    result = CliRunner().invoke(cli_app, ["listening-report", "anything"])
    assert result.exit_code == 2
    assert "turned off in this build" in result.output and "listening_study" in result.output


def test_the_flags_command_lists_every_flag():
    from typer.testing import CliRunner

    flags.use("-requests")
    result = CliRunner().invoke(cli_app, ["flags"])
    assert result.exit_code == 0
    assert "requests.bridges" in result.output and "needs requests" in result.output
