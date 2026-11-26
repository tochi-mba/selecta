"""Song facts saved in Cloud (`engine_store.facts`, `facts_store`; cloud-planning.md).

A device's facts round trip into the same `SongInfo` the Desktop read builds from the same
numbers; every limit refuses; one rule decides which measurement a song keeps; and a second
workspace can neither read nor write the first's facts. Synthetic numbers only, no audio.
PostgreSQL cases run only where `SELECTA_TEST_POSTGRES_URL` is set (`postgres_engine` skips).
"""

from __future__ import annotations

import base64
import copy
import dataclasses
import json

import numpy as np
import pytest
import sqlalchemy as sa
from brain_helpers import arrays_for, facts_body, scalars, sha_for, song_info

from selecta.cloud_brain.facts_routes import parse_facts
from selecta.engine_store import EngineStore, facts_store
from selecta.engine_store import facts as song_facts
from selecta.engine_store import songs as stored
from selecta.engine_store.schema import analysis
from selecta.local_media.schema import local_songs
from selecta.persistence import new_id, transaction
from selecta.storage.artifacts import LocalArtifactStore


def _catalogue_song(engine, workspace: str, seed: int, duration: float = 200.0) -> int:
    with transaction(engine, workspace) as conn:
        return int(
            conn.execute(
                sa.insert(local_songs)
                .values(
                    workspace_id=workspace,
                    content_sha256=sha_for(seed),
                    title=f"Song {seed}",
                    artist=f"Artist {seed}",
                    duration_s=duration,
                    created_at=1.0,
                    updated_at=1.0,
                )
                .returning(local_songs.c.id)
            ).scalar_one()
        )


def _facts(seed: int, **changes):
    facts, sha, audio = parse_facts(_raw(facts_body(seed, sha=sha_for(seed), **changes)))
    return facts, sha, audio


def _raw(body: dict) -> bytes:
    return json.dumps(body).encode()


def _save(world, facts, sha):
    return facts_store.save(
        world["store"], world["artifacts"], world["song_id"], facts, content_sha256=sha
    )


@pytest.fixture
def world(sqlite_engine, tmp_path):
    workspace = new_id()
    song_id = _catalogue_song(sqlite_engine, workspace, 1)
    return {
        "engine": sqlite_engine,
        "workspace": workspace,
        "song_id": song_id,
        "store": EngineStore(sqlite_engine, workspace),
        "artifacts": LocalArtifactStore(tmp_path / "artifacts"),
    }


def _same_song(loaded, direct) -> None:
    for field in dataclasses.fields(direct):
        if not field.compare:
            continue
        mine, theirs = getattr(loaded, field.name), getattr(direct, field.name)
        if isinstance(theirs, np.ndarray):
            assert np.array_equal(mine, theirs), field.name
            assert mine.dtype == theirs.dtype, field.name
        else:
            assert mine == theirs, field.name


def test_saved_facts_load_as_the_song_the_desktop_builds_from_the_same_numbers(world):
    facts, sha, _ = _facts(1)
    saved = facts_store.save(world["store"], world["artifacts"], world["song_id"], facts,
                             content_sha256=sha)
    assert (saved["source"], saved["implementation"], saved["replaced"]) == (
        "device", "web-dsp-1", False,
    )
    loaded = stored.load_song(world["store"], world["artifacts"], world["song_id"])
    direct = song_info(world["song_id"], 1, title="Song 1", artist="Artist 1")
    _same_song(loaded, direct)
    found, missing = stored.load_songs(world["store"], world["artifacts"], [world["song_id"], 999])
    assert missing == [999]
    _same_song(found[0], direct)


def test_the_measured_list_names_each_song_once_with_who_measured_it(world):
    facts, sha, _ = _facts(1)
    facts_store.save(world["store"], world["artifacts"], world["song_id"], facts,
                     content_sha256=sha)
    page = facts_store.measured(world["store"])
    assert [(s["song_id"], s["implementation"], s["source"]) for s in page["songs"]] == [
        (world["song_id"], "web-dsp-1", "device")
    ]
    assert "next" not in page


