"""Authentication against WorkOS (ADR-0400, SC-0400-05 to -10; spec §7A).

WorkOS is a fake behind `httpx.MockTransport`, driven through the real `WorkOSClient`, so the
client's paging, errors and key handling are exercised too. App tests run on SQLite and, in CI,
on PostgreSQL (`cloud_engine`). Token times use real time so both databases agree on "now".
"""

from __future__ import annotations

import datetime as dt
import json
import logging
import time
import traceback
from dataclasses import replace
from types import SimpleNamespace

import httpx
import pytest
import sqlalchemy as sa
from cloud_helpers import cloud_settings
from fastapi.testclient import TestClient
from sqlalchemy.exc import IntegrityError

from selecta import flags
from selecta.api_cloud import CloudSettings, create_cloud_app
from selecta.authz.check import authorize
from selecta.authz.schema import audit_events, role_assignments
from selecta.identity import accounts, privileged, sessions, workos_signature
from selecta.identity.deletion_effects import (
    AccountDeletionEffects,
    DeletionEffectError,
    WorkOSUserDeleter,
)
from selecta.identity.schema import (
    account_deletion_workflows,
    privileged_sessions,
    revoked_sessions,
    users,
    workos_events,
)
from selecta.identity.tokens import Claims, TokenExpired
from selecta.identity.workos import (
    WorkOSClient,
    WorkOSError,
    WorkOSNotFound,
    WorkOSRateLimited,
    WorkOSServerError,
    WorkOSTransportError,
    WorkOSUnauthorized,
)
from selecta.persistence import new_id, transaction

API_KEY = "sk_test_never_in_a_log_8f3a"
SECRET = "whsec_workos_test"
STAFF_ORG = "org_selecta_staff"
USER = "user_01LISTENER"
API = "https://api.workos.test"


def iso(epoch: float) -> str:
    return dt.datetime.fromtimestamp(epoch, dt.UTC).isoformat().replace("+00:00", "Z")


class FakeWorkOS:
    """WorkOS User Management in memory, served through `httpx.MockTransport`."""

    def __init__(self) -> None:
        self.users: dict[str, dict] = {}
        self.sessions: dict[str, dict] = {}
        self.calls: list[tuple[str, str]] = []
        self.fail: dict[tuple[str, str], int] = {}
        self.page_size = 2

    def add_user(self, user_id=USER, email="listener@example.test", verified=True):
        self.users[user_id] = {
            "object": "user",
            "id": user_id,
            "email": email,
            "email_verified": verified,
            "created_at": iso(time.time() - 3600),
        }

    def add_session(self, sid, user_id=USER, created_at=None, status="active"):
        self.sessions[sid] = {
            "object": "session",
            "id": sid,
            "user_id": user_id,
            "status": status,
            "created_at": iso(created_at or time.time() - 600),
        }

    def handle(self, request: httpx.Request) -> httpx.Response:
        assert request.headers["authorization"] == f"Bearer {API_KEY}"
        method, path = request.method, request.url.path
        self.calls.append((method, path))
        for (fail_method, prefix), status in self.fail.items():
            if method == fail_method and path.startswith(prefix):
                return httpx.Response(status, json={"message": "nope"})
        parts = path.strip("/").split("/")
        if method == "GET" and len(parts) == 4 and parts[3] == "sessions":
            mine = [s for s in self.sessions.values() if s["user_id"] == parts[2]]
            start = int(request.url.params.get("after") or 0)
            page = mine[start : start + self.page_size]
            after = str(start + self.page_size) if start + self.page_size < len(mine) else None
            return httpx.Response(200, json={"data": page, "list_metadata": {"after": after}})
        if method == "GET" and len(parts) == 3:
            found = self.users.get(parts[2])
            return httpx.Response(200, json=found) if found else httpx.Response(404, json={})
        if method == "DELETE" and len(parts) == 3:
            return httpx.Response(202) if self.users.pop(parts[2], None) else httpx.Response(404)
        if method == "POST" and path == "/user_management/sessions/revoke":
            session = self.sessions.get(json.loads(request.content)["session_id"])
            if session is None:
                return httpx.Response(404, json={})
            session["status"] = "revoked"
            return httpx.Response(200, json=session)
        return httpx.Response(400, json={})

    def client(self) -> WorkOSClient:
        return WorkOSClient(API_KEY, api_base=API, transport=httpx.MockTransport(self.handle))

    def count(self, method: str, prefix: str) -> int:
        return sum(1 for m, p in self.calls if m == method and p.startswith(prefix))


