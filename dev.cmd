@cd /d "%~dp0" & (where uv >nul 2>nul || (echo Install uv from https://docs.astral.sh/uv/ & exit /b 1)) & uv run python -x "%~f0" %* & exit /b
"""One-command local development: Python API, hot-reloading site and health checks.

Windows: double-click dev.cmd or run it from cmd/PowerShell.
macOS/Linux: uv run python -x dev.cmd

  dev.cmd                 Start the local API and site, open the browser
  dev.cmd --no-browser    Start without opening a browser
  dev.cmd --check         Start, verify the whole local stack, then stop
  dev.cmd doctor          Check prerequisites and show what is missing
  dev.cmd test            Run the local lint, unit, build and browser test sequence
  dev.cmd --reuse-server  Explicitly use the existing API at --api-port

Dev mode is intentionally local only. Cloud deployment needs a separately configured
PostgreSQL, identity service and worker gateway; this script must never silently
launch those services or point the local UI at production.
"""

from __future__ import annotations

import argparse
import contextlib
import json
import os
import shutil
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
import webbrowser
from collections import deque
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parent
WEB = ROOT / "web"
SERVER_PORT = 8733
SITE_PORT = 5173
PORTS_TO_TRY = 20
STARTING_SECONDS = 180
HEARTBEAT_SECONDS = 60

_PRINT_LOCK = threading.Lock()


class StartupError(RuntimeError):
    """A startup failure with a useful explanation for a developer."""


def say(kind: str, message: str) -> None:
    """Keep service output and startup milestones legible in one console."""
    with _PRINT_LOCK:
        print(f"{time.strftime('%H:%M:%S')} [{kind:<7}] {message}", flush=True)


def phase(number: int, total: int, message: str) -> None:
    say("SETUP", f"Step {number}/{total} - {message}")


def require_pnpm() -> str:
    pnpm = shutil.which("pnpm")
    if pnpm is None:
        raise StartupError("pnpm is missing. Install it: https://pnpm.io/installation")
    if shutil.which("node") is None:
        raise StartupError("Node.js is missing. Install Node 22+: https://nodejs.org/")
    return pnpm


def doctor() -> int:
    say("CHECK", f"Project: {ROOT}")
    say("CHECK", f"Python: {sys.version.split()[0]} ({sys.executable})")
    say("CHECK", f"Mode: {os.environ.get('SELECTA_MODE', 'local')}")
    say("CHECK", f"Data: {os.environ.get('SELECTA_HOME') or 'default Selecta user folder'}")
    missing = False
    for name, url in (
        ("uv", "https://docs.astral.sh/uv/"),
        ("node", "https://nodejs.org/"),
        ("pnpm", "https://pnpm.io/installation"),
        ("ffmpeg", "https://ffmpeg.org/download.html"),
    ):
        found = shutil.which(name)
        if found:
            say("OK", f"{name}: {found}")
        else:
            missing = True
            say("MISSING", f"{name}: {url}")
    if os.environ.get("SELECTA_MODE", "local").strip().lower() not in ("", "local"):
        missing = True
        say("ERROR", "This launcher is local only; unset SELECTA_MODE or set it to local.")
    say("CHECK", f"Site package: {WEB / 'package.json'}")
    say("CHECK", "The launcher starts the local API and Vite and verifies their proxy.")
    if missing:
        say("ERROR", "Install the missing tools above, then rerun dev.cmd.")
        return 1
    say("READY", "Prerequisite check passed.")
    return 0


def install_site_tools(pnpm: str) -> None:
    """pnpm install is incremental and verifies package.json against the lockfile."""
    command = [pnpm, "install", "--frozen-lockfile", "--prefer-offline"]
    say("INSTALL", "Checking website dependencies (pnpm install --frozen-lockfile)...")
    result = subprocess.run(command, cwd=WEB, check=False)
    if result.returncode:
        raise StartupError(
            f"pnpm install exited {result.returncode}. Check the output above and "
            "web/pnpm-lock.yaml; the API has not started."
        )
    say("OK", "Website dependencies are ready.")


def port_is_free(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        try:
            probe.bind(("127.0.0.1", port))
        except OSError:
            return False
    return True


def free_port(start: int) -> int:
    if not 1 <= start <= 65535:
        raise StartupError(f"Invalid port {start}; choose a port between 1 and 65535.")
    for port in range(start, min(65536, start + PORTS_TO_TRY)):
        if port_is_free(port):
            if port != start:
                say("PORT", f"{start} is occupied; using {port} instead.")
            return port
    raise StartupError(
        f"No free port in {start}-{min(65535, start + PORTS_TO_TRY - 1)}. "
        "Stop the other services or pass --api-port/--site-port."
    )


def read(url: str) -> str | None:
    try:
        with urllib.request.urlopen(url, timeout=2) as response:  # noqa: S310
            if response.status != 200:
                return None
            return response.read().decode("utf-8", "replace")
    except (OSError, urllib.error.URLError, ValueError):
        return None


def status_ok(answer: str | None) -> bool:
    if not answer:
        return False
    try:
        payload = json.loads(answer)
        return isinstance(payload, dict) and isinstance(payload.get("counts"), dict)
    except (TypeError, ValueError):
        return False


@dataclass
class Service:
    name: str
    process: subprocess.Popen[str]
    last_lines: deque[str] = field(default_factory=lambda: deque(maxlen=20))


def start_service(name: str, command: list[str], cwd: Path, env: dict[str, str]) -> Service:
    say("START", f"{name}: {' '.join(command)}")
    try:
        process = subprocess.Popen(
            command,
            cwd=cwd,
            env={**env, "PYTHONUNBUFFERED": "1"},
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",
            bufsize=1,
        )
    except OSError as problem:
        raise StartupError(f"{name} could not start: {problem}") from problem
    service = Service(name, process)

    def forward_output() -> None:
        if process.stdout is None:
            return
        for line in process.stdout:
            clean = line.rstrip("\r\n")
            if clean:
                service.last_lines.append(clean)
                say(name, clean)

    threading.Thread(target=forward_output, name=f"selecta-{name}", daemon=True).start()
    return service


def check_exits(services: list[Service]) -> None:
    for service in services:
        exit_code = service.process.poll()
        if exit_code is not None:
            last = " | ".join(list(service.last_lines)[-3:])
            detail = f" Recent output: {last}" if last else ""
            raise StartupError(
                f"{service.name} stopped with exit code {exit_code}.{detail} "
                "Review the prefixed logs above."
            )


def wait_until_ready(
    api_port: int, site_port: int, services: list[Service], *, timeout: float = STARTING_SECONDS
) -> None:
    """Require the API, Vite and Vite-to-API proxy, not merely an occupied TCP port."""
    api_url = f"http://127.0.0.1:{api_port}/api/status"
    site_url = f"http://127.0.0.1:{site_port}/"
    proxy_url = f"{site_url}api/status"
    deadline = time.monotonic() + timeout
    last_report = 0.0
    ready: set[str] = set()
    while time.monotonic() < deadline:
        check_exits(services)
        checks = {
            "API": status_ok(read(api_url)),
            "SITE": read(site_url) is not None,
        }
        checks["PROXY"] = checks["SITE"] and checks["API"] and status_ok(read(proxy_url))
        for name, ok in checks.items():
            if ok and name not in ready:
                ready.add(name)
                say("OK", f"{name}: responding")
        if all(checks.values()):
            return
        now = time.monotonic()
        if now - last_report >= 5:
            waiting = ", ".join(name.lower() for name, ok in checks.items() if not ok)
            elapsed = int(max(0, timeout - (deadline - now)))
            say("WAIT", f"{elapsed}s elapsed; waiting for {waiting}. Logs appear above as they arrive.")
            last_report = now
        time.sleep(0.5)
    missing = ", ".join(name.lower() for name in ("API", "SITE", "PROXY") if name not in ready)
    raise StartupError(
        f"Startup timed out after {timeout:.0f}s (not ready: {missing}). "
        "Check the API/SITE logs, firewall and selected ports."
    )


def stop(service: Service) -> None:
    """Stop the launcher-owned process tree, never an externally reused API."""
    import psutil

    try:
        parent = psutil.Process(service.process.pid)
        members = [*parent.children(recursive=True), parent]
        for member in members:
            with contextlib.suppress(psutil.NoSuchProcess, psutil.AccessDenied):
                member.terminate()
        _, survivors = psutil.wait_procs(members, timeout=4)
        for member in survivors:
            with contextlib.suppress(psutil.NoSuchProcess, psutil.AccessDenied):
                member.kill()
    except (psutil.NoSuchProcess, psutil.AccessDenied):
        pass
    if service.process.poll() is None:
        with contextlib.suppress(OSError):
            service.process.terminate()
    with contextlib.suppress(subprocess.TimeoutExpired):
        service.process.wait(timeout=3)


def run(options: argparse.Namespace) -> int:
    services: list[Service] = []
    started_at = time.monotonic()
    try:
        phase(1, 4, "Checking the local environment")
        if os.environ.get("SELECTA_MODE", "local").strip().lower() not in ("", "local"):
            raise StartupError(
                "dev.cmd starts local mode only. Unset SELECTA_MODE or set SELECTA_MODE=local. "
                "Use the separate Cloud setup for the hosted edition."
            )
        pnpm = require_pnpm()
        if shutil.which("ffmpeg") is None:
            say(
                "WARNING",
                "ffmpeg is missing: the site can start, but music analysis/playback will not work. "
                "Install it from https://ffmpeg.org/download.html",
            )
        say("INFO", f"Data folder: {os.environ.get('SELECTA_HOME') or 'your normal user data'}")
        phase(2, 4, "Preparing browser dependencies")
        install_site_tools(pnpm)
        phase(3, 4, "Starting hot-reloading API and website")
        api_port = options.api_port
        if options.reuse_server:
            if not status_ok(read(f"http://127.0.0.1:{api_port}/api/status")):
                raise StartupError(
                    f"--reuse-server needs an existing local Selecta API at port {api_port}. "
                    "Start one first or omit --reuse-server."
                )
            say("REUSE", f"Using the API already on port {api_port}; it will not be stopped.")
        else:
            api_port = free_port(options.api_port)
            services.append(
                start_service(
                    "API",
                    [
                        sys.executable, "-m", "selecta.cli", "web", "--no-open",
                        "--reload", "--port", str(api_port),
                    ],
                    ROOT,
                    {**os.environ, "SELECTA_MODE": "local"},
                )
            )
        site_port = free_port(options.site_port)
        services.append(
            start_service(
                "SITE",
                [pnpm, "exec", "vite", "--host", "127.0.0.1", "--port", str(site_port), "--strictPort"],
                WEB,
                {**os.environ, "SELECTA_API": f"http://127.0.0.1:{api_port}"},
            )
        )
        phase(4, 4, "Waiting for API, site and API proxy")
        wait_until_ready(api_port, site_port, services)
        site_url = f"http://127.0.0.1:{site_port}/"
        api_url = f"http://127.0.0.1:{api_port}/"
        say("READY", f"Local development is up after {time.monotonic() - started_at:.1f}s.")
        say("READY", f"Website (hot reload): {site_url}")
        say("READY", f"API (Python reload):  {api_url}")
        say("READY", f"API through Vite:     {site_url}api/status")
        if options.check:
            say("PASS", "Smoke test passed. Stopping the services started by this script.")
            return 0
        if not options.no_browser:
            try:
                if not webbrowser.open(site_url):
                    say("INFO", "Browser did not open automatically. Copy the website URL above.")
            except (OSError, webbrowser.Error):
                say("INFO", "Browser could not be opened. Copy the website URL above.")
        say("INFO", "Edit web/src for instant updates or src/selecta for API reloads.")
        say("INFO", "Press Ctrl+C or close this console to stop the services started here.")
        last_heartbeat = time.monotonic()
        while True:
            check_exits(services)
            if time.monotonic() - last_heartbeat >= HEARTBEAT_SECONDS:
                say("RUNNING", f"API and site processes alive; site: {site_url}")
                last_heartbeat = time.monotonic()
            time.sleep(1)
    except KeyboardInterrupt:
        say("STOP", "Ctrl+C received.")
        return 0
    except (OSError, StartupError) as problem:
        say("ERROR", str(problem))
        return 1
    finally:
        for service in reversed(services):
            say("STOP", f"Stopping {service.name}...")
            stop(service)
        if services:
            say("STOP", "Launcher-owned processes stopped.")


def test() -> int:
    """A useful local sequence; full CI also needs PostgreSQL and other runner jobs."""
    try:
        pnpm = require_pnpm()
        install_site_tools(pnpm)
    except (StartupError, OSError) as problem:
        say("ERROR", str(problem))
        return 1
    tasks = (
        ("Ruff / Python style", [sys.executable, "-m", "ruff", "check", "."], ROOT),
        ("Python tests", [sys.executable, "-m", "pytest", "-q"], ROOT),
        ("TypeScript", [pnpm, "exec", "tsc", "--noEmit"], WEB),
        ("Web unit tests", [pnpm, "test"], WEB),
        ("Production web build", [pnpm, "build"], WEB),
        ("Edge browser tests", [pnpm, "e2e"], WEB),
    )
    for index, (name, command, cwd) in enumerate(tasks, 1):
        phase(index, len(tasks), name)
        start = time.monotonic()
        try:
            result = subprocess.run(command, cwd=cwd, check=False)
        except OSError as problem:
            say("ERROR", f"{name}: {problem}")
            return 1
        if result.returncode:
            say("FAIL", f"{name} exited {result.returncode}. Stop; see output above.")
            return result.returncode
        say("PASS", f"{name} passed in {time.monotonic() - start:.1f}s.")
    say("PASS", "Local checks passed; full CI also runs PostgreSQL and feature-flag/cloud E2E.")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(
        prog="dev.cmd",
        description="Start the complete Selecta local stack, with live logs and health checks.",
    )
    parser.add_argument("what", nargs="?", choices=["run", "test", "doctor"], default="run")
    parser.add_argument("--no-browser", action="store_true", help="do not open the website")
    parser.add_argument("--check", action="store_true", help="smoke-test the full stack and exit")
    parser.add_argument(
        "--reuse-server", action="store_true", help="use, but never terminate, an existing API"
    )
    parser.add_argument("--api-port", type=int, default=SERVER_PORT)
    parser.add_argument("--site-port", type=int, default=SITE_PORT)
    options = parser.parse_args()
    if options.what == "doctor":
        return doctor()
    if options.what == "test":
        return test()
    return run(options)


if __name__ == "__main__":
    raise SystemExit(main())
