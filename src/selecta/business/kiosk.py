"""Kiosk players: pairing by code, the kiosk token and device key, versions, unpair and replace
(ADR-0445, BZ-0445-02, 03, 08, 11).

- **Pairing.** An unpaired kiosk calls `start_pairing` with the public half of a non-extractable
  WebCrypto P-256 key and a random machine id. It gets a six-character code (10 minutes, single
  use, stored only as a keyed hash) and a status secret it polls with. A manager holding
  `business.devices.pair` at the zone's venue types the code (`pair`). The kiosk's next status
  poll collects its **kiosk token** once (`collect`); the token goes into an HttpOnly cookie.
- **Kiosk token and device key.** Only the token's SHA-256 is stored. Each heartbeat signs the
  nonce from the previous answer with the device key (`verify_heartbeat`). A copied cookie on
  another machine has no private key: its heartbeat is refused with `kiosk_key_mismatch` and the
  zone's managers get a `key_mismatch` alert. A signature that is valid for an older nonce (a lost
  answer, a retry) is the real device: it gets the current nonce back, with no alert. Tokens
  rotate every 7 days on a heartbeat; unpair and replace revoke at once.
- **Limits.** At most 2 kiosks per zone (home and standby, ADR-0443), 50 per organisation in
  pilots. Kiosks are `devices` rows with `principal = 'kiosk'` and no person, so they never count
  against anyone's ten-device limit.
- **Versions.** The server accepts the current and previous two kiosk versions, and a superseded
  version for 14 days after the release that pushed it out (`version_supported`).

The unpaired pairing row has no workspace yet, so lookups by code, status secret or token run
without one (like `rooms.display`); everything after is filtered by workspace explicitly.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
from dataclasses import dataclass
from typing import Any

import sqlalchemy as sa
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import encode_dss_signature
from sqlalchemy.engine import Connection, Engine

from selecta.business.access import BusinessForbidden, BusinessNotFound
from selecta.business.access import guard as business_guard
from selecta.persistence import db_now, new_id, transaction
from selecta.playback.model import Capabilities
from selecta.playback.schema import devices, playback_sessions
from selecta.playback.zone_schema import kiosk_pairings, kiosk_tokens, zone_alerts
from selecta.rooms import codes

PAIRING_SECONDS = 600.0
PAIRING_ATTEMPTS = 8
TOKEN_ROTATE_S = 7 * 86_400.0
PAIRED_FOREVER_S = 100 * 365 * 86_400.0
MAX_KIOSKS_PER_ZONE = 2
MAX_KIOSKS_PER_ORG = 50
SIGNED_PREFIX = "selecta-kiosk-heartbeat:"
ONLINE_WITHIN_S = 120.0

TOKEN_COOKIE = "selecta_kiosk"
PAIRING_COOKIE = "selecta_kiosk_pairing"
COOKIE_PATH = "/api/kiosk"

# (version, released at, urgent). The kiosk app's own version is web/src/kiosk/version.ts.
KIOSK_RELEASES: tuple[tuple[str, float, bool], ...] = (("2026.11.1", 1_795_046_400.0, False),)
SUPPORTED_RELEASES = 3
SUPERSEDED_GRACE_S = 14 * 86_400.0


class KioskError(Exception):
    """A refusal with a stable code; the routes map `status` to the HTTP answer."""

    def __init__(self, code: str, message: str, status: int = 400) -> None:
        super().__init__(message)
        self.code = code
        self.status = status


@dataclass(frozen=True)
class KioskAuth:
    """Who a kiosk token belongs to."""

    token_id: str
    workspace_id: str
    device_id: str
    zone_id: str
    venue_id: str | None
    device_name: str
    public_key: str
    nonce: str
    role: str | None
    rotate_from: float  # created or last rotated


# ---- helpers


def _b64url_decode(text: str) -> bytes:
    text = (text or "").strip()
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def _hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _code_hash(code: str, pepper: bytes) -> str:
    normal = codes.normalise(code, codes.PAIRING_CODE_LENGTH)
    return hmac.new(pepper, f"kiosk-pairing-code:{normal}".encode(), hashlib.sha256).hexdigest()


def load_public_key(text: str) -> ec.EllipticCurvePublicKey:
    """The kiosk's P-256 public key from base64url SPKI DER; ValueError for anything else."""
    try:
        key = serialization.load_der_public_key(_b64url_decode(text))
    except Exception as error:  # noqa: BLE001 - any parse failure is a bad key
        raise ValueError("not a public key") from error
    if not isinstance(key, ec.EllipticCurvePublicKey) or key.curve.name != "secp256r1":
        raise ValueError("the device key must be ECDSA P-256")
    return key


