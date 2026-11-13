"""HTTP routes for Autopilot venue mode and venue policy (ADR-0424, ADR-0425).

Served by the Cloud app (`api_cloud.py`); the local app's `api.py` is locked, so local
registration is remaining work. Every route belongs to `autopilot.venue_mode` or
`autopilot.venue_policy` in `flags/autopilot.json`, so the flag guard refuses them with 403
`flag_off` while the flag is off (both default off).

State lives in memory per app (see `night_session.SessionStore`, `venue_policy.PolicyStore`,
`venue_setup.SetupStore`), scoped to the caller's workspace.
"""

from __future__ import annotations

import re
import secrets
from collections.abc import Callable
from datetime import datetime, timedelta
from typing import Any

from fastapi import Body, Depends, FastAPI, HTTPException, Request

from selecta import flags
from selecta.autopilot import availability, maturity, takeover
from selecta.autopilot.night_session import (
    Actor,
    Clock,
    SessionError,
    SessionState,
    SessionStore,
    utc_now,
)
from selecta.autopilot.venue_policy import (
    HardConstraints,
    Override,
    PolicyError,
    PolicyStore,
    TrackFacts,
    select_candidates,
)
from selecta.autopilot.venue_setup import SetupError, SetupStore, to_policy_draft

VENUE_ID = re.compile(r"^[a-z0-9][a-z0-9-]{0,63}$")
MAX_CANDIDATES = 2000

# The runtime capability each level would need before it is usable, not just defined.
LEVEL_RUNTIME = {
    maturity.MaturityLevel.L0_MANUAL: None,
    maturity.MaturityLevel.L1_SUGGEST: "autopilot_playback",
    maturity.MaturityLevel.L2_SUPERVISED: "autopilot_playback",
    maturity.MaturityLevel.L3_ATTENDED: "autopilot_playback",
    maturity.MaturityLevel.L4_UNATTENDED: "unattended_evening",
}


def level_usable(level: maturity.MaturityLevel, flag_on: Callable[[str], bool]) -> bool:
    need = LEVEL_RUNTIME[level]
    return need is None or availability.is_available(need, flag_on)


def _bad(code: str, message: str, status: int = 400, **extra: Any) -> HTTPException:
    return HTTPException(status_code=status, detail={"code": code, "message": message, **extra})


def _venue(venue_id: str) -> str:
    if not VENUE_ID.match(venue_id):
        raise _bad("bad_venue_id", "Venue ids are lower-case letters, digits and hyphens.")
    return venue_id


def _when(value: Any, default: datetime, what: str) -> datetime:
    if value in (None, ""):
        return default
    try:
        moment = datetime.fromisoformat(str(value))
    except ValueError as error:
        raise _bad("bad_time", f"{what} should be an ISO time with a zone.") from error
    if moment.tzinfo is None:
        raise _bad("bad_time", f"{what} needs a time zone.")
    return moment


