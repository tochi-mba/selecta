"""Uploaded-music mixes on the one brain (ADR-0479, Phase 6): facts, order, seams and jobs.

- An upload's finished hosted analysis becomes its catalogue song's facts (`hosted_facts.keep`),
  once, lazily, with the drum pattern pair when the file has it; nothing is analysed again.
- `cloud.hosted_brain` orders the uploads with the planner core from those facts, and marks each
  seam job for the core's loop; off, every job and hash is exactly the older one.
- The core loop on the worker (`workers.engine_core.core_seam`) is the Desktop's
  `choose_transition`: the best ranked non-stem candidate, never more than 6 renders.
- A rendered hosted seam is kept in the seam tables with a worker attestation.

Synthetic numbers only: no audio is decoded or rendered here.
"""

from __future__ import annotations

import hashlib
import json
import shutil
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest
import sqlalchemy as sa
from brain_helpers import arrays_for, scalars, sha_for, song_info

from selecta import flags, hosted_brain, hosted_facts, hosted_render
from selecta.config import ANALYSIS_VERSION
from selecta.engine_store import EngineStore, facts_store
from selecta.engine_store import seams as stored
from selecta.engine_store import songs as stored_songs
from selecta.engine_store.schema import analysis
from selecta.local_media.schema import local_songs
from selecta.persistence import new_id, transaction
from selecta.scheduling.policy import Lane
from selecta.seam_kinds import RENDER_VERSION
from selecta.storage.artifacts import LocalArtifactStore
from selecta.workers import engine_core

BAR_ARRAYS = ("chroma_bars", "mfcc_bars", "energy_bars", "rms_db_bars", "low_share_bars")


def _catalogue_song(engine, workspace: str, seed: int, duration: float = 200.0) -> int:
    with transaction(engine, workspace) as conn:
        return int(conn.execute(sa.insert(local_songs).values(
            workspace_id=workspace, content_sha256=sha_for(seed), title=f"Song {seed}",
            artist=f"Artist {seed}", duration_s=duration, created_at=1.0, updated_at=1.0,
        ).returning(local_songs.c.id)).scalar_one())


def _analysis_file(path: Path, seed: int, *, rhythm: bool = False, bpm: float = 120.0) -> Path:
    """An analysis file as the hosted worker writes it (`engine_handlers.analyse`)."""
    arrays, sections = arrays_for(seed, bpm, 200.0)
    summary = {**scalars(seed, bpm), "sections": sections, "duration": 200.0}
    summary["constant_tempo"] = int(summary.pop("constant_tempo"))
    summary.pop("key_agrees_chroma")
    bars = arrays["bar_starts"].size
    extra = ({"pattern_bars": np.full((bars, 32), 0.5, np.float16),
              "swing_bars": np.full(bars, 0.55, np.float16)} if rhythm else {})
    np.savez_compressed(
        path, beats=arrays["beats"], bar_starts=arrays["bar_starts"],
        raw_beats=arrays["beats"].astype(np.float32),
        raw_downbeats=arrays["beats"][::4].astype(np.float32),
        peaks=np.zeros(64, dtype=np.uint8), summary=np.array(json.dumps(summary)),
        **{name: arrays[name].astype(np.float16) for name in BAR_ARRAYS}, **extra,
    )
    return path


@pytest.fixture
def world(sqlite_engine, tmp_path):
    workspace = new_id()
    files, reads = {}, []

    def read_object(key: str, destination: Path) -> Path:
        reads.append(key)
        shutil.copyfile(files[key], destination)
        return destination

    return SimpleNamespace(engine=sqlite_engine, workspace=workspace, files=files, reads=reads,
                           read_object=read_object, tmp=tmp_path,
                           store=EngineStore(sqlite_engine, workspace),
                           artifacts=LocalArtifactStore(tmp_path / "artifacts"))


def _upload(world, seed: int, *, rhythm: bool = False, bpm: float = 120.0) -> tuple:
    key = f"analysis-{seed}"
    world.files[key] = _analysis_file(world.tmp / f"{key}.npz", seed, rhythm=rhythm, bpm=bpm)
    return sha_for(seed), key, None


# --- step 1: facts ------------------------------------------------------------------------


