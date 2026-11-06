@cd /d "%~dp0" & (where uv >nul 2>nul || (echo Selecta needs uv to run. Get it from https://docs.astral.sh/uv/ & pause & exit /b 1)) & (uv run python -x "%~f0" %* || pause) & exit /b
"""Run Selecta for development: the server and the site, each reloading as you edit.

Double-click this on Windows, or run it from a terminal:

    dev.cmd                 the server and the site, opened in your browser
    dev.cmd test            everything CI checks
    dev.cmd --no-browser    leave your browser alone
    dev.cmd --check         start it all, see that it answers, and stop

On macOS or Linux, this same file runs with: uv run python -x dev.cmd

The line above is for Windows, and Python skips it, so this is one file that does both. Your music
and everything Selecta has worked out stay in your own data folder, not in this checkout.
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
import time
import urllib.error
import urllib.request
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parent
WEB = ROOT / "web"
SERVER_PORT = 8733
SITE_PORT = 5173
PORTS_TO_TRY = 20
STARTING_SECONDS = 180.0  # the first start loads a lot, and a slow disk can take a while over it


def say(words: str) -> None:
    print(words, flush=True)


def need_pnpm() -> str:
    found = shutil.which("pnpm")
    if found is None:
        raise SystemExit("Selecta's site needs pnpm. Get it from https://pnpm.io/installation")
    return found


def install_site_tools(pnpm: str) -> None:
    """Only when something has changed, since it's the slowest part of starting up."""
    installed = WEB / "node_modules" / ".modules.yaml"
    lock = WEB / "pnpm-lock.yaml"
    if not installed.exists() or installed.stat().st_mtime < lock.stat().st_mtime:
        say("Installing what the site needs...")
        subprocess.run([pnpm, "install"], cwd=WEB, check=True)


def port_is_free(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        try:
            probe.bind(("127.0.0.1", port))
        except OSError:
            return False
    return True


def free_port(start: int) -> int:
    for port in range(start, start + PORTS_TO_TRY):
        if port_is_free(port):
            return port
    raise SystemExit(f"Ports {start} to {start + PORTS_TO_TRY - 1} are all in use.")


def read(url: str) -> str | None:
    try:
        with urllib.request.urlopen(url, timeout=3) as response:  # noqa: S310
            return response.read().decode("utf-8", "replace")
    except (OSError, urllib.error.URLError, ValueError):
        return None


def is_selecta(port: int) -> bool:
    answer = read(f"http://127.0.0.1:{port}/api/status")
    if answer is None:
        return False
    try:
        return "counts" in json.loads(answer)
    except ValueError:
        return False


def stop(process: subprocess.Popen) -> None:
    """A process and everything it started, or a render could carry on with nobody to report to."""
    import psutil

    with contextlib.suppress(psutil.NoSuchProcess):
        parent = psutil.Process(process.pid)
        family = [*parent.children(recursive=True), parent]
        for member in family:
            with contextlib.suppress(psutil.NoSuchProcess):
                member.terminate()
        _gone, left = psutil.wait_procs(family, timeout=5)
        for member in left:
            with contextlib.suppress(psutil.NoSuchProcess):
                member.kill()


def wait_until_ready(server_port: int, site_port: int, running: list[subprocess.Popen]) -> None:
    give_up_at = time.monotonic() + STARTING_SECONDS
    while time.monotonic() < give_up_at:
        if any(process.poll() is not None for process in running):
            raise SystemExit("Something stopped while starting up. The reason is just above.")
        if is_selecta(server_port) and read(f"http://127.0.0.1:{site_port}/") is not None:
            return
        time.sleep(0.5)
    raise SystemExit(f"Nothing answered after {STARTING_SECONDS:.0f} seconds.")


def run(open_browser: bool, only_check: bool) -> int:
    pnpm = need_pnpm()
    if shutil.which("ffmpeg") is None:
        say("ffmpeg isn't on your PATH, so songs can't be read. Get it from https://ffmpeg.org/")
    install_site_tools(pnpm)
    running: list[subprocess.Popen] = []
    try:
        server_port = SERVER_PORT
        if is_selecta(server_port):
            say(f"A Selecta server is already on port {server_port}, so this will use that one.")
        else:
            server_port = free_port(SERVER_PORT)
            say("Starting the server...")
            running.append(
                subprocess.Popen(
                    [
                        sys.executable, "-m", "selecta.cli", "web",
                        "--no-open", "--reload", "--port", str(server_port),
                    ],  # fmt: skip
                    cwd=ROOT,
                )
            )
        site_port = free_port(SITE_PORT)
        say("Starting the site...")
        running.append(
            subprocess.Popen(
                [pnpm, "exec", "vite", "--port", str(site_port), "--strictPort"],
                cwd=WEB,
                env={**os.environ, "SELECTA_API": f"http://127.0.0.1:{server_port}"},
            )
        )
        wait_until_ready(server_port, site_port, running)
        site = f"http://127.0.0.1:{site_port}/"
        if only_check:
            through_the_site = read(f"{site}api/status")
            if through_the_site is None or "counts" not in through_the_site:
                raise SystemExit("The site is up, but it can't reach the server.")
            say("Server and site both answer.")
            return 0
        say("")
        say(f"  Site     {site}  (updates as you edit web/src)")
        say(f"  Server   http://127.0.0.1:{server_port}/  (restarts as you edit src/selecta)")
        say("")
        say("  Close this window or press Ctrl+C to stop.")
        if open_browser:
            webbrowser.open(site)
        while all(process.poll() is None for process in running):
            time.sleep(0.5)
        say("Something stopped, so everything else is stopping too.")
        return 1
    except KeyboardInterrupt:
        return 0
    finally:
        for process in running:
            stop(process)


def test() -> int:
    """What CI runs, stopping at the first thing that fails."""
    pnpm = need_pnpm()
    install_site_tools(pnpm)
    for words, command, folder in (
        ("Lint", [sys.executable, "-m", "ruff", "check", "."], ROOT),
        ("Server tests", [sys.executable, "-m", "pytest", "-q"], ROOT),
        ("Types", [pnpm, "exec", "tsc", "--noEmit"], WEB),
        ("Site tests", [pnpm, "test"], WEB),
        ("Site build", [pnpm, "build"], WEB),
    ):
        say(f"--- {words}")
        if subprocess.run(command, cwd=folder, check=False).returncode != 0:
            say(f"{words} failed.")
            return 1
    say("Everything passed.")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(prog="dev.cmd", description="Run Selecta for development.")
    parser.add_argument("what", nargs="?", choices=["run", "test"], default="run")
    parser.add_argument("--no-browser", action="store_true", help="leave your browser alone")
    parser.add_argument("--check", action="store_true", help="start it all, check it, and stop")
    options = parser.parse_args()
    if options.what == "test":
        return test()
    return run(not options.no_browser and not options.check, options.check)


if __name__ == "__main__":
    raise SystemExit(main())
