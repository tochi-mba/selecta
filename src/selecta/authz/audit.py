"""The audit log: what staff did or tried to do, written once and never changed (§7.6).

`record()` adds one row in the caller's transaction, so an action and its audit row commit or roll
back together. `record_durably()` is for denies: on PostgreSQL it commits in a transaction of its
own, so the row survives when the refused request rolls back. (SQLite allows one writer at a time,
so there it writes in the caller's transaction; staff only exist in the cloud.)

Audit rows never hold secrets, prompts, audio or signed URLs. `record()` redacts metadata values
whose key looks like one (token, secret, password, otp, cookie, signature, prompt, ...) and any
value that looks like a signed URL, rather than trusting every caller to remember. Free text (the
`reason`, and the error notes of failed delayed actions) goes through `scrub_text()`: URLs lose
their query strings, and bearer tokens, `secret=value` pairs and token-shaped strings are redacted.

In the cloud, `APPEND_ONLY_SQL` makes the app's database role insert-only on `audit_events`, and
triggers refuse updates, truncation, and deletion of rows younger than the two-year retention, even
for the table's owner. `export_day()` yields one day as JSON lines for the daily copy to the
write-once bucket.
"""

from __future__ import annotations

import json
import re
from collections.abc import Iterator, Mapping
from datetime import UTC, date, datetime
from enum import StrEnum
from typing import Any

import sqlalchemy as sa
from sqlalchemy.engine import Connection

from selecta.authz.schema import audit_events
from selecta.persistence import db_now, is_postgres, new_id
from selecta.workers.context import scrub_urls

RETENTION_SECONDS = 2 * 365 * 24 * 3600
REDACTED = "[redacted]"

# Words that make a key (or the name before `=` in free text) hold a credential. `otp` only as a
# word of its own, so `footprint` stays.
_CREDENTIAL_WORDS = (
    r"token|secret|passw|api[_-]?key|authori[sz]ation|auth[_-]?header|cookie|signature|"
    r"signed[_-]?url|credential|private[_-]?key|(?<![a-z])otp(?![a-z])"
)
_SECRET_KEY = re.compile(rf"({_CREDENTIAL_WORDS}|prompt|lyrics)", re.IGNORECASE)

# Free text. A bearer token has a digit or a symbol in it, so "the bearer of" stays.
_BEARER = re.compile(r"\b(bearer)\s+(?=[A-Za-z]*[0-9._~+/=-])[A-Za-z0-9._~+/=-]{4,}", re.I)
_SECRET_ASSIGNMENT = re.compile(
    rf"(?<![\w-])([\w-]*?(?:{_CREDENTIAL_WORDS})[\w-]*)([\"']?\s*[=:]\s*)"
    r"(\"[^\"]*\"|'[^']*'|[^\s,;]+)",
    re.IGNORECASE,
)
_JWT = re.compile(r"\beyJ[\w-]+\.[\w-]+\.[\w-]*")
_KNOWN_SECRET = re.compile(r"\b(?:(?:sk|rk)_(?:live|test)_|whsec_)\w+")
_LONG_RUN = re.compile(r"(?<![A-Za-z0-9+/_=-])[A-Za-z0-9+/_=-]{32,}")
_UUID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", re.I)
_URL_REDACTED = "?<redacted>"  # what `scrub_urls` leaves in place of a query string
_HOLD = "\ue000"  # a private-use character, never in real text
_SIGNED_URL = re.compile(r"[?&](x-amz-signature|signature|sig|token|x-amz-credential)=", re.I)
_ROLE_NAME = re.compile(r"^[a-z_][a-z0-9_]{0,62}$")


class AuditResult(StrEnum):
    ALLOW = "allow"
    DENY = "deny"
    SUCCESS = "success"
    FAILURE = "failure"


def scrub(value: Any, key: str = "") -> Any:
    """`value` with anything secret-looking replaced by "[redacted]", recursively."""
    if key and _SECRET_KEY.search(key):
        return REDACTED
    if isinstance(value, bytes | bytearray | memoryview):
        return REDACTED  # binary is audio or a key, never something to keep
    if isinstance(value, Mapping):
        return {str(k): scrub(v, str(k)) for k, v in value.items()}
    if isinstance(value, list | tuple | set | frozenset):
        return [scrub(item) for item in value]
    if isinstance(value, str) and _SIGNED_URL.search(value):
        return REDACTED
    if value is None or isinstance(value, bool | int | float | str):
        return value
    return str(value)


def _assignment(match: re.Match[str]) -> str:
    if match.group(3).startswith(REDACTED):
        return match.group(0)
    return f"{match.group(1)}{match.group(2)}{REDACTED}"


def _token_shaped(match: re.Match[str]) -> str:
    # A path is judged one segment at a time, so ids in it stay and a token in it goes.
    return "/".join(_redact_token(part) for part in match.group(0).split("/"))


def _redact_token(run: str) -> str:
    if len(run) < 32 or _UUID.fullmatch(run):
        return run
    if any(c.isdigit() for c in run) and any(c.isalpha() for c in run):
        return REDACTED
    return run


