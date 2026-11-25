"""Song facts fail closed on PostgreSQL (ADR-0479, migration `es0479song01`).

A Cloud song is the catalogue's `local_songs` row, keyed by (workspace, content hash); its facts
are `analysis` and `song_overrides`, its arrays the features artifact under `features_key`. A
transaction that names no workspace reads no facts, one workspace never reads another's, and the
same file in two workspaces stays two separate songs. Runs only where `SELECTA_TEST_POSTGRES_URL`
is set (the Linux CI job); `postgres_engine` skips otherwise.
"""

from __future__ import annotations

import json

import numpy as np
import pytest
import sqlalchemy as sa

from selecta.config import ANALYSIS_VERSION
from selecta.engine_store import EngineStore, NoWorkspace
from selecta.engine_store import songs as stored
from selecta.engine_store.schema import analysis, song_overrides
from selecta.local_media.schema import local_songs
from selecta.persistence import new_id, transaction
from selecta.storage.artifacts import LocalArtifactStore

SHA = "ab" * 32
SECTIONS = json.dumps(
    [
        {
            "start_bar": 0,
            "end_bar": 16,
            "label": "verse",
            "energy": 0.5,
            "group": 0,
            "chorus_prob": 0.2,
        }
    ]
)


def _song(engine, workspace: str, bpm: float) -> int:
    with transaction(engine, workspace) as conn:
        song_id = conn.execute(
            sa.insert(local_songs)
            .values(
                workspace_id=workspace,
                content_sha256=SHA,
                title="Song",
                artist="Artist",
                duration_s=32.0,
                created_at=1.0,
                updated_at=1.0,
            )
            .returning(local_songs.c.id)
        ).scalar_one()
        conn.execute(
            sa.insert(analysis).values(
                song_id=song_id,
                workspace_id=workspace,
                version=ANALYSIS_VERSION,
                bpm=bpm,
                constant_tempo=1,
                grid_confidence=0.9,
                beats_per_bar=4,
                camelot="8A",
                key_confidence=0.8,
                lufs=-9.0,
                peak_db=-1.0,
                energy=0.5,
                sections=SECTIONS,
            )
        )
        conn.execute(
            sa.insert(song_overrides).values(song_id=song_id, workspace_id=workspace, camelot="9A")
        )
    return song_id


def _features(artifacts, tmp_path, workspace: str, seed: float) -> None:
    bars = 16
    path = tmp_path / f"{workspace}.npz"
    np.savez_compressed(
        path,
        beats=np.arange(64) * 0.5,
        bar_starts=np.arange(0, 64, 4, dtype=np.int32),
        energy_bars=np.full(bars, seed, dtype=np.float16),
        low_share_bars=np.zeros(bars, dtype=np.float16),
        chroma_bars=np.zeros((bars, 12), dtype=np.float16),
        rms_db_bars=np.zeros(bars, dtype=np.float16),
        mfcc_bars=np.zeros((bars, 13), dtype=np.float16),
    )
    artifacts.publish(stored.features_key(workspace, SHA, ANALYSIS_VERSION), path)


@pytest.fixture
def two_workspaces(postgres_engine, tmp_path):
    a, b = new_id(), new_id()
    artifacts = LocalArtifactStore(tmp_path / "artifacts")
    songs = {a: _song(postgres_engine, a, 120.0), b: _song(postgres_engine, b, 128.0)}
    _features(artifacts, tmp_path, a, 0.25)
    _features(artifacts, tmp_path, b, 0.75)
    return postgres_engine, artifacts, a, b, songs


def test_a_transaction_that_names_no_workspace_reads_no_song_facts(two_workspaces):
    engine, _artifacts, _a, _b, _songs = two_workspaces
    with transaction(engine) as conn:
        assert conn.execute(sa.text("SELECT count(*) FROM analysis")).scalar_one() == 0
        assert conn.execute(sa.text("SELECT count(*) FROM song_overrides")).scalar_one() == 0
    with pytest.raises(NoWorkspace):
        EngineStore(engine, None)


def test_one_workspace_cannot_read_another_workspaces_song_facts(two_workspaces):
    engine, artifacts, a, b, songs = two_workspaces
    with transaction(engine, a) as conn:
        # no WHERE: the policy alone keeps b's facts out
        assert sorted(conn.execute(sa.select(analysis.c.bpm)).scalars()) == [120.0]
    with pytest.raises(KeyError):
        stored.load_song(EngineStore(engine, a), artifacts, songs[b])
    with transaction(engine, a) as conn:
        changed = conn.execute(
            sa.update(analysis).where(analysis.c.song_id == songs[b]).values(bpm=1.0)
        ).rowcount
    assert changed == 0
    with pytest.raises(sa.exc.DBAPIError) as refused, transaction(engine, a) as conn:
        conn.execute(sa.insert(analysis).values(song_id=songs[b], workspace_id=b, version=1))
    # row-level security, checked before the key: insufficient privilege
    assert refused.value.orig.sqlstate == "42501"
    assert stored.load_song(EngineStore(engine, b), artifacts, songs[b]).bpm == 128.0


def test_the_same_content_hash_in_two_workspaces_stays_two_songs(two_workspaces):
    engine, artifacts, a, b, songs = two_workspaces
    assert songs[a] != songs[b]
    assert stored.features_key(a, SHA, ANALYSIS_VERSION) != stored.features_key(
        b, SHA, ANALYSIS_VERSION
    )
    mine = stored.load_song(EngineStore(engine, a), artifacts, songs[a])
    theirs = stored.load_song(EngineStore(engine, b), artifacts, songs[b])
    assert (mine.bpm, theirs.bpm) == (120.0, 128.0)
    assert mine.camelot == theirs.camelot == "9A"
    assert mine.path == "" and mine.genre is None
    assert float(mine.energy_bars[0]) == 0.25 and float(theirs.energy_bars[0]) == 0.75
