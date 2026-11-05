"""Walk a music folder, read tags, and set aside what isn't music.

Nothing is deleted or hidden for good. Every decision carries a reason, and a person's override
in `music_override` always wins and survives a rescan.
"""

from __future__ import annotations

import re
import sqlite3
import unicodedata
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from statistics import median

import mutagen

from selecta import db

AUDIO_EXTENSIONS = {".mp3", ".flac", ".m4a", ".aac", ".ogg", ".opus", ".wav", ".aiff", ".aif"}
LOSSLESS_EXTENSIONS = {".flac", ".wav", ".aiff", ".aif"}

MAX_SONG_SECONDS = 15 * 60
MIN_SONG_SECONDS = 45
SPOKEN_FOLDER_SHARE = 0.4

_SPOKEN_GENRE = re.compile(
    r"audio\s*book|audiobook|spoken|speech|podcast|lecture|h[öo]rbuch|audiolibro|livre audio",
    re.IGNORECASE,
)
_SPOKEN_PATH = re.compile(
    r"audio\s*books?|audiobook|\blectures?\b|\bread by\b|\bnarrated\b|\bunabridged\b",
    re.IGNORECASE,
)
_SPOKEN_NAME = re.compile(r"\bchapter\b|\bchap\.?\s*\d|\bprologue\b|\bepilogue\b", re.IGNORECASE)

_TITLE_NOISE = re.compile(
    r"[\(\[][^\)\]]*(feat|ft\.|with |remaster|radio|explicit|clean|version|edit|bonus|single|"
    r"from |mono|stereo|deluxe|original|official|audio|video|mix\b)[^\)\]]*[\)\]]",
    re.IGNORECASE,
)
_FEAT_TAIL = re.compile(r"\s+(feat\.?|ft\.?|featuring)\s+.*$", re.IGNORECASE)
_ARTIST_SPLIT = re.compile(
    r"\s*(,|&|;|/|\bfeat\.?\b|\bft\.?\b|\bfeaturing\b|\bx\b|\band\b)\s*", re.IGNORECASE
)


@dataclass
class ScanReport:
    root: Path
    found: int = 0
    new_or_changed: int = 0
    removed: int = 0
    music: int = 0
    duplicates: int = 0
    set_aside: dict[str, int] = field(default_factory=lambda: defaultdict(int))
    unreadable: list[str] = field(default_factory=list)


def _first(tags, *keys: str) -> str | None:
    if tags is None:
        return None
    for key in keys:
        value = tags.get(key)
        if value:
            first = value[0] if isinstance(value, list | tuple) else value
            text = str(first).strip()
            if text:
                return text
    return None


def read_file(path: Path) -> dict | None:
    """Read tags and stream info, or return None if the file can't be read as audio."""
    try:
        audio = mutagen.File(path, easy=True)
    except Exception:
        return None
    if audio is None or audio.info is None:
        return None
    stat = path.stat()
    info = audio.info
    return {
        "path": str(path),
        "size": stat.st_size,
        "mtime": stat.st_mtime,
        "duration": float(getattr(info, "length", 0.0) or 0.0),
        "artist": _first(audio.tags, "artist", "albumartist"),
        "title": _first(audio.tags, "title") or path.stem,
        "album": _first(audio.tags, "album"),
        "genre": _first(audio.tags, "genre"),
        "year": _first(audio.tags, "date", "year"),
        "bitrate": int(getattr(info, "bitrate", 0) or 0) or None,
        "sample_rate": int(getattr(info, "sample_rate", 0) or 0) or None,
        "lossless": int(path.suffix.lower() in LOSSLESS_EXTENSIONS),
    }


def spoken_signal(song: dict, has_subtitles: bool) -> str | None:
    if song.get("genre") and _SPOKEN_GENRE.search(song["genre"]):
        return "tagged as spoken word"
    if _SPOKEN_PATH.search(song["path"]):
        return "folder looks like an audiobook or lecture"
    if has_subtitles:
        return "has a subtitle file"
    if _SPOKEN_NAME.search(song.get("title") or "") or _SPOKEN_NAME.search(Path(song["path"]).stem):
        return "named like a chapter"
    return None


