"""`POST /api/hosted/seams` (`cloud.studio_seams`): one hand-off between two catalogue songs of
the caller's cloud library, through the Cloud app, and the seam words of an account mix.

The route runs in the tenant matrix's `world` (`test_cloud_tenant_isolation.py`, which forces
`cloud.studio_seams` on and grants the cloud library); `test_hosted_pairs.py` covers
`hosted_pairs.pair_state` itself.
"""

from __future__ import annotations

import hashlib
import json

import numpy as np
import sqlalchemy as sa
from test_cloud_tenant_isolation import ALICE, BOB, _auth, _rows_of, world  # noqa: F401

from selecta import flags, hosted_caps, hosted_render, ratelimit
from selecta.local_media.schema import local_songs
from selecta.persistence import db_now, new_id, transaction
from selecta.storage.keys import derived_key, original_key
from selecta.storage.schema import assets
from selecta.usage import allowances
from selecta.work.schema import artifacts, jobs

OTHER = b"alice's other song"


def _sha(body: bytes) -> str:
    return hashlib.sha256(body).hexdigest()


def _catalogue(conn, workspace: str, sha256: str, title: str) -> int:
    now = db_now(conn)
    return int(conn.execute(sa.insert(local_songs).values(
        workspace_id=workspace, content_sha256=sha256, title=title, artist="Alice's Band",
        duration_s=180.0, created_at=now, updated_at=now).returning(local_songs.c.id)
    ).scalar_one())


def _artifact(conn, workspace: str, kind: str, digest: str, name: str, settings=None) -> str:
    key = derived_key(workspace, kind, digest, new_id(), name)
    now = db_now(conn)
    conn.execute(artifacts.insert().values(
        id=new_id(), workspace_id=workspace, kind=kind, input_hash=digest, keys=[key],
        checksum="e" * 64, size_bytes=10, provenance={"inputs": {"a": "x"},
                                                      "settings": settings or {}},
        created_at=now, last_used_at=now))
    return key


def _alice_pair(world, *, analysed: bool = True) -> dict:  # noqa: F811
    """Alice's upload and a second one, each a catalogue song (lossless at 44.1 kHz, so each
    plays as it is), analysed, and her analysis files readable."""
    alice = world["alice_ws"]
    first = _sha(b"alice's song")
    other_id = new_id()
    world["objects"].put(original_key(alice, other_id), OTHER)
    with transaction(world["engine"], alice) as conn:
        conn.execute(assets.insert().values(
            id=other_id, workspace_id=alice, original_key=original_key(alice, other_id),
            size=len(OTHER), sha256=_sha(OTHER), format="flac", duration_s=180.0,
            sample_rate=44_100, channels=2, created_at=db_now(conn)))
        a = _catalogue(conn, alice, first, "Private Song")
        b = _catalogue(conn, alice, _sha(OTHER), "Other Song")
        for digest in (first, _sha(OTHER)) if analysed else ():
            _artifact(conn, alice, "analysis", hosted_render.analysis_hash(digest),
                      "analysis.npz")

    def get_object(_bucket, key, destination):
        world["objects"].touched.append(key)
        np.savez(destination, summary=np.array(json.dumps({"lufs": -9.5, "peak_db": -0.3})))
        return destination

    world["objects"].get_object = get_object
    return {"a": a, "b": b, "a_sha": first, "b_sha": _sha(OTHER),
            "assets": (world["ids"]["asset_id"], other_id)}


