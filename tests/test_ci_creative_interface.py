"""CI-0178-02: the first-run folder check answers every reason a folder can't be used, reads
nothing into the library, and leaves the folder free to be tried again."""

from __future__ import annotations

import os

from selecta import db
from selecta.config import Settings
from selecta.library.folder_check import check_folder


def _songs(conn) -> int:
    return conn.execute("SELECT COUNT(*) FROM songs").fetchone()[0]


def test_every_unusable_folder_has_its_own_reason_and_nothing_is_read(tmp_path, monkeypatch):
    settings = Settings(tmp_path)
    music = tmp_path / "music"
    music.mkdir()
    (music / "song.flac").write_bytes(b"never decoded by the check")
    conn = db.connect(settings.db_path)
    try:
        assert check_folder(conn, "")["kind"] == "missing"
        assert check_folder(conn, str(tmp_path / "not-there"))["kind"] == "missing"
        assert check_folder(conn, str(music / "song.flac"))["kind"] == "not_a_folder"

        real_scandir = os.scandir

        def refused(path, *args, **kwargs):
            if str(path) == str(music.resolve()):
                raise PermissionError("no access")
            return real_scandir(path, *args, **kwargs)

        monkeypatch.setattr(os, "scandir", refused)
        answer = check_folder(conn, str(music))
        assert answer["kind"] == "no_access"
        assert answer["ok"] is False
        monkeypatch.setattr(os, "scandir", real_scandir)

        # once the cause is fixed the same folder is simply fine, with nothing read in the meantime
        answer = check_folder(conn, f'  "{music}"  ')
        assert answer["kind"] == "ok"
        assert answer["audio_files"] == 1
        assert _songs(conn) == 0
    finally:
        conn.close()
