"""HTTP routes for the Autopilot horizon, safe transitions and AI director (ADR-0426 to 0428).

Served by the Cloud app (`api_cloud.py`); the local app's `api.py` is locked, so local
registration is remaining work. Each route belongs to `autopilot.horizon`,
`autopilot.safe_transitions` or `autopilot.ai_director` in `flags/autopilot.json`, so the flag
guard refuses it while its flag is off (all default off).

State is in memory per app and scoped to the caller's workspace. Until a Cloud catalogue adapter
exists, the caller supplies the session's candidate pool and hard limits when it starts the
horizon (the venue policy routes in `routes_autopilot.py` filter that pool first). No model is
wired in Cloud yet, so typed intents work and free-text requests are logged as
`model_unavailable` with the plan unchanged.
"""

from __future__ import annotations

import threading
from collections.abc import Callable, Mapping
from typing import Any

from fastapi import Body, Depends, FastAPI, HTTPException, Request

from selecta.autopilot import fallback
from selecta.autopilot.director import (
    DIRECTOR_ROLES,
    Caller,
    Director,
    DirectorError,
    slot_of,
)
from selecta.autopilot.horizon import HorizonError, HorizonStore, ReplanEvent, Slot
from selecta.autopilot.ranking import Candidate, Context, plan_window, rank
from selecta.autopilot.technique_report import TechniqueReport
from selecta.autopilot.venue_policy import HardConstraints, PolicyError

MAX_POOL = 2000
SESSION = "/api/autopilot/sessions/{session_id}"


def _bad(code: str, message: str, status: int = 400) -> HTTPException:
    return HTTPException(status_code=status, detail={"code": code, "message": message})


