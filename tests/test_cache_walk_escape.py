"""The cache tidy and the cache walk stay inside the cache: a junction (or link) in a cache root is
never followed into the folder it points at, such as the real models folder, and a clip that
vanishes mid-tidy doesn't stop the tidy (rv2-b review, 2026-11-12)."""

from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from pathlib import Path

import pytest

from selecta import cache_care, stems
from selecta.config import Settings

pytestmark = pytest.mark.skipif(sys.platform != "win32", reason="junctions are a Windows thing")


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    found = Settings(tmp_path / "home")
    found.ensure_dirs()
    return found


def _junction(link: Path, target: Path) -> None:
    link.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        ["cmd", "/c", "mklink", "/J", str(link), str(target)], check=True, capture_output=True
    )


def _old(path: Path) -> None:
    moment = time.time() - 2 * cache_care.CRASH_GRACE_S
    os.utime(path, (moment, moment))


def test_tidy_never_deletes_through_a_junction_in_a_cache_root(settings, tmp_path):
    models = tmp_path / "models"
    models.mkdir()
    download = models / "htdemucs.th.part"
    download.write_bytes(b"x" * 100)
    excerpt = models / "window.wav"
    excerpt.write_bytes(b"x" * 100)
    (models / "window.json").write_text("{}", "utf-8")
    for path in (download, excerpt, models / "window.json", models):
        _old(path)
    _junction(settings.home / "stems" / "linked", models)

    clips = tmp_path / "clips"
    clips.mkdir()
    (clips / "clip.flac").write_bytes(b"same audio")
    real = settings.renders_dir / "seams" / "real"
    real.mkdir(parents=True)
    (real / "clip.flac").write_bytes(b"same audio")
    _junction(settings.renders_dir / "seams" / "linked", clips)

    cache_care.tidy(settings)

    assert download.exists(), "a .part in the models folder was deleted through a junction"
    assert excerpt.exists(), "a file in the models folder was deleted through a junction"
    assert not os.path.samefile(clips / "clip.flac", real / "clip.flac"), (
        "a file outside the cache was replaced by a link through a junction"
    )
    assert (models / "window.json").exists()


def test_a_clip_vanishing_mid_tidy_does_not_stop_the_tidy(settings, monkeypatch):
    folders = []
    for key in ("one", "two"):
        folder = settings.renders_dir / "seams" / key
        folder.mkdir(parents=True)
        (folder / "clip.flac").write_bytes(b"same audio")
        folders.append(folder)
    real_digest = cache_care._digest

    def digest_then_lose_the_other(path: Path) -> str:
        found = real_digest(path)
        if path.parent.name == "two":
            # another process prunes the first seam while this one is reading the second
            (folders[0] / "clip.flac").unlink()
        return found

    monkeypatch.setattr(cache_care, "_digest", digest_then_lose_the_other)
    swept = cache_care.Swept()
    cache_care._link_duplicates(settings, swept)  # must not raise
    assert swept.linked == 0


def test_the_stems_cache_walk_does_not_follow_a_junction(tmp_path):
    models = tmp_path / "models"
    models.mkdir()
    (models / "weights.bin").write_bytes(b"x" * 100_000)
    root = tmp_path / "stems"
    window = root / "w1"
    window.mkdir(parents=True)
    (window / "vocals.wav").write_bytes(b"y" * 10)
    (window / "window.json").write_text(json.dumps({}), "utf-8")
    _junction(window / "inside", models)
    _junction(root / "top", models)

    sizes = {folder.name: size for folder, size, _ in stems._window_dirs(root)}

    assert sizes.get("w1") == 12, f"the walk counted the models folder: {sizes}"
    assert "top" not in sizes, "a junction in the cache root was counted as cached"
    stems._prune(root, 0)
    assert (models / "weights.bin").exists()
