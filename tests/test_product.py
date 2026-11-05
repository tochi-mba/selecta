from __future__ import annotations

import sqlite3
from pathlib import Path

from fastapi.testclient import TestClient

from selecta import db
from selecta.api import create_app
from selecta.config import Settings
from selecta.eval.ratings import results, save_rating
from selecta.lyrics.lrclib import Line
from selecta.lyrics.match import discover, normalise
from selecta.planner.arc import feasible_curve, target_energy
from selecta.planner.choose import styles_for_language
from selecta.session import get_steering, steer


def connection(path: Path) -> sqlite3.Connection:
    return db.connect(path / "selecta.sqlite")


def test_wordplay_uses_tokens_and_finds_shared_phrases():
    assert normalise("lover") != normalise("love")
    links = discover(
        {
            1: [Line(1, 3, "all night long"), Line(10, 12, "all night long")],
            2: [Line(2, 4, "we go all night long")],
        }
    )
    assert any(link.phrase == "all night long" for link in links)
    assert links[0].kind == "shared_phrase"


def test_arc_has_a_late_peak_and_is_library_feasible():
    assert target_energy(0.65) > target_energy(0.0)
    assert target_energy(0.65) > target_energy(1.0)
    available = [0.2, 0.5, 0.8]
    assert set(feasible_curve(available, 10)) <= set(available)


def test_steering_persists(tmp_path: Path):
    with connection(tmp_path) as conn:
        steer(conn, "more")
        steer(conn, "wordplay", "often")
        state = get_steering(conn)
    assert state.energy == 1
    assert state.wordplay == "often"


def test_mixing_language_keeps_choices_without_forcing_one_recipe():
    seamless = styles_for_language("seamless", "often")
    assert {"bass_swap_blend", "vocal_swap", "acapella_bridge"} <= seamless
    assert "cut_on_one" not in seamless
    assert "vocal_swap" not in styles_for_language("seamless", "never")
    assert styles_for_language("balanced") is None


def test_blind_test_reports_bad_rate(tmp_path: Path):
    with connection(tmp_path) as conn:
        conn.executemany(
            "INSERT INTO songs(id,path,folder,size,mtime,duration,is_music) VALUES(?,?,?,?,?,?,1)",
            [(1, "a", "", 1, 1, 100), (2, "b", "", 1, 1, 100)],
        )
        save_rating(conn, 1, 2, "selecta", 2, ["beat"])
        save_rating(conn, 1, 2, "selecta", 5, [])
        report = results(conn)
    assert report["selecta"]["bad_rate"] == 0.5


def test_api_rejects_foreign_hosts_and_persists_controls(tmp_path: Path):
    settings = Settings(tmp_path)
    app = create_app(settings, tmp_path / "no-web")
    client = TestClient(app)
    assert client.get("/api/status").status_code == 200
    changed = client.post("/api/steer", json={"action": "more"})
    assert changed.json()["energy"] == 1
    assert client.get("/api/status", headers={"host": "attacker.example"}).status_code == 403
