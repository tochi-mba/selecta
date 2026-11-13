from __future__ import annotations

import json
import socket
import sys
import threading
import time
from dataclasses import replace

import pytest

from selecta.local_engine.config import EngineConfig, atomic_json
from selecta.local_engine.discovery import read_status
from selecta.local_engine.supervisor import (
    EngineBusy, InstanceLock, Supervisor, port_free, request_stop,
)


def free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def test_occupied_port_refuses_start(tmp_path):
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
        sock.listen(1)
        assert not port_free(port)
        supervisor = Supervisor(tmp_path, config=replace(EngineConfig(), port=port))
        assert supervisor.run() == 2
        assert json.loads((tmp_path / "status.json").read_text())["reason"] == "port_occupied"


def test_stale_lock_can_be_replaced_safely(tmp_path):
    lock = InstanceLock(tmp_path)
    atomic_json(tmp_path / "supervisor.lock", {"pid": 99999999, "generation": "old"})
    lock.acquire()
    assert json.loads(lock.path.read_text())["generation"] == lock.generation
    other = InstanceLock(tmp_path)
    with pytest.raises(EngineBusy):
        other.acquire()
    lock.release()


def test_crash_restart_budget_and_reboot_status(tmp_path):
    config = replace(EngineConfig(), port=free_port(), restart_limit=1)
    child = [sys.executable, "-c", "import sys; sys.exit(1)"]
    supervisor = Supervisor(tmp_path, config=config, command=child, poll_seconds=0.01)
    assert supervisor.run() == 3
    status = read_status(tmp_path, now=time.time() + 60)
    assert status["state"] == "offline"
    assert json.loads((tmp_path / "status.json").read_text())[
        "reason"
    ] == "restart_budget_exhausted"


def test_generation_bound_stop_and_graceful_shutdown(tmp_path, monkeypatch):
    from selecta.local_engine import supervisor as mod

    port = free_port()
    config = replace(EngineConfig(), port=port)
    child = [sys.executable, "-c", "import time; time.sleep(30)"]
    s = Supervisor(tmp_path, config=config, command=child, poll_seconds=0.02)
    monkeypatch.setattr(mod, "_probe", lambda *_a, **_kw: True)
    result = []
    thread = threading.Thread(target=lambda: result.append(s.run()))
    thread.start()
    try:
        deadline = time.monotonic() + 5
        while not (tmp_path / "status.json").exists() and time.monotonic() < deadline:
            time.sleep(0.02)
        assert (tmp_path / "status.json").exists()
        atomic_json(tmp_path / "stop.json", {"generation": "wrong"})
        assert not s._stop_signal()
        assert request_stop(tmp_path)
    finally:
        s.stop_requested.set()
        thread.join(timeout=15)
    assert not thread.is_alive()
    assert result == [0]
    assert not (tmp_path / "supervisor.lock").exists()


def test_unprivileged_state_dir_fails(tmp_path):
    path = tmp_path / "regular-file"
    path.write_text("not a directory")
    with pytest.raises(OSError):
        Supervisor(path)
