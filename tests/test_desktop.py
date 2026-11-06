from pathlib import Path

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