def signature_valid(public_key: str, nonce: str, signature: str) -> bool:
    """WebCrypto's ECDSA P-256 SHA-256 signature (raw r||s, or DER) over the signed nonce."""
    try:
        key = load_public_key(public_key)
        raw = _b64url_decode(signature)
    except (ValueError, TypeError):
        return False
    if len(raw) == 64:
        raw = encode_dss_signature(int.from_bytes(raw[:32], "big"), int.from_bytes(raw[32:], "big"))
    try:
        key.verify(raw, f"{SIGNED_PREFIX}{nonce}".encode(), ec.ECDSA(hashes.SHA256()))
    except (InvalidSignature, ValueError):
        return False
    return True


def version_supported(
    version: str | None, now: float, releases: tuple[tuple[str, float, bool], ...] = KIOSK_RELEASES
) -> bool:
    """The current and previous two versions; an older one until 14 days after the release that
    pushed it out of those three."""
    names = [name for name, _at, _urgent in releases]
    if not version or version not in names:
        return False
    index = names.index(version)
    if index >= len(names) - SUPPORTED_RELEASES:
        return True
    pushed_out_at = releases[index + SUPPORTED_RELEASES][1]
    return now < pushed_out_at + SUPERSEDED_GRACE_S


def latest_release() -> dict[str, Any]:
    name, released_at, urgent = KIOSK_RELEASES[-1]
    return {"version": name, "released_at": released_at, "urgent": urgent}


def clean_name(name: str | None, fallback: str = "Player") -> str:
    text = " ".join((name or "").replace("\x00", " ").split())[:60]
    return text or fallback


# ---- pairing (the kiosk side)


def start_pairing(
    engine: Engine,
    pepper: bytes,
    *,
    public_key: str,
    machine_id: str,
    device_name: str | None = None,
    now: float | None = None,
) -> dict[str, Any]:
    """A new pairing code for an unpaired kiosk. Returns the code, the status secret (for the
    pairing cookie) and when the code expires."""
    load_public_key(public_key)
    machine = _hash(f"kiosk-machine:{(machine_id or '').strip()}")
    secret = secrets.token_urlsafe(32)
    with transaction(engine) as conn:
        now = db_now(conn) if now is None else now
        for _ in range(PAIRING_ATTEMPTS):
            code = codes.generate(codes.PAIRING_CODE_LENGTH)
            digest = _code_hash(code, pepper)
            conn.execute(
                sa.delete(kiosk_pairings).where(
                    kiosk_pairings.c.pairing_code_hash == digest,
                    kiosk_pairings.c.paired_at.is_(None),
                    kiosk_pairings.c.expires_at <= now,
                )
            )
            try:
                with conn.begin_nested():
                    conn.execute(
                        kiosk_pairings.insert().values(
                            id=new_id(),
                            workspace_id=None,
                            pairing_code_hash=digest,
                            status_secret_hash=_hash(secret),
                            machine_fingerprint=machine,
                            public_key=public_key.strip(),
                            device_name=clean_name(device_name),
                            created_at=now,
                            expires_at=now + PAIRING_SECONDS,
                        )
                    )
            except sa.exc.IntegrityError:
                continue
            _alert_needs_pairing_again(conn, machine, now)
            return {
                "pairing_code": code,
                "status_secret": secret,
                "expires_at": now + PAIRING_SECONDS,
                "server_time": now,
            }
    raise RuntimeError("Couldn't find an unused pairing code")


