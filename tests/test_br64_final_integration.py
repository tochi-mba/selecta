"""Post-merge browser-first contract regressions, independent of end-user audio hardware."""
from __future__ import annotations

import json
from pathlib import Path

from selecta import flags
from selecta.lf_api import schema
from selecta.persistence import metadata
from selecta.persistence.registry import TABLE_MODULES


def test_browser_control_routes_have_explicit_rollout_flag_owners():
    config = json.loads(Path("src/selecta/flags/cloud.json").read_text())
    browser = config["flags"]["local_first.browser_control"]
    assert browser["default"] is False
    assert browser["modes"] == ["cloud"]
    owners = flags.route_owners()
    assert len(browser["routes"]) == 14
    assert all(owners.get(route) == "local_first.browser_control" for route in browser["routes"])


def test_browser_control_is_in_shared_migration_registry():
    assert "selecta.lf_api.schema" in TABLE_MODULES
    tables = (
        schema.devices, schema.sessions, schema.owners,
        schema.transfers, schema.commands, schema.history,
    )
    assert all(table.metadata is metadata for table in tables)
    assert {table.name for table in tables} == {
        "lf_browser_devices", "lf_browser_sessions", "lf_browser_owners",
        "lf_browser_transfers", "lf_browser_commands", "lf_browser_command_history",
    }


def test_browser_control_migration_has_explicit_version_and_rls():
    path = Path("src/selecta/persistence/migrations/versions/br6406ctrl01_browser_control.py")
    source = path.read_text()
    assert 'revision = "br6406ctrl01"' in source
    assert 'down_revision = "merge_0416_heads"' in source
    assert "FORCE ROW LEVEL SECURITY" in source
    assert "workspace_isolation" in source


def test_browser_first_cloud_mount_does_not_require_installed_native_audio():
    content = Path("web/src/cloud/CloudApp.tsx").read_text()
    assert "LiveBrowserIntegration workspaceId" in content
    assert "(localFirst || singleAudioOwner(account))" in content
    assert "BrowserPlaybackDock openStudio" not in content
    control = Path("src/selecta/api_cloud.py").read_text()
    assert "SELECTA_BROWSER_CONTROL_SIGNING_KEY" in control
    assert "mount_browser_control" in control
