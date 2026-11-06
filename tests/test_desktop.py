from pathlib import Path
from types import SimpleNamespace

import pytest

from selecta import desktop


def test_desktop_launch_reuses_running_server(monkeypatch):
    calls = []
    monkeypatch.setattr(desktop, "server_ready", lambda: True)
    monkeypatch.setattr(desktop, "edge_path", lambda: Path("edge.exe"))
    monkeypatch.setattr(desktop.subprocess, "Popen", lambda command: calls.append(command))
    desktop.launch()
    assert calls == [["edge.exe", "--app=http://127.0.0.1:8733/"]]


def test_desktop_launch_falls_back_to_default_browser(monkeypatch):
    calls = []
    monkeypatch.setattr(desktop, "server_ready", lambda: True)
    monkeypatch.setattr(desktop, "edge_path", lambda: None)
    monkeypatch.setattr(desktop.webbrowser, "open", calls.append)
    desktop.launch()
    assert calls == [desktop.URL]


def test_desktop_cold_start_waits_for_server_before_opening_window(monkeypatch, tmp_path):
    calls = []
    ready = iter([False, False, True])
    monkeypatch.setattr(desktop, "server_ready", lambda: next(ready))
    monkeypatch.setattr("selecta.config.load_settings", lambda: SimpleNamespace(home=tmp_path))
    monkeypatch.setattr(desktop, "edge_path", lambda: Path("edge.exe"))
    monkeypatch.setattr(desktop.time, "sleep", lambda _: None)

    def start(command, **kwargs):
        calls.append(command)
        return SimpleNamespace(poll=lambda: None)

    monkeypatch.setattr(desktop.subprocess, "Popen", start)
    desktop.launch()
    assert calls[0][1:4] == ["-m", "selecta.cli", "web"]
    assert calls[1] == ["edge.exe", f"--app={desktop.URL}"]
    assert (tmp_path / "desktop-server.log").exists()


def test_desktop_reports_terminal_startup_failure(monkeypatch, tmp_path):
    monkeypatch.setattr(desktop, "server_ready", lambda: False)
    monkeypatch.setattr("selecta.config.load_settings", lambda: SimpleNamespace(home=tmp_path))
    monkeypatch.setattr(
        desktop.subprocess, "Popen", lambda *args, **kwargs: SimpleNamespace(poll=lambda: 1)
    )
    with pytest.raises(RuntimeError, match="stopped during startup"):
        desktop.launch()
