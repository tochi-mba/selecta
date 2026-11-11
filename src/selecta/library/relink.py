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
from selecta.library.relevance import normalize_music
from selecta.library.scan import library_folders, read_file

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


def _references(conn: sqlite3.Connection, ids: set[int]) -> dict[str, int]:
    """GP-0252-03: what else points at these songs. A relink keeps every ID, so all of it keeps working,
    and the preview says so in numbers rather than asking someone to take it on trust."""
    if not ids:
        return {"current_mix": 0, "drafts": 0, "ratings": 0, "corrections": 0, "discoveries": 0}
    marks = ",".join("?" * len(ids))
    values = sorted(ids)
    in_drafts = 0
    for (items,) in conn.execute("SELECT items FROM drafts"):
        try:
            songs = [
                item.get("song_id") if isinstance(item, dict) else item[0]
                for item in json.loads(items or "[]")
            ]
            if any(song is not None and int(song) in ids for song in songs):
                in_drafts += 1
        except (TypeError, ValueError, LookupError):
            continue

    def count(sql: str, twice: bool = False) -> int:
        return int(conn.execute(sql, values + values if twice else values).fetchone()[0])

    return {
        "current_mix": count(f"SELECT COUNT(*) FROM queue WHERE song_id IN ({marks})"),  # noqa: S608
        "drafts": in_drafts,
        "ratings": count(
            f"SELECT COUNT(*) FROM ratings WHERE song_a IN ({marks}) OR song_b IN ({marks})",
            twice=True,
        ),  # noqa: S608
        "corrections": count(f"SELECT COUNT(*) FROM song_overrides WHERE song_id IN ({marks})"),  # noqa: S608
        "discoveries": count(
            f"SELECT COUNT(*) FROM seam_book WHERE song_a IN ({marks}) OR song_b IN ({marks})",
            twice=True,
        ),  # noqa: S608
    }


def _why_different(row: sqlite3.Row, size: int, tags: dict) -> str:
    """In plain words, what doesn't match, so a person can decide whether it is the same recording."""
    reasons = []
    if size != row["size"]:
        reasons.append("the file size changed")
    if abs(tags["duration"] - row["duration"]) > 1.5:
        reasons.append(f"its length differs by {abs(tags['duration'] - row['duration']):.0f} s")
    if normalize_music(tags.get("title") or "") != normalize_music(row["title"] or ""):
        reasons.append(f"its title now reads “{tags.get('title') or 'nothing'}”")
    if normalize_music(tags.get("artist") or "") != normalize_music(row["artist"] or ""):
        reasons.append(f"its artist now reads “{tags.get('artist') or 'nothing'}”")
    return ", ".join(reasons) or "its details changed"


def preview_relink(
    conn: sqlite3.Connection, old: str, new: str, confirmed: list[int] | None = None
) -> dict:
    """GP-0252-04: a recording whose file is readable but whose size, length or tags changed is never
    assumed to be the same one. It is shown with what differs, and only a person's explicit yes for
    that exact song ID lets it through. Missing, unsafe, unreadable or colliding files never can be."""
    yes = {int(song) for song in confirmed or []}
    old_root = _local_root(old, must_exist=False)
    new_root = _local_root(new, must_exist=True)
    if old_root == new_root or old_root.is_dir():
        raise RelinkError("The original folder is still available. No relocation is needed.")
    watched = {folder.resolve(strict=False) for folder in library_folders(conn)}
    if old_root not in watched:
        raise RelinkError("Only a previously watched music folder can be re-linked.")
    rows = [
        row
        for row in conn.execute("SELECT id,path,size,duration,title,artist FROM songs ORDER BY id")
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
        why = None
        if (
            not target.is_file()
            or target.is_symlink()
            or not target.resolve().is_relative_to(new_root)
        ):
            state = "not_found_or_unsafe"
        elif used.get(str(target)) not in (None, row["id"]):
            state = "already_in_library"
        else:
            try:
                stat = target.stat()
                tags = read_file(target)
                if tags is None:
                    state = "unreadable"
                elif (
                    stat.st_size != row["size"]
                    or abs(tags["duration"] - row["duration"]) > 1.5
                    or normalize_music(tags.get("title") or "")
                    != normalize_music(row["title"] or "")
                    or normalize_music(tags.get("artist") or "")
                    != normalize_music(row["artist"] or "")
                ):
                    why = _why_different(row, stat.st_size, tags)
                    state = "confirmed_by_you" if row["id"] in yes else "identity_not_verified"
            except OSError:
                state = "unreadable"
        entry = {
            "id": row["id"],
            "title": row["title"],
            "artist": row["artist"],
            "status": state,
        }
        if why:
            entry["why"] = why
            entry["can_confirm"] = True
        candidates.append(entry)
        if state in {"verified", "confirmed_by_you"} and stat is not None:
            accepted.append(
                {
                    "id": row["id"],
                    "old": row["path"],
                    "new": str(target),
                    "size": stat.st_size,
                    "mtime": stat.st_mtime_ns,
                    "confirmed": state == "confirmed_by_you",
                }
            )
    # Never expose an unsafe/partly identified remap as a commit-able preview.
    token = hashlib.sha256(json.dumps(accepted, sort_keys=True).encode("utf-8")).hexdigest()
    return {
        "from": str(old_root),
        "to": str(new_root),
        "total": len(rows),
        "verified": len(accepted),
        "blocked": len(rows) - len(accepted),
        "confirmed": sum(entry["confirmed"] for entry in accepted),
        "needs_confirmation": sum(
            entry["status"] == "identity_not_verified" for entry in candidates
        ),
        "references": _references(conn, {row["id"] for row in rows}),
        "candidates": candidates,
        "token": token if len(accepted) == len(rows) else None,
    }


def commit_relink(
    conn: sqlite3.Connection, old: str, new: str, token: str, confirmed: list[int] | None = None
) -> dict:
    if len(token) != 64:
        raise RelinkError("Preview this move before confirming it.")
    preview = preview_relink(conn, old, new, confirmed)
    if not preview["token"] or preview["token"] != token:
        raise RelinkError("The folder or its recordings changed. Preview it again.")
    old_root = Path(preview["from"])
    new_root = Path(preview["to"])
    # Check inside the write transaction too, so no concurrent library scan
    # can change recorded paths or IDs between preview and commit.
    try:
        conn.execute("BEGIN IMMEDIATE")
        refreshed = preview_relink(conn, old, new, confirmed)
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
        after = [
            str(new_root) if Path(folder).resolve(strict=False) == old_root else folder
            for folder in before
        ]
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
