"""A local identity provider for `dev.cmd cloud`: real sign-up and sign-in without WorkOS.

It answers the same two conversations WorkOS AuthKit does, so nothing in the site or the API is
swapped out:

- the browser side the real `@workos-inc/authkit-react` library speaks: `GET
  /user_management/authorize` (with PKCE), the hosted pages, `POST /user_management/authenticate`
  (authorization code and refresh token grants) and `GET /user_management/sessions/logout`;
- the server side the Cloud API speaks (`identity.workos.WorkOSClient`): read a user, list and
  revoke their sessions, delete them; plus the signing keys at `/sso/jwks/{client_id}` that the
  API's real token verifier fetches.

Access tokens are RS256 JWTs signed with a key kept in the data folder, so the API checks them
exactly as it checks AuthKit's. Changes the API must hear about (an email verified, a password
reset, a session ended) are sent as signed WorkOS webhooks to the API's real webhook route.

Emails are never sent: they land in the local inbox at `/dev/mail` (and on the console), where a
developer clicks the verification or reset link. "Continue with Google" is a pretend chooser that
makes a verified test identity. Everything lives in `identity.sqlite`, so accounts survive restarts.

Dev only: `create_identity_app` calls `guard.require_development()` first.
"""

from __future__ import annotations

import base64
import hashlib
import json
import re
import secrets
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass
from html import escape
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlencode, urlsplit

import httpx
import jwt
from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse, Response
from jwt.algorithms import RSAAlgorithm

from selecta.devstack import guard
from selecta.devstack.identity_store import MIN_PASSWORD, IdentityStore, Person, iso
from selecta.devstack.pages import page
from selecta.identity import workos_signature

GOOGLE = "GoogleOAuth"
TOKEN_SECONDS = 600
EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
BASE = "/user_management"


@dataclass(frozen=True)
class IdentityConfig:
    folder: Path
    base_url: str  # this provider's own origin, e.g. http://127.0.0.1:8742
    client_id: str
    site_origins: tuple[str, ...]
    webhook_url: str = ""
    webhook_secret: str = ""
    echo_mail: bool = True

    @property
    def issuer(self) -> str:
        return f"{self.base_url}{BASE}/{self.client_id}"


def b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


async def form(request: Request) -> dict[str, str]:
    fields = parse_qs((await request.body()).decode(), keep_blank_values=True)
    return {name: values[0] for name, values in fields.items()}