class _Sessions:
    """The pool and limits each session's horizon was started with."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self.pools: dict[tuple[str, str], list[Candidate]] = {}
        self.limits: dict[tuple[str, str], HardConstraints] = {}

    def pool(self, workspace: str, session_id: str) -> list[Candidate]:
        with self._lock:
            return list(self.pools.get((workspace, session_id), ()))

    def limit(self, workspace: str, session_id: str) -> HardConstraints:
        with self._lock:
            return self.limits.get((workspace, session_id), HardConstraints())


def _slots(items: Any, what: str) -> list[Slot]:
    if items is None:
        return []
    if not isinstance(items, list):
        raise _bad("bad_slots", f"{what} should be a list of songs")
    try:
        return [Slot.from_dict(item) for item in items]
    except (HorizonError, AttributeError) as error:
        raise _bad("bad_slots", str(error)) from error


def _slot(item: Any, what: str) -> Slot | None:
    return None if item is None else _slots([item], what)[0]


def _pool(items: Any) -> list[Candidate]:
    if not isinstance(items, list) or len(items) > MAX_POOL:
        raise _bad("bad_pool", f"pool should be a list of at most {MAX_POOL} songs")
    try:
        return [Candidate.from_mapping(item) for item in items]
    except (PolicyError, TypeError, ValueError, AttributeError) as error:
        raise _bad("bad_pool", str(error)) from error


def install_routes(
    app: FastAPI,
    *,
    engine: Any = None,
    current_claims: Callable[..., Any] | None = None,
    principal_for: Callable[..., Any] | None = None,
    caller: Callable[..., tuple[str, Caller]] | None = None,
    director_model: Any = None,
) -> None:
    """Mount the routes. `caller` is a dependency giving (workspace id, Caller); by default it
    is built from `current_claims` and `principal_for` like the other Cloud routes."""
    if caller is None:
        if current_claims is None or principal_for is None:
            raise ValueError("install_routes needs caller, or current_claims and principal_for")

        def from_principal(request: Request,
                           claims=Depends(current_claims)) -> tuple[str, Caller]:  # noqa: B008
            principal = principal_for(engine, claims, request.headers.get("x-workspace-id"))
            role = str(getattr(principal.workspace_role, "value", principal.workspace_role))
            return str(principal.workspace.id), Caller(str(principal.user.id), role)

        caller = from_principal

    store = HorizonStore()
    sessions = _Sessions()
    report = TechniqueReport()
    director = Director(store, pool=sessions.pool, limits=sessions.limit, model=director_model)
    app.state.autopilot_plan = {"horizons": store, "report": report, "director": director}
    who = Depends(caller)

    def _writer(person: Caller) -> None:
        if person.role not in DIRECTOR_ROLES:
            raise _bad("forbidden", "Only venue owners and editors can change the plan", 403)

    def _current(workspace: str, session_id: str):
        found = store.current(workspace, session_id)
        if found is None:
            raise _bad("no_horizon", "This session has no horizon yet", 404)
        return found

    def _director_error(error: DirectorError) -> HTTPException:
        return _bad(error.code, str(error), error.status)

    # Horizon (ADR-0426) -------------------------------------------------------------------

    @app.post(SESSION + "/horizon", status_code=201)
    def start_horizon(session_id: str, body: dict = Body(...),  # noqa: B008
                      me: tuple[str, Caller] = who) -> dict[str, Any]:
        workspace, person = me
        _writer(person)
        pool = _pool(body.get("pool") or [])
        try:
            limits = HardConstraints.from_dict(body.get("limits"))
        except (PolicyError, TypeError, ValueError) as error:
            raise _bad("bad_limits", str(error)) from error
        try:
            horizon = store.start(
                workspace, session_id, _slot(body.get("committed"), "committed"),
                _slot(body.get("locked"), "locked"), _slots(body.get("tentative"), "tentative"),
            )
        except HorizonError as error:
            raise _bad(error.code, str(error), 409) from error
        with sessions._lock:
            sessions.pools[(workspace, session_id)] = pool
            sessions.limits[(workspace, session_id)] = limits
        return horizon.to_dict()

    @app.get(SESSION + "/horizon")
    def get_horizon(session_id: str, me: tuple[str, Caller] = who) -> dict[str, Any]:
        workspace, _ = me
        current = _current(workspace, session_id)
        return current.to_dict() | {
            "history": [h.revision for h in store.history(workspace, session_id)]
        }

    @app.post(SESSION + "/horizon/replan")
    def replan(session_id: str, body: dict = Body(...),  # noqa: B008
               me: tuple[str, Caller] = who) -> dict[str, Any]:
        workspace, person = me
        _writer(person)
        current = _current(workspace, session_id)
        try:
            base = int(body["base_revision"])
        except (KeyError, TypeError, ValueError) as error:
            raise _bad("bad_revision", "base_revision is the revision this plan was made for") \
                from error
        if body.get("auto") is True:
            context = director.context(workspace, session_id, current)
            picks = plan_window(sessions.pool(workspace, session_id), context,
                                sessions.limit(workspace, session_id),
                                seed=str(body.get("seed", 0)), length=8)
            tentative = [slot_of(c, "autopilot") for c in picks]
            pinned = [s for s in current.tentative if s.pinned]
            ids = {s.track_id for s in pinned}
            tentative = pinned + [s for s in tentative if s.track_id not in ids]
            actor = "autopilot"
        else:
            tentative = _slots(body.get("tentative"), "tentative")
            actor = "staff"
        event = ReplanEvent(
            base_revision=base, tentative=tuple(tentative), reason=str(body.get("reason") or
                                                                       "replan")[:80],
            actor=actor, expect_committed=body.get("expect_committed"),
            expect_locked=body.get("expect_locked"),
        )
        try:
            return store.replan(workspace, session_id, event).to_dict()
        except HorizonError as error:
            raise _bad(error.code, str(error), 409) from error

    @app.post(SESSION + "/horizon/advance")
    def advance(session_id: str, me: tuple[str, Caller] = who) -> dict[str, Any]:
        workspace, person = me
        _writer(person)
        _current(workspace, session_id)
        return store.advance(workspace, session_id).to_dict()

    @app.post(SESSION + "/horizon/rank")
    def rank_pool(session_id: str, body: dict = Body(default={}),  # noqa: B008
                  me: tuple[str, Caller] = who) -> dict[str, Any]:
        workspace, _ = me
        current = _current(workspace, session_id)
        context: Context = director.context(workspace, session_id, current)
        return rank(sessions.pool(workspace, session_id), context,
                    sessions.limit(workspace, session_id),
                    seed=str(body.get("seed", 0))).to_dict()

    # Safe transitions (ADR-0427) ----------------------------------------------------------

    @app.post("/api/autopilot/transitions/check")
    def check_transition(body: dict = Body(...),  # noqa: B008
                         me: tuple[str, Caller] = who) -> dict[str, Any]:
        workspace, _ = me
        try:
            decision = fallback.climb_from_mapping(body)
        except (TypeError, ValueError) as error:
            raise _bad("bad_facts", str(error)) from error
        out = decision.to_dict()
        session_id = body.get("session_id")
        if isinstance(session_id, str) and session_id:
            record = report.planned(workspace, session_id, str(body.get("from_track") or ""),
                                    decision)
            out["record_id"] = record.id
        return out

    @app.get(SESSION + "/technique-report")
    def technique_report(session_id: str, me: tuple[str, Caller] = who) -> Mapping[str, Any]:
        workspace, _ = me
        return report.summary(workspace, session_id)

    @app.post(SESSION + "/technique-report/{record_id}")
    def report_audible(session_id: str, record_id: str, body: dict = Body(...),  # noqa: B008
                       me: tuple[str, Caller] = who) -> dict[str, Any]:
        workspace, _ = me
        audible = str(body.get("audible") or "").strip()
        if not audible:
            raise _bad("bad_audible", "audible names the technique the room heard")
        try:
            record = report.played(workspace, session_id, record_id, audible,
                                   reason=body.get("reason") or None)
        except KeyError as error:
            raise _bad("not_found", "There's no transition with that id", 404) from error
        return record.to_dict()

    # AI director (ADR-0428) ---------------------------------------------------------------

    @app.post(SESSION + "/director/intents", status_code=201)
    def post_intent(session_id: str, body: dict = Body(...),  # noqa: B008
                    me: tuple[str, Caller] = who) -> dict[str, Any]:
        workspace, person = me
        try:
            if isinstance(body.get("intent"), dict):
                entry = director.apply(workspace, session_id, person, body["intent"])
            elif isinstance(body.get("request"), str):
                entry = director.interpret(workspace, session_id, person, body["request"])
            else:
                raise _bad("bad_intent", "Send an intent object or a request in words")
        except DirectorError as error:
            raise _director_error(error) from error
        return entry.to_dict()

    @app.get(SESSION + "/director/log")
    def director_log(session_id: str, me: tuple[str, Caller] = who) -> dict[str, Any]:
        workspace, _ = me
        return {"entries": [e.to_dict() for e in director.log(workspace, session_id)]}

    @app.post(SESSION + "/director/intents/{entry_id}/undo")
    def undo_intent(session_id: str, entry_id: str,
                    me: tuple[str, Caller] = who) -> dict[str, Any]:
        workspace, person = me
        try:
            return director.undo(workspace, session_id, person, entry_id).to_dict()
        except DirectorError as error:
            raise _director_error(error) from error


ROUTES = {
    "autopilot.horizon": [
        "POST " + SESSION + "/horizon",
        "GET " + SESSION + "/horizon",
        "POST " + SESSION + "/horizon/replan",
        "POST " + SESSION + "/horizon/advance",
        "POST " + SESSION + "/horizon/rank",
    ],
    "autopilot.safe_transitions": [
        "POST /api/autopilot/transitions/check",
        "GET " + SESSION + "/technique-report",
        "POST " + SESSION + "/technique-report/{record_id}",
    ],
    "autopilot.ai_director": [
        "POST " + SESSION + "/director/intents",
        "GET " + SESSION + "/director/log",
        "POST " + SESSION + "/director/intents/{entry_id}/undo",
    ],
}

__all__ = ["ROUTES", "install_routes"]