def _refusal(body: dict) -> tuple[int, str]:
    from fastapi import HTTPException

    try:
        parse_facts(_raw(body))
    except HTTPException as error:
        return error.status_code, error.detail["code"]
    raise AssertionError("the facts were accepted")


def _check_refusal(world, facts) -> str:
    with pytest.raises(song_facts.FactsRefused) as refused:
        facts_store.save(world["store"], world["artifacts"], world["song_id"], facts,
                         content_sha256=sha_for(1))
    return refused.value.code


@pytest.mark.parametrize(
    ("field", "value", "code"),
    [
        ("bpm", float("nan"), "not_finite"),
        ("bpm", float("inf"), "not_finite"),
        ("bpm", 500.0, "out_of_range"),
        ("grid_confidence", 1.5, "out_of_range"),
        ("key_confidence", -0.1, "out_of_range"),
        ("lufs", -200.0, "out_of_range"),
        ("energy", 2.0, "out_of_range"),
        ("beats_per_bar", 40, "out_of_range"),
        ("key", "H minor", "bad_key"),
        ("camelot", "3B", "bad_key"),  # seed 1 is E minor, 9A
    ],
)
def test_every_scalar_out_of_range_is_refused_never_clamped(world, field, value, code):
    facts, _, _ = _facts(1)
    assert _check_refusal(world, dataclasses.replace(facts, **{field: value})) == code
    with transaction(world["engine"], world["workspace"]) as conn:
        assert conn.execute(sa.select(sa.func.count()).select_from(analysis)).scalar_one() == 0


def test_arrays_that_break_their_shape_or_range_are_refused(world):
    facts, _, _ = _facts(1)
    arrays = facts.arrays
    broken = {
        "beats": np.full_like(arrays["beats"], np.nan),
        "energy_bars": arrays["energy_bars"] * 5,
        "chroma_bars": arrays["chroma_bars"][:, :6],
        "low_share_bars": arrays["low_share_bars"][:-1],
        "bar_starts": arrays["bar_starts"][::-1].copy(),
    }
    for name, values in broken.items():
        changed = dataclasses.replace(facts, arrays={**arrays, name: values})
        assert _check_refusal(world, changed) in {
            "not_finite", "out_of_range", "bad_array", "bad_length", "bad_order",
        }, name


def test_arrays_longer_than_the_song_allows_are_refused(world):
    facts, _, _ = _facts(1, duration=200.0)
    with transaction(world["engine"], world["workspace"]) as conn:
        conn.execute(sa.update(local_songs).values(duration_s=20.0))
    assert _check_refusal(world, facts) in {"bad_length", "out_of_range"}


def test_wire_refusals_unknown_array_path_like_field_and_bad_data():
    body = facts_body(1, sha=sha_for(1))
    extra = copy.deepcopy(body)
    extra["arrays"]["peaks"] = extra["arrays"]["energy_bars"]
    assert _refusal(extra)[1] in {"unknown_array", "invalid_facts"}
    pathy = copy.deepcopy(body)
    pathy["file_path"] = "C:/Music/song.flac"
    assert _refusal(pathy) == (422, "paths_never_reach_cloud")
    nested = copy.deepcopy(body)
    nested["sections"][0]["folder"] = "Music"
    assert _refusal(nested) == (422, "paths_never_reach_cloud")
    short = copy.deepcopy(body)
    short["arrays"]["beats"]["data"] = base64.b64encode(b"\x00" * 8).decode()
    assert _refusal(short) == (422, "bad_array")
    unknown = copy.deepcopy(body)
    unknown["implementation"] = "python-beatthis-3"  # a device can't claim the worker's analysis
    assert _refusal(unknown) == (422, "unknown_implementation")
    nothing = copy.deepcopy(body)
    del nothing["content_sha256"]
    assert _refusal(nothing) == (422, "invalid_facts")


