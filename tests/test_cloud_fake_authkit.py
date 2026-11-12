"""Every sign-in path against the fake AuthKit, without a browser (SC-0400-01, SC-0400-05).

`web/e2e-cloud/sign-in.cloud.ts` drives the real AuthKit library through these same pages in a
browser. These tests pin the fake's side on its own, so a change to it that would let a browser
test pass for the wrong reason fails here first: sign-up, password sign-in, Google with and
without a verified email, the code exchange and its PKCE check, and forgot password from the
request to the new password working. The real hosted pages still need the WorkOS staging
walkthrough.
"""

from __future__ import annotations

import base64
import hashlib
import re
import secrets
from urllib.parse import parse_qs, urlencode, urlsplit

import pytest
from e2e_cloud_authkit import CLIENT_ID, GOOGLE, PREFIX, FakeAuthKit, install
from fastapi import FastAPI
from fastapi.testclient import TestClient

SITE = "http://localhost:9042"
BASE = PREFIX + "/user_management"


@pytest.fixture
def kit() -> tuple[TestClient, FakeAuthKit]:
    app = FastAPI()
    authkit = FakeAuthKit(SITE)
    install(app, authkit)
    return TestClient(app, follow_redirects=False), authkit


def pkce() -> tuple[str, str]:
    verifier = secrets.token_urlsafe(32)
    digest = hashlib.sha256(verifier.encode()).digest()
    return verifier, base64.urlsafe_b64encode(digest).rstrip(b"=").decode()


def authorize(client: TestClient, challenge: str, **extra: str):
    query = {
        "client_id": CLIENT_ID,
        "redirect_uri": SITE,
        "response_type": "code",
        "code_challenge": challenge,
        "code_challenge_method": "S256",
        "provider": "authkit",
        **extra,
    }
    return client.get(f"{BASE}/authorize?{urlencode(query)}")


def request_id(page_html: str) -> str:
    found = re.search(r'name="request" value="([0-9a-f]+)"', page_html)
    assert found, page_html
    return found.group(1)


def code_from(response) -> tuple[str, dict[str, list[str]]]:
    assert response.status_code == 303, response.text
    location = urlsplit(response.headers["location"])
    assert f"{location.scheme}://{location.netloc}" == SITE
    query = parse_qs(location.query)
    return query["code"][0], query


def exchange(client: TestClient, code: str, verifier: str, client_id: str = CLIENT_ID):
    return client.post(
        f"{BASE}/authenticate",
        json={
            "client_id": client_id,
            "grant_type": "authorization_code",
            "code": code,
            "code_verifier": verifier,
        },
    )


def sign_up(client: TestClient, email: str, password: str = "correct horse") -> dict:
    verifier, challenge = pkce()
    page = authorize(client, challenge, screen_hint="sign-up")
    assert "Create your SelectaDJ account" in page.text
    posted = client.post(
        f"{BASE}/hosted/sign-up",
        data={"request": request_id(page.text), "email": email, "password": password},
    )
    code, _ = code_from(posted)
    answer = exchange(client, code, verifier)
    assert answer.status_code == 200
    return answer.json()


def sign_in(client: TestClient, email: str, password: str, state: str | None = None):
    verifier, challenge = pkce()
    extra = {"state": state} if state else {}
    page = authorize(client, challenge, **extra)
    assert "Sign in to SelectaDJ" in page.text
    posted = client.post(
        f"{BASE}/hosted/sign-in",
        data={"request": request_id(page.text), "email": email, "password": password},
    )
    return posted, verifier


def google(client: TestClient, email: str, *, verified: bool):
    verifier, challenge = pkce()
    page = authorize(client, challenge, provider=GOOGLE)
    assert "Choose a Google account" in page.text
    data = {"request": request_id(page.text), "email": email}
    if verified:
        data["verified"] = "yes"
    code, _ = code_from(client.post(f"{BASE}/hosted/google", data=data))
    return exchange(client, code, verifier).json()


def test_sign_up_starts_unverified_and_verification_makes_the_next_sign_in_verified(kit):
    client, authkit = kit
    first = sign_up(client, "new@example.test")
    assert first["user"]["email_verified"] is False
    assert first["authentication_method"] == "Password"
    assert authkit.tokens[first["access_token"]].email_verified is False

    assert client.post("/test/authkit/verify", json={"email": "new@example.test"}).json()["ok"]
    posted, verifier = sign_in(client, "new@example.test", "correct horse")
    code, _ = code_from(posted)
    again = exchange(client, code, verifier).json()
    assert again["user"]["id"] == first["user"]["id"]
    assert again["user"]["email_verified"] is True
    claims = authkit.tokens[again["access_token"]]
    assert claims.subject == first["user"]["id"] and claims.session_id.startswith("session_")


def test_signing_up_twice_with_one_email_is_refused(kit):
    client, _ = kit
    sign_up(client, "twice@example.test")
    _, challenge = pkce()
    page = authorize(client, challenge, screen_hint="sign-up")
    posted = client.post(
        f"{BASE}/hosted/sign-up",
        data={"request": request_id(page.text), "email": "twice@example.test", "password": "x"},
    )
    assert posted.status_code == 400 and "Sign in instead" in posted.text


def test_password_sign_in_carries_state_back_and_refuses_a_wrong_password(kit):
    client, _ = kit
    sign_up(client, "back@example.test")
    wrong, _ = sign_in(client, "back@example.test", "not it")
    assert wrong.status_code == 400 and "Incorrect email or password" in wrong.text
    unknown, _ = sign_in(client, "nobody@example.test", "correct horse")
    assert unknown.text == wrong.text  # an unknown address reads the same as a wrong password

    posted, _ = sign_in(client, "back@example.test", "correct horse", state='{"returnTo":"/x"}')
    _, query = code_from(posted)
    assert query["state"] == ['{"returnTo":"/x"}']


