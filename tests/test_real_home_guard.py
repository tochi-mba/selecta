"""The guard that keeps tests out of the real Selecta home (`real_home_guard`). Nothing here
touches the real home: the hook is called directly with the places it would be asked about."""

from __future__ import annotations

import os
from pathlib import Path

import pytest
import real_home_guard as guard

from selecta.config import default_home


def test_a_test_runs_with_a_selecta_home_of_its_own():
    here = os.path.normcase(os.path.abspath(default_home()))
    assert guard.REAL_HOMES and here not in guard.REAL_HOMES
    assert os.path.normcase(os.path.abspath(Path.home() / ".selecta")) in guard.REAL_HOMES


@pytest.mark.parametrize(("event", "args"), [
    ("os.mkdir", ("{real}/stems/0123456789abcdef0123", 0o777, None)),
    ("open", ("{real}/stems/x/vocals.wav", "wb", 0)),
    ("open", ("{real}/selecta.sqlite", None, os.O_RDWR)),
    ("shutil.move", ("{tmp}/vocals.wav", "{real}/stems/x/vocals.wav")),
    ("os.remove", ("{real}/stems/x/window.json", None)),
])
def test_a_change_under_the_real_home_is_refused_and_named(event, args, tmp_path):
    real = guard.REAL_HOMES[0]
    named = tuple(a.format(real=real, tmp=tmp_path) if isinstance(a, str) else a for a in args)
    try:
        with pytest.raises(PermissionError, match="real Selecta home"):
            guard.watch(event, named)
        assert guard.TRIED and guard.TRIED[-1].startswith(event)
    finally:
        guard.TRIED.clear()  # the refusal was this test's own


def test_reading_the_real_home_and_writing_a_tests_own_folder_are_allowed(tmp_path):
    real = guard.REAL_HOMES[0]
    guard.watch("open", (f"{real}/selecta.sqlite", "rb", 0))
    guard.watch("open", (f"{real}/selecta.sqlite", None, os.O_RDONLY))
    guard.watch("shutil.copyfile", (f"{real}/selecta.sqlite", str(tmp_path / "copy.sqlite")))
    guard.watch("open", (str(tmp_path / "x.wav"), "wb", 0))
    guard.watch("os.mkdir", (str(tmp_path / "stems"), 0o777, None))
    assert guard.TRIED == []
