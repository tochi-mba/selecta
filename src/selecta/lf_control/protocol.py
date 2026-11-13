"""Closed, versioned, metadata-only control envelopes shared by cloud and local engines.

No route, audio transport or filesystem access is provided by this module.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import re
from dataclasses import asdict, dataclass
from typing import Any, Mapping

VERSION = 1
MAX_BYTES = 16_384
MAX_SKEW = 30.0
EPHEMERAL = frozenset({"play", "pause", "skip", "seek"})
DURABLE = frozenset({"set_volume", "set_schedule", "set_policy", "steer", "reorder", "approve_request"})
COMMANDS = EPHEMERAL | DURABLE
IDENTIFIER = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
ROLES = frozenset({"owner", "admin", "dj", "staff", "viewer"})
_ALLOWED = frozenset({
    "schema_version", "operation_id", "actor_id", "actor_role", "workspace_id", "zone_id",
    "target_device_id", "expected_generation", "expected_recipe_revision", "policy_version",
    "sequence", "command", "arguments", "created_at", "expires_at", "idempotency_key",
})
_ARG_FIELDS: dict[str, frozenset[str]] = {
    "play": frozenset(), "pause": frozenset(),
    "skip": frozenset({"song_index"}), "seek": frozenset({"song_index", "offset_ms"}),
    "set_volume": frozenset({"volume"}),
    "set_schedule": frozenset({"schedule_id", "revision", "enabled"}),
    "set_policy": frozenset({"revision", "enabled"}),
    "steer": frozenset({"direction"}),
    "reorder": frozenset({"occurrence_ids"}),
    "approve_request": frozenset({"request_id"}),
}


class ControlError(ValueError):
    def __init__(self, code: str):
        self.code = code
        super().__init__(code)


def _id(value: Any, *, optional: bool = False) -> str | None:
    if value is None and optional:
        return None
    if type(value) is not str or not IDENTIFIER.fullmatch(value):
        raise ControlError("invalid_identifier")
    return value


def _integer(value: Any, *, minimum: int = 0, maximum: int = 2**53 - 1) -> int:
    if type(value) is not int or not minimum <= value <= maximum:
        raise ControlError("invalid_integer")
    return value


def _timestamp(value: Any) -> float:
    if type(value) not in (int, float) or not 0 < value < 10**11:
        raise ControlError("invalid_timestamp")
    return float(value)


def _unique(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    found: dict[str, Any] = {}
    for key, value in pairs:
        if key in found:
            raise ControlError("duplicate_field")
        found[key] = value
    return found


def _bad_constant(_: str) -> None:
    raise ControlError("invalid_number")


def strict_json(raw: bytes | str) -> Mapping[str, Any]:
    if isinstance(raw, str):
        raw = raw.encode("utf-8")
    if len(raw) > MAX_BYTES:
        raise ControlError("message_too_large")
    try:
        doc = json.loads(raw, object_pairs_hook=_unique, parse_constant=_bad_constant)
    except (UnicodeError, json.JSONDecodeError, TypeError, ValueError) as exc:
        if isinstance(exc, ControlError):
            raise
        raise ControlError("invalid_json") from exc
    if not isinstance(doc, dict):
        raise ControlError("invalid_envelope")
    return doc


def _args(command: str, raw: Any) -> dict[str, Any]:
    if type(raw) is not dict or not raw.keys() <= _ARG_FIELDS[command]:
        raise ControlError("unsafe_arguments")
    if command in ("play", "pause") and raw:
        raise ControlError("unsafe_arguments")
    clean: dict[str, Any] = {}
    for name, value in raw.items():
        if name in {"song_index", "offset_ms"}:
            clean[name] = _integer(value, maximum=2**31 - 1)
        elif name == "volume":
            clean[name] = _integer(value, maximum=100)
        elif name in {"schedule_id", "revision", "request_id"}:
            clean[name] = _id(value)
        elif name == "enabled":
            if type(value) is not bool:
                raise ControlError("unsafe_arguments")
            clean[name] = value
        elif name == "direction":
            if value not in ("bigger", "calmer", "something_else"):
                raise ControlError("unsafe_arguments")
            clean[name] = value
        elif name == "occurrence_ids":
            if type(value) is not list or not 1 <= len(value) <= 500:
                raise ControlError("unsafe_arguments")
            clean[name] = [_id(v) for v in value]
            if len(set(clean[name])) != len(clean[name]):
                raise ControlError("unsafe_arguments")
    required = {
        "seek": {"offset_ms"}, "set_volume": {"volume"},
        "set_schedule": {"schedule_id", "revision", "enabled"},
        "set_policy": {"revision", "enabled"}, "steer": {"direction"},
        "reorder": {"occurrence_ids"}, "approve_request": {"request_id"},
    }.get(command, set())
    if not required <= clean.keys():
        raise ControlError("missing_arguments")
    return clean


@dataclass(frozen=True)
class CommandEnvelope:
    schema_version: int
    operation_id: str
    actor_id: str
    actor_role: str
    workspace_id: str
    zone_id: str | None
    target_device_id: str
    expected_generation: int
    expected_recipe_revision: str | None
    policy_version: int
    sequence: int
    command: str
    arguments: dict[str, Any]
    created_at: float
    expires_at: float
    idempotency_key: str

    @classmethod
    def parse(cls, raw: Mapping[str, Any], *, now: float | None = None) -> CommandEnvelope:
        if type(raw) is not dict or set(raw) != _ALLOWED:
            raise ControlError("invalid_envelope_fields")
        if raw["schema_version"] != VERSION or type(raw["schema_version"]) is not int:
            raise ControlError("unsupported_protocol")
        command = raw["command"]
        if type(command) is not str or command not in COMMANDS:
            raise ControlError("unsupported_command")
        role = raw["actor_role"]
        if type(role) is not str or role not in ROLES:
            raise ControlError("invalid_role")
        created = _timestamp(raw["created_at"])
        expires = _timestamp(raw["expires_at"])
        limit = 60 if command in EPHEMERAL else 7 * 86400
        if not 0 < expires - created <= limit:
            raise ControlError("invalid_expiry")
        if now is not None:
            if created > now + MAX_SKEW:
                raise ControlError("clock_skew")
            if expires <= now:
                raise ControlError("expired")
        value = cls(
            schema_version=VERSION, operation_id=_id(raw["operation_id"]),
            actor_id=_id(raw["actor_id"]), actor_role=role,
            workspace_id=_id(raw["workspace_id"]), zone_id=_id(raw["zone_id"], optional=True),
            target_device_id=_id(raw["target_device_id"]),
            expected_generation=_integer(raw["expected_generation"]),
            expected_recipe_revision=_id(raw["expected_recipe_revision"], optional=True),
            policy_version=_integer(raw["policy_version"]),
            sequence=_integer(raw["sequence"], minimum=1), command=command,
            arguments=_args(command, raw["arguments"]), created_at=created, expires_at=expires,
            idempotency_key=_id(raw["idempotency_key"]),
        )
        if len(value.canonical()) > MAX_BYTES:
            raise ControlError("message_too_large")
        return value

    def canonical(self) -> bytes:
        return json.dumps(asdict(self), sort_keys=True, separators=(",", ":"),
                          ensure_ascii=True, allow_nan=False).encode("utf-8")

    @property
    def durable(self) -> bool:
        return self.command in DURABLE

    @property
    def digest(self) -> str:
        return hashlib.sha256(self.canonical()).hexdigest()


def sign(envelope: CommandEnvelope, secret: str) -> str:
    return hmac.new(secret.encode("ascii"), envelope.canonical(), hashlib.sha256).hexdigest()


def verify(envelope: CommandEnvelope, mac: str, secret: str) -> None:
    if type(mac) is not str or not re.fullmatch(r"[a-f0-9]{64}", mac):
        raise ControlError("bad_signature")
    if not hmac.compare_digest(sign(envelope, secret), mac):
        raise ControlError("bad_signature")


@dataclass(frozen=True)
class ActorScope:
    actor_id: str
    workspace_id: str
    role: str
    zones: frozenset[str | None]


def authorise_actor(envelope: CommandEnvelope, scope: ActorScope) -> None:
    if (scope.actor_id != envelope.actor_id or scope.workspace_id != envelope.workspace_id
            or scope.role != envelope.actor_role or envelope.zone_id not in scope.zones):
        raise ControlError("scope_denied")
    if scope.role == "viewer":
        raise ControlError("role_denied")
    if envelope.command in {"set_policy", "set_schedule"} and scope.role not in {"owner", "admin"}:
        raise ControlError("role_denied")
    if envelope.command in {"steer", "reorder", "approve_request"} and scope.role == "staff":
        raise ControlError("role_denied")


@dataclass(frozen=True)
class LocalScope:
    workspace_id: str
    device_id: str
    zones: frozenset[str | None]
    minimum_policy_version: int
    generation: int
    recipe_revision: str | None
    revoked: bool = False


def authorise_local(envelope: CommandEnvelope, scope: LocalScope) -> None:
    if scope.revoked:
        raise ControlError("device_revoked")
    if (envelope.workspace_id != scope.workspace_id or envelope.target_device_id != scope.device_id
            or envelope.zone_id not in scope.zones):
        raise ControlError("scope_denied")
    if envelope.policy_version < scope.minimum_policy_version:
        raise ControlError("stale_policy")
    if envelope.expected_generation != scope.generation:
        raise ControlError("stale_generation")
    if envelope.expected_recipe_revision != scope.recipe_revision:
        raise ControlError("stale_recipe")
    authorise_actor(envelope, ActorScope(envelope.actor_id, scope.workspace_id,
                                        envelope.actor_role, scope.zones))