class Tokens:
    """A verifier whose tokens the test mints: each token string maps to its claims."""

    def __init__(self) -> None:
        self.claims: dict[str, Claims] = {}

    def issue(self, token, subject=USER, *, sid=None, iat=None, email=None, org=None):
        now = time.time()
        self.claims[token] = Claims(
            subject,
            now if iat is None else iat,
            now + 600,
            email=email,
            email_verified=email is not None,
            session_id=sid,
            organization_id=org,
        )
        return {"Authorization": f"Bearer {token}"}

    def verify(self, token: str) -> Claims:
        if token == "expired":
            raise TokenExpired("expired")
        return self.claims[token]


@pytest.fixture
def world(cloud_engine):
    fake, tokens = FakeWorkOS(), Tokens()
    workos = fake.client()
    settings = replace(
        cloud_settings(),
        workos_webhook_secret=SECRET,
        staff_organization_id=STAFF_ORG,
        require_workos=True,
    )
    app = create_cloud_app(settings, engine=cloud_engine, verifier=tokens, workos=workos)
    with TestClient(app) as http:
        yield SimpleNamespace(http=http, fake=fake, tokens=tokens, engine=cloud_engine)
    workos.close()


def onboard(w, token="first", subject=USER, **claims) -> dict:
    if subject not in w.fake.users:
        w.fake.add_user(subject, f"{subject}@example.test")
    headers = w.tokens.issue(token, subject, **claims)
    answer = w.http.post("/api/onboarding/complete", headers=headers, json={"age_confirmed": True})
    assert answer.status_code == 201, answer.text
    return answer.json()


def user_row(w, subject=USER):
    with w.engine.connect() as conn:
        return conn.execute(sa.select(users).where(users.c.auth_subject == subject)).first()


def deliver(w, event_type, data, *, event_id=None, t=None, raw=None):
    event = {"id": event_id or f"event_{new_id()}", "event": event_type, "data": data}
    body = raw if raw is not None else json.dumps(event).encode()
    stamp = int(time.time() * 1000) if t is None else t
    header = workos_signature.sign(json.dumps(event).encode(), SECRET, stamp)
    return w.http.post("/api/webhooks/workos", content=body, headers={"WorkOS-Signature": header})


def event_rows(w):
    with w.engine.connect() as conn:
        return conn.execute(sa.select(workos_events.c.event_id, workos_events.c.status)).all()


# ---- webhook signatures


def test_a_valid_signature_is_accepted_with_milliseconds_or_seconds():
    body, now = b'{"id":"e1"}', time.time()
    for stamp in (int(now * 1000), int(now)):
        sent = workos_signature.verify(
            body, workos_signature.sign(body, SECRET, stamp), SECRET, now
        )
        assert abs(sent - now) < 1.5


def test_a_tampered_body_or_wrong_secret_is_refused():
    body, now = b'{"id":"e1"}', time.time()
    header = workos_signature.sign(body, SECRET, int(now * 1000))
    for args in ((b'{"id":"e2"}', header, SECRET), (body, header, "whsec_other")):
        with pytest.raises(workos_signature.SignatureError) as refused:
            workos_signature.verify(*args, now)
        assert refused.value.reason == "signature_mismatch"
    with pytest.raises(workos_signature.SignatureError, match="secret"):
        workos_signature.verify(body, header, "", now)


