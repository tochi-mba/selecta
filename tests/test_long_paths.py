"""Songs in folders past Windows' old 260-character limit (product audit, local app)."""

from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest

from selecta import longpaths


def test_a_long_windows_path_gets_the_extended_form_and_comes_back_plain():
    deep = "C:\\Music\\" + "\\".join(["a" * 40] * 7) + "\\song.flac"
    extended = longpaths.os_path(deep, windows=True)
    assert extended == "\\\\?\\" + deep
    assert longpaths.plain(extended) == deep


def test_a_network_share_uses_the_unc_form():
    deep = "\\\\nas\\music\\" + "\\".join(["b" * 40] * 7) + "\\song.mp3"
    extended = longpaths.os_path(deep, windows=True)
    assert extended.startswith("\\\\?\\UNC\\nas\\music\\")
    assert longpaths.plain(extended) == deep


def test_short_paths_and_other_systems_are_left_alone():
    assert longpaths.os_path("C:\\Music\\song.flac", windows=True) == "C:\\Music\\song.flac"
    long_posix = "/music/" + "/".join(["c" * 40] * 7) + "/song.flac"
    assert longpaths.os_path(long_posix, windows=False) == long_posix


@pytest.mark.skipif(sys.platform != "win32", reason="Windows' path limit only exists on Windows")
def test_the_scanner_finds_and_reads_a_file_deeper_than_260_characters(tmp_path):
    folder = tmp_path
    for _ in range(8):
        folder = folder / ("deep folder " + "x" * 30)
    os.makedirs(longpaths.os_path(folder, always=True))
    song = folder / "song.flac"
    assert len(str(song)) > 300
    with open(longpaths.os_path(song), "wb") as handle:
        handle.write(b"not really audio")
    found = list(longpaths.walk_files(tmp_path))
    assert found == [song]
    assert str(found[0]) == str(song)  # stored in its ordinary form
    assert longpaths.is_file(song)
    assert longpaths.stat(song).st_size == len(b"not really audio")
    assert Path(longpaths.plain(longpaths.os_path(song))) == song
