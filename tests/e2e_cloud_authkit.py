"""A fake AuthKit for the cloud browser tests (tests/e2e_cloud_server.py). Never part of the app.

The everyday cloud build swaps the AuthKit library for a stand-in (web/e2e-cloud/fakeAuthKit.tsx).
The sign-in redirect test (web/e2e-cloud/sign-in.cloud.ts, SC-0400-05) instead runs the real
`@workos-inc/authkit-react` (build: web/vite.cloud-e2e-authkit.config.ts, served by the test
server at `http://localhost:<port>`) against this fake of AuthKit's side, which answers what the
real library asks of `https://auth.e2e.test`. The browser test routes that host here, under
`/fake-authkit`:

- `GET /user_management/authorize`: checks the client id, redirect URI, PKCE challenge and
  response type, logs the request, and shows the hosted sign-in or sign-up page (`screen_hint`);
  `provider=GoogleOAuth` shows a fake Google account chooser instead.
- the hosted pages: sign in, sign up (the new account's email starts unverified), "Forgot
  password?" (the same answer whether or not an account exists; a known address gets a
  one-time link to choose a new password), and Google, which links to an
  existing account only when Google vouches for the email, as WorkOS does.
- `POST /user_management/authenticate`: exchanges a one-time code for the user and an access
  token after checking the PKCE verifier. Tokens are JWT-shaped (the library reads `exp`, `iat`
  and `sid` from them), and the test server's verifier accepts exactly the ones issued here.

Test controls: `GET /test/authkit/log` (every authorize request and reset asked for),
`GET /test/authkit/reset-link?email=` (the reset link "emailed" to that address),
`POST /test/authkit/verify {"email"}` (the person clicked the verification link) and
`DELETE /test/authkit` (forget everything).
"""

from __future__ import annotations

import base64
import hashlib
import json
import secrets
import time
from html import escape
from typing import Any
from urllib.parse import parse_qs, urlencode

from fastapi import Body, FastAPI, Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse, Response

from selecta.identity.tokens import Claims

CLIENT_ID = "client_e2e"
AUTH_HOST = "auth.e2e.test"
PREFIX = "/fake-authkit"
ISSUER = f"https://{AUTH_HOST}"
GOOGLE = "GoogleOAuth"


def b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


class FakeAuthKit:
    """AuthKit's accounts, pending sign-ins, codes and tokens, in memory."""

    def __init__(self, site_origin: str) -> None:
        self.site_origin = site_origin
        self.reset()

    def reset(self) -> None:
        self.accounts: dict[str, dict[str, Any]] = {}  # by email
        self.requests: dict[str, dict[str, str]] = {}  # pending authorize requests, by id
        self.codes: dict[str, dict[str, Any]] = {}
        self.tokens: dict[str, Claims] = {}
        self.log: list[dict[str, Any]] = []
        self.resets: dict[str, str] = {}  # one-time reset tokens, to the account's email

    # -- accounts --------------------------------------------------------------------------

    def account(self, email: str, *, verified: bool, password: str | None = None) -> dict:
        found = self.accounts.get(email)
        if found is None:
            found = {
                "id": f"user_{secrets.token_hex(6)}",
                "email": email,
                "verified": verified,
                "password": password,
            }
            self.accounts[email] = found
        return found

    # -- the OAuth side --------------------------------------------------------------------

    def code_for(self, request_id: str, account: dict, method: str) -> str:
        request = self.requests.pop(request_id)
        code = f"code_{secrets.token_hex(12)}"
        self.codes[code] = {"account": account, "request": request, "method": method}
        query = {"code": code} | ({"state": request["state"]} if request.get("state") else {})
        return f"{request['redirect_uri']}?{urlencode(query)}"

    def access_token(self, account: dict) -> str:
        now = int(time.time())
        payload = {
            "sid": f"session_{secrets.token_hex(6)}",
            "iss": ISSUER,
            "sub": account["id"],
            "exp": now + 3600,
            "iat": now,
            "jti": secrets.token_hex(8),
        }
        header = {"alg": "none", "typ": "JWT"}
        token = ".".join(
            [
                b64url(json.dumps(header).encode()),
                b64url(json.dumps(payload).encode()),
                b64url(secrets.token_bytes(16)),
            ]
        )
        self.tokens[token] = Claims(
            subject=account["id"],
            issued_at=now,
            expires_at=now + 3600,
            email=account["email"],
            email_verified=account["verified"],
            session_id=payload["sid"],
        )
        return token

    def exchange(self, body: dict[str, Any]) -> tuple[int, dict[str, Any]]:
        if body.get("client_id") != CLIENT_ID:
            return 400, {"error": "invalid_client", "error_description": "Unknown client."}
        if body.get("grant_type") != "authorization_code":
            return 400, {"error": "invalid_grant", "error_description": "No session."}
        issued = self.codes.pop(str(body.get("code")), None)
        if issued is None:
            return 400, {"error": "invalid_grant", "error_description": "Unknown code."}
        challenge = b64url(hashlib.sha256(str(body.get("code_verifier")).encode()).digest())
        if challenge != issued["request"]["code_challenge"]:
            return 400, {"error": "invalid_grant", "error_description": "PKCE mismatch."}
        account = issued["account"]
        stamp = "2026-11-10T00:00:00.000Z"
        return 200, {
            "user": {
                "object": "user",
                "id": account["id"],
                "email": account["email"],
                "email_verified": account["verified"],
                "first_name": None,
                "last_name": None,
                "profile_picture_url": None,
                "last_sign_in_at": stamp,
                "created_at": stamp,
                "updated_at": stamp,
            },
            "access_token": self.access_token(account),
            "refresh_token": f"rt_{secrets.token_hex(8)}",
            "authentication_method": issued["method"],
        }