def _alert_needs_pairing_again(conn: Connection, machine: str, now: float) -> None:
    """A machine that is still paired somewhere asks for a new code: its pairing was lost (the
    browser's storage was cleared). Tell that zone's managers."""
    rows = conn.execute(
        sa.select(devices.c.id, devices.c.workspace_id, devices.c.zone_id).where(
            devices.c.machine_fingerprint == machine,
            devices.c.principal == "kiosk",
            devices.c.signed_out_at.is_(None),
        )
    ).all()
    for row in rows:
        if row.zone_id:
            open_alert(
                conn, row.workspace_id, row.zone_id, row.id, "needs_pairing", "pairing_lost", now
            )


def collect(engine: Engine, status_secret: str, *, now: float | None = None) -> dict[str, Any]:
    """The unpaired kiosk's poll. Once a manager has paired it, the first poll hands over the
    kiosk token (once) and the first nonce to sign."""
    with transaction(engine) as conn:
        now = db_now(conn) if now is None else now
        row = (
            conn.execute(
                sa.select(kiosk_pairings).where(
                    kiosk_pairings.c.status_secret_hash == _hash(status_secret or "")
                )
            )
            .mappings()
            .first()
        )
        if row is None:
            return {"state": "unknown", "server_time": now}
        if row["revoked_at"] is not None:
            return {"state": "revoked", "server_time": now}
        if row["paired_at"] is None:
            state = "expired" if row["expires_at"] <= now else "waiting"
            return {"state": state, "expires_at": row["expires_at"], "server_time": now}
        if row["collected_at"] is not None:
            return {"state": "collected", "device_id": row["device_id"], "server_time": now}
        token = codes.new_token()
        nonce = secrets.token_urlsafe(24)
        conn.execute(
            kiosk_tokens.insert().values(
                id=new_id(),
                workspace_id=row["workspace_id"],
                device_id=row["device_id"],
                token_hash=_hash(token),
                nonce=nonce,
                nonce_issued_at=now,
                created_at=now,
            )
        )
        conn.execute(
            sa.update(kiosk_pairings)
            .where(kiosk_pairings.c.id == row["id"])
            .values(collected_at=now)
        )
        return {
            "state": "paired",
            "token": token,
            "nonce": nonce,
            "device_id": row["device_id"],
            "device_name": row["device_name"],
            "server_time": now,
        }


# ---- pairing (the manager side)


def _actor(conn: Connection, workspace_id: str, user_id: str):
    return business_guard.actor_for(
        conn, user_id=user_id, organisation_id=workspace_id, workspace_id=workspace_id
    )


def _zone_row(conn: Connection, workspace_id: str, zone_id: str):
    from selecta.business.schema import zones

    return (
        conn.execute(
            sa.select(zones).where(zones.c.workspace_id == workspace_id, zones.c.id == zone_id)
        )
        .mappings()
        .first()
    )


def _live_kiosks(conn: Connection, workspace_id: str, zone_id: str | None = None) -> list[str]:
    query = sa.select(devices.c.id).where(
        devices.c.workspace_id == workspace_id,
        devices.c.principal == "kiosk",
        devices.c.signed_out_at.is_(None),
    )
    if zone_id is not None:
        query = query.where(devices.c.zone_id == zone_id)
    return [row.id for row in conn.execute(query)]


