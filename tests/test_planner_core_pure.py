"""The planner core imports nothing that touches audio, files or a database (ADR-0479)."""

from __future__ import annotations

import importlib.util
from pathlib import Path

TOOL = Path(__file__).resolve().parents[1] / "tools" / "planner_core_pure.py"


def _tool():
    spec = importlib.util.spec_from_file_location("planner_core_pure", TOOL)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_a_fresh_python_imports_every_planner_core_module_and_nothing_forbidden():
    offenders, _notes = _tool().check()
    assert offenders == [], "\n".join(offenders)


def test_the_import_rule_refuses_storage_and_audio_and_allows_the_pure_modules():
    tool = _tool()
    refused = ("sqlite3", "soundfile", "selecta.db", "selecta.render.engine", "selecta.planner")
    for name in refused:
        assert not tool._allowed(name), name
    allowed = ("json", "numpy", "selecta.flags", "selecta.render.script", "selecta.planner_core")
    for name in allowed:
        assert tool._allowed(name), name
    assert tool.forbidden("selecta.audit.checks")
    assert not tool.forbidden("selecta.planner_core.repair")
