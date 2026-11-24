"""Call every Cloud API route with no sign-in and list what answers 2xx (product audit, area L).

    uv run python scripts/audit/anonymous.py

Path parameters get placeholder values and the body is `{}`, so a route that is meant to be
public (status, guest pages, signed webhooks) still shows up for a person to confirm by name.
Every other 2xx is a route that did something for a caller nobody signed in.
"""

from __future__ import annotations

import re
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tests"))
sys.path.insert(0, str(ROOT / "src"))

from fastapi.routing import APIRoute  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

# Meant to answer without a sign-in: health, guest and display pages, signed webhooks, kiosk and
# display devices (they carry their own device token), venue rooms by code.
PUBLIC = re.compile(
    r"^/api/(status|ready|guest/|display/|kiosk/|venue-rooms/|webhooks/|business/billing/"
    r"stripe-webhook)"
)


def main() -> None:
    from cloud_helpers import make_cloud_app

    with tempfile.TemporaryDirectory() as tmp:
        app, engine, _ = make_cloud_app(Path(tmp))
        client = TestClient(app, base_url="http://testserver", raise_server_exceptions=False)
        answered: list[tuple[str, str, int]] = []
        errors: list[tuple[str, str, int]] = []
        try:
            for route in app.routes:
                if not isinstance(route, APIRoute) or not route.path.startswith("/api/"):
                    continue
                path = re.sub(r"\{[^}]+\}", "x1", route.path)
                for method in sorted(route.methods - {"HEAD", "OPTIONS"}):
                    response = client.request(method, path, json={},
                                              headers={"Origin": "https://app.test"})
                    if response.status_code < 300:
                        answered.append((method, route.path, response.status_code))
                    elif response.status_code >= 500:
                        errors.append((method, route.path, response.status_code))
        finally:
            engine.dispose()
    print("Answered 2xx with no sign-in:")
    for method, path, status in answered:
        print(f"  {'public ' if PUBLIC.match(path) else 'CHECK  '}{status} {method} {path}")
    print("Answered 5xx to an empty anonymous call (should be a 4xx with a code):")
    for method, path, status in errors:
        print(f"  {status} {method} {path}")


if __name__ == "__main__":
    main()