@pytest.mark.parametrize("offset", [-301, 301])
@pytest.mark.parametrize("unit", [1, 1000])
def test_a_timestamp_more_than_five_minutes_old_or_ahead_is_refused(offset, unit):
    body, now = b"{}", 1_800_000_000.0
    stale = workos_signature.sign(body, SECRET, int((now + offset) * unit))
    with pytest.raises(workos_signature.SignatureError) as refused:
        workos_signature.verify(body, stale, SECRET, now)
    assert refused.value.reason == "signature_expired"
    fine = workos_signature.sign(body, SECRET, int((now + offset * 0.99) * unit))
    assert workos_signature.verify(body, fine, SECRET, now)


def test_any_one_of_several_v1_signatures_may_match():
    body, stamp = b"{}", str(int(time.time() * 1000))
    good = workos_signature.expected_signature(body, stamp, SECRET)
    header = f"t={stamp}, v1={'0' * 64}, v1={good.upper()}"
    assert workos_signature.verify(body, header, SECRET, time.time())
    with pytest.raises(workos_signature.SignatureError):
        workos_signature.verify(
            body, f"t={stamp}, v1={'0' * 64}, v1={'1' * 64}", SECRET, time.time()
        )


@pytest.mark.parametrize(
    "header",
    [
        None,
        "",
        "   ",
        "v1=abc",
        "t=123",
        "t=abc,v1=abc",
        "t=1,t=2,v1=abc",
        "t=1,v1=",
        "nonsense",
        "t=1," + ",".join(["v1=ab"] * 9),
        "t=1,v1=" + "a" * 5000,
    ],
)
def test_a_missing_or_malformed_header_is_refused(header):
    with pytest.raises(workos_signature.SignatureError) as refused:
        workos_signature.verify(b"{}", header, SECRET, time.time())
    assert refused.value.reason in {"signature_missing", "signature_malformed"}


def test_milliseconds_and_seconds_name_the_same_moment():
    seconds = workos_signature.parse_header("t=1716222212,v1=ab").sent_at
    millis = workos_signature.parse_header("t=1716222212000,v1=ab").sent_at
    assert seconds == millis == 1716222212.0


# ---- the WorkOS client


def test_listing_sessions_reads_every_page():
    fake = FakeWorkOS()
    for n in range(5):
        fake.add_session(f"session_{n}")
    with fake.client() as client:
        assert [s.id for s in client.list_sessions(USER)] == [f"session_{n}" for n in range(5)]
    assert fake.count("GET", f"/user_management/users/{USER}/sessions") == 3


def test_each_workos_failure_has_its_own_error():
    def answer(status, headers=None):
        transport = httpx.MockTransport(lambda _r: httpx.Response(status, headers=headers or {}))
        return WorkOSClient(API_KEY, api_base=API, transport=transport)

    cases = [
        (404, WorkOSNotFound, False),
        (401, WorkOSUnauthorized, False),
        (500, WorkOSServerError, True),
        (418, WorkOSError, False),
    ]
    for status, error, retryable in cases:
        with pytest.raises(error) as raised:
            answer(status).get_user(USER)
        assert raised.value.retryable is retryable
    with pytest.raises(WorkOSRateLimited) as limited:
        answer(429, {"Retry-After": "7"}).revoke_session("session_1")
    assert limited.value.retryable and limited.value.retry_after == 7.0

    def unreachable(request):
        raise httpx.ConnectError("down", request=request)

    down = WorkOSClient(API_KEY, api_base=API, transport=httpx.MockTransport(unreachable))
    with pytest.raises(WorkOSTransportError) as raised:
        down.delete_user(USER)
    assert raised.value.retryable