def page(title: str, body: str, status: int = 200) -> HTMLResponse:
    return HTMLResponse(
        f"<!doctype html><html lang='en'><head><meta charset='utf-8'><title>{escape(title)}"
        f"</title></head><body><main><p>AuthKit (fake)</p><h1>{escape(title)}</h1>{body}"
        "</main></body></html>",
        status_code=status,
    )


async def form(request: Request) -> dict[str, str]:
    """A posted HTML form's fields (the test server has no multipart parser, and needs none)."""
    fields = parse_qs((await request.body()).decode(), keep_blank_values=True)
    return {name: values[0] for name, values in fields.items()}


def install(app: FastAPI, authkit: FakeAuthKit) -> None:
    base = PREFIX + "/user_management"

    def cors(request: Request, response: Response) -> Response:
        origin = request.headers.get("origin")
        if origin == authkit.site_origin:
            response.headers["Access-Control-Allow-Origin"] = origin
            response.headers["Access-Control-Allow-Credentials"] = "true"
            response.headers["Access-Control-Allow-Headers"] = "Content-Type, Accept"
            response.headers["Access-Control-Allow-Methods"] = "POST"
            response.headers["Vary"] = "Origin"
        return response

    @app.get(base + "/authorize")
    def authorize(request: Request):
        query = dict(request.query_params)
        authkit.log.append({"kind": "authorize", **query})
        problems = []
        if query.get("client_id") != CLIENT_ID:
            problems.append("unknown client_id")
        if query.get("redirect_uri") not in (authkit.site_origin, authkit.site_origin + "/"):
            problems.append("redirect_uri is not one this client allows")
        if query.get("response_type") != "code":
            problems.append("response_type must be code")
        if query.get("code_challenge_method") != "S256" or not query.get("code_challenge"):
            problems.append("a PKCE S256 challenge is required")
        provider = query.get("provider")
        if provider not in ("authkit", GOOGLE):
            problems.append("unknown provider")
        if problems:
            return page("Sign-in request refused", f"<p>{escape('; '.join(problems))}</p>", 400)
        request_id = secrets.token_hex(8)
        authkit.requests[request_id] = query
        if provider == GOOGLE:
            return page(
                "Choose a Google account",
                f"""
<form method="post" action="/user_management/hosted/google">
  <input type="hidden" name="request" value="{request_id}">
  <label>Google account email <input name="email" type="email" required></label>
  <label><input type="checkbox" name="verified" value="yes" checked> Google has verified this
    email</label>
  <button>Continue</button>
</form>""",
            )
        google = urlencode(
            {key: value for key, value in query.items() if key != "screen_hint"}
            | {"provider": GOOGLE}
        )
        sign_up = query.get("screen_hint") == "sign-up"
        title = "Create your SelectaDJ account" if sign_up else "Sign in to SelectaDJ"
        action = "sign-up" if sign_up else "sign-in"
        return page(
            title,
            f"""
<a href="/user_management/authorize?{escape(google)}">Continue with Google</a>
<form method="post" action="/user_management/hosted/{action}">
  <input type="hidden" name="request" value="{request_id}">
  <label>Email <input name="email" type="email" required></label>
  <label>Password <input name="password" type="password" required></label>
  <button>{"Create account" if sign_up else "Sign in"}</button>
</form>
<a href="/user_management/hosted/reset-password?request={request_id}">Forgot password?</a>""",
        )

    def pending(request_id: str) -> HTMLResponse | None:
        if request_id not in authkit.requests:
            return page("This sign-in link has expired", "<p>Start again.</p>", 400)
        return None

    @app.post(base + "/hosted/sign-up")
    async def sign_up(posted: Request):
        fields = await form(posted)
        request, email, password = fields["request"], fields["email"], fields["password"]
        if (expired := pending(request)) is not None:
            return expired
        if email in authkit.accounts:
            return page("Create your SelectaDJ account", "<p>Sign in instead.</p>", 400)
        account = authkit.account(email, verified=False, password=password)
        return RedirectResponse(authkit.code_for(request, account, "Password"), status_code=303)

    @app.post(base + "/hosted/sign-in")
    async def sign_in(posted: Request):
        fields = await form(posted)
        request, email, password = fields["request"], fields["email"], fields["password"]
        if (expired := pending(request)) is not None:
            return expired
        account = authkit.accounts.get(email)
        if account is None or account["password"] != password:
            return page("Sign in to SelectaDJ", "<p>Incorrect email or password.</p>", 400)
        return RedirectResponse(authkit.code_for(request, account, "Password"), status_code=303)

    @app.post(base + "/hosted/google")
    async def google(posted: Request):
        fields = await form(posted)
        request, email = fields["request"], fields["email"]
        if (expired := pending(request)) is not None:
            return expired
        vouched = fields.get("verified") == "yes"
        existing = authkit.accounts.get(email)
        if existing is not None and vouched:
            # WorkOS links a Google identity to an existing user only by a verified email; the
            # sign-in then counts as verifying it.
            existing["verified"] = True
            account = existing
        else:
            # Not linked: a separate user, keyed by the Google identity, not by the email.
            account = {
                "id": f"user_{secrets.token_hex(6)}",
                "email": email,
                "verified": vouched,
                "password": None,
            }
        return RedirectResponse(authkit.code_for(request, account, GOOGLE), status_code=303)

    @app.get(base + "/hosted/reset-password")
    def reset_form(request: str = ""):
        return page(
            "Reset your password",
            f"""
<form method="post" action="/user_management/hosted/reset-password">
  <input type="hidden" name="request" value="{escape(request)}">
  <label>Email <input name="email" type="email" required></label>
  <button>Send reset link</button>
</form>""",
        )

    @app.post(base + "/hosted/reset-password")
    async def reset_sent(posted: Request):
        email = (await form(posted)).get("email", "")
        # Whether or not an account exists, the same words: the page reveals nothing.
        known = email in authkit.accounts
        authkit.log.append({"kind": "reset", "known": known})
        if known:
            # The "email" a real AuthKit would send: a one-time link, read by the test control.
            authkit.resets[f"reset_{secrets.token_hex(8)}"] = email
        return page(
            "Check your email",
            "<p>If an account exists for that address, we have sent a link to reset "
            "its password.</p>",
        )

    @app.get(base + "/hosted/reset-password/confirm")
    def reset_link(token: str = ""):
        if token not in authkit.resets:
            return page(
                "This reset link has expired",
                "<p>Ask for a new one from the sign-in page.</p>",
                400,
            )
        return page(
            "Choose a new password",
            f"""
<form method="post" action="/user_management/hosted/reset-password/confirm">
  <input type="hidden" name="token" value="{escape(token)}">
  <label>New password <input name="password" type="password" required></label>
  <button>Change password</button>
</form>""",
        )

    @app.post(base + "/hosted/reset-password/confirm")
    async def reset_done(posted: Request):
        fields = await form(posted)
        email = authkit.resets.pop(fields.get("token", ""), None)  # each link works once
        if email is None:
            return page(
                "This reset link has expired",
                "<p>Ask for a new one from the sign-in page.</p>",
                400,
            )
        if len(fields.get("password", "")) < 8:
            authkit.resets[fields["token"]] = email
            return page("Choose a new password", "<p>Use at least 8 characters.</p>", 400)
        authkit.accounts[email]["password"] = fields["password"]
        # WorkOS then sends `password_reset.succeeded`; Selecta revokes the other sessions.
        authkit.log.append({"kind": "password_changed", "user": authkit.accounts[email]["id"]})
        return page("Password changed", "<p>Sign in with your new password.</p>")

    @app.options(base + "/authenticate")
    def preflight(request: Request):
        return cors(request, Response(status_code=204))

    @app.post(base + "/authenticate")
    def authenticate(request: Request, body: dict = Body(default={})):  # noqa: B008
        status, answer = authkit.exchange(body)
        return cors(request, JSONResponse(answer, status_code=status))

    @app.get("/test/authkit/log")
    def log():
        return authkit.log

    @app.get("/test/authkit/reset-link")
    def reset_link_for(email: str = ""):
        """The newest reset link sent to this address, as the person would find it."""
        tokens = [token for token, owner in authkit.resets.items() if owner == email]
        if not tokens:
            return JSONResponse({"link": None}, status_code=404)
        return {"link": f"{base}/hosted/reset-password/confirm?token={tokens[-1]}"}

    @app.post("/test/authkit/verify")
    def verify(body: dict = Body(default={})):  # noqa: B008
        authkit.accounts[str(body["email"])]["verified"] = True
        return {"ok": True}

    @app.delete("/test/authkit")
    def forget():
        authkit.reset()
        return {"ok": True}
