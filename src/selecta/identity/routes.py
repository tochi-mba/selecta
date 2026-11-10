"""The cloud API's identity routes: onboarding, signing out, deletion, WorkOS webhooks, admin entry.

`principal_or_refusal()` is the per-request check of §7A.3 after the token itself is verified.
Each refusal has its own code so the site can say the right thing:

| Code | Status | Meaning |
|---|---|---|
| `session_revoked` | 401 | The session was signed out (by `sid` or the cut-off) |
| `not_onboarded` | 409 | Signed in, but no Selecta account yet: only onboarding is allowed |
| `account_deleting` | 403 | The account is being deleted (30-day recovery window) |
| `account_suspended` | 403 | Suspended by staff, and the request would change or process data |
| `workspace_not_found` | 404 | `X-Workspace-ID` names a workspace the user isn't in (or none) |

The workspace refusal is a 404 `workspace_not_found`, so naming another account's workspace
looks exactly like naming one that doesn't exist (the tenant isolation tests rely on this).

A suspended account is read-only (§7A.6, §16): it may read its own data and export it, sign out
and delete itself, and nothing else. That is decided here, once, rather than route by route:
`api_cloud` records each request's method in `REQUEST_METHOD`, and a GET or HEAD resolves for a
suspended account while any other method is refused. Signing out everywhere and deleting the
account pass `allow_suspended=True` explicitly. Outside a request nothing is recorded, so the
check is strict. Starlette copies the context into the worker thread that runs a sync handler,
so the method is visible there too (a test proves it).

Onboarding reads the email and its verified status from the WorkOS user found by the token's
subject, never from the token. Without a WorkOS client (local development and tests that don't
need WorkOS) it falls back to the token's claims. Production can't get there: settings read from
the environment refuse to load without the WorkOS API key and webhook secret, and they also set
`require_workos`, which answers 503 rather than ever trusting the token for this.
"""

import logging
from collections.abc import Callable
from contextvars import ContextVar
from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.engine import Engine
from starlette.concurrency import run_in_threadpool

from selecta.authz.errors import LastOwner
from selecta.billing import plans
from selecta.identity import accounts, privileged, sessions, workos_events, workos_signature
from selecta.identity.tokens import Claims
from selecta.identity.workos import WorkOSClient, WorkOSError, WorkOSNotFound
from selecta.persistence import transaction
from selecta.usage import quota

logger = logging.getLogger(__name__)
MAX_WEBHOOK_BYTES = 1_000_000
# Methods that only read. A suspended account may use these and nothing else.
SAFE_METHODS = frozenset({"GET", "HEAD"})
# The HTTP method of the request being handled, set by `api_cloud.RequestMethodMiddleware`.
REQUEST_METHOD: ContextVar[str | None] = ContextVar("selecta_request_method", default=None)


def request_method() -> str | None:
    """The method of the request being handled, or None outside a request."""
    return REQUEST_METHOD.get()


class OnboardingRequest(BaseModel):
    age_confirmed: bool = Field(
        description="The signed-in person confirms they meet the minimum account age."
    )
    timezone: str = "UTC"


def refusal(error: accounts.IdentityError) -> HTTPException:
    """The HTTP answer for an identity check that failed."""
    if isinstance(error, accounts.SessionRevoked):
        return HTTPException(
            status_code=401,
            detail={"code": "session_revoked", "message": "You were signed out. Sign in again."},
            headers={"WWW-Authenticate": "Bearer"},
        )
    if isinstance(error, accounts.NotProvisioned):
        return HTTPException(
            status_code=409,
            detail={"code": "not_onboarded", "message": "Finish account setup first."},
        )
    if isinstance(error, accounts.AccountDeleted):
        return HTTPException(
            status_code=403,
            detail={"code": "account_deleting", "message": "This account is being deleted."},
        )
    if isinstance(error, accounts.AccountSuspended):
        return HTTPException(
            status_code=403,
            detail={"code": "account_suspended", "message": "This account is suspended."},
        )
    if isinstance(error, accounts.NotAMember):
        return HTTPException(status_code=404, detail={"code": "workspace_not_found"})
    return HTTPException(status_code=403, detail={"code": "identity_refused"})


