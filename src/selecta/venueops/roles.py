"""Venue roles, command permissions, device revocation and guest minimisation (ADR-0435).

Least privilege for a venue night (AV-0435-02): the owner may do everything, a manager runs the
night, staff steer it within the policy, a guest can only make requests through Room moderation,
and a paired device (a wall tablet, a speaker) may only do what its pairing grants and never more
than the role that paired it. `PERMISSIONS` is the whole table; anything not in it is refused.

Revocation is immediate (AV-0435-03): `DeviceRegistry.revoke` marks the token revoked in the same
registry `authorize` reads, so the very next command from that token is refused, with no cache to
expire. Tokens are stored hashed, never as given.

Guests stay anonymous (AV-0435-04): a guest record may hold only the fields in `GUEST_FIELDS`, a
per-night token, a display nickname the guest chose, and request counts. `minimise_guest` drops
everything else (names, emails, phone numbers, device ids, locations) before anything is stored.
Passive camera and microphone crowd sensing is not a permission any role has.

Flag: `venue.roles`. The STRIDE threat model is docs/autopilot/threat-model-venue-roles.md.
"""

from __future__ import annotations

import hashlib
import hmac
import secrets
import time
from collections.abc import Mapping
from dataclasses import dataclass, field
from enum import StrEnum

FLAG = "venue.roles"


class Role(StrEnum):
    OWNER = "owner"
    MANAGER = "manager"
    STAFF = "staff"
    GUEST = "guest"
    DEVICE = "device"


def _staff_commands() -> tuple[str, ...]:
    """The staff command names. Read from the staff command module when it exists, so the two
    can never drift; otherwise the names agreed in the brief."""
    try:
        from selecta.venueops import staff_commands
    except ImportError:
        staff_commands = None
    names = getattr(staff_commands, "COMMANDS", None) if staff_commands else None
    if names:
        found = tuple(names) if not isinstance(names, Mapping) else tuple(names.keys())
        return tuple(str(n) for n in found)
    return BRIEF_COMMANDS


BRIEF_COMMANDS: tuple[str, ...] = (
    "energy_up", "energy_down", "hold_genre", "skip_next", "extend", "pause",
    "emergency_stop", "manual_takeover", "change_policy", "reset_learning",
)

EXTRA_COMMANDS: tuple[str, ...] = (
    "request_song", "manage_roles", "revoke_device", "pair_device", "view_guest_data",
    "export_logs",
)

_STEER = frozenset({"energy_up", "energy_down", "hold_genre", "skip_next", "extend"})
_SAFETY = frozenset({"pause", "emergency_stop"})

PERMISSIONS: Mapping[Role, frozenset[str]] = {
    Role.OWNER: frozenset(BRIEF_COMMANDS) | frozenset(EXTRA_COMMANDS),
    Role.MANAGER: _STEER | _SAFETY | {
        "manual_takeover", "change_policy", "reset_learning", "request_song", "revoke_device",
        "pair_device", "export_logs",
    },
    Role.STAFF: _STEER | _SAFETY | {"request_song"},
    Role.GUEST: frozenset({"request_song"}),
    Role.DEVICE: frozenset(),
}
"""Role -> commands it may run. A device has nothing of its own; its pairing grants a subset."""

FORBIDDEN_FOR_ALL = frozenset({"camera_crowd_sensing", "microphone_crowd_sensing"})


def commands() -> tuple[str, ...]:
    return _staff_commands() + EXTRA_COMMANDS


def unmapped_commands() -> list[str]:
    """Staff commands no role row mentions, not even the owner's. Must stay empty: a new command
    needs a decision in `PERMISSIONS` before it ships."""
    mapped = set().union(*PERMISSIONS.values())
    return sorted(set(commands()) - mapped)


def allowed(role: Role | str, command: str) -> bool:
    if command in FORBIDDEN_FOR_ALL:
        return False
    return command in PERMISSIONS.get(Role(role), frozenset())


class Refused(PermissionError):
    def __init__(self, reason: str) -> None:
        self.reason = reason
        super().__init__(reason)


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


