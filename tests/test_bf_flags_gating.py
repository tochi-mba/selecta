"""Browser-first Cloud flag layer (ADR-0455, ADR-0456): the registry carries the seven BF flags
with their exact requires edges, a USERS rule on `cloud.hosted_media` gates one account's uploads
without darkening its stored media, hosted jobs are admitted under the grant, `/api/account`
carries the decided experience, and the export answers for a workspace with no originals."""

from __future__ import annotations

import io
import json
import zipfile

from cloud_helpers import grant_hosted_media
from cloud_party import ALICE, CAROL, auth
from cloud_world import HEADERS, signed_up
from fastapi.routing import APIRoute

from selecta import flags
from selecta.api import create_app
from selecta.config import Settings
from selecta.flags import rules as flag_rules
from selecta.flags.matching import Rule, RuleKind
from selecta.persistence import transaction
from selecta.scheduling.policy import Lane
from selecta.work.catalogue import flag_for

pytest_plugins = ("cloud_party",)

# Browser-first is what Cloud ships (owner decision 2026-11-22, ADR-0455): these default on.
# The venue tablet stays dark until its own evidence passes.
SHIPS_DARK = {"cloud.venue_tablet"}

# Every Browser-first Cloud flag and its exact requires edge (ADR-0455, ADR-0456).
BF_FLAGS = {
    "cloud.hosted_media": (),
    "cloud.local_first": (),
    "devices.browser_player": ("devices",),
    "cloud.local_media": (),
    "cloud.browser_dsp": ("devices.browser_player",),
    "cloud.venue_tablet": ("devices.browser_player",),
    "cloud.local_export": ("devices.browser_player",),
}


def _rules(party, flag_id: str, rules) -> None:
    with transaction(party.engine) as conn:
        flag_rules.save(conn, flag_id, rules, author="tests", reason="BF flag gating test")
    party.app.state.flag_rules.invalidate()


def test_the_bf_flags_are_registered_with_their_exact_requires_edges():
    registry = flags.registry()
    for flag_id, requires in BF_FLAGS.items():
        assert flag_id in registry, f"{flag_id} is not registered"
        assert registry[flag_id].requires == requires, f"{flag_id} has the wrong requires edge"
        assert registry[flag_id].kind == "release"
        assert registry[flag_id].owner == "playback"
    # The uploads plane hangs off the umbrella grant (BF-0456-01).
    assert registry["cloud.uploads"].requires == ("cloud.hosted_media",)
    # The build ships the grant on: rules can never grant past a build-off (ADR-0414 layer
    # order), so per-account default off is the rules layer's answer (`rules_default: false`).
    assert registry["cloud.hosted_media"].default is True
    assert registry["cloud.hosted_media"].rules_default is False
    for flag_id in BF_FLAGS:
        assert registry[flag_id].default is (flag_id not in SHIPS_DARK), flag_id
        if flag_id != "cloud.hosted_media":
            assert registry[flag_id].rules_default is True, f"{flag_id} is not a grant"


def test_every_bf_flag_is_cloud_mode_only_and_local_mode_never_serves_it(tmp_path):
    """ADR-0455: `SELECTA_MODE=local` never consults a BF flag. Each one is cloud-mode only, and
    none of the routes they own is mounted by the local app (built as `tests/test_flags.py`
    builds it)."""
    registry = flags.registry()
    for flag_id in BF_FLAGS:
        assert registry[flag_id].modes == ("cloud",), f"{flag_id} must be cloud-mode only"
    local_app = create_app(Settings(tmp_path), tmp_path / "no-web")
    local_routes = {
        f"{method} {route.path}"
        for route in local_app.routes
        if isinstance(route, APIRoute) and route.path.startswith("/api/")
        for method in route.methods
    }
    owned = {route for flag_id in BF_FLAGS for route in registry[flag_id].routes}
    assert not owned & local_routes, "the local app serves routes owned by BF cloud flags"
    # Local resolve() leaves them at their registry defaults; nothing else moves.
    states = flags.resolve("")
    for flag_id in BF_FLAGS:
        expected = "off by default" if flag_id in SHIPS_DARK else "default"
        assert states[flag_id].why == expected, flag_id


