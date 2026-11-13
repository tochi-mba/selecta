from __future__ import annotations

import time

import pytest

from selecta.local_engine import capabilities as caps


def test_protocol_negotiation_and_rejection():
    assert caps.negotiate_version(1, 2) == 1
    with pytest.raises(caps.IncompatibleProtocol):
        caps.negotiate_version(2, 3)
    with pytest.raises(caps.IncompatibleProtocol):
        caps.negotiate_version(True, 1)


def test_no_ffmpeg_no_audio_readiness(monkeypatch):
    monkeypatch.setattr(caps.shutil, "which", lambda _: None)
    report = caps.capability_report(platform_name="darwin")
    assert report["supported_codecs"] == []
    assert not report["ready_for_audio"]
    assert not report["output"]["supported"]


def test_output_enumeration_never_claims_playback(monkeypatch):
    monkeypatch.setattr(caps, "ffmpeg_probe", lambda: {
        "available": True, "version": "test",
    })
    monkeypatch.setattr(caps, "output_inventory", lambda name: {
        "detected": 1, "supported": True, "probe": "fake",
    })
    assert not caps.capability_report()["ready_for_audio"]
    stale = caps.OutputEvidence("speaker-1", time.time() - 99, True)
    assert not caps.capability_report(output_evidence=stale)["ready_for_audio"]
    fresh = caps.OutputEvidence("speaker-1", time.time(), True)
    assert caps.capability_report(output_evidence=fresh)["ready_for_audio"]
    assert "speaker-1" not in str(caps.capability_report(output_evidence=fresh))


def test_model_inventory_never_leaks_local_filenames(tmp_path):
    from selecta.local_engine.capabilities import model_inventory

    folder = tmp_path / "models"
    folder.mkdir()
    (folder / "private-training-name.pt").write_bytes(b"checkpoint")
    report = model_inventory(tmp_path)
    assert report == {"checkpoint_candidates": 1, "state": "present_unvalidated"}
    assert "private-training-name" not in str(report)
