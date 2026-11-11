"""The one script that starts everything has to keep working as a Windows file and a Python file."""

from __future__ import annotations

import json
import os
import re
import socket
import sys
import types
from pathlib import Path

import pytest

ROOT = Path(__file__).parent.parent
SCRIPT = ROOT / "dev.cmd"


@pytest.fixture
def dev():
    """The file as Python sees it, which is everything after the line for Windows."""
    _windows, python = SCRIPT.read_text("utf-8").split("\n", 1)
    module = types.ModuleType("dev_script")
    module.__file__ = str(SCRIPT)
    # dataclasses look their module up in sys.modules, so it has to be there while it runs
    sys.modules["dev_script"] = module
    try:
        exec(compile("\n" + python, str(SCRIPT), "exec"), module.__dict__)  # noqa: S102
        yield module.__dict__
    finally:
        sys.modules.pop("dev_script", None)


def test_the_line_for_windows_finds_its_own_folder_and_hands_over_to_python():
    first = SCRIPT.read_text("utf-8").splitlines()[0]
    assert first.startswith('@cd /d "%~dp0"')
    assert 'uv run python -x "%~f0" %*' in first
    assert re.search(r"exit /b(?: 0)?$", first.rstrip()), (
        "or Windows would try to run the Python as commands"
    )


def test_git_keeps_it_as_a_windows_file():
    assert "*.cmd text eol=crlf" in (ROOT / ".gitattributes").read_text("utf-8")


def test_it_steps_around_a_port_in_use(dev):
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as busy:
        busy.bind(("127.0.0.1", 0))
        taken = busy.getsockname()[1]
        assert not dev["port_is_free"](taken)
        assert dev["free_port"](taken) > taken


def test_it_only_shares_a_port_with_selecta(dev):
    status_ok = dev["status_ok"]
    for answer, expected in (
        (json.dumps({"counts": {}}), True),
        (json.dumps({"something": "else"}), False),
        ("<html>another app</html>", False),
        (None, False),
    ):
        assert status_ok(answer) is expected


def test_it_says_what_is_missing(dev, monkeypatch):
    monkeypatch.setattr(dev["shutil"], "which", lambda _name: None)
    with pytest.raises(dev["StartupError"], match="pnpm"):
        dev["require_pnpm"]()


def test_the_site_is_only_installed_when_something_changed(dev, tmp_path, monkeypatch):
    web = tmp_path / "web"
    bin_dir = web / "node_modules" / ".bin"
    bin_dir.mkdir(parents=True)
    (bin_dir / ("vite.cmd" if os.name == "nt" else "vite")).write_text("", "utf-8")
    (web / "pnpm-lock.yaml").write_text("lock", "utf-8")
    (web / "package.json").write_text("{}", "utf-8")
    monkeypatch.setitem(dev["install_site_tools"].__globals__, "WEB", web)
    calls = []

    def run(*args, **_kwargs):
        calls.append(args)
        return types.SimpleNamespace(returncode=0)

    monkeypatch.setattr(dev["subprocess"], "run", run)
    dev["install_site_tools"]("pnpm")
    assert len(calls) == 1, "nothing installed yet"
    (web / "node_modules" / ".modules.yaml").write_text("done", "utf-8")
    dev["install_site_tools"]("pnpm")
    assert len(calls) == 1, "nothing has changed since"
