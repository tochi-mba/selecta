"""Post-deploy smoke test for a Selecta Cloud environment (ADR-0409, SC-0409-01).

Run by `.github/workflows/deploy.yml` after each deploy, and by hand against staging:

    python infra/deploy/smoke.py --api https://api.staging.example --gateway https://gateway...

It checks what a deploy can break without a signed-in person: both services are up and on the
latest schema, the API refuses an anonymous account read, the gateway refuses an unenrolled
worker, and, when `--synthetic-token` is given (a staging-only synthetic user's session from the
WorkOS test environment), that user can read their account and their library. Exit code 0 means
every check passed; each check prints one line. Only `httpx` is needed.
"""

from __future__ import annotations

import argparse
import sys
from collections.abc import Callable
from dataclasses import dataclass

import httpx


@dataclass
class Check:
    name: str
    ok: bool
    detail: str = ""


def _ready(client: httpx.Client, base: str, service: str) -> Check:
    response = client.get(f"{base}/api/ready")
    body = response.json() if response.headers.get("content-type", "").startswith(
        "application/json") else {}
    ok = response.status_code == 200 and body.get("status") == "ready"
    return Check(f"{service} ready on the latest schema", ok, f"HTTP {response.status_code}")


def _refused(client: httpx.Client, url: str, name: str, method: str = "GET") -> Check:
    response = client.request(method, url)
    return Check(name, response.status_code in {401, 403}, f"HTTP {response.status_code}")


def _synthetic(client: httpx.Client, api: str, token: str) -> list[Check]:
    headers = {"Authorization": f"Bearer {token}"}
    checks = []
    for path, name in (("/api/account", "synthetic user reads their account"),
                       ("/api/assets", "synthetic user lists their songs")):
        response = client.get(f"{api}{path}", headers=headers)
        checks.append(Check(name, response.status_code == 200, f"HTTP {response.status_code}"))
    return checks


def run(api: str, gateway: str, *, synthetic_token: str | None = None,
        transport: httpx.BaseTransport | None = None) -> list[Check]:
    api, gateway = api.rstrip("/"), gateway.rstrip("/")
    steps: list[Callable[[httpx.Client], list[Check] | Check]] = [
        lambda c: _ready(c, api, "API"),
        lambda c: _ready(c, gateway, "Gateway"),
        lambda c: _refused(c, f"{api}/api/account", "API refuses an anonymous account read"),
        lambda c: _refused(c, f"{gateway}/internal/workers/claim",
                           "gateway refuses an unenrolled worker", "POST"),
    ]
    if synthetic_token:
        steps.append(lambda c: _synthetic(c, api, synthetic_token))
    results: list[Check] = []
    with httpx.Client(timeout=15.0, transport=transport, follow_redirects=False) as client:
        for step in steps:
            try:
                found = step(client)
            except httpx.HTTPError as error:
                found = Check("request", False, type(error).__name__)
            results.extend(found if isinstance(found, list) else [found])
    return results


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Selecta Cloud post-deploy smoke test.")
    parser.add_argument("--api", required=True)
    parser.add_argument("--gateway", required=True)
    parser.add_argument("--synthetic-token", default=None)
    args = parser.parse_args(argv)
    results = run(args.api, args.gateway, synthetic_token=args.synthetic_token)
    for check in results:
        print(f"{'PASS' if check.ok else 'FAIL'}  {check.name}  ({check.detail})")
    return 0 if results and all(check.ok for check in results) else 1


if __name__ == "__main__":
    sys.exit(main())