def test_the_api_key_never_appears_in_logs_or_errors(caplog, monkeypatch):
    caplog.set_level(logging.DEBUG)
    seen: list[str] = []

    def handler(request):
        if request.url.path.endswith("/boom"):
            raise httpx.ConnectError(f"refused {request.headers}", request=request)
        return httpx.Response(int(request.url.path.rsplit("/", 1)[-1]))

    client = WorkOSClient(API_KEY, api_base=API, transport=httpx.MockTransport(handler))
    for user_id in ("401", "429", "500", "404", "boom"):
        try:
            client.get_user(user_id)
        except WorkOSError as error:
            seen += [str(error), repr(error), "".join(traceback.format_exception(error))]
    seen.append(repr(client))
    for name, value in {
        "SELECTA_DATABASE_URL": "postgresql+psycopg://u:p@db/selecta",
        "SELECTA_WORKOS_CLIENT_ID": "client_x",
        "SELECTA_AUTH_ISSUER": "https://issuer.test",
        "SELECTA_AUTH_AUDIENCE": "selecta",
        "SELECTA_ALLOWED_HOSTS": "api.test",
        "SELECTA_ALLOWED_ORIGINS": "https://app.test",
        "SELECTA_WORKOS_API_KEY": API_KEY,
        "SELECTA_WORKOS_WEBHOOK_SECRET": SECRET,
        "SELECTA_STAFF_ORGANIZATION_ID": STAFF_ORG,
    }.items():
        monkeypatch.setenv(name, value)
    settings = CloudSettings.from_environment()
    assert settings.workos_api_key == API_KEY and settings.require_workos is True
    seen.append(repr(settings))
    assert len(seen) == 17
    for text in [*seen, caplog.text]:
        assert API_KEY not in text and SECRET not in text


# ---- onboarding reads WorkOS


def test_onboarding_reads_the_email_from_workos_when_the_token_has_none(world):
    world.fake.add_user(USER, "from-workos@example.test", verified=True)
    created = onboard(world)
    assert created["created"] is True
    row = user_row(world)
    assert (row.email, row.email_verified) == ("from-workos@example.test", True)
    assert world.fake.count("GET", f"/user_management/users/{USER}") == 1


def test_onboarding_refuses_when_workos_says_the_email_is_unverified(world):
    world.fake.add_user(USER, "listener@example.test", verified=False)
    # The token claims a verified email; only WorkOS's answer counts.
    headers = world.tokens.issue("t", email="listener@example.test")
    answer = world.http.post(
        "/api/onboarding/complete", headers=headers, json={"age_confirmed": True}
    )
    assert answer.status_code == 403
    assert answer.json()["detail"]["code"] == "verified_email_required"
    assert user_row(world) is None


def test_onboarding_refuses_an_account_that_is_being_deleted(world):
    onboard(world)
    assert world.http.delete("/api/account", headers=world.tokens.issue("first")).status_code == 202
    fresh = world.tokens.issue("after", iat=time.time() + 2)
    answer = world.http.post(
        "/api/onboarding/complete", headers=fresh, json={"age_confirmed": True}
    )
    assert (answer.status_code, answer.json()["detail"]["code"]) == (403, "account_deleting")
    account = world.http.get("/api/account", headers=fresh)
    assert (account.status_code, account.json()["detail"]["code"]) == (403, "account_deleting")


def test_onboarding_fails_closed_when_workos_is_unreachable(world):
    world.fake.add_user()
    world.fake.fail[("GET", "/user_management/users/")] = 503
    answer = world.http.post(
        "/api/onboarding/complete", headers=world.tokens.issue("t"), json={"age_confirmed": True}
    )
    assert (answer.status_code, answer.json()["detail"]["code"]) == (503, "identity_unavailable")
    assert user_row(world) is None


# ---- the per-request check


def test_each_account_refusal_has_its_own_code(world):
    headers = world.tokens.issue("t")
    answer = world.http.get("/api/account", headers=headers)
    assert (answer.status_code, answer.json()["detail"]["code"]) == (409, "not_onboarded")
    expired = world.http.get("/api/account", headers={"Authorization": "Bearer expired"})
    assert (expired.status_code, expired.json()["detail"]["code"]) == (401, "token_expired")

    created = onboard(world, "t")
    other = onboard(world, "other", subject="user_02OTHER")
    named = world.http.get(
        "/api/account", headers=headers | {"X-Workspace-ID": other["workspace_id"]}
    )
    assert (named.status_code, named.json()["detail"]["code"]) == (404, "workspace_not_found")

    with transaction(world.engine) as conn:
        accounts.suspend(conn, created["user_id"], actor_id="staff", reason="test")
    suspended = world.http.get("/api/account", headers=headers)
    assert (suspended.status_code, suspended.json()["detail"]["code"]) == (403, "account_suspended")
    # A suspended account can still sign out everywhere.
    signed_out = world.http.post("/api/account/sign-out-everywhere", headers=headers)
    assert signed_out.status_code == 200, signed_out.text


