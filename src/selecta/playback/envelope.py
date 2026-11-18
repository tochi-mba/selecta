"""The signed command envelope (ADR-0461, BF-0461-01).

A delivered command is metadata only: who issued it, which session it is scoped to (workspace,
zone, target device), the fence it was issued under, its operation id, sequence and server-time
expiry, and the command with its arguments. No audio, no URL to audio, no filesystem path: the
speaker resolves tracks locally from ADR-0458 identities. `assert_metadata_only` is the gate,
and the tests drive every command through it.

Signing. Each session row holds a random `signing_salt` that never leaves the server. Mixed with
the optional deployment secret `SELECTA_PLAYBACK_SIGNING_SECRET`, it gives the session key; the
speaker is handed only a *lease key*, derived from the session key, its device id and the fence
it holds. Every envelope is serialised once to canonical JSON (`envelope`) and signed with the
target's lease key (`signature`, hex HMAC-SHA256). The speaker verifies the HMAC over the exact
string it received and acts only on the fields inside it, so no re-encoding can disagree. A
stale speaker's key (older fence) cannot verify a newer regime's envelopes; another workspace's
or zone's key cannot either. On ack the device echoes the signature and the server compares it
with the one it recorded (`hmac.compare_digest`), so an ack is bound to the exact envelope.

Without the deployment secret the salt alone keys the HMAC: still unguessable outside the
server, but a database read would expose it, so production sets the secret.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import re
import secrets
from collections.abc import Mapping
from dataclasses import replace
from typing import Any

import sqlalchemy as sa
from sqlalchemy.engine import Connection

from selecta.playback.model import Session
from selecta.playback.schema import playback_sessions

SECRET_ENV = "SELECTA_PLAYBACK_SIGNING_SECRET"
ENVELOPE_VERSION = 1
# Exactly what an envelope may carry; anything else is a bug, refused by `build`.
ENVELOPE_FIELDS = frozenset({
    "v", "workspace_id", "zone_id", "device_id", "issued_by", "command", "args", "seq",
    "command_id", "fence", "expires_at",
})
# The fields of the event that carries an envelope (the envelope's own fields are repeated in
# the clear for older clients, which judge by fence and expiry alone).
EVENT_FIELDS = frozenset({*ENVELOPE_FIELDS, "envelope", "signature"}) - {"v", "workspace_id"}

# Keys and values that would mean audio, a link to audio, or a place on a disk.
_FORBIDDEN_WORDS = frozenset({
    "path", "paths", "filepath", "url", "urls", "uri", "href", "src", "file", "files",
    "filename", "dir", "directory", "folder", "audio", "blob", "stream", "bytes", "data_url",
    "wav", "mp3", "flac", "handle",
})
_FORBIDDEN_VALUE = re.compile(
    r"^(?:[a-z][a-z0-9+.-]*://|blob:|data:|file:|/|~/|\\\\|[a-z]:[\\/])"
    r"|\.(?:mp3|wav|flac|aiff?|m4a|aac|ogg|opus)$",
    re.IGNORECASE,
)


class NotMetadata(ValueError):
    """A payload carried something that looks like audio, a URL or a path."""


def _words(key: str) -> list[str]:
    """Split a key into lower-case words at separators and camelCase boundaries (`audioURL` ->
    audio, url; `URLPath` -> url, path). One pass over the characters, so a hostile key costs
    linear time."""
    words: list[str] = []
    current = ""
    for index, char in enumerate(key):
        if not char.isalnum():
            if current:
                words.append(current)
            current = ""
            continue
        if current and char.isupper():
            following = key[index + 1] if index + 1 < len(key) else ""
            if not current[-1].isupper() or following.islower():
                words.append(current)
                current = ""
        current += char
    if current:
        words.append(current)
    return [word.lower() for word in words]


def forbidden_key(key: str) -> bool:
    """Does this key name audio, a URL or a path? Judged word by word (snake_case, camelCase),
    so `direction` is fine and `file_path`, `audioUrl` or `src` are not."""
    words = _words(str(key))
    return any(word in _FORBIDDEN_WORDS for word in words) or str(key).lower() in _FORBIDDEN_WORDS


def assert_metadata_only(payload: Any, at: str = "payload") -> None:
    """Refuse any key or string value that names audio, a URL or a filesystem path, anywhere in
    the structure. Raises `NotMetadata` saying where."""
    if isinstance(payload, Mapping):
        for key, value in payload.items():
            if forbidden_key(str(key)):
                raise NotMetadata(f"{at}.{key} is not allowed in a command")
            assert_metadata_only(value, f"{at}.{key}")
    elif isinstance(payload, (list, tuple)):
        for index, value in enumerate(payload):
            assert_metadata_only(value, f"{at}[{index}]")
    elif isinstance(payload, (bytes, bytearray, memoryview)):
        raise NotMetadata(f"{at} is raw bytes")
    elif isinstance(payload, str) and _FORBIDDEN_VALUE.search(payload.strip()):
        raise NotMetadata(f"{at} looks like a URL or a path")


def _server_secret() -> bytes:
    return os.environ.get(SECRET_ENV, "").strip().encode()


def ensure_salt(conn: Connection, session: Session) -> Session:
    """The session with a signing salt, writing one for a row created before signing existed.
    The caller holds the session lock."""
    if session.signing_salt:
        return session
    salt = secrets.token_hex(32)
    zone = (
        playback_sessions.c.zone_id.is_(None)
        if session.zone_id is None
        else playback_sessions.c.zone_id == session.zone_id
    )
    conn.execute(
        sa.update(playback_sessions)
        .where(playback_sessions.c.workspace_id == session.workspace_id, zone)
        .values(signing_salt=salt)
    )
    return replace(session, signing_salt=salt)


def _session_key(session: Session) -> bytes:
    if not session.signing_salt:
        raise ValueError("The session has no signing salt yet; call ensure_salt first")
    scope = f"selecta.playback.session.v1|{session.workspace_id}|{session.zone_id or ''}"
    return hmac.new(
        _server_secret() + bytes.fromhex(session.signing_salt), scope.encode(), hashlib.sha256
    ).digest()


def lease_key(session: Session, device_id: str, fence: int) -> str:
    """The key the device holding this session's lease at `fence` verifies envelopes with, as
    hex. Bound to the device and the fence, so it is useless to anyone else, and to the same
    device once the fence moves."""
    text = f"selecta.playback.lease.v1|{device_id}|{fence}"
    return hmac.new(_session_key(session), text.encode(), hashlib.sha256).hexdigest()


def speaker_key(session: Session) -> str | None:
    """The current speaker's lease key, for the answers that only the speaker receives."""
    if session.active_device_id is None or not session.signing_salt:
        return None
    return lease_key(session, session.active_device_id, session.fence)


