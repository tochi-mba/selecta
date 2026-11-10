"""What can be said about a folder before anyone reads it, in words someone can act on."""

from __future__ import annotations

import os
import sqlite3
from pathlib import Path

from selecta.library.scan import AUDIO_EXTENSIONS, library_folders

# enough to know there's music there, without a huge drive holding up the answer
MOST_AUDIO_COUNTED = 1000
MOST_FILES_LOOKED_AT = 20000


def _answer(kind: str, reason: str, path: str, audio_files: int | None = None) -> dict:
    return {
        "ok": kind == "ok",
        "kind": kind,
        "reason": reason,
        "path": path,
        "audio_files": audio_files,
    }


def count_audio(
    root: Path, most: int = MOST_AUDIO_COUNTED, look_at: int = MOST_FILES_LOOKED_AT
) -> int | None:
    """How many audio files there are, up to a limit. With nothing found by the time it stops
    looking it says it doesn't know, because that isn't the same as there being none."""
    found = 0
    looked = 0
    for _folder, _subfolders, names in os.walk(root):
        for name in names:
            looked += 1
            if Path(name).suffix.lower() in AUDIO_EXTENSIONS:
                found += 1
                if found >= most:
                    return found
            if looked >= look_at:
                return found or None
    return found


def has_any_file(root: Path, look_at: int = MOST_FILES_LOOKED_AT) -> bool:
    """Whether there's any file at all in here, so an empty folder isn't mistaken for one that
    only holds other kinds of file."""
    looked = 0
    for _folder, subfolders, names in os.walk(root):
        if names:
            return True
        looked += len(subfolders) + 1
        if looked >= look_at:
            return True
    return False


# characters no Windows folder name can hold, so a typed address with them can't be a real one
NOT_IN_A_PATH = set("<>|?*")


def _local_volume_root(address: str) -> str | None:
    """Only locally attached drives may be previewed; never network-mapped volumes."""
    if os.name != "nt":
        # Linux/macOS development and supported local installations: absolute paths.
        return os.sep
    drive, _ = os.path.splitdrive(address)
    if len(drive) != 2 or drive[1] != ":" or not drive[0].isalpha():
        return None
    # Windows: fixed, removable, optical and RAM disks. Exclude DRIVE_REMOTE.
    import ctypes

    root = drive + "\\"
    if ctypes.windll.kernel32.GetDriveTypeW(root) not in {2, 3, 5, 6}:
        return None
    return root


def check_folder(conn: sqlite3.Connection, typed: str) -> dict:
    """Would this folder work? This reads nothing into the library and changes nothing."""
    text = typed.strip().strip('"')
    if not text:
        return _answer("missing", "Enter the address of a folder on this PC.", text)
    invalid = _answer(
        "invalid",
        r"That isn't a full folder address. Start from the drive, like C:\Users\you\Music.",
        text,
    )
    # Paths may be on any locally attached volume, including removable music drives.
    # Reject remote/mapped drives *before* resolving links (which can initiate I/O).
    if (
        len(text) > 32767
        or NOT_IN_A_PATH & set(text)
        or any(ord(character) < 32 for character in text)
        or text.startswith(("\\", "//"))
        or not os.path.isabs(text)
        or ".." in text.replace("\\", "/").split("/")
    ):
        return invalid
    root = _local_volume_root(text)
    if root is None:
        return invalid
    try:
        # Normalize symlinks before checking the trusted local-volume prefix.
        # CodeQL recognizes this normalization + prefix guard, unlike a check
        # performed only after constructing Path(untrusted_input).
        canonical = os.path.normcase(os.path.realpath(text))
        if not canonical.startswith(os.path.normcase(root)):
            return invalid
        folder = Path(canonical).resolve(strict=True)
        if str(folder).startswith(("\\", "//")):
            return invalid
    except (FileNotFoundError, NotADirectoryError):
        return _answer(
            "missing",
            "That folder doesn't exist on this PC. If it's on a drive that isn't plugged in, "
            "plug it in and try again.",
            text,
        )
    except (OSError, RuntimeError, ValueError):
        return _answer("no_access", "Selecta isn't allowed to read that folder on this PC.", text)
    if not folder.is_dir():
        return _answer("not_a_folder", "That's a file, not a folder. Use the folder it's in.", text)
    # A shortcut or link counts as wherever it really leads; folder is already resolved.
    resolved = folder
    shown = str(resolved)
    try:
        with os.scandir(resolved) as entries:
            next(entries, None)
    except OSError:
        return _answer("no_access", "Selecta isn't allowed to read that folder on this PC.", shown)
    for watched in library_folders(conn):
        real = watched.resolve()
        if real == resolved:
            return _answer("already_added", "That folder is already in your library.", shown)
        if resolved.is_relative_to(real):
            return _answer(
                "inside_added",
                f"That folder is already included, because it's inside {real}.",
                shown,
            )
    audio = count_audio(resolved)
    if audio == 0 and not has_any_file(resolved):
        return _answer("empty", "That folder is empty, and so are any folders inside it.", shown, 0)
    if audio == 0:
        return _answer(
            "no_audio",
            "There are no audio files in that folder or the folders inside it.",
            shown,
            0,
        )
    if audio is None:
        reason = "That folder is very large, so Selecta will count its music as it reads it."
    elif audio >= MOST_AUDIO_COUNTED:
        reason = f"Found at least {audio} audio files."
    else:
        reason = f"Found {audio} audio file{'' if audio == 1 else 's'}."
    return _answer("ok", reason, shown, audio)