class LocalIdentity:
    """The provider's behaviour, separate from HTTP so tests and the seeder can call it."""

    def __init__(self, config: IdentityConfig, *, post: Callable[..., Any] | None = None) -> None:
        self.config = config
        self.store = IdentityStore(config.folder)
        self._post = post or httpx.post

    # -- tokens -------------------------------------------------------------------------------

    def jwks(self) -> dict[str, Any]:
        jwk = json.loads(RSAAlgorithm.to_jwk(self.store.private_key.public_key()))
        return {"keys": [{**jwk, "kid": self.store.kid, "use": "sig", "alg": "RS256"}]}

    def access_token(self, person: Person, session_id: str) -> str:
        now = int(time.time())
        payload = {
            "iss": self.config.issuer,
            "sub": person.id,
            "aud": self.config.client_id,
            "sid": session_id,
            "iat": now,
            "exp": now + TOKEN_SECONDS,
            "jti": secrets.token_hex(8),
        }
        return jwt.encode(
            payload, self.store.private_key, algorithm="RS256", headers={"kid": self.store.kid}
        )

    def answer(self, person: Person, session_id: str, refresh: str, method: str) -> dict:
        return {
            "user": person.as_workos(),
            "organization_id": None,
            "access_token": self.access_token(person, session_id),
            "refresh_token": refresh,
            "authentication_method": method,
        }

    def exchange(self, body: dict[str, Any]) -> tuple[int, dict[str, Any]]:
        if body.get("client_id") != self.config.client_id:
            return 400, {"error": "invalid_client", "error_description": "Unknown client."}
        grant = body.get("grant_type")
        if grant == "authorization_code":
            taken = self.store.take_code(str(body.get("code", "")))
            if taken is None:
                return 400, {"error": "invalid_grant", "error_description": "Unknown code."}
            person_id, request, method = taken
            verifier = str(body.get("code_verifier", ""))
            challenge = b64url(hashlib.sha256(verifier.encode()).digest())
            if challenge != request.get("code_challenge"):
                return 400, {"error": "invalid_grant", "error_description": "PKCE mismatch."}
            person = self.store.person(person_id)
            if person is None:
                return 400, {"error": "invalid_grant", "error_description": "No such user."}
            session_id, refresh = self.store.start_session(person.id, method)
            return 200, self.answer(person, session_id, refresh, method)
        if grant == "refresh_token":
            rotated = self.store.rotate(str(body.get("refresh_token", "")))
            if rotated is None:
                return 400, {"error": "invalid_grant", "error_description": "Session has ended."}
            person_id, session_id, refresh, method = rotated
            person = self.store.person(person_id)
            if person is None:
                return 400, {"error": "invalid_grant", "error_description": "No such user."}
            return 200, self.answer(person, session_id, refresh, method)
        return 400, {"error": "unsupported_grant_type", "error_description": "Unsupported."}

    # -- email --------------------------------------------------------------------------------

    def mail(self, to: str, subject: str, text: str, link: str | None) -> None:
        self.store.send_mail(to, subject, text, link)
        if self.config.echo_mail:
            print(f"[MAIL] To {to}: {subject}" + (f" -> {link}" if link else ""), flush=True)

    def send_verification(self, person: Person) -> str:
        token = self.store.new_link("verify", person.id)
        link = f"{self.config.base_url}{BASE}/hosted/verify?token={token}"
        self.mail(
            person.email,
            "Verify your email for SelectaDJ",
            "Welcome to SelectaDJ. Confirm this is your email address to finish setting up "
            "your account.",
            link,
        )
        return link

    def send_reset(self, person: Person) -> str:
        token = self.store.new_link("reset", person.id)
        link = f"{self.config.base_url}{BASE}/hosted/reset?token={token}"
        self.mail(
            person.email,
            "Reset your SelectaDJ password",
            "Someone asked to reset the password for this SelectaDJ account. If it was you, "
            "choose a new password. If not, ignore this email.",
            link,
        )
        return link

    # -- webhooks to the Cloud API ------------------------------------------------------------

    def notify(self, kind: str, data: dict[str, Any]) -> None:
        """Send a signed WorkOS event to the API in the background, retrying for a minute."""
        if not (self.config.webhook_url and self.config.webhook_secret):
            return
        event = {
            "id": f"event_{secrets.token_hex(10)}",
            "event": kind,
            "data": data,
            "created_at": iso(time.time()),
        }

        def deliver() -> None:
            for attempt in range(12):
                raw = json.dumps(event).encode()
                stamp = str(int(time.time() * 1000))
                signature = workos_signature.expected_signature(
                    raw, stamp, self.config.webhook_secret
                )
                try:
                    answer = self._post(
                        self.config.webhook_url,
                        content=raw,
                        headers={
                            "Content-Type": "application/json",
                            workos_signature.HEADER: f"t={stamp}, v1={signature}",
                        },
                        timeout=10,
                    )
                    if answer.status_code < 500:
                        return
                except httpx.HTTPError:
                    pass
                time.sleep(min(5.0, 0.5 * (attempt + 1)))

        threading.Thread(target=deliver, name=f"webhook-{kind}", daemon=True).start()

    # -- people (also used by the seeder) -----------------------------------------------------

    def sign_up(self, email: str, password: str, *, verified: bool = False) -> Person:
        person = self.store.create(email, password, verified=verified)
        if not verified:
            self.send_verification(person)
        return person

    def verify(self, token: str) -> Person | None:
        owner = self.store.use_link("verify", token)
        if owner is None:
            return None
        self.store.mark_verified(owner)
        self.notify("email_verification.succeeded", {"user_id": owner})
        return self.store.person(owner)

    def reset_password(self, token: str, password: str) -> Person | None:
        owner = self.store.use_link("reset", token)
        if owner is None:
            return None
        self.store.set_password(owner, password)
        # WorkOS then tells the API, which signs this person out of every other session.
        self.notify("password_reset.succeeded", {"user_id": owner, "created_at": iso(time.time())})
        return self.store.person(owner)

    def site_allows(self, url: str) -> bool:
        parts = urlsplit(url)
        return f"{parts.scheme}://{parts.netloc}" in self.config.site_origins

    def home(self) -> str:
        return self.config.site_origins[0] + "/"