def pair(
    engine: Engine,
    pepper: bytes,
    *,
    workspace_id: str,
    user_id: str,
    code: str,
    zone_id: str,
    name: str | None = None,
    replace_device_id: str | None = None,
    now: float | None = None,
) -> dict[str, Any]:
    """A manager types the kiosk's code and picks the zone. `replace_device_id` makes the new
    kiosk the zone's home and revokes the old one at once ("Replace Bar player")."""
    try:
        digest = _code_hash(code, pepper)
    except codes.InvalidCode:
        raise KioskError("invalid_code", "That code isn't one a player shows.", 400) from None
    from selecta.business.schema import zones

    with transaction(engine) as conn:
        now = db_now(conn) if now is None else now
        actor = _actor(conn, workspace_id, user_id)
        zone = _zone_row(conn, workspace_id, zone_id)
        if zone is None or zone["status"] == "archived":
            raise BusinessNotFound()
        business_guard.require(conn, actor, "business.devices.pair", zone_id=zone_id)
        on_zone = _live_kiosks(conn, workspace_id, zone_id)
        if replace_device_id is not None:
            if replace_device_id not in on_zone:
                raise BusinessNotFound()
            business_guard.require(conn, actor, "business.devices.unpair", zone_id=zone_id)
        elif len(on_zone) >= MAX_KIOSKS_PER_ZONE:
            raise KioskError(
                "zone_full",
                f"{zone['name']} already has a home and a standby player. Replace one instead.",
                409,
            )
        if (
            replace_device_id is None
            and len(_live_kiosks(conn, workspace_id)) >= MAX_KIOSKS_PER_ORG
        ):
            raise KioskError("kiosk_limit", "This organisation has reached its player limit.", 409)
        pairing = (
            conn.execute(
                sa.select(kiosk_pairings).where(
                    kiosk_pairings.c.pairing_code_hash == digest,
                    kiosk_pairings.c.paired_at.is_(None),
                    kiosk_pairings.c.expires_at > now,
                )
            )
            .mappings()
            .first()
        )
        if pairing is None:
            raise KioskError("no_such_pairing", "That code has expired or was already used.", 404)
        warning = _machine_warning(conn, workspace_id, pairing["machine_fingerprint"], zone_id)
        if replace_device_id is not None:
            _revoke_device(conn, workspace_id, replace_device_id, now, "replaced")
            zone = _zone_row(conn, workspace_id, zone_id)
        device_id = new_id()
        device_name = clean_name(name, f"{zone['name']} player")
        conn.execute(
            devices.insert().values(
                id=device_id,
                workspace_id=workspace_id,
                user_id=None,
                principal="kiosk",
                zone_id=zone_id,
                machine_fingerprint=pairing["machine_fingerprint"],
                name=device_name,
                kind="desktop",
                capabilities=Capabilities(can_play_audio=True, wake_lock=True).to_json(),
                created_at=now,
                last_seen_at=now,
                signed_out_at=None,
            )
        )
        home, standby = zone["home_device_id"], zone["standby_device_id"]
        if replace_device_id is not None or home is None:
            home, role = device_id, "home"
        else:
            standby, role = device_id, "standby"
        conn.execute(
            sa.update(zones)
            .where(zones.c.workspace_id == workspace_id, zones.c.id == zone_id)
            .values(home_device_id=home, standby_device_id=standby)
        )
        conn.execute(
            sa.update(kiosk_pairings)
            .where(kiosk_pairings.c.id == pairing["id"])
            .values(
                workspace_id=workspace_id,
                venue_id=zone["venue_id"],
                zone_id=zone_id,
                device_id=device_id,
                device_name=device_name,
                pairing_code_hash=None,
                role=role,
                paired_by=user_id,
                paired_at=now,
                expires_at=now + PAIRED_FOREVER_S,
            )
        )
        _close_alerts(conn, workspace_id, zone_id, ("needs_pairing",), now)
    return {
        "id": device_id,
        "name": device_name,
        "kind": "kiosk",
        "zone_id": zone_id,
        "role": role,
        "online": False,
        "last_seen_at": None,
        "warning": warning,
    }


def _machine_warning(conn: Connection, workspace_id: str, machine: str, zone_id: str) -> str | None:
    """A second zone paired from the same machine (ADR-0443) is allowed, with a warning."""
    from selecta.business.schema import zones

    row = conn.execute(
        sa.select(zones.c.name)
        .select_from(devices.join(zones, devices.c.zone_id == zones.c.id))
        .where(
            devices.c.workspace_id == workspace_id,
            devices.c.machine_fingerprint == machine,
            devices.c.principal == "kiosk",
            devices.c.signed_out_at.is_(None),
            devices.c.zone_id != zone_id,
        )
    ).first()
    if row is None:
        return None
    return (
        f"This machine is also the {row.name} player. One machine can only play one zone at a time."
    )


