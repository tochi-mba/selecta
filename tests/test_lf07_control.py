from __future__ import annotations

from dataclasses import asdict

import pytest

from selecta.lf_control import (ActorScope, AgentControl, CloudCoordinator, CommandEnvelope,
                                ControlError, ControlJournal, CredentialRegistry,
                                Event, ExecutionOutcome, LocalScope, SignedCommand,
                                strict_json)
from selecta.lf_control.protocol import sign

NOW = 1_800_000_000.0
MASTER_KEY = b"0123456789abcdefghijklmnopqrstuvwxyz-secret"


def setup(tmp_path, *, workspace="w1", zone="z1"):
    registry = CredentialRegistry(tmp_path / "credentials.sqlite", master_key=MASTER_KEY)
    actor = ActorScope("person1", workspace, "owner", frozenset({zone}))
    pair = registry.issue_pairing(actor, frozenset({zone}), now=NOW, ttl=120)
    credential = registry.redeem(pair, "speaker1", now=NOW)
    cloud_journal = ControlJournal(tmp_path / "cloud.sqlite")
    local_journal = ControlJournal(tmp_path / "local.sqlite")
    cloud = CloudCoordinator(registry, cloud_journal)
    local_scope = LocalScope(workspace, "speaker1", frozenset({zone}), 1, 3, "r1")
    calls = []

    def execute(env):
        calls.append(env.operation_id)
        return ExecutionOutcome(True, True, 3)

    agent = AgentControl(local_journal, credential, lambda: local_scope, execute)
    return registry, actor, credential, cloud, agent, calls


def env(command="play", *, seq=1, now=NOW, role="owner", args=None, **kwargs):
    data = {
        "schema_version": 1, "operation_id": f"op{seq}", "actor_id": "person1",
        "actor_role": role, "workspace_id": "w1", "zone_id": "z1",
        "target_device_id": "speaker1", "expected_generation": 3,
        "expected_recipe_revision": "r1", "policy_version": 1, "sequence": seq,
        "command": command, "arguments": args or {}, "created_at": now,
        "expires_at": now + (30 if command in {"play", "pause", "skip", "seek"} else 3600),
        "idempotency_key": f"key{seq}",
    }
    data.update(kwargs)
    return CommandEnvelope.parse(data, now=now)


def publish(cloud, agent, actor, credential, command, now=NOW):
    packet = cloud.queue(command, actor, credential, now=now)
    assert cloud.journal.get("w1", "speaker1", command.operation_id).state == "queued"
    cloud.delivered(packet, now=now)
    return packet


def test_pairing_one_use_expiry_and_copied_code(tmp_path):
    registry, actor, credential, *_ = setup(tmp_path)
    with pytest.raises(ControlError, match="invalid_pairing"):
        registry.redeem(registry.issue_pairing(actor, frozenset({"z1"}), now=NOW, ttl=1),
                        "speaker2", now=NOW + 1)
    pair = registry.issue_pairing(actor, frozenset({"z1"}), now=NOW)
    registry.redeem(pair, "speaker2", now=NOW)
    with pytest.raises(ControlError, match="invalid_pairing"):
        registry.redeem(pair, "evil", now=NOW)
    assert credential.token not in (pair,)


def test_rotation_and_revocation_tenant_isolation(tmp_path):
    registry, actor, credential, *_ = setup(tmp_path)
    rotated = registry.rotate("speaker1", "w1", credential.token, now=NOW + 1)
    assert rotated.generation == 2 and rotated.command_key != credential.command_key
    with pytest.raises(ControlError, match="unauthorised_device"):
        registry.authenticate("speaker1", "w1", credential.token, now=NOW + 2)
    with pytest.raises(ControlError, match="unauthorised_device"):
        registry.authenticate("speaker1", "other", rotated.token, now=NOW + 2)
    with pytest.raises(ControlError, match="unknown_device"):
        registry.revoke(ActorScope("otheradmin", "other", "owner", frozenset({"z1"})),
                        "speaker1", now=NOW + 2)
    assert registry.authenticate("speaker1", "w1", rotated.token, now=NOW + 2)
    registry.revoke(actor, "speaker1", now=NOW + 3)
    with pytest.raises(ControlError, match="unauthorised_device"):
        registry.authenticate("speaker1", "w1", rotated.token, now=NOW + 4)