def test_a_ready_pair_answers_its_clip_levels_and_both_lossless_files(world):  # noqa: F811
    pair = _alice_pair(world)
    digest = hosted_render.seam_hash(pair["a_sha"], pair["b_sha"], None)
    with transaction(world["engine"], world["alice_ws"]) as conn:
        clip = _artifact(conn, world["alice_ws"], "seam", digest, "seam.flac", {
            "cues": {"a_source_start": 150.0, "b_source_end": 20.0, "seconds": 16.0},
            "move": "echo_out", "passed": True, "switch_at": 8.0,
            "levels": {"a_gain_db": -4.5, "b_gain_db": -0.7},
            "b_warp": {"output": [0.0, 16.0], "source": [4.0, 20.0]}})
    answer = world["client"].post("/api/hosted/seams", headers=_auth(ALICE),
                                  json={"a": pair["a"], "b": pair["b"], "lane": "interactive"})
    assert answer.status_code == 200, answer.text
    found = answer.json()
    assert found["state"] == "ready"
    assert found["clip"] == {
        "url": f"https://objects.test/{clip}?signed", "sha256": "e" * 64,
        "a_source_start": 150.0, "b_source_end": 20.0, "seconds": 16.0, "sample_rate": 44_100,
        "switch_at": 8.0, "b_warp": {"output": [0.0, 16.0], "source": [4.0, 20.0]}}
    assert found["levels"] == {"a_gain_db": -4.5, "b_gain_db": -0.7}
    for side, asset_id, sha in (("a", pair["assets"][0], pair["a_sha"]),
                                ("b", pair["assets"][1], pair["b_sha"])):
        key = original_key(world["alice_ws"], asset_id)
        assert found["files"][side] == {"url": f"https://objects.test/{key}?signed",
                                        "sha256": sha, "sample_rate": 44_100, "seconds": 180.0}


def test_a_song_with_no_cloud_copy_is_404_naming_its_side(world):  # noqa: F811
    pair = _alice_pair(world)
    with transaction(world["engine"], world["alice_ws"]) as conn:
        here_only = _catalogue(conn, world["alice_ws"], "c" * 64, "On my laptop only")
    answer = world["client"].post("/api/hosted/seams", headers=_auth(ALICE),
                                  json={"a": pair["a"], "b": here_only})
    assert answer.status_code == 404
    assert answer.json()["detail"] == {"code": "no_cloud_copy", "sides": ["b"]}
    for body, code in (({"a": pair["a"], "b": pair["a"]}, "invalid_songs"),
                       ({"a": "1", "b": 2}, "invalid_songs"),
                       ({"a": pair["a"], "b": pair["b"], "lane": "speculative"}, "invalid_lane"),
                       ({"a": pair["a"], "b": pair["b"], "move": "no way"}, "invalid_move")):
        refused = world["client"].post("/api/hosted/seams", headers=_auth(ALICE), json=body)
        assert (refused.status_code, refused.json()["detail"]["code"]) == (400, code)


def test_a_used_up_allowance_says_so_with_its_own_code(world, monkeypatch):  # noqa: F811
    pair = _alice_pair(world)
    real = allowances.limit_for
    monkeypatch.setattr(allowances, "limit_for", lambda plan, kind: (
        10.0 if kind == hosted_caps.TRANSITIONS else real(plan, kind)))
    answer = world["client"].post("/api/hosted/seams", headers=_auth(ALICE),
                                  json={"a": pair["a"], "b": pair["b"], "move": "echo_out"})
    assert answer.status_code == 200, answer.text
    found = answer.json()
    assert (found["state"], found["code"]) == ("refused", "allowance_used")
    assert found["allowance_used"]["why"] == found["why"] and found["clip"] is None
    with world["engine"].connect() as conn:
        assert conn.execute(sa.select(sa.func.count()).where(
            jobs.c.type == "seam.render")).scalar_one() == 0