# ---- sign out everywhere


def test_sign_out_everywhere_revokes_every_workos_session_and_refuses_old_tokens_by_sid(world):
    onboard(world, "t", sid="session_a")
    for sid in ("session_a", "session_b", "session_c"):
        world.fake.add_session(sid)
    answer = world.http.post(
        "/api/account/sign-out-everywhere", headers=world.tokens.issue("t", sid="session_a")
    )
    assert answer.status_code == 200, answer.text
    assert answer.json()["sessions_revoked"] == 3
    assert {s["status"] for s in world.fake.sessions.values()} == {"revoked"}
    with world.engine.connect() as conn:
        recorded = set(conn.execute(sa.select(revoked_sessions.c.sid)).scalars())
    assert recorded == {"session_a", "session_b", "session_c"}

    # A token from a revoked session is refused by its sid, even one minted after the cut-off.
    later = time.time() + 2
    old = world.http.get(
        "/api/account", headers=world.tokens.issue("old", sid="session_b", iat=later)
    )
    assert (old.status_code, old.json()["detail"]["code"]) == (401, "session_revoked")
    new = world.http.get(
        "/api/account", headers=world.tokens.issue("new", sid="session_d", iat=later)
    )
    assert new.status_code == 200, new.text


def test_sign_out_everywhere_reports_sessions_workos_could_not_revoke(world):
    onboard(world, "t")
    world.fake.add_session("session_a")
    world.fake.fail[("POST", "/user_management/sessions/revoke")] = 500
    answer = world.http.post("/api/account/sign-out-everywhere", headers=world.tokens.issue("t"))
    assert answer.status_code == 502
    assert answer.json()["detail"] | {"message": ""} == {
        "code": "sign_out_incomplete",
        "message": "",
        "sessions_not_revoked": 1,
        "sessions_listed": True,
    }
    later = time.time() + 2
    refused = world.http.get(
        "/api/account", headers=world.tokens.issue("a", sid="session_a", iat=later)
    )
    assert refused.json()["detail"]["code"] == "session_revoked"


def test_signing_out_while_keeping_one_session_leaves_that_one_and_the_cut_off_alone(world):
    created = onboard(world, "t")
    world.fake.add_session("session_old")
    world.fake.add_session("session_keep")
    result = sessions.sign_out_everywhere(
        world.engine, world.fake.client(), created["user_id"], keep_sid="session_keep"
    )
    assert (result.revoked, result.kept, result.revoked_before) == (
        ("session_old",),
        "session_keep",
        None,
    )
    assert world.fake.sessions["session_keep"]["status"] == "active"
    still = world.http.get("/api/account", headers=world.tokens.issue("t", sid="session_keep"))
    assert still.status_code == 200, still.text


# ---- WorkOS webhooks


def test_a_webhook_with_a_bad_signature_or_an_old_timestamp_stores_nothing(world):
    event = json.dumps({"id": "event_1", "event": "user.updated", "data": {"id": USER}}).encode()
    tampered = deliver(world, "user.updated", {"id": USER}, raw=event.replace(b"1", b"2"))
    assert (tampered.status_code, tampered.json()["detail"]["code"]) == (400, "signature_mismatch")
    old = deliver(world, "user.updated", {"id": USER}, t=int((time.time() - 400) * 1000))
    assert (old.status_code, old.json()["detail"]["code"]) == (400, "signature_expired")
    unsigned = world.http.post("/api/webhooks/workos", content=event)
    assert unsigned.json()["detail"]["code"] == "signature_missing"
    assert event_rows(world) == []


