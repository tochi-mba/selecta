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

from selecta import db, longpaths
from selecta.engine_store import library_rows, library_writes
from selecta.planner_core.names import ARTIST_SPLIT

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
SCAN_STATE_KEY = "scan_in_progress"
"""library.scan_resume: the folder being read and how far it got, kept until the scan finishes.
Left behind after a restart, it means the scan was interrupted and should carry on."""
CHECKPOINT_EVERY = 200
"""With checkpoints on, newly read songs are saved in batches of this many."""

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
# one rule for where an artist credit splits, shared with the planner core's artist spacing
_ARTIST_SPLIT = ARTIST_SPLIT


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
    # the files read this time (new or changed), so their covers can be read once the scan is done
    # (library/art.py, ADR-0478) without slowing the scan itself
    fresh: list[str] = field(default_factory=list)


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
        audio = mutagen.File(longpaths.os_path(path), easy=True)
    except Exception:
        return None
    if audio is None or audio.info is None:
        return None
    stat = longpaths.stat(path)
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


def _duplicate_pairs(rows: list) -> list[tuple[int, int]]:
    """(duplicate, kept) for each music row that is another copy of a song, in marking order."""
    groups: dict[str, list] = defaultdict(list)
    for row in rows:
        groups[identity(row["artist"], row["title"])].append(row)
    pairs: list[tuple[int, int]] = []
    for key, members in groups.items():
        if len(members) < 2 or key.endswith("|"):
            continue
        members.sort(key=lambda r: (-r["lossless"], -(r["bitrate"] or 0), r["path"]))
        keepers: list = []
        for row in members:
            match = next((k for k in keepers if abs(k["duration"] - row["duration"]) <= 3.0), None)
            if match is None:
                keepers.append(row)
            else:
                pairs.append((row["id"], match["id"]))
    return pairs


