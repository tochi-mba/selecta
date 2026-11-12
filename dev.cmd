@cd /d "%~dp0" & (where uv >nul 2>nul || (echo [BOOT] uv missing: https://docs.astral.sh/uv/ & pause & exit /b 1)) & echo [BOOT] Preparing the Python environment (first install can take a while)... & (if /I "%~1"=="doctor" (uv run --no-sync python -x "%~f0" %*) else (uv run python -x "%~f0" %*)) & if errorlevel 1 (echo [BOOT] Startup failed. Review the errors above. & pause & exit /b 1) & exit /b 0
"""One-command local development: Python API, hot-reloading site and health checks.

Windows: double-click dev.cmd or run it from cmd/PowerShell.
macOS/Linux: uv run python -x dev.cmd

  dev.cmd                 Start the local API and site, open the browser
  dev.cmd --no-browser    Start without opening a browser
  dev.cmd cloud           Start Cloud locally (identity, Cloud API, worker, site)
  dev.cmd cloud --seed    Create demo account with synthetic music
  dev.cmd cloud --check   Check Cloud readiness, then stop
  dev.cmd --check         Start, verify the whole local stack, then stop
  dev.cmd doctor          Check prerequisites and show what is missing
  dev.cmd test            Run the local lint, unit, build and browser test sequence
  dev.cmd --reuse-server  Explicitly use the existing API at --api-port

Regular dev mode never contacts Cloud services. The explicit cloud command
starts only loopback development doubles for identity, storage and billing, alongside
the real Cloud API and worker. It is not a production Cloud deployment.
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
REPORT_SECONDS = 5

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
    node = shutil.which("node")
    if node is None:
        raise StartupError("Node.js is missing. Install Node 22.12+: https://nodejs.org/")
    try:
        result = subprocess.run(
            [node, "--version"], capture_output=True, text=True, check=False
        )
        major, minor, *_ = (int(part) for part in result.stdout.strip().lstrip("v").split("."))
    except (OSError, ValueError) as problem:
        raise StartupError("Could not determine Node.js version. Run node --version.") from problem
    if result.returncode or major < 22 or (major == 22 and minor < 12):
        raise StartupError(
            f"Node {result.stdout.strip()} is too old. Vite needs Node 22.12+ or newer."
        )
    return pnpm


def data_home() -> Path:
    """The local API's actual data folder, with relative overrides made unambiguous."""
    configured = os.environ.get("SELECTA_HOME")
    if not configured:
        return Path.home() / ".selecta"
    chosen = Path(configured).expanduser()
    return (ROOT / chosen).resolve() if not chosen.is_absolute() else chosen


def doctor() -> int:
    say("CHECK", f"Project: {ROOT}")
    say("CHECK", f"Python: {sys.version.split()[0]} ({sys.executable})")
    say("CHECK", f"Mode: {os.environ.get('SELECTA_MODE', 'local')}")
    say("CHECK", f"Data: {data_home()}")
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
    if shutil.which("node") and shutil.which("pnpm"):
        try:
            require_pnpm()
        except StartupError as problem:
            missing = True
            say("ERROR", str(problem))
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
    installed = WEB / "node_modules" / ".modules.yaml"
    vite_bin = WEB / "node_modules" / ".bin" / ("vite.cmd" if os.name == "nt" else "vite")
    lock = WEB / "pnpm-lock.yaml"
    manifest = WEB / "package.json"
    if (
        installed.exists()
        and vite_bin.exists()
        and installed.stat().st_mtime >= max(lock.stat().st_mtime, manifest.stat().st_mtime)
    ):
        say("CACHE", "Website dependencies unchanged; skipping pnpm install.")
        return
    say("INSTALL", "Installing website dependencies (pnpm --frozen-lockfile)...")
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
    started_at: float = field(default_factory=time.monotonic)
    last_output_at: float = field(default_factory=time.monotonic)


@dataclass(frozen=True)
class Probe:
    ok: bool
    detail: str


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
    say("PID", f"{name} started as PID {process.pid}; waiting for its first output.")

    def forward_output() -> None:
        if process.stdout is None:
            return
        for line in process.stdout:
            clean = line.rstrip("\r\n")
            if clean:
                service.last_lines.append(clean)
                service.last_output_at = time.monotonic()
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


_LOCAL_HTTP = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def probe(url: str, kind: str) -> Probe:
    """Show the actual HTTP failure, never mistake an unrelated server for Selecta."""
    request = urllib.request.Request(url, headers={"Accept": "application/json, text/html"})
    try:
        with _LOCAL_HTTP.open(request, timeout=1.5) as response:
            limit = 2 * 1024 * 1024 if kind == "status" else 8192
            data = response.read(limit + 1)
            if len(data) > limit:
                return Probe(False, f"{kind} response exceeds {limit} bytes")
            body = data.decode("utf-8", "replace")
            status = response.status
    except urllib.error.HTTPError as error:
        details = error.read(160).decode("utf-8", "replace").replace("\n", " ")
        return Probe(False, f"HTTP {error.code} at {url}; {details[:160]}")
    except (OSError, urllib.error.URLError, ValueError) as error:
        return Probe(False, f"{type(error).__name__}: {error}")
    if status != 200:
        return Probe(False, f"HTTP {status} at {url}")
    if kind == "health":
        try:
            payload = json.loads(body)
        except ValueError:
            return Probe(False, "HTTP 200 but not Selecta health JSON")
        if payload != {"service": "selecta-local", "status": "ok"}:
            return Probe(False, f"HTTP 200 but wrong health response: {body[:120]!r}")
        return Probe(True, "Selecta local health returned HTTP 200")
    if kind == "ready":
        try:
            payload = json.loads(body)
        except ValueError:
            return Probe(False, "HTTP 200 but local database readiness is not JSON")
        if payload != {"service": "selecta-local", "status": "ready"}:
            return Probe(False, f"Wrong local database readiness: {body[:120]!r}")
        return Probe(True, "local database schema responds")
    if kind == "status":
        return (
            Probe(True, "local library status returned HTTP 200")
            if status_ok(body)
            else Probe(False, f"HTTP 200 but invalid /api/status: {body[:120]!r}")
        )
    if kind == "site":
        return (
            Probe(True, "Vite HTML returned HTTP 200")
            if "<html" in body.lower()
            else Probe(False, "HTTP 200 but page is not HTML")
        )
    raise ValueError(f"Unsupported health-check type: {kind}")


def format_service_state(service: Service, now: float) -> str:
    """Human-actionable process status, even if the child wrote no output yet."""
    process = service.process
    uptime = now - service.started_at
    silence = now - service.last_output_at
    result = process.poll()
    state = "running" if result is None else f"exited {result}"
    last = service.last_lines[-1][:180] if service.last_lines else "no output yet"
    return (
        f"{service.name} PID {process.pid}: {state}, {uptime:.0f}s old, "
        f"{silence:.0f}s since output; last: {last}"
    )


def wait_until_ready(
    api_port: int,
    site_port: int,
    services: list[Service],
    *,
    timeout: float = STARTING_SECONDS,
) -> None:
    """Verify API HTTP health, site, proxy and lightweight SQLite readiness."""
    api_health = f"http://127.0.0.1:{api_port}/api/health"
    api_ready = f"http://127.0.0.1:{api_port}/api/ready"
    site_url = f"http://127.0.0.1:{site_port}/"
    proxy_health = f"{site_url}api/health"
    start_time = time.monotonic()
    deadline = start_time + timeout
    last_report = start_time - REPORT_SECONDS
    ready_result = Probe(False, "waiting for API HTTP health")
    announced: set[str] = set()
    last_results: dict[str, Probe] = {}
    while time.monotonic() < deadline:
        check_exits(services)
        health = probe(api_health, "health")
        site = probe(site_url, "site")
        proxy = (
            probe(proxy_health, "health")
            if health.ok and site.ok
            else Probe(False, "waiting for API and website")
        )
        now = time.monotonic()
        if health.ok:
            ready_result = probe(api_ready, "ready")
        results = {"API": health, "SITE": site, "PROXY": proxy, "DATA": ready_result}
        last_results = results
        for name, result in results.items():
            if result.ok and name not in announced:
                announced.add(name)
                say("OK", f"{name}: {result.detail}")
        if all(result.ok for result in results.values()):
            return
        if now - last_report >= REPORT_SECONDS:
            say("WAIT", f"{now - start_time:.0f}/{timeout:.0f}s elapsed; current readiness:")
            for name, result in results.items():
                if not result.ok:
                    say("WAIT", f"  {name}: {result.detail}")
            for service in services:
                say("PROC", f"  {format_service_state(service, now)}")
            if int(now - start_time) % 30 < REPORT_SECONDS:
                if not health.ok:
                    say(
                        "HINT",
                        "Check [API] [BOOT] for imports or legacy migration; "
                        "the process may still be initializing.",
                    )
                elif not ready_result.ok:
                    say(
                        "HINT",
                        "API HTTP health is OK but SQLite readiness is not. "
                        "Check the database initialization stage in [API] logs.",
                    )
            last_report = now
        time.sleep(1.5)
    missing = ", ".join(name for name, result in last_results.items() if not result.ok)
    details = "; ".join(f"{name}: {r.detail}" for name, r in last_results.items() if not r.ok)
    raise StartupError(
        f"Startup timed out after {timeout:.0f}s; not ready: {missing}. "
        f"Last checks: {details}. Run dev.cmd doctor and inspect the API logs above."
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
        if options.isolated and options.reuse_server:
            raise StartupError("--isolated and --reuse-server cannot be used together.")
        home = ROOT / ".cache" / "selecta-dev" if options.isolated else data_home()
        say("INFO", f"Data folder: {home}")
        if options.isolated:
            say("INFO", "Isolated mode: no personal library or legacy migration is touched.")
        # Pin the resolved path: the Python server runs from ROOT even if the
        # launcher was invoked from a different current working directory.
        local_env = {
            **os.environ,
            "SELECTA_MODE": "local",
            "SELECTA_HOME": str(home),
            "SELECTA_DEV_STARTUP": "1",
            "SELECTA_DEV_ISOLATED": "1" if options.isolated else "0",
        }
        phase(2, 4, "Preparing browser dependencies")
        install_site_tools(pnpm)
        phase(3, 4, "Starting hot-reloading API and website")
        api_port = options.api_port
        if options.reuse_server:
            if not probe(f"http://127.0.0.1:{api_port}/api/health", "health").ok:
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
                        sys.executable, "-u", "-m", "uvicorn",
                        "selecta.dev_server:application", "--factory",
                        "--host", "127.0.0.1", "--port", str(api_port),
                        "--reload", "--reload-dir", str(ROOT / "src" / "selecta"),
                        "--log-level", "debug" if options.verbose else "info",
                        *([] if options.verbose else ["--no-access-log"]),
                    ],
                    ROOT,
                    local_env,
                )
            )
        site_port = free_port(options.site_port)
        services.append(
            start_service(
                "SITE",
                [
                    pnpm, "exec", "vite", "--host", "127.0.0.1",
                    "--port", str(site_port), "--strictPort",
                ],
                WEB,
                {**os.environ, "SELECTA_API": f"http://127.0.0.1:{api_port}"},
            )
        )
        phase(4, 4, "Waiting for API, site and API proxy")
        wait_until_ready(
            api_port, site_port, services, timeout=options.startup_timeout
        )
        site_url = f"http://127.0.0.1:{site_port}/"
        api_url = f"http://127.0.0.1:{api_port}/"
        say("READY", f"Local development is up after {time.monotonic() - started_at:.1f}s.")
        say("READY", f"Website (hot reload): {site_url}")
        say("READY", f"API (Python reload):  {api_url}")
        say("READY", f"API through Vite:     {site_url}api/ready")
        say("CHECK", "Testing the full library summary once (may need warm-up)...")
        summary = probe(f"{api_url}api/status", "status")
        if summary.ok:
            say("OK", "Library summary responds.")
        else:
            say("WARNING", f"Library summary is slow or unavailable: {summary.detail}")
            say(
                "HINT",
                "The API, website and database are ready. Inspect [STATUS] stage logs "
                "for the slow query, or use --isolated to compare an empty library.",
            )
            if options.check:
                raise StartupError(
                    "Full-library /api/status smoke test failed; see the details above."
                )
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
        say(
            "INFO", "Use --verbose for detailed Uvicorn logs or --startup-timeout for slow disks."
        )
        last_heartbeat = time.monotonic()
        while True:
            check_exits(services)
            if time.monotonic() - last_heartbeat >= HEARTBEAT_SECONDS:
                api_state = probe(f"{api_url}api/health", "health")
                proxy_state = probe(f"{site_url}api/health", "health")
                if api_state.ok and proxy_state.ok:
                    say("RUNNING", f"API and website proxy healthy; site: {site_url}")
                else:
                    say(
                        "WARNING",
                        f"Runtime health failure: API={api_state.detail}; "
                        f"proxy={proxy_state.detail}. Check the live service logs above.",
                    )
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
    parser.add_argument("what", nargs="?", choices=["run", "cloud", "test", "doctor"], default="run")
    parser.add_argument("--no-browser", action="store_true", help="do not open the website")
    parser.add_argument("--check", action="store_true", help="smoke-test the full stack and exit")
    parser.add_argument(
        "--reuse-server", action="store_true", help="use, but never terminate, an existing API"
    )
    parser.add_argument("--api-port", type=int, default=SERVER_PORT)
    parser.add_argument("--site-port", type=int, default=SITE_PORT)
    parser.add_argument("--identity-port", type=int, default=8742, help="Cloud dev identity port")
    parser.add_argument("--data-dir", help="Cloud dev data folder (default: .cache/selecta-cloud)")
    parser.add_argument("--seed", action="store_true", help="Cloud only: prepare demo music and account")
    parser.add_argument(
        "--startup-timeout", type=float, default=STARTING_SECONDS,
        help="maximum seconds to wait for all API/site/proxy/data health checks",
    )
    parser.add_argument("--verbose", action="store_true", help="show detailed Uvicorn logs")
    parser.add_argument(
        "--isolated", action="store_true",
        help="use a separate development-only library, without legacy data migration",
    )
    options = parser.parse_args()
    if options.startup_timeout <= 0:
        parser.error("--startup-timeout must be positive")
    if options.what != "cloud" and (options.seed or options.data_dir):
        parser.error("--seed and --data-dir require dev.cmd cloud")
    if options.what == "cloud":
        from selecta.devstack.launcher import run_cloud

        return run_cloud(options, sys.modules[__name__])
    if options.what == "doctor":
        return doctor()
    if options.what == "test":
        return test()
    return run(options)


if __name__ == "__main__":
    raise SystemExit(main())
