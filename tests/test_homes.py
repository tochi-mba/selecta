"""All of Selecta's data in one folder, whichever app started it."""

import json
import sqlite3
from pathlib import Path

from selecta import db
from selecta.config import default_home
from selecta.eval.feedback import all_rated, patterns
from selecta.homes import MARKER, gather, gather_if_needed, old_homes


def _home(path: Path, analysed: list[int], songs: int = 4) -> Path:
    path.mkdir(parents=True)
    conn = db.connect(path / "selecta.sqlite")
    for song in range(1, songs + 1):
        conn.execute(
            "INSERT INTO songs(id,path,folder,size,mtime,duration,artist,title,is_music) "
            "VALUES(?,?,?,?,?,?,?,?,1)",
            (song, f"{song}.flac", "f", 1, 1.0, 200.0, f"Artist {song}", f"Song {song}"),
        )
    for song in analysed:
        conn.execute(
            "INSERT INTO analysis(song_id,version,bpm,camelot,grid_confidence) "
            "VALUES(?,3,120,'8A',0.9)",
            (song,),
        )
    conn.commit()
    conn.close()
    return path


def _seam(
    home: Path, key: str, rating: str | None = None, a: int = 1, b: int = 2, style="vocal_ride"
):
    folder = home / "renders" / "seams" / key
    folder.mkdir(parents=True)
    (folder / "clip.flac").write_bytes(b"sound")
    state = {
        "status": "ready",
        "key": key,
        "style": style,
        "passed": True,
        "rating": rating,
        "bars": 12,
        "request": {"a": a, "b": b, "move": style},
    }
    (folder / "seam.json").write_text(json.dumps(state), "utf-8")
    return folder


def _count(home: Path, table: str) -> int:
    conn = sqlite3.connect(home / "selecta.sqlite")
    try:
        return conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
    finally:
        conn.close()


def test_data_lives_where_no_desktop_app_redirects_it(monkeypatch):
    monkeypatch.delenv("SELECTA_HOME", raising=False)
    monkeypatch.setenv("LOCALAPPDATA", "C:/somewhere/AppData/Local")
    assert default_home() == Path.home() / ".selecta"
    monkeypatch.setenv("SELECTA_HOME", "D:/music-data")
    assert default_home() == Path("D:/music-data")


def test_every_older_folder_is_found_with_the_richest_first(tmp_path, monkeypatch):
    local = tmp_path / "Local"
    _home(local / "selecta", [1])
    _home(local / "Packages" / "OpenAI.Codex_x" / "LocalCache" / "Local" / "selecta", [1, 2, 3])
    _home(local / "Packages" / "Claude_y" / "LocalCache" / "Local" / "selecta", [1, 2])
    (local / "Packages" / "Other_z" / "LocalCache" / "Local").mkdir(parents=True)
    monkeypatch.setenv("LOCALAPPDATA", str(local))
    found = old_homes(tmp_path / "new")
    assert [home.parts[-4] if "Packages" in home.parts else "plain" for home in found] == [
        "OpenAI.Codex_x",
        "Claude_y",
        "plain",
    ]


def test_gathering_adds_what_each_folder_has_and_changes_neither(tmp_path):
    richer = _home(tmp_path / "richer", [1, 2, 3])
    other = _home(tmp_path / "other", [3, 4])
    _seam(richer, "from-richer", "good")
    _seam(other, "from-other", "bad", a=2, b=3)
    (other / "features").mkdir()
    (other / "features" / "4.npz").write_bytes(b"facts")
    (other / "stems" / "w").mkdir(parents=True)
    (other / "stems" / "w" / "vocals.wav").write_bytes(b"voice")
    before = (other / "selecta.sqlite").read_bytes()
    target = tmp_path / "target"

    assert gather(target, [richer, other]) == [richer, other]

    assert _count(target, "analysis") == 4
    assert (target / "features" / "4.npz").read_bytes() == b"facts"
    assert (target / "stems" / "w" / "vocals.wav").read_bytes() == b"voice"
    assert (target / "renders" / "seams" / "from-richer" / "clip.flac").exists()
    assert (target / "renders" / "seams" / "from-other" / "clip.flac").exists()
    assert (target / MARKER).exists()
    assert (other / "selecta.sqlite").read_bytes() == before, "older folders are only read"
    assert (other / "stems" / "w" / "vocals.wav").exists()


