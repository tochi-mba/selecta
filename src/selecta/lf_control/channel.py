"""Cloud/engine adapters. The engine DIALS OUT; no public local media listener is created.

The caller supplies an authenticated user scope on cloud and a locally persisted zone/policy
snapshot on device. Agent 01 wires a TLS outbound transport. Agent 08 executes playback.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import uuid
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import Any, Protocol

from .credentials import CredentialRegistry, DeviceCredential
from .journal import CommandRecord, ControlJournal, Event
from .protocol import (
    MAX_BYTES,
    ActorScope,
    CommandEnvelope,
    ControlError,
    LocalScope,
    authorise_actor,
    sign,
    strict_json,
    verify,
)


@dataclass(frozen=True)
class SignedCommand:
    envelope: CommandEnvelope
    signature: str
    credential_generation: int

    def wire(self) -> dict:
        return {
            "envelope": json.loads(self.envelope.canonical()),
            "signature": self.signature,
            "credential_generation": self.credential_generation,
        }

    @classmethod
    def from_wire(cls, raw: bytes | str | Mapping[str, Any], *, now: float | None) -> SignedCommand:
        if type(raw) in (str, bytes):
            raw = strict_json(raw, max_bytes=MAX_BYTES + 512)
        if type(raw) is not dict or set(raw) != {"envelope", "signature", "credential_generation"}:
            raise ControlError("invalid_signed_command")
        from .protocol import _integer

        envelope = CommandEnvelope.parse(raw["envelope"], now=now)
        generation = _integer(raw["credential_generation"], minimum=1)
        signature = raw["signature"]
        if type(signature) is not str or len(signature) != 64:
            raise ControlError("bad_signature")
        return cls(envelope, signature, generation)


@dataclass(frozen=True)
class ExecutionOutcome:
    applied: bool
    output_confirmed: bool
    # This is the *observed* local owner generation, not a cloud lease number.
    generation: int


class LocalExecutor(Protocol):
    def __call__(self, command: CommandEnvelope) -> ExecutionOutcome: ...


class CloudCoordinator:
    def __init__(self, registry: CredentialRegistry, journal: ControlJournal):
        self.registry = registry
        self.journal = journal

    def queue(
        self,
        envelope: CommandEnvelope,
        actor: ActorScope,
        credential: DeviceCredential | None = None,
        *,
        now: float,
    ) -> SignedCommand:
        """An authenticated human queues a command; device bearer secrets are NOT required.

        `credential` is an optional legacy/internal consistency check, never a client input.
        """
        authorise_actor(envelope, actor)
        active = self.registry.active_device(
            envelope.target_device_id, envelope.workspace_id, now=now
        )
        if envelope.zone_id not in active.zones:
            raise ControlError("scope_denied")
        if credential is not None:
            self.registry.authenticate(
                credential.device_id, credential.workspace_id, credential.token, now=now
            )
            if (
                credential.generation != active.generation
                or credential.device_id != active.device_id
                or credential.workspace_id != active.workspace_id
            ):
                raise ControlError("stale_credential_generation")
        record = self.journal.create_cloud(envelope, now=now)
        if record.state == "created":
            self.journal.move_cloud(
                envelope.workspace_id,
                envelope.target_device_id,
                envelope.operation_id,
                "authorised",
                now=now,
            )
            self.journal.move_cloud(
                envelope.workspace_id,
                envelope.target_device_id,
                envelope.operation_id,
                "queued",
                now=now,
            )
        return SignedCommand(envelope, sign(envelope, active.command_key), active.generation)

    def delivered(self, signed: SignedCommand, *, now: float) -> CommandRecord:
        return self.journal.move_cloud(
            signed.envelope.workspace_id,
            signed.envelope.target_device_id,
            signed.envelope.operation_id,
            "delivered",
            now=now,
        )

    def reconcile(
        self, event: Event, *, device_id: str, workspace_id: str, device_token: str, now: float
    ) -> tuple[str, ...]:
        credential = self.registry.authenticate(device_id, workspace_id, device_token, now=now)
        if (
            event.device_id != credential.device_id
            or event.workspace_id != credential.workspace_id
            or event.device_generation != credential.generation
        ):
            raise ControlError("scope_denied")
        ready = self.journal.ingest_remote(event)
        for event_id in ready:
            accepted = self.journal.inbox_event(workspace_id, device_id, event_id)
            if accepted is None:
                raise ControlError("unknown_event")
            if accepted.kind != "command_result":
                self.journal.acknowledge_remote(
                    workspace_id, device_id, accepted.device_generation, event_id
                )
                continue
            payload = accepted.payload
            operation = payload["operation_id"]
            current = self.journal.get(workspace_id, device_id, operation)
            if current is None:
                raise ControlError("unknown_operation")
            if current.state in {"rejected", "conflicted", "superseded", "expired", "acknowledged"}:
                self.journal.acknowledge_remote(
                    workspace_id, device_id, accepted.device_generation, event_id
                )
                continue
            envelope = self.journal.envelope(workspace_id, device_id, operation)
            if payload["status"] == "applied":
                if (
                    envelope is None
                    or payload["generation"] != envelope.expected_generation
                    or (
                        envelope.command in {"play", "pause", "skip", "seek", "set_volume"}
                        and not payload["output_confirmed"]
                    )
                ):
                    raise ControlError("unconfirmed_execution")
                # Local execution reports are authoritative; queued/delivered alone are not.
                if current.state == "queued":
                    # The authentic engine receipt is authoritative even if a delivery receipt
                    # was lost in transit; this does not claim playback without local proof.
                    self.journal.move_cloud(
                        workspace_id, device_id, operation, "delivered", now=now
                    )
                    current = self.journal.get(workspace_id, device_id, operation)
                if current and current.state == "delivered":
                    self.journal.move_cloud(workspace_id, device_id, operation, "accepted", now=now)
                    current = self.journal.get(workspace_id, device_id, operation)
                if current and current.state == "accepted":
                    self.journal.move_cloud(
                        workspace_id, device_id, operation, "applied", now=now, local_proof=True
                    )
                if self.journal.get(workspace_id, device_id, operation).state == "applied":
                    self.journal.move_cloud(
                        workspace_id,
                        device_id,
                        operation,
                        "acknowledged",
                        now=now,
                        local_proof=True,
                    )
            elif payload["status"] == "accepted":
                if current.state == "queued":
                    self.journal.move_cloud(
                        workspace_id, device_id, operation, "delivered", now=now
                    )
                    current = self.journal.get(workspace_id, device_id, operation)
                if current and current.state == "delivered":
                    self.journal.move_cloud(workspace_id, device_id, operation, "accepted", now=now)
            elif payload["status"] in {"rejected", "conflicted", "expired"}:
                self.journal.move_cloud(
                    workspace_id, device_id, operation, payload["status"], now=now
                )
            self.journal.acknowledge_remote(
                workspace_id, device_id, accepted.device_generation, event_id
            )
        # Idempotent receipt is necessary: a lost ACK must not trap the engine outbox forever.
        if not ready and self.journal.inbox_processed(workspace_id, device_id, event):
            return (event.event_id,)
        return ready


class AgentControl:
    def __init__(
        self,
        journal: ControlJournal,
        credential: DeviceCredential,
        scope_provider: Callable[[], LocalScope],
        executor: LocalExecutor,
    ):
        self.journal = journal
        self.credential = credential
        self.scope_provider = scope_provider
        self.executor = executor

    def receive(self, signed: SignedCommand, *, now: float) -> CommandRecord:
        if signed.credential_generation != self.credential.generation:
            raise ControlError("stale_credential_generation")
        env = CommandEnvelope.parse(json.loads(signed.envelope.canonical()), now=now)
        verify(env, signed.signature, self.credential.command_key)
        scope = self.scope_provider()
        if (
            scope.workspace_id != self.credential.workspace_id
            or scope.device_id != self.credential.device_id
            or not scope.zones <= self.credential.zones
            or self.credential.expires_at <= now
        ):
            raise ControlError("scope_denied")
        record = self.journal.accept_local(env, scope, now=now)
        # A crash after acceptance is deliberately UNKNOWN, never a speculative second Play/Skip.
        if record.replayed or record.state != "accepted":
            return record
        outcome = self.executor(env)
        if type(outcome) is not ExecutionOutcome or outcome.generation != scope.generation:
            raise ControlError("invalid_execution_report")
        return self.journal.finish_local(
            env, applied=outcome.applied, output_confirmed=outcome.output_confirmed, now=now
        )

    def report(
        self,
        signed: SignedCommand,
        *,
        event_sequence: int | None = None,
        now: float,
        event_id: str | None = None,
    ) -> Event | None:
        env = signed.envelope
        record = self.journal.get(env.workspace_id, env.target_device_id, env.operation_id)
        if record is None:
            raise ControlError("unknown_operation")
        status = (
            record.state
            if record.state in {"applied", "rejected", "conflicted", "expired"}
            else "accepted"
        )
        payload = {
            "operation_id": env.operation_id,
            "status": status,
            "generation": self.scope_provider().generation,
            "output_confirmed": (
                record.state == "applied"
                and env.command in {"play", "pause", "skip", "seek", "set_volume"}
            ),
        }
        if event_sequence is None:
            if event_id is not None:
                raise ControlError("event_id_requires_sequence")
            return self.journal.append_generated_event(
                env.workspace_id,
                env.target_device_id,
                self.credential.generation,
                "command_result",
                payload,
                now=now,
                report_operation=env.operation_id,
            )
        event = Event(
            event_id or str(uuid.uuid4()),
            env.workspace_id,
            env.target_device_id,
            self.credential.generation,
            event_sequence,
            "command_result",
            payload,
            now,
        )
        self.journal.append_event(event)
        return event


class OutboundTransport(Protocol):
    async def connect(self, credential: DeviceCredential) -> None: ...
    async def send_events(self, events: list[Event]) -> list[str]: ...
    async def receive_command(self) -> SignedCommand | None: ...
    async def close(self) -> None: ...


class OutboundAgentPump:
    """No listener/socket endpoint: all network operations begin from the local process."""

    def __init__(
        self, agent: AgentControl, transport: OutboundTransport, *, now: Callable[[], float]
    ):
        self.agent, self.transport, self.now = agent, transport, now

    async def once(self) -> None:
        await self.transport.connect(self.agent.credential)
        try:
            workspace = self.agent.credential.workspace_id
            device = self.agent.credential.device_id
            await self._flush(workspace, device)
            incoming = await self.transport.receive_command()
            if incoming is not None:
                self.agent.receive(incoming, now=self.now())
                self.agent.report(incoming, now=self.now())
                await self._flush(workspace, device)
        finally:
            await self.transport.close()

    async def _flush(self, workspace: str, device: str) -> None:
        events = self.agent.journal.pending_events(workspace, device)
        if not events:
            return
        allowed_ids = {event.event_id for event in events}
        for event_id in await self.transport.send_events(events):
            if event_id not in allowed_ids:
                raise ControlError("unrecognised_event_ack")
            self.agent.journal.acknowledge_event(workspace, device, event_id, now=self.now())

    async def run(self, *, stop: asyncio.Event) -> None:
        delay = 0.5
        while not stop.is_set():
            try:
                await self.once()
                delay = 0.5
            except (OSError, TimeoutError, ConnectionError):
                # Bounded exponential backoff prevents immediate reconnect storms.
                delay = min(30.0, delay * 2)
            # Stable per-device jitter avoids synchronous reconnect spikes across a fleet.
            ident = self.agent.credential.device_id.encode("ascii")
            jitter = 0.75 + hashlib.sha256(ident).digest()[0] / 510.0
            try:
                await asyncio.wait_for(stop.wait(), timeout=delay * jitter)
            except TimeoutError:
                pass
