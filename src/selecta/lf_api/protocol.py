"""Strict browser-first command wire contract. Cloud transports metadata only.

Browser clients use exactly the same snake_case, Unix-seconds and actor_id/actor_role
representation as the Python control protocol. A browser session is an executor, not a
Python daemon; it must acknowledge physical output evidence separately.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import re
from dataclasses import asdict, dataclass
from typing import Any

from selecta.lf_control.protocol import ControlError, _id, _integer

VERSION = 1
MAX_COMMAND_BYTES = 8192
PUBLIC_ACTIONS = frozenset({
    "play", "pause", "skip", "seek", "set_volume", "steer", "reorder",
    "approve_request", "set_policy", "set_schedule",
})
INTERNAL_ACTIONS = frozenset({"prepare_output", "release_output", "activate_output"})
ACTIONS = PUBLIC_ACTIONS | INTERNAL_ACTIONS
TERMINAL = frozenset({"acknowledged", "rejected", "conflicted", "superseded", "expired"})
STATES = frozenset({
    "created", "authorised", "queued", "delivered", "accepted", "applied",
    "acknowledged", *TERMINAL,
})
ROLES = frozenset({"owner", "admin", "dj", "staff", "viewer"})
ARGS: dict[str, frozenset[str]] = {
    "play": frozenset(), "pause": frozenset(),
    "skip": frozenset({"song_index"}),
    "seek": frozenset({"song_index", "offset_ms"}),
    "set_volume": frozenset({"volume"}),
    "steer": frozenset({"direction"}),
    "reorder": frozenset({"occurrence_ids"}),
    "approve_request": frozenset({"request_id"}),
    "set_policy": frozenset({"revision", "enabled"}),
    "set_schedule": frozenset({"schedule_id", "revision", "enabled"}),
    "prepare_output": frozenset({"transfer_id"}),
    "release_output": frozenset({"transfer_id"}),
    "activate_output": frozenset({"transfer_id"}),
}
REQUIRED: dict[str, frozenset[str]] = {
    "seek": frozenset({"offset_ms"}),
    "set_volume": frozenset({"volume"}),
    "steer": frozenset({"direction"}),
    "reorder": frozenset({"occurrence_ids"}),
    "approve_request": frozenset({"request_id"}),
    "set_policy": frozenset({"revision", "enabled"}),
    "set_schedule": frozenset({"schedule_id", "revision", "enabled"}),
    "prepare_output": frozenset({"transfer_id"}),
    "release_output": frozenset({"transfer_id"}),
    "activate_output": frozenset({"transfer_id"}),
}
SAFE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.:\-]{0,127}$")


def _number(value: Any) -> int:
    # Integer Unix seconds are a cross-language HMAC requirement: Python encodes
    # 1800000000.0 differently from JavaScript's JSON.stringify(1800000000).
    if (
        type(value) not in (int, float) or not 0 < value < 10**11
        or not float(value).is_integer()
    ):
        raise ControlError("invalid_timestamp")
    return int(value)


def safe_arguments(action: str, args: Any) -> dict[str, Any]:
    if action not in ACTIONS:
        raise ControlError("unsupported_command")
    if type(args) is not dict or not args.keys() <= ARGS[action]:
        raise ControlError("unsafe_arguments")
    if not REQUIRED.get(action, frozenset()) <= args.keys():
        raise ControlError("missing_arguments")
    clean: dict[str, Any] = {}
    for k, v in args.items():
        if k in {"song_index", "offset_ms"}:
            clean[k] = _integer(v, maximum=2**31 - 1)
        elif k == "volume":
            clean[k] = _integer(v, maximum=100)
        elif k in {"request_id", "revision", "schedule_id", "transfer_id"}:
            clean[k] = _id(v)
        elif k == "enabled":
            if type(v) is not bool:
                raise ControlError("unsafe_arguments")
            clean[k] = v
        elif k == "direction":
            if v not in {"bigger", "calmer", "something_else"}:
                raise ControlError("unsafe_arguments")
            clean[k] = v
        elif k == "occurrence_ids":
            if type(v) is not list or not 1 <= len(v) <= 500:
                raise ControlError("unsafe_arguments")
            clean[k] = [_id(item) for item in v]
            if len(clean[k]) != len(set(clean[k])):
                raise ControlError("unsafe_arguments")
    if len(json.dumps(clean, sort_keys=True, separators=(",", ":"))) > 4096:
        raise ControlError("unsafe_arguments")
    return clean


@dataclass(frozen=True)
class BrowserEnvelope:
    schema_version: int
    operation_id: str
    actor_id: str
    actor_role: str
    workspace_id: str
    zone_id: str
    session_id: str
    target_device_id: str
    expected_generation: int
    expected_recipe_revision: str | None
    policy_version: int
    sequence: int
    action: str
    arguments: dict[str, Any]
    created_at: float
    expires_at: float
    idempotency_key: str

    @classmethod
    def parse(cls, raw: Any, *, now: float | None = None) -> BrowserEnvelope:
        if type(raw) is not dict or set(raw) != set(cls.__dataclass_fields__):
            raise ControlError("invalid_envelope_fields")
        if type(raw["schema_version"]) is not int or raw["schema_version"] != VERSION:
            raise ControlError("unsupported_protocol")
        if raw["actor_role"] not in ROLES or type(raw["actor_role"]) is not str:
            raise ControlError("invalid_role")
        action = raw["action"]
        if type(action) is not str or action not in ACTIONS:
            raise ControlError("unsupported_command")
        created = _number(raw["created_at"])
        expires = _number(raw["expires_at"])
        max_ttl = (
            120 if action in INTERNAL_ACTIONS
            else 60 if action in {"play", "pause", "skip", "seek"} else 86400
        )
        if not 0 < expires - created <= max_ttl:
            raise ControlError("invalid_expiry")
        if now is not None and (created > now + 30 or expires <= now):
            raise ControlError("expired_or_future")
        env = cls(
            schema_version=VERSION,
            operation_id=_id(raw["operation_id"]),
            actor_id=_id(raw["actor_id"]),
            actor_role=raw["actor_role"],
            workspace_id=_id(raw["workspace_id"]),
            zone_id=_id(raw["zone_id"]),
            session_id=_id(raw["session_id"]),
            target_device_id=_id(raw["target_device_id"]),
            expected_generation=_integer(raw["expected_generation"]),
            expected_recipe_revision=_id(raw["expected_recipe_revision"], optional=True),
            policy_version=_integer(raw["policy_version"]),
            sequence=_integer(raw["sequence"], minimum=1),
            action=action,
            arguments=safe_arguments(action, raw["arguments"]),
            created_at=created,
            expires_at=expires,
            idempotency_key=_id(raw["idempotency_key"]),
        )
        if len(env.canonical()) > MAX_COMMAND_BYTES:
            raise ControlError("message_too_large")
        return env

    def canonical(self) -> bytes:
        return json.dumps(
            asdict(self), sort_keys=True, separators=(",", ":"),
            ensure_ascii=True, allow_nan=False,
        ).encode("ascii")

    @property
    def digest(self) -> str:
        return hashlib.sha256(self.canonical()).hexdigest()


def sign_command(env: BrowserEnvelope, key: str) -> str:
    return hmac.new(key.encode("ascii"), env.canonical(), hashlib.sha256).hexdigest()


def verify_command(env: BrowserEnvelope, signature: str, key: str) -> None:
    if type(signature) is not str or not re.fullmatch(r"[a-f0-9]{64}", signature):
        raise ControlError("bad_signature")
    if not hmac.compare_digest(sign_command(env, key), signature):
        raise ControlError("bad_signature")