def _hidden(request_id: str) -> str:
    return f"<input type='hidden' name='request' value='{escape(request_id)}'>"


def sign_in_page(request_id: str, *, email: str = "", problem: str = "", status: int = 200):
    google = f"{BASE}/hosted/google?request={escape(request_id)}"
    alert = f"<p class='problem' role='alert'>{escape(problem)}</p>" if problem else ""
    return page(
        "Sign in to SelectaDJ",
        f"""{alert}
<form method="post" action="{BASE}/hosted/sign-in">{_hidden(request_id)}
  <label>Email <input name="email" type="email" autocomplete="email" required
    value="{escape(email)}"></label>
  <label>Password <input name="password" type="password" autocomplete="current-password"
    required></label>
  <button class="primary">Sign in</button>
</form>
<p class="row"><a href="{BASE}/hosted/forgot?request={escape(request_id)}">Forgot password?</a>
<a href="{BASE}/hosted/sign-up?request={escape(request_id)}">Create an account</a></p>
<div class="divider">or</div>
<p><a class="button" href="{google}">Continue with Google (pretend)</a></p>""",
        status=status,
    )


def sign_up_page(request_id: str, *, email: str = "", problem: str = "", status: int = 200):
    google = f"{BASE}/hosted/google?request={escape(request_id)}"
    alert = f"<p class='problem' role='alert'>{escape(problem)}</p>" if problem else ""
    return page(
        "Create your SelectaDJ account",
        f"""{alert}
<form method="post" action="{BASE}/hosted/sign-up">{_hidden(request_id)}
  <label>Email <input name="email" type="email" autocomplete="email" required
    value="{escape(email)}"></label>
  <label>Password <input name="password" type="password" autocomplete="new-password"
    minlength="{MIN_PASSWORD}" required></label>
  <label class="check"><input type="checkbox" name="age" value="yes" required>
    I'm at least 13 years old.</label>
  <label class="check"><input type="checkbox" name="terms" value="yes" required>
    I agree to the SelectaDJ Terms of Service and Privacy Notice.</label>
  <button class="primary">Create account</button>
</form>
<p><a href="{BASE}/hosted/sign-in?request={escape(request_id)}">I already have an account</a></p>
<div class="divider">or</div>
<p><a class="button" href="{google}">Continue with Google (pretend)</a></p>""",
        status=status,
    )


def expired() -> HTMLResponse:
    return page(
        "This sign-in link has expired",
        "<p>Go back to SelectaDJ and choose Sign in again.</p>",
        status=400,
    )


