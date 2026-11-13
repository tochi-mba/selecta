"""Outbound-only HTTPS implementation of the local-engine metadata control channel.

A trusted install-time cloud origin is required; commands cannot replace it. No listener,
filesystem URL or audio upload is opened by this module. Routes are mounted by integrator.
"""

from __future__ import annotations

import json
from collections.abc import Mapping
from typing import Any
from urllib.parse import urlsplit

import httpx

from .channel import SignedCommand
from .credentials import DeviceCredential
from .journal import Event, _event_payload
from .protocol import MAX_BYTES, ControlError, _id, _integer, _timestamp, strict_json

MAX_EVENTS_PER_BATCH = 100
MAX_RESPONSE_BYTES = 128 * 1024


def event_to_wire(event: Event) -> dict[str, Any]:
    """Strict, metadata-only serializer; rejects unknown event kinds and unsafe values."""
    _id(event.event_id)
    _id(event.workspace_id)
    _id(event.device_id)
    _integer(event.device_generation, minimum=1)
    _integer(event.sequence, minimum=1)
    return {
        "event_id": event.event_id,
        "workspace_id": event.workspace_id,
        "device_id": event.device_id,
        "device_generation": event.device_generation,
        "sequence": event.sequence,
        "kind": event.kind,
        "payload": _event_payload(event.kind, event.payload),
        "recorded_at": _timestamp(event.recorded_at),
    }


def event_from_wire(raw: bytes | str | Mapping[str, Any]) -> Event:
    if type(raw) in (str, bytes):
        raw = strict_json(raw, max_bytes=MAX_BYTES)
    if type(raw) is not dict or set(raw) != {
        "event_id", "workspace_id", "device_id", "device_generation",
        "sequence", "kind", "payload", "recorded_at",
    }:
        raise ControlError("invalid_event_envelope")
    # Reuse the same typed validator used for local journaling.
    value = Event(
        _id(raw["event_id"]), _id(raw["workspace_id"]), _id(raw["device_id"]),
        _integer(raw["device_generation"], minimum=1),
        _integer(raw["sequence"], minimum=1), raw["kind"],
        _event_payload(raw["kind"], raw["payload"]), _timestamp(raw["recorded_at"]),
    )
    if len(json.dumps(event_to_wire(value), separators=(",", ":"))) > MAX_BYTES:
        raise ControlError("message_too_large")
    return value


class HTTPSOutboundTransport:
    """Poll cloud from behind NAT over TLS with scoped engine credentials.

    `client` permits an injected AsyncClient/MockTransport for testing. Never construct this
    from a remote command URL. Routing/authentication on cloud is a separate integration hook.
    """

    def __init__(self, cloud_origin: str, *, client: httpx.AsyncClient | None = None) -> None:
        parsed = urlsplit(cloud_origin)
        if (parsed.scheme != "https" or not parsed.hostname or parsed.username is not None
                or parsed.password is not None or parsed.path not in ("", "/")
                or parsed.query or parsed.fragment or not parsed.netloc):
            raise ControlError("unsafe_cloud_origin")
        # No redirects, no ambient proxy or cookie credentials by default.
        self._origin = cloud_origin.rstrip("/")
        self._client = client
        self._owns_client = client is None
        self._credential: DeviceCredential | None = None

    async def connect(self, credential: DeviceCredential) -> None:
        if self._credential is not None:
            raise ControlError("already_connected")
        if self._client is None:
            self._client = httpx.AsyncClient(verify=True, follow_redirects=False,
                                             trust_env=False, timeout=10.0)
        self._credential = credential

    def _headers(self) -> dict[str, str]:
        if self._credential is None:
            raise ControlError("not_connected")
        return {
            "Authorization": f"Bearer {self._credential.token}",
            "X-Selecta-Workspace": self._credential.workspace_id,
            "X-Selecta-Device": self._credential.device_id,
            "X-Selecta-Protocol": "1",
            "Accept": "application/json",
            "Cache-Control": "no-store",
        }

    async def _request(self, method: str, path: str, *, payload: dict | None = None) -> httpx.Response:
        if self._client is None:
            raise ControlError("not_connected")
        kwargs: dict[str, Any] = {"headers": self._headers(), "follow_redirects": False}
        if payload is not None:
            kwargs["content"] = json.dumps(payload, separators=(",", ":"), allow_nan=False)
            kwargs["headers"]["Content-Type"] = "application/json"
        try:
            response = await self._client.request(method, self._origin + path, **kwargs)
        except httpx.TransportError as exc:
            raise ConnectionError("control_channel_unavailable") from exc
        if response.status_code in (401, 403):
            raise ControlError("device_reauthorisation_required")
        if response.status_code >= 300 or response.status_code < 200:
            raise ControlError("cloud_control_response_error")
        if len(response.content) > MAX_RESPONSE_BYTES:
            raise ControlError("message_too_large")
        return response

    async def send_events(self, events: list[Event]) -> list[str]:
        if len(events) > MAX_EVENTS_PER_BATCH:
            raise ControlError("event_batch_too_large")
        credential = self._credential
        if credential is None:
            raise ControlError("not_connected")
        for event in events:
            if (event.workspace_id != credential.workspace_id
                    or event.device_id != credential.device_id
                    or event.device_generation != credential.generation):
                raise ControlError("scope_denied")
        response = await self._request("POST", "/api/local-first/v1/engine/events",
                                       payload={"schema_version": 1,
                                                "events": [event_to_wire(e) for e in events]})
        try:
            result = strict_json(response.content, max_bytes=MAX_RESPONSE_BYTES)
        except ControlError:
            raise
        if set(result) != {"schema_version", "acknowledged_event_ids"} or result["schema_version"] != 1:
            raise ControlError("invalid_cloud_response")
        allowed = {e.event_id for e in events}
        values = result["acknowledged_event_ids"]
        if type(values) is not list or len(values) > len(events) or any(
            type(v) is not str or v not in allowed for v in values
        ) or len(values) != len(set(values)):
            raise ControlError("invalid_cloud_response")
        return values

    async def receive_command(self) -> SignedCommand | None:
        response = await self._request("GET", "/api/local-first/v1/engine/next")
        if response.status_code == 204:
            return None
        if response.status_code != 200:
            raise ControlError("invalid_cloud_response")
        raw = strict_json(response.content, max_bytes=MAX_BYTES + 512)
        # Cloud must never hand a scoped engine another workspace's command.
        signed = SignedCommand.from_wire(raw, now=None)  # validate with agent's own clock
        if self._credential is None or signed.envelope.workspace_id != self._credential.workspace_id:
            raise ControlError("scope_denied")
        if signed.envelope.target_device_id != self._credential.device_id:
            raise ControlError("scope_denied")
        return signed

    async def close(self) -> None:
        self._credential = None
        if self._owns_client and self._client is not None:
            await self._client.aclose()
            self._client = None