def mark_duplicates(conn: sqlite3.Connection) -> int:
    """Keep the best copy of each song: lossless first, then bitrate."""
    store = library_rows.store_path(conn)
    if store is not None:
        return library_writes.mark_duplicates(store, _duplicate_pairs)
    rows = conn.execute(
        "SELECT id, artist, title, duration, lossless, bitrate, path FROM songs WHERE is_music = 1"
    ).fetchall()
    conn.execute("UPDATE songs SET duplicate_of = NULL")
    pairs = _duplicate_pairs(rows)
    for duplicate, kept in pairs:
        conn.execute("UPDATE songs SET duplicate_of = ? WHERE id = ?", (kept, duplicate))
    return len(pairs)


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
    for path in longpaths.walk_files(root):
        if path.suffix.lower() in AUDIO_EXTENSIONS:
            try:
                stat = longpaths.stat(path)
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
    with library_rows.reading(conn) as source:
        known = {
            row["path"]: (row["size"], row["mtime"])
            for row in source.execute("SELECT path,size,mtime FROM songs")
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
    with library_rows.reading(conn) as source:
        paths = [
            row[0] for row in source.execute("SELECT path FROM songs WHERE is_music = 1 LIMIT 5000")
        ]
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
    """Someone asked for this scan to stop. Without checkpoints nothing's been written yet; with
    them, songs already read are kept (they are real songs) and nothing is removed."""


def interrupted_scan(conn: sqlite3.Connection) -> dict | None:
    """The scan a restart should carry on, if one was cut off: folder, files read, files found."""
    state = db.preference(conn, SCAN_STATE_KEY, None)
    if not isinstance(state, dict) or state.get("state") != "scanning" or not state.get("folder"):
        return None
    return state


def forget_interrupted_scan(conn: sqlite3.Connection) -> None:
    store = library_rows.store_path(conn)
    if store is not None:
        library_writes.forget_preference(store, SCAN_STATE_KEY)
        return
    conn.execute("DELETE FROM preferences WHERE key = ?", (SCAN_STATE_KEY,))
    conn.commit()


def _note_progress(conn: sqlite3.Connection, root: Path, found: int | None, done: int) -> None:
    db.set_preference(
        conn,
        SCAN_STATE_KEY,
        {"state": "scanning", "folder": str(root), "found": found, "done": done, "at": time.time()},
    )


def _save_batch(
    conn: sqlite3.Connection, batch: list[dict], subtitled: set[str], root: Path
) -> None:
    """Newly read songs saved before the scan ends, so a restart doesn't read them again. Their
    set-aside votes are provisional: the scan's last step classifies the whole folder again."""
    classify(batch, subtitled, root)
    store = library_rows.store_path(conn)
    if store is not None:
        library_writes.upsert_songs(
            store,
            [{k: v for k, v in song.items() if k not in SCAN_KEEPS_OUT} for song in batch],
        )
        return
    for song in batch:
        db.upsert_song(
            conn,
            {k: v for k, v in song.items() if k not in {"id", "duplicate_of", "music_override"}},
        )


SCAN_KEEPS_OUT = {"id", "duplicate_of", "music_override"}
"""What a scan never writes back: the row's id, its duplicate mark (set again at the end) and a
person's choice."""
UNCHANGED_KEEPS_OUT = SCAN_KEEPS_OUT | {
    "processing_priority",
    "content_hash",
    "audio_id",
    "workspace_id",
}
"""Through the store, an unchanged file's row also leaves out what other writers own (a song's
priority, its hashes): the scan would only write back the values it read, which a priority set or
an analysis saved during the scan could have changed since."""


def _tell(progress: Callable[[int, int], None] | None, done: int, found: int) -> None:
    """Pass progress on. A listener that fails is a display problem, never the scan's."""
    if progress is None:
        return
    try:
        progress(done, found)
    except Exception:  # noqa: BLE001 - showing progress can never stop a scan
        return


def _listing(root: Path, should_stop: Callable[[], bool]) -> Iterator[Path]:
    # files only, in ordinary form, reaching folders past Windows' old 260-character limit
    for path in longpaths.walk_files(root):
        if should_stop():
            raise ScanStopped
        yield path


def scan_folder(
    conn: sqlite3.Connection,
    root: Path,
    careful: bool = False,
    should_stop: Callable[[], bool] = lambda: False,
    checkpoint: bool = False,
    progress: Callable[[int, int], None] | None = None,
) -> ScanReport:
    """Read a folder into the library. All the slow reading comes before any of the writing, and
    that's where it can be stopped, so stopping leaves the library exactly as it was.

    With `checkpoint` (library.scan_resume) the folder and a `scanning` state are remembered at
    the start, and newly read songs are saved in batches, so a scan cut off by a restart carries
    on: files already saved match on size and time and are not read again. Songs that have gone
    are only removed at the very end, so a partial scan never removes anything.

    `progress`, when given, is told how many files have been looked at and how many there
    are, once the folder has been listed and after each file, so a page or a terminal can show
    real progress. Whatever it does, it never stops or slows the scan."""
    root = root.resolve()
    if not checkpoint:
        return _scan(conn, root, careful, should_stop, False, progress)
    _note_progress(conn, root, None, 0)
    try:
        report = _scan(conn, root, careful, should_stop, True, progress)
    except ScanStopped:
        conn.commit()  # songs read so far stay; a stop asked for is not an interruption
        forget_interrupted_scan(conn)
        raise
    forget_interrupted_scan(conn)
    return report


def _scan(
    conn: sqlite3.Connection,
    root: Path,
    careful: bool,
    should_stop: Callable[[], bool],
    checkpoint: bool,
    progress: Callable[[int, int], None] | None = None,
) -> ScanReport:
    report = ScanReport(root=root)
    store = library_rows.store_path(conn)
    known = db.known_files(conn)

    files: list[Path] = []
    subtitled: set[str] = set()
    for path in sorted(_listing(root, should_stop)):
        if not longpaths.is_file(path):
            continue
        suffix = path.suffix.lower()
        if suffix in AUDIO_EXTENSIONS:
            files.append(path)
        elif suffix == ".srt":
            subtitled.update(str(path.with_suffix(ext)) for ext in AUDIO_EXTENSIONS)
    report.found = len(files)
    if checkpoint:
        _note_progress(conn, root, report.found, 0)
    _tell(progress, 0, report.found)

    songs: list[dict] = []
    batch: list[dict] = []
    seen: set[str] = set()
    now = time.time()
    # a file that can't be read isn't read again until it changes, or someone asks for a full look,
    # or it would set off a scan of the whole folder every minute for ever
    tried = db.preference(conn, "unreadable_files", {})
    unreadable: dict[str, list] = {}
    for done, path in enumerate(files):
        if should_stop():
            raise ScanStopped
        if done:
            _tell(progress, done, report.found)
        if checkpoint and len(batch) >= CHECKPOINT_EVERY:
            _save_batch(conn, batch, subtitled, root)
            batch = []
            _note_progress(conn, root, report.found, done)  # commits the batch with it
        key = str(path)
        seen.add(key)
        try:
            stat = longpaths.stat(path)
        except OSError:
            continue  # a download moving it into place, so it'll be there next time
        arriving = now - stat.st_mtime < SETTLE_SECONDS
        if careful and arriving and known.get(key) != (stat.st_size, stat.st_mtime):
            continue  # still being copied in, so it's read once it has finished
        if known.get(key) == (stat.st_size, stat.st_mtime):
            if store is not None:
                # read together after the loop, rather than one store read per file
                songs.append({"path": key, UNCHANGED: True})
                continue
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
        if checkpoint:
            batch.append(song)
        report.new_or_changed += 1
        report.fresh.append(key)

    _tell(progress, report.found, report.found)
    if store is not None:
        return _finish_through_store(
            store, report, root, songs, subtitled, known, seen, files, careful, unreadable
        )
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
    with library_rows.reading(conn) as source:
        return source.execute(
            "SELECT folder, COUNT(*) AS files, MIN(set_aside_reason) AS reason "
            "FROM songs WHERE is_music = 0 GROUP BY folder ORDER BY files DESC"
        ).fetchall()


UNCHANGED = "\x00unchanged"
"""Marks an unchanged file's place in the scan's list until its stored row is read."""


def _finish_through_store(
    store,
    report: ScanReport,
    root: Path,
    songs: list[dict],
    subtitled: set[str],
    known: dict,
    seen: set[str],
    files: list,
    careful: bool,
    unreadable: dict,
) -> ScanReport:
    """The scan's writing through the engine store (core.engine_store): the same rows as the old
    path, in short writes of `library_writes.SCAN_BATCH` songs, never one for the whole scan. A
    stop or a crash between writes leaves every saved song whole, and the next scan finds them
    unchanged and carries on."""
    marked = [song["path"] for song in songs if song.get(UNCHANGED)]
    stored = library_writes.scanned_rows(store, marked)
    # a row removed since it was listed (by a relink, say) is simply not written back
    songs = [
        stored[song["path"]] if song.get(UNCHANGED) else song
        for song in songs
        if not song.get(UNCHANGED) or song["path"] in stored
    ]
    unchanged = {path for path in marked if path in stored}
    classify(songs, subtitled, root)
    records = [
        {
            k: v
            for k, v in song.items()
            if k not in (UNCHANGED_KEEPS_OUT if song["path"] in unchanged else SCAN_KEEPS_OUT)
        }
        for song in songs
    ]

    def settle(record: dict, override: int | None) -> None:
        # a person's choice wins, as read inside the write that saves the row
        if override is not None:
            record["is_music"] = int(override)
            record["set_aside_reason"] = None if override else "you set this aside"

    library_writes.save_scanned(store, records, unchanged, settle)
    for record in records:
        if record["is_music"]:
            report.music += 1
        else:
            report.set_aside[record["set_aside_reason"] or "set aside"] += 1
    root_text = str(root)
    missing = [gone for gone in set(known) - seen if _inside(gone, root_text)]
    within = sum(_inside(path, root_text) for path in known)
    if missing and (not files or (careful and len(missing) > within * MOST_THAT_CAN_GO)):
        report.held_back = len(missing)
        missing = []
    library_writes.forget_songs(store, missing)
    report.removed = len(missing)
    report.duplicates = library_writes.mark_duplicates(store, _duplicate_pairs)
    library_writes.set_preference(store, "unreadable_files", unreadable)
    return report
