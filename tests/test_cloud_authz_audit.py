"""The audit log: scrubbing, the daily export, durable denies and append-only storage (§7.6).

Scrubbing and the export run on both databases. A deny audit surviving its request's rollback and
the append-only grants and triggers exist only on PostgreSQL, so those tests use `postgres_engine`
(they run in the Linux CI job) and create their own database roles.
"""

from __future__ import annotations

import dataclasses
import json
import secrets
from datetime import date, datetime
from decimal import Decimal

import pytest
import sqlalchemy as sa
import test_cloud_authz_kit as kit
from test_cloud_authz_kit import add_user, audit_rows, session, staff

from selecta.authz import audit, delayed
from selecta.authz.assignments import assign_role
from selecta.authz.audit import REDACTED, RETENTION_SECONDS, AuditResult, scrub
from selecta.authz.check import authorize
from selecta.authz.errors import Forbidden, SelfApproval
from selecta.authz.roles import StaffRole
from selecta.authz.schema import audit_events
from selecta.identity import accounts
from selecta.identity.deletion_effects import AccountDeletionEffects
from selecta.identity.schema import users, workspaces
from selecta.identity.tokens import Claims
from selecta.persistence import db_now, new_id, transaction
from selecta.storage.deletion import DeletionKind, tombstone
from selecta.storage.schema import deletions

db = kit.db

SIGNED = "https://media.r2.example/a.flac?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=beef"


# Scrubbing


@pytest.mark.parametrize(
    "key",
    [
        "token",
        "access_token",
        "id_token",
        "client_secret",
        "webhook_secret",
        "password",
        "passwd",
        "api_key",
        "apiKey",
        "x-api-key",
        "authorization",
        "Authorisation",
        "cookie",
        "set-cookie",
        "signature",
        "signed_url",
        "signedUrl",
        "presigned_url",
        "prompt",
        "system_prompt",
        "Prompt",
        "credential",
        "credentials",
        "private_key",
        "privateKey",
        "lyrics",
        "song_lyrics",
        "auth_header",
        "Auth-Header",
        "AUTHORIZATION",
        "Set-Cookie",
        "otp",
        "OTP",
        "mfa_otp",
        "otp_code",
        "PASSWORD",
        "session_token",
        "Session_Token",
    ],
)
def test_values_under_secret_looking_keys_are_redacted(key):
    assert scrub({key: "s3cr3t", "role": "support"}) == {key: REDACTED, "role": "support"}


def test_a_secret_key_redacts_its_whole_value_however_nested():
    data = {"request": {"headers": {"Authorization": "Bearer abc", "accept": "json"}}}
    assert scrub(data) == {"request": {"headers": {"Authorization": REDACTED, "accept": "json"}}}
    assert scrub({"prompt": {"system": "you are", "user": "make a mix"}}) == {"prompt": REDACTED}


@pytest.mark.parametrize(
    "value",
    [
        SIGNED,
        "https://media.r2.example/a.flac?X-Amz-Credential=AKIA%2F20261109",
        "https://cdn.example/a.mp3?sig=abc",
        "https://cdn.example/a.mp3?expires=1&token=abc",
        "https://cdn.example/a.mp3?Signature=abc",
        f"download it from {SIGNED} before it expires",
    ],
)
def test_signed_urls_are_redacted_under_any_key(value):
    assert scrub({"link": value}) == {"link": REDACTED}
    assert scrub([value]) == [REDACTED]


@pytest.mark.parametrize(
    "value",
    [
        "https://selecta.example/admin/jobs?page=2",
        "https://selecta.example/x?designation=main",
        "plain words about a token bucket",
    ],
)
def test_ordinary_urls_and_text_are_kept(value):
    assert scrub({"link": value}) == {"link": value}


def test_lists_tuples_and_sets_are_scrubbed_item_by_item():
    data = {"items": [{"prompt": "x", "n": 1}, SIGNED, ("a", SIGNED)], "tags": frozenset({"t"})}
    assert scrub(data) == {
        "items": [{"prompt": REDACTED, "n": 1}, REDACTED, ["a", REDACTED]],
        "tags": ["t"],
    }


def test_plain_values_pass_and_other_objects_become_text():
    assert scrub({"n": 3, "f": 1.5, "ok": True, "none": None}) == {
        "n": 3,
        "f": 1.5,
        "ok": True,
        "none": None,
    }
    when = datetime(2026, 11, 9, 12, 0)
    assert scrub({"at": when, "cost": Decimal("0.10"), 7: "x"}) == {
        "at": str(when),
        "cost": "0.10",
        "7": "x",
    }


