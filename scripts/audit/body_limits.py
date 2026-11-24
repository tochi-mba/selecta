"""List every Cloud request body field that is text or a list with no length limit (product audit,
area H: every text input has a limit on both sides).

    uv run python scripts/audit/body_limits.py
"""

from __future__ import annotations

import sys
import tempfile
from pathlib import Path
from typing import get_args, get_origin

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tests"))
sys.path.insert(0, str(ROOT / "src"))

from fastapi.routing import APIRoute  # noqa: E402
from pydantic import BaseModel  # noqa: E402


def _limited(field) -> bool:
    for meta in field.metadata:
        if getattr(meta, "max_length", None) is not None or getattr(meta, "le", None) is not None:
            return True
    return False


def _kinds(annotation) -> set:
    if get_origin(annotation) is None:
        return {annotation}
    found = set()
    for arg in get_args(annotation):
        found |= _kinds(arg)
    return found | {get_origin(annotation)}


def unlimited(model: type[BaseModel], prefix: str = "") -> list[str]:
    found = []
    for name, field in model.model_fields.items():
        kinds = _kinds(field.annotation)
        for kind in kinds:
            if isinstance(kind, type) and issubclass(kind, BaseModel):
                found += unlimited(kind, f"{prefix}{name}.")
        if (str in kinds or list in kinds or dict in kinds) and not _limited(field):
            found.append(f"{prefix}{name}")
    return found


def main() -> None:
    from cloud_helpers import make_cloud_app

    with tempfile.TemporaryDirectory() as tmp:
        app, engine, _ = make_cloud_app(Path(tmp))
        engine.dispose()
    rows = []
    for route in app.routes:
        if not isinstance(route, APIRoute):
            continue
        for param in route.dependant.body_params:
            model = param.field_info.annotation if hasattr(param, "field_info") else None
            model = getattr(param, "type_", None) or model
            if isinstance(model, type) and issubclass(model, BaseModel):
                for field in unlimited(model):
                    rows.append(f"{','.join(sorted(route.methods))} {route.path}: {field}")
    print("\n".join(sorted(set(rows))) or "none")
    print(f"\n{len(set(rows))} body fields with no length limit")


if __name__ == "__main__":
    main()
