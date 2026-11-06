import os
import time

import numpy as np
import soundfile as sf
from mutagen.flac import FLAC

from selecta import db
from selecta.library.scan import (
    SETTLE_SECONDS,
    folder_changed,
    identity,
    library_folders,
    scan_folder,
)


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


# ---- new songs appearing by themselves, and songs going away


def _settled(path):
    old = time.time() - 3600
    os.utime(path, (old, old))


def _library(tmp_path, count=4):
    root = tmp_path / "music"
    for number in range(count):
        path = root / f"{number}.flac"
        _song(path, f"Song {number}", artist=f"Artist {number}")
        _settled(path)
    return root, *_scan(tmp_path, root)


def test_nothing_new_means_nothing_to_do(tmp_path):
    root, conn, _report = _library(tmp_path)
    assert not folder_changed(conn, root)


def test_a_new_song_is_noticed_and_brought_in(tmp_path):
    root, conn, _report = _library(tmp_path)
    new = root / "new.flac"
    _song(new, "New one", artist="Someone new")
    _settled(new)
    assert folder_changed(conn, root)
    report = scan_folder(conn, root, careful=True)
    assert report.new_or_changed == 1
    assert conn.execute("SELECT COUNT(*) FROM songs").fetchone()[0] == 5
    assert not folder_changed(conn, root), "and it's settled after that"


def test_a_song_in_a_new_subfolder_is_noticed(tmp_path):
    root, conn, _report = _library(tmp_path)
    new = root / "Album" / "Disc 1" / "deep.flac"
    _song(new, "Deep", artist="Someone new")
    _settled(new)
    assert folder_changed(conn, root)


def test_a_file_still_being_copied_waits_until_it_settles(tmp_path):
    root, conn, _report = _library(tmp_path)
    new = root / "copying.flac"
    _song(new, "Copying", artist="Someone new")
    assert not folder_changed(conn, root, now=new.stat().st_mtime + 1)
    assert folder_changed(conn, root, now=new.stat().st_mtime + SETTLE_SECONDS + 1)


def test_one_file_still_copying_does_not_hold_back_the_others(tmp_path):
    """A long download always has something fresh, so nothing else ever got its turn."""
    root, conn, _report = _library(tmp_path)
    finished = root / "finished.flac"
    _song(finished, "Finished", artist="Someone new")
    _settled(finished)
    arriving = root / "arriving.flac"
    _song(arriving, "Arriving", artist="Someone else")
    assert folder_changed(conn, root)
    report = scan_folder(conn, root, careful=True)
    assert report.new_or_changed == 1
    titles = {row[0] for row in conn.execute("SELECT title FROM songs")}
    assert "Finished" in titles
    assert "Arriving" not in titles, "not until it has finished"
    _settled(arriving)
    assert folder_changed(conn, root)
    scan_folder(conn, root, careful=True)
    assert "Arriving" in {row[0] for row in conn.execute("SELECT title FROM songs")}


def test_a_known_song_being_replaced_keeps_its_old_details_until_it_settles(tmp_path):
    root, conn, _report = _library(tmp_path)
    path = root / "0.flac"
    _song(path, "Replacing", artist="Artist 0")
    assert not folder_changed(conn, root)
    report = scan_folder(conn, root, careful=True)
    assert report.removed == 0
    assert "Song 0" in {row[0] for row in conn.execute("SELECT title FROM songs")}


def test_a_person_rescanning_reads_everything_even_if_fresh(tmp_path):
    root, conn, _report = _library(tmp_path)
    _song(root / "fresh.flac", "Fresh", artist="Someone new")
    scan_folder(conn, root)
    assert "Fresh" in {row[0] for row in conn.execute("SELECT title FROM songs")}


def test_a_broken_file_does_not_set_off_a_scan_every_minute(tmp_path, monkeypatch):
    root, conn, _report = _library(tmp_path)
    broken = root / "broken.flac"
    broken.write_bytes(b"this isn't audio")
    _settled(broken)
    assert folder_changed(conn, root)
    assert scan_folder(conn, root, careful=True).unreadable == [str(broken)]
    assert not folder_changed(conn, root)


def test_a_broken_file_is_not_read_again_until_it_changes(tmp_path, monkeypatch):
    import selecta.library.scan as scan

    root, conn, _report = _library(tmp_path)
    broken = root / "broken.flac"
    broken.write_bytes(b"this isn't audio")
    _settled(broken)
    scan_folder(conn, root, careful=True)
    reads = []
    real = scan.read_file
    monkeypatch.setattr(scan, "read_file", lambda path: reads.append(path) or real(path))
    other = root / "new.flac"
    _song(other, "New", artist="Someone new")
    _settled(other)
    scan_folder(conn, root, careful=True)
    assert reads == [other], "only the new song"
    _song(broken, "Mended", artist="Someone else")
    _settled(broken)
    assert folder_changed(conn, root)
    scan_folder(conn, root, careful=True)
    assert "Mended" in {row[0] for row in conn.execute("SELECT title FROM songs")}