def test_a_finished_upload_analysis_becomes_its_songs_facts_once(world):
    song_id = _catalogue_song(world.engine, world.workspace, 1)
    ready = [_upload(world, 1, rhythm=True)]
    kept = hosted_facts.keep(world.engine, world.workspace, ready, world.read_object,
                             world.artifacts)
    assert kept == 1
    page = facts_store.measured(world.store)["songs"]
    assert [(s["song_id"], s["source"]) for s in page] == [(song_id, "worker")]
    loaded = stored_songs.load_song(world.store, world.artifacts, song_id)
    assert loaded.bpm == 120.0 and loaded.camelot == "9A"
    features = stored_songs.load_features(world.store, world.artifacts, song_id)
    assert features["pattern_bars"].shape[1] == 32 and "swing_bars" in features
    # idempotent and lazy: a song with facts is never read again
    world.reads.clear()
    assert hosted_facts.keep(world.engine, world.workspace, ready, world.read_object,
                             world.artifacts) == 0
    assert world.reads == []


def test_verified_uploads_reuse_current_planner_facts(world):
    from selecta.storage.keys import derived_key, original_key
    from selecta.storage.schema import assets

    other = new_id()
    seed = 42
    sha = sha_for(seed)
    source_path = _analysis_file(world.tmp / "shared.npz", seed)
    for workspace in (world.workspace, other):
        _catalogue_song(world.engine, workspace, seed)
        asset_id = new_id()
        with transaction(world.engine, workspace) as connection:
            connection.execute(sa.insert(assets).values(
                id=asset_id, workspace_id=workspace, original_key=original_key(workspace, asset_id),
                size=100, sha256=sha, format="mp3", created_at=1.0,
            ))

        key = derived_key(workspace, "analysis", hosted_render.analysis_hash(sha),
                          new_id(), "analysis.npz")
        world.files[key] = source_path
        with flags.bound({hosted_facts.FLAG: True, "cloud.hosted_dedupe": True}):
            assert hosted_facts.keep(world.engine, workspace, [(sha, key, None)],
                                     world.read_object, world.artifacts) == 1
    assert len(world.reads) == 1


def test_the_backfill_is_bounded_and_carries_on_where_it_stopped(world):
    for seed in (1, 2, 3):
        _catalogue_song(world.engine, world.workspace, seed)
    ready = [_upload(world, seed) for seed in (1, 2, 3)]
    assert hosted_facts.keep(world.engine, world.workspace, ready, world.read_object,
                             world.artifacts, most=2) == 2
    assert hosted_facts.keep(world.engine, world.workspace, ready, world.read_object,
                             world.artifacts, most=2) == 1
    assert len(facts_store.measured(world.store)["songs"]) == 3
    assert len(world.reads) == 3  # each analysis file read once, never analysed again


def test_no_catalogue_song_or_flag_off_reads_and_writes_nothing(world):
    ready = [_upload(world, 4)]
    assert hosted_facts.keep(world.engine, world.workspace, ready, world.read_object,
                             world.artifacts) == 0
    assert world.reads == []
    _catalogue_song(world.engine, world.workspace, 4)
    with flags.bound({"cloud.brain": False}):
        assert hosted_facts.keep(world.engine, world.workspace, ready, world.read_object,
                                 world.artifacts) == 0
    assert world.reads == []


def test_another_workspace_never_gets_the_facts(world, sqlite_engine):
    other = new_id()
    _catalogue_song(sqlite_engine, other, 5)
    hosted_facts.keep(world.engine, world.workspace, [_upload(world, 5)], world.read_object,
                      world.artifacts)
    with transaction(sqlite_engine, other) as conn:
        assert conn.execute(sa.select(sa.func.count()).select_from(analysis).where(
            analysis.c.workspace_id == other)).scalar_one() == 0


# --- step 2: order and jobs --------------------------------------------------------------------


def _hosted_song(seed: int) -> dict:
    return {"id": f"asset-{seed}", "sha256": sha_for(seed), "display_name": f"A{seed} - S{seed}"}


def test_the_planner_core_orders_uploads_from_their_stored_facts(world):
    seeds = list(range(1, 9))
    for seed in seeds:
        _catalogue_song(world.engine, world.workspace, seed)
    hosted_facts.keep(world.engine, world.workspace, [_upload(world, s) for s in seeds],
                      world.read_object, world.artifacts)
    planned = hosted_brain.plan_order(world.engine, world.workspace,
                                      [_hosted_song(s) for s in seeds], 6, world.artifacts)
    assert planned is not None and 2 <= len(planned) <= 6
    assert {item["asset_id"] for item in planned} <= {f"asset-{s}" for s in seeds}
    assert all(item["move"] is None for item in planned)
    # too few measured songs for an idea: the caller keeps the older order
    assert hosted_brain.plan_order(world.engine, world.workspace,
                                   [_hosted_song(1), _hosted_song(2)], 6, world.artifacts) is None