def test_protocol_no_unsafe_paths_urls_shell_audio_or_downgrade():
    sample = asdict(env())
    for altered in (
        {"schema_version": 0}, {"command": "execute"},
        {"arguments": {"path": "/etc/passwd"}},
        {"arguments": {"url": "https://example.com/file"}},
        {"arguments": {"pcm": "abcd"}}, {"arguments": {"shell": "rm -rf /"}},
        {"workspace_id": "../../other"}, {"target_device_id": "https://host/path"},
        {"expected_generation": True}, {"sequence": -1},
        {"expires_at": sample["created_at"] + 1000},
    ):
        with pytest.raises(ControlError):
            CommandEnvelope.parse({**sample, **altered}, now=NOW)
    with pytest.raises(ControlError, match="duplicate_field"):
        strict_json('{"a":1,"a":2}')
    with pytest.raises(ControlError, match="message_too_large"):
        strict_json("x" * 16_385)
    with pytest.raises(ControlError, match="invalid_number"):
        strict_json('{"n": NaN}')


def test_duplicate_and_out_of_order_delivery_do_not_repeat_play(tmp_path):
    _, actor, credential, cloud, agent, calls = setup(tmp_path)
    command = env()
    packet = publish(cloud, agent, actor, credential, command)
    first = agent.receive(packet, now=NOW)
    assert first.state == "applied" and not first.replayed
    second = agent.receive(packet, now=NOW + 1)
    assert second.replayed and second.state == "applied"
    assert calls == ["op1"]
    later = publish(cloud, agent, actor, credential, env(seq=3))
    agent.receive(later, now=NOW)
    earlier = publish(cloud, agent, actor, credential, env(seq=2))
    with pytest.raises(ControlError, match="stale_sequence"):
        agent.receive(earlier, now=NOW)
    assert calls == ["op1", "op3"]


def test_delivery_is_not_playback_delayed_ack(tmp_path):
    registry, actor, credential, cloud, agent, calls = setup(tmp_path)
    command = env()
    packet = publish(cloud, agent, actor, credential, command)
    assert cloud.journal.get("w1", "speaker1", "op1").state == "delivered"
    with pytest.raises(ControlError, match="invalid_transition"):
        cloud.journal.move_cloud("w1", "speaker1", "op1", "applied", now=NOW)
    agent.receive(packet, now=NOW)
    assert cloud.journal.get("w1", "speaker1", "op1").state == "delivered"
    report = agent.report(packet, event_sequence=1, now=NOW + 10)
    ready = cloud.reconcile(report, device_id="speaker1", workspace_id="w1",
                            device_token=credential.token, now=NOW + 11)
    assert ready == (report.event_id,)
    assert cloud.journal.get("w1", "speaker1", "op1").state == "acknowledged"
    assert cloud.reconcile(report, device_id="speaker1", workspace_id="w1",
                            device_token=credential.token, now=NOW + 12) == ()


