"""Conservative, non-destructive relocation of an existing watched music folder.

A relink changes only paths of verified records, never file bytes or song IDs.
The preview and commit share validation and a fingerprint of the candidate set.
"""
from __future__ import annotations

import hashlib
import json
import sqlite3
from pathlib import Path

from selecta import db
from selecta.library.scan import library_folders, read_file
from selecta.library.relevance import normalize_music

MAX_RELINK_SONGS = 50000


class RelinkError(ValueError):
    pass


def _local_root(value: str, must_exist: bool) -> Path:
    if not value.strip() or "\x00" in value or value.startswith(("\\\\", "//")):
        raise RelinkError("Choose a local music folder, not a network address.")
    candidate = Path(value).expanduser()
    if not candidate.is_absolute():
        raise RelinkError("Use an absolute folder address.")
    if must_exist and (candidate.is_symlink() or not candidate.is_dir()):
        raise RelinkError("The new folder must exist and cannot be a symbolic link.")
    return candidate.resolve(strict=must_exist)


def preview_relink(conn: sqlite3.Connection, old: str, new: str) -> dict:
    old_root = _local_root(old, must_exist=False)
    new_root = _local_root(new, must_exist=True)
    if old_root == new_root or old_root.is_dir():
        raise RelinkError("The original folder is still available. No relocation is needed.")
    watched = {folder.resolve(strict=False) for folder in library_folders(conn)}
    if old_root not in watched:
        raise RelinkError("Only a previously watched music folder can be re-linked.")
    rows = [
        row for row in conn.execute(
            "SELECT id,path,size,duration,title,artist FROM songs ORDER BY id"
        )
        if Path(row["path"]).is_relative_to(old_root)
    ]
    if not rows:
        raise RelinkError("No recorded songs belong to that folder.")
    if len(rows) > MAX_RELINK_SONGS:
        raise RelinkError("Too many songs for one safe relocation.")
    used = {row["path"]: row["id"] for row in conn.execute("SELECT id,path FROM songs")}
    candidates: list[dict] = []
    accepted: list[dict] = []
    for row in rows:
        relative = Path(row["path"]).relative_to(old_root)
        target = new_root / relative
        state = "verified"
        stat = None
        if not target.is_file() or target.is_symlink() or not target.resolve().is_relative_to(new_root):
            state = "not_found_or_unsafe"
        elif used.get(str(target)) not in (None, row["id"]):
            state = "already_in_library"
        else:
            try:
                stat = target.stat()
                tags = read_file(target)
                if (
                    stat.st_size != row["size"] or tags is None
                    or abs(tags["duration"] - row["duration"]) > 1.5
                    or normalize_music(tags.get("title") or "") != normalize_music(row["title"] or "")
                    or normalize_music(tags.get("artist") or "") != normalize_music(row["artist"] or "")
                ):
                    state = "identity_not_verified"
            except OSError:
                state = "unreadable"
        entry = {
            "id": row["id"],
            "title": row["title"],
            "artist": row["artist"],
            "status": state,
        }
        candidates.append(entry)
        if state == "verified" and stat is not None:
            accepted.append({
                "id": row["id"], "old": row["path"], "new": str(target),
                "size": stat.st_size, "mtime": stat.st_mtime_ns,
            })
    # Never expose an unsafe/partly identified remap as a commit-able preview.
    token = hashlib.sha256(json.dumps(accepted, sort_keys=True).encode("utf-8")).hexdigest()
    return {
        "from": str(old_root),
        "to": str(new_root),
        "total": len(rows),
        "verified": len(accepted),
        "blocked": len(rows) - len(accepted),
        "candidates": candidates,
        "token": token if len(accepted) == len(rows) else None,
    }


def commit_relink(conn: sqlite3.Connection, old: str, new: str, token: str) -> dict:
    if len(token) != 64:
        raise RelinkError("Preview this move before confirming it.")
    preview = preview_relink(conn, old, new)
    if not preview["token"] or preview["token"] != token:
        raise RelinkError("The folder or its recordings changed. Preview it again.")
    old_root = Path(preview["from"])
    new_root = Path(preview["to"])
    # Check inside the write transaction too, so no concurrent library scan
    # can change recorded paths or IDs between preview and commit.
    try:
        conn.execute("BEGIN IMMEDIATE")
        refreshed = preview_relink(conn, old, new)
        if refreshed["token"] != token:
            raise RelinkError("The library changed. Preview it again.")
        for row in conn.execute("SELECT id,path FROM songs").fetchall():
            source = Path(row["path"])
            if not source.is_relative_to(old_root):
                continue
            new_path = new_root / source.relative_to(old_root)
            conn.execute(
                "UPDATE songs SET path=? WHERE id=? AND path=?",
                (str(new_path), row["id"], row["path"]),
            )
        before = db.preference(conn, "library_folders", None)
        if before is None:
            before = [str(folder) for folder in library_folders(conn)]
        after = [str(new_root) if Path(folder).resolve(strict=False) == old_root else folder for folder in before]
        conn.execute(
            "INSERT INTO preferences(key,value) VALUES('library_folders',?) "
            "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            (json.dumps(list(dict.fromkeys(after))),),
        )
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    return {"moved": preview["verified"], "folder": str(new_root), "status": "relinked"}
