"""rv-root: a rated seam whose song has no measured tempo is still listed, with no made-up gap."""

import json
from pathlib import Path

from selecta import db
from selecta.eval.feedback import patterns, read_rated


def _home(path: Path, bpms: dict[int, float | None]) -> Path:
    path.mkdir(parents=True)
    conn = db.connect(path / "selecta.sqlite")
    for song, bpm in bpms.items():
        conn.execute(
            "INSERT INTO songs(id,path,folder,size,mtime,duration,artist,title,is_music) "
            "VALUES(?,?,?,?,?,?,?,?,1)",
            (song, f"{song}.flac", "f", 1, 1.0, 200.0, f"Artist {song}", f"Song {song}"),
        )
        conn.execute(
            "INSERT INTO analysis(song_id,version,bpm,camelot,grid_confidence) "
            "VALUES(?,3,?,'8A',0.9)",
            (song, bpm),
        )
    conn.commit()
    conn.close()
    return path


def _rate(home: Path, key: str, a: int, b: int, style: str = "vocal_ride") -> None:
    folder = home / "renders" / "seams" / key
    folder.mkdir(parents=True)
    state = {
        "key": key,
        "style": style,
        "passed": True,
        "rating": "good",
        "bars": 8,
        "request": {"a": a, "b": b, "move": style},
    }
    (folder / "seam.json").write_text(json.dumps(state), "utf-8")


def test_a_song_with_no_or_zero_tempo_is_listed_without_a_tempo_gap(tmp_path):
    home = _home(tmp_path / "home", {1: 120.0, 2: None, 3: 0.0, 4: 126.0})
    _rate(home, "null", 1, 2)
    _rate(home, "zero", 4, 3, style="phrase_roll")
    _rate(home, "known", 1, 4)
    rated = {item.a + item.b: item for item in read_rated(home)}
    assert len(rated) == 3
    assert rated["Artist 1 - Song 1Artist 2 - Song 2"].gap is None
    assert rated["Artist 4 - Song 4Artist 3 - Song 3"].gap is None
    assert abs(rated["Artist 1 - Song 1Artist 4 - Song 4"].gap - (1 - 120 / 126)) < 1e-9
    found = patterns(list(rated.values()))
    # every rating still counts where its tempo doesn't matter
    assert found["move"]["vocal_ride"] == (2, 0)
    # and only the one with a known tempo is put in a tempo-gap row
    assert sum(sum(counts) for counts in found["overlap tempo gap"].values()) == 1
    assert sum(sum(counts) for counts in found["phrase roll tempo gap"].values()) == 0


def test_selecta_ratings_lists_a_seam_whose_tempo_is_unknown(tmp_path, monkeypatch):
    from typer.testing import CliRunner

    from selecta import cli
    from selecta.eval import feedback

    home = _home(tmp_path / "home", {1: 120.0, 2: None})
    _rate(home, "null", 1, 2)
    monkeypatch.setattr(feedback, "known_homes", lambda current: [home])
    result = CliRunner().invoke(cli.app, ["ratings"])
    assert result.exit_code == 0, result.output
    assert "tempo unknown" in result.output


def test_a_song_with_no_key_is_listed_without_a_key_distance(tmp_path, monkeypatch):
    from typer.testing import CliRunner

    from selecta import cli
    from selecta.eval import feedback

    home = _home(tmp_path / "home", {1: 120.0, 2: 122.0, 3: 124.0})
    conn = db.connect(home / "selecta.sqlite")
    conn.execute("UPDATE analysis SET camelot=NULL WHERE song_id=2")
    conn.commit()
    conn.close()
    _rate(home, "nokey", 1, 2)
    _rate(home, "known", 1, 3)
    rated = {item.b: item for item in read_rated(home)}
    assert len(rated) == 2
    assert rated["Artist 2 - Song 2"].keys is None
    assert rated["Artist 3 - Song 3"].keys == 0
    found = patterns(list(rated.values()))
    assert found["move"]["vocal_ride"] == (2, 0)
    assert sum(sum(counts) for counts in found["key distance"].values()) == 1
    monkeypatch.setattr(feedback, "known_homes", lambda current: [home])
    result = CliRunner().invoke(cli.app, ["ratings"])
    assert result.exit_code == 0, result.output
    assert "key unknown" in result.output
