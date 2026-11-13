"""Selecta local-first metadata-only device control protocol (v1)."""

from .channel import (
    AgentControl,
    CloudCoordinator,
    ExecutionOutcome,
    OutboundAgentPump,
    SignedCommand,
)
from .credentials import CredentialRegistry, DeviceCredential, DeviceRegistration
from .http_transport import HTTPSOutboundTransport, event_from_wire, event_to_wire
from .journal import CommandRecord, ControlJournal, Event
from .protocol import (
    ActorScope,
    CommandEnvelope,
    ControlError,
    LocalScope,
    authorise_actor,
    authorise_local,
    sign,
    strict_json,
    verify,
)

__all__ = [
    "ActorScope",
    "AgentControl",
    "CloudCoordinator",
    "CommandEnvelope",
    "CommandRecord",
    "ControlError",
    "ControlJournal",
    "CredentialRegistry",
    "DeviceCredential",
    "DeviceRegistration",
    "Event",
    "ExecutionOutcome",
    "LocalScope",
    "OutboundAgentPump",
    "SignedCommand",
    "authorise_actor",
    "authorise_local",
    "sign",
    "strict_json",
    "verify",
    "HTTPSOutboundTransport",
    "event_from_wire",
    "event_to_wire",
]