def test_binary_values_such_as_audio_are_never_stored():
    # str(b"...") would keep every byte as text; audio must never reach an audit row.
    for value in (b"RIFF\x00\x01WAVEfmt ", bytearray(b"\xff\xfb\x90"), memoryview(b"ID3")):
        assert scrub({"sample": value}) == {"sample": REDACTED}
        assert scrub([value]) == [REDACTED]


def test_record_stores_scrubbed_metadata_and_every_field(db):
    event_id = audit.record(
        db,
        action="models.routing.apply",
        result="success",
        actor_id="u1",
        resource_type="model_route",
        resource_id="tier-premium",
        workspace_id="w1",
        reason="cheaper model",
        request_id="req-1",
        approval_id="act-1",
        policy_version_before="v1",
        policy_version_after="v2",
        metadata={"prompt": "secret instructions", "route": "lucy-2", "url": SIGNED},
    )
    (row,) = audit_rows(db)
    assert row["id"] == event_id
    assert row["created_at"] == pytest.approx(db_now(db), abs=5)
    assert {k: row[k] for k in ("action", "result", "actor_id", "workspace_id")} == {
        "action": "models.routing.apply",
        "result": "success",
        "actor_id": "u1",
        "workspace_id": "w1",
    }
    assert (row["policy_version_before"], row["policy_version_after"]) == ("v1", "v2")
    assert row["metadata"] == {"prompt": REDACTED, "route": "lucy-2", "url": REDACTED}


def test_record_keeps_no_metadata_when_none_is_given(db):
    audit.record(db, action="a.b", result=AuditResult.ALLOW)
    audit.record(db, action="a.b", result=AuditResult.ALLOW, metadata={})
    assert [row["metadata"] for row in audit_rows(db)] == [None, None]


def test_record_refuses_an_unknown_result(db):
    with pytest.raises(ValueError):
        audit.record(db, action="a.b", result="maybe")


def test_a_key_that_only_contains_otp_inside_a_word_is_kept():
    assert scrub({"footprint": 3, "hotpath": "a"}) == {"footprint": 3, "hotpath": "a"}


# Built at run time so no token-shaped text is committed (tests/test_no_committed_secrets.py).
JWT = ".".join(("eyJhbGciOiJSUzI1NiJ9", "eyJzdWIiOiJ1c2VyXzAxIn0", "c2lnbmF0dXJlLWJ5dGVz"))
LONG_TOKEN = "9f8e7d6c5b4a39281706f5e4d3c2b1a09f8e7d6c"


@pytest.mark.parametrize(
    ("text", "gone"),
    [
        (f"fetch failed for {SIGNED}", ("X-Amz-Signature", "beef", "AWS4-HMAC")),
        ("Authorization: Bearer abc.def-123", ("abc.def-123",)),
        ("retry with bearer s3cr3tvalue", ("s3cr3tvalue",)),
        (f"see https://cdn.example/files/{LONG_TOKEN}/a.flac", (LONG_TOKEN,)),
        (f"token {JWT} expired", (JWT, "eyJzdWIiOiJ1c2VyXzAxIn0")),
        ("stripe said no to sk_live_51Habc123XYZ", ("sk_live_51Habc123XYZ",)),
        ("whsec_abc123def456 did not verify", ("whsec_abc123def456",)),
        (f"api answered {LONG_TOKEN}", (LONG_TOKEN,)),
        ("login with password=hunter2 failed", ("hunter2",)),
        ('config {"session_token": "abc123"}', ("abc123",)),
        ("otp: 123456 was wrong", ("123456",)),
        ("cookie=sid%3D99; Path=/", ("sid%3D99",)),
        ("Set-Cookie: sid=99", ("sid=99",)),
        ("auth_header=xyz789", ("xyz789",)),
    ],
)
def test_free_text_loses_signed_queries_bearer_tokens_and_token_shaped_strings(text, gone):
    scrubbed = audit.scrub_text(text)
    for part in gone:
        assert part not in scrubbed, (part, scrubbed)
    assert audit.scrub_text(scrubbed) == scrubbed  # scrubbing twice changes nothing more