def test_another_accounts_songs_answer_exactly_as_made_up_ones(world):  # noqa: F811
    pair = _alice_pair(world)
    mine = world["client"].post("/api/hosted/seams", headers=_auth(ALICE),
                                json={"a": pair["a"], "b": pair["b"]})
    assert mine.status_code == 200 and mine.json()["state"] == "queued"  # the positive control
    before = _rows_of(world["engine"], world["alice_ws"])
    world["objects"].touched.clear()
    theirs = world["client"].post("/api/hosted/seams", headers=_auth(BOB),
                                  json={"a": pair["a"], "b": pair["b"]})
    missing = world["client"].post("/api/hosted/seams", headers=_auth(BOB),
                                   json={"a": 9_001, "b": 9_002})
    assert theirs.status_code == 404
    assert (theirs.status_code, theirs.json()) == (missing.status_code, missing.json())
    assert theirs.json()["detail"]["sides"] == ["a", "b"]
    assert _rows_of(world["engine"], world["alice_ws"]) == before
    assert not set(world["objects"].touched) & world["alice_keys"]
    with world["engine"].connect() as conn:
        assert conn.execute(sa.select(sa.func.count()).where(
            jobs.c.workspace_id == world["bob_ws"])).scalar_one() == 0


def test_with_the_flag_off_the_route_is_refused(world):  # noqa: F811
    pair = _alice_pair(world)
    flags.use("-cloud.studio_seams")
    answer = world["client"].post("/api/hosted/seams", headers=_auth(ALICE),
                                  json={"a": pair["a"], "b": pair["b"]})
    # the build guard's refusal (`flags.guard.refusal`)
    assert answer.status_code == 403
    assert (answer.json()["code"], answer.json()["flag"]) == ("flag_off", "cloud.studio_seams")
    with world["engine"].connect() as conn:
        assert conn.execute(sa.select(sa.func.count()).where(
            jobs.c.type == "seam.render")).scalar_one() == 0


def test_the_route_has_its_own_bucket_as_strict_as_the_render_routes():
    rule = ratelimit._strict("/api/hosted/seams", "POST")
    render = ratelimit._strict("/api/hosted/mixes/render", "POST")
    assert rule.name == "hosted_seams" and (rule.per_minute, rule.burst) == (
        render.per_minute, render.burst)


# --- the words of an account mix's seam -----------------------------------------------------


def test_a_seam_the_cloud_studio_made_says_so_in_an_account_mix(sqlite_engine):
    from selecta.cloud_brain import mixes_routes
    from selecta.engine_store import EngineStore
    from selecta.engine_store import seams as stored
    from selecta.engine_store.mixes import StoreMixes
    from selecta.planner_core.memory import RULES_VERSION

    workspace = new_id()
    store = EngineStore(sqlite_engine, workspace)
    with transaction(sqlite_engine, workspace) as conn:
        a, b = (_catalogue(conn, workspace, digit * 64, f"Song {digit}") for digit in "12")
    for key, studio in (("c" * 20, stored.WORKER), ("d" * 20, stored.DEVICE)):
        stored.keep(store, {"status": "ready", "key": key,
                            "request": {"a": a, "b": b, "move": "auto"}, "style": None,
                            "tried": [], "rules": RULES_VERSION, "a_source_start": 150.0,
                            "b_source_end": 20.0, "duration": 16.0, "passed": True,
                            "implementation": "python-render-1"}, source=studio)
        stored.attest(store, key, studio=studio, studio_id=f"{studio}-1",
                      implementation="python-render-1", clip_sha256="e" * 64,
                      clip_seconds=16.0)
    with store.write() as connection:
        state = mixes_routes._states(StoreMixes(connection, store))
        assert state("c" * 20) == {"status": "none", "key": "c" * 20,
                                   "why": "Prepared in your cloud library."}
        assert state("d" * 20)["why"] == mixes_routes.WORKED_OUT_LIVE  # a device's own clip
        assert state("e" * 20)["why"] == mixes_routes.WORKED_OUT_LIVE
    # another workspace's worker seam is never this one's
    elsewhere = EngineStore(sqlite_engine, new_id())
    with elsewhere.write() as connection:
        other = mixes_routes._states(StoreMixes(connection, elsewhere))
        assert other("c" * 20)["why"] == mixes_routes.WORKED_OUT_LIVE
    assert mixes_routes.cloud_state("k")["why"] == mixes_routes.WORKED_OUT_LIVE
