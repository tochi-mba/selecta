from __future__ import annotations

import sqlite3
from pathlib import Path

import numpy as np
from fastapi.testclient import TestClient

from selecta import db
from selecta.analysis.pipeline import features_path
from selecta.api import create_app
from selecta.config import ANALYSIS_VERSION, Settings
from selecta.eval.ratings import results, save_rating
from selecta.lyrics.lrclib import Line
from selecta.lyrics.match import SongFacts, discover, normalise
from selecta.planner.arc import feasible_curve, target_energy
from selecta.planner.choose import styles_for_language
from selecta.session import get_steering, steer
from selecta.styles import all_recipes


def connection(path: Path) -> sqlite3.Connection:
    return db.connect(path / "selecta.sqlite")


def test_wordplay_uses_tokens_and_finds_shared_phrases():
    assert normalise("lover") != normalise("love")
    links = discover(
        {
            1: [Line(50, 52, "all night long"), Line(60, 62, "all night long")],
            2: [Line(50, 54, "we go all night long"), Line(60, 62, "somewhere else")],
        },
        facts={1: SongFacts("One", "x", 240.0), 2: SongFacts("Two", "y", 240.0)},
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
    assert {"bass_swap_blend", "filter_sweep", "tempo_ramp"} <= seamless
    assert "cut_on_one" not in seamless
    assert "cut_on_one" in styles_for_language("punchy")
    assert styles_for_language("balanced") is None
    assert set(styles_for_language("seamless")) | set(styles_for_language("punchy")) <= set(
        all_recipes()
    )


def test_every_recipe_on_offer_is_different_from_the_others(tmp_path: Path):
    """An earlier build listed several recipes that rendered the same samples as another one."""
    names = all_recipes()
    assert not {"drop_swap", "brake", "riser_air", "half_double", "word_cut"} & set(names)


def test_api_refuses_changes_requested_by_another_website(tmp_path: Path):
    settings = Settings(home=tmp_path)
    settings.home.mkdir(exist_ok=True)
    db.connect(settings.db_path).close()
    client = TestClient(create_app(settings=settings))
    hostile = {"Origin": "https://evil.example"}
    assert client.post("/api/steer", json={"action": "more"}, headers=hostile).status_code == 403
    assert client.post("/api/plan", headers=hostile).status_code == 403
    local = {"Origin": "http://127.0.0.1:8000"}
    assert client.post("/api/steer", json={"action": "more"}, headers=local).status_code == 200
    assert client.post("/api/steer", json={"action": "more"}).status_code == 200


def test_a_bad_steering_request_is_refused_cleanly(tmp_path: Path):
    settings = Settings(home=tmp_path)
    settings.home.mkdir(exist_ok=True)
    db.connect(settings.db_path).close()
    client = TestClient(create_app(settings=settings))
    assert client.post("/api/steer", json={"action": "nonsense"}).status_code == 400


def test_the_page_never_contacts_another_server():
    style = (Path(__file__).parent.parent / "web" / "src" / "style.css").read_text("utf-8")
    assert "http://" not in style
    assert "https://" not in style


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


def test_status_distinguishes_analysed_songs_from_mix_ready_and_refreshes_after_lyrics(
    tmp_path: Path,
):
    settings = Settings(tmp_path)
    with connection(tmp_path) as conn:
        for song_id in (1, 2):
            conn.execute(
                "INSERT INTO songs(id,path,folder,size,mtime,duration,artist,title,is_music) "
                "VALUES(?,?,?,1,1,64,?,?,1)",
                (song_id, f"{song_id}.flac", "music", f"Artist {song_id}", f"Song {song_id}"),
            )
            conn.execute(
                "INSERT INTO analysis(song_id,version,bpm,camelot,grid_confidence,beats_per_bar,"
                "constant_tempo,key_confidence,lufs,peak_db,energy,sections) "
                "VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
                (song_id, ANALYSIS_VERSION, 120, "8A", 0.95, 4, 1, 0.9, -14, -2, 0.5, "[]"),
            )
            path = features_path(settings, song_id)
            path.parent.mkdir(parents=True, exist_ok=True)
            np.savez(
                path,
                beats=np.arange(0, 128, dtype=np.float32) * 0.5,
                bar_starts=np.arange(0, 128, 4),
                energy_bars=np.full(32, 0.5, dtype=np.float32),
                low_share_bars=np.full(32, 0.3, dtype=np.float32),
                chroma_bars=np.zeros((32, 12), dtype=np.float32),
                rms_db_bars=np.full(32, -14, dtype=np.float32),
                mfcc_bars=np.zeros((32, 20), dtype=np.float32),
            )
        conn.execute("INSERT INTO lyrics(song_id,status) VALUES(1,'instrumental')")
        conn.commit()

    client = TestClient(create_app(settings, tmp_path / "no-web"))
    before = client.get("/api/status").json()["counts"]
    assert before["analysed"] == 2
    assert before["ready"] == 1

    with connection(tmp_path) as conn:
        conn.execute("INSERT INTO lyrics(song_id,status) VALUES(2,'instrumental')")
        conn.commit()
    after = client.get("/api/status").json()["counts"]
    assert after["ready"] == 2


def test_storage_budget_and_priority_queue(tmp_path: Path):
    settings = Settings(tmp_path)
    app = create_app(settings, tmp_path / "no-web")
    with connection(tmp_path) as conn:
        conn.executemany(
            "INSERT INTO songs(id,path,folder,size,mtime,duration,is_music) VALUES(?,?,?,?,?,?,1)",
            [(1, "one", "", 1, 1, 100), (2, "two", "", 1, 1, 100)],
        )
        conn.commit()
    client = TestClient(app)
    assert client.post("/api/storage", json={"budget_gb": 1}).status_code == 200
    assert settings.effective_cache_cap_bytes == 1024**3
    assert client.post("/api/songs/2/priority?priority=100").status_code == 200
    with connection(tmp_path) as conn:
        rows = db.songs_needing_analysis(conn, 3)
    assert [row["id"] for row in rows] == [2, 1]