def classify(songs: list[dict], subtitled: set[str], root: Path) -> None:
    """Fill in is_music and set_aside_reason, voting by top-level folder."""
    by_folder: dict[str, list[dict]] = defaultdict(list)
    for song in songs:
        by_folder[song["folder"]].append(song)

    for members in by_folder.values():
        signals = [spoken_signal(s, s["path"] in subtitled) for s in members]
        share = sum(bool(s) for s in signals) / len(members)
        typical_length = median(s["duration"] for s in members)
        folder_spoken = share >= SPOKEN_FOLDER_SHARE or (
            len(members) >= 3 and typical_length > MAX_SONG_SECONDS
        )
        folder_reason = next((s for s in signals if s), "long files, probably spoken word")
        for song, signal in zip(members, signals, strict=True):
            reason = None
            if signal:
                reason = signal
            elif folder_spoken:
                reason = folder_reason
            elif song["duration"] > MAX_SONG_SECONDS:
                reason = "longer than 15 minutes"
            elif song["duration"] < MIN_SONG_SECONDS:
                reason = "shorter than 45 seconds"
            song["is_music"] = int(reason is None)
            song["set_aside_reason"] = reason


def _strip_accents(text: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFKD", text) if not unicodedata.combining(c))


def identity(artist: str | None, title: str | None) -> str:
    """A normalised artist and title, for spotting the same song in two compilations."""
    clean_title = _TITLE_NOISE.sub(" ", title or "")
    clean_title = _FEAT_TAIL.sub("", clean_title)
    clean_title = re.sub(r"[^a-z0-9]+", " ", _strip_accents(clean_title).lower()).strip()
    lead = _ARTIST_SPLIT.split(artist or "")[0]
    clean_artist = re.sub(r"[^a-z0-9]+", " ", _strip_accents(lead).lower()).strip()
    return f"{clean_artist}|{clean_title}"


def mark_duplicates(conn: sqlite3.Connection) -> int:
    """Keep the best copy of each song: lossless first, then bitrate."""
    rows = conn.execute(
        "SELECT id, artist, title, duration, lossless, bitrate, path FROM songs WHERE is_music = 1"
    ).fetchall()
    groups: dict[str, list[sqlite3.Row]] = defaultdict(list)
    for row in rows:
        groups[identity(row["artist"], row["title"])].append(row)

    conn.execute("UPDATE songs SET duplicate_of = NULL")
    count = 0
    for key, members in groups.items():
        if len(members) < 2 or key.endswith("|"):
            continue
        members.sort(key=lambda r: (-r["lossless"], -(r["bitrate"] or 0), r["path"]))
        keepers: list[sqlite3.Row] = []
        for row in members:
            match = next((k for k in keepers if abs(k["duration"] - row["duration"]) <= 3.0), None)
            if match is None:
                keepers.append(row)
            else:
                conn.execute(
                    "UPDATE songs SET duplicate_of = ? WHERE id = ?", (match["id"], row["id"])
                )
                count += 1
    return count


def scan_folder(conn: sqlite3.Connection, root: Path) -> ScanReport:
    root = root.resolve()
    report = ScanReport(root=root)
    known = db.known_files(conn)

    files: list[Path] = []
    subtitled: set[str] = set()
    for path in sorted(root.rglob("*")):
        if not path.is_file():
            continue
        suffix = path.suffix.lower()
        if suffix in AUDIO_EXTENSIONS:
            files.append(path)
        elif suffix == ".srt":
            subtitled.update(str(path.with_suffix(ext)) for ext in AUDIO_EXTENSIONS)
    report.found = len(files)

    songs: list[dict] = []
    seen: set[str] = set()
    for path in files:
        key = str(path)
        seen.add(key)
        stat = path.stat()
        if known.get(key) == (stat.st_size, stat.st_mtime):
            row = conn.execute("SELECT * FROM songs WHERE path = ?", (key,)).fetchone()
            songs.append(dict(row))
            continue
        song = read_file(path)
        if song is None:
            report.unreadable.append(key)
            continue
        relative = path.relative_to(root)
        song["folder"] = relative.parts[0] if len(relative.parts) > 1 else "."
        songs.append(song)
        report.new_or_changed += 1

    classify(songs, subtitled, root)

    for song in songs:
        override = song.get("music_override")
        if override is not None:
            song["is_music"] = int(override)
            song["set_aside_reason"] = None if override else "you set this aside"
        record = {
            k: v for k, v in song.items() if k not in {"id", "duplicate_of", "music_override"}
        }
        db.upsert_song(conn, record)
        if song["is_music"]:
            report.music += 1
        else:
            report.set_aside[song["set_aside_reason"] or "set aside"] += 1

    root_text = str(root)
    for gone in set(known) - seen:
        if gone.startswith(root_text):
            conn.execute("DELETE FROM songs WHERE path = ?", (gone,))
            report.removed += 1

    report.duplicates = mark_duplicates(conn)
    conn.commit()
    return report


def set_aside_summary(conn: sqlite3.Connection) -> list[sqlite3.Row]:
    return conn.execute(
        "SELECT folder, COUNT(*) AS files, MIN(set_aside_reason) AS reason "
        "FROM songs WHERE is_music = 0 GROUP BY folder ORDER BY files DESC"
    ).fetchall()
