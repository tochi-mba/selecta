"""The one script that starts everything has to keep working as a Windows file and a Python file."""

from __future__ import annotations

import json
import socket
from pathlib import Path

import pytest

ROOT = Path(__file__).parent.parent
SCRIPT = ROOT / "dev.cmd"


@pytest.fixture
def dev():
    """The file as Python sees it, which is everything after the line for Windows."""
    _windows, python = SCRIPT.read_text("utf-8").split("\n", 1)
    found = {"__name__": "dev_script", "__file__": str(SCRIPT)}
    exec(compile("\n" + python, str(SCRIPT), "exec"), found)  # noqa: S102
    return found


def test_the_line_for_windows_finds_its_own_folder_and_hands_over_to_python():
    first = SCRIPT.read_text("utf-8").splitlines()[0]
    assert first.startswith('@cd /d "%~dp0"')
    assert 'uv run python -x "%~f0" %*' in first
    assert first.rstrip().endswith("exit /b"), "or Windows would try to run the Python as commands"


def test_git_keeps_it_as_a_windows_file():
    assert "*.cmd text eol=crlf" in (ROOT / ".gitattributes").read_text("utf-8")


def test_it_steps_around_a_port_in_use(dev):
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as busy:
        busy.bind(("127.0.0.1", 0))
        taken = busy.getsockname()[1]
        assert not dev["port_is_free"](taken)
        assert dev["free_port"](taken) > taken


def test_it_only_shares_a_port_with_selecta(dev, monkeypatch):
    is_selecta = dev["is_selecta"]
    for answer, expected in (
        (json.dumps({"counts": {}}), True),
        (json.dumps({"something": "else"}), False),
        ("<html>another app</html>", False),
        (None, False),
    ):
        dev["read"] = lambda _url, reply=answer: reply
        is_selecta.__globals__["read"] = dev["read"]
        assert is_selecta(1) is expected


def test_it_says_what_is_missing(dev, monkeypatch):
    monkeypatch.setattr(dev["shutil"], "which", lambda _name: None)
    with pytest.raises(SystemExit, match="pnpm"):
        dev["need_pnpm"]()


def test_the_site_is_only_installed_when_something_changed(dev, tmp_path, monkeypatch):
    web = tmp_path / "web"
    (web / "node_modules").mkdir(parents=True)
    (web / "pnpm-lock.yaml").write_text("lock", "utf-8")
    dev["install_site_tools"].__globals__["WEB"] = web
    calls = []
    monkeypatch.setattr(dev["subprocess"], "run", lambda *a, **_k: calls.append(a))
    dev["install_site_tools"]("pnpm")
    assert len(calls) == 1, "nothing installed yet"
    (web / "node_modules" / ".modules.yaml").write_text("done", "utf-8")
    dev["install_site_tools"]("pnpm")
    assert len(calls) == 1, "nothing has changed since"
