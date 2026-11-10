"""Checking that a webhook really came from WorkOS, and recently (§7A.4).

WorkOS signs each webhook with a secret we share. The `WorkOS-Signature` header looks like
`t=1716222212345, v1=5257a869...`: `t` is when it was sent and each `v1` is an HMAC-SHA256, in hex,
of `"{t}.{raw body}"` under the secret. More than one `v1` can appear while a secret is rotated,
and any one matching is enough.

WorkOS sends `t` in milliseconds. Seconds are accepted too: a number of 10^11 or more can only
be milliseconds (as seconds it would be the year 5138), anything smaller is seconds. The HMAC is
always over `t` exactly as sent.

The check is in two halves so a forgery costs nothing: `verify_signature()` needs no clock or
database and runs first; `check_freshness()` then compares `t` with the database's clock and
refuses anything more than five minutes old or ahead, which stops replays of old deliveries.
Comparisons are constant-time (`hmac.compare_digest`).
"""

from __future__ import annotations

import hashlib
import hmac
from dataclasses import dataclass

HEADER = "WorkOS-Signature"
TOLERANCE_SECONDS = 300.0
MILLISECONDS_FROM = 10**11
MAX_HEADER_LENGTH = 4096
MAX_SIGNATURES = 8


class SignatureError(Exception):
    """The webhook can't be trusted. `reason` is a short code that is safe to return and log."""

    def __init__(self, reason: str, message: str) -> None:
        super().__init__(message)
        self.reason = reason


@dataclass(frozen=True)
class SignedHeader:
    timestamp: str
    signatures: tuple[str, ...]

    @property
    def sent_at(self) -> float:
        """When WorkOS sent it, in epoch seconds, whether `t` was milliseconds or seconds."""
        value = int(self.timestamp)
        return value / 1000.0 if value >= MILLISECONDS_FROM else float(value)


def parse_header(header: str | None) -> SignedHeader:
    """Split the header into its timestamp and signatures, refusing anything odd."""
    if header is None or not header.strip():
        raise SignatureError("signature_missing", "The WorkOS-Signature header is missing.")
    if len(header) > MAX_HEADER_LENGTH:
        raise SignatureError("signature_malformed", "The WorkOS-Signature header is too long.")
    timestamp: str | None = None
    signatures: list[str] = []
    for part in header.split(","):
        key, sep, value = part.strip().partition("=")
        key, value = key.strip(), value.strip()
        if not sep or not value:
            raise SignatureError("signature_malformed", "The WorkOS-Signature header is malformed.")
        if key == "t":
            if timestamp is not None or not value.isascii() or not value.isdigit():
                raise SignatureError("signature_malformed", "The signature timestamp is invalid.")
            timestamp = value
        elif key == "v1":
            signatures.append(value.lower())
        # Other schemes (a future v2) are ignored, as WorkOS asks.
    if timestamp is None or not signatures:
        raise SignatureError(
            "signature_malformed", "The WorkOS-Signature header needs a t and a v1 value."
        )
    if len(signatures) > MAX_SIGNATURES:
        raise SignatureError("signature_malformed", "The header carries too many signatures.")
    return SignedHeader(timestamp, tuple(signatures))


def expected_signature(raw_body: bytes, timestamp: str, secret: str) -> str:
    """The hex HMAC-SHA256 WorkOS computes for this body and timestamp."""
    message = timestamp.encode("ascii") + b"." + raw_body
    return hmac.new(secret.encode("utf-8"), message, hashlib.sha256).hexdigest()


def sign(raw_body: bytes, secret: str, timestamp: int | str) -> str:
    """A header WorkOS would send, for tests and local tools."""
    stamp = str(timestamp)
    return f"t={stamp}, v1={expected_signature(raw_body, stamp, secret)}"


def verify_signature(raw_body: bytes, header: str | None, secret: str) -> SignedHeader:
    """Raise `SignatureError` unless one `v1` matches. Doesn't look at the time; see below."""
    if not secret:
        raise SignatureError("webhook_unconfigured", "No WorkOS webhook secret is configured.")
    parsed = parse_header(header)
    expected = expected_signature(raw_body, parsed.timestamp, secret)
    matched = False
    for candidate in parsed.signatures:
        # Check every candidate so the time taken doesn't say which one matched.
        matched |= hmac.compare_digest(expected, candidate)
    if not matched:
        raise SignatureError("signature_mismatch", "The webhook signature doesn't match.")
    return parsed


def check_freshness(
    signed: SignedHeader, now: float, tolerance: float = TOLERANCE_SECONDS
) -> float:
    """Refuse a webhook sent more than `tolerance` seconds before or after `now`."""
    sent_at = signed.sent_at
    if abs(now - sent_at) > tolerance:
        raise SignatureError(
            "signature_expired", "The webhook timestamp is outside the 5-minute window."
        )
    return sent_at


def verify(
    raw_body: bytes,
    header: str | None,
    secret: str,
    now: float,
    tolerance: float = TOLERANCE_SECONDS,
) -> float:
    """Both checks together. Returns when WorkOS sent it, in epoch seconds."""
    return check_freshness(verify_signature(raw_body, header, secret), now, tolerance)


__all__ = [
    "HEADER",
    "SignatureError",
    "SignedHeader",
    "TOLERANCE_SECONDS",
    "check_freshness",
    "expected_signature",
    "parse_header",
    "sign",
    "verify",
    "verify_signature",
]
