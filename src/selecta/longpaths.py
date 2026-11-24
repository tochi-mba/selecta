"""Songs in folders deeper than Windows' old 260-character limit (local app, product audit).

Windows refuses a path of 260 characters or more unless the machine has long paths switched on
(the LongPathsEnabled registry setting), which most home PCs do not. The extended form, `\\\\?\\`
in front of an absolute path (`\\\\?\\UNC\\` for a network share), reaches up to about 32,000
characters whatever that setting says.

The rule here: the library keeps every path in its ordinary form (so nothing already stored
changes, and paths stay readable), and only the operating system calls that touch a file (list
a folder, stat, open, hand to FFmpeg) are given the extended form, through `os_path`. Anything
read back from the system goes through `plain` before it is stored. On other systems both
functions return the path unchanged.
"""

from __future__ import annotations

import os
from pathlib import Path

PREFIX = "\\\\?\\"
UNC_PREFIX = "\\\\?\\UNC\\"
# Folder calls fail a few characters earlier than files (room for an 8.3 name), so start at 240.
LIMIT = 240


def os_path(
    path: str | os.PathLike[str], *, windows: bool | None = None, always: bool = False
) -> str:
    """The form to give the operating system: extended on Windows for a long path, or for any
    path with `always` (a folder walk, whose subfolders may pass the limit)."""
    text = os.fspath(path)
    if not (os.name == "nt" if windows is None else windows):
        return text
    if text.startswith(PREFIX) or (len(text) < LIMIT and not always):
        return text
    full = os.path.abspath(text) if windows is None else text
    full = full.replace("/", "\\")
    if full.startswith("\\\\"):
        return UNC_PREFIX + full[2:]
    return PREFIX + full


def plain(path: str | os.PathLike[str]) -> str:
    """The ordinary form of a path, as the library stores and shows it."""
    text = os.fspath(path)
    if text.startswith(UNC_PREFIX):
        return "\\\\" + text[len(UNC_PREFIX):]
    if text.startswith(PREFIX):
        return text[len(PREFIX):]
    return text


def stat(path: str | os.PathLike[str]) -> os.stat_result:
    return os.stat(os_path(path))


def is_file(path: str | os.PathLike[str]) -> bool:
    return os.path.isfile(os_path(path))


def walk_files(root: Path):
    """Every file under `root`, in ordinary form, reaching folders past the old limit."""
    for folder, _subfolders, names in os.walk(os_path(root, always=True)):
        base = plain(folder)
        for name in names:
            yield Path(base) / name


__all__ = ["LIMIT", "PREFIX", "is_file", "os_path", "plain", "stat", "walk_files"]