def test_user_updated_syncs_email_and_verified_status_by_re_reading_workos(world):
    onboard(world)
    world.fake.add_user(USER, "changed@example.test", verified=False)
    answer = deliver(world, "user.updated", {"id": USER, "email": "stale-snapshot@example.test"})
    assert answer.json() == {"status": "processed", "duplicate": False}
    row = user_row(world)
    assert (row.email, row.email_verified) == ("changed@example.test", False)


def test_email_verification_succeeded_marks_the_email_verified(world):
    onboard(world)
    world.fake.add_user(USER, "changed@example.test", verified=False)
    deliver(world, "user.updated", {"id": USER})
    world.fake.users[USER]["email_verified"] = True
    deliver(
        world, "email_verification.succeeded", {"user_id": USER, "email": "changed@example.test"}
    )
    assert user_row(world).email_verified is True


def test_a_duplicate_event_is_processed_once(world):
    onboard(world)
    before = world.fake.count("GET", f"/user_management/users/{USER}")
    first = deliver(world, "user.updated", {"id": USER}, event_id="event_dup")
    again = deliver(world, "user.updated", {"id": USER}, event_id="event_dup")
    assert first.json()["status"] == "processed"
    assert again.json() == {"status": "duplicate", "duplicate": True}
    assert world.fake.count("GET", f"/user_management/users/{USER}") == before + 1
    assert event_rows(world) == [("event_dup", "processed")]


def test_events_out_of_order_end_with_what_workos_says_now(world):
    onboard(world)
    world.fake.add_user(USER, "newest@example.test")
    deliver(world, "user.updated", {"id": USER, "email": "newest@example.test"}, event_id="event_2")
    deliver(world, "user.updated", {"id": USER, "email": "older@example.test"}, event_id="event_1")
    assert user_row(world).email == "newest@example.test"


def test_user_deleted_starts_deletion_once_and_only_when_workos_confirms(world):
    onboard(world)
    onboard(world, "other", subject="user_02STILL")
    ignored = deliver(world, "user.deleted", {"id": "user_02STILL"})
    assert ignored.json()["status"] == "ignored"
    assert user_row(world, "user_02STILL").deleted_at is None

    world.fake.users.pop(USER)
    assert deliver(world, "user.deleted", {"id": USER}).json()["status"] == "processed"
    assert deliver(world, "user.deleted", {"id": USER}).json()["status"] == "processed"
    assert user_row(world).deleted_at is not None
    with world.engine.connect() as conn:
        assert (
            conn.execute(
                sa.select(sa.func.count()).select_from(account_deletion_workflows)
            ).scalar_one()
            == 1
        )


def test_session_revoked_adds_the_session_id_to_the_revoked_list(world):
    onboard(world, "t")
    assert (
        deliver(world, "session.revoked", {"id": "session_x", "user_id": USER}).json()["status"]
        == "processed"
    )
    answer = world.http.get("/api/account", headers=world.tokens.issue("x", sid="session_x"))
    assert (answer.status_code, answer.json()["detail"]["code"]) == (401, "session_revoked")


@pytest.mark.parametrize(
    "event_type", ["password_reset.succeeded", "user.password_reset_succeeded"]
)
def test_a_password_reset_revokes_every_other_session_and_keeps_the_new_one(world, event_type):
    onboard(world, "t")
    reset_at = time.time()
    world.fake.add_session("session_attacker", created_at=reset_at - 900)
    world.fake.add_session("session_mine_before", created_at=reset_at - 60)
    world.fake.add_session("session_new", created_at=reset_at + 1)
    answer = deliver(
        world, event_type, {"id": "password_reset_1", "user_id": USER, "created_at": iso(reset_at)}
    )
    assert answer.json()["status"] == "processed", answer.text
    states = {sid: s["status"] for sid, s in world.fake.sessions.items()}
    assert states == {
        "session_attacker": "revoked",
        "session_mine_before": "revoked",
        "session_new": "active",
    }
    kept = world.http.get("/api/account", headers=world.tokens.issue("n", sid="session_new"))
    assert kept.status_code == 200, kept.text
    gone = world.http.get("/api/account", headers=world.tokens.issue("a", sid="session_attacker"))
    assert gone.json()["detail"]["code"] == "session_revoked"


