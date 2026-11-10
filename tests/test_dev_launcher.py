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
    calls = []

    def fake_probe(url, kind):
        calls.append((url, kind))
        if url == "http://127.0.0.1:8733/api/health":
            return launcher.Probe(True, "API ready")
        if url == "http://127.0.0.1:8733/api/status":
            return launcher.Probe(True, "Library ready")
        if url == "http://127.0.0.1:5173/":
            return launcher.Probe(True, "Vite ready")
        return launcher.Probe(False, "Vite proxy failed")

    monkeypatch.setattr(launcher, "probe", fake_probe)
    with pytest.raises(launcher.StartupError, match="not ready: PROXY"):
        launcher.wait_until_ready(8733, 5173, [], timeout=1.0)
    assert ("http://127.0.0.1:5173/api/health", "health") in calls


def test_health_check_accepts_all_three_working_services(launcher, monkeypatch):
    monkeypatch.setattr(
        launcher, "probe", lambda _url, _kind: launcher.Probe(True, "Healthy")
    )
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
    monkeypatch.setattr(launcher, "wait_until_ready", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(launcher, "stop", lambda service: stopped.append(service.name))
    options = argparse.Namespace(
        api_port=8733, site_port=5173, reuse_server=False, no_browser=True,
        check=True, verbose=False, startup_timeout=1,
    )
    assert launcher.run(options) == 0
    assert [name for name, *_rest in started] == ["API", "SITE"]
    assert "selecta.dev_server:application" in started[0][1]
    assert started[0][1][started[0][1].index("--port") + 1] == "8734"
    assert started[1][3]["SELECTA_API"] == "http://127.0.0.1:8734"
    assert stopped == ["SITE", "API"]


def test_reuse_requires_a_healthy_existing_selecta_api(launcher, monkeypatch):
    monkeypatch.setattr(launcher, "require_pnpm", lambda: "pnpm")
    monkeypatch.setattr(launcher, "install_site_tools", lambda _pnpm: None)
    monkeypatch.setattr(launcher.shutil, "which", lambda _name: "ffmpeg")
    monkeypatch.setattr(
        launcher, "probe", lambda *_args: launcher.Probe(False, "Connection refused")
    )
    options = argparse.Namespace(
        api_port=8733, site_port=5173, reuse_server=True, no_browser=True,
        check=True, verbose=False, startup_timeout=1,
    )
    assert launcher.run(options) == 1


def test_data_home_defaults_to_user_folder_and_resolves_relative_override(launcher, monkeypatch):
    monkeypatch.delenv("SELECTA_HOME", raising=False)
    assert launcher.data_home() == Path.home() / ".selecta"
    monkeypatch.setenv("SELECTA_HOME", "local-dev-library")
    assert launcher.data_home() == ROOT / "local-dev-library"


def test_api_health_must_identify_selecta_not_just_return_html(launcher, monkeypatch):
    class Response:
        status = 200

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def read(self, _max_size):
            return b"<html>A different server</html>"

    monkeypatch.setattr(launcher._LOCAL_HTTP, "open", lambda *_args, **_kw: Response())
    result = launcher.probe("http://127.0.0.1:8733/api/health", "health")
    assert not result.ok
    assert "not Selecta" in result.detail


def test_api_up_but_database_status_down_does_not_report_ready(launcher, monkeypatch):
    def fake_probe(url, _kind):
        if url.endswith("/api/status"):
            return launcher.Probe(False, "HTTP 500: database is locked")
        return launcher.Probe(True, "Healthy")

    monkeypatch.setattr(launcher, "probe", fake_probe)
    with pytest.raises(launcher.StartupError, match="not ready: DATA"):
        launcher.wait_until_ready(8733, 5173, [], timeout=1)


def test_process_diagnostics_include_pid_age_and_silence(launcher):
    from collections import deque

    process = SimpleNamespace(pid=1234, poll=lambda: None)
    service = launcher.Service("API", process, deque(maxlen=20))
    message = launcher.format_service_state(service, launcher.time.monotonic())
    assert "API PID 1234" in message
    assert "no output yet" in message
    assert "running" in message


def test_local_api_health_route_is_lightweight(tmp_path):
    from fastapi.testclient import TestClient

    from selecta.api import create_app
    from selecta.config import Settings

    client = TestClient(create_app(Settings(tmp_path), tmp_path / "no-web"))
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"service": "selecta-local", "status": "ok"}
