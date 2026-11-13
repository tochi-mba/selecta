"""Transactional email: one small adapter interface, with Postmark and Resend behind it.

docs/saas/13-hosting-and-cost.md picks "Postmark or Resend, transactional only". WorkOS still
sends every sign-in email and Stripe its own billing emails; this sends the ones the design
promises on top (docs/saas/11-ui-ux.md: long jobs finishing, over quota, storage deletion
warnings; docs/saas/19a-venue-operations.md: silent-zone alerts).

Settings (all on the maintenance service, which sends them):

- `SELECTA_EMAIL_PROVIDER`: `postmark` or `resend`. Unset means no email is sent.
- `SELECTA_EMAIL_API_KEY`: the provider's server token (Postmark) or API key (Resend).
- `SELECTA_EMAIL_FROM`: the sending address on the verified domain. The display name is always
  "SelectaDJ", so mail arrives as `SelectaDJ <notifications@your-domain>`.

The `cloud.email` flag turns sending off without touching the settings.
"""

from __future__ import annotations

import json
import re
from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Protocol

import httpx

from selecta import flags

FLAG = "cloud.email"
SENDER_NAME = "SelectaDJ"
COMPANY = "REX Technologies"
PROVIDERS = ("postmark", "resend")
SETTINGS = ("SELECTA_EMAIL_PROVIDER", "SELECTA_EMAIL_API_KEY", "SELECTA_EMAIL_FROM")
POSTMARK_URL = "https://api.postmarkapp.com/email"
RESEND_URL = "https://api.resend.com/emails"
TIMEOUT_S = 15.0

_ADDRESS = re.compile(r"^[^@\s<>\"]+@[^@\s<>\"]+\.[A-Za-z]{2,}$")


@dataclass(frozen=True)
class Message:
    to: str
    subject: str
    text: str
    html: str
    kind: str
    """What it is about (`long_job_finished`, `over_quota`, ...), sent as the provider's tag."""
    idempotency_key: str = ""
    """Stable per email, so a retried send is not delivered twice where the provider can tell."""
    metadata: Mapping[str, str] = field(default_factory=dict)


class EmailError(Exception):
    """A send that failed. `retry` says whether trying again later can help."""

    def __init__(self, message: str, *, retry: bool) -> None:
        super().__init__(message)
        self.retry = retry


class Sender(Protocol):
    def send(self, message: Message) -> str:
        """Hand `message` to the provider; returns its message id. Raises EmailError."""
        ...


def from_header(address: str) -> str:
    return f"{SENDER_NAME} <{address}>"


def valid_address(address: str | None) -> bool:
    return bool(address) and bool(_ADDRESS.match(address.strip()))


def _raise_for(response: httpx.Response, provider: str) -> None:
    if response.status_code < 400:
        return
    # 429 and 5xx are the provider's trouble and pass; other 4xx (bad address, suppressed
    # recipient, unverified sender) will fail the same way every time.
    retry = response.status_code == 429 or response.status_code >= 500
    raise EmailError(f"{provider} refused the email ({response.status_code})", retry=retry)


class _HttpSender:
    provider = ""

    def __init__(self, api_key: str, from_address: str, client: httpx.Client | None = None):
        if not valid_address(from_address):
            raise ValueError("SELECTA_EMAIL_FROM must be an email address on your domain.")
        self.api_key = api_key
        self.from_address = from_address.strip()
        self.client = client or httpx.Client(timeout=TIMEOUT_S)

    def _post(self, url: str, headers: dict[str, str], body: dict) -> dict:
        try:
            response = self.client.post(url, headers=headers, content=json.dumps(body))
        except httpx.HTTPError as error:
            raise EmailError(
                f"{self.provider} unreachable: {type(error).__name__}", retry=True
            ) from error
        _raise_for(response, self.provider)
        try:
            return response.json()
        except ValueError:
            return {}


class PostmarkSender(_HttpSender):
    provider = "postmark"

    def send(self, message: Message) -> str:
        body = {
            "From": from_header(self.from_address),
            "To": message.to,
            "Subject": message.subject,
            "TextBody": message.text,
            "HtmlBody": message.html,
            "Tag": message.kind,
            "MessageStream": "outbound",
            "TrackOpens": False,
            "TrackLinks": "None",
            "Metadata": dict(message.metadata),
        }
        headers = {
            "Accept": "application/json",
            "Content-Type": "application/json",
            "X-Postmark-Server-Token": self.api_key,
        }
        answer = self._post(POSTMARK_URL, headers, body)
        return str(answer.get("MessageID", ""))


class ResendSender(_HttpSender):
    provider = "resend"

    def send(self, message: Message) -> str:
        body = {
            "from": from_header(self.from_address),
            "to": [message.to],
            "subject": message.subject,
            "text": message.text,
            "html": message.html,
            "tags": [{"name": "kind", "value": message.kind}],
        }
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }
        if message.idempotency_key:
            headers["Idempotency-Key"] = message.idempotency_key[:256]
        answer = self._post(RESEND_URL, headers, body)
        return str(answer.get("id", ""))


class RecordingSender:
    """Keeps every message instead of sending it (tests, and local development)."""

    def __init__(self) -> None:
        self.sent: list[Message] = []

    def send(self, message: Message) -> str:
        self.sent.append(message)
        return f"recorded-{len(self.sent)}"


def configured(env: Mapping[str, str]) -> str | None:
    """None when sending can be set up from `env`, else what is missing, in plain words."""
    missing = [name for name in SETTINGS if not env.get(name, "").strip()]
    if missing:
        return "set " + ", ".join(missing)
    provider = env["SELECTA_EMAIL_PROVIDER"].strip().lower()
    if provider not in PROVIDERS:
        return f"SELECTA_EMAIL_PROVIDER is one of {', '.join(PROVIDERS)}"
    if not valid_address(env["SELECTA_EMAIL_FROM"]):
        return "SELECTA_EMAIL_FROM must be an email address"
    return None


def sender_from_environment(
    env: Mapping[str, str], client: httpx.Client | None = None
) -> Sender | None:
    """The configured sender, or None when email isn't set up (see `configured`)."""
    if configured(env) is not None:
        return None
    kind = {"postmark": PostmarkSender, "resend": ResendSender}
    provider = env["SELECTA_EMAIL_PROVIDER"].strip().lower()
    return kind[provider](
        env["SELECTA_EMAIL_API_KEY"].strip(), env["SELECTA_EMAIL_FROM"], client=client
    )


def enabled() -> bool:
    try:
        return flags.on(FLAG)
    except KeyError:
        return False


__all__ = [
    "COMPANY",
    "FLAG",
    "SENDER_NAME",
    "EmailError",
    "Message",
    "PostmarkSender",
    "RecordingSender",
    "ResendSender",
    "Sender",
    "configured",
    "enabled",
    "from_header",
    "sender_from_environment",
    "valid_address",
]