def create_identity_app(config: IdentityConfig, *, host: str = "127.0.0.1") -> FastAPI:
    guard.require_development(host=host)
    provider = LocalIdentity(config)
    app = FastAPI(title="SelectaDJ local identity (development only)", docs_url=None)
    app.state.provider = provider
    store = provider.store

    def back(request_id: str, person: Person, method: str) -> Response:
        try:
            code, query = store.issue_code(request_id, person.id, method)
        except LookupError:
            return expired()
        target = query["redirect_uri"]
        extra = {"code": code} | ({"state": query["state"]} if query.get("state") else {})
        joiner = "&" if "?" in target else "?"
        return RedirectResponse(f"{target}{joiner}{urlencode(extra)}", status_code=303)

    # -- AuthKit, browser side ------------------------------------------------------------------

    @app.get(BASE + "/authorize")
    def authorize(request: Request):
        query = dict(request.query_params)
        problems = []
        if query.get("client_id") != config.client_id:
            problems.append("unknown client_id")
        redirect = query.get("redirect_uri", "")
        if redirect.rstrip("/") not in config.site_origins:
            problems.append("redirect_uri is not this site")
        if query.get("response_type") != "code":
            problems.append("response_type must be code")
        if query.get("code_challenge_method") != "S256" or not query.get("code_challenge"):
            problems.append("a PKCE S256 challenge is required")
        if query.get("provider", "authkit") not in ("authkit", GOOGLE):
            problems.append("unknown provider")
        if problems:
            return page("Sign-in request refused", f"<p>{escape('; '.join(problems))}</p>", status=400)
        request_id = store.remember_request(query)
        if query.get("provider") == GOOGLE:
            return RedirectResponse(f"{BASE}/hosted/google?request={request_id}", status_code=303)
        if query.get("screen_hint") == "sign-up":
            return sign_up_page(request_id)
        return sign_in_page(request_id, email=query.get("login_hint", ""))

    @app.get(BASE + "/hosted/sign-in")
    def sign_in_form(request: str = ""):
        return sign_in_page(request) if store.request(request) else expired()

    @app.get(BASE + "/hosted/sign-up")
    def sign_up_form(request: str = ""):
        return sign_up_page(request) if store.request(request) else expired()

    @app.post(BASE + "/hosted/sign-in")
    async def sign_in(posted: Request):
        fields = await form(posted)
        request_id, email = fields.get("request", ""), fields.get("email", "").strip()
        if store.request(request_id) is None:
            return expired()
        person = store.check_password(email, fields.get("password", ""))
        if person is None:
            return sign_in_page(
                request_id, email=email, problem="Incorrect email or password.", status=400
            )
        return back(request_id, person, "Password")

    @app.post(BASE + "/hosted/sign-up")
    async def sign_up(posted: Request):
        fields = await form(posted)
        request_id, email = fields.get("request", ""), fields.get("email", "").strip()
        password = fields.get("password", "")
        if store.request(request_id) is None:
            return expired()
        problem = ""
        if not EMAIL.match(email):
            problem = "Enter a valid email address."
        elif len(password) < MIN_PASSWORD:
            problem = f"Use a password of at least {MIN_PASSWORD} characters."
        elif fields.get("age") != "yes":
            problem = "Confirm that you're at least 13 years old."
        elif fields.get("terms") != "yes":
            problem = "Agree to the Terms of Service and Privacy Notice to continue."
        elif store.by_email(email) is not None:
            problem = "An account already exists for this email. Sign in instead."
        if problem:
            return sign_up_page(request_id, email=email, problem=problem, status=400)
        person = provider.sign_up(email, password)
        return back(request_id, person, "Password")

    @app.get(BASE + "/hosted/google")
    def google_form(request: str = ""):
        if store.request(request) is None:
            return expired()
        return page(
            "Choose a Google account",
            f"""<p class="soft">Pretend Google: no Google account is used. Any email makes a
verified test identity.</p>
<form method="post" action="{BASE}/hosted/google">{_hidden(request)}
  <label>Name <input name="name" type="text" value="Test Listener" autocomplete="name"></label>
  <label>Google email <input name="email" type="email" required
    value="google.listener@example.test"></label>
  <button class="primary">Continue</button>
</form>""",
        )

    @app.post(BASE + "/hosted/google")
    async def google(posted: Request):
        fields = await form(posted)
        request_id, email = fields.get("request", ""), fields.get("email", "").strip()
        if store.request(request_id) is None:
            return expired()
        if not EMAIL.match(email):
            return page("Choose a Google account", "<p class='problem'>Enter an email.</p>", 400)
        # As WorkOS does: Google vouches for the email, so an existing account with it is linked
        # (and counts as verified); otherwise a new verified identity is made.
        person = store.by_email(email)
        if person is not None and not person.email_verified:
            store.mark_verified(person.id)
            person = store.person(person.id)
        if person is None:
            person = store.create(
                email, None, verified=True, first_name=fields.get("name") or None
            )
        assert person is not None
        return back(request_id, person, GOOGLE)

    @app.get(BASE + "/hosted/forgot")
    def forgot_form(request: str = ""):
        return page(
            "Reset your password",
            f"""<p>Enter your account's email and we'll send a link to choose a new password.</p>
<form method="post" action="{BASE}/hosted/forgot">{_hidden(request)}
  <label>Email <input name="email" type="email" autocomplete="email" required></label>
  <button class="primary">Send reset link</button>
</form>""",
        )

    @app.post(BASE + "/hosted/forgot")
    async def forgot(posted: Request):
        email = (await form(posted)).get("email", "").strip()
        person = store.by_email(email) if email else None
        if person is not None:
            provider.send_reset(person)
        # The same words whether or not the account exists.
        return page(
            "Check your email",
            "<p>If an account exists for that address, we've sent a link to reset its "
            "password.</p><p class='soft'>Local development: open the inbox at "
            "<a href='/dev/mail'>/dev/mail</a>.</p>",
        )

    @app.get(BASE + "/hosted/reset")
    def reset_form(token: str = ""):
        if store.link_owner("reset", token) is None:
            return page(
                "This reset link has expired",
                "<p>Ask for a new one from the sign-in page.</p>",
                status=400,
            )
        return page(
            "Choose a new password",
            f"""<form method="post" action="{BASE}/hosted/reset">
  <input type="hidden" name="token" value="{escape(token)}">
  <label>New password <input name="password" type="password" autocomplete="new-password"
    minlength="{MIN_PASSWORD}" required></label>
  <button class="primary">Change password</button>
</form>""",
        )

    @app.post(BASE + "/hosted/reset")
    async def reset(posted: Request):
        fields = await form(posted)
        token, password = fields.get("token", ""), fields.get("password", "")
        if len(password) < MIN_PASSWORD:
            return page(
                "Choose a new password",
                f"<p class='problem' role='alert'>Use at least {MIN_PASSWORD} characters.</p>"
                f"<p><a href='{BASE}/hosted/reset?token={escape(token)}'>Try again</a></p>",
                status=400,
            )
        if provider.reset_password(token, password) is None:
            return page(
                "This reset link has expired",
                "<p>Ask for a new one from the sign-in page.</p>",
                status=400,
            )
        return page(
            "Password changed",
            "<p class='ok'>Your password is changed and your other sessions are signed out.</p>"
            f"<p><a class='button primary' href='{escape(provider.home())}'>"
            "Return to SelectaDJ</a></p>",
        )

    @app.get(BASE + "/hosted/verify")
    def verify(token: str = ""):
        person = provider.verify(token)
        if person is None:
            return page(
                "This verification link has expired",
                "<p>Sign in to SelectaDJ to get a new one.</p>",
                status=400,
            )
        return page(
            "Email verified",
            f"<p class='ok'>{escape(person.email)} is verified.</p>"
            "<p>Go back to SelectaDJ and choose I've verified my email.</p>"
            f"<p><a class='button primary' href='{escape(provider.home())}'>"
            "Return to SelectaDJ</a></p>",
        )

    def cors(request: Request, response: Response) -> Response:
        origin = request.headers.get("origin", "")
        if origin in config.site_origins:
            response.headers["Access-Control-Allow-Origin"] = origin
            response.headers["Access-Control-Allow-Credentials"] = "true"
            response.headers["Access-Control-Allow-Headers"] = "Content-Type, Accept"
            response.headers["Access-Control-Allow-Methods"] = "POST"
            response.headers["Vary"] = "Origin"
        return response

    @app.options(BASE + "/authenticate")
    def preflight(request: Request):
        return cors(request, Response(status_code=204))

    @app.post(BASE + "/authenticate")
    async def authenticate(request: Request):
        try:
            body = json.loads(await request.body() or b"{}")
        except ValueError:
            body = {}
        status, answer = provider.exchange(body if isinstance(body, dict) else {})
        return cors(request, JSONResponse(answer, status_code=status))

    @app.get(BASE + "/sessions/logout")
    def logout(session_id: str = "", return_to: str = ""):
        found = store.session(session_id)
        if found is not None and store.end_session(session_id):
            provider.notify("session.revoked", {"id": session_id, "user_id": found["person_id"]})
        target = return_to if return_to and provider.site_allows(return_to) else provider.home()
        return RedirectResponse(target, status_code=303)

    # -- WorkOS User Management API, server side ------------------------------------------------

    def authorised(request: Request) -> bool:
        return request.headers.get("authorization", "") == f"Bearer {guard.LOCAL_WORKOS_KEY}"

    def refused() -> JSONResponse:
        return JSONResponse({"message": "Unauthorized"}, status_code=401)

    @app.get(BASE + "/users/{user_id}")
    def get_user(user_id: str, request: Request):
        if not authorised(request):
            return refused()
        person = store.person(user_id)
        if person is None:
            return JSONResponse({"message": "User not found"}, status_code=404)
        return person.as_workos()

    @app.delete(BASE + "/users/{user_id}")
    def delete_user(user_id: str, request: Request):
        if not authorised(request):
            return refused()
        if not store.delete(user_id):
            return JSONResponse({"message": "User not found"}, status_code=404)
        return Response(status_code=204)

    @app.get(BASE + "/users/{user_id}/sessions")
    def list_sessions(user_id: str, request: Request):
        if not authorised(request):
            return refused()
        if store.person(user_id) is None:
            return JSONResponse({"message": "User not found"}, status_code=404)
        data = [
            {
                "object": "session",
                "id": row["id"],
                "user_id": row["person_id"],
                "status": "active" if row["status"] == "active" else "inactive",
                "created_at": iso(row["created_at"]),
            }
            for row in store.sessions(user_id)
        ]
        return {"object": "list", "data": data, "list_metadata": {"before": None, "after": None}}

    @app.post(BASE + "/sessions/revoke")
    async def revoke(request: Request):
        if not authorised(request):
            return refused()
        try:
            body = json.loads(await request.body() or b"{}")
        except ValueError:
            body = {}
        session_id = str(body.get("session_id", "")) if isinstance(body, dict) else ""
        if store.session(session_id) is None:
            return JSONResponse({"message": "Session not found"}, status_code=404)
        store.end_session(session_id)
        return Response(status_code=204)

    @app.get("/sso/jwks/{client_id}")
    def jwks(client_id: str):
        if client_id != config.client_id:
            return JSONResponse({"message": "Unknown client"}, status_code=404)
        return provider.jwks()

    # -- the local inbox ------------------------------------------------------------------------

    @app.get("/dev/mail", response_class=HTMLResponse)
    def inbox(to: str = ""):
        letters = store.mail(to or None)
        rows = "".join(
            "<tr>"
            f"<td>{escape(time.strftime('%H:%M:%S', time.localtime(item['created_at'])))}</td>"
            f"<td>{escape(item['to_address'])}</td>"
            f"<td><strong>{escape(item['subject'])}</strong><pre>{escape(item['body'])}</pre>"
            + (
                f"<p><a class='button primary' href='{escape(item['link'])}'>"
                f"{'Verify email' if 'verify' in item['link'] else 'Choose a new password'}"
                "</a></p>"
                if item["link"]
                else ""
            )
            + "</td></tr>"
            for item in letters
        )
        table = (
            f"<table><thead><tr><th>Time</th><th>To</th><th>Message</th></tr></thead>"
            f"<tbody>{rows}</tbody></table>"
            if letters
            else "<p class='soft'>No emails yet. Sign up or ask for a password reset.</p>"
        )
        return page(
            "Local inbox",
            "<p class='soft'>Every email SelectaDJ sends on this computer lands here. Nothing "
            "is delivered anywhere.</p>"
            "<p class='row'><a class='button' href='/dev/mail'>Refresh</a></p>" + table,
            wide=True,
        )

    @app.get("/dev/mail.json")
    def inbox_json(to: str = ""):
        return {"messages": store.mail(to or None)}

    @app.get("/dev/identity/health")
    def health():
        return {"service": "selecta-local-identity", "status": "ok"}

    return app


__all__ = ["GOOGLE", "IdentityConfig", "LocalIdentity", "create_identity_app"]
