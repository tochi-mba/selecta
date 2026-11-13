"""The preservation inventory: every route, CLI command, flag and creative surface SelectaDJ has
(ADR-0417, AV-0417-01).

    python -m selecta.audit.preservation_inventory          # check: nothing listed has gone
    python -m selecta.audit.preservation_inventory --write  # record today's inventory

`current()` reads the live product: the local app's routes (`api.create_app` over a throwaway
home), the Cloud app's routes (`api_cloud.create_cloud_app` over an empty in-memory database), the
CLI's commands, every feature flag, and the creative surfaces the parity map promises (fifteen
visualizers, eight Studio lanes, editor, Seam Inspector, exports, Lucy and the rest), read from
their own source registries. `docs/engineering/preservation-inventory.json` is the recorded copy.
`removed()` names everything recorded that the live product no longer has: the charter says no
capability goes without equivalent functionality and the owner's explicit approval, so a test
fails on any removal. Additions are fine; `--write` records them.
"""

from __future__ import annotations

import json
import re
import sys
import tempfile
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[3]
INVENTORY = ROOT / "docs" / "engineering" / "preservation-inventory.json"
WEB = ROOT / "web" / "src"

# Creative surfaces from the parity map, each with the source file that must keep providing it.
SURFACE_FILES = {
    "editor": "web/src/views/Mix.tsx",
    "editor_rows": "web/src/views/EditorRows.tsx",
    "seam_inspector": "web/src/views/SeamInspector.tsx",
    "seam_compare": "web/src/views/SeamCompare.tsx",
    "studio": "web/src/views/Studio.tsx",
    "exports": "web/src/views/ExportPanel.tsx",
    "export_jobs": "web/src/views/ExportJobs.tsx",
    "lucy": "web/src/views/Lucy.tsx",
    "drafts": "web/src/views/Drafts.tsx",
    "my_mixes": "web/src/views/MyMixes.tsx",
    "requests": "web/src/views/Requests.tsx",
    "library": "web/src/views/Library.tsx",
    "listening": "web/src/views/Listening.tsx",
    "local_backup": "web/src/views/LocalBackup.tsx",
    "cloud_library": "web/src/cloud/Library.tsx",
    "cloud_uploads": "web/src/cloud/Uploads.tsx",
    "cloud_billing": "web/src/cloud/Billing.tsx",
    "cloud_listen": "web/src/rooms/CloudListen.tsx",
    "room_panel": "web/src/rooms/RoomPanel.tsx",
}


def _api_routes(app) -> list[str]:
    from fastapi.routing import APIRoute

    found = set()
    for route in app.routes:
        if isinstance(route, APIRoute) and route.path.startswith("/api/"):
            for method in sorted(route.methods - {"HEAD", "OPTIONS"}):
                found.add(f"{method} {route.path}")
    return sorted(found)


def local_routes() -> list[str]:
    from selecta.api import create_app
    from selecta.config import Settings

    with tempfile.TemporaryDirectory(prefix="selecta-inventory-") as home:
        app = create_app(Settings(Path(home) / "home"), Path(home) / "no-web")
        return _api_routes(app)


class _NoTokens:
    def verify(self, token: str):  # pragma: no cover - never called while listing routes
        raise ValueError("inventory only lists routes")


def cloud_routes() -> list[str]:
    from sqlalchemy.pool import StaticPool

    from selecta.api_cloud import CloudSettings, create_cloud_app
    from selecta.persistence import make_engine

    settings = CloudSettings(
        database_url="sqlite://",
        workos_client_id="client_inventory",
        issuer="https://issuer.invalid",
        audience="selecta-inventory",
        allowed_hosts=("testserver",),
        allowed_origins=("https://app.invalid",),
    )
    engine = make_engine("sqlite://", poolclass=StaticPool)
    try:
        return _api_routes(create_cloud_app(settings, engine=engine, verifier=_NoTokens()))
    finally:
        engine.dispose()


def cli_commands() -> list[str]:
    from selecta.cli import app

    names = []
    for command in app.registered_commands:
        names.append(command.name or command.callback.__name__.replace("_", "-"))
    for group in app.registered_groups:
        sub = group.typer_instance
        for command in sub.registered_commands:
            name = command.name or command.callback.__name__.replace("_", "-")
            names.append(f"{group.name} {name}")
    return sorted(names)


def flag_ids() -> list[str]:
    from selecta import flags

    return sorted(flags.registry())


def _read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def visualizers() -> list[str]:
    source = _read("web/src/views/spectrumVisuals.ts")
    block = source.split("export const SPECTRUM_MODES", 1)[1].split("];", 1)[0]
    return re.findall(r"\{ id: '([a-z]+)'", block)


def studio_lanes() -> list[str]:
    source = _read("web/src/studio.ts")
    lanes = re.findall(
        r"'([a-z]+)'", re.search(r"export const LANES[^=]*=\s*\[([^\]]*)\]", source)[1]
    )
    sides = re.findall(
        r"'([a-z]+)'", re.search(r"export const SIDES[^=]*=\s*\[([^\]]*)\]", source)[1]
    )
    return [f"{side}.{lane}" for side in sides for lane in lanes]


def surfaces() -> list[str]:
    return sorted(name for name, path in SURFACE_FILES.items() if (ROOT / path).is_file())


def current() -> dict[str, Any]:
    return {
        "local_routes": local_routes(),
        "cloud_routes": cloud_routes(),
        "cli_commands": cli_commands(),
        "flags": flag_ids(),
        "visualizers": visualizers(),
        "studio_lanes": studio_lanes(),
        "surfaces": surfaces(),
    }


def recorded() -> dict[str, list[str]]:
    data = json.loads(INVENTORY.read_text(encoding="utf-8"))
    return {key: value for key, value in data.items() if isinstance(value, list)}


def removed(live: dict[str, Any] | None = None) -> dict[str, list[str]]:
    """Everything the recorded inventory lists that the live product no longer has."""
    live = current() if live is None else live
    gone = {}
    for key, items in recorded().items():
        missing = sorted(set(items) - set(live.get(key, [])))
        if missing:
            gone[key] = missing
    return gone


def write(live: dict[str, Any] | None = None) -> Path:
    live = current() if live is None else live
    body = {
        "about": "SelectaDJ preservation inventory (ADR-0417). Regenerate with "
        "`python -m selecta.audit.preservation_inventory --write`.",
        **live,
    }
    INVENTORY.parent.mkdir(parents=True, exist_ok=True)
    INVENTORY.write_text(json.dumps(body, indent=2) + "\n", encoding="utf-8")
    return INVENTORY


def main(argv: list[str] | None = None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    if "--write" in argv:
        print(f"Wrote {write().relative_to(ROOT)}")
        return 0
    gone = removed()
    if gone:
        for key, items in gone.items():
            print(f"{key}: no longer present: {', '.join(items)}")
        return 1
    print("Every recorded route, command, flag and creative surface is still present.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