def install_routes(
    app: FastAPI,
    *,
    engine: Any = None,
    current_claims: Callable[..., Any] | None = None,
    principal_for: Callable[..., Any] | None = None,
    scope: Callable[..., str] | None = None,
    clock: Clock = utc_now,
    flag_on: Callable[[str], bool] = flags.on,
) -> None:
    """Mount the routes. `scope` is a FastAPI dependency giving the caller's workspace id; by
    default it is built from `current_claims` and `principal_for` like the other Cloud routes."""
    if scope is None:
        if current_claims is None or principal_for is None:
            raise ValueError("install_routes needs scope, or current_claims and principal_for")

        def workspace_of(request: Request, claims=Depends(current_claims)) -> str:  # noqa: B008
            principal = principal_for(engine, claims, request.headers.get("x-workspace-id"))
            return str(principal.workspace.id)

        scope = workspace_of

    sessions = SessionStore(clock)
    policies = PolicyStore()
    setups = SetupStore()
    app.state.autopilot_stores = {"sessions": sessions, "policies": policies, "setups": setups}
    workspace_dep = Depends(scope)

    # Venue mode (ADR-0424) ---------------------------------------------------------------

    @app.get("/api/autopilot/availability")
    def get_availability(workspace: str = workspace_dep) -> dict[str, Any]:
        return availability.report(flag_on)

    @app.get("/api/autopilot/maturity")
    def get_maturity(workspace: str = workspace_dep) -> dict[str, Any]:
        return {
            "levels": [
                rules.to_dict() | {"usable": level_usable(rules.level, flag_on)}
                for rules in maturity.LEVELS.values()
            ],
            "human_controls": list(maturity.HUMAN_CONTROLS),
        }

    def _session(workspace: str, session_id: str):
        found = sessions.get(workspace, session_id)
        if found is None:
            raise _bad("session_not_found", "There's no night session with that id.", 404)
        return found

    @app.post("/api/autopilot/sessions", status_code=201)
    def create_session(body: dict = Body(...),  # noqa: B008
                       workspace: str = workspace_dep) -> dict[str, Any]:
        venue_id = _venue(str(body.get("venue_id", "")))
        try:
            level = maturity.MaturityLevel(int(body.get("level", 0)))
        except (TypeError, ValueError) as error:
            raise _bad("bad_level", "Level is a number from 0 to 4.") from error
        policy = policies.effective(workspace, venue_id, clock())
        missing = maturity.missing_for(
            level, has_policy=policy is not None,
            unattended_consent=body.get("unattended_consent") is True)
        if missing:
            raise _bad("level_prerequisites", f"L{int(level)} needs: {', '.join(missing)}.",
                       409, missing=missing)
        session = sessions.create(workspace, venue_id, level=level,
                                  policy_version=policy.version if policy else None)
        return session.to_dict() | {"level_usable": level_usable(level, flag_on)}

    @app.get("/api/autopilot/sessions/{session_id}")
    def get_session(session_id: str, workspace: str = workspace_dep) -> dict[str, Any]:
        return _session(workspace, session_id).to_dict()

    @app.post("/api/autopilot/sessions/{session_id}/transitions")
    def move_session(session_id: str, body: dict = Body(...),  # noqa: B008
                     workspace: str = workspace_dep) -> dict[str, Any]:
        session = _session(workspace, session_id)
        try:
            session.move(SessionState(str(body.get("to"))), Actor.STAFF,
                         str(body.get("reason") or ""))
        except ValueError as error:
            code = error.code if isinstance(error, SessionError) else "bad_state"
            raise _bad(code, str(error), 409) from error
        return session.to_dict()

    @app.post("/api/autopilot/sessions/{session_id}/controls/{control}")
    def control_session(session_id: str, control: str,
                        body: dict | None = Body(None),  # noqa: B008
                        workspace: str = workspace_dep) -> dict[str, Any]:
        session = _session(workspace, session_id)
        body = body or {}
        try:
            result = takeover.apply(
                session, control, reason=str(body.get("reason") or ""),
                hand_back_to=SessionState(str(body.get("to") or "live")))
        except ValueError as error:
            code = error.code if isinstance(error, SessionError) else "bad_state"
            raise _bad(code, str(error), 409) from error
        return result.to_dict() | {"session": session.to_dict()}

    # Venue policy (ADR-0425) -------------------------------------------------------------

    @app.get("/api/autopilot/venues/{venue_id}/setup")
    def get_setup(venue_id: str, workspace: str = workspace_dep) -> dict[str, Any]:
        return setups.get(workspace, _venue(venue_id)).to_dict()

    @app.put("/api/autopilot/venues/{venue_id}/setup/{step}")
    def put_setup(venue_id: str, step: str, body: dict = Body(...),  # noqa: B008
                  workspace: str = workspace_dep) -> dict[str, Any]:
        try:
            return setups.save(workspace, _venue(venue_id), step, body).to_dict()
        except SetupError as error:
            raise _bad("setup_invalid", str(error), 422, step=error.step,
                       errors=error.errors) from error

    def _policies(workspace: str, venue_id: str) -> dict[str, Any]:
        now = clock()
        current = policies.effective(workspace, venue_id, now)
        return {
            "venue_id": venue_id,
            "effective": current.to_dict() if current else None,
            "history": [p.to_dict() for p in policies.history(workspace, venue_id)],
        }

    @app.get("/api/autopilot/venues/{venue_id}/policies")
    def get_policies(venue_id: str, workspace: str = workspace_dep) -> dict[str, Any]:
        return _policies(workspace, _venue(venue_id))

    @app.post("/api/autopilot/venues/{venue_id}/policies", status_code=201)
    def publish_policy(venue_id: str, body: dict | None = Body(None),  # noqa: B008
                       workspace: str = workspace_dep) -> dict[str, Any]:
        venue_id = _venue(venue_id)
        body = body or {}
        now = clock()
        try:
            draft = to_policy_draft(setups.get(workspace, venue_id))
            policy = policies.publish(
                workspace, venue_id, draft,
                effective_from=_when(body.get("effective_from"), now, "Effective-from"),
                now=now, created_by=str(body.get("created_by") or ""))
        except SetupError as error:
            raise _bad("setup_incomplete", str(error), 409, errors=error.errors) from error
        except PolicyError as error:
            raise _bad("policy_invalid", str(error), 422) from error
        return {"published": policy.to_dict()} | _policies(workspace, venue_id)

    @app.get("/api/autopilot/venues/{venue_id}/overrides")
    def get_overrides(venue_id: str, workspace: str = workspace_dep) -> dict[str, Any]:
        now = clock()
        return {"overrides": [o.to_dict(now) for o in
                              policies.overrides(workspace, _venue(venue_id))],
                "now": now.isoformat()}

    @app.post("/api/autopilot/venues/{venue_id}/overrides", status_code=201)
    def add_override(venue_id: str, body: dict = Body(...),  # noqa: B008
                     workspace: str = workspace_dep) -> dict[str, Any]:
        venue_id = _venue(venue_id)
        now = clock()
        starts = _when(body.get("starts_at"), now, "Start")
        try:
            minutes = float(body.get("minutes", 0))
        except (TypeError, ValueError) as error:
            raise _bad("bad_minutes", "Minutes is a number.") from error
        expires = _when(body.get("expires_at"), starts + timedelta(minutes=minutes), "Expiry")
        limits = dict(body.get("limits") or {})
        limits.setdefault("allow_explicit", True)  # an override only tightens what it names
        try:
            override = Override(
                id=f"ovr-{secrets.token_hex(6)}", venue_id=venue_id, starts_at=starts,
                expires_at=expires, limits=HardConstraints.from_dict(limits),
                reason=str(body.get("reason") or ""),
                created_by=str(body.get("created_by") or ""))
        except PolicyError as error:
            raise _bad("override_invalid", str(error), 422) from error
        policies.add_override(workspace, override)
        return override.to_dict(now)

    @app.delete("/api/autopilot/venues/{venue_id}/overrides/{override_id}")
    def end_override(venue_id: str, override_id: str,
                     workspace: str = workspace_dep) -> dict[str, Any]:
        now = clock()
        try:
            ended = policies.end_override(workspace, _venue(venue_id), override_id, now)
        except PolicyError as error:
            raise _bad("override_not_found", str(error), 404) from error
        return ended.to_dict(now)

    @app.post("/api/autopilot/venues/{venue_id}/candidates")
    def check_candidates(venue_id: str, body: dict = Body(...),  # noqa: B008
                         workspace: str = workspace_dep) -> dict[str, Any]:
        venue_id = _venue(venue_id)
        now = _when(body.get("at"), clock(), "At")
        policy = policies.effective(workspace, venue_id, now)
        if policy is None:
            raise _bad("no_policy", "This venue has no published policy yet.", 409)
        raw = body.get("candidates") or []
        if not isinstance(raw, list) or len(raw) > MAX_CANDIDATES:
            raise _bad("bad_candidates", f"Send a list of at most {MAX_CANDIDATES} songs.")
        try:
            catalogue = [TrackFacts.from_mapping(item) for item in raw]
        except (PolicyError, TypeError, ValueError, AttributeError) as error:
            raise _bad("bad_candidates", str(error)) from error
        selection = select_candidates(policy, catalogue, now,
                                      policies.active_overrides(workspace, venue_id, now))
        return selection.to_dict() | {"policy_version": policy.version}


__all__ = ["LEVEL_RUNTIME", "install_routes", "level_usable"]
