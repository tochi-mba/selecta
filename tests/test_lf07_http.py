"""Outbound-only control transport: deterministic synthetic HTTP, no network or audio."""

import asyncio
import json

import httpx
import pytest

from selecta.lf_control import (
    ActorScope,
    CloudCoordinator,
    CommandEnvelope,
    ControlError,
    ControlJournal,
    CredentialRegistry,
    Event,
    HTTPSOutboundTransport,
    event_from_wire,
    event_to_wire,
)

NOW = 1_800_000_000


def test_event_wire_roundtrip_blocks_files_urls_and_audio():
    event = Event(
        "event1",
        "workspace",
        "device",
        1,
        1,
        "device_state",
        {"generation": 4, "engine_state": "ready"},
        NOW,
    )
    assert event_from_wire(json.dumps(event_to_wire(event))) == event
    for injected in (
        {"local_path": "/private/music.mp3"},
        {"pcm": "audio"},
        {"url": "https://untrusted.example/music.mp3"},
    ):
        with pytest.raises(ControlError, match="unsafe_event"):
            event_to_wire(
                Event(
                    "x",
                    "workspace",
                    "device",
                    1,
                    1,
                    "device_state",
                    {**event.payload, **injected},
                    NOW,
                )
            )
    with pytest.raises(ControlError, match="duplicate_field"):
        event_from_wire('{"event_id":"1","event_id":"2"}')


def test_https_transport_sends_only_metadata_and_polls_outbound(tmp_path):
    registry = CredentialRegistry(tmp_path / "credential.sqlite", master_key=b"a" * 32)
    owner = ActorScope("owner", "workspace", "owner", frozenset({"zone"}))
    code = registry.issue_pairing(owner, frozenset({"zone"}), now=NOW)
    challenge = "engine-identification-phrase"
    request = registry.propose_pairing(code, "device", challenge, now=NOW)
    registry.approve_pairing(owner, request, confirmed_challenge=challenge, now=NOW)
    credential = registry.redeem(code, "device", request_id=request, challenge=challenge, now=NOW)
    envelope = CommandEnvelope.parse(
        {
            "schema_version": 1,
            "operation_id": "operation",
            "actor_id": "owner",
            "actor_role": "owner",
            "workspace_id": "workspace",
            "zone_id": "zone",
            "target_device_id": "device",
            "expected_generation": 1,
            "expected_recipe_revision": None,
            "policy_version": 1,
            "sequence": 1,
            "command": "play",
            "arguments": {},
            "created_at": NOW,
            "expires_at": NOW + 30,
            "idempotency_key": "idempotency",
        },
        now=NOW,
    )
    signed = CloudCoordinator(registry, ControlJournal(tmp_path / "cloud.sqlite")).queue(
        envelope, owner, now=NOW
    )
    calls = []

    def server(request: httpx.Request):
        assert request.url.host == "trusted.example"
        assert request.headers["Authorization"] == "Bearer " + credential.token
        assert request.headers["x-selecta-workspace"] == "workspace"
        assert request.headers["x-selecta-protocol"] == "1"
        calls.append(request.url.path)
        if request.url.path.endswith("/events"):
            body = json.loads(request.content)
            assert set(body) == {"schema_version", "events"}
            assert body["events"][0]["kind"] == "device_state"
            return httpx.Response(
                200, json={"schema_version": 1, "acknowledged_event_ids": ["event1"]}
            )
        return httpx.Response(200, json=signed.wire())

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(server)) as client:
            outbound = HTTPSOutboundTransport("https://trusted.example", client=client)
            await outbound.connect(credential)
            event = Event(
                "event1",
                "workspace",
                "device",
                credential.generation,
                1,
                "device_state",
                {"generation": 1, "engine_state": "ready"},
                NOW,
            )
            assert await outbound.send_events([event]) == ["event1"]
            assert await outbound.receive_command() == signed
            await outbound.close()

    asyncio.run(run())
    assert calls == ["/api/local-first/v1/engine/events", "/api/local-first/v1/engine/next"]


def test_transport_rejects_remote_urls_redirects_and_unscoped_ack(tmp_path):
    for url in (
        "http://trusted.example",
        "https://trusted.example/payload",
        "https://trusted.example?x=1",
        "https://user:secret@trusted.example",
    ):
        with pytest.raises(ControlError, match="unsafe_cloud_origin"):
            HTTPSOutboundTransport(url)

    from selecta.lf_control import DeviceCredential

    credential = DeviceCredential("d", "w", frozenset({None}), "t", "key", 1, NOW + 100)
    event = Event(
        "event1", "w", "d", 1, 1, "device_state", {"generation": 1, "engine_state": "ready"}, NOW
    )

    async def run():
        # A redirect must NOT receive the bearer token or forward the POST body.
        async with httpx.AsyncClient(
            transport=httpx.MockTransport(
                lambda _: httpx.Response(307, headers={"location": "https://evil.example"})
            )
        ) as client:
            transport = HTTPSOutboundTransport("https://trusted.example", client=client)
            await transport.connect(credential)
            with pytest.raises(ControlError, match="cloud_control_response_error"):
                await transport.send_events([event])
            await transport.close()
        async with httpx.AsyncClient(
            transport=httpx.MockTransport(
                lambda _: httpx.Response(
                    200, json={"schema_version": 1, "acknowledged_event_ids": ["other-event"]}
                )
            )
        ) as client:
            transport = HTTPSOutboundTransport("https://trusted.example", client=client)
            await transport.connect(credential)
            with pytest.raises(ControlError, match="invalid_cloud_response"):
                await transport.send_events([event])
            await transport.close()

    asyncio.run(run())