def principal_or_refusal(
    engine: Engine,
    claims: Claims,
    workspace_id: str | None = None,
    *,
    allow_suspended: bool | None = None,
) -> accounts.Principal:
    """`resolve_principal`, answering each refusal with its own code (see the module notes).

    `allow_suspended` defaults to whether this request only reads (GET or HEAD).
    """
    if allow_suspended is None:
        allow_suspended = request_method() in SAFE_METHODS
    with transaction(engine) as conn:
        try:
            return accounts.resolve_principal(
                conn, claims, workspace_id, allow_suspended=allow_suspended
            )
        except accounts.IdentityError as error:
            raise refusal(error) from error


def _unavailable(message: str = "Sign-in is temporarily unavailable.") -> HTTPException:
    return HTTPException(
        status_code=503, detail={"code": "identity_unavailable", "message": message}
    )


def install_routes(
    app: FastAPI,
    *,
    engine: Engine,
    current_claims: Callable[..., Claims],
    workos: WorkOSClient | None,
    webhook_secret: str = "",
    staff_organization_id: str = "",
    require_workos: bool = False,
) -> None:
    """Mount the identity routes. They are always mounted so each has a flag owner; ones whose
    settings are missing answer 503 rather than disappearing."""
    # Annotated, so the dependency isn't a call in an argument default.
    SignedIn = Annotated[Claims, Depends(current_claims)]

    @app.post("/api/onboarding/complete", status_code=201)
    def complete_onboarding(body: OnboardingRequest, claims: SignedIn):
        identity = None
        if workos is not None:
            try:
                identity = workos.get_user(claims.subject)
            except WorkOSNotFound as error:
                raise HTTPException(
                    status_code=401,
                    detail={"code": "token_invalid", "message": "Sign in again to continue."},
                    headers={"WWW-Authenticate": "Bearer"},
                ) from error
            except WorkOSError as error:
                raise _unavailable() from error
            email, verified = identity.email, identity.email_verified
        elif require_workos:
            raise _unavailable("Account setup is temporarily unavailable.")
        else:
            email, verified = claims.email, claims.email_verified
        if not email or verified is not True:
            raise HTTPException(
                status_code=403,
                detail={"code": "verified_email_required", "message": "Verify your email first."},
            )
        if body.age_confirmed is not True:
            raise HTTPException(
                status_code=400,
                detail={"code": "age_confirmation_required", "minimum_age": 13},
            )
        with transaction(engine) as conn:
            if accounts.is_revoked(conn, claims):
                raise refusal(accounts.SessionRevoked("this session was signed out"))
            try:
                provisioned = accounts.provision(
                    conn, claims, age_confirmed=True, timezone=body.timezone, identity=identity
                )
            except accounts.AccountDeleted as error:
                raise refusal(error) from error
            except accounts.AgeConfirmationRequired as error:
                raise HTTPException(
                    status_code=400, detail={"code": "age_confirmation_required"}
                ) from error
            except ValueError as error:
                raise HTTPException(status_code=400, detail={"code": "invalid_timezone"}) from error
            if provisioned.created:
                # Only a new account starts on Free; repeating onboarding must not undo a plan.
                quota.set_limit(conn, provisioned.workspace.id, plans.plan_for(plans.DEFAULT_PLAN))
        return {
            "user_id": provisioned.user.id,
            "workspace_id": provisioned.workspace.id,
            "plan": "free",
            "created": provisioned.created,
        }

    @app.post("/api/account/sign-out-everywhere")
    def sign_out_everywhere(claims: SignedIn):
        """Revoke every WorkOS session, record their ids and the cut-off. Suspended accounts
        may still do this."""
        principal = principal_or_refusal(engine, claims, allow_suspended=True)
        result = sessions.sign_out_everywhere(
            engine, workos, principal.user.id, actor_id=principal.user.id
        )
        if claims.session_id:
            # This page's own session too, even if WorkOS didn't list it.
            with transaction(engine) as conn:
                sessions.record_revoked(
                    conn,
                    claims.session_id,
                    user_id=principal.user.id,
                    reason=sessions.REASON_SIGN_OUT,
                )
        answer = {
            "revoked_before": result.revoked_before,
            "sessions_revoked": len(result.revoked),
            "message": "Every device is signed out.",
        }
        if result.complete or (workos is None and not require_workos):
            return answer
        raise HTTPException(
            status_code=502,
            detail={
                "code": "sign_out_incomplete",
                "message": "Signed out here, but some devices may stay signed in. Try again.",
                "sessions_not_revoked": len(result.failed),
                "sessions_listed": result.listed,
            },
        )

    @app.delete("/api/account", status_code=202)
    def delete_account(claims: SignedIn):
        """Hide the account, enqueue its durable deletion workflow, and end its sessions."""
        principal = principal_or_refusal(engine, claims, allow_suspended=True)
        try:
            with transaction(engine) as conn:
                plan = accounts.start_account_deletion(
                    conn,
                    principal.user.id,
                    requested_by=principal.user.id,
                    reason="account holder requested deletion",
                )
        except LastOwner as error:
            raise HTTPException(
                status_code=409, detail={"code": "last_owner", "message": str(error)}
            ) from error
        if workos is not None:
            # Best effort: the deletion marker and cut-off already refuse every token.
            try:
                sessions.sign_out_everywhere(
                    engine,
                    workos,
                    principal.user.id,
                    reason=sessions.REASON_ACCOUNT_DELETION,
                    actor_id=principal.user.id,
                )
            except Exception as problem:  # the deletion itself succeeded; just say so
                logger.warning(
                    "WorkOS sessions not revoked on deletion (%s)", type(problem).__name__
                )
        return {
            "status": "deletion_queued",
            "erase_after": plan.erase_after,
            "backups_clear_by": plan.backups_clear_by,
        }

    @app.post("/api/webhooks/workos")
    async def workos_webhook(request: Request):
        """Verify, store once, and act on a WorkOS event (§7A.4)."""
        if not webhook_secret:
            raise HTTPException(status_code=503, detail={"code": "webhook_unconfigured"})
        raw = await request.body()
        if len(raw) > MAX_WEBHOOK_BYTES:
            raise HTTPException(status_code=413, detail={"code": "webhook_too_large"})
        try:
            signed = workos_signature.verify_signature(
                raw, request.headers.get(workos_signature.HEADER), webhook_secret
            )
            event = workos_events.parse(raw)
        except workos_signature.SignatureError as error:
            raise HTTPException(status_code=400, detail={"code": error.reason}) from error
        except workos_events.MalformedEvent as error:
            raise HTTPException(status_code=400, detail={"code": "invalid_event"}) from error
        if workos is None:
            raise _unavailable("WorkOS isn't configured, so events can't be checked.")

        def fresh(now: float) -> None:
            workos_signature.check_freshness(signed, now)

        try:
            outcome = await run_in_threadpool(
                workos_events.deliver, engine, workos, event, fresh=fresh
            )
        except workos_signature.SignatureError as error:
            raise HTTPException(status_code=400, detail={"code": error.reason}) from error
        if outcome.retry:
            raise HTTPException(
                status_code=503, detail={"code": "retry_later", "status": outcome.status}
            )
        return {"status": outcome.status, "duplicate": outcome.status == "duplicate"}

    @app.post("/api/admin/session", status_code=201)
    def start_admin_session(claims: SignedIn):
        """Enter the admin console: a fresh staff-organization token becomes a privileged
        session of at most an hour (§7A.5)."""
        refused: privileged.PrivilegedSessionRefused | None = None
        with transaction(engine) as conn:
            try:
                session = privileged.start(
                    conn, claims, staff_organization_id=staff_organization_id
                )
            except privileged.PrivilegedSessionRefused as error:
                refused = error  # leave the block normally so the refusal's audit commits
            except accounts.IdentityError as error:
                raise refusal(error) from error
        if refused is not None:
            status = {"staff_console_unconfigured": 503, "fresh_sign_in_required": 401}.get(
                refused.code, 403
            )
            raise HTTPException(
                status_code=status, detail={"code": refused.code, "message": str(refused)}
            )
        return {
            "id": session.id,
            "issued_at": session.issued_at,
            "mfa_at": session.mfa_at,
            "expires_at": session.expires_at,
        }


__all__ = [
    "REQUEST_METHOD",
    "SAFE_METHODS",
    "OnboardingRequest",
    "install_routes",
    "principal_or_refusal",
    "refusal",
    "request_method",
]
