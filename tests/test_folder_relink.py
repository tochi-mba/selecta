"""Re-linking a music folder that moved: only verified recordings move, and only their paths change.

Song IDs, ratings, drafts and analysis stay attached to the same recordings, and no music file is
ever opened for writing.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf
from fastapi.testclient import TestClient
from mutagen.flac import FLAC

from selecta import db
from selecta.api import create_app
from selecta.config import Settings
from selecta.library.relink import RelinkError, commit_relink, preview_relink


def _song(path: Path, title: str, artist: str = "Someone", seconds: float = 30.0) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    sf.write(path, np.zeros((int(seconds * 100), 2)), 100, format="FLAC", subtype="PCM_16")
    tags = FLAC(path)
    tags["title"], tags["artist"] = title, artist
    tags.save()


def _record(conn, song_id: int, path: Path) -> None:
    tags = FLAC(path)
    conn.execute(
        "INSERT INTO songs(id,path,folder,size,mtime,duration,artist,title,is_music) "
        "VALUES(?,?,?,?,?,?,?,?,1)",
        (
            song_id,
            str(path),
            str(path.parent),
            path.stat().st_size,
            1.0,
            tags.info.length,
            tags["artist"][0],
            tags["title"][0],
        ),
    )


def _library(tmp_path: Path):
    """Two recordings in Music/old, recorded and rated, then the folder is moved to Music/new."""
    old = tmp_path / "Music" / "old"
    new = tmp_path / "Music" / "new"
    _song(old / "a.flac", "Café del Mar")
    _song(old / "Album" / "b.flac", "Second", artist="Other")
    conn = db.connect(tmp_path / "selecta.sqlite")
    _record(conn, 7, old / "a.flac")
    _record(conn, 9, old / "Album" / "b.flac")
    conn.execute("INSERT INTO ratings(song_a,song_b,method,rating) VALUES(7,9,'blend',5)")
    conn.execute(
        "INSERT INTO drafts(name,items) VALUES('Set',?)",
        (json.dumps([{"song_id": 7}, {"song_id": 9}]),),
    )
    db.set_preference(conn, "library_folders", [str(old)])
    conn.commit()
    old.rename(new)
    return conn, old, new


def _hashes(root: Path) -> dict[str, str]:
    return {
        str(p.relative_to(root)): hashlib.sha256(p.read_bytes()).hexdigest()
        for p in root.rglob("*.flac")
    }


def test_a_moved_folder_is_previewed_then_relinked_keeping_every_id(tmp_path):
    conn, old, new = _library(tmp_path)
    audio = _hashes(new)

    preview = preview_relink(conn, str(old), str(new))
    assert preview["total"] == preview["verified"] == 2
    assert preview["blocked"] == 0
    assert {c["status"] for c in preview["candidates"]} == {"verified"}
    assert preview["token"]

    result = commit_relink(conn, str(old), str(new), preview["token"])
    assert result == {"moved": 2, "folder": str(new.resolve()), "status": "relinked"}
    paths = dict(conn.execute("SELECT id,path FROM songs").fetchall())
    assert Path(paths[7]) == new.resolve() / "a.flac"
    assert Path(paths[9]) == new.resolve() / "Album" / "b.flac"
    assert [tuple(row) for row in conn.execute("SELECT song_a,song_b FROM ratings")] == [(7, 9)]
    assert json.loads(conn.execute("SELECT items FROM drafts").fetchone()[0]) == [
        {"song_id": 7},
        {"song_id": 9},
    ]
    assert db.preference(conn, "library_folders", []) == [str(new.resolve())]
    assert _hashes(new) == audio


def test_a_folder_that_is_still_there_does_not_need_relinking(tmp_path):
    conn, old, new = _library(tmp_path)
    old.mkdir(parents=True)
    with pytest.raises(RelinkError, match="still available"):
        preview_relink(conn, str(old), str(new))


def test_only_a_watched_folder_can_be_relinked(tmp_path):
    conn, _old, new = _library(tmp_path)
    with pytest.raises(RelinkError, match="previously watched"):
        preview_relink(conn, str(tmp_path / "Somewhere" / "else"), str(new))


@pytest.mark.parametrize(
    "bad", ["", "relative/folder", "\\\\server\\share\\music", "//server/share"]
)
def test_network_and_relative_addresses_are_refused(tmp_path, bad):
    conn, old, _new = _library(tmp_path)
    with pytest.raises(RelinkError):
        preview_relink(conn, str(old), bad)


def test_a_missing_file_blocks_the_whole_move(tmp_path):
    conn, old, new = _library(tmp_path)
    (new / "Album" / "b.flac").unlink()
    preview = preview_relink(conn, str(old), str(new))
    assert preview["verified"] == 1 and preview["blocked"] == 1
    assert preview["token"] is None
    assert {c["id"]: c["status"] for c in preview["candidates"]}[9] == "not_found_or_unsafe"
    with pytest.raises(RelinkError):
        commit_relink(conn, str(old), str(new), "f" * 64)
    assert Path(conn.execute("SELECT path FROM songs WHERE id=7").fetchone()[0]).parent == old


def test_a_different_recording_in_the_same_place_is_not_assumed_to_be_the_same(tmp_path):
    conn, old, new = _library(tmp_path)
    _song(new / "a.flac", "A cover version")
    preview = preview_relink(conn, str(old), str(new))
    assert {c["id"]: c["status"] for c in preview["candidates"]}[7] == "identity_not_verified"
    assert preview["token"] is None


def test_a_path_already_used_by_another_song_is_a_collision(tmp_path):
    conn, old, new = _library(tmp_path)
    conn.execute(
        "INSERT INTO songs(id,path,folder,size,mtime,duration,artist,title,is_music) "
        "VALUES(11,?,?,1,1.0,30.0,'X','Y',1)",
        (str(new.resolve() / "a.flac"), str(new)),
    )
    conn.commit()
    preview = preview_relink(conn, str(old), str(new))
    assert {c["id"]: c["status"] for c in preview["candidates"]}[7] == "already_in_library"
    assert preview["token"] is None


def test_a_change_after_preview_means_previewing_again_and_nothing_moves(tmp_path):
    conn, old, new = _library(tmp_path)
    token = preview_relink(conn, str(old), str(new))["token"]
    _song(new / "Album" / "b.flac", "Second", artist="Other", seconds=40.0)
    with pytest.raises(RelinkError):
        commit_relink(conn, str(old), str(new), token)
    assert all(Path(p).is_relative_to(old) for (p,) in conn.execute("SELECT path FROM songs"))


def test_a_token_that_was_never_previewed_is_refused(tmp_path):
    conn, old, new = _library(tmp_path)
    with pytest.raises(RelinkError, match="Preview"):
        commit_relink(conn, str(old), str(new), "short")


def test_a_symbolic_link_target_is_refused(tmp_path):
    conn, old, new = _library(tmp_path)
    link = tmp_path / "Music" / "linked"
    try:
        link.symlink_to(new, target_is_directory=True)
    except OSError:
        pytest.skip("this account can't make symbolic links")
    with pytest.raises(RelinkError, match="symbolic link"):
        preview_relink(conn, str(old), str(link))


# ---- the same through the local API


@pytest.fixture
def client_and_paths(tmp_path):
    conn, old, new = _library(tmp_path)
    conn.close()
    settings = Settings(tmp_path)
    return TestClient(create_app(settings, tmp_path / "no-web")), old, new


def test_the_api_previews_and_relinks_from_this_computer(client_and_paths):
    client, old, new = client_and_paths
    preview = client.post("/api/folders/relink/preview", json={"old": str(old), "new": str(new)})
    assert preview.status_code == 200
    token = preview.json()["token"]
    done = client.post(
        "/api/folders/relink", json={"old": str(old), "new": str(new), "token": token}
    )
    assert done.status_code == 200
    assert done.json()["moved"] == 2
    folders = client.get("/api/folders").json()["folders"]
    assert folders == [{"path": str(new.resolve()), "available": True, "songs": 2}]


def test_the_api_refuses_another_site_and_explains_a_refusal(client_and_paths):
    client, old, new = client_and_paths
    body = {"old": str(old), "new": str(new)}
    elsewhere = client.post(
        "/api/folders/relink/preview", json=body, headers={"origin": "https://evil.example"}
    )
    assert elsewhere.status_code == 403
    cross = client.post(
        "/api/folders/relink",
        json={**body, "token": "a" * 64},
        headers={"sec-fetch-site": "cross-site"},
    )
    assert cross.status_code == 403
    stale = client.post("/api/folders/relink", json={**body, "token": "a" * 64})
    assert stale.status_code == 409
    assert "Preview it again" in stale.json()["detail"]