def test_unknown_event_types_are_stored_and_ignored(world):
    answer = deliver(world, "organization.created", {"id": "org_1"}, event_id="event_unknown")
    assert answer.json()["status"] == "ignored"
    assert event_rows(world) == [("event_unknown", "ignored")]


def test_a_retryable_workos_failure_asks_for_redelivery_which_then_succeeds(world):
    onboard(world)
    world.fake.add_user(USER, "changed@example.test")
    world.fake.fail[("GET", "/user_management/users/")] = 500
    failed = deliver(world, "user.updated", {"id": USER}, event_id="event_retry")
    assert (failed.status_code, failed.json()["detail"]["code"]) == (503, "retry_later")
    assert event_rows(world) == [("event_retry", "failed")]
    world.fake.fail.clear()
    assert (
        deliver(world, "user.updated", {"id": USER}, event_id="event_retry").json()["status"]
        == "processed"
    )
    assert user_row(world).email == "changed@example.test"


# ---- staff privileged sessions


def test_a_fresh_staff_token_starts_a_privileged_session_of_at_most_an_hour(world):
    created = onboard(world, "staff")
    with transaction(world.engine) as conn:
        conn.execute(
            role_assignments.insert().values(
                id=new_id(),
                user_id=created["user_id"],
                role="operator",
                scope_type="platform",
                scope_id="operations",
                issued_by=created["user_id"],
                reason="test",
                created_at=time.time() - 60,
            )
        )
    headers = world.tokens.issue("staff", org=STAFF_ORG, sid="session_staff")
    answer = world.http.post("/api/admin/session", headers=headers)
    assert answer.status_code == 201, answer.text
    body = answer.json()
    assert 0 < body["expires_at"] - body["issued_at"] <= 3600
    with transaction(world.engine) as conn:
        actor = privileged.actor_for(conn, body["id"], created["user_id"])
        assert (actor.staff_session_id, actor.session_issued_at) == (body["id"], body["issued_at"])
        assert (
            actor.privileged_until == body["expires_at"] and actor.mfa_at <= actor.session_issued_at
        )
        assert authorize(conn, actor, "jobs.read").role.value == "operator"
        with pytest.raises(privileged.PrivilegedSessionEnded):
            privileged.actor_for(conn, body["id"], "someone-else")


def test_admin_entry_is_refused_outside_the_staff_organization_and_audited(world):
    created = onboard(world, "t")
    headers = world.tokens.issue("t", org="org_customers", sid="session_1")
    answer = world.http.post("/api/admin/session", headers=headers)
    assert (answer.status_code, answer.json()["detail"]["code"]) == (
        403,
        "staff_organization_required",
    )
    with world.engine.connect() as conn:
        assert (
            conn.execute(sa.select(sa.func.count()).select_from(privileged_sessions)).scalar_one()
            == 0
        )
        audited = conn.execute(
            sa.select(audit_events.c.result, audit_events.c.reason).where(
                audit_events.c.action == "admin.session.start",
                audit_events.c.actor_id == created["user_id"],
            )
        ).all()
    assert audited == [("deny", "staff_organization_required")]


def test_admin_entry_needs_a_sign_in_from_the_last_five_minutes(world):
    onboard(world, "t")
    stale = world.tokens.issue("t", org=STAFF_ORG, sid="session_1", iat=time.time() - 400)
    answer = world.http.post("/api/admin/session", headers=stale)
    assert (answer.status_code, answer.json()["detail"]["code"]) == (401, "fresh_sign_in_required")