def test_turning_hosted_media_off_for_one_account_gates_its_uploads_only(party):
    """ADR-0456 gate scope: with the grant revoked by a USERS rule, upload planning answers 403
    `flag_off` for that account alone, while reads of stored media stay open and every other
    granted account keeps uploading."""
    carol = party.client.get("/api/account", headers=auth(CAROL)).json()["user"]["id"]
    grant_hosted_media(
        party.engine, party.app, Rule(RuleKind.USERS, {"ids": [carol], "on": False})
    )
    refused = party.client.post(
        "/api/uploads/plan",
        headers=auth(CAROL),
        json={"files": [{"name": "a.wav", "size": 4}]},
    )
    assert refused.status_code == 403
    assert refused.json()["detail"]["code"] == "flag_off"
    # Reads are not gated: stored media keeps listing (BF-0456-02, writes gated, reads open).
    assert party.client.get("/api/assets", headers=auth(CAROL)).status_code == 200
    # Only the targeted account is refused. The party has no object storage configured, so an
    # admitted plan answers 503 storage_not_configured; what matters is the flag let Alice in.
    allowed = party.client.post(
        "/api/uploads/plan",
        headers=auth(ALICE),
        json={"files": [{"name": "a.wav", "size": 4}]},
    )
    assert allowed.status_code != 403, allowed.text
    assert party.client.get("/api/uploads", headers=auth(ALICE)).status_code == 200
    assert party.client.get("/api/uploads", headers=auth(CAROL)).status_code == 403
    # The account payload tells the shell the hosted experience is gone for Carol only.
    assert party.client.get("/api/account", headers=auth(CAROL)).json()["experience"] == {
        "local_first": True,
        "hosted": False,
    }
    alice = party.client.get("/api/account", headers=auth(ALICE)).json()
    assert alice["experience"]["hosted"] is True


def test_hosted_jobs_are_admitted_under_the_hosted_media_grant():
    """BF-0456-03: new hosted processing needs the grant; playback of stored media does not."""
    assert flag_for("analyse.song", Lane.STANDARD) == "cloud.hosted_media"
    assert flag_for("seam.render", Lane.STANDARD) == "cloud.hosted_media"
    assert flag_for("export.render", Lane.STANDARD) == "cloud.hosted_media"
    assert flag_for("play.proxy", Lane.STANDARD) == "core.playback"
    # Spare-time seam renders keep their own flag (SPECULATIVE_FLAGS untouched).
    assert flag_for("seam.render", Lane.SPECULATIVE) == "render.spare_time"


def test_the_account_payload_carries_the_experience_block(party):
    """BF-0455-03: the web shell renders the per-account experience from one answer."""
    body = party.client.get("/api/account", headers=auth(ALICE)).json()
    assert set(body["experience"]) == {"local_first", "hosted"}
    # No rules: browser-first is the default and nobody has been granted hosted media.
    assert body["experience"]["hosted"] is False
    assert body["experience"]["local_first"] is True
    grant_hosted_media(party.engine, party.app)
    granted = party.client.get("/api/account", headers=auth(ALICE)).json()
    assert granted["experience"]["hosted"] is True
    # and the build can still turn browser-first off
    flags.use("-cloud.local_first")
    without = party.client.get("/api/account", headers=auth(ALICE)).json()
    assert without["experience"]["local_first"] is False


def test_an_account_with_no_stored_originals_still_gets_a_complete_export(tmp_path, monkeypatch):
    """BF-0456-07: the export is a complete metadata, settings and recipes archive even when the
    workspace has zero stored originals, and the manifest says which form it took."""
    with signed_up(tmp_path, monkeypatch) as world:
        answer = world.client.get("/api/account/export", headers=HEADERS)
        assert answer.status_code == 200, answer.text
        assert answer.headers["content-type"] == "application/zip"
        with zipfile.ZipFile(io.BytesIO(answer.content)) as archive:
            names = set(archive.namelist())
            assert {"manifest.json", "settings.json", "assets.json", "mixes.json"} <= names
            assert not any(name.startswith("originals/") for name in names)
            manifest = json.loads(archive.read("manifest.json"))
            assert manifest["originals"] == "none stored for this workspace"
            assert manifest["asset_count"] == 0
            assert json.loads(archive.read("assets.json")) == []
            assert json.loads(archive.read("settings.json"))["schema_version"] == 1
