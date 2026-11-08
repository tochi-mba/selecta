"""Walk a music folder, read tags, and set aside what isn't music.

Nothing is deleted or hidden for good. Every decision carries a reason, and a person's override
in `music_override` always wins and survives a rescan.
"""

from __future__ import annotations

import os
import re
import sqlite3
import time
import unicodedata
from collections import defaultdict
from collections.abc import Callable, Iterator
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
MOST_THAT_CAN_GO = 0.5
"""A look at the folder that isn't someone rescanning on purpose keeps songs if more than this share
have vanished at once, since that's a drive that's partly away more often than a clear-out."""
SETTLE_SECONDS = 30.0
"""A file changed more recently than this may still be being copied in."""
MISSING_WORDS = "the file has gone"

_SPOKEN_GENRE = re.compile(
    r"audio\s*book|audiobook|spoken|speech|podcast|lecture|h[öo]rbuch|audiolibro|livre audio",
    re.IGNORECASE,
)
_SPOKEN_PATH = re.compile(
    r"audio\s*books?|audiobook|\blectures?\b|\bread by\b|\bnarrated\b|\bunabridged\b",
    re.IGNORECASE,
)
_SPOKEN_NAME = re.compile(r"\bchapter\b|\bchap\.?\s*\d|\bprologue\b|\bepilogue\b", re.IGNORECASE)

# Identity must retain edition and mix qualifiers. A radio edit, live take,
# clean master or named remix is not safely interchangeable with the original.
# Remove only non-recording promotional labels and separately handled features.
_TITLE_NOISE = re.compile(
    r"[\(\[][^\)\]]*(feat(?:uring)?\b|ft\.|with |official\s+(?:audio|video)|"
    r"lyric\s+video)[^\)\]]*[\)\]]",
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
    held_back: int = 0


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


def _forget_song(conn: sqlite3.Connection, path: str) -> None:
    """A song whose file has gone. It leaves the mix, closing the gap, and its skips go with it.
    Anything else still pointing at it keeps it around, better than a scan that can't finish."""
    row = conn.execute("SELECT id FROM songs WHERE path = ?", (path,)).fetchone()
    if row is None:
        return
    song_id = row[0]
    try:
        conn.execute("DELETE FROM queue WHERE song_id = ?", (song_id,))
        left = [r[0] for r in conn.execute("SELECT position FROM queue ORDER BY position")]
        for index, position in enumerate(left):
            if index != position:
                conn.execute("UPDATE queue SET position = ? WHERE position = ?", (index, position))
        has_skips = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='playback_skips'"
        ).fetchone()
        if has_skips:
            conn.execute("DELETE FROM playback_skips WHERE song_id = ?", (song_id,))
        conn.execute("DELETE FROM songs WHERE id = ?", (song_id,))
    except sqlite3.IntegrityError:
        conn.execute(
            "UPDATE songs SET is_music = 0, set_aside_reason = ? WHERE id = ?",
            (MISSING_WORDS, song_id),
        )


def _audio_listing(root: Path) -> dict[str, tuple[int, float]]:
    listing = {}
    for folder, _subfolders, names in os.walk(root):
        for name in names:
            if Path(name).suffix.lower() in AUDIO_EXTENSIONS:
                path = Path(folder) / name
                try:
                    stat = path.stat()
                except OSError:
                    continue
                listing[str(path)] = (stat.st_size, stat.st_mtime)
    return listing


def folder_changed(conn: sqlite3.Connection, root: Path, now: float | None = None) -> bool:
    """Has anything come or gone since the last scan? It only reads the folder's listing, so it can
    be asked often. A file still being copied in waits until it has settled, and a folder that
    isn't there right now hasn't changed, it's just not there."""
    if not root.is_dir():
        return False
    root = root.resolve()
    listing = _audio_listing(root)
    now = time.time() if now is None else now
    known = {
        row["path"]: (row["size"], row["mtime"])
        for row in conn.execute("SELECT path,size,mtime FROM songs")
        if _inside(str(row["path"]), str(root))
    }
    if not listing and known:
        return False
    unreadable = db.preference(conn, "unreadable_files", {})
    changed = {
        path
        for path, facts in listing.items()
        if known.get(path) != facts and unreadable.get(path) != list(facts)
    }
    # only what has settled counts, so a long download can't hold back the songs that have finished
    settled = {path for path in changed if now - listing[path][1] >= SETTLE_SECONDS}
    return bool(settled or set(known) - set(listing))