def scrub_text(text: str | None) -> str | None:
    """Free text with signed URL queries, bearer tokens and token-shaped strings removed.

    Scrubbing twice gives the same text as scrubbing once.
    """
    if text is None:
        return None
    text = scrub_urls(text.replace(_URL_REDACTED, _HOLD)).replace(_HOLD, _URL_REDACTED)
    text = _BEARER.sub(rf"\1 {REDACTED}", text)
    text = _JWT.sub(REDACTED, text)
    text = _KNOWN_SECRET.sub(REDACTED, text)
    text = _SECRET_ASSIGNMENT.sub(_assignment, text)
    return _LONG_RUN.sub(_token_shaped, text)


def record(
    conn: Connection,
    *,
    action: str,
    result: AuditResult | str,
    actor_id: str | None = None,
    resource_type: str | None = None,
    resource_id: str | None = None,
    workspace_id: str | None = None,
    reason: str | None = None,
    request_id: str | None = None,
    approval_id: str | None = None,
    policy_version_before: str | None = None,
    policy_version_after: str | None = None,
    metadata: Mapping[str, Any] | None = None,
) -> str:
    """Append one audit row in the caller's transaction and return its id."""
    event_id = new_id()
    conn.execute(
        audit_events.insert().values(
            id=event_id,
            created_at=db_now(conn),
            actor_id=actor_id,
            action=action,
            resource_type=resource_type,
            resource_id=resource_id,
            workspace_id=workspace_id,
            result=AuditResult(result).value,
            reason=scrub_text(reason),
            request_id=request_id,
            approval_id=approval_id,
            policy_version_before=policy_version_before,
            policy_version_after=policy_version_after,
            metadata=scrub(dict(metadata)) if metadata else None,
        )
    )
    return event_id


def record_durably(conn: Connection, **fields: Any) -> str:
    """Like `record()`, but on PostgreSQL commits at once so a later rollback can't lose it."""
    if is_postgres(conn):
        with conn.engine.begin() as own:
            return record(own, **fields)
    return record(conn, **fields)


def append_only_sql(
    app_role: str = "selecta_app", reader_role: str = "selecta_audit_reader"
) -> tuple[str, ...]:
    """PostgreSQL statements that make `audit_events` insert-only for `app_role`."""
    for role in (app_role, reader_role):
        if not _ROLE_NAME.match(role):
            raise ValueError(f"not a plain role name: {role!r}")
    return (
        "REVOKE ALL ON TABLE audit_events FROM PUBLIC",
        f"REVOKE ALL ON TABLE audit_events FROM {app_role}",
        f"GRANT INSERT ON TABLE audit_events TO {app_role}",
        f"GRANT SELECT ON TABLE audit_events TO {reader_role}",
        "CREATE OR REPLACE FUNCTION audit_events_refuse_change() RETURNS trigger "
        "LANGUAGE plpgsql AS $$ BEGIN "
        "RAISE EXCEPTION 'audit_events is append-only'; "
        "END $$",
        "CREATE OR REPLACE FUNCTION audit_events_refuse_early_delete() RETURNS trigger "
        "LANGUAGE plpgsql AS $$ BEGIN "
        f"IF OLD.created_at > extract(epoch FROM now()) - {RETENTION_SECONDS} THEN "
        "RAISE EXCEPTION 'audit_events rows are kept for two years'; "
        "END IF; RETURN OLD; "
        "END $$",
        "DROP TRIGGER IF EXISTS audit_events_no_update ON audit_events",
        "CREATE TRIGGER audit_events_no_update BEFORE UPDATE ON audit_events "
        "FOR EACH ROW EXECUTE FUNCTION audit_events_refuse_change()",
        "DROP TRIGGER IF EXISTS audit_events_no_truncate ON audit_events",
        "CREATE TRIGGER audit_events_no_truncate BEFORE TRUNCATE ON audit_events "
        "FOR EACH STATEMENT EXECUTE FUNCTION audit_events_refuse_change()",
        "DROP TRIGGER IF EXISTS audit_events_no_early_delete ON audit_events",
        "CREATE TRIGGER audit_events_no_early_delete BEFORE DELETE ON audit_events "
        "FOR EACH ROW EXECUTE FUNCTION audit_events_refuse_early_delete()",
    )


APPEND_ONLY_SQL: tuple[str, ...] = append_only_sql()


def day_bounds(day: date) -> tuple[float, float]:
    """The UTC day as [start, end) epoch seconds."""
    start = datetime.combine(day, datetime.min.time(), tzinfo=UTC).timestamp()
    return start, start + 86400.0


def export_row(row: Mapping[str, Any]) -> dict[str, Any]:
    out = {column.name: row[column.name] for column in audit_events.columns}
    out["time"] = datetime.fromtimestamp(row["created_at"], UTC).isoformat()
    return out


def export_day(conn: Connection, day: date) -> Iterator[str]:
    """Every event of one UTC day, oldest first, as canonical JSON lines (no trailing newline)."""
    start, end = day_bounds(day)
    query = (
        sa.select(audit_events)
        .where(audit_events.c.created_at >= start, audit_events.c.created_at < end)
        .order_by(audit_events.c.created_at, audit_events.c.id)
        .execution_options(yield_per=1000)
    )
    for row in conn.execute(query).mappings():
        yield json.dumps(export_row(row), sort_keys=True, separators=(",", ":"), default=str)