def test_a_privileged_session_ends_on_expiry_revocation_or_a_role_change(sqlite_engine, clock):
    def begin(conn, user, sid, lifetime=3600):
        claims = Claims(
            user.auth_subject, clock.now, clock.now + 600, session_id=sid, organization_id=STAFF_ORG
        )
        return privileged.start(conn, claims, staff_organization_id=STAFF_ORG, lifetime=lifetime)

    with transaction(sqlite_engine) as conn:
        user = accounts.provision(
            conn, Claims("staff-sub", clock.now, clock.now + 600), age_confirmed=True
        ).user
        expiring, revoked, reassigned = (begin(conn, user, sid) for sid in ("s1", "s2", "s3"))
        assert begin(conn, user, "s4", lifetime=7200).expires_at - clock.now == 3600
        sessions.record_revoked(conn, "s2", user_id=user.id, reason="test")
        with pytest.raises(privileged.PrivilegedSessionEnded):
            privileged.actor_for(conn, revoked.id, user.id)
        privileged.actor_for(conn, reassigned.id, user.id)
        clock.advance(10)
        conn.execute(
            role_assignments.insert().values(
                id=new_id(),
                user_id=user.id,
                role="auditor",
                scope_type="platform",
                scope_id="audit",
                issued_by=user.id,
                reason="test",
                created_at=clock.now,
            )
        )
        with pytest.raises(privileged.PrivilegedSessionEnded, match="roles changed"):
            privileged.actor_for(conn, reassigned.id, user.id)
        clock.advance(3600)
        with pytest.raises(privileged.PrivilegedSessionEnded, match="expired"):
            privileged.actor_for(conn, expiring.id, user.id)
    with pytest.raises(IntegrityError), transaction(sqlite_engine) as conn:
        conn.execute(
            privileged_sessions.insert().values(
                id=new_id(),
                user_id=user.id,
                workos_sid="s5",
                issued_at=clock.now,
                mfa_at=clock.now,
                expires_at=clock.now + 3601,
            )
        )


# ---- erasure, flags


def test_erasure_deletes_the_workos_user_and_a_404_counts_as_done():
    fake = FakeWorkOS()
    fake.add_user()
    deleter = WorkOSUserDeleter(fake.client())
    deleter.delete_user(USER)
    deleter.delete_user(USER)  # already gone: still done
    assert USER not in fake.users and fake.count("DELETE", "/user_management/users/") == 2
    fake.fail[("DELETE", "/user_management/users/")] = 500
    with pytest.raises(DeletionEffectError):
        deleter.delete_user(USER)


def test_erasure_clears_the_users_revoked_and_privileged_sessions(sqlite_engine):
    with transaction(sqlite_engine) as conn:
        now = time.time()
        user = accounts.provision(
            conn, Claims("erased-sub", now, now + 600), age_confirmed=True
        ).user
        sessions.record_revoked(conn, "session_gone", user_id=user.id, reason="test")
        conn.execute(
            privileged_sessions.insert().values(
                id=new_id(),
                user_id=user.id,
                workos_sid="s",
                issued_at=now,
                mfa_at=now,
                expires_at=now + 60,
            )
        )
        AccountDeletionEffects._clear_user_references(conn, user.id)
        remaining = AccountDeletionEffects._remaining_user_references(conn, user.id)
    assert not [r for r in remaining if r.startswith(("revoked_sessions", "privileged_sessions"))]


def test_every_new_identity_route_is_owned_by_a_flag_and_the_webhook_cant_be_turned_off(world):
    owners = flags.route_owners()
    assert owners["POST /api/webhooks/workos"] == "account.identity_sync"
    assert flags.registry()["account.identity_sync"].core
    with pytest.raises(flags.FlagError, match="can't be turned off"):
        flags.resolve("-account.identity_sync")
    assert owners["POST /api/admin/session"] == "admin.console"
    flags.use("-admin.console")
    answer = world.http.post("/api/admin/session", headers=world.tokens.issue("t"))
    assert (answer.status_code, answer.json()["code"]) == (403, "flag_off")
