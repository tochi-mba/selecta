"""One-use pairing and rotatable, hashed, workspace-bound engine credentials.

The DB location is supplied by trusted engine/cloud configuration, never a remote request.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path

from .protocol import ActorScope, ControlError, _id

PAIR_TTL = 300
CREDENTIAL_TTL = 30 * 86400


def _digest(secret: str) -> str:
    return hashlib.sha256(secret.encode("utf-8")).hexdigest()


@contextmanager
def _db(path: str | Path) -> Iterator[sqlite3.Connection]:
    db = sqlite3.connect(str(path), timeout=10, isolation_level=None)
    try:
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA busy_timeout=10000")
        db.execute("PRAGMA journal_mode=WAL")
        with db:
            yield db
    finally:
        db.close()


@dataclass(frozen=True)
class DeviceCredential:
    device_id: str
    workspace_id: str
    zones: frozenset[str | None]
    token: str
    command_key: str
    generation: int
    expires_at: float


@dataclass(frozen=True)
class DeviceRegistration:
    """Cloud-side lookup; intentionally has no device bearer token."""

    device_id: str
    workspace_id: str
    zones: frozenset[str | None]
    command_key: str
    generation: int
    expires_at: float


class CredentialRegistry:
    def __init__(self, path: str | Path, *, master_key: bytes):
        if type(master_key) is not bytes or len(master_key) < 32:
            raise ValueError("Persistent command-signing master key required (at least 32 bytes)")
        self.path = path
        self._master_key = master_key
        self._init_db()

    def _command_key(self, workspace: str, device: str, generation: int) -> str:
        # The cloud derives this from a secret outside the DB; the engine receives only its own
        # per-device/per-rotation key. A stolen token is not a global signing key.
        message = f"selecta-lf1:{workspace}:{device}:{generation}".encode()
        value = hmac.new(self._master_key, message, hashlib.sha256).digest()
        return base64.urlsafe_b64encode(value).decode("ascii")

    def _init_db(self) -> None:
        path = self.path
        with _db(path) as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS lf_pairings (
                    digest TEXT PRIMARY KEY, workspace TEXT NOT NULL, zones TEXT NOT NULL,
                    issued_by TEXT NOT NULL, expires REAL NOT NULL, consumed REAL
                );
                CREATE TABLE IF NOT EXISTS lf_devices (
                    device TEXT NOT NULL, workspace TEXT NOT NULL, zones TEXT NOT NULL,
                    digest TEXT NOT NULL, generation INTEGER NOT NULL,
                    expires REAL NOT NULL, revoked REAL,
                    PRIMARY KEY(workspace, device)
                );
                CREATE INDEX IF NOT EXISTS lf_pairing_expiry ON lf_pairings(expires);
                CREATE TABLE IF NOT EXISTS lf_pairing_proposals (
                    request_id TEXT PRIMARY KEY, pairing_digest TEXT NOT NULL,
                    device TEXT NOT NULL, challenge_digest TEXT NOT NULL,
                    approved REAL, created REAL NOT NULL,
                    FOREIGN KEY(pairing_digest) REFERENCES lf_pairings(digest)
                );
            """)

    def issue_pairing(
        self, actor: ActorScope, zones: frozenset[str | None], *, now: float, ttl: int = 120
    ) -> str:
        if actor.role not in {"owner", "admin"} or not zones or not zones <= actor.zones:
            raise ControlError("role_denied")
        if type(ttl) is not int or not 1 <= ttl <= PAIR_TTL:
            raise ControlError("invalid_expiry")
        _id(actor.workspace_id)
        for zone in zones:
            _id(zone, optional=True)
        code = secrets.token_urlsafe(32)
        with _db(self.path) as db:
            db.execute("BEGIN IMMEDIATE")
            db.execute("DELETE FROM lf_pairings WHERE expires <= ?", (now,))
            db.execute(
                "INSERT INTO lf_pairings VALUES(?,?,?,?,?,NULL)",
                (
                    _digest(code),
                    actor.workspace_id,
                    json.dumps(sorted(zones, key=lambda z: z or "")),
                    actor.actor_id,
                    now + ttl,
                ),
            )
            db.commit()
        return code

    def propose_pairing(self, code: str, device_id: str, challenge: str, *, now: float) -> str:
        """Untrusted engine proposes its identity; no credential is issued until owner approval.

        The owner should confirm the locally displayed challenge through an authenticated
        account session (and an independent device descriptor) before approving.
        """
        _id(device_id)
        _id(challenge)
        if type(code) is not str or not 32 <= len(code) <= 128:
            raise ControlError("invalid_pairing")
        digest = _digest(code)
        with _db(self.path) as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT * FROM lf_pairings WHERE digest=?", (digest,)).fetchone()
            if row is None or row["consumed"] is not None or row["expires"] <= now:
                raise ControlError("invalid_pairing")
            if db.execute(
                "SELECT 1 FROM lf_devices WHERE device=? AND workspace=?",
                (device_id, row["workspace"]),
            ).fetchone():
                raise ControlError("device_exists")
            request_id = secrets.token_urlsafe(24)
            db.execute(
                "INSERT INTO lf_pairing_proposals VALUES(?,?,?,?,NULL,?)",
                (request_id, digest, device_id, _digest(challenge), now),
            )
            db.commit()
            return request_id

    def approve_pairing(
        self, actor: ActorScope, request_id: str, *, now: float, confirmed_challenge: str
    ) -> None:
        """Owner/admin must confirm the actual engine's out-of-band displayed challenge."""
        _id(confirmed_challenge)
        if actor.role not in {"owner", "admin"}:
            raise ControlError("role_denied")
        with _db(self.path) as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute(
                "SELECT p.*, o.workspace, o.zones, o.expires, o.consumed "
                "FROM lf_pairing_proposals p JOIN lf_pairings o ON "
                "p.pairing_digest=o.digest WHERE p.request_id=?",
                (request_id,),
            ).fetchone()
            if (
                row is None
                or row["workspace"] != actor.workspace_id
                or row["expires"] <= now
                or row["consumed"] is not None
                or not frozenset(json.loads(row["zones"])) <= actor.zones
            ):
                raise ControlError("unknown_pairing")
            if not hmac.compare_digest(row["challenge_digest"], _digest(confirmed_challenge)):
                raise ControlError("pairing_challenge_mismatch")
            db.execute(
                "UPDATE lf_pairing_proposals SET approved=? WHERE request_id=? "
                "AND approved IS NULL",
                (now, request_id),
            )
            db.commit()

    def redeem(
        self,
        code: str,
        device_id: str,
        *,
        now: float,
        request_id: str,
        challenge: str,
        ttl: int = 7 * 86400,
    ) -> DeviceCredential:
        _id(device_id)
        _id(challenge)
        if type(ttl) is not int or not 1 <= ttl <= CREDENTIAL_TTL:
            raise ControlError("invalid_expiry")
        if type(code) is not str or len(code) > 128:
            raise ControlError("invalid_pairing")
        digest = _digest(code)
        with _db(self.path) as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT * FROM lf_pairings WHERE digest=?", (digest,)).fetchone()
            if row is None or row["consumed"] is not None or row["expires"] <= now:
                raise ControlError("invalid_pairing")
            proposal = db.execute(
                "SELECT * FROM lf_pairing_proposals WHERE request_id=? "
                "AND pairing_digest=? AND device=?",
                (request_id, digest, device_id),
            ).fetchone()
            if (
                proposal is None
                or proposal["approved"] is None
                or proposal["challenge_digest"] != _digest(challenge)
            ):
                raise ControlError("pairing_not_approved")
            if db.execute(
                "SELECT 1 FROM lf_devices WHERE device=? AND workspace=?",
                (device_id, row["workspace"]),
            ).fetchone():
                raise ControlError("device_exists")
            token = secrets.token_urlsafe(48)
            zones = frozenset(json.loads(row["zones"]))
            db.execute(
                "UPDATE lf_pairings SET consumed=? WHERE digest=? AND consumed IS NULL",
                (now, digest),
            )
            db.execute("DELETE FROM lf_pairing_proposals WHERE pairing_digest=?", (digest,))
            db.execute(
                "INSERT INTO lf_devices VALUES(?,?,?,?,?,?,NULL)",
                (device_id, row["workspace"], row["zones"], _digest(token), 1, now + ttl),
            )
            db.commit()
            return DeviceCredential(
                device_id,
                row["workspace"],
                zones,
                token,
                self._command_key(row["workspace"], device_id, 1),
                1,
                now + ttl,
            )

    def authenticate(
        self, device_id: str, workspace_id: str, token: str, *, now: float
    ) -> DeviceCredential:
        # Never reveal whether a device exists in a different workspace.
        _id(device_id)
        _id(workspace_id)
        if type(token) is not str or len(token) > 256:
            raise ControlError("unauthorised_device")
        with _db(self.path) as db:
            row = db.execute(
                "SELECT * FROM lf_devices WHERE device=? AND workspace=?", (device_id, workspace_id)
            ).fetchone()
        if (
            row is None
            or row["revoked"] is not None
            or row["expires"] <= now
            or not hmac.compare_digest(row["digest"], _digest(token))
        ):
            raise ControlError("unauthorised_device")
        return DeviceCredential(
            device_id,
            workspace_id,
            frozenset(json.loads(row["zones"])),
            token,
            self._command_key(workspace_id, device_id, row["generation"]),
            row["generation"],
            row["expires"],
        )

    def active_device(self, device_id: str, workspace_id: str, *, now: float) -> DeviceRegistration:
        """Server-side authenticated-controller lookup. Never issue a device token to a browser.

        Caller MUST first establish its human actor identity and authorise its workspace/zone.
        """
        _id(device_id)
        _id(workspace_id)
        with _db(self.path) as db:
            row = db.execute(
                "SELECT * FROM lf_devices WHERE device=? AND workspace=?", (device_id, workspace_id)
            ).fetchone()
        if row is None or row["revoked"] is not None or row["expires"] <= now:
            raise ControlError("unauthorised_device")
        return DeviceRegistration(
            device_id,
            workspace_id,
            frozenset(json.loads(row["zones"])),
            self._command_key(workspace_id, device_id, row["generation"]),
            row["generation"],
            row["expires"],
        )

    def rotate(
        self, device_id: str, workspace_id: str, token: str, *, now: float, ttl: int = 7 * 86400
    ) -> DeviceCredential:
        if type(ttl) is not int or not 1 <= ttl <= CREDENTIAL_TTL:
            raise ControlError("invalid_expiry")
        with _db(self.path) as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute(
                "SELECT * FROM lf_devices WHERE device=? AND workspace=?", (device_id, workspace_id)
            ).fetchone()
            if (
                row is None
                or row["revoked"] is not None
                or row["expires"] <= now
                or type(token) is not str
                or not hmac.compare_digest(row["digest"], _digest(token))
            ):
                raise ControlError("unauthorised_device")
            new_token = secrets.token_urlsafe(48)
            generation = row["generation"] + 1
            db.execute(
                "UPDATE lf_devices SET digest=?, generation=?, expires=? "
                "WHERE device=? AND workspace=?",
                (_digest(new_token), generation, now + ttl, device_id, workspace_id),
            )
            db.commit()
            return DeviceCredential(
                device_id,
                workspace_id,
                frozenset(json.loads(row["zones"])),
                new_token,
                self._command_key(workspace_id, device_id, generation),
                generation,
                now + ttl,
            )

    def revoke(self, actor: ActorScope, device_id: str, *, now: float) -> None:
        if actor.role not in {"owner", "admin"}:
            raise ControlError("role_denied")
        with _db(self.path) as db:
            db.execute("BEGIN IMMEDIATE")
            cursor = db.execute(
                "UPDATE lf_devices SET revoked=?, generation=generation+1 "
                "WHERE device=? AND workspace=? AND revoked IS NULL",
                (now, device_id, actor.workspace_id),
            )
            if not cursor.rowcount:
                raise ControlError("unknown_device")
            db.commit()
