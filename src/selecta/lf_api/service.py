"""Authenticated, SQL-backed browser players and metadata-only Cloud coordination.

All public methods take a *trusted* ActorScope produced by the Cloud auth adapter.
Never derive a role, workspace or identity from client JSON or unverified headers.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import re
import secrets
import time
from collections.abc import Callable, Mapping
from contextlib import contextmanager
from dataclasses import asdict
from typing import Any

import sqlalchemy as sa
from sqlalchemy.engine import Engine

from selecta.lf_control.protocol import ActorScope, ControlError, _id, _integer

from . import schema
from .protocol import (
    INTERNAL_ACTIONS, PUBLIC_ACTIONS, TERMINAL, BrowserEnvelope,
    safe_arguments, sign_command,
)

HEARTBEAT_TTL = 20.0
PREFLIGHT_TTL = 15.0
SESSION_TTL = 3600.0
OUTPUT_STATES = frozenset({"unknown", "silent", "audible", "operator_confirmed"})
RUNTIME_STATES = frozenset({"active", "hidden", "suspended", "interrupted", "closed"})
CAPABILITIES = frozenset({
    "audio_worklet", "wasm", "webgpu", "can_play", "can_render", "mobile",
})
IDENT = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.:\-]{0,127}$")
VERSION = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.+\-]{0,63}$")


def _digest(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _required_id(value: Any) -> str:
    return _id(value)


def _timestamp(value: Any, *, now: float) -> float:
    if type(value) not in (float, int) or value < 0 or value > now + 5:
        raise ControlError("invalid_observation_time")
    return float(value)


def _caps(value: Any) -> dict[str, bool]:
    if type(value) is not dict or not value.keys() <= CAPABILITIES:
        raise ControlError("unsafe_capabilities")
    if any(type(v) is not bool for v in value.values()):
        raise ControlError("unsafe_capabilities")
    return {key: value.get(key, False) for key in sorted(CAPABILITIES)}


def _role(actor: ActorScope, zone: str, *, mutate: bool = False) -> None:
    _required_id(actor.actor_id)
    _required_id(actor.workspace_id)
    _required_id(zone)
    if actor.role not in {"owner", "admin", "dj", "staff", "viewer"}:
        raise ControlError("role_denied")
    if zone not in actor.zones:
        raise ControlError("scope_denied")
    if mutate and actor.role == "viewer":
        raise ControlError("role_denied")


def _public_role(actor: ActorScope, command: str) -> None:
    if actor.role == "viewer":
        raise ControlError("role_denied")
    if command in {"set_policy", "set_schedule"} and actor.role not in {"owner", "admin"}:
        raise ControlError("role_denied")
    if command in {"steer", "reorder", "approve_request"} and actor.role == "staff":
        raise ControlError("role_denied")


class BrowserControlService:
    """Cloud-side state machine. HTTP routers and real player/audio ports are external."""

    def __init__(
        self, engine: Engine, *, signing_key: bytes,
        authorise_entitlement: Callable[[ActorScope, str, str], bool] | None = None,
        clock: Callable[[], float] = time.time,
    ):
        if not isinstance(signing_key, bytes) or len(signing_key) < 32:
            raise ValueError("A persistent server-only 32-byte signing key is required")
        self.engine = engine
        self._key = signing_key
        self.clock = clock
        # No plan/policy authority is available inside this isolated branch.
        # The production integration must inject the actual entitlement resolver.
        # With no resolver all API operations fail closed.
        self._entitlement = authorise_entitlement

    def _scope(self, actor: ActorScope, zone: str, *, action: str = "read",
               mutate: bool = False) -> None:
        _role(actor, zone, mutate=mutate)
        if self._entitlement is None or self._entitlement(actor, zone, action) is not True:
            raise ControlError("plan_or_policy_denied")

    def create_test_schema(self) -> None:
        """Only for disposable test databases; production uses reviewed migrations."""
        schema.metadata.create_all(self.engine)

    @contextmanager
    def _tx(self):
        with self.engine.begin() as db:
            # SQLite serialises control mutations; PostgreSQL uses FOR UPDATE row locks.
            if self.engine.dialect.name == "sqlite":
                db.exec_driver_sql("BEGIN IMMEDIATE")
            yield db

    def _row(self, db, table: sa.Table, **where):
        query = sa.select(table)
        for name, value in where.items():
            query = query.where(table.c[name] == value)
        if self.engine.dialect.name == "postgresql":
            query = query.with_for_update()
        return db.execute(query).mappings().first()

    def _session(
        self, db, actor: ActorScope, session: str, token: str, *, now: float
    ) -> Mapping[str, Any]:
        _required_id(session)
        if type(token) is not str or not 32 <= len(token) <= 256:
            raise ControlError("unauthorised_session")
        row = self._row(db, schema.sessions, session=session)
        if (
            row is None or row["workspace"] != actor.workspace_id or row["actor"] != actor.actor_id
            or row["revoked"] or row["expires"] <= now
            or not hmac.compare_digest(row["token_digest"], _digest(token))
        ):
            raise ControlError("unauthorised_session")
        device = self._row(db, schema.devices, workspace=row["workspace"], device=row["device"])
        if device is None or device["revoked"]:
            raise ControlError("device_revoked")
        if not any(
            zone in actor.zones and self._entitlement is not None
            and self._entitlement(actor, zone, "session") is True
            for zone in json.loads(device["zones"])
        ):
            raise ControlError("plan_or_policy_denied")
        return row

    def _signing_secret(self, session: Mapping[str, Any]) -> str:
        input_bytes = (
            f"{session['workspace']}:{session['session']}:{session['token_digest']}"
        ).encode()
        return hmac.new(self._key, input_bytes, hashlib.sha256).hexdigest()

    def _online(self, s: Mapping[str, Any], now: float) -> bool:
        return bool(
            not s["revoked"] and s["expires"] > now
            and s["runtime_state"] == "active" and s["foreground"]
            and 0 <= now - s["heartbeat"] <= HEARTBEAT_TTL
        )

    def _target_ready(self, s: Mapping[str, Any], now: float) -> bool:
        caps = json.loads(s["capabilities"])
        return bool(
            self._online(s, now) and caps.get("audio_worklet") and caps.get("can_play")
            and s["source_ready"] and s["source_count"] > 0
            and 0 <= now - s["source_checked"] <= PREFLIGHT_TTL
            and s["output_state"] == "silent"
            and 0 <= now - s["output_checked"] <= PREFLIGHT_TTL
        )

    def register(
        self, actor: ActorScope, *, device_id: str, zone_id: str, label: str,
        capabilities: dict, browser_version: str, dsp_version: str
    ) -> dict:
        self._scope(actor, zone_id, action="register")
        _required_id(device_id)
        if type(label) is not str or not 1 <= len(label) <= 64 or any(ord(c) < 32 for c in label):
            raise ControlError("invalid_label")
        if not isinstance(browser_version, str) or not VERSION.fullmatch(browser_version):
            raise ControlError("invalid_runtime_version")
        if not isinstance(dsp_version, str) or not VERSION.fullmatch(dsp_version):
            raise ControlError("invalid_dsp_version")
        caps = _caps(capabilities)
        now = self.clock()
        token = secrets.token_urlsafe(48)
        sid = secrets.token_urlsafe(24)
        with self._tx() as db:
            device = self._row(db, schema.devices, workspace=actor.workspace_id, device=device_id)
            if device:
                if device["revoked"]:
                    raise ControlError("device_revoked")
                zones = set(json.loads(device["zones"]))
                if zone_id not in zones or (
                    device["created_by"] != actor.actor_id and actor.role not in {"owner", "admin"}
                ):
                    raise ControlError("scope_denied")
            else:
                db.execute(schema.devices.insert().values(
                    workspace=actor.workspace_id, device=device_id, label=label,
                    zones=json.dumps([zone_id]), created_by=actor.actor_id, revoked=False,
                ))
            db.execute(schema.sessions.insert().values(
                session=sid, workspace=actor.workspace_id, device=device_id, actor=actor.actor_id,
                token_digest=_digest(token), expires=now + SESSION_TTL, revoked=False,
                heartbeat=now, foreground=False, runtime_state="interrupted",
                capabilities=json.dumps(caps, sort_keys=True),
                browser_version=browser_version, dsp_version=dsp_version,
                source_ready=False, source_count=0, source_checked=0.0,
                output_state="unknown", output_checked=0.0, generation=0,
                recipe_revision=None, policy_version=0, sequence=0,
            ))
            row = self._row(db, schema.sessions, session=sid)
            return {
                "schema_version": 1, "session_id": sid, "session_token": token,
                "command_key": self._signing_secret(row),
                "expires_at": now + SESSION_TTL, "device_id": device_id,
                "workspace_id": actor.workspace_id, "zone_id": zone_id,
            }

    def refresh(self, actor: ActorScope, session: str, token: str) -> dict:
        now = self.clock()
        with self._tx() as db:
            old = self._session(db, actor, session, token, now=now)
            fresh = secrets.token_urlsafe(48)
            db.execute(schema.sessions.update().where(
                schema.sessions.c.session == session
            ).values(token_digest=_digest(fresh), expires=now + SESSION_TTL))
            row = self._row(db, schema.sessions, session=session)
            return {
                "schema_version": 1, "session_id": session, "session_token": fresh,
                "command_key": self._signing_secret(row), "expires_at": now + SESSION_TTL,
            }

    def presence(
        self, actor: ActorScope, session: str, token: str, *,
        foreground: bool, runtime_state: str, capabilities: dict,
        source_ready: bool, source_count: int, source_checked_at: float,
        output_state: str, output_checked_at: float,
        generation: int, policy_version: int, recipe_revision: str | None,
    ) -> dict:
        now = self.clock()
        if type(foreground) is not bool or runtime_state not in RUNTIME_STATES:
            raise ControlError("invalid_presence")
        if type(source_ready) is not bool or output_state not in OUTPUT_STATES:
            raise ControlError("invalid_presence")
        if type(source_count) is not int or not 0 <= source_count <= 1_000_000:
            raise ControlError("invalid_source_count")
        _integer(generation)
        _integer(policy_version)
        _id(recipe_revision, optional=True)
        clean_caps = _caps(capabilities)
        src_at = _timestamp(source_checked_at, now=now)
        out_at = _timestamp(output_checked_at, now=now)
        with self._tx() as db:
            row = self._session(db, actor, session, token, now=now)
            # A browser cannot silently downgrade its observed durable owner fence.
            if generation < row["generation"]:
                raise ControlError("stale_generation")
            db.execute(schema.sessions.update().where(
                schema.sessions.c.session == session
            ).values(
                heartbeat=now, foreground=foreground, runtime_state=runtime_state,
                capabilities=json.dumps(clean_caps, sort_keys=True),
                source_ready=source_ready, source_count=source_count,
                source_checked=src_at, output_state=output_state,
                output_checked=out_at, generation=generation,
                policy_version=policy_version, recipe_revision=recipe_revision,
            ))
        return {"schema_version": 1, "session_id": session, "observed_at": now}

    def revoke(self, actor: ActorScope, session: str, token: str | None = None) -> dict:
        now = self.clock()
        with self._tx() as db:
            row = self._row(db, schema.sessions, session=_required_id(session))
            if row is None or row["workspace"] != actor.workspace_id:
                raise ControlError("unknown_session")
            if actor.actor_id != row["actor"]:
                if actor.role not in {"owner", "admin"}:
                    raise ControlError("scope_denied")
            else:
                if token is None:
                    raise ControlError("unauthorised_session")
                self._session(db, actor, session, token, now=now)
            if not row["revoked"]:
                db.execute(schema.sessions.update().where(
                    schema.sessions.c.session == session
                ).values(revoked=True, runtime_state="closed", heartbeat=0.0))
                for owner in db.execute(sa.select(schema.owners).where(
                    schema.owners.c.workspace == actor.workspace_id,
                    schema.owners.c.speaker_session == session,
                )).mappings():
                    db.execute(schema.owners.update().where(
                        schema.owners.c.workspace == owner["workspace"],
                        schema.owners.c.zone == owner["zone"],
                    ).values(state="unknown"))
        return {"schema_version": 1, "session_id": session, "revoked": True}

    def devices(self, actor: ActorScope, zone: str) -> dict:
        self._scope(actor, zone)
        now = self.clock()
        with self.engine.connect() as db:
            rows = db.execute(
                sa.select(schema.sessions, schema.devices.c.label)
                .join(schema.devices, sa.and_(
                    schema.sessions.c.workspace == schema.devices.c.workspace,
                    schema.sessions.c.device == schema.devices.c.device,
                ))
                .where(schema.sessions.c.workspace == actor.workspace_id,
                       schema.devices.c.revoked == sa.false())
            ).mappings().all()
            result = []
            for s in rows:
                d = self._row(db, schema.devices, workspace=s["workspace"], device=s["device"])
                if zone not in json.loads(d["zones"]):
                    continue
                result.append({
                    "device_id": s["device"], "session_id": s["session"], "label": s["label"],
                    "online": self._online(s, now), "runtime_state": s["runtime_state"],
                    "foreground": bool(s["foreground"]),
                    "capabilities": json.loads(s["capabilities"]),
                    "browser_version": s["browser_version"], "dsp_version": s["dsp_version"],
                    "source_ready": bool(s["source_ready"]) and
                       0 <= now - s["source_checked"] <= PREFLIGHT_TTL,
                    "source_count": s["source_count"],
                    "output_state": s["output_state"] if
                       0 <= now - s["output_checked"] <= PREFLIGHT_TTL else "unknown",
                    "generation": s["generation"],
                })
            return {"schema_version": 1, "devices": result}

    def speaker(self, actor: ActorScope, zone: str) -> dict:
        self._scope(actor, zone)
        now = self.clock()
        with self.engine.connect() as db:
            owner = self._row(db, schema.owners, workspace=actor.workspace_id, zone=zone)
            if owner is None:
                return {"schema_version": 1, "zone_id": zone, "generation": 0,
                        "speaker_session_id": None, "state": "unprovisioned"}
            speaker = None
            if owner["speaker_session"]:
                speaker = self._row(db, schema.sessions, session=owner["speaker_session"])
            fresh = bool(speaker is not None and self._online(speaker, now))
            # A heartbeat / network lease is NEVER proof of physical silence or audio.
            # Liveness alone never proves sound; a current output observation is required.
            confirmed_output = bool(
                speaker is not None and 0 <= now - speaker["output_checked"] <= PREFLIGHT_TTL
                and speaker["output_state"] in {"audible", "operator_confirmed"}
            )
            status = owner["state"] if (
                not owner["speaker_session"] or (fresh and confirmed_output)
            ) else "unknown"
            return {
                "schema_version": 1, "zone_id": zone, "generation": owner["generation"],
                "speaker_session_id": owner["speaker_session"],
                "state": status, "online": fresh,
                "pending_transfer": owner["pending_transfer"],
            }

    def _change(self, db, command, state: str, now: float) -> None:
        if command["state"] == state:
            return
        db.execute(schema.commands.update().where(
            schema.commands.c.operation == command["operation"]
        ).values(state=state, updated=now))
        db.execute(schema.history.insert().values(
            operation=command["operation"], workspace=command["workspace"],
            state=state, at=now,
        ))

    def _queue(
        self, db, *, actor: ActorScope, zone: str, target, action: str,
        args: dict, expected_generation: int, recipe_revision: str | None,
        policy_version: int, operation_id: str, idempotency_key: str,
        transfer: str | None, now: float, ttl: float,
    ) -> dict:
        _required_id(operation_id)
        _required_id(idempotency_key)
        args = safe_arguments(action, args)
        stable = json.dumps(
            [actor.workspace_id, zone, target["session"], actor.actor_id, action,
             args, expected_generation, recipe_revision, policy_version, transfer],
            sort_keys=True, separators=(",", ":"), ensure_ascii=True,
        )
        req_digest = _digest(stable)
        duplicate = db.execute(sa.select(schema.commands).where(
            sa.or_(
                schema.commands.c.operation == operation_id,
                sa.and_(schema.commands.c.workspace == actor.workspace_id,
                        schema.commands.c.idempotency_key == idempotency_key),
            )
        )).mappings().first()
        if duplicate:
            if duplicate["operation"] != operation_id or duplicate["request_digest"] != req_digest:
                raise ControlError("idempotency_conflict")
            return {"operation_id": operation_id, "state": duplicate["state"],
                    "replayed": True}
        sequence = target["sequence"] + 1
        db.execute(schema.sessions.update().where(
            schema.sessions.c.session == target["session"]
        ).values(sequence=sequence))
        env = BrowserEnvelope.parse({
            "schema_version": 1, "operation_id": operation_id,
            "actor_id": actor.actor_id, "actor_role": actor.role,
            "workspace_id": actor.workspace_id, "zone_id": zone,
            "session_id": target["session"], "target_device_id": target["device"],
            "expected_generation": expected_generation,
            "expected_recipe_revision": recipe_revision, "policy_version": policy_version,
            "sequence": sequence, "action": action, "arguments": args,
            "created_at": int(now), "expires_at": int(now + ttl),
            "idempotency_key": idempotency_key,
        }, now=now)
        db.execute(schema.commands.insert().values(
            operation=operation_id, workspace=actor.workspace_id, zone=zone,
            session=target["session"], idempotency_key=idempotency_key,
            request_digest=req_digest, envelope=env.canonical().decode("ascii"),
            action=action, state="created", expires=env.expires_at,
            updated=now, transfer=transfer,
        ))
        initial = {"operation": operation_id, "workspace": actor.workspace_id, "state": "created"}
        db.execute(schema.history.insert().values(**initial, at=now))
        for state in ("authorised", "queued"):
            initial["state"] = state
            db.execute(schema.history.insert().values(**initial, at=now))
        db.execute(schema.commands.update().where(
            schema.commands.c.operation == operation_id
        ).values(state="queued"))
        return {"operation_id": operation_id, "state": "queued", "replayed": False}

    def command(
        self, actor: ActorScope, *, zone: str, target_session: str,
        operation_id: str, idempotency_key: str, action: str, arguments: dict,
        expected_generation: int, recipe_revision: str | None, policy_version: int,
    ) -> dict:
        self._scope(actor, zone, action="control", mutate=True)
        if action not in PUBLIC_ACTIONS:
            raise ControlError("unsupported_command")
        _public_role(actor, action)
        self._scope(actor, zone, action=action, mutate=True)
        _required_id(target_session)
        _integer(expected_generation)
        _integer(policy_version)
        _id(recipe_revision, optional=True)
        now = self.clock()
        with self._tx() as db:
            owner = self._row(db, schema.owners, workspace=actor.workspace_id, zone=zone)
            target = self._row(db, schema.sessions, session=target_session)
            if owner is None or target is None or target["workspace"] != actor.workspace_id:
                raise ControlError("speaker_unavailable")
            if owner["speaker_session"] != target_session or owner["state"] != "audible":
                raise ControlError("not_current_speaker")
            if owner["pending_transfer"]:
                raise ControlError("transfer_busy")
            if owner["generation"] != expected_generation:
                raise ControlError("stale_generation")
            if not self._online(target, now):
                raise ControlError("speaker_unreachable")
            if policy_version < target["policy_version"]:
                raise ControlError("stale_policy")
            if recipe_revision != target["recipe_revision"]:
                raise ControlError("stale_recipe")
            result = self._queue(
                db, actor=actor, zone=zone, target=target, action=action, args=arguments,
                expected_generation=expected_generation, recipe_revision=recipe_revision,
                policy_version=policy_version, operation_id=operation_id,
                idempotency_key=idempotency_key, transfer=None, now=now,
                ttl=30 if action in {"play", "pause", "skip", "seek"} else 3600,
            )
            return {"schema_version": 1, **result}

    def takeover(
        self, actor: ActorScope, *, zone: str, target_session: str,
        operation_id: str, idempotency_key: str, expected_generation: int,
        initial_silence_confirmed: bool = False,
    ) -> dict:
        self._scope(actor, zone, action="control", mutate=True)
        if actor.role not in {"owner", "admin", "dj"}:
            raise ControlError("role_denied")
        self._scope(actor, zone, action="takeover", mutate=True)
        for item in (target_session, operation_id, idempotency_key):
            _required_id(item)
        _integer(expected_generation)
        if type(initial_silence_confirmed) is not bool:
            raise ControlError("invalid_initial_silence")
        now = self.clock()
        with self._tx() as db:
            old = db.execute(sa.select(schema.transfers).where(
                sa.or_(schema.transfers.c.transfer == operation_id,
                       sa.and_(schema.transfers.c.workspace == actor.workspace_id,
                               schema.transfers.c.zone == zone,
                               schema.transfers.c.idempotency_key == idempotency_key))
            )).mappings().first()
            if old:
                if (
                    old["transfer"] != operation_id or old["target_session"] != target_session
                    or old["actor"] != actor.actor_id
                    or old["generation"] != expected_generation + 1
                ):
                    raise ControlError("idempotency_conflict")
                return {"schema_version": 1, "transfer_id": operation_id,
                        "stage": old["stage"], "generation": old["generation"], "replayed": True}
            target = self._row(db, schema.sessions, session=target_session)
            if target is None or target["workspace"] != actor.workspace_id:
                raise ControlError("scope_denied")
            device = self._row(db, schema.devices, workspace=actor.workspace_id,
                               device=target["device"])
            if device is None or zone not in json.loads(device["zones"]):
                raise ControlError("scope_denied")
            if not self._target_ready(target, now):
                raise ControlError("destination_preflight_failed")
            owner = self._row(db, schema.owners, workspace=actor.workspace_id, zone=zone)
            if owner is None:
                # A first-time owner claim is a privileged on-site assertion, NOT lease expiry.
                if not initial_silence_confirmed or actor.role not in {"owner", "admin"}:
                    raise ControlError("initial_physical_silence_required")
                db.execute(schema.owners.insert().values(
                    workspace=actor.workspace_id, zone=zone, generation=0,
                    speaker_session=None, state="silent", pending_transfer=None,
                ))
                owner = self._row(db, schema.owners, workspace=actor.workspace_id, zone=zone)
            if owner["pending_transfer"]:
                raise ControlError("transfer_busy")
            if owner["generation"] != expected_generation:
                raise ControlError("stale_generation")
            if owner["speaker_session"] == target_session:
                raise ControlError("already_speaker")
            if owner["speaker_session"]:
                source = self._row(db, schema.sessions, session=owner["speaker_session"])
                if source is None or not self._online(source, now) or owner["state"] != "audible":
                    raise ControlError("unsafe_partition_takeover")
            else:
                if owner["state"] != "silent":
                    raise ControlError("unverified_old_output")
            generation = expected_generation + 1
            db.execute(schema.transfers.insert().values(
                transfer=operation_id, workspace=actor.workspace_id, zone=zone,
                idempotency_key=idempotency_key, actor=actor.actor_id, role=actor.role,
                source_session=owner["speaker_session"], target_session=target_session,
                generation=generation, stage="preparing", expires=now + 120, updated=now,
            ))
            db.execute(schema.owners.update().where(
                schema.owners.c.workspace == actor.workspace_id,
                schema.owners.c.zone == zone
            ).values(pending_transfer=operation_id))
            self._queue(
                db, actor=actor, zone=zone, target=target, action="prepare_output",
                args={"transfer_id": operation_id}, expected_generation=generation,
                recipe_revision=target["recipe_revision"], policy_version=target["policy_version"],
                operation_id="p" + operation_id, idempotency_key="p" + operation_id,
                transfer=operation_id, now=now, ttl=120,
            )
            return {"schema_version": 1, "transfer_id": operation_id,
                    "stage": "preparing", "generation": generation, "replayed": False}

    def _block_transfer(self, db, row, now: float) -> None:
        transfer_id = row["transfer"]
        if not transfer_id:
            return
        tr = self._row(db, schema.transfers, transfer=transfer_id)
        if tr is None or tr["stage"] in {"started", "blocked"}:
            return
        db.execute(schema.transfers.update().where(
            schema.transfers.c.transfer == transfer_id
        ).values(stage="blocked", updated=now))
        db.execute(schema.owners.update().where(
            schema.owners.c.workspace == tr["workspace"],
            schema.owners.c.zone == tr["zone"],
            schema.owners.c.pending_transfer == transfer_id,
        ).values(pending_transfer=None))

    def _expire(self, db, *, session: str, now: float) -> None:
        rows = db.execute(sa.select(schema.commands).where(
            schema.commands.c.session == session,
            schema.commands.c.state.in_(
                ("created", "authorised", "queued", "delivered", "accepted")
            ),
            schema.commands.c.expires <= now,
        )).mappings().all()
        for row in rows:
            self._change(db, row, "expired", now)
            self._block_transfer(db, row, now)

    def poll(self, actor: ActorScope, session: str, token: str) -> dict:
        now = self.clock()
        with self._tx() as db:
            s = self._session(db, actor, session, token, now=now)
            if not self._online(s, now):
                raise ControlError("browser_not_running")
            self._expire(db, session=session, now=now)
            command = db.execute(sa.select(schema.commands).where(
                schema.commands.c.workspace == actor.workspace_id,
                schema.commands.c.session == session,
                schema.commands.c.state == "queued",
            ).order_by(
                schema.commands.c.updated, schema.commands.c.operation
            ).limit(1)).mappings().first()
            if command is None:
                return {"schema_version": 1, "command": None}
            env = BrowserEnvelope.parse(json.loads(command["envelope"]), now=now)
            self._change(db, command, "delivered", now)
            return {
                "schema_version": 1, "command": asdict(env),
                "signature": sign_command(env, self._signing_secret(s)),
            }

    def ack(
        self, actor: ActorScope, session: str, token: str, operation_id: str, *,
        status: str, fenced_generation: int, output_confirmed: bool = False,
        output_silent: bool = False, execution_verified: bool = False,
    ) -> dict:
        now = self.clock()
        _required_id(operation_id)
        _integer(fenced_generation)
        if (
            status not in {"accepted", "applied", "rejected", "conflicted"}
            or any(type(v) is not bool for v in
                   (output_confirmed, output_silent, execution_verified))
        ):
            raise ControlError("invalid_ack")
        with self._tx() as db:
            self._session(db, actor, session, token, now=now)
            row = self._row(db, schema.commands, operation=operation_id)
            if row is None or row["workspace"] != actor.workspace_id or row["session"] != session:
                raise ControlError("unknown_operation")
            if row["state"] in TERMINAL:
                return {"schema_version": 1, "operation_id": operation_id,
                        "state": row["state"], "replayed": True}
            if row["expires"] <= now:
                self._change(db, row, "expired", now)
                self._block_transfer(db, row, now)
                return {"schema_version": 1, "operation_id": operation_id,
                        "state": "expired", "replayed": False}
            if row["state"] not in {"delivered", "accepted"}:
                raise ControlError("invalid_transition")
            env = BrowserEnvelope.parse(json.loads(row["envelope"]), now=now)
            if status == "accepted":
                self._change(db, row, "accepted", now)
                return {"schema_version": 1, "operation_id": operation_id,
                        "state": "accepted", "replayed": row["state"] == "accepted"}
            if status in {"rejected", "conflicted"}:
                self._change(db, row, status, now)
                self._block_transfer(db, row, now)
                return {"schema_version": 1, "operation_id": operation_id,
                        "state": status, "replayed": False}
            if row["state"] != "accepted":
                raise ControlError("acceptance_required")
            if fenced_generation < env.expected_generation:
                raise ControlError("stale_generation")
            tr = None
            if row["transfer"]:
                tr = self._row(db, schema.transfers, transfer=row["transfer"])
                if tr is None or tr["stage"] in {"started", "blocked"} or tr["expires"] <= now:
                    raise ControlError("transfer_not_active")
            if row["action"] in {"play", "pause", "skip", "seek", "set_volume"}:
                if not execution_verified:
                    raise ControlError("local_execution_unverified")
                if row["action"] == "play" and not output_confirmed:
                    raise ControlError("output_unconfirmed")
            elif row["action"] not in INTERNAL_ACTIONS and not execution_verified:
                raise ControlError("local_execution_unverified")
            if row["action"] in {"prepare_output", "release_output"}:
                if not output_silent:
                    raise ControlError("physical_silence_unconfirmed")
            elif row["action"] == "activate_output" and not output_confirmed:
                raise ControlError("physical_output_unconfirmed")
            self._change(db, row, "applied", now)
            if tr:
                self._advance_transfer(db, tr, row["action"], now)
            self._change(db, row, "acknowledged", now)
            return {"schema_version": 1, "operation_id": operation_id,
                    "state": "acknowledged", "replayed": False}

    def _advance_transfer(self, db, tr, action: str, now: float) -> None:
        owner = self._row(db, schema.owners, workspace=tr["workspace"], zone=tr["zone"])
        if owner is None or owner["pending_transfer"] != tr["transfer"]:
            raise ControlError("transfer_conflict")
        actor = ActorScope(tr["actor"], tr["workspace"], tr["role"], frozenset({tr["zone"]}))
        generation = tr["generation"]
        if action == "prepare_output":
            if tr["stage"] != "preparing":
                raise ControlError("transfer_conflict")
            source = tr["source_session"]
            if source:
                old = self._row(db, schema.sessions, session=source)
                if old is None or not self._online(old, now):
                    raise ControlError("unsafe_partition_takeover")
                target = old
                next_action = "release_output"
                stage = "awaiting_release"
            else:
                target = self._row(db, schema.sessions, session=tr["target_session"])
                next_action = "activate_output"
                stage = "awaiting_activation"
        elif action == "release_output":
            if tr["stage"] != "awaiting_release":
                raise ControlError("transfer_conflict")
            # The real source reported both physical silence and a locally durable fence.
            db.execute(schema.owners.update().where(
                schema.owners.c.workspace == tr["workspace"],
                schema.owners.c.zone == tr["zone"],
            ).values(generation=generation, speaker_session=None, state="silent"))
            target = self._row(db, schema.sessions, session=tr["target_session"])
            next_action = "activate_output"
            stage = "awaiting_activation"
        elif action == "activate_output":
            if tr["stage"] != "awaiting_activation":
                raise ControlError("transfer_conflict")
            db.execute(schema.owners.update().where(
                schema.owners.c.workspace == tr["workspace"],
                schema.owners.c.zone == tr["zone"],
            ).values(generation=generation, speaker_session=tr["target_session"],
                     state="audible", pending_transfer=None))
            db.execute(schema.sessions.update().where(
                schema.sessions.c.session == tr["target_session"]
            ).values(generation=generation, output_state="operator_confirmed",
                     output_checked=now))
            db.execute(schema.transfers.update().where(
                schema.transfers.c.transfer == tr["transfer"]
            ).values(stage="started", updated=now))
            return
        else:
            raise ControlError("transfer_conflict")
        if target is None:
            raise ControlError("speaker_unavailable")
        if not self._online(target, now):
            raise ControlError("unsafe_partition_takeover")
        self._queue(
            db, actor=actor, zone=tr["zone"], target=target, action=next_action,
            args={"transfer_id": tr["transfer"]}, expected_generation=generation,
            recipe_revision=target["recipe_revision"], policy_version=target["policy_version"],
            operation_id=("r" if next_action == "release_output" else "a") + tr["transfer"],
            idempotency_key=("r" if next_action == "release_output" else "a") + tr["transfer"],
            transfer=tr["transfer"], now=now, ttl=min(120.0, tr["expires"] - now),
        )
        db.execute(schema.transfers.update().where(
            schema.transfers.c.transfer == tr["transfer"]
        ).values(stage=stage, updated=now))

    def revoke_device(self, actor: ActorScope, device_id: str) -> dict:
        """Admin/owner revocation invalidates all of this device's browser sessions."""
        if actor.role not in {"owner", "admin"}:
            raise ControlError("role_denied")
        _required_id(device_id)
        with self._tx() as db:
            device = self._row(db, schema.devices, workspace=actor.workspace_id,
                               device=device_id)
            if device is None or not set(json.loads(device["zones"])) <= actor.zones:
                raise ControlError("scope_denied")
            for zone in json.loads(device["zones"]):
                self._scope(actor, zone, action="revoke_device", mutate=True)
            db.execute(schema.devices.update().where(
                schema.devices.c.workspace == actor.workspace_id,
                schema.devices.c.device == device_id
            ).values(revoked=True))
            affected = db.execute(sa.select(schema.sessions.c.session).where(
                schema.sessions.c.workspace == actor.workspace_id,
                schema.sessions.c.device == device_id
            )).scalars().all()
            db.execute(schema.sessions.update().where(
                schema.sessions.c.workspace == actor.workspace_id,
                schema.sessions.c.device == device_id,
            ).values(revoked=True, runtime_state="closed"))
            if affected:
                db.execute(schema.owners.update().where(
                    schema.owners.c.workspace == actor.workspace_id,
                    schema.owners.c.speaker_session.in_(affected),
                ).values(state="unknown"))
        return {"schema_version": 1, "device_id": device_id, "revoked": True}

    def recovery(self, actor: ActorScope, session: str, token: str) -> dict:
        """Metadata-only reconciliation, never automatic re-execution after a dropped ACK."""
        now = self.clock()
        with self._tx() as db:
            record = self._session(db, actor, session, token, now=now)
            self._expire(db, session=session, now=now)
            outstanding = db.execute(sa.select(schema.commands).where(
                schema.commands.c.workspace == actor.workspace_id,
                schema.commands.c.session == session,
                schema.commands.c.state.in_(("queued", "delivered", "accepted", "applied"))
            ).order_by(schema.commands.c.updated).limit(100)).mappings().all()
            return {
                "schema_version": 1, "session_id": session,
                "online": self._online(record, now),
                "generation": record["generation"],
                "last_issued_sequence": record["sequence"],
                "outstanding": [
                    {"operation_id": item["operation"], "state": item["state"]}
                    for item in outstanding
                ],
                "replay_is_unsafe": any(
                    item["state"] in {"delivered", "accepted", "applied"}
                    for item in outstanding
                ),
            }

    def status(self, actor: ActorScope, zone: str, operation_id: str) -> dict:
        self._scope(actor, zone)
        _required_id(operation_id)
        now = self.clock()
        with self._tx() as db:
            row = self._row(db, schema.commands, operation=operation_id)
            if row is None or row["workspace"] != actor.workspace_id or row["zone"] != zone:
                raise ControlError("unknown_operation")
            self._expire(db, session=row["session"], now=now)
            row = self._row(db, schema.commands, operation=operation_id)
            return {"schema_version": 1, "operation_id": operation_id, "state": row["state"]}

    def transfer_status(self, actor: ActorScope, zone: str, transfer_id: str) -> dict:
        self._scope(actor, zone)
        with self.engine.connect() as db:
            row = self._row(db, schema.transfers, transfer=_required_id(transfer_id))
            if row is None or row["workspace"] != actor.workspace_id or row["zone"] != zone:
                raise ControlError("unknown_transfer")
            return {"schema_version": 1, "transfer_id": transfer_id, "stage": row["stage"],
                    "generation": row["generation"]}
