"""What the local identity provider remembers, in one SQLite file, so accounts survive restarts.

People, their sessions (each with the refresh token the site keeps), pending sign-in requests,
one-time codes, verification and reset links, and the local inbox. Passwords are stored as
PBKDF2-SHA256 hashes, as a real provider would; the signing key is an RSA key kept beside the
database (`signing-key.pem`), so tokens issued before a restart still verify after it.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import secrets
import sqlite3
import threading
import time
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa

PBKDF2_ROUNDS = 120_000
CODE_SECONDS = 600
REQUEST_SECONDS = 3600
LINK_SECONDS = 24 * 3600
MIN_PASSWORD = 8

SCHEMA = """
CREATE TABLE IF NOT EXISTS people (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL COLLATE NOCASE,
    password_hash TEXT,
    email_verified INTEGER NOT NULL DEFAULT 0,
    google INTEGER NOT NULL DEFAULT 0,
    first_name TEXT,
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL,
    deleted_at REAL
);
CREATE UNIQUE INDEX IF NOT EXISTS people_email ON people (email) WHERE google = 0;
CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    person_id TEXT NOT NULL,
    refresh_token TEXT NOT NULL UNIQUE,
    method TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    created_at REAL NOT NULL,
    ended_at REAL
);
CREATE TABLE IF NOT EXISTS requests (
    id TEXT PRIMARY KEY,
    query TEXT NOT NULL,
    created_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS codes (
    code TEXT PRIMARY KEY,
    person_id TEXT NOT NULL,
    request TEXT NOT NULL,
    method TEXT NOT NULL,
    created_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS links (
    token TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    person_id TEXT NOT NULL,
    created_at REAL NOT NULL,
    used_at REAL
);
CREATE TABLE IF NOT EXISTS mail (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    to_address TEXT NOT NULL,
    subject TEXT NOT NULL,
    body TEXT NOT NULL,
    link TEXT,
    created_at REAL NOT NULL
);
"""


@dataclass(frozen=True)
class Person:
    id: str
    email: str
    email_verified: bool
    has_password: bool
    google: bool
    first_name: str | None
    created_at: float
    updated_at: float
    deleted: bool

    def as_workos(self) -> dict[str, Any]:
        """The WorkOS user object, as both AuthKit and the User Management API return it."""
        return {
            "object": "user",
            "id": self.id,
            "email": self.email,
            "email_verified": self.email_verified,
            "first_name": self.first_name,
            "last_name": None,
            "profile_picture_url": None,
            "last_sign_in_at": iso(self.updated_at),
            "created_at": iso(self.created_at),
            "updated_at": iso(self.updated_at),
        }


def iso(stamp: float) -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(stamp)) + f".{int(stamp % 1 * 1000):03d}Z"


def hash_password(password: str, salt: bytes | None = None) -> str:
    salt = salt or secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, PBKDF2_ROUNDS)
    return f"pbkdf2${salt.hex()}${digest.hex()}"


def password_matches(password: str, stored: str | None) -> bool:
    if not stored or not stored.startswith("pbkdf2$"):
        return False
    _, salt, digest = stored.split("$", 2)
    candidate = hash_password(password, bytes.fromhex(salt)).split("$", 2)[2]
    return hmac.compare_digest(candidate, digest)


class IdentityStore:
    """Thread-safe: one connection per call, SQLite's own locking, WAL for readers."""

    def __init__(self, folder: Path) -> None:
        self.folder = Path(folder)
        self.folder.mkdir(parents=True, exist_ok=True)
        self.path = self.folder / "identity.sqlite"
        self._lock = threading.Lock()
        with self._db() as db:
            db.executescript(SCHEMA)
        self.private_key = self._signing_key()
        self.kid = "dev-" + hashlib.sha256(self.public_pem()).hexdigest()[:16]

    # -- plumbing -----------------------------------------------------------------------------

    @contextmanager
    def _db(self) -> Iterator[sqlite3.Connection]:
        with self._lock:
            db = sqlite3.connect(self.path, timeout=10)
            db.row_factory = sqlite3.Row
            try:
                db.execute("PRAGMA journal_mode=WAL")
                yield db
                db.commit()
            finally:
                db.close()

    def _signing_key(self) -> rsa.RSAPrivateKey:
        path = self.folder / "signing-key.pem"
        if path.exists():
            loaded = serialization.load_pem_private_key(path.read_bytes(), password=None)
            assert isinstance(loaded, rsa.RSAPrivateKey)
            return loaded
        key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        path.write_bytes(
            key.private_bytes(
                serialization.Encoding.PEM,
                serialization.PrivateFormat.PKCS8,
                serialization.NoEncryption(),
            )
        )
        return key

    def public_pem(self) -> bytes:
        return self.private_key.public_key().public_bytes(
            serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
        )

    @staticmethod
    def _person(row: sqlite3.Row | None) -> Person | None:
        if row is None:
            return None
        return Person(
            id=row["id"],
            email=row["email"],
            email_verified=bool(row["email_verified"]),
            has_password=bool(row["password_hash"]),
            google=bool(row["google"]),
            first_name=row["first_name"],
            created_at=row["created_at"],
            updated_at=row["updated_at"],
            deleted=row["deleted_at"] is not None,
        )

    # -- people -------------------------------------------------------------------------------

    def person(self, person_id: str) -> Person | None:
        with self._db() as db:
            row = db.execute(
                "SELECT * FROM people WHERE id = ? AND deleted_at IS NULL", (person_id,)
            ).fetchone()
        return self._person(row)

    def by_email(self, email: str) -> Person | None:
        """The password account for this address (Google identities are kept apart)."""
        with self._db() as db:
            row = db.execute(
                "SELECT * FROM people WHERE email = ? AND google = 0 AND deleted_at IS NULL",
                (email.strip(),),
            ).fetchone()
        return self._person(row)

    def create(
        self,
        email: str,
        password: str | None,
        *,
        verified: bool = False,
        google: bool = False,
        first_name: str | None = None,
    ) -> Person:
        now = time.time()
        person_id = f"user_{secrets.token_hex(10)}"
        with self._db() as db:
            db.execute(
                "INSERT INTO people (id, email, password_hash, email_verified, google, "
                "first_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    person_id,
                    email.strip(),
                    hash_password(password) if password else None,
                    int(verified),
                    int(google),
                    first_name,
                    now,
                    now,
                ),
            )
        person = self.person(person_id)
        assert person is not None
        return person

    def check_password(self, email: str, password: str) -> Person | None:
        with self._db() as db:
            row = db.execute(
                "SELECT * FROM people WHERE email = ? AND google = 0 AND deleted_at IS NULL",
                (email.strip(),),
            ).fetchone()
        if row is None or not password_matches(password, row["password_hash"]):
            return None
        return self._person(row)

    def mark_verified(self, person_id: str) -> None:
        with self._db() as db:
            db.execute(
                "UPDATE people SET email_verified = 1, updated_at = ? WHERE id = ?",
                (time.time(), person_id),
            )

    def set_password(self, person_id: str, password: str) -> None:
        with self._db() as db:
            db.execute(
                "UPDATE people SET password_hash = ?, updated_at = ? WHERE id = ?",
                (hash_password(password), time.time(), person_id),
            )

    def delete(self, person_id: str) -> bool:
        with self._db() as db:
            changed = db.execute(
                "UPDATE people SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL",
                (time.time(), person_id),
            ).rowcount
            db.execute(
                "UPDATE sessions SET status = 'revoked', ended_at = ? "
                "WHERE person_id = ? AND status = 'active'",
                (time.time(), person_id),
            )
        return bool(changed)

    def people(self) -> list[Person]:
        with self._db() as db:
            rows = db.execute(
                "SELECT * FROM people WHERE deleted_at IS NULL ORDER BY created_at"
            ).fetchall()
        return [person for row in rows if (person := self._person(row)) is not None]

    # -- sign-in requests and codes -----------------------------------------------------------

    def remember_request(self, query: dict[str, str]) -> str:
        request_id = secrets.token_hex(12)
        with self._db() as db:
            db.execute(
                "INSERT INTO requests (id, query, created_at) VALUES (?, ?, ?)",
                (request_id, json.dumps(query), time.time()),
            )
        return request_id

    def request(self, request_id: str) -> dict[str, str] | None:
        with self._db() as db:
            row = db.execute(
                "SELECT query, created_at FROM requests WHERE id = ?", (request_id,)
            ).fetchone()
        if row is None or time.time() - row["created_at"] > REQUEST_SECONDS:
            return None
        return json.loads(row["query"])

    def issue_code(self, request_id: str, person_id: str, method: str) -> tuple[str, dict]:
        query = self.request(request_id)
        if query is None:
            raise LookupError("expired sign-in request")
        code = secrets.token_urlsafe(24)
        with self._db() as db:
            db.execute("DELETE FROM requests WHERE id = ?", (request_id,))
            db.execute(
                "INSERT INTO codes (code, person_id, request, method, created_at) "
                "VALUES (?, ?, ?, ?, ?)",
                (code, person_id, json.dumps(query), method, time.time()),
            )
        return code, query

    def take_code(self, code: str) -> tuple[str, dict, str] | None:
        """(person id, the original request, method) for a code, which then can't be reused."""
        with self._db() as db:
            row = db.execute("SELECT * FROM codes WHERE code = ?", (code,)).fetchone()
            db.execute("DELETE FROM codes WHERE code = ?", (code,))
        if row is None or time.time() - row["created_at"] > CODE_SECONDS:
            return None
        return row["person_id"], json.loads(row["request"]), row["method"]

    # -- sessions -----------------------------------------------------------------------------

    def start_session(self, person_id: str, method: str) -> tuple[str, str]:
        session_id = f"session_{secrets.token_hex(10)}"
        refresh = f"rt_{secrets.token_urlsafe(32)}"
        with self._db() as db:
            db.execute(
                "INSERT INTO sessions (id, person_id, refresh_token, method, created_at) "
                "VALUES (?, ?, ?, ?, ?)",
                (session_id, person_id, refresh, method, time.time()),
            )
        return session_id, refresh

    def rotate(self, refresh_token: str) -> tuple[str, str, str, str] | None:
        """Exchange a refresh token for a new one: (person id, session id, token, method)."""
        fresh = f"rt_{secrets.token_urlsafe(32)}"
        with self._db() as db:
            row = db.execute(
                "SELECT * FROM sessions WHERE refresh_token = ? AND status = 'active'",
                (refresh_token,),
            ).fetchone()
            if row is None:
                return None
            db.execute("UPDATE sessions SET refresh_token = ? WHERE id = ?", (fresh, row["id"]))
        return row["person_id"], row["id"], fresh, row["method"]

    def sessions(self, person_id: str) -> list[dict[str, Any]]:
        with self._db() as db:
            rows = db.execute(
                "SELECT id, person_id, status, created_at FROM sessions WHERE person_id = ? "
                "ORDER BY created_at",
                (person_id,),
            ).fetchall()
        return [dict(row) for row in rows]

    def session(self, session_id: str) -> dict[str, Any] | None:
        with self._db() as db:
            row = db.execute("SELECT * FROM sessions WHERE id = ?", (session_id,)).fetchone()
        return dict(row) if row else None

    def end_session(self, session_id: str) -> bool:
        with self._db() as db:
            return bool(
                db.execute(
                    "UPDATE sessions SET status = 'revoked', ended_at = ? "
                    "WHERE id = ? AND status = 'active'",
                    (time.time(), session_id),
                ).rowcount
            )

    def end_sessions(self, person_id: str) -> list[str]:
        with self._db() as db:
            rows = db.execute(
                "SELECT id FROM sessions WHERE person_id = ? AND status = 'active'", (person_id,)
            ).fetchall()
            db.execute(
                "UPDATE sessions SET status = 'revoked', ended_at = ? "
                "WHERE person_id = ? AND status = 'active'",
                (time.time(), person_id),
            )
        return [row["id"] for row in rows]

    # -- verification and reset links ---------------------------------------------------------

    def new_link(self, kind: str, person_id: str) -> str:
        token = secrets.token_urlsafe(24)
        with self._db() as db:
            db.execute(
                "INSERT INTO links (token, kind, person_id, created_at) VALUES (?, ?, ?, ?)",
                (token, kind, person_id, time.time()),
            )
        return token

    def link_owner(self, kind: str, token: str) -> str | None:
        with self._db() as db:
            row = db.execute(
                "SELECT * FROM links WHERE token = ? AND kind = ? AND used_at IS NULL",
                (token, kind),
            ).fetchone()
        if row is None or time.time() - row["created_at"] > LINK_SECONDS:
            return None
        return row["person_id"]

    def use_link(self, kind: str, token: str) -> str | None:
        owner = self.link_owner(kind, token)
        if owner is None:
            return None
        with self._db() as db:
            used = db.execute(
                "UPDATE links SET used_at = ? WHERE token = ? AND used_at IS NULL",
                (time.time(), token),
            ).rowcount
        return owner if used else None

    # -- the local inbox ----------------------------------------------------------------------

    def send_mail(self, to: str, subject: str, body: str, link: str | None) -> int:
        with self._db() as db:
            cursor = db.execute(
                "INSERT INTO mail (to_address, subject, body, link, created_at) "
                "VALUES (?, ?, ?, ?, ?)",
                (to, subject, body, link, time.time()),
            )
            return int(cursor.lastrowid or 0)

    def mail(self, to: str | None = None, limit: int = 100) -> list[dict[str, Any]]:
        with self._db() as db:
            if to:
                rows = db.execute(
                    "SELECT * FROM mail WHERE to_address = ? COLLATE NOCASE "
                    "ORDER BY id DESC LIMIT ?",
                    (to.strip(), limit),
                ).fetchall()
            else:
                rows = db.execute("SELECT * FROM mail ORDER BY id DESC LIMIT ?", (limit,)).fetchall()
        return [dict(row) for row in rows]

    def clear_mail(self) -> None:
        with self._db() as db:
            db.execute("DELETE FROM mail")


__all__ = ["MIN_PASSWORD", "IdentityStore", "Person", "hash_password", "password_matches"]