@pytest.mark.parametrize(
    "text",
    [
        "no role grants this at this scope",
        "the proposer no longer holds queues.policy.approve",
        "ActionNotFound: no live user 01a1c2cb-7677-783f-803a-a1e809bb4ae6",
        "customer reports a click at 1:32 on sub_1NxYz",
        "see https://selecta.example/admin/jobs/01a1c2cb-7677-783f-803a-a1e809bb4ae6",
        "footprint: 3 tracks, token bucket refilled",
        "the_proposer_no_longer_holds_the_permission_needed",
        "the bearer of this grant",
    ],
)
def test_ordinary_free_text_is_kept(text):
    assert audit.scrub_text(text) == text


def test_scrubbing_free_text_keeps_the_url_without_its_query():
    assert audit.scrub_text(f"see {SIGNED}") == "see https://media.r2.example/a.flac?<redacted>"
    assert audit.scrub_text(None) is None


def test_record_scrubs_the_free_text_reason(db):
    audit.record(
        db,
        action="support.diagnostics.read",
        result="success",
        reason=f"sent {SIGNED} with Bearer abc123 and password=hunter2 for the click",
    )
    (row,) = audit_rows(db)
    for part in ("X-Amz-Signature", "abc123", "hunter2"):
        assert part not in row["reason"]
    assert row["reason"].endswith("for the click")


def test_on_sqlite_a_durable_record_shares_the_callers_transaction(sqlite_engine):
    # SQLite allows one writer, so a second transaction would wait on the first. Staff only exist
    # in the cloud (PostgreSQL), where the durable path is tested below.
    with sqlite_engine.connect() as conn:
        transaction = conn.begin()
        audit.record_durably(conn, action="a.b", result="deny")
        assert len(audit_rows(conn)) == 1
        transaction.rollback()
        assert audit_rows(conn) == []


# The daily export


def test_day_bounds_are_the_utc_day():
    assert audit.day_bounds(date(2026, 11, 9)) == (1794182400.0, 1794268800.0)
    assert audit.day_bounds(date(2024, 2, 29))[1] - audit.day_bounds(date(2024, 2, 29))[0] == 86400


def insert_event(conn, created_at, action="a.b", **fields):
    event_id = new_id()
    conn.execute(
        audit_events.insert().values(
            id=event_id, created_at=created_at, action=action, result="success", **fields
        )
    )
    return event_id


def test_export_day_gives_one_line_per_event_for_exactly_that_utc_day(db):
    start, end = audit.day_bounds(date(2026, 11, 9))
    insert_event(db, start - 0.001, "day.before")
    first = insert_event(db, start, "day.first", metadata={"n": 1})
    middle = insert_event(db, start + 43200, "day.middle", actor_id="u1")
    last = insert_event(db, end - 0.001, "day.last")
    insert_event(db, end, "day.after")
    lines = list(audit.export_day(db, date(2026, 11, 9)))
    events = [json.loads(line) for line in lines]
    assert [e["id"] for e in events] == [first, middle, last]
    assert [e["action"] for e in events] == ["day.first", "day.middle", "day.last"]
    assert events[0]["time"] == "2026-11-09T00:00:00+00:00"
    assert events[0]["metadata"] == {"n": 1}
    assert events[1]["actor_id"] == "u1"
    assert set(events[1]) == {c.name for c in audit_events.columns} | {"time"}
    for line in lines:
        assert "\n" not in line
        assert line == json.dumps(json.loads(line), sort_keys=True, separators=(",", ":"))


def test_export_day_of_a_quiet_day_is_empty(db):
    insert_event(db, audit.day_bounds(date(2026, 11, 9))[0])
    assert list(audit.export_day(db, date(2026, 11, 10))) == []


# Append-only grants and triggers


@pytest.mark.parametrize(
    ("app", "reader"),
    [
        ("selecta-app", "reader"),
        ("app; DROP TABLE users", "reader"),
        ("", "reader"),
        ("App", "reader"),
        ("app", "reader role"),
        ("1app", "reader"),
    ],
)
def test_append_only_sql_takes_only_plain_role_names(app, reader):
    with pytest.raises(ValueError, match="plain role name"):
        audit.append_only_sql(app, reader)


def test_append_only_sql_grants_the_app_insert_and_the_reader_select_only():
    statements = audit.append_only_sql("app_x", "reader_x")
    grants = [s for s in statements if s.startswith("GRANT")]
    assert grants == [
        "GRANT INSERT ON TABLE audit_events TO app_x",
        "GRANT SELECT ON TABLE audit_events TO reader_x",
    ]
    assert "REVOKE ALL ON TABLE audit_events FROM app_x" in statements
    assert str(RETENTION_SECONDS) in " ".join(statements)
    assert audit.APPEND_ONLY_SQL == audit.append_only_sql("selecta_app", "selecta_audit_reader")
    assert RETENTION_SECONDS == 2 * 365 * 24 * 3600