# ---- tokens and heartbeats


def authenticate(conn: Connection, token: str | None) -> KioskAuth:
    """The kiosk a token belongs to, or `kiosk_revoked` (401) for anything else."""
    if not token:
        raise KioskError("kiosk_not_paired", "This player isn't paired.", 401)
    found = conn.execute(
        sa.select(
            kiosk_tokens.c.id,
            kiosk_tokens.c.workspace_id,
            kiosk_tokens.c.device_id,
            kiosk_tokens.c.nonce,
            kiosk_tokens.c.created_at,
            kiosk_tokens.c.rotated_at,
            kiosk_pairings.c.zone_id,
            kiosk_pairings.c.venue_id,
            kiosk_pairings.c.public_key,
            kiosk_pairings.c.role,
            devices.c.name,
        )
        .select_from(
            kiosk_tokens.join(
                kiosk_pairings,
                sa.and_(
                    kiosk_pairings.c.device_id == kiosk_tokens.c.device_id,
                    kiosk_pairings.c.workspace_id == kiosk_tokens.c.workspace_id,
                ),
            ).join(devices, devices.c.id == kiosk_tokens.c.device_id)
        )
        .where(
            kiosk_tokens.c.token_hash == _hash(token),
            kiosk_tokens.c.revoked_at.is_(None),
            kiosk_pairings.c.revoked_at.is_(None),
            devices.c.signed_out_at.is_(None),
        )
    ).first()
    if found is None:
        raise KioskError("kiosk_revoked", "This player was unpaired or replaced.", 401)
    return KioskAuth(
        token_id=found.id,
        workspace_id=found.workspace_id,
        device_id=found.device_id,
        zone_id=found.zone_id,
        venue_id=found.venue_id,
        device_name=found.name,
        public_key=found.public_key,
        nonce=found.nonce,
        role=found.role,
        rotate_from=found.rotated_at or found.created_at,
    )


@dataclass(frozen=True)
class Verified:
    auth: KioskAuth
    nonce: str
    new_token: str | None  # set when the token rotated; the route sets the new cookie
    server_time: float


def verify_heartbeat(
    engine: Engine,
    token: str | None,
    *,
    nonce: str | None,
    signature: str | None,
    kiosk_version: str | None,
    now: float | None = None,
) -> Verified:
    """Check the device key's signature over the nonce, the app version, then hand out the next
    nonce (and a rotated token every 7 days)."""
    with transaction(engine) as conn:
        now = db_now(conn) if now is None else now
        auth = authenticate(conn, token)
    if not signature or not nonce or not signature_valid(auth.public_key, nonce, signature):
        with transaction(engine, auth.workspace_id) as conn:
            open_alert(
                conn,
                auth.workspace_id,
                auth.zone_id,
                auth.device_id,
                "key_mismatch",
                "copied_sign_in",
                now,
                notify_now=True,
            )
        raise KioskError("kiosk_key_mismatch", "This player's sign-in was refused.", 401)
    if not version_supported(kiosk_version, now):
        raise KioskError("kiosk_update_required", "This player needs an update.", 426)
    with transaction(engine, auth.workspace_id) as conn:
        current = conn.execute(
            sa.select(kiosk_tokens.c.nonce).where(kiosk_tokens.c.id == auth.token_id)
        ).scalar_one()
        if not hmac.compare_digest(current, nonce):
            # The real key over an old nonce: a retry after a lost answer, never a copy.
            raise KioskError("kiosk_nonce_stale", current, 409)
        fresh = secrets.token_urlsafe(24)
        values: dict[str, Any] = {"nonce": fresh, "nonce_issued_at": now}
        new_token = None
        if now - auth.rotate_from >= TOKEN_ROTATE_S:
            new_token = codes.new_token()
            values.update(token_hash=_hash(new_token), rotated_at=now)
        conn.execute(
            sa.update(kiosk_tokens).where(kiosk_tokens.c.id == auth.token_id).values(**values)
        )
        _close_alerts(conn, auth.workspace_id, auth.zone_id, ("key_mismatch",), now, auth.device_id)
    return Verified(auth, fresh, new_token, now)


