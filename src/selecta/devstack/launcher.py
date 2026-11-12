"""Start a complete, loopback-only Selecta Cloud development stack.

The public Cloud API and worker handlers are real. Only external dependencies are
replaced: hosted identity, R2 and Stripe use local development adapters.
Invoked through \`dev.cmd cloud\`; intentionally not a production entrypoint.
"""

from __future__ import annotations

import contextlib
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

from selecta.devstack import guard
from selecta.devstack.settings import CLIENT_ID, DevSettings


def _port(requested: int, taken: set[int], ops) -> int:
    if not 1 <= requested <= 65535:
        raise ops.StartupError(f"Invalid port {requested}; choose 1-65535.")
    for number in range(requested, min(65536, requested + 20)):
        if number not in taken and ops.port_is_free(number):
            taken.add(number)
            if number != requested:
                ops.say("PORT", f"{requested} is unavailable; using {number} instead.")
            return number
    raise ops.StartupError(f"No available port near {requested}; try another --*-port.")


def _check(url: str, kind: str, ops):
    """A returned HTTP 200 must identify the service expected at that address."""
    request = urllib.request.Request(url, headers={"Accept": "application/json, text/html"})
    try:
        with ops._LOCAL_HTTP.open(request, timeout=2) as response:
            if response.status != 200:
                return ops.Probe(False, f"HTTP {response.status}")
            body = response.read(8192).decode("utf-8", "replace")
    except (OSError, urllib.error.URLError, ValueError) as problem:
        return ops.Probe(False, f"{type(problem).__name__}: {problem}")
    if kind == "site":
        is_site = "<html" in body.lower()
        return ops.Probe(is_site, "Cloud Vite page" if is_site else "Not a Vite HTML page")
    try:
        import json

        data = json.loads(body)
    except ValueError:
        return ops.Probe(False, "Not JSON from the expected service")
    if kind == "identity":
        ok = data == {"service": "selecta-local-identity", "status": "ok"}
    elif kind == "api":
        ok = data.get("mode") == "cloud" and data.get("service") == "selecta"
    elif kind == "ready":
        ok = data.get("status") == "ready" and bool(data.get("schema"))
    elif kind == "stack":
        ok = data.get("service") == "selecta-cloud-dev"
    else:
        raise ValueError(f"Unknown Cloud probe: {kind}")
    detail = f"{kind} responded" if ok else f"Unexpected {kind} response: {str(data)[:160]}"
    return ops.Probe(ok, detail)


def wait_cloud_ready(
    api_port: int,
    identity_port: int,
    site_port: int,
    services: list,
    ops,
    *,
    timeout: float,
    site_required: bool = True,
    worker_required: bool = True,
) -> None:
    start = time.monotonic()
    last_report = start - 5
    root = f"http://127.0.0.1:{site_port}"
    api = f"http://127.0.0.1:{api_port}"
    identity = f"http://127.0.0.1:{identity_port}"
    while time.monotonic() - start < timeout:
        ops.check_exits(services)
        results = {
            "IDENTITY": _check(f"{identity}/dev/identity/health", "identity", ops),
            "API": _check(f"{api}/api/status", "api", ops),
            "DATA": _check(f"{api}/api/ready", "ready", ops),
        }
        if site_required:
            results.update({
                "SITE": _check(f"{root}/", "site", ops),
                "PROXY": _check(f"{root}/api/status", "api", ops),
                "AUTH PROXY": _check(f"{root}/dev/identity/health", "identity", ops),
                "STACK": _check(f"{root}/dev/stack", "stack", ops),
            })
        if worker_required:
            worker = next((s for s in services if s.name == "WORKER"), None)
            working = bool(
                worker and any("Ready: claiming Cloud jobs" in line for line in worker.last_lines)
            )
            results["WORKER"] = ops.Probe(
                working, "Worker started" if working else "Waiting for worker readiness log"
            )
        if all(item.ok for item in results.values()):
            for name in results:
                ops.say("OK", f"{name}: {results[name].detail}")
            return
        now = time.monotonic()
        if now - last_report >= 5:
            pending = "; ".join(
                f"{name}: {item.detail}" for name, item in results.items() if not item.ok
            )
            ops.say("WAIT", f"{now - start:.0f}/{timeout:.0f}s: {pending}")
            for service in services:
                ops.say("PROC", ops.format_service_state(service, now))
            last_report = now
        time.sleep(1)
    missing = ", ".join(name for name, item in results.items() if not item.ok)
    raise ops.StartupError(
        f"Cloud startup timed out, not ready: {missing}. Inspect the prefixed logs above."
    )


