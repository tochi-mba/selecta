"""Where the browser-test servers put their made-up library.

The Sources page shows the music folder's full path, and screenshots and accessibility dumps of it
are committed as evidence. A folder under the system temp directory lives inside the user profile
on Windows, so its path would carry the person's account name into every capture. The servers use
a neutral folder at the drive root instead (C:\\selecta-e2e\\<random> on Windows), or wherever
SELECTA_E2E_ROOT points, and fall back to the temp directory only when that can't be written.
"""

from __future__ import annotations

import atexit
import os
import shutil
import tempfile
from pathlib import Path


def neutral_root() -> Path:
    """The parent folder for test homes: SELECTA_E2E_ROOT, or `selecta-e2e` at the drive root."""
    chosen = os.environ.get("SELECTA_E2E_ROOT")
    if chosen:
        return Path(chosen)
    return Path(Path(tempfile.gettempdir()).anchor) / "selecta-e2e"


def make_home(prefix: str = "selecta-e2e-") -> Path:
    """A fresh, empty folder for one server run, removed when the process exits."""
    try:
        root = neutral_root()
        root.mkdir(parents=True, exist_ok=True)
        home = Path(tempfile.mkdtemp(prefix=prefix, dir=root))
    except OSError:
        home = Path(tempfile.mkdtemp(prefix=prefix))
    atexit.register(shutil.rmtree, home, ignore_errors=True)
    return home