def test_a_full_scan_tries_a_broken_file_again(tmp_path, monkeypatch):
    import selecta.library.scan as scan

    root, conn, _report = _library(tmp_path)
    broken = root / "broken.flac"
    broken.write_bytes(b"this isn't audio")
    _settled(broken)
    scan_folder(conn, root, careful=True)
    reads = []
    real = scan.read_file
    monkeypatch.setattr(scan, "read_file", lambda path: reads.append(path) or real(path))
    scan_folder(conn, root)
    assert broken in reads


def test_other_kinds_of_file_are_ignored(tmp_path):
    root, conn, _report = _library(tmp_path)
    (root / "cover.jpg").write_bytes(b"x")
    (root / "notes.txt").write_text("x", "utf-8")
    assert not folder_changed(conn, root)


def test_an_unplugged_drive_has_not_changed(tmp_path):
    root, conn, _report = _library(tmp_path)
    assert not folder_changed(conn, tmp_path / "not here")


def test_an_empty_folder_never_wipes_the_library(tmp_path):
    """A drive mounted but empty looks just like every song having been deleted."""
    root, conn, _report = _library(tmp_path)
    for path in root.glob("*.flac"):
        path.unlink()
    assert not folder_changed(conn, root)
    report = scan_folder(conn, root)
    assert report.removed == 0
    assert report.held_back == 4
    assert conn.execute("SELECT COUNT(*) FROM songs").fetchone()[0] == 4


def test_a_big_drop_is_held_back_when_nobody_asked_for_a_scan(tmp_path):
    root, conn, _report = _library(tmp_path)
    for number in range(3):
        (root / f"{number}.flac").unlink()
    report = scan_folder(conn, root, careful=True)
    assert report.removed == 0
    assert report.held_back == 3
    assert conn.execute("SELECT COUNT(*) FROM songs").fetchone()[0] == 4


def test_a_person_rescanning_can_still_clear_songs_out(tmp_path):
    root, conn, _report = _library(tmp_path)
    for number in range(3):
        (root / f"{number}.flac").unlink()
    assert scan_folder(conn, root).removed == 3


def test_a_song_or_two_going_is_noticed_and_removed(tmp_path):
    root, conn, _report = _library(tmp_path)
    (root / "0.flac").unlink()
    assert folder_changed(conn, root)
    assert scan_folder(conn, root, careful=True).removed == 1


def test_a_song_in_the_mix_going_does_not_stop_the_scan(tmp_path):
    """The queue pointing at it made the whole scan fail, every time, from then on."""
    root, conn, _report = _library(tmp_path)
    ids = [row[0] for row in conn.execute("SELECT id FROM songs ORDER BY path")]
    conn.executemany(
        "INSERT INTO queue(position,song_id) VALUES(?,?)", list(enumerate(ids))
    )
    conn.commit()
    (root / "1.flac").unlink()
    assert scan_folder(conn, root).removed == 1
    rows = conn.execute("SELECT position,song_id FROM queue ORDER BY position").fetchall()
    assert [row[0] for row in rows] == [0, 1, 2], "with no gap left in the order"
    assert [row[1] for row in rows] == [ids[0], ids[2], ids[3]]


def test_a_song_with_skip_history_going_does_not_stop_the_scan(tmp_path):
    root, conn, _report = _library(tmp_path)
    song = conn.execute("SELECT id FROM songs WHERE path LIKE '%0.flac'").fetchone()[0]
    conn.execute(
        "CREATE TABLE playback_skips (id INTEGER PRIMARY KEY, song_id INTEGER NOT NULL "
        "REFERENCES songs(id), heard_seconds REAL NOT NULL, source_position REAL NOT NULL)"
    )
    conn.execute(
        "INSERT INTO playback_skips(song_id,heard_seconds,source_position) VALUES(?,1,1)", (song,)
    )
    conn.commit()
    (root / "0.flac").unlink()
    assert scan_folder(conn, root).removed == 1


def test_a_folder_with_a_similar_name_is_left_alone(tmp_path):
    root, conn, _report = _library(tmp_path)
    other = tmp_path / "music2"
    _song(other / "other.flac", "Other", artist="Other")
    _settled(other / "other.flac")
    scan_folder(conn, other)
    before = conn.execute("SELECT COUNT(*) FROM songs").fetchone()[0]
    scan_folder(conn, root)
    assert conn.execute("SELECT COUNT(*) FROM songs").fetchone()[0] == before


def test_where_the_library_lives_is_worked_out_for_older_libraries(tmp_path):
    root, conn, _report = _library(tmp_path)
    assert library_folders(conn) == [root.resolve()]


def test_folders_scanned_on_purpose_are_remembered(tmp_path):
    root, conn, _report = _library(tmp_path)
    db.set_preference(conn, "library_folders", [str(root), str(tmp_path / "other")])
    assert library_folders(conn) == [root, tmp_path / "other"]


def test_an_empty_library_has_nowhere_to_watch(tmp_path):
    conn = db.connect(tmp_path / "empty.sqlite")
    assert library_folders(conn) == []

