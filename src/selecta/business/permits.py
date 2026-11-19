"""The kiosk's signed offline bundle and permit (ADR-0446 BZ-0446-05, BZ-0446-06).

With every horizon the kiosk gets a bundle signed with Ed25519: the venue's opening periods for
the next 7 days with its time zone, the zone's programme version, its volume, and the **offline
permit** (organisation, venue, zone, device, plan state, the licence's expiry and grace end, a
stop instant set by a pilot end, the issue time and `valid_until` 7 days on). The kiosk checks
the signature against the keys it trusts and refuses a bundle that fails it or is older than the
one it holds, so being offline can never extend what the server would allow.

- **Exact bytes.** The bundle travels as the JSON text that was signed (`bundle`), so the kiosk
  verifies those bytes and only then parses them; no canonical form has to match across
  languages.
- **Keys and rotation.** `SELECTA_KIOSK_PERMIT_KEYS` holds base64url raw 32-byte Ed25519 private
  keys, comma separated: the first signs, all are published. Every bundle lists the public keys
  (`keys`), so a kiosk that verified it with a key it trusts also learns the next key before
  the old one retires (rotation with overlap). Without the setting, a process key is made at
  start for local development and tests; a kiosk then has to be online after each restart of
  the server to learn it, which the setup docs say is development only.
"""

from __future__ import annotations

import base64
import hashlib
import json
import logging
import os
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from functools import lru_cache
from typing import Any

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey

log = logging.getLogger(__name__)

KEY_ENV = "SELECTA_KIOSK_PERMIT_KEYS"
PERMIT_S = 7 * 86_400.0
WINDOW_S = 7 * 86_400.0
VERSION = 1


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def _raw_public(key: Ed25519PrivateKey | Ed25519PublicKey) -> bytes:
    public = key.public_key() if isinstance(key, Ed25519PrivateKey) else key
    return public.public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)


def key_id(key: Ed25519PrivateKey | Ed25519PublicKey) -> str:
    return hashlib.sha256(_raw_public(key)).hexdigest()[:16]


@dataclass(frozen=True)
class Keyring:
    keys: tuple[Ed25519PrivateKey, ...]

    @property
    def signer(self) -> Ed25519PrivateKey:
        return self.keys[0]

    def public(self) -> list[dict[str, str]]:
        return [{"key_id": key_id(k), "public_key": _b64(_raw_public(k))} for k in self.keys]


def keyring_from(text: str | None) -> Keyring:
    """Keys from the setting's text, or one fresh process key when it is empty."""
    parts = [part.strip() for part in (text or "").split(",") if part.strip()]
    if not parts:
        log.warning("%s is not set: kiosk permits use a key made for this process only.", KEY_ENV)
        return Keyring((Ed25519PrivateKey.generate(),))
    return Keyring(tuple(Ed25519PrivateKey.from_private_bytes(_unb64(part)) for part in parts))


@lru_cache(maxsize=1)
def default_keyring() -> Keyring:
    return keyring_from(os.environ.get(KEY_ENV))


def sign(body: Mapping[str, Any], keyring: Keyring | None = None) -> dict[str, Any]:
    """The signed bundle as it travels: the exact JSON text, its signature and the key id."""
    ring = keyring or default_keyring()
    text = json.dumps(
        {**body, "v": VERSION, "keys": ring.public()}, separators=(",", ":"), sort_keys=True
    )
    return {
        "bundle": text,
        "signature": _b64(ring.signer.sign(text.encode("utf-8"))),
        "key_id": key_id(ring.signer),
    }


class PermitRefused(ValueError):
    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


def verify(
    signed: Mapping[str, Any],
    trusted: Sequence[str],
    *,
    held_issued_at: float | None = None,
) -> dict[str, Any]:
    """The kiosk's rule, here for tests and shared vectors: the body when the signature verifies
    with a trusted public key (base64url raw) and it is not older than the held one."""
    text = str(signed.get("bundle") or "")
    try:
        signature = _unb64(str(signed.get("signature") or ""))
    except ValueError:
        raise PermitRefused("forged") from None
    for public in trusted:
        try:
            Ed25519PublicKey.from_public_bytes(_unb64(public)).verify(
                signature, text.encode("utf-8")
            )
        except (InvalidSignature, ValueError):
            continue
        body = json.loads(text)
        if held_issued_at is not None and float(body["permit"]["issued_at"]) < held_issued_at:
            raise PermitRefused("older")
        return body
    raise PermitRefused("forged")


def may_play(permit: Mapping[str, Any], now: float, *, open_period_close: float | None) -> bool:
    """Shared rule (server and kiosk): inside `valid_until`, or past it only until the end of
    the open period that was already playing; never past a stop instant or the licence grace."""
    stop_at = permit.get("stop_at")
    if isinstance(stop_at, (int, float)) and now >= stop_at:
        return False
    grace = permit.get("licence_grace_ends_at")
    if isinstance(grace, (int, float)) and now >= grace:
        return False
    if now <= float(permit["valid_until"]):
        return True
    return open_period_close is not None and now < open_period_close


def build_body(
    conn: Any,
    *,
    workspace_id: str,
    venue_id: str | None,
    zone_id: str,
    device_id: str,
    schedule: Mapping[str, Any] | None,
    volume: int | None,
    now: float,
) -> dict[str, Any]:
    """What the bundle says, from the server's own records."""
    import sqlalchemy as sa

    from selecta.identity.schema import workspaces

    pilot_until = conn.execute(
        sa.select(workspaces.c.pilot_until).where(workspaces.c.id == workspace_id)
    ).scalar()
    licence_expires = licence_grace = None
    if venue_id is not None:
        from selecta.business import licensing

        licence = licensing.current_licence(conn, venue_id)
        if licence is not None:
            licence_expires = float(licence["expires_at"])
            licence_grace = float(licensing.grace_ends_at(conn, licence))
    periods = [
        {"opens_at": p["opens_at"], "closes_at": p["closes_at"]}
        for p in (schedule or {}).get("periods", [])
        if p.get("closes_at", 0) > now and p.get("opens_at", 0) < now + WINDOW_S
    ]
    return {
        "time_zone": (schedule or {}).get("time_zone"),
        "periods": periods,
        "programme_version": (schedule or {}).get("programme_version"),
        "volume": volume,
        "permit": {
            "organisation_id": workspace_id,
            "venue_id": venue_id,
            "zone_id": zone_id,
            "device_id": device_id,
            "plan_state": "pilot" if pilot_until else "paid",
            "stop_at": float(pilot_until) if pilot_until else None,
            "licence_expires_at": licence_expires,
            "licence_grace_ends_at": licence_grace,
            "issued_at": now,
            "valid_until": now + PERMIT_S,
        },
    }


__all__ = [
    "KEY_ENV",
    "PERMIT_S",
    "Keyring",
    "PermitRefused",
    "build_body",
    "default_keyring",
    "key_id",
    "keyring_from",
    "may_play",
    "sign",
    "verify",
]
