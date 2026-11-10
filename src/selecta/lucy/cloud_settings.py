"""Lucy's settings in Cloud mode: only the choices a person owns (docs/saas/09-lucy-ai-gateway.md
§9.5).

Locally a person brings their own AI service, so they choose the provider, model, key and spend
limit. In Cloud the server owns all of that: the plan sets the Lucy level ("Lucy Basic" and so
on) and the gateway's policy sets the limits. What's left is the person's: whether to use Lucy,
which phases, and whether short lyric snippets or a listening summary may go to Selecta's AI
provider. Nothing here can name a model, a key or a budget, so a request can't buy itself a
better model or a bigger allowance.

The choices are stored per user in the same table as their feature opt-outs, under ids that
start `lucy:`. No feature flag can start that way, so they never collide with a flag, and the
data export already carries that table as the person's settings.

`GET /api/account/lucy` also returns this month's turn meter, so the settings page can show it.
"""

from __future__ import annotations

import copy
from collections.abc import Callable
from typing import Any

import sqlalchemy as sa
from fastapi import Depends, FastAPI, HTTPException, Request
from pydantic import BaseModel, ConfigDict
from sqlalchemy.dialects import postgresql, sqlite
from sqlalchemy.engine import Connection, Engine

from selecta import persistence
from selecta.billing import plans, stripe_sync
from selecta.flags.rules import user_flag_preferences
from selecta.identity.tokens import Claims
from selecta.persistence import transaction
from selecta.usage import meters

PREFIX = "lucy:"
PHASES = ("chat", "proposals", "commit", "memory", "voice")
PRIVACY = ("share_lyrics", "share_history")
# The same starting point as local Lucy (selecta.lucy.settings.DEFAULTS), minus what Cloud hides.
DEFAULTS: dict[str, Any] = {
    "enabled": True,
    "phases": {"chat": True, "proposals": True, "commit": True, "memory": False, "voice": False},
    "privacy": {"share_lyrics": False, "share_history": False},
}


class LucyChoices(BaseModel):
    """A change to the person's own Lucy choices. Unknown fields are refused, so a body that
    tries to set a provider, model, key or spend limit fails instead of being quietly ignored."""

    model_config = ConfigDict(extra="forbid")

    enabled: bool | None = None
    phases: dict[str, bool] | None = None
    privacy: dict[str, bool] | None = None


def _keys() -> dict[str, tuple[str, str | None]]:
    """Every stored id, mapped to the section and name it fills."""
    found: dict[str, tuple[str, str | None]] = {f"{PREFIX}enabled": ("enabled", None)}
    found.update({f"{PREFIX}phase.{name}": ("phases", name) for name in PHASES})
    found.update({f"{PREFIX}{name}": ("privacy", name) for name in PRIVACY})
    return found


def choices(conn: Connection, user_id: str) -> dict[str, Any]:
    """The person's choices, defaults filled in."""
    current = copy.deepcopy(DEFAULTS)
    keys = _keys()
    rows = conn.execute(
        sa.select(user_flag_preferences.c.flag_id, user_flag_preferences.c.enabled).where(
            user_flag_preferences.c.user_id == user_id,
            user_flag_preferences.c.flag_id.in_(list(keys)),
        )
    )
    for flag_id, enabled in rows:
        section, name = keys[flag_id]
        if name is None:
            current[section] = bool(enabled)
        else:
            current[section][name] = bool(enabled)
    return current


def save(conn: Connection, user_id: str, change: LucyChoices) -> dict[str, Any]:
    """Store a change and return the choices as they now stand. Unknown phase or privacy names
    are refused with a ValueError naming them."""
    values: dict[str, bool] = {}
    if change.enabled is not None:
        values[f"{PREFIX}enabled"] = change.enabled
    for section, allowed, stem in (
        (change.phases, PHASES, "phase."),
        (change.privacy, PRIVACY, ""),
    ):
        for name, enabled in (section or {}).items():
            if name not in allowed:
                raise ValueError(f"{name!r} isn't a Lucy choice.")
            values[f"{PREFIX}{stem}{name}"] = enabled
    insert = postgresql.insert if persistence.is_postgres(conn) else sqlite.insert
    now = persistence.db_now(conn)
    for flag_id, enabled in values.items():
        statement = insert(user_flag_preferences).values(
            user_id=user_id, flag_id=flag_id, enabled=enabled, updated_at=now
        )
        conn.execute(
            statement.on_conflict_do_update(
                index_elements=[user_flag_preferences.c.user_id, user_flag_preferences.c.flag_id],
                set_={"enabled": enabled, "updated_at": now},
            )
        )
    return choices(conn, user_id)


def install_routes(
    app: FastAPI,
    *,
    engine: Engine,
    current_claims: Callable[..., Claims],
    principal_for: Callable[..., Any],
) -> None:
    """Add `GET` and `PUT /api/account/lucy`, scoped to the signed-in person."""

    def answer(conn: Connection, principal) -> dict[str, Any]:
        workspace_id = principal.workspace.id
        entitlement = stripe_sync.effective_entitlement(conn, workspace_id)
        plan = plans.plan_for(entitlement.plan_id, entitlement.plan_version)
        return {
            **choices(conn, principal.user.id),
            "tier": meters.lucy_tier(plan),
            "usage": meters.lucy_turns(conn, workspace_id, plan, principal.user.timezone),
        }

    @app.get("/api/account/lucy")
    def get_lucy(request: Request, claims: Claims = Depends(current_claims)):  # noqa: B008
        principal = principal_for(engine, claims, request.headers.get("x-workspace-id"))
        with transaction(engine, principal.workspace.id) as conn:
            return answer(conn, principal)

    @app.put("/api/account/lucy")
    def put_lucy(
        body: LucyChoices,
        request: Request,
        claims: Claims = Depends(current_claims),  # noqa: B008
    ):
        principal = principal_for(engine, claims, request.headers.get("x-workspace-id"))
        with transaction(engine, principal.workspace.id) as conn:
            try:
                save(conn, principal.user.id, body)
            except ValueError as error:
                raise HTTPException(
                    status_code=400,
                    detail={"code": "invalid_lucy_choice", "message": str(error)},
                ) from error
            return answer(conn, principal)


__all__ = ["DEFAULTS", "LucyChoices", "choices", "install_routes", "save"]
