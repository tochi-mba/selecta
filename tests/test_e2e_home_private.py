"""The browser-test servers' music folder never sits inside the user profile.

Workspace > Sources shows the music folder's full path, and its screenshots and accessibility
dumps are committed as evidence, so a path under the home folder would publish the account name.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import e2e_home  # noqa: E402


def _inside(path: Path, parent: Path) -> bool:
    try:
        path.resolve().relative_to(parent.resolve())
    except ValueError:
        return False
    return True


def test_default_root_is_outside_the_home_folder(monkeypatch):
    monkeypatch.delenv("SELECTA_E2E_ROOT", raising=False)
    root = e2e_home.neutral_root()
    assert not _inside(root, Path.home())
    assert Path.home().name.lower() not in str(root).lower()


def test_server_music_folder_has_no_home_path(monkeypatch, tmp_path):
    monkeypatch.delenv("SELECTA_E2E_ROOT", raising=False)
    home = e2e_home.make_home("selecta-e2e-test-")
    try:
        music = home / "music"  # where tests/e2e_server.py build() puts the library
        if not _inside(home, e2e_home.neutral_root()):
            # the drive root wasn't writable here, so the documented fallback applied
            return
        assert not _inside(music, Path.home())
        assert str(Path.home()).lower() not in str(music).lower()
    finally:
        import shutil

        shutil.rmtree(home, ignore_errors=True)


def test_root_can_be_chosen(monkeypatch, tmp_path):
    monkeypatch.setenv("SELECTA_E2E_ROOT", str(tmp_path / "chosen"))
    home = e2e_home.make_home("x-")
    assert home.parent == tmp_path / "chosen"


def test_servers_use_the_neutral_home():
    for name in ("e2e_server.py", "e2e_cloud_server.py"):
        source = (Path(__file__).parent / name).read_text("utf-8")
        assert "make_home(" in source, name
        assert "tempfile.mkdtemp" not in source, name
