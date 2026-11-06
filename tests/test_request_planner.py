from types import SimpleNamespace as NS

from selecta.request_planner import proposals


def test_waiting_request_does_not_block_fit_and_known_failures_are_not_retried(monkeypatch):
    songs = [
        NS(id=i, bpm=120, exit_cues=lambda: [], entry_cues=lambda: []) for i in (1, 2, 3, 8, 9)
    ]
    monkeypatch.setattr(
        "selecta.request_planner.handoff_quality",
        lambda a, b, riders: 0.9 if (a.id, b.id) in {(2, 9), (9, 3)} else 0,
    )
    candidate = NS(
        recipe=NS(name="bass_swap_blend"), bars=8, exit_cue=NS(bar=16), entry_cue=NS(bar=0)
    )
    monkeypatch.setattr(
        "selecta.request_planner.enumerate_candidates", lambda *a, **kw: [candidate]
    )
    memory = NS(move_factor=lambda *a: 1)
    requests = [dict(id=1, song_id=8), dict(id=2, song_id=9)]
    order = [(1, None, 0), (2, None, 0), (3, None, 0)]
    result = proposals(requests, order, songs, 1, memory, lambda key: {"status": "none"})
    assert result[0]["plan"] is None
    assert result[1]["plan"]["position"] == 2
    assert len(result[1]["plan"]["seams"]) == 2
    failed = proposals(requests, order, songs, 1, memory, lambda key: {"status": "failed"})
    assert all(row["plan"] is None for row in failed)
    assert order == [(1, None, 0), (2, None, 0), (3, None, 0)]


def test_missing_analysis_and_existing_song_have_distinct_waiting_reasons():
    rows = [dict(id=1, song_id=9), dict(id=2, song_id=1)]
    result = proposals(rows, [(1, None, 0)], [], 0, NS(), lambda key: {})
    assert "analysis" in result[0]["reason"]
    assert "already" in result[1]["reason"]
