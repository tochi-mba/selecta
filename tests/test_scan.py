import numpy as np
import soundfile as sf
from mutagen.flac import FLAC

from selecta import db
from selecta.library.scan import identity, scan_folder


def _song(path, title, artist="Someone", genre=None, seconds=60.0):
    path.parent.mkdir(parents=True, exist_ok=True)
    sf.write(path, np.zeros((int(seconds * 100), 2)), 100, format="FLAC", subtype="PCM_16")
    tags = FLAC(path)
    tags["title"], tags["artist"] = title, artist
    if genre:
        tags["genre"] = genre
    tags.save()


def _scan(tmp_path, root):
    conn = db.connect(tmp_path / "library.sqlite")
    return conn, scan_folder(conn, root)


def test_spoken_word_is_set_aside_and_music_is_kept(tmp_path):
    root = tmp_path / "music"
    _song(root / "Album" / "a.flac", "Song A", genre="Pop")
    _song(root / "Album" / "b.flac", "Song B", genre="R&B")
    _song(root / "Some Audiobooks" / "c.flac", "Part 1")
    _song(root / "Tagged" / "d.flac", "Part 2", genre="Audio Book")
    _song(root / "Tagged" / "e.flac", "Part 3")
    _song(root / "Subs" / "f.flac", "Part 4")
    (root / "Subs" / "f.srt").write_text("1\n")

    conn, report = _scan(tmp_path, root)

    assert report.music == 2
    rows = {r["title"]: r for r in conn.execute("SELECT * FROM songs")}
    assert rows["Song A"]["is_music"] == 1
    for title in ("Part 1", "Part 2", "Part 3", "Part 4"):
        assert rows[title]["is_music"] == 0, title
        assert rows[title]["set_aside_reason"]


def test_very_short_and_very_long_files_are_set_aside(tmp_path):
    root = tmp_path / "music"
    _song(root / "Album" / "a.flac", "Normal")
    _song(root / "Album" / "b.flac", "Normal two")
    _song(root / "Album" / "c.flac", "Skit", seconds=20.0)
    _song(root / "Album" / "d.flac", "Marathon", seconds=1000.0)

    conn, _ = _scan(tmp_path, root)

    reasons = {r["title"]: r["set_aside_reason"] for r in conn.execute("SELECT * FROM songs")}
    assert reasons["Normal"] is None
    assert "shorter" in reasons["Skit"]
    assert "longer" in reasons["Marathon"]


def test_a_person_can_overrule_the_filter_and_it_survives_a_rescan(tmp_path):
    root = tmp_path / "music"
    _song(root / "Album" / "a.flac", "Marathon", seconds=1000.0)
    _song(root / "Album" / "b.flac", "Normal")
    conn, _ = _scan(tmp_path, root)
    conn.execute("UPDATE songs SET music_override = 1 WHERE title = 'Marathon'")
    conn.commit()

    scan_folder(conn, root)

    row = conn.execute("SELECT * FROM songs WHERE title = 'Marathon'").fetchone()
    assert row["is_music"] == 1


def test_same_song_in_two_folders_keeps_one_copy(tmp_path):
    root = tmp_path / "music"
    _song(root / "Chart A" / "a.flac", "Big Song (Radio Edit)", artist="Star feat. Guest")
    _song(root / "Chart B" / "b.flac", "Big Song", artist="Star")
    _song(root / "Chart B" / "c.flac", "Big Song", artist="Star", seconds=200.0)

    conn, report = _scan(tmp_path, root)

    assert report.duplicates == 1
    rows = conn.execute("SELECT * FROM songs WHERE duplicate_of IS NULL").fetchall()
    assert len(rows) == 2, "a very different length is treated as another version"


def test_identity_ignores_noise_but_not_the_song():
    base = identity("Star", "Big Song")
    assert identity("Star feat. Guest", "Big Song (Remastered 2011)") == base
    assert identity("STAR & Friend", "Big Song - feat. Someone") != ""
    assert identity("Star", "Another Song") != base