# ---- unpair and replace


def _revoke_device(
    conn: Connection, workspace_id: str, device_id: str, now: float, reason: str
) -> None:
    """Revoke the kiosk's tokens and pairing, sign the device out, give its zone role to the
    standby, and drop its lease so it fades out at its next heartbeat."""
    from selecta.business.schema import zones

    conn.execute(
        sa.update(kiosk_tokens)
        .where(
            kiosk_tokens.c.workspace_id == workspace_id,
            kiosk_tokens.c.device_id == device_id,
            kiosk_tokens.c.revoked_at.is_(None),
        )
        .values(revoked_at=now, revoked_reason=reason)
    )
    conn.execute(
        sa.update(kiosk_pairings)
        .where(
            kiosk_pairings.c.workspace_id == workspace_id,
            kiosk_pairings.c.device_id == device_id,
            kiosk_pairings.c.revoked_at.is_(None),
        )
        .values(revoked_at=now, revoked_reason=reason)
    )
    conn.execute(
        sa.update(devices)
        .where(devices.c.workspace_id == workspace_id, devices.c.id == device_id)
        .values(signed_out_at=now)
    )
    for zone in conn.execute(
        sa.select(zones).where(
            zones.c.workspace_id == workspace_id,
            sa.or_(zones.c.home_device_id == device_id, zones.c.standby_device_id == device_id),
        )
    ).mappings():
        if zone["home_device_id"] == device_id:
            values = {"home_device_id": zone["standby_device_id"], "standby_device_id": None}
        else:
            values = {"standby_device_id": None}
        conn.execute(sa.update(zones).where(zones.c.id == zone["id"]).values(**values))
    conn.execute(
        sa.update(playback_sessions)
        .where(
            playback_sessions.c.workspace_id == workspace_id,
            playback_sessions.c.active_device_id == device_id,
        )
        .values(lease_expires_at=now)
    )


def unpair(
    engine: Engine, *, workspace_id: str, user_id: str, device_id: str, now: float | None = None
) -> dict[str, Any]:
    """Revoke a kiosk at once. Its offline permit ends with it: a revoked token gets nothing on
    reconnect, and the kiosk wipes its saved music and shows a pairing code."""
    with transaction(engine) as conn:
        now = db_now(conn) if now is None else now
        actor = _actor(conn, workspace_id, user_id)
        row = conn.execute(
            sa.select(devices.c.zone_id).where(
                devices.c.workspace_id == workspace_id,
                devices.c.id == device_id,
                devices.c.principal == "kiosk",
            )
        ).first()
        if row is None or row.zone_id is None:
            raise BusinessNotFound()
        business_guard.require(conn, actor, "business.devices.unpair", zone_id=row.zone_id)
        _revoke_device(conn, workspace_id, device_id, now, "unpaired")
    return {"id": device_id, "unpaired_at": now}


