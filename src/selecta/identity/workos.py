"""A small WorkOS User Management client: look up users, list and end sessions, delete users.

Selecta keeps its own account records in step with WorkOS (§7A), and these are the only WorkOS
calls it needs. The client is plain httpx with an injectable transport, so tests pass an
`httpx.MockTransport` and never touch the network.

The API key is a secret that can act on every account, so it is handled with care:

- it only ever goes into the `Authorization` header of a request to the configured API base;
- it is never put in a log line, an exception message or the client's `repr`;
- httpx errors are re-raised as our own typed errors `from None`, so a traceback can't carry the
  original request (and its headers) along with it.

Each kind of failure has its own error, so callers can decide what to do: `WorkOSNotFound`
(often "already done"), `WorkOSUnauthorized` (a configuration problem), and the retryable
`WorkOSRateLimited`, `WorkOSServerError` and `WorkOSTransportError`.
"""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass
from typing import Any
from urllib.parse import quote

import httpx

WORKOS_API = "https://api.workos.com"
PAGE_LIMIT = 100
MAX_PAGES = 100  # 10,000 sessions; more than that is a bug, not a person
TIMEOUT_SECONDS = 10.0


class WorkOSError(Exception):
    """A WorkOS call didn't succeed. `retryable` says whether trying again later could help."""

    retryable = False

    def __init__(self, message: str, *, status: int | None = None) -> None:
        super().__init__(message)
        self.status = status


class WorkOSNotFound(WorkOSError):
    """The user or session doesn't exist (any more). Deleting or revoking it is already done."""


class WorkOSUnauthorized(WorkOSError):
    """WorkOS refused the API key: it is missing, wrong, revoked or for another environment."""


class WorkOSRateLimited(WorkOSError):
    """Too many requests. `retry_after` is how long WorkOS asked us to wait, when it said."""

    retryable = True

    def __init__(self, message: str, *, retry_after: float | None = None) -> None:
        super().__init__(message, status=429)
        self.retry_after = retry_after


class WorkOSServerError(WorkOSError):
    """WorkOS answered with a 5xx. Its problem, so try again later."""

    retryable = True


class WorkOSTransportError(WorkOSError):
    """WorkOS couldn't be reached at all: DNS, connection, TLS or timeout."""

    retryable = True


@dataclass(frozen=True)
class WorkOSUser:
    """The parts of a WorkOS user Selecta keeps in step with its own `users` row."""

    id: str
    email: str | None
    email_verified: bool
    created_at: float | None


@dataclass(frozen=True)
class WorkOSSession:
    """One AuthKit session: the `sid` in that session's access tokens is this `id`."""

    id: str
    user_id: str
    status: str | None
    created_at: float | None

    @property
    def active(self) -> bool:
        # An unknown or missing status is treated as live, so we revoke rather than skip it.
        return self.status not in {"revoked", "expired", "inactive", "ended"}


def epoch(value: Any) -> float | None:
    """An ISO 8601 time from WorkOS as epoch seconds, or None when it isn't one."""
    if not isinstance(value, str) or not value:
        return None
    try:
        parsed = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=dt.UTC)
    return parsed.timestamp()


def _text(value: Any) -> str | None:
    return value if isinstance(value, str) and value else None


def _user(payload: Any) -> WorkOSUser:
    if not isinstance(payload, dict) or not _text(payload.get("id")):
        raise WorkOSError("WorkOS returned a user without an id.")
    return WorkOSUser(
        id=payload["id"],
        email=_text(payload.get("email")),
        email_verified=payload.get("email_verified") is True,
        created_at=epoch(payload.get("created_at")),
    )


def _session(payload: Any, user_id: str) -> WorkOSSession | None:
    if not isinstance(payload, dict) or not _text(payload.get("id")):
        return None
    return WorkOSSession(
        id=payload["id"],
        user_id=_text(payload.get("user_id")) or user_id,
        status=_text(payload.get("status")),
        created_at=epoch(payload.get("created_at")),
    )


def _retry_after(response: httpx.Response) -> float | None:
    try:
        value = float(response.headers.get("retry-after", ""))
    except ValueError:
        return None
    return value if value >= 0 else None


def _segment(value: str, what: str) -> str:
    if not isinstance(value, str) or not value or len(value) > 255:
        raise ValueError(f"not a WorkOS {what} id")
    return quote(value, safe="")