# PostgreSQL only


def test_a_deny_audit_survives_the_requests_rollback(postgres_engine):
    with postgres_engine.connect() as conn:
        transaction = conn.begin()
        user = add_user(conn)
        with pytest.raises(Forbidden) as caught:
            authorize(conn, session(conn, user), "jobs.read")
        transaction.rollback()
    with postgres_engine.connect() as conn:
        (row,) = audit_rows(conn, result="deny")
        assert (row["id"], row["actor_id"]) == (caught.value.audit_id, user)
        assert conn.execute(sa.select(users.c.id).where(users.c.id == user)).first() is None


def test_self_assignment_and_self_approval_denies_survive_rollback(postgres_engine):
    with postgres_engine.connect() as conn:
        transaction = conn.begin()
        owner, admin = staff(conn), staff(conn, StaffRole.ADMIN)
        with pytest.raises(SelfApproval):
            assign_role(conn, session(conn, admin), user_id=admin, role="operator", reason="me")
        action = delayed.propose(
            conn, session(conn, owner), "queues.weights.change", {"a": 1}, reason="shift"
        )
        with pytest.raises(SelfApproval):
            delayed.approve(conn, session(conn, owner), action.id, payload_hash=action.payload_hash)
        transaction.rollback()
    with postgres_engine.connect() as conn:
        reasons = {(r["actor_id"], r["reason"]) for r in audit_rows(conn, result="deny")}
        assert reasons == {(admin, "self-assignment"), (owner, "self-approval")}


@pytest.fixture
def append_only(postgres_engine):
    """The audit table made append-only for two roles created for this test."""
    suffix = secrets.token_hex(4)
    app, reader = f"selecta_app_{suffix}", f"selecta_reader_{suffix}"
    with postgres_engine.begin() as conn:
        schema = conn.execute(sa.text("SELECT current_schema()")).scalar_one()
        conn.exec_driver_sql(f"CREATE ROLE {app} NOLOGIN")
        conn.exec_driver_sql(f"CREATE ROLE {reader} NOLOGIN")
        conn.exec_driver_sql(f'GRANT USAGE ON SCHEMA "{schema}" TO {app}, {reader}')
        for statement in audit.append_only_sql(app, reader):
            conn.exec_driver_sql(statement)
    try:
        yield postgres_engine, app, reader
    finally:
        with postgres_engine.begin() as conn:
            for role in (app, reader):
                conn.exec_driver_sql(f"DROP OWNED BY {role}")
                conn.exec_driver_sql(f"DROP ROLE {role}")


def attempt(engine, role, sql):
    """Run `sql` as `role` (None: the table owner), roll back, and return its SQLSTATE or "ok"."""
    with engine.connect() as conn:
        transaction = conn.begin()
        try:
            if role is not None:
                conn.exec_driver_sql(f"SET LOCAL ROLE {role}")
            conn.exec_driver_sql(sql)
        except sa.exc.DBAPIError as error:
            return error.orig.sqlstate
        finally:
            transaction.rollback()
    return "ok"


INSUFFICIENT_PRIVILEGE = "42501"
RAISED = "P0001"


def test_the_app_role_can_insert_but_never_update_delete_or_truncate(append_only):
    engine, app, reader = append_only
    with engine.begin() as conn:
        conn.exec_driver_sql(f"SET LOCAL ROLE {app}")
        audit.record(conn, action="staff.login", result="success", metadata={"token": "x"})
    with engine.begin() as conn:
        conn.exec_driver_sql(f"SET LOCAL ROLE {reader}")
        (row,) = audit_rows(conn)
        assert row["metadata"] == {"token": REDACTED}
    assert attempt(engine, app, "UPDATE audit_events SET reason = 'edited'") == (
        INSUFFICIENT_PRIVILEGE
    )
    assert attempt(engine, app, "DELETE FROM audit_events") == INSUFFICIENT_PRIVILEGE
    assert attempt(engine, app, "TRUNCATE audit_events") == INSUFFICIENT_PRIVILEGE
    assert attempt(engine, reader, "DELETE FROM audit_events") == INSUFFICIENT_PRIVILEGE