DOCKER_COMPOSE = Path("infra") / "dev" / "compose.yaml"
DOCKER_DATABASE_URL = "postgresql+psycopg://selecta:selecta-local-dev@127.0.0.1:55432/selecta_dev"


def database_url(options, data: Path, ops) -> str:
    """SQLite in the data folder by default; the developer's PostgreSQL URL when set; or the
    throwaway PostgreSQL container of `infra/dev/compose.yaml` with `--docker`."""
    given = os.environ.get("SELECTA_DEV_DATABASE_URL", "").strip()
    if getattr(options, "docker", False):
        if given:
            raise ops.StartupError("Use either --docker or SELECTA_DEV_DATABASE_URL, not both.")
        docker = ops.shutil.which("docker")
        if docker is None:
            raise ops.StartupError(
                "--docker needs Docker Desktop (or Docker Engine) running. Omit --docker to use "
                "SQLite, which needs nothing extra."
            )
        ops.say("DOCKER", "Starting PostgreSQL 16 from infra/dev/compose.yaml...")
        started = subprocess.run(
            [docker, "compose", "-f", str(ops.ROOT / DOCKER_COMPOSE), "up", "-d", "--wait"],
            cwd=ops.ROOT, check=False,
        )
        if started.returncode:
            raise ops.StartupError(
                "docker compose could not start PostgreSQL. Is Docker running? Try "
                "`docker compose -f infra/dev/compose.yaml up -d` to see why, or omit --docker."
            )
        return DOCKER_DATABASE_URL
    if given:
        if not given.startswith(("postgresql://", "postgresql+psycopg://", "sqlite:///")):
            raise ops.StartupError(
                "SELECTA_DEV_DATABASE_URL must be a postgresql+psycopg:// or sqlite:/// URL."
            )
        if given.startswith("postgresql://"):
            given = "postgresql+psycopg://" + given.removeprefix("postgresql://")
        return given
    return f"sqlite:///{(data / 'cloud.sqlite').as_posix()}"


def describe_database(url: str) -> str:
    """The database without its password, for the console."""
    if url.startswith("sqlite"):
        return f"SQLite ({url.removeprefix('sqlite:///')})"
    return f"PostgreSQL ({url.split('@', 1)[-1]})"


