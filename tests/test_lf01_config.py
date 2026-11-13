from __future__ import annotations

from dataclasses import replace

import pytest

from selecta.local_engine.config import (
    EngineConfig,
    EngineConfigError,
    access_token,
    load_config,
    rotate_access,
    save_config,
    state_directory,
)


def test_isolated_engine_home_preserves_old_music_home(monkeypatch, tmp_path):
    monkeypatch.setenv("SELECTA_HOME", str(tmp_path / "music"))
    monkeypatch.delenv("SELECTA_ENGINE_STATE_DIR", raising=False)
    assert state_directory("linux", tmp_path) != tmp_path / "music"
    monkeypatch.setenv("SELECTA_ENGINE_STATE_DIR", str(tmp_path / "engine"))
    assert state_directory() == (tmp_path / "engine").resolve()


def test_config_atomic_roundtrip_and_corrupt_recovery(tmp_path):
    original = load_config(tmp_path)
    assert original.workspace == "standalone"
    save_config(tmp_path, replace(original, port=9761))
    assert load_config(tmp_path).port == 9761
    (tmp_path / "engine.json").write_text("{broken", encoding="utf-8")
    with pytest.raises(EngineConfigError):
        load_config(tmp_path, recover=False)
    assert load_config(tmp_path).port == original.port
    assert list(tmp_path.glob("engine.corrupt.*.json"))


def test_invalid_config_refused(tmp_path):
    for invalid in (
        {"port": 80}, {"port": True}, {"workspace": "cloud"},
        {"version": 99}, {"unexpected_key": "wrong"},
    ):
        with pytest.raises((EngineConfigError, TypeError)):
            EngineConfig.from_dict(invalid)
    target = tmp_path / "occupied"
    target.write_text("not a directory", encoding="utf-8")
    with pytest.raises(OSError):
        load_config(target)


def test_revocation_rotates_only_headless_secret(tmp_path):
    old = access_token(tmp_path)
    assert old == access_token(tmp_path)
    new = rotate_access(tmp_path)
    assert new != old
    assert access_token(tmp_path) == new
    assert not (tmp_path / "engine.json").exists()


def test_symlink_config_is_not_followed(tmp_path):
    target = tmp_path / "elsewhere"
    target.write_text("sensitive", encoding="utf-8")
    link = tmp_path / "engine.json"
    try:
        link.symlink_to(target)
    except (NotImplementedError, OSError):
        pytest.skip("Symlinks unavailable on this platform.")
    with pytest.raises(EngineConfigError):
        load_config(tmp_path, recover=False)
    assert target.read_text("utf-8") == "sensitive"
