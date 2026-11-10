"""Regression checks for the one-command dev launcher (also a Windows batch entrypoint)."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path
from types import ModuleType, SimpleNamespace

import pytest

ROOT = Path(__file__).resolve().parent.parent


@pytest.fixture
def launcher():
    """Load the Python part of dev.cmd without executing its batch command or main()."""
    path = ROOT / "dev.cmd"
    source = path.read_text(encoding="utf-8").split("\n", 1)[1]
    module = ModuleType("_selecta_dev_launcher")
    module.__file__ = str(path)
    sys.modules[module.__name__] = module
    exec(compile(source, str(path), "exec"), module.__dict__)
    yield module
    sys.modules.pop(module.__name__, None)


def test_status_requires_the_selecta_json_shape(launcher):
    assert launcher.status_ok('{"counts":{"ready":0},"api":{"version":"1"}}')
    assert not launcher.status_ok('{"counts":null}')
    assert not launcher.status_ok('{"not_selecta":true}')
    assert not launcher.status_ok("<html>Another website</html>")
    assert not launcher.status_ok(None)


def test_free_port_reports_and_skips_an_occupied_port(launcher, monkeypatch, capsys):
    seen = []

    def available(port):
        seen.append(port)
        return port == 8735

    monkeypatch.setattr(launcher, "port_is_free", available)
    assert launcher.free_port(8733) == 8735
    assert seen == [8733, 8734, 8735]
    assert "8733 is occupied; using 8735" in capsys.readouterr().out


def test_free_port_rejects_invalid_requests_and_exhaustion(launcher, monkeypatch):
    with pytest.raises(launcher.StartupError, match="Invalid port"):
        launcher.free_port(0)
    with pytest.raises(launcher.StartupError, match="Invalid port"):
        launcher.free_port(65536)
    monkeypatch.setattr(launcher, "port_is_free", lambda _port: False)
    with pytest.raises(launcher.StartupError, match="No free port"):
        launcher.free_port(8733)


def test_ready_requires_the_actual_vite_api_proxy(launcher, monkeypatch):
    html = "<html>Vite is up</html>"
    calls = []

    def fake_read(url):
        calls.append(url)
        if url == "http://127.0.0.1:8733/api/status":
            return '{"counts":{"ready":0}}'
        if url == "http://127.0.0.1:5173/":
            return html
        return None

    monkeypatch.setattr(launcher, "read", fake_read)
    with pytest.raises(launcher.StartupError, match="not ready: proxy"):
        launcher.wait_until_ready(8733, 5173, [], timeout=1.0)
    assert "http://127.0.0.1:5173/api/status" in calls


def test_health_check_accepts_all_three_working_services(launcher, monkeypatch):
    def fake_read(url):
        if url.endswith("/api/status"):
            return '{"counts":{"ready":0}}'
        return "<html>Vite</html>"

    monkeypatch.setattr(launcher, "read", fake_read)
    launcher.wait_until_ready(8733, 5173, [], timeout=1)


def test_exited_server_reports_its_exit_code_and_last_output(launcher):
    failed = SimpleNamespace(poll=lambda: 6)
    service = launcher.Service("API", failed)
    service.last_lines.append("Could not load a model")
    with pytest.raises(launcher.StartupError, match="exit code 6") as error:
        launcher.check_exits([service])
    assert "Could not load a model" in str(error.value)


def test_run_never_silently_reuses_an_existing_server(launcher, monkeypatch):
    started = []
    stopped = []
    monkeypatch.setattr(launcher, "require_pnpm", lambda: "pnpm")
    monkeypatch.setattr(launcher, "install_site_tools", lambda _pnpm: None)
    monkeypatch.setattr(launcher.shutil, "which", lambda _name: "ffmpeg")
    monkeypatch.setattr(
        launcher, "free_port", lambda port: {8733: 8734, 5173: 5173}[port]
    )

    def start(name, command, cwd, env):
        started.append((name, command, cwd, env))
        return launcher.Service(name, SimpleNamespace(poll=lambda: None))

    monkeypatch.setattr(launcher, "start_service", start)
    monkeypatch.setattr(launcher, "wait_until_ready", lambda *_args: None)
    monkeypatch.setattr(launcher, "stop", lambda service: stopped.append(service.name))
    options = argparse.Namespace(
        api_port=8733, site_port=5173, reuse_server=False, no_browser=True, check=True
    )
    assert launcher.run(options) == 0
    assert [name for name, *_rest in started] == ["API", "SITE"]
    assert started[0][1][-1] == "8734"
    assert started[1][3]["SELECTA_API"] == "http://127.0.0.1:8734"
    assert stopped == ["SITE", "API"]


def test_reuse_requires_a_healthy_existing_selecta_api(launcher, monkeypatch):
    monkeypatch.setattr(launcher, "require_pnpm", lambda: "pnpm")
    monkeypatch.setattr(launcher, "install_site_tools", lambda _pnpm: None)
    monkeypatch.setattr(launcher.shutil, "which", lambda _name: "ffmpeg")
    monkeypatch.setattr(launcher, "read", lambda _url: None)
    options = argparse.Namespace(
        api_port=8733, site_port=5173, reuse_server=True, no_browser=True, check=True
    )
    assert launcher.run(options) == 1