WORKSPACE = "01a205d4-722d-771c-954e-7b4c1e314a78"
A = {"id": "01a21347-0000-7000-8000-00000000000a", "sha256": "a" * 64, "display_name": "X - One",
     "analysis_key": f"w/{WORKSPACE}/analysis/{'c' * 64}/attempts/x/analysis.npz"}
B = {"id": "01a21347-0000-7000-8000-00000000000b", "sha256": "b" * 64, "display_name": "Y - Two",
     "analysis_key": f"w/{WORKSPACE}/analysis/{'d' * 64}/attempts/x/analysis.npz"}


def _worker_hash(payload: dict) -> str:
    return hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()


def test_with_the_flag_off_a_seam_job_is_byte_for_byte_the_older_one():
    older = {"a": "a" * 64, "b": "b" * 64, "style": "echo_out", "analysis": ANALYSIS_VERSION,
             "render": RENDER_VERSION}
    assert hosted_render.seam_hash("a" * 64, "b" * 64, "echo_out") == _worker_hash(older)
    spec = hosted_render._seam_spec(WORKSPACE, A, B, "echo_out", Lane.STANDARD, None)
    assert "brain" not in spec.input_ref
    assert "facts" not in spec.input_ref["a"] and "facts" not in spec.input_ref["b"]
    assert spec.idempotency_key == f"hosted-seam:{_worker_hash(older)}"
    assert hosted_render._core_part(None, A, B) == (None, None)
    with flags.bound({"cloud.hosted_brain": False}):
        assert not hosted_brain.on()


def test_with_the_flag_on_a_seam_job_is_marked_and_hashed_as_the_worker_hashes_it():
    facts = {"a" * 64: {"correction": {"bpm": 121.0, "camelot": "8A"}, "lyric": None},
             "b" * 64: {"correction": None, "lyric": None}}
    core, pair = hosted_render._core_part(facts, A, B)
    spec = hosted_render._seam_spec(WORKSPACE, A, B, None, Lane.STANDARD, None, pair)
    ref = spec.input_ref
    assert ref["brain"] == engine_core.MARK
    worker = _worker_hash({"a": "a" * 64, "b": "b" * 64, "style": None,
                           "analysis": ANALYSIS_VERSION, "render": RENDER_VERSION,
                           **engine_core.hash_part(ref["a"], ref["b"])})
    assert ref["output"]["input_hash"] == worker == hosted_render.seam_hash(
        "a" * 64, "b" * 64, None, core)
    # a new correction is a new seam
    facts["a" * 64]["correction"]["bpm"] = 122.0
    assert hosted_render._core_part(facts, A, B)[0] != core


def test_the_worker_builds_a_core_song_as_the_engine_store_does(world):
    path = _analysis_file(world.tmp / "one.npz", 1)
    side = {"title": "Song 1", "artist": "Artist 1",
            "facts": {"correction": {"bpm": None, "camelot": "10A"}, "lyric": None}}
    built = engine_core.song_from_facts(path, Path("one.flac"), 1, side)
    direct = song_info(1, 1, title="Song 1", artist="Artist 1")
    assert built.bpm == direct.bpm and built.camelot == "10A"
    assert built.bar_starts.tolist() == direct.bar_starts.tolist()
    assert built.vocals_known is False and built.path == "one.flac"


# --- the core loop on the worker -----------------------------------------------------------------


@pytest.fixture
def fake_studio(monkeypatch):
    """Render and audit replaced by stand-ins: `verdicts` says whether each take passes."""
    import selecta.planner.choose as choose

    taken: list = []
    verdicts: list[bool] = []

    def render(script, _cache):
        taken.append(script)
        return SimpleNamespace(script=script, seconds=10.0, audio=None)

    def audit(_rendered):
        passed = verdicts.pop(0) if verdicts else False
        failures = [] if passed else [SimpleNamespace(name="beat_alignment", value=2.0,
                                                      limit=1.0, passed=False)]
        return SimpleNamespace(passed=passed, failures=failures, checks=failures)

    monkeypatch.setattr(choose, "render", render)
    monkeypatch.setattr(choose, "audit", audit)
    return SimpleNamespace(taken=taken, verdicts=verdicts)