def test_every_rating_is_kept_and_outlasts_the_render_cache(tmp_path):
    first = _home(tmp_path / "first", [1, 2])
    second = _home(tmp_path / "second", [1, 2])
    _seam(first, "same", None)
    _seam(second, "same", "good")
    _seam(second, "only-second", "bad", a=2, b=1)
    target = tmp_path / "target"
    gather(target, [first, second])
    record = json.loads((target / "renders" / "seams" / "same" / "seam.json").read_text("utf-8"))
    assert record["rating"] == "good", "a rating in either folder is kept"
    history = json.loads((target / "seam-history" / "only-second.json").read_text("utf-8"))
    assert history["rating"] == "bad"


def test_a_failed_analysis_gives_way_to_one_that_worked(tmp_path):
    first = _home(tmp_path / "first", [1])
    second = _home(tmp_path / "second", [1, 2])
    conn = sqlite3.connect(first / "selecta.sqlite")
    conn.execute("INSERT INTO analysis(song_id,version,error) VALUES(2,3,'broke')")
    conn.commit()
    conn.close()
    target = tmp_path / "target"
    gather(target, [first, second])
    conn = sqlite3.connect(target / "selecta.sqlite")
    assert conn.execute("SELECT error FROM analysis WHERE song_id=2").fetchone()[0] is None
    conn.close()


def test_saved_mixes_from_every_folder_are_kept(tmp_path):
    first = _home(tmp_path / "first", [1])
    second = _home(tmp_path / "second", [1])
    shared = {"name": "Both", "songs": [1]}
    friday = {"name": "Friday", "songs": [1]}
    sunday = {"name": "Sunday", "songs": [2]}
    for home, mixes in ((first, [friday, shared]), (second, [sunday, shared])):
        conn = db.connect(home / "selecta.sqlite")
        db.set_preference(conn, "saved_mixes", mixes)
        conn.commit()
        conn.close()
    target = tmp_path / "target"
    gather(target, [first, second])
    conn = db.connect(target / "selecta.sqlite")
    names = [row["name"] for row in conn.execute("SELECT name FROM drafts")]
    assert sorted(names) == ["Both", "Friday", "Sunday"], "each kept once"
    conn.close()


def test_drafts_from_every_folder_are_kept(tmp_path):
    first = _home(tmp_path / "first", [1])
    second = _home(tmp_path / "second", [1])
    for home, names in ((first, ["Friday", "Both"]), (second, ["Sunday", "Both"])):
        conn = db.connect(home / "selecta.sqlite")
        for name in names:
            conn.execute("INSERT INTO drafts(name,items,line) VALUES(?,'[]',0)", (name,))
        conn.commit()
        conn.close()
    target = tmp_path / "target"
    gather(target, [first, second])
    conn = db.connect(target / "selecta.sqlite")
    rows = conn.execute("SELECT name FROM drafts").fetchall()
    assert sorted(row["name"] for row in rows) == ["Both", "Friday", "Sunday"]
    conn.close()


def test_gathering_again_changes_nothing_and_picks_up_new_clicks(tmp_path):
    source = _home(tmp_path / "source", [1])
    _seam(source, "seam")
    target = tmp_path / "target"
    gather(target, [source])
    gather(target, [source])
    assert _count(target, "analysis") == 1
    path = source / "renders" / "seams" / "seam" / "seam.json"
    state = json.loads(path.read_text("utf-8"))
    state["rating"] = "good"
    path.write_text(json.dumps(state), "utf-8")
    gather(target, [source])
    saved = json.loads((target / "seam-history" / "seam.json").read_text("utf-8"))
    assert saved["rating"] == "good"


def test_starting_up_only_gathers_when_an_older_folder_has_changed(tmp_path, monkeypatch):
    local = tmp_path / "Local"
    source = _home(local / "selecta", [1])
    monkeypatch.setenv("LOCALAPPDATA", str(local))
    target = tmp_path / "target"
    assert gather_if_needed(target) == [source]
    assert gather_if_needed(target) == [], "nothing new since last time"


def test_starting_up_with_nothing_older_is_fine(tmp_path, monkeypatch):
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path / "Local"))
    assert gather_if_needed(tmp_path / "target") == []


def test_ratings_are_read_from_every_folder_and_counted_once(tmp_path):
    first = _home(tmp_path / "first", [1, 2, 3])
    second = _home(tmp_path / "second", [1, 2, 3])
    _seam(first, "same", "good")
    _seam(second, "same", "good")
    _seam(second, "other", "bad", a=2, b=3, style="phrase_roll")
    rated = all_rated([first, second])
    assert len(rated) == 2
    assert {item.move for item in rated} == {"vocal_ride", "phrase_roll"}
    found = patterns(rated)
    assert found["move"]["vocal_ride"] == (1, 0)
    assert found["move"]["phrase_roll"] == (0, 1)
    assert found["overlap length"]["12 bars"] == (1, 0)
    assert found["phrase roll tempo gap"]["within 10%"] == (0, 1)
