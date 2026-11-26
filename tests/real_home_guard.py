"""No test ever changes the real Selecta home of whoever runs the tests.

A seam render's audit listens for voices (`audit.checks._sensed_spans`), which separates stems
into `Settings(home=default_home()).home / "stems"`: with no `SELECTA_HOME` that was the owner's
own `~/.selecta`, and test runs left stem windows there. Two guards, wired in `conftest.py`:

- `_a_selecta_home_of_its_own` (session, autouse) points `SELECTA_HOME` at a temporary folder
  before any fixture runs, so `default_home()` is never the real one unless a test unsets it;
- an audit hook refuses, with `PermissionError`, any write, rename, removal or new folder under
  the real homes (`~/.selecta` and the shell's `SELECTA_HOME`) made by this process, and
  `_never_the_real_home` (autouse) fails the test that tried, even when the code under test
  swallowed the error. Reading the real home is allowed.
"""

from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path

import pytest


def _real_homes() -> tuple[str, ...]:
    """The real Selecta homes, read before any test points `SELECTA_HOME` elsewhere. A folder
    that holds the temporary folder is left out, or no test could write its own `tmp_path`."""
    shell = os.environ.get("SELECTA_HOME")
    temp = os.path.normcase(os.path.abspath(tempfile.gettempdir()))
    found = []
    for root in {Path.home() / ".selecta", *([Path(shell)] if shell else [])}:
        text = os.path.normcase(os.path.abspath(root))
        if temp != text and not temp.startswith(text + os.sep):
            found.append(text)
    return tuple(found)


REAL_HOMES = _real_homes()
TRIED: list[str] = []
"""What a test tried to change under a real home, for `_never_the_real_home` to report."""

# the arguments of each audited event that name a place written to
_WRITTEN = {
    "os.mkdir": (0,), "os.remove": (0,), "os.rmdir": (0,), "os.rename": (0, 1),
    "os.replace": (0, 1), "os.utime": (0,), "os.truncate": (0,), "os.chmod": (0,),
    "os.link": (1,), "os.symlink": (1,), "shutil.copyfile": (1,), "shutil.copytree": (1,),
    "shutil.move": (0, 1), "shutil.rmtree": (0,),
}
_WRITE_FLAGS = os.O_WRONLY | os.O_RDWR | os.O_CREAT | os.O_APPEND | os.O_TRUNC


def _under_a_real_home(value) -> str | None:
    if value is None or isinstance(value, int):
        return None
    try:
        text = os.fsdecode(value)
    except TypeError:
        return None
    full = os.path.normcase(os.path.abspath(text))
    for root in REAL_HOMES:
        if full == root or full.startswith(root + os.sep):
            return full
    return None


def watch(event: str, args: tuple) -> None:
    """The audit hook (module notes): refuse a change under a real home, and remember it."""
    if event == "open":
        mode, flags = args[1], args[2]
        if isinstance(mode, str) and not any(letter in mode for letter in "wax+"):
            return
        if mode is None and not (flags or 0) & _WRITE_FLAGS:
            return
        places = (args[0],)
    elif event in _WRITTEN:
        places = tuple(args[index] for index in _WRITTEN[event] if index < len(args))
    else:
        return
    for place in places:
        found = _under_a_real_home(place)
        if found is not None:
            TRIED.append(f"{event} {found}")
            raise PermissionError(f"A test tried to change the real Selecta home: {found}")


if REAL_HOMES:
    sys.addaudithook(watch)


@pytest.fixture(scope="session", autouse=True)
def _a_selecta_home_of_its_own(tmp_path_factory):
    """`SELECTA_HOME` is a temporary folder for the whole run; a test may still set its own."""
    patch = pytest.MonkeyPatch()
    home = tmp_path_factory.mktemp("selecta-home")
    patch.setenv("SELECTA_HOME", str(home))
    yield home
    patch.undo()


@pytest.fixture(autouse=True)
def _never_the_real_home():
    """Fails the test that tried to change a real Selecta home (module notes)."""
    TRIED.clear()
    yield
    if TRIED:
        tried = list(dict.fromkeys(TRIED))
        TRIED.clear()
        pytest.fail("This test tried to change the real Selecta home (refused): "
                    + "; ".join(tried[:5]), pytrace=False)