def canonical(fields: Mapping[str, Any]) -> str:
    return json.dumps(fields, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def sign(key_hex: str, text: str) -> str:
    return hmac.new(bytes.fromhex(key_hex), text.encode(), hashlib.sha256).hexdigest()


def build(
    session: Session,
    *,
    target_device_id: str | None,
    issued_by: str,
    command: str,
    args: Mapping[str, Any],
    seq: int,
    command_id: str,
    fence: int,
    expires_at: float,
) -> dict[str, Any]:
    """The `playback.command` event body: the envelope fields in the clear, the canonical
    envelope string, and its signature under the target's lease key (None without a target,
    which no device can act on anyway)."""
    fields: dict[str, Any] = {
        "v": ENVELOPE_VERSION,
        "workspace_id": session.workspace_id,
        "zone_id": session.zone_id,
        "device_id": target_device_id,
        "issued_by": issued_by,
        "command": command,
        "args": dict(args),
        "seq": seq,
        "command_id": command_id,
        "fence": fence,
        "expires_at": expires_at,
    }
    if set(fields) != ENVELOPE_FIELDS:  # pragma: no cover - guards future edits
        raise NotMetadata("The envelope's fields changed without updating ENVELOPE_FIELDS")
    assert_metadata_only(fields, "envelope")
    text = canonical(fields)
    signature = (
        sign(lease_key(session, target_device_id, fence), text) if target_device_id else None
    )
    event = {key: value for key, value in fields.items() if key not in ("v", "workspace_id")}
    if event["zone_id"] is None:
        del event["zone_id"]  # a personal session's events never named a zone
    event["envelope"] = text
    event["signature"] = signature
    return event


def verify(key_hex: str, text: str, signature: str | None) -> bool:
    """What the speaker does before acting (the web client mirrors this with WebCrypto)."""
    if not signature:
        return False
    return hmac.compare_digest(sign(key_hex, text), signature)


def same_signature(recorded: str | None, echoed: str | None) -> bool:
    return bool(recorded) and bool(echoed) and hmac.compare_digest(recorded, echoed)


__all__ = [
    "ENVELOPE_FIELDS",
    "EVENT_FIELDS",
    "SECRET_ENV",
    "NotMetadata",
    "assert_metadata_only",
    "build",
    "canonical",
    "ensure_salt",
    "lease_key",
    "same_signature",
    "sign",
    "speaker_key",
    "verify",
]