def test_facts_for_another_file_are_refused(world):
    facts, _, _ = _facts(1)
    with pytest.raises(song_facts.FactsRefused) as refused:
        facts_store.save(world["store"], world["artifacts"], world["song_id"], facts,
                         content_sha256=sha_for(2))
    assert refused.value.code == "song_mismatch"


def test_a_workspace_holds_facts_for_a_bounded_number_of_songs(world, monkeypatch):
    monkeypatch.setattr(facts_store, "MAX_FACTS_PER_WORKSPACE", 1)
    facts, sha, _ = _facts(1)
    _save(world, facts, sha)
    other = _catalogue_song(world["engine"], world["workspace"], 2)
    second, sha2, _ = _facts(2)
    with pytest.raises(song_facts.FactsRefused) as refused:
        facts_store.save(world["store"], world["artifacts"], other, second, content_sha256=sha2)
    assert refused.value.code == "too_many"


def _prov(implementation: str, source: str, at: str) -> song_facts.Provenance:
    return song_facts.Provenance(implementation, source, at)


def test_the_provenance_rule():
    python = song_facts.python_implementation()
    early, late = "2026-11-26 10:00:00", "2026-11-26 11:00:00"
    # a worker beats a device, whatever the ranks and times
    assert song_facts.wins(_prov(python, "worker", early), _prov("web-dsp-1", "device", late))
    assert not song_facts.wins(_prov("web-dsp-1", "device", late), _prov(python, "worker", early))
    # same source: the higher-ranked implementation wins
    assert song_facts.wins(_prov(python, "device", early), _prov("web-dsp-1", "device", late))
    assert not song_facts.wins(_prov("web-dsp-1", "device", late), _prov(python, "device", early))
    unlisted = _prov("web-dsp-0", "device", late)
    assert not song_facts.wins(unlisted, _prov("web-dsp-1", "device", early))
    # equal rank: the newer wins
    assert song_facts.wins(_prov("web-dsp-1", "device", late), _prov("web-dsp-1", "device", early))
    assert not song_facts.wins(
        _prov("web-dsp-1", "device", early), _prov("web-dsp-1", "device", late)
    )
    # a Desktop row with null columns is SelectaDJ's own Python analysis at its version
    assert song_facts.implementation_of({"version": 3, "analysed_at": early}) == _prov(
        "python-beatthis-3", "worker", early
    )


def test_a_device_cannot_replace_a_workers_measurement(world, tmp_path):
    facts, sha, _ = _facts(1)
    worker = dataclasses.replace(
        facts, implementation=song_facts.python_implementation(), source="worker"
    )
    facts_store.save(world["store"], world["artifacts"], world["song_id"], worker,
                     content_sha256=sha)
    with pytest.raises(song_facts.FactsRefused) as refused:
        facts_store.save(world["store"], world["artifacts"], world["song_id"], facts,
                         content_sha256=sha)
    assert refused.value.code == "outranked"
    again = facts_store.save(world["store"], world["artifacts"], world["song_id"], worker,
                             content_sha256=sha)
    assert again["replaced"] is True


def test_a_second_workspace_cannot_read_or_write_the_firsts_facts(world):
    facts, sha, _ = _facts(1)
    _save(world, facts, sha)
    other = EngineStore(world["engine"], new_id())
    with pytest.raises(LookupError):
        facts_store.save(other, world["artifacts"], world["song_id"], facts, content_sha256=sha)
    with pytest.raises(KeyError):
        stored.load_song(other, world["artifacts"], world["song_id"])
    assert stored.load_songs(other, world["artifacts"], [world["song_id"]]) == (
        [], [world["song_id"]]
    )
    assert facts_store.measured(other) == {"songs": []}
    with pytest.raises(LookupError):
        facts_store.set_correction(other, world["song_id"], 124.0, None)


