"""MP-0272-03: the browser fixture library can open the Stem Studio without the separation model.

tests/e2e_server.py SELECTA_E2E_STEMS=1 fills the stem cache for the first transition, so the
Studio's own layout code (prepare_session) runs for real on cached stems and never calls Demucs.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent))


@pytest.fixture(scope="module")
def built(tmp_path_factory):
    from e2e_server import build

    home = tmp_path_factory.mktemp("studio-stems")
    return build(home)


def test_seeded_stems_let_the_studio_lay_out_its_grid(built, monkeypatch, tmp_path):
    from e2e_server import seed_studio_stems

    from selecta import db, stems
    from selecta.analysis.song import load_song
    from selecta.studio import LANES, SIDES, find_placement, prepare_session, why_no_studio

    def no_model(*_args, **_kwargs):
        raise AssertionError("the fixture must never run the separation model")

    monkeypatch.setattr(stems, "run_demucs", no_model)
    conn = db.connect(built.db_path)
    try:
        folders = seed_studio_stems(conn, built, 1, 2)
        a, b = load_song(conn, built, 1), load_song(conn, built, 2)
    finally:
        conn.close()
    assert len(folders) == 2
    assert why_no_studio(a, b) is None
    assert find_placement(a, b) is not None
    session = prepare_session(built, a, b, tmp_path / "session")
    assert session["cells"] == 8 and session["seconds"] > 0
    for side in SIDES:
        for lane in LANES:
            assert (tmp_path / "session" / f"{side}_{lane}.flac").stat().st_size > 0
