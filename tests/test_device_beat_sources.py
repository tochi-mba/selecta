"""The browser's beat sources in the account, and the exported beat model's record.

docs/engineering/device-beats.md: a device names its beat source in the implementation it
sends, the account accepts both browser sources beside the plain id older clients send, and ranks
the browser's Beat This above the interim beats and below SelectaDJ's own Python analysis. The
exported model's committed record (`web/src/dsp/analysis/beatThis/artefact.json`) must match the
file the export tool builds and the checkpoint it came from; those checks skip where the build or
the checkpoint is absent (CI has neither). Synthetic values only, no audio.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pytest

from selecta.engine_store import facts as song_facts

ROOT = Path(__file__).resolve().parent.parent
RECORD = ROOT / "web" / "src" / "dsp" / "analysis" / "beatThis" / "artefact.json"
BUILT = ROOT / "build" / "beat-this" / "beat-this-small0.onnx"
INTERIM = "web-dsp-1+web-onset-comb-beats-1"
NEURAL = "web-dsp-1+web-beatthis-small0-1"


def _prov(implementation: str, source: str = song_facts.DEVICE, at: str = "2026-11-26T00:00:00Z"):
    return song_facts.Provenance(implementation, source, at)


def test_the_allowlist_takes_both_browser_beat_sources_and_the_plain_id():
    assert song_facts.DEVICE_IMPLEMENTATIONS["web-dsp-1"] == 1001
    assert song_facts.DEVICE_IMPLEMENTATIONS[INTERIM] == 1002
    assert song_facts.DEVICE_IMPLEMENTATIONS[NEURAL] == 1003
    # every device version stays clear of the Python analysis's single digits
    assert all(v > 1000 for v in song_facts.DEVICE_IMPLEMENTATIONS.values())
    assert len(set(song_facts.DEVICE_IMPLEMENTATIONS.values())) == 3
    for name, version in song_facts.DEVICE_IMPLEMENTATIONS.items():
        assert len(name) <= 64  # facts_routes.FactsRequest.implementation
        assert song_facts.version_of(name, song_facts.DEVICE) == version


def test_the_rank_puts_beat_this_above_the_interim_beats_and_below_python():
    python = song_facts.python_implementation()
    order = ["web-dsp-1", INTERIM, NEURAL, python]
    assert list(song_facts.RANK) == order
    ranks = [song_facts.rank(name) for name in order]
    assert ranks == sorted(ranks)
    late, early = "2026-11-26T10:00:00Z", "2026-11-26T09:00:00Z"
    # a song measured again with Beat This replaces its interim measurement, even an older one
    assert song_facts.wins(_prov(NEURAL, at=early), _prov(INTERIM, at=late))
    assert not song_facts.wins(_prov(INTERIM, at=late), _prov(NEURAL, at=early))
    assert song_facts.wins(_prov(INTERIM, at=early), _prov("web-dsp-1", at=late))
    # the Python analysis still outranks the browser's best, and a worker beats any device
    assert song_facts.wins(_prov(python, at=early), _prov(NEURAL, at=late))
    assert song_facts.wins(_prov(python, song_facts.WORKER, early), _prov(NEURAL, at=late))
    assert not song_facts.wins(_prov(NEURAL, at=late), _prov(python, song_facts.WORKER, early))


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def test_the_committed_model_record_is_well_formed():
    record = json.loads(RECORD.read_text(encoding="utf-8"))
    assert record["implementation"] == "web-beatthis-small0-1"
    assert len(record["sha256"]) == 64 and int(record["sha256"], 16) >= 0
    assert record["path"] == f"/models/beat-this/web-beatthis-small0-1/{record['sha256']}.onnx"
    assert record["opset"] == 17 and record["dtype"] == "float32"
    assert record["source"]["checkpoint"] == "small0"
    assert record["source"]["url"].endswith("/small0.ckpt")
    assert record["equivalence"]["maxAbsLogit"] <= record["equivalence"]["tolerance"] <= 1e-3


def test_the_built_model_matches_the_committed_record():
    if not BUILT.exists():
        pytest.skip("the exported model is not built here (python tools/beat_this_onnx_export.py)")
    record = json.loads(RECORD.read_text(encoding="utf-8"))
    assert BUILT.stat().st_size == record["bytes"]
    assert _sha256(BUILT) == record["sha256"]


def test_the_source_checkpoint_matches_the_committed_record():
    torch = pytest.importorskip("torch")
    checkpoint = Path(torch.hub.get_dir()) / "checkpoints" / "beat_this-small0.ckpt"
    if not checkpoint.exists():
        pytest.skip("the Beat This checkpoint is not cached here")
    record = json.loads(RECORD.read_text(encoding="utf-8"))
    assert checkpoint.stat().st_size == record["source"]["bytes"]
    assert _sha256(checkpoint) == record["source"]["sha256"]
