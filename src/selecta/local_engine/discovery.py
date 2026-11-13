"""Local-only engine discovery and versioned health. Never scan the LAN."""

from __future__ import annotations

import json
import os
import secrets
import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from selecta.local_engine.capabilities import negotiate_version
from selecta.local_engine.config import atomic_json, load_config


def installation_id(directory: Path) -> str:
    path = directory / "installation.json"
    if path.exists():
        try:
            data = json.loads(path.read_text("utf-8"))
            value = data["id"]
            if isinstance(value, str) and len(value) == 32 and all(
                ch in "0123456789abcdef" for ch in value
            ):
                return value
        except (OSError, KeyError, ValueError, TypeError):
            pass
        raise ValueError("Invalid installation identity; manual repair is required.")
    identifier = secrets.token_hex(16)
    atomic_json(path, {"id": identifier, "version": 1})
    return identifier


def pid_alive(pid: int) -> bool:
    if type(pid) is not int or pid <= 0:
        return False
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    except OSError:
        return False
    return True


def read_status(directory: Path, *, now: float | None = None) -> dict:
    now = time.time() if now is None else now
    try:
        state = json.loads((directory / "status.json").read_text("utf-8"))
        if not isinstance(state, dict):
            raise ValueError("not an object")
        pid = state.get("supervisor_pid")
        age = max(0, now - float(state.get("heartbeat_at", 0)))
        state["supervisor_alive"] = pid_alive(pid)
        state["heartbeat_stale"] = age > 10
        if not state["supervisor_alive"] or state["heartbeat_stale"]:
            state["state"] = "offline"
            state["api_ready"] = False
            state["audio_ready"] = False
        return state
    except (OSError, ValueError, TypeError):
        return {
            "state": "not_started", "supervisor_alive": False,
            "heartbeat_stale": True, "api_ready": False, "audio_ready": False,
        }


def discover(directory: Path, *, timeout: float = 0.8) -> dict:
    """Only trust an engine with this installation's immutable random identifier."""
    config = load_config(directory)
    status = read_status(directory)
    if not status["supervisor_alive"] or status["heartbeat_stale"]:
        return {"found": False, "reason": "supervisor_offline", "status": status}
    url = f"http://127.0.0.1:{config.port}/api/local-engine/health"
    try:
        req = Request(url, headers={"Host": f"127.0.0.1:{config.port}"})
        with urlopen(req, timeout=timeout) as response:
            if response.status != 200:
                raise ValueError("Not a healthy local engine.")
            body = response.read(4096)
        report = json.loads(body)
        if (
            report.get("service") != "selecta-local-engine"
            or report.get("installation_id") != installation_id(directory)
        ):
            raise ValueError("The port is occupied by a different service.")
        protocol = negotiate_version(report["protocol_min"], report["protocol_max"])
        return {"found": True, "protocol_version": protocol, "health": report}
    except (HTTPError, URLError, OSError, ValueError, KeyError, TypeError) as exc:
        return {"found": False, "reason": type(exc).__name__, "status": status}