def _seed(settings: DevSettings, env: dict[str, str], ops) -> None:
    code = (
        "from selecta.devstack.seed import seed; "
        "from selecta.devstack.settings import DevSettings; "
        "result = seed(DevSettings.from_environment()); "
        "print('[SEED] Ready:', result['email'], "
        "'songs added:', result['songs_added'], flush=True)"
    )
    ops.say("SEED", "Preparing demo identity, Premium workspace and synthetic music...")
    try:
        result = subprocess.run(
            [sys.executable, "-u", "-c", code],
            cwd=ops.ROOT,
            env=env,
            timeout=180,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as problem:
        raise ops.StartupError(f"Demo seed failed: {problem}") from problem
    if result.returncode:
        raise ops.StartupError(f"Demo seed exited {result.returncode}. See the error above.")


def run_cloud(options, ops) -> int:
    """Run only services this launcher owns; preserve the local app's data and processes."""
    services = []
    began = time.monotonic()
    try:
        if options.reuse_server:
            raise ops.StartupError("--reuse-server is local-only and cannot be used with cloud.")
        if options.isolated and options.data_dir:
            raise ops.StartupError("Use either --isolated or --data-dir, not both.")
        ops.phase(1, 4, "Checking Cloud development prerequisites and safe configuration")
        pnpm = ops.require_pnpm()
        if not ops.shutil.which("ffmpeg"):
            raise ops.StartupError(
                "The Cloud worker needs ffmpeg: install ffmpeg and put it on PATH "
                "(see the developer README)."
            )
        data = (
            Path(options.data_dir).expanduser().resolve()
            if options.data_dir
            else ops.ROOT
            / ".cache"
            / ("selecta-cloud-isolated" if options.isolated else "selecta-cloud")
        )
        data.mkdir(parents=True, exist_ok=True)
        taken: set[int] = set()
        api_port = _port(options.api_port, taken, ops)
        identity_port = _port(options.identity_port, taken, ops)
        site_port = _port(options.site_port, taken, ops)
        settings = DevSettings(
            data=data,
            database_url=database_url(options, data, ops),
            site_url=f"http://127.0.0.1:{site_port}",
            api_url=f"http://127.0.0.1:{api_port}",
            identity_url=f"http://127.0.0.1:{identity_port}",
        )
        env = {
            **os.environ,
            **settings.environment(),
            "SELECTA_MODE": "cloud",
            "SELECTA_DEV_STARTUP": "1",
        }
        problems = guard.problems(env)
        if problems:
            raise ops.StartupError("Unsafe Cloud development environment: " + " ".join(problems))
        settings.secret("workos-webhook")
        settings.secret("rooms-pepper")
        ops.say("INFO", f"Cloud development data: {data}")
        ops.say("INFO", f"Database: {describe_database(settings.database_url)}")
        ops.say("INFO", "Identity, disk objects and billing are local; no real payments.")
        ops.phase(2, 4, "Installing Cloud website dependencies")
        ops.install_site_tools(pnpm)
        ops.phase(3, 4, "Starting identity service and real Cloud API")
        for name, factory, port in (
            ("IDENTITY", "selecta.devstack.identity_server:application", identity_port),
            ("API", "selecta.devstack.cloud_app:application", api_port),
        ):
            services.append(ops.start_service(
                name,
                [sys.executable, "-u", "-m", "uvicorn", factory,
                 "--factory", "--host", "127.0.0.1", "--port", str(port),
                 "--reload", "--reload-dir", str(ops.ROOT / "src" / "selecta"),
                 "--log-level", "debug" if options.verbose else "info",
                 *([] if options.verbose else ["--no-access-log"])],
                ops.ROOT, env,
            ))
        # Migrations are owned by the API; seeding and workers must not race them.
        wait_cloud_ready(
            api_port, identity_port, site_port, services, ops,
            timeout=options.startup_timeout, site_required=False, worker_required=False,
        )
        if options.seed:
            _seed(settings, env, ops)
        services.append(ops.start_service(
            "WORKER", [sys.executable, "-u", "-m", "selecta.devstack.worker"],
            ops.ROOT, env,
        ))
        services.append(ops.start_service(
            "SITE", [pnpm, "exec", "vite", "--config", "vite.cloud-dev.config.ts",
                     "--host", "127.0.0.1", "--port", str(site_port), "--strictPort"],
            ops.WEB,
            {
                **env,
                "SELECTA_DEV_API_URL": settings.api_url,
                "SELECTA_DEV_IDENTITY_URL": settings.identity_url,
                "VITE_WORKOS_CLIENT_ID": CLIENT_ID,
            },
        ))
        ops.phase(4, 4, "Verifying Cloud API, identity, worker, site and both proxies")
        wait_cloud_ready(
            api_port, identity_port, site_port, services, ops,
            timeout=options.startup_timeout,
        )
        ops.say("READY", f"Cloud development started in {time.monotonic() - began:.1f}s")
        ops.say("READY", f"Website:       {settings.site_url}/")
        ops.say("READY", f"Cloud API:     {settings.api_url}/api/status")
        ops.say("READY", f"Local inbox:   {settings.site_url}/dev/mail")
        ops.say("READY", f"Stack details: {settings.site_url}/dev/stack")
        ops.say("READY", f"Guest page:    {settings.site_url}/r/<room code> (open a room)")
        ops.say("READY", f"Display:       {settings.site_url}/display")
        ops.say("READY", f"Database:      {describe_database(settings.database_url)}")
        if options.seed:
            ops.say("SEED", "Sign in as dev@selectadj.test / selectadj-dev (development only).")
        if options.check:
            ops.say("PASS", "Cloud smoke checks passed; stopping launcher-owned services.")
            return 0
        if not options.no_browser:
            with contextlib.suppress(Exception):
                if not ops.webbrowser.open(f"{settings.site_url}/"):
                    ops.say("INFO", "Browser did not open. Copy the website URL above.")
        ops.say("INFO", "Ctrl+C stops only this launcher's services; data persists.")
        last = time.monotonic()
        while True:
            ops.check_exits(services)
            if time.monotonic() - last >= 60:
                api = _check(f"{settings.api_url}/api/status", "api", ops)
                identity = _check(f"{settings.identity_url}/dev/identity/health", "identity", ops)
                if api.ok and identity.ok:
                    ops.say("RUNNING", "Cloud API and identity still responding.")
                else:
                    ops.say(
                        "WARNING",
                        f"Cloud runtime health: API={api.detail}; "
                        f"IDENTITY={identity.detail}",
                    )
                last = time.monotonic()
            time.sleep(1)
    except KeyboardInterrupt:
        ops.say("STOP", "Ctrl+C received.")
        return 0
    except (OSError, ops.StartupError) as problem:
        ops.say("ERROR", str(problem))
        return 1
    finally:
        for service in reversed(services):
            ops.say("STOP", f"Stopping {service.name}...")
            ops.stop(service)
        if services:
            ops.say("STOP", "Cloud launcher-owned processes stopped.")


def doctor_cloud(ops, ports: tuple[int, ...] = (8733, 8742, 5173)) -> bool:
    """`dev.cmd doctor`'s Cloud part: free ports, the optional Docker, unsafe keys. True when
    nothing blocks `dev.cmd cloud` (Docker being absent never blocks it)."""
    fine = True
    for port in ports:
        if ops.port_is_free(port):
            ops.say("OK", f"Port {port} is free.")
        else:
            ops.say("PORT", f"Port {port} is busy; dev.cmd cloud picks the next free one, or "
                            "pass --api-port / --identity-port / --site-port.")
    docker = ops.shutil.which("docker")
    if docker is None:
        ops.say("INFO", "Docker: not found. Optional; only `dev.cmd cloud --docker` needs it.")
    else:
        try:
            running = subprocess.run(
                [docker, "info", "--format", "{{.ServerVersion}}"],
                capture_output=True, text=True, check=False, timeout=20,
            )
            version = running.stdout.strip() if running.returncode == 0 else ""
        except (OSError, subprocess.TimeoutExpired):
            version = ""
        if version:
            ops.say("OK", f"Docker {version} is running (for --docker).")
        else:
            ops.say("INFO", "Docker is installed but not running. Start it to use --docker; "
                            "plain `dev.cmd cloud` uses SQLite and doesn't need it.")
    url = os.environ.get("SELECTA_DEV_DATABASE_URL", "").strip()
    if url and not url.startswith(("postgresql://", "postgresql+psycopg://", "sqlite:///")):
        fine = False
        ops.say("ERROR", "SELECTA_DEV_DATABASE_URL must be a postgresql+psycopg:// URL.")
    for problem in guard.problems({**os.environ, "SELECTA_ENV": "development"}):
        fine = False
        ops.say("ERROR", f"Cloud: {problem}")
    return fine


__all__ = ["database_url", "doctor_cloud", "run_cloud", "wait_cloud_ready"]