def test_google_links_only_by_a_verified_email(kit):
    client, _ = kit
    owner = sign_up(client, "dj@example.test")["user"]["id"]
    vouched = google(client, "dj@example.test", verified=True)
    assert vouched["user"]["id"] == owner
    assert vouched["user"]["email_verified"] is True
    assert vouched["authentication_method"] == GOOGLE

    unvouched = google(client, "dj@example.test", verified=False)
    assert unvouched["user"]["id"] != owner
    assert unvouched["user"]["email_verified"] is False


def test_the_code_exchange_checks_client_pkce_and_one_use(kit):
    client, _ = kit
    verifier, challenge = pkce()
    page = authorize(client, challenge, screen_hint="sign-up")
    code, _ = code_from(
        client.post(
            f"{BASE}/hosted/sign-up",
            data={"request": request_id(page.text), "email": "pkce@example.test", "password": "pw"},
        )
    )
    assert exchange(client, code, verifier, client_id="client_other").status_code == 400
    # The wrong client didn't use the code up; a wrong verifier does.
    assert exchange(client, code, "not-the-verifier").json()["error_description"] == (
        "PKCE mismatch."
    )
    assert exchange(client, code, verifier).json()["error_description"] == "Unknown code."


def test_authorize_refuses_requests_that_are_not_ours(kit):
    client, _ = kit
    _, challenge = pkce()
    for bad in (
        {"client_id": "client_other"},
        {"redirect_uri": "https://evil.test"},
        {"response_type": "token"},
        {"code_challenge_method": "plain"},
        {"provider": "Facebook"},
    ):
        query = {
            "client_id": CLIENT_ID,
            "redirect_uri": SITE,
            "response_type": "code",
            "code_challenge": challenge,
            "code_challenge_method": "S256",
            "provider": "authkit",
        } | bad
        answer = client.get(f"{BASE}/authorize?{urlencode(query)}")
        assert answer.status_code == 400 and "Sign-in request refused" in answer.text


def test_a_hosted_form_used_twice_says_the_link_expired(kit):
    client, _ = kit
    _, challenge = pkce()
    page = authorize(client, challenge, screen_hint="sign-up")
    request = request_id(page.text)
    code_from(
        client.post(
            f"{BASE}/hosted/sign-up",
            data={"request": request, "email": "once@example.test", "password": "pw"},
        )
    )
    again = client.post(
        f"{BASE}/hosted/sign-in",
        data={"request": request, "email": "once@example.test", "password": "pw"},
    )
    assert again.status_code == 400 and "This sign-in link has expired" in again.text


def page_words(html: str) -> str:
    return re.sub(r"<[^>]+>", " ", html)


def test_forgot_password_says_the_same_for_any_email_and_only_a_known_one_gets_a_link(kit):
    client, authkit = kit
    sign_up(client, "forgetful@example.test")
    known = client.post(f"{BASE}/hosted/reset-password", data={"email": "forgetful@example.test"})
    unknown = client.post(f"{BASE}/hosted/reset-password", data={"email": "nobody@example.test"})
    assert known.status_code == unknown.status_code == 200
    assert page_words(known.text) == page_words(unknown.text)
    assert "Check your email" in known.text
    assert [entry["known"] for entry in authkit.log if entry["kind"] == "reset"] == [True, False]
    assert client.get("/test/authkit/reset-link?email=nobody@example.test").status_code == 404
    assert client.get("/test/authkit/reset-link?email=forgetful@example.test").json()["link"]


def test_a_reset_link_sets_a_new_password_once(kit):
    client, authkit = kit
    user = sign_up(client, "reset@example.test", password="old password")["user"]["id"]
    client.post(f"{BASE}/hosted/reset-password", data={"email": "reset@example.test"})
    link = client.get("/test/authkit/reset-link?email=reset@example.test").json()["link"]
    token = parse_qs(urlsplit(link).query)["token"][0]

    form = client.get(link)
    assert form.status_code == 200 and "Choose a new password" in form.text
    short = client.post(
        f"{BASE}/hosted/reset-password/confirm", data={"token": token, "password": "short"}
    )
    assert short.status_code == 400 and "at least 8 characters" in short.text
    done = client.post(
        f"{BASE}/hosted/reset-password/confirm", data={"token": token, "password": "new password"}
    )
    assert done.status_code == 200 and "Password changed" in done.text
    assert authkit.log[-1] == {"kind": "password_changed", "user": user}

    used = client.post(
        f"{BASE}/hosted/reset-password/confirm", data={"token": token, "password": "another one"}
    )
    assert used.status_code == 400 and "This reset link has expired" in used.text
    assert client.get(link).status_code == 400

    old, _ = sign_in(client, "reset@example.test", "old password")
    assert old.status_code == 400
    new, verifier = sign_in(client, "reset@example.test", "new password")
    code, _ = code_from(new)
    assert exchange(client, code, verifier).json()["user"]["id"] == user


def test_forgetting_everything_empties_accounts_resets_and_the_log(kit):
    client, authkit = kit
    sign_up(client, "gone@example.test")
    client.post(f"{BASE}/hosted/reset-password", data={"email": "gone@example.test"})
    assert client.delete("/test/authkit").json() == {"ok": True}
    assert authkit.accounts == {} and authkit.resets == {} and authkit.log == []