def library_folders(conn: sqlite3.Connection) -> list[Path]:
    """The folders the library came from. Before these were remembered, it's where the songs are."""
    saved = db.preference(conn, "library_folders", [])
    if saved:
        return [Path(folder) for folder in saved]
    paths = [row[0] for row in conn.execute("SELECT path FROM songs WHERE is_music = 1 LIMIT 5000")]
    if not paths:
        return []
    try:
        common = Path(os.path.commonpath(paths))
    except ValueError:
        return []  # songs on different drives have nothing in common to watch
    return [common] if common.is_dir() else []


def _inside(path: str, root_text: str) -> bool:
    """A real parent folder, not just a name that starts the same, like Music and Music2."""
    return path.startswith(root_text.rstrip(os.sep) + os.sep)


class ScanStopped(Exception):
    """Someone asked for this scan to stop. Nothing's been written yet, so nothing is half done."""


def _listing(root: Path, should_stop: Callable[[], bool]) -> Iterator[Path]:
    for path in root.rglob("*"):
        if should_stop():
            raise ScanStopped
        yield path


def scan_folder(
    conn: sqlite3.Connection,
    root: Path,
    careful: bool = False,
    should_stop: Callable[[], bool] = lambda: False,
) -> ScanReport:
    """Read a folder into the library. All the slow reading comes before any of the writing, and
    that's where it can be stopped, so stopping leaves the library exactly as it was."""
    root = root.resolve()
    report = ScanReport(root=root)
    known = db.known_files(conn)

    files: list[Path] = []
    subtitled: set[str] = set()
    for path in sorted(_listing(root, should_stop)):
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
    now = time.time()
    # a file that can't be read isn't read again until it changes, or someone asks for a full look,
    # or it would set off a scan of the whole folder every minute for ever
    tried = db.preference(conn, "unreadable_files", {})
    unreadable: dict[str, list] = {}
    for path in files:
        if should_stop():
            raise ScanStopped
        key = str(path)
        seen.add(key)
        try:
            stat = path.stat()
        except OSError:
            continue  # a download moving it into place, so it'll be there next time
        arriving = now - stat.st_mtime < SETTLE_SECONDS
        if careful and arriving and known.get(key) != (stat.st_size, stat.st_mtime):
            continue  # still being copied in, so it's read once it has finished
        if known.get(key) == (stat.st_size, stat.st_mtime):
            row = conn.execute("SELECT * FROM songs WHERE path = ?", (key,)).fetchone()
            songs.append(dict(row))
            continue
        facts = [stat.st_size, stat.st_mtime]
        if careful and tried.get(key) == facts:
            unreadable[key] = facts
            report.unreadable.append(key)
            continue
        song = read_file(path)
        if song is None:
            unreadable[key] = facts
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
    missing = [gone for gone in set(known) - seen if _inside(gone, root_text)]
    # a whole folder vanishing is an unplugged drive, not someone deleting their music, and losing
    # every analysis to that would be far worse than keeping a few songs that are really gone
    within = sum(_inside(path, root_text) for path in known)
    if missing and (not files or (careful and len(missing) > within * MOST_THAT_CAN_GO)):
        report.held_back = len(missing)
        missing = []
    for gone in missing:
        _forget_song(conn, gone)
        report.removed += 1

    report.duplicates = mark_duplicates(conn)
    db.set_preference(conn, "unreadable_files", unreadable)
    conn.commit()
    return report


def set_aside_summary(conn: sqlite3.Connection) -> list[sqlite3.Row]:
    return conn.execute(
        "SELECT folder, COUNT(*) AS files, MIN(set_aside_reason) AS reason "
        "FROM songs WHERE is_music = 0 GROUP BY folder ORDER BY files DESC"
    ).fetchall()