def test_old_generation_policy_zone_role_and_stolen_signature(tmp_path):
    _, actor, credential, cloud, agent, calls = setup(tmp_path)
    packet = publish(cloud, agent, actor, credential, env())
    forged = SignedCommand(packet.envelope, "0" * 64, credential.generation)
    with pytest.raises(ControlError, match="bad_signature"):
        agent.receive(forged, now=NOW)
    older = SignedCommand(packet.envelope, packet.signature, 0)
    with pytest.raises(ControlError, match="stale_credential_generation"):
        agent.receive(older, now=NOW)
    for args in ({"expected_generation": 2}, {"policy_version": 0},
                 {"zone_id": "z2"}, {"expected_recipe_revision": "r2"}):
        changed = env(seq=10, **args)
        bad = SignedCommand(changed, sign(changed, credential.command_key), credential.generation)
        with pytest.raises(ControlError):
            agent.receive(bad, now=NOW)
    assert calls == []
    with pytest.raises(ControlError, match="scope_denied"):
        cloud.queue(env(), ActorScope("person1", "other", "owner", frozenset({"z1"})),
                    credential, now=NOW)
    with pytest.raises(ControlError, match="role_denied"):
        cloud.queue(env("set_policy", args={"revision": "v2", "enabled": True},
                        role="staff"), ActorScope("person1", "w1", "staff",
                                                  frozenset({"z1"})), credential, now=NOW)


def test_no_unconfirmed_output_report_and_fail_safe_crash(tmp_path):
    _, actor, credential, cloud, agent, calls = setup(tmp_path)
    packet = publish(cloud, agent, actor, credential, env())
    agent.executor = lambda c: ExecutionOutcome(True, False, 3)
    with pytest.raises(ControlError, match="output_unconfirmed"):
        agent.receive(packet, now=NOW)
    assert agent.journal.get("w1", "speaker1", "op1").state == "accepted"
    # Replay after a crash may not perform a second audible effect.
    agent.executor = lambda c: calls.append("NEVER")
    assert agent.receive(packet, now=NOW + 1).replayed
    assert calls == []


def test_offline_expiry_reconnect_and_bounded_journal(tmp_path):
    _, actor, credential, cloud, agent, calls = setup(tmp_path)
    agent.journal.limit = 1
    first = publish(cloud, agent, actor, credential, env())
    agent.receive(first, now=NOW)
    second = publish(cloud, agent, actor, credential, env(seq=2))
    with pytest.raises(ControlError, match="journal_full"):
        agent.receive(second, now=NOW)
    assert agent.journal.discard_stale(now=NOW + 31, workspace="w1", device="speaker1") == 0
    cloud.journal.discard_stale(now=NOW + 31, workspace="w1", device="speaker1")
    assert cloud.journal.get("w1", "speaker1", "op2").state == "expired"
    with pytest.raises(ControlError, match="expired"):
        agent.receive(second, now=NOW + 31)


def test_reorder_inbox_and_metadata_only_outbox(tmp_path):
    local = ControlJournal(tmp_path / "local.sqlite", limit=2)
    cloud = ControlJournal(tmp_path / "cloud.sqlite", limit=2)
    def make(seq):
        return Event(f"e{seq}", "w1", "speaker1", 1, seq, "device_state",
                     {"generation": 3, "engine_state": "ready"}, NOW)
    assert local.append_event(make(1))
    assert not local.append_event(make(1))
    assert local.append_event(make(2))
    with pytest.raises(ControlError, match="outbox_full"):
        local.append_event(make(3))
    assert cloud.ingest_remote(make(2)) == ()
    assert cloud.ingest_remote(make(1)) == ("e1", "e2")
    # Not acknowledged yet: a crash or reducer failure must make it replayable.
    assert cloud.ingest_remote(make(1)) == ("e1", "e2")
    assert cloud.acknowledge_remote("w1", "speaker1", 1, "e1")
    assert cloud.acknowledge_remote("w1", "speaker1", 1, "e2")
    assert cloud.ingest_remote(make(1)) == ()
    assert local.acknowledge_event("w1", "speaker1", "e1", now=NOW)
    assert [x.event_id for x in local.pending_events("w1", "speaker1")] == ["e2"]
    with pytest.raises(ControlError, match="unsafe_event"):
        local.append_event(Event("e3", "w1", "speaker1", 1, 3, "device_state",
                                 {"generation": 3, "engine_state": "ready", "file_path": "C:/"}, NOW))