def test_even_the_table_owner_cannot_change_rows_under_two_years_old(append_only):
    engine, _, _ = append_only
    with engine.begin() as conn:
        insert_event(conn, db_now(conn) - 3600)
        insert_event(conn, db_now(conn) - RETENTION_SECONDS + 86400)
    assert attempt(engine, None, "UPDATE audit_events SET reason = 'edited'") == RAISED
    assert attempt(engine, None, "DELETE FROM audit_events") == RAISED
    assert attempt(engine, None, "TRUNCATE audit_events") == RAISED
    with engine.connect() as conn:
        assert len(audit_rows(conn)) == 2


def test_rows_past_two_years_may_be_deleted_by_the_owner(append_only):
    engine, app, _ = append_only
    with engine.begin() as conn:
        old = insert_event(conn, db_now(conn) - RETENTION_SECONDS - 86400)
        insert_event(conn, db_now(conn))
    assert attempt(engine, app, f"DELETE FROM audit_events WHERE id = '{old}'") == (
        INSUFFICIENT_PRIVILEGE
    )
    with engine.begin() as conn:
        deleted = conn.execute(audit_events.delete().where(audit_events.c.id == old))
        assert deleted.rowcount == 1
    with engine.connect() as conn:
        assert len(audit_rows(conn)) == 1


# Account erasure leaves the audit log as it is


class FakeIdentity:
    """Stands in for WorkOS: records which identities were deleted."""

    def __init__(self) -> None:
        self.deleted: list[str] = []

    def delete_user(self, auth_subject: str) -> None:
        self.deleted.append(auth_subject)


def account_ready_to_erase(engine):
    """A deleted account past its recovery period with its objects purged, and audit rows about
    it as actor, as resource and in its workspace. Returns the plan, user id and workspace id."""
    with transaction(engine) as conn:
        now = db_now(conn)
        made = accounts.provision(
            conn, Claims(f"erase-{new_id()}", now, now + 600), age_confirmed=True
        )
        user_id, workspace_id = made.user.id, made.workspace.id
        audit.record(
            conn,
            action="account.export",
            result="success",
            actor_id=user_id,
            resource_type="user",
            resource_id=user_id,
            workspace_id=workspace_id,
        )
        plan = accounts.start_account_deletion(conn, user_id)
    with transaction(engine, workspace_id) as conn:
        tombstone(conn, workspace_id, DeletionKind.ACCOUNT, workspace_id)
        conn.execute(
            deletions.update()
            .where(deletions.c.workspace_id == workspace_id)
            .values(physical_done_at=db_now(conn))
        )
    return dataclasses.replace(plan, erase_after=plan.deleted_at - 1), user_id, workspace_id


def erase(engine, plan) -> FakeIdentity:
    identity = FakeIdentity()
    effects = AccountDeletionEffects(
        engine, job_store=None, stripe=None, objects=None, price_map=None, identity=identity
    )
    effects.delete_workspace_rows(plan, "erase-test")
    effects.erase_user(plan, "erase-test")
    return identity


def test_account_erasure_leaves_audit_rows_exactly_as_written(cloud_engine):
    # The rows keep the random user, workspace and resource ids. Once the user row and personal
    # data are gone, those ids point at nothing and identify no one.
    plan, user_id, workspace_id = account_ready_to_erase(cloud_engine)
    with cloud_engine.connect() as conn:
        before = {row["id"]: dict(row) for row in audit_rows(conn)}
    assert any(row["actor_id"] == user_id for row in before.values())
    assert any(row["workspace_id"] == workspace_id for row in before.values())

    identity = erase(cloud_engine, plan)

    assert len(identity.deleted) == 1
    with cloud_engine.connect() as conn:
        after = {row["id"]: dict(row) for row in audit_rows(conn)}
        assert conn.execute(sa.select(users.c.id).where(users.c.id == user_id)).first() is None
        gone = sa.select(workspaces.c.id).where(workspaces.c.id == workspace_id)
        assert conn.execute(gone).first() is None
    assert {key: after[key] for key in before} == before


def test_account_erasure_succeeds_with_the_audit_log_append_only(append_only):
    engine, _, _ = append_only
    plan, user_id, _ = account_ready_to_erase(engine)
    with engine.connect() as conn:
        written = len(audit_rows(conn, actor_id=user_id))
    assert written >= 2

    erase(engine, plan)

    with engine.connect() as conn:
        assert conn.execute(sa.select(users.c.id).where(users.c.id == user_id)).first() is None
        assert len(audit_rows(conn, actor_id=user_id)) == written