@dataclass
class Device:
    device_id: str
    paired_by: Role
    grants: frozenset[str]
    token_hash: str
    revoked_at: float | None = None


@dataclass
class DeviceRegistry:
    """Paired devices for one venue. One registry per venue, read on every command."""

    devices: dict[str, Device] = field(default_factory=dict)
    _by_hash: dict[str, str] = field(default_factory=dict)

    def pair(self, device_id: str, paired_by: Role | str, grants: set[str] | frozenset[str]) -> str:
        """Pair a device and return its token (shown once). Grants may not exceed the pairer's."""
        role = Role(paired_by)
        if not allowed(role, "pair_device"):
            raise Refused(f"A {role.value} may not pair devices.")
        wanted = frozenset(grants)
        beyond = wanted - PERMISSIONS[role]
        if beyond:
            raise Refused(f"A {role.value} cannot grant {', '.join(sorted(beyond))}.")
        token = secrets.token_urlsafe(24)
        digest = _hash(token)
        self.devices[device_id] = Device(device_id, role, wanted, digest)
        self._by_hash[digest] = device_id
        return token

    def revoke(self, device_id: str, by: Role | str, now: float | None = None) -> None:
        role = Role(by)
        if not allowed(role, "revoke_device"):
            raise Refused(f"A {role.value} may not revoke devices.")
        device = self.devices.get(device_id)
        if device is None:
            raise KeyError(device_id)
        device.revoked_at = time.time() if now is None else now

    def device_for(self, token: str) -> Device | None:
        digest = _hash(token)
        for known, device_id in self._by_hash.items():
            if hmac.compare_digest(known, digest):
                return self.devices[device_id]
        return None


def authorize(
    command: str,
    *,
    role: Role | str | None = None,
    device_token: str | None = None,
    registry: DeviceRegistry | None = None,
) -> Role:
    """Allow or refuse one command. A device token is checked against the live registry on every
    call, so a revoked token fails on its next command. Returns the role that acted."""
    if command not in commands() and command not in FORBIDDEN_FOR_ALL:
        raise Refused(f"Unknown command {command!r}.")
    if device_token is not None:
        if registry is None:
            raise Refused("No device registry to check the token against.")
        device = registry.device_for(device_token)
        if device is None:
            raise Refused("Unknown device token.")
        if device.revoked_at is not None:
            raise Refused(f"Device {device.device_id} was revoked.")
        if command not in device.grants or not allowed(device.paired_by, command):
            raise Refused(f"Device {device.device_id} may not {command}.")
        return Role.DEVICE
    if role is None:
        raise Refused("No role or device token.")
    if not allowed(role, command):
        raise Refused(f"A {Role(role).value} may not {command}.")
    return Role(role)


# ---- AV-0435-04: guest data minimisation ----------------------------------------------------

GUEST_FIELDS: Mapping[str, str] = {
    "token": "A per-night hashed token (see venue_memory.guest_token); never a device id.",
    "nickname": "A display name the guest chose for the request list, up to 24 characters.",
    "night": "The venue night the token belongs to.",
    "requests_made": "How many requests this token made tonight, for fairness limits.",
    "requests_played": "How many of them played.",
}
"""Everything a guest record may hold. Nothing else is stored."""

NICKNAME_MAX = 24


def minimise_guest(record: Mapping[str, object]) -> dict[str, object]:
    """Keep only the allowed guest fields; trim the nickname. Returns the record to store."""
    kept = {key: record[key] for key in GUEST_FIELDS if key in record}
    nickname = kept.get("nickname")
    if isinstance(nickname, str):
        kept["nickname"] = nickname.strip()[:NICKNAME_MAX]
    return kept


def dropped_guest_fields(record: Mapping[str, object]) -> list[str]:
    return sorted(set(record) - set(GUEST_FIELDS))


__all__ = [
    "BRIEF_COMMANDS", "EXTRA_COMMANDS", "FLAG", "FORBIDDEN_FOR_ALL", "GUEST_FIELDS",
    "PERMISSIONS", "Device", "DeviceRegistry", "Refused", "Role", "allowed", "authorize",
    "commands", "dropped_guest_fields", "minimise_guest", "unmapped_commands",
]
