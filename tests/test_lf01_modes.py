from __future__ import annotations

import pytest

from selecta.modes.core import (
    Connectivity,
    EngineRole,
    Mode,
    ModeError,
    WorkspaceKind,
    current_mode,
    parse_mode,
    runtime_topology,
)


def test_legacy_defaults_preserved(monkeypatch):
    for key in (
        "SELECTA_MODE",
        "SELECTA_WORKSPACE_KIND",
        "SELECTA_ENGINE_ROLE",
        "SELECTA_CONNECTIVITY",
    ):
        monkeypatch.delenv(key, raising=False)
    assert current_mode() is Mode.LOCAL
    assert parse_mode(" cloud ") is Mode.CLOUD
    topology = runtime_topology()
    assert topology.workspace is WorkspaceKind.STANDALONE
    assert topology.role is EngineRole.LOCAL_ENGINE
    assert topology.connectivity is Connectivity.OFFLINE
    assert topology.may_execute_local_audio


def test_cloud_mode_never_claims_audio_execution(monkeypatch):
    monkeypatch.setenv("SELECTA_MODE", "cloud")
    assert runtime_topology().role is EngineRole.CONTROLLER_ONLY
    assert not runtime_topology().may_execute_local_audio
    monkeypatch.setenv("SELECTA_ENGINE_ROLE", "local_engine")
    with pytest.raises(ModeError, match="hosted cloud"):
        runtime_topology()


def test_independent_controller_and_offline_connectivity(monkeypatch):
    monkeypatch.setenv("SELECTA_MODE", "local")
    monkeypatch.setenv("SELECTA_WORKSPACE_KIND", "organisation")
    monkeypatch.setenv("SELECTA_ENGINE_ROLE", "controller_only")
    monkeypatch.setenv("SELECTA_CONNECTIVITY", "offline")
    topology = runtime_topology()
    assert topology.workspace is WorkspaceKind.ORGANISATION
    assert not topology.may_execute_local_audio
    assert topology.connectivity is Connectivity.OFFLINE


def test_invalid_axis_explains_choices(monkeypatch):
    monkeypatch.setenv("SELECTA_CONNECTIVITY", "maybe")
    with pytest.raises(ModeError, match="SELECTA_CONNECTIVITY"):
        runtime_topology()
