"""Read-only diagnostics for developer browser Cloud tests.

Not a browser audio server, customer dependency, or replacement for the Cloud API.
Run: python src/selecta/devstack/browser_doctor.py [--url http://127.0.0.1:5194/healthz]
"""
from __future__ import annotations

import argparse
import json
import shutil
import socket
import subprocess
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
WEB = ROOT / "web"


def version(program: str) -> str | None:
    executable = shutil.which(program)
    if not executable:
        return None
    try:
        result = subprocess.run(
            [executable, "--version"], capture_output=True, text=True, timeout=5, check=False
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    return result.stdout.strip().splitlines()[0] if result.returncode == 0 else None


def probe(url: str) -> dict:
    try:
        with urllib.request.urlopen(url, timeout=4) as response:  # noqa: S310
            return {"state": "reachable", "status": response.status}
    except (urllib.error.URLError, OSError, ValueError) as error:
        return {"state": "unreachable", "reason": str(error)}


def run() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://127.0.0.1:5194/healthz")
    parser.add_argument("--strict", action="store_true", help="fail if developer tools are absent")
    args = parser.parse_args()
    tools = {name: version(name) for name in ("node", "pnpm", "ffmpeg", "uv")}
    workspace = {
        "playwright_config": (WEB / "br64-10.playwright.config.ts").is_file(),
        "fixture_generator": (ROOT / "tools/browser_test/generate-fixtures.mjs").is_file(),
        "package_lock": (WEB / "pnpm-lock.yaml").is_file(),
    }
    host_status = probe(args.url)
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(0.5)
        browser_qa_port = sock.connect_ex(("127.0.0.1", 5194)) == 0
    print(json.dumps({
        "purpose": "developer diagnostics only, never required by end users",
        "tools": tools, "files": workspace, "synthetic_test_server": host_status,
        "port_5194_listening": browser_qa_port,
        "physical_speaker_certified": False,
    }, indent=2))
    if args.strict and (
        not tools["node"] or not tools["pnpm"] or not tools["ffmpeg"]
        or not all(workspace.values()) or host_status["state"] != "reachable"
    ):
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(run())