def test_simultaneous_controllers_idempotency_conflict(tmp_path):
    _, actor, credential, cloud, agent, _ = setup(tmp_path)
    first = env("skip", seq=1)
    publish(cloud, agent, actor, credential, first)
    with pytest.raises(ControlError, match="idempotency_conflict"):
        cloud.queue(env("pause", seq=1), actor, credential, now=NOW)
    second = env("skip", seq=2)
    publish(cloud, agent, actor, credential, second)
    agent.receive(SignedCommand(second, sign(second, credential.command_key),
                                credential.generation), now=NOW)
    with pytest.raises(ControlError, match="stale_sequence"):
        agent.receive(SignedCommand(first, sign(first, credential.command_key),
                                    credential.generation), now=NOW)


def test_revocation_prevents_new_cloud_command_even_with_cached_credential(tmp_path):
    registry, actor, credential, cloud, agent, calls = setup(tmp_path)
    registry.revoke(actor, "speaker1", now=NOW + 1)
    with pytest.raises(ControlError, match="unauthorised_device"):
        cloud.queue(env(seq=9), actor, credential, now=NOW + 2)


def test_network_loss_preserves_event_then_reconciliation_retries(tmp_path):
    _, actor, credential, cloud, agent, calls = setup(tmp_path)
    packet = publish(cloud, agent, actor, credential, env())
    agent.receive(packet, now=NOW)
    event = agent.report(packet, event_sequence=1, now=NOW + 1, event_id="report1")
    assert len(agent.journal.pending_events("w1", "speaker1")) == 1
    # Lose the connection before cloud receives the report, then reconnect.
    cloud.reconcile(event, workspace_id="w1", device_id="speaker1",
                    device_token=credential.token, now=NOW + 2)
    assert len(agent.journal.pending_events("w1", "speaker1")) == 1
    assert agent.journal.acknowledge_event("w1", "speaker1", "report1", now=NOW + 3)
    assert agent.journal.pending_events("w1", "speaker1") == []
    assert cloud.journal.get("w1", "speaker1", "op1").state == "acknowledged"


def test_remote_event_unconfirmed_audio_cannot_advance_cloud(tmp_path):
    _, actor, credential, cloud, agent, calls = setup(tmp_path)
    publish(cloud, agent, actor, credential, env())
    forged = Event("ev1", "w1", "speaker1", credential.generation, 1, "command_result",
                   {"operation_id": "op1", "status": "applied", "generation": 3,
                    "output_confirmed": False}, NOW)
    with pytest.raises(ControlError, match="unconfirmed_execution"):
        cloud.reconcile(forged, workspace_id="w1", device_id="speaker1",
                        device_token=credential.token, now=NOW)
    assert cloud.journal.get("w1", "speaker1", "op1").state == "delivered"
    # The staged event has not been consumed; a later retry cannot silently claim success.
    with pytest.raises(ControlError, match="unconfirmed_execution"):
        cloud.reconcile(forged, workspace_id="w1", device_id="speaker1",
                        device_token=credential.token, now=NOW + 1)


def test_compacted_outbox_does_not_reset_sequence(tmp_path):
    journal = ControlJournal(tmp_path / "journal.sqlite")
    event1 = Event("ev1", "w1", "speaker1", 1, 1, "device_state",
                   {"generation": 1, "engine_state": "ready"}, NOW)
    journal.append_event(event1)
    journal.acknowledge_event("w1", "speaker1", "ev1", now=NOW)
    journal.compact(before=NOW + 1)
    with pytest.raises(ControlError, match="event_out_of_order"):
        journal.append_event(Event("ev2", "w1", "speaker1", 1, 1, "device_state",
                                   {"generation": 1, "engine_state": "ready"}, NOW + 2))
    assert journal.append_event(Event("ev2", "w1", "speaker1", 1, 2, "device_state",
                                      {"generation": 1, "engine_state": "ready"}, NOW + 2))
