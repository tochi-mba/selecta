"""Single-instance, crash-supervised local API. No cloud control or playback leases."""

from __future__ import annotations

import argparse
import json
import os
import signal
import socket
import subprocess
import sys
import threading
import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import urlopen

from selecta.local_engine.config import (
    EngineConfig,
    atomic_json,
    ensure_private,
    load_config,
    state_directory,
)
from selecta.local_engine.discovery import installation_id, pid_alive, read_status


class EngineBusy(RuntimeError):
    pass


def port_free(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        try:
            sock.bind(("127.0.0.1", port))
            return True
        except OSError:
            return False


class InstanceLock:
    def __init__(self, directory: Path) -> None:
        self.path = directory / "supervisor.lock"
        self.generation = os.urandom(16).hex()

    def acquire(self) -> None:
        ensure_private(self.path.parent)
        for _ in range(3):
            try:
                fd = os.open(str(self.path), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
                with os.fdopen(fd, "w", encoding="utf-8") as output:
                    json.dump({"pid": os.getpid(), "generation": self.generation}, output)
                    output.flush()
                    os.fsync(output.fileno())
                return
            except FileExistsError:
                try:
                    original = self.path.read_bytes()
                    holder = json.loads(original)
                    pid = holder.get("pid")
                    if pid_alive(pid):
                        raise EngineBusy(f"Engine already supervised by PID {pid}.")
                    # Re-read before deletion to avoid removing a newly acquired live lock.
                    if self.path.read_bytes() == original:
                        self.path.unlink()
                except FileNotFoundError:
                    continue
                except (ValueError, TypeError) as exc:
                    raise EngineBusy("Invalid lock; inspect it before manual recovery.") from exc
        raise EngineBusy("Could not acquire local engine lock.")

    def release(self) -> None:
        try:
            holder = json.loads(self.path.read_text("utf-8"))
            if holder.get("generation") == self.generation:
                self.path.unlink()
        except (FileNotFoundError, ValueError, OSError):
            pass


def _probe(port: int, identifier: str, timeout: float = 0.35) -> bool:
    try:
        with urlopen(
            f"http://127.0.0.1:{port}/api/local-engine/health", timeout=timeout
        ) as response:
            report = json.loads(response.read(4096))
        return (
            response.status == 200
            and report.get("service") == "selecta-local-engine"
            and report.get("installation_id") == identifier
        )
    except (OSError, URLError, HTTPError, ValueError):
        return False


class Supervisor:
    def __init__(
        self, directory: Path, *, config: EngineConfig | None = None,
        command: list[str] | None = None, poll_seconds: float = 0.5,
    ) -> None:
        self.directory = ensure_private(directory)
        self.config = config or load_config(directory)
        self.lock = InstanceLock(directory)
        self.generation = self.lock.generation
        self.identifier = installation_id(directory)
        self.command = command or [
            sys.executable, "-m", "uvicorn", "selecta.local_engine.http:application",
            "--factory", "--host", "127.0.0.1", "--port", str(self.config.port),
            "--no-access-log",
        ]
        self.poll_seconds = poll_seconds
        self.stop_requested = threading.Event()
        self.child: subprocess.Popen | None = None

    def _state(self, state: str, **kwargs) -> None:
        atomic_json(
            self.directory / "status.json",
            {
                "schema_version": 1,
                "state": state,
                "generation": self.generation,
                "supervisor_pid": os.getpid(),
                "worker_pid": self.child.pid if self.child else None,
                "heartbeat_at": time.time(),
                "api_ready": False,
                "audio_ready": False,
                **kwargs,
            },
        )

    def _stop_signal(self) -> bool:
        try:
            data = json.loads((self.directory / "stop.json").read_text("utf-8"))
            return data.get("generation") == self.generation
        except (FileNotFoundError, OSError, ValueError, TypeError):
            return False

    def _stop_child(self) -> None:
        if self.child is None or self.child.poll() is not None:
            return
        self.child.terminate()
        try:
            self.child.wait(timeout=8)
        except subprocess.TimeoutExpired:
            self.child.kill()
            self.child.wait(timeout=5)

    def run(self) -> int:
        self.lock.acquire()
        log = self.directory / "engine.log"
        previous_handlers = {}
        def on_stop(_signal, _frame):
            self.stop_requested.set()

        try:
            if threading.current_thread() is threading.main_thread():
                for key in (signal.SIGTERM, signal.SIGINT):
                    previous_handlers[key] = signal.getsignal(key)
                    signal.signal(key, on_stop)
            if not port_free(self.config.port):
                self._state("failed", reason="port_occupied")
                return 2
            restarts = 0
            started = time.monotonic()
            while not self.stop_requested.is_set() and not self._stop_signal():
                env = os.environ.copy()
                env.update({
                    "SELECTA_MODE": "local", "SELECTA_ENGINE_ROLE": "local_engine",
                    "SELECTA_WORKSPACE_KIND": self.config.workspace,
                    "SELECTA_ENGINE_STATE_DIR": str(self.directory),
                })
                with log.open("ab") as output:
                    self.child = subprocess.Popen(
                        self.command, stdin=subprocess.DEVNULL,
                        stdout=output, stderr=subprocess.STDOUT, env=env,
                    )
                launched = time.monotonic()
                self._state("starting", restarts=restarts)
                ready = False
                crashed = False
                while not self.stop_requested.is_set() and not self._stop_signal():
                    if self.child.poll() is not None:
                        crashed = True
                        break
                    if not ready and _probe(self.config.port, self.identifier):
                        ready = True
                    if not ready and time.monotonic() - launched > (
                        self.config.startup_timeout_seconds
                    ):
                        crashed = True
                        break
                    self._state(
                        "running" if ready else "starting",
                        restarts=restarts, api_ready=ready,
                        reason=None if ready else "waiting_for_api",
                    )
                    self.stop_requested.wait(self.poll_seconds)
                self._stop_child()
                if self.stop_requested.is_set() or self._stop_signal():
                    break
                restarts += 1
                self._state(
                    "crashed", restarts=restarts,
                    reason="worker_exit" if crashed else "unexpected_stop",
                )
                if restarts > self.config.restart_limit:
                    self._state("failed", restarts=restarts, reason="restart_budget_exhausted")
                    return 3
                # Cap crash loops; a healthy run resets the short-window budget.
                if time.monotonic() - started > 300:
                    restarts = 0
                    started = time.monotonic()
                self.stop_requested.wait(min(2 ** min(restarts, 4), 15))
            self._state("stopped")
            return 0
        finally:
            self._stop_child()
            (self.directory / "stop.json").unlink(missing_ok=True)
            self.lock.release()
            for key, old in previous_handlers.items():
                signal.signal(key, old)


def start_background(directory: Path) -> int:
    ensure_private(directory)
    status = read_status(directory)
    if status["supervisor_alive"]:
        raise EngineBusy("Engine supervisor is already running.")
    if not port_free(load_config(directory).port):
        raise EngineBusy("Configured local engine port is occupied.")
    output = (directory / "supervisor.log").open("ab")
    try:
        options = {"stdin": subprocess.DEVNULL, "stdout": output, "stderr": output}
        if os.name == "nt":
            options["creationflags"] = (
                subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP
            )
        else:
            options["start_new_session"] = True
        proc = subprocess.Popen(
            [sys.executable, "-m", "selecta.local_engine.supervisor",
             "--run", "--state-dir", str(directory)], **options
        )
        return proc.pid
    finally:
        output.close()


def request_stop(directory: Path) -> bool:
    status = read_status(directory)
    if not status["supervisor_alive"] or status["heartbeat_stale"]:
        return False
    generation = status.get("generation")
    if not generation:
        return False
    atomic_json(directory / "stop.json", {"generation": generation})
    return True


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Selecta local-engine supervisor")
    parser.add_argument("--run", action="store_true", required=True)
    parser.add_argument("--state-dir", type=Path, default=state_directory())
    args = parser.parse_args(argv)
    return Supervisor(args.state_dir).run()


if __name__ == "__main__":
    raise SystemExit(main())
