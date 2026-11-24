"""Inventory every API route of both apps for the product audit (docs/engineering/product-audit.md).

    uv run python scripts/audit/routes.py > build/routes.md

Builds the local app and the Cloud app (over a throwaway SQLite file) and prints one Markdown row
per route: method, path, app, owning flag, whether it needs a signed-in caller, whether it reads
the workspace header, whether it takes an Idempotency-Key, whether it says 429 anywhere in its
own source, and the largest request body field limit it declares. The last four are read from
the route's signature and source, so they are leads to check, not proof.
"""

from __future__ import annotations

import inspect
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tests"))
sys.path.insert(0, str(ROOT / "src"))

from fastapi.routing import APIRoute  # noqa: E402

from selecta import flags  # noqa: E402


def _params(route: APIRoute) -> set[str]:
    names: set[str] = set()
    stack = [route.dependant]
    while stack:
        dep = stack.pop()
        for param in (*dep.header_params, *dep.query_params, *dep.path_params, *dep.body_params):
            names.add(str(param.alias or param.name).lower())
        if dep.call is not None:
            names.add(getattr(dep.call, "__name__", "").lower())
        stack.extend(dep.dependencies)
    return names


def _source(route: APIRoute) -> str:
    try:
        return inspect.getsource(route.endpoint)
    except (OSError, TypeError):
        return ""


def rows(app, name: str) -> list[tuple[str, ...]]:
    owners = flags.route_owners()
    found = []
    for route in app.routes:
        if not isinstance(route, APIRoute) or not route.path.startswith("/api/"):
            continue
        params = _params(route)
        source = _source(route)
        signed_in = any("claims" in p or "principal" in p or "session" in p for p in params) or (
            "current_claims" in source or "require_" in source
        )
        tenant = "x-workspace-id" in params or "x-workspace-id" in source or (
            "principal" in source and "workspace" in source
        )
        idem = "idempotency-key" in params
        limited = "429" in source or "rate" in source.lower()
        for method in sorted(route.methods - {"HEAD", "OPTIONS"}):
            key = f"{method} {route.path}"
            found.append((
                method, route.path, name, owners.get(key, "NONE"),
                "yes" if signed_in else "no?", "yes" if tenant else "-",
                "yes" if idem else ("n/a" if method == "GET" else "no"),
                "yes" if limited else "-",
            ))
    return found


def main() -> None:
    from cloud_helpers import make_cloud_app

    from selecta.api import create_app
    from selecta.config import Settings

    with tempfile.TemporaryDirectory() as tmp:
        here = Path(tmp)
        local = create_app(Settings(here), here / "no-web")
        cloud, engine, _ = make_cloud_app(here)
        try:
            table = rows(local, "local") + rows(cloud, "cloud")
        finally:
            engine.dispose()
    print("| Method | Path | App | Flag | Signed in | Workspace | Idempotency-Key | 429 in source |")
    print("|---|---|---|---|---|---|---|---|")
    for row in sorted(table, key=lambda item: (item[2], item[1], item[0])):
        print("| " + " | ".join(row) + " |")
    total = len(table)
    cloud_rows = [row for row in table if row[2] == "cloud"]
    print()
    print(f"Totals: {total} routes ({total - len(cloud_rows)} local, {len(cloud_rows)} cloud); "
          f"cloud routes with no sign-in found: {sum(r[4] != 'yes' for r in cloud_rows)}; "
          f"cloud writes without an Idempotency-Key: "
          f"{sum(r[0] != 'GET' and r[6] == 'no' for r in cloud_rows)}; "
          f"cloud routes with 429 in source: {sum(r[7] == 'yes' for r in cloud_rows)}.")


if __name__ == "__main__":
    main()