def test_a_correction_wins_over_the_measurement_and_clears(world):
    facts, sha, _ = _facts(1)
    _save(world, facts, sha)
    facts_store.set_correction(world["store"], world["song_id"], None, "10A")
    assert stored.load_song(world["store"], world["artifacts"], world["song_id"]).camelot == "10A"
    # the measured list carries both, so a browser Library shows what is in use
    (row,) = facts_store.measured(world["store"])["songs"]
    assert (row["camelot"], row["override_camelot"], row["override_bpm"]) == ("9A", "10A", None)
    assert row["bpm"] == pytest.approx(facts.bpm)
    other = EngineStore(world["engine"], new_id())
    assert facts_store.measured(other) == {"songs": []}
    facts_store.set_correction(world["store"], world["song_id"], None, None)
    assert stored.load_song(world["store"], world["artifacts"], world["song_id"]).camelot == "9A"
    assert facts_store.measured(world["store"])["songs"][0]["override_camelot"] is None
    with pytest.raises(song_facts.FactsRefused):
        facts_store.set_correction(world["store"], world["song_id"], 900.0, None)


def test_postgres_keeps_one_workspaces_facts_from_another(postgres_engine, tmp_path):
    a, b = new_id(), new_id()
    song = _catalogue_song(postgres_engine, a, 1)
    artifacts = LocalArtifactStore(tmp_path / "artifacts")
    facts, sha, _ = _facts(1)
    facts_store.save(EngineStore(postgres_engine, a), artifacts, song, facts, content_sha256=sha)
    with transaction(postgres_engine, b) as conn:
        # no WHERE: the fail-closed policy alone keeps a's row out
        assert conn.execute(sa.select(sa.func.count()).select_from(analysis)).scalar_one() == 0
    with transaction(postgres_engine) as conn:
        assert conn.execute(sa.select(sa.func.count()).select_from(analysis)).scalar_one() == 0
    with transaction(postgres_engine, a) as conn:
        row = conn.execute(sa.select(analysis.c.implementation, analysis.c.source)).one()
    assert tuple(row) == ("web-dsp-1", "device")


BAR_ARRAYS = ("chroma_bars", "mfcc_bars", "energy_bars", "rms_db_bars", "low_share_bars")


def _hosted_analysis(path, seed: int) -> None:
    """An analysis file as the hosted worker writes it (`engine_handlers.analyse`)."""
    arrays, sections = arrays_for(seed, 120.0, 200.0)
    summary = {**scalars(seed, 120.0), "sections": sections, "duration": 200.0}
    summary["constant_tempo"] = int(summary.pop("constant_tempo"))
    summary.pop("key_agrees_chroma")
    np.savez_compressed(
        path,
        beats=arrays["beats"],
        bar_starts=arrays["bar_starts"],
        raw_beats=arrays["beats"].astype(np.float32),
        raw_downbeats=arrays["beats"][::4].astype(np.float32),
        peaks=np.zeros(64, dtype=np.uint8),
        summary=np.array(json.dumps(summary)),
        **{name: arrays[name].astype(np.float16) for name in BAR_ARRAYS},
    )


def test_a_workers_hosted_analysis_becomes_the_same_songs_facts(world, tmp_path):
    path = tmp_path / "analysis.npz"
    _hosted_analysis(path, 1)
    found = facts_store.record_worker_analysis(
        world["store"], world["artifacts"], sha_for(1), path
    )
    assert found == world["song_id"]
    page = facts_store.measured(world["store"])["songs"]
    assert [(s["implementation"], s["source"]) for s in page] == [
        (song_facts.python_implementation(), "worker")
    ]
    loaded = stored.load_song(world["store"], world["artifacts"], world["song_id"])
    assert loaded.bpm == 120.0 and loaded.camelot == "9A"
    # no catalogue song has these bytes: nothing is written
    missing = facts_store.record_worker_analysis(
        world["store"], world["artifacts"], sha_for(9), path
    )
    assert missing is None