class WorkOSClient:
    """WorkOS User Management over httpx. Use one per process; `close()` when done."""

    def __init__(
        self,
        api_key: str,
        *,
        api_base: str = WORKOS_API,
        transport: httpx.BaseTransport | None = None,
        timeout: float = TIMEOUT_SECONDS,
    ) -> None:
        if not isinstance(api_key, str) or not api_key.strip():
            raise ValueError("A WorkOS API key is required.")
        self.api_base = api_base.rstrip("/")
        self._http = httpx.Client(
            base_url=self.api_base,
            transport=transport,
            timeout=timeout,
            follow_redirects=False,
            headers={
                "Authorization": f"Bearer {api_key.strip()}",
                "Accept": "application/json",
                "User-Agent": "selecta-cloud",
            },
        )

    def __repr__(self) -> str:
        return f"WorkOSClient(api_base={self.api_base!r})"

    def __enter__(self) -> WorkOSClient:
        return self

    def __exit__(self, *_exc) -> None:
        self.close()

    def close(self) -> None:
        self._http.close()

    def _request(self, method: str, path: str, **kwargs: Any) -> httpx.Response:
        what = f"WorkOS {method} {path.split('?')[0]}"
        try:
            response = self._http.request(method, path, **kwargs)
        except httpx.HTTPError as problem:
            raise WorkOSTransportError(
                f"{what} couldn't reach WorkOS ({type(problem).__name__})."
            ) from None
        status = response.status_code
        if 200 <= status < 300:
            return response
        if status == 404:
            raise WorkOSNotFound(f"{what}: not found.", status=status)
        if status in (401, 403):
            raise WorkOSUnauthorized(f"{what}: WorkOS refused the API key.", status=status)
        if status == 429:
            raise WorkOSRateLimited(f"{what}: rate limited.", retry_after=_retry_after(response))
        if status >= 500:
            raise WorkOSServerError(f"{what}: WorkOS answered HTTP {status}.", status=status)
        raise WorkOSError(f"{what}: WorkOS answered HTTP {status}.", status=status)

    @staticmethod
    def _json(response: httpx.Response) -> Any:
        try:
            return response.json()
        except ValueError:
            raise WorkOSError("WorkOS answered with something that isn't JSON.") from None

    def get_user(self, user_id: str) -> WorkOSUser:
        path = f"/user_management/users/{_segment(user_id, 'user')}"
        return _user(self._json(self._request("GET", path)))

    def list_sessions(self, user_id: str) -> list[WorkOSSession]:
        """Every session of the user, reading every page."""
        path = f"/user_management/users/{_segment(user_id, 'user')}/sessions"
        sessions: list[WorkOSSession] = []
        cursor: str | None = None
        seen: set[str] = set()
        for _page in range(MAX_PAGES):
            params: dict[str, Any] = {"limit": PAGE_LIMIT}
            if cursor:
                params["after"] = cursor
            body = self._json(self._request("GET", path, params=params))
            data = body.get("data") if isinstance(body, dict) else None
            if not isinstance(data, list):
                raise WorkOSError("WorkOS returned a session list without data.")
            for item in data:
                session = _session(item, user_id)
                if session is not None and session.id not in seen:
                    seen.add(session.id)
                    sessions.append(session)
            metadata = body.get("list_metadata")
            cursor = _text(metadata.get("after")) if isinstance(metadata, dict) else None
            if cursor is None or not data:
                return sessions
        raise WorkOSError("WorkOS kept returning more session pages than any user should have.")

    def revoke_session(self, session_id: str) -> None:
        if not isinstance(session_id, str) or not session_id or len(session_id) > 255:
            raise ValueError("not a WorkOS session id")
        self._request(
            "POST", "/user_management/sessions/revoke", json={"session_id": session_id}
        )

    def delete_user(self, user_id: str) -> None:
        self._request("DELETE", f"/user_management/users/{_segment(user_id, 'user')}")


__all__ = [
    "WORKOS_API",
    "WorkOSClient",
    "WorkOSError",
    "WorkOSNotFound",
    "WorkOSRateLimited",
    "WorkOSServerError",
    "WorkOSSession",
    "WorkOSTransportError",
    "WorkOSUnauthorized",
    "WorkOSUser",
    "epoch",
]
