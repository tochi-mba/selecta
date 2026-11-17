"""ADR-0461 fencing, expiry and command delivery truth on both database engines."""

from __future__ import annotations

import pytest

from selecta.persistence import transaction
from selecta.playback import devices, fencing, session
from selecta.playback.model import UnknownCommand
from selecta.playback.schema import playback_commands

WORKSPACE = "ws-bf-fence"
OTHER_WORKSPACE = "ws-bf-other"
USER = "user-bf-fence"


@pytest.fixture
def pair(cloud_engine):
    speaker = devices.register(
        cloud_engine, WORKSPACE, USER, name="Speaker", kind="tablet"
    ).device
    remote = devices.register(
        cloud_engine, WORKSPACE, USER, name="Remote", kind="phone"
    ).device
    return speaker, remote


def test_takeover_moves_the_fence_and_stale_fence_is_recorded_verbatim(cloud_engine, pair):
    speaker, remote = pair
    owned = session.take_over(cloud_engine, WORKSPACE, speaker.id).session
    assert owned.fence == 1

    refused = session.submit_command(
        cloud_engine,
        WORKSPACE,
        remote.id,
        "pause",
        None,
        owned.seq,
        "old-regime",
        fence=owned.fence - 1,
    )
    assert refused.status is session.CommandStatus.SUPERSEDED
    assert refused.session == owned
    with transaction(cloud_engine, WORKSPACE) as conn:
        row = conn.execute(
            playback_commands.select().where(playback_commands.c.id == refused.command_id)
        ).mappings().one()
    assert row["fence"] == 0, "the issued fence must not be rewritten as the current one"


def test_zero_ttl_expires_without_changing_the_session(cloud_engine, pair):
    speaker, remote = pair
    owned = session.take_over(cloud_engine, WORKSPACE, speaker.id).session
    refused = session.submit_command(
        cloud_engine,
        WORKSPACE,
        remote.id,
        "pause",
        None,
        owned.seq,
        "already-expired",
        fence=owned.fence,
        ttl_seconds=0,
    )
    assert refused.status is session.CommandStatus.EXPIRED
    assert refused.session == owned


def test_ack_is_idempotent_and_never_claims_audibility(cloud_engine, pair):
    speaker, remote = pair
    owned = session.take_over(cloud_engine, WORKSPACE, speaker.id).session
    command = session.submit_command(
        cloud_engine,
        WORKSPACE,
        remote.id,
        "pause",
        None,
        owned.seq,
        "delivered",
        fence=owned.fence,
    )
    first = fencing.ack_command(
        cloud_engine, WORKSPACE, speaker.id, command.command_id, fencing.ACK_APPLIED
    )
    again = fencing.ack_command(
        cloud_engine,
        WORKSPACE,
        speaker.id,
        command.command_id,
        fencing.ACK_UNAVAILABLE_HERE,
    )
    assert first.ack_result == fencing.ACK_APPLIED
    assert again.ack_result == fencing.ACK_APPLIED and again.replayed


def test_ownership_move_supersedes_an_unacked_command(cloud_engine, pair):
    speaker, remote = pair
    owned = session.take_over(cloud_engine, WORKSPACE, speaker.id).session
    command = session.submit_command(
        cloud_engine,
        WORKSPACE,
        remote.id,
        "pause",
        None,
        owned.seq,
        "move-before-ack",
        fence=owned.fence,
    )
    moved = session.take_over(cloud_engine, WORKSPACE, remote.id).session
    assert moved.fence == owned.fence + 1
    ack = fencing.ack_command(
        cloud_engine, WORKSPACE, remote.id, command.command_id, fencing.ACK_APPLIED
    )
    assert ack.ack_result == fencing.ACK_SUPERSEDED


def test_another_workspace_cannot_discover_a_command_id(cloud_engine, pair):
    speaker, remote = pair
    owned = session.take_over(cloud_engine, WORKSPACE, speaker.id).session
    command = session.submit_command(
        cloud_engine,
        WORKSPACE,
        remote.id,
        "pause",
        None,
        owned.seq,
        "private-command",
        fence=owned.fence,
    )
    outsider = devices.register(
        cloud_engine, OTHER_WORKSPACE, "other-user", name="Other", kind="phone"
    ).device
    with pytest.raises(UnknownCommand):
        fencing.ack_command(
            cloud_engine,
            OTHER_WORKSPACE,
            outsider.id,
            command.command_id,
            fencing.ACK_APPLIED,
        )
