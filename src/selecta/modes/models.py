"""Which models cloud mode may load, read from the licence register's allowlist (ADR-0405).

`docs/saas/licence-register.md` says, model by model, whether cloud mode may use it. Its
machine-readable copy is `model_allowlist.json` beside this file, and a test keeps the two in
step. Every place that loads weights calls `require_model(id)` before it imports or reads them,
so in cloud mode a model the register doesn't mark allowed (blocked, under review, or simply not
listed) is refused before a byte of it is loaded. Local mode loads anything, as it always has:
the register is about what Selecta may run as a service, not what a person runs at home.
"""

from __future__ import annotations

import json
from functools import cache
from pathlib import Path

from selecta.modes.core import Mode, current_mode, parse_mode

ALLOWLIST = Path(__file__).with_name("model_allowlist.json")
ALLOWED = "allowed"
STATUSES = ("allowed", "review", "blocked")


class ModelNotAllowed(RuntimeError):
    """Cloud mode was asked to load a model the licence register doesn't allow."""

    def __init__(self, model_id: str, status: str | None) -> None:
        self.model_id = model_id
        self.status = status
        why = "isn't in the licence register" if status is None else f"is marked {status}"
        super().__init__(
            f"Cloud mode can't load the model {model_id!r}: it {why}. "
            "See docs/saas/licence-register.md."
        )


@cache
def register() -> dict[str, str]:
    """Each listed model id and its cloud status."""
    data = json.loads(ALLOWLIST.read_text("utf-8"))
    found = {model_id: entry["status"] for model_id, entry in data["models"].items()}
    unknown = sorted(model for model, status in found.items() if status not in STATUSES)
    if unknown:
        raise ValueError(f"Unknown licence statuses for: {', '.join(unknown)}")
    return found


def allowed_in_cloud(model_id: str) -> bool:
    return register().get(model_id) == ALLOWED


def require_model(model_id: str, mode: str | Mode | None = None) -> None:
    """Refuse, in cloud mode, a model the register doesn't allow. Call before loading it."""
    wanted = parse_mode(mode) if mode is not None else current_mode()
    if wanted is Mode.CLOUD and not allowed_in_cloud(model_id):
        raise ModelNotAllowed(model_id, register().get(model_id))


__all__ = ["ModelNotAllowed", "allowed_in_cloud", "register", "require_model"]