def list_kiosks(
    engine: Engine,
    *,
    workspace_id: str,
    user_id: str,
    venue_id: str | None = None,
    now: float | None = None,
) -> list[dict[str, Any]]:
    """The organisation's kiosks this person may see, newest first, with their latest health."""
    from selecta.business.schema import zones
    from selecta.playback.zone_schema import device_health

    with transaction(engine, workspace_id) as conn:
        now = db_now(conn) if now is None else now
        actor = _actor(conn, workspace_id, user_id)
        rows = conn.execute(
            sa.select(
                devices.c.id,
                devices.c.name,
                devices.c.zone_id,
                devices.c.last_seen_at,
                devices.c.signed_out_at,
                zones.c.venue_id,
                zones.c.home_device_id,
                device_health.c.kiosk_version,
                device_health.c.hours_ahead,
                device_health.c.network,
                device_health.c.wake_lock,
                device_health.c.autoplay_allowed,
                device_health.c.browser,
            )
            .select_from(
                devices.join(zones, zones.c.id == devices.c.zone_id).outerjoin(
                    device_health, device_health.c.device_id == devices.c.id
                )
            )
            .where(
                devices.c.workspace_id == workspace_id,
                devices.c.principal == "kiosk",
                devices.c.signed_out_at.is_(None),
            )
            .order_by(devices.c.created_at.desc())
        ).all()
        shown = []
        for row in rows:
            if venue_id is not None and row.venue_id != venue_id:
                continue
            if not business_guard.can(
                actor, "business.devices.read", venue_id=row.venue_id, zone_id=row.zone_id
            ):
                continue
            online = now - (row.last_seen_at or 0) <= ONLINE_WITHIN_S
            shown.append(
                {
                    "id": row.id,
                    "name": row.name,
                    "kind": "kiosk",
                    "zone_id": row.zone_id,
                    "venue_id": row.venue_id,
                    "role": "home" if row.home_device_id == row.id else "standby",
                    "online": online,
                    "last_seen_at": row.last_seen_at,
                    "not_seen_since": None if online else row.last_seen_at,
                    "saved_hours_ahead": row.hours_ahead,
                    "version": row.kiosk_version,
                    "network": row.network,
                    "wake_lock": row.wake_lock,
                    "autoplay_allowed": row.autoplay_allowed,
                    "browser": row.browser,
                }
            )
    return shown


# ---- alerts shared with business.alerts


def open_alert(
    conn: Connection,
    workspace_id: str,
    zone_id: str,
    device_id: str | None,
    kind: str,
    reason: str,
    now: float,
    *,
    notify_now: bool = False,
    venue_id: str | None = None,
) -> str:
    """Start (or keep) an alert condition. `notify_now` opens it and tells managers at once."""
    existing = conn.execute(
        sa.select(zone_alerts.c.id).where(
            zone_alerts.c.workspace_id == workspace_id,
            zone_alerts.c.zone_id == zone_id,
            zone_alerts.c.kind == kind,
            zone_alerts.c.status != "closed",
        )
    ).first()
    if existing is not None:
        return existing.id
    alert_id = new_id()
    conn.execute(
        zone_alerts.insert().values(
            id=alert_id,
            workspace_id=workspace_id,
            venue_id=venue_id,
            zone_id=zone_id,
            device_id=device_id,
            kind=kind,
            status="open" if notify_now else "pending",
            reason=reason,
            started_at=now,
            opened_at=now if notify_now else None,
            managers_told_at=now if notify_now else None,
        )
    )
    return alert_id


def _close_alerts(
    conn: Connection,
    workspace_id: str,
    zone_id: str,
    kinds: tuple[str, ...],
    now: float,
    device_id: str | None = None,
) -> None:
    query = sa.update(zone_alerts).where(
        zone_alerts.c.workspace_id == workspace_id,
        zone_alerts.c.zone_id == zone_id,
        zone_alerts.c.kind.in_(kinds),
        zone_alerts.c.status != "closed",
    )
    if device_id is not None:
        query = query.where(
            sa.or_(zone_alerts.c.device_id == device_id, zone_alerts.c.device_id.is_(None))
        )
    conn.execute(query.values(status="closed", closed_at=now))


__all__ = [
    "COOKIE_PATH",
    "KIOSK_RELEASES",
    "MAX_KIOSKS_PER_ORG",
    "MAX_KIOSKS_PER_ZONE",
    "PAIRING_COOKIE",
    "PAIRING_SECONDS",
    "TOKEN_COOKIE",
    "TOKEN_ROTATE_S",
    "BusinessForbidden",
    "KioskAuth",
    "KioskError",
    "Verified",
    "authenticate",
    "collect",
    "latest_release",
    "list_kiosks",
    "open_alert",
    "pair",
    "signature_valid",
    "start_pairing",
    "unpair",
    "verify_heartbeat",
    "version_supported",
]