def _pair():
    return (song_info(1, 1, title="One", artist="A"), song_info(2, 2, title="Two", artist="B"))


def _ranked(a, b):
    from selecta.planner.choose import enumerate_candidates

    with flags.bound({"analysis.vocal_sense": False}):
        return enumerate_candidates(a, b)


def test_a_hosted_pair_with_unknown_vocals_gets_the_cores_best_safe_candidate(fake_studio):
    """No lyrics and no ears: the core's own rule for unknown vocals leaves no move that needs
    vocal information and no blend over 4 bars (and the families' blend lengths start at 8)."""
    a, b = _pair()
    ranked = _ranked(a, b)
    names = {candidate.recipe.name for candidate in ranked}
    assert "delay_throw" not in names
    assert all(c.bars <= 4 for c in ranked if c.recipe.beatmatched)
    fake_studio.verdicts.append(True)
    take = engine_core.core_seam(a, b)
    assert take.move == ranked[0].recipe.name and not take.fell_back
    assert len(fake_studio.taken) == 1


def test_lyrics_from_the_store_open_the_long_blends_and_the_core_takes_its_best(fake_studio):
    """Vocals known (a device found lyrics, `hosted_brain.side_facts`): blends are weighed, and
    the take is the best ranked candidate, a blend here, not an echo."""
    import dataclasses

    a, b = (dataclasses.replace(song, vocals_known=True, instrumental=True) for song in _pair())
    ranked = _ranked(a, b)
    assert {c.recipe.name for c in ranked} & {"bass_swap_blend", "filter_sweep"}
    fake_studio.verdicts.append(True)
    take = engine_core.core_seam(a, b)
    assert take.move == ranked[0].recipe.name
    assert ranked[0].recipe.beatmatched and take.move != "echo_out"


def test_a_core_seam_renders_at_most_six_times_however_often_takes_fail(fake_studio):
    a, b = _pair()
    take = engine_core.core_seam(a, b)
    assert take.fell_back and take.move == "cut_on_one"
    assert len(fake_studio.taken) <= engine_core.renders_at_most() == 6


# --- step 3: seams kept ------------------------------------------------------------------------


def test_a_rendered_hosted_seam_is_kept_with_a_worker_attestation(world):
    for seed in (1, 2):
        _catalogue_song(world.engine, world.workspace, seed)
    row = {"attempt_id": None, "checksum": "e" * 64,
           "provenance": {"settings": {"move": "echo_out", "passed": True, "cues": {
               "a_source_start": 150.0, "b_source_end": 12.0, "seconds": 12.0}}}}
    item = {"a_sha256": sha_for(1), "b_sha256": sha_for(2), "digest": "f" * 64, "row": row}
    assert hosted_brain.keep_seams(world.engine, world.workspace, [item]) == 1
    from selecta.engine_store.hosted_seams import worker_seam_key

    key = worker_seam_key("f" * 64)
    record = stored.record_of(world.store, key)
    assert record["style"] == "echo_out" and record["passed"] is True
    assert stored.attested(world.store, key, "cloud-worker")["clip_sha256"] == "e" * 64
    # once: the next poll writes nothing
    assert hosted_brain.keep_seams(world.engine, world.workspace, [item]) == 0
    assert stored.record_of(EngineStore(world.engine, new_id()), key) is None

def test_cached_attempts_keep_the_same_selection_and_repair_order(fake_studio):
    a, b = _pair()
    fake_studio.verdicts.extend((False, True))
    cold = engine_core.core_seam(a, b)
    expected = fake_studio.taken[:]

    replayed = []

    def cache_hit(script, _songs):
        replayed.append(script)
        return SimpleNamespace(script=script, seconds=10.0, audio=None)

    fake_studio.taken.clear()
    fake_studio.verdicts.extend((False, True))
    warm = engine_core.core_seam(a, b, render_attempt=cache_hit)

    from selecta.render.script_json import to_json

    assert [to_json(script) for script in replayed] == [to_json(script) for script in expected]
    assert (warm.move, warm.fell_back, warm.tried) == (cold.move, cold.fell_back, cold.tried)
    assert not fake_studio.taken
