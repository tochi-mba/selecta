"""T0151: extreme curves, reset, invalid values and targets, and settings that outlive the app."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from mix_helpers import _song_row, _vibe_library

from selecta import db
from selecta.api import create_app
from selecta.config import Settings
from selecta.planner.vibes import BY_KEY, build_vibe


@pytest.fixture
def home(tmp_path):
    settings = Settings(tmp_path)
    conn = db.connect(settings.db_path)
    for song_id in (1, 2):
        _song_row(conn, song_id, f"Artist {song_id}", f"Song {song_id}")
    conn.commit()
    conn.close()
    return settings


def _app(settings, tmp_path):
    return TestClient(create_app(settings, tmp_path / "no-web"))


@pytest.mark.parametrize("arc", [[0, 0, 0, 0, 0], [100, 100, 100, 100, 100], [0, 100, 0, 100, 0]])
def test_extreme_curves_are_kept_exactly_and_survive_a_restart(home, tmp_path, arc):
    client = _app(home, tmp_path)
    saved = client.post("/api/steer", json={"action": "energy_arc", "value": arc})
    assert saved.status_code == 200, saved.text
    assert saved.json()["energy_arc"] == arc
    again = _app(home, tmp_path)
    assert again.get("/api/status").json()["steering"]["energy_arc"] == arc


@pytest.mark.parametrize(
    "bad",
    [[101, 50, 50, 50, 50], [-1, 50, 50, 50, 50], [50, 50, 50, 50], [50] * 6,
     [50.5, 50, 50, 50, 50], [True, 50, 50, 50, 50], "high", 70],
)
def test_an_invalid_curve_is_refused_and_the_saved_one_stays(home, tmp_path, bad):
    client = _app(home, tmp_path)
    client.post("/api/steer", json={"action": "energy_arc", "value": [10, 20, 30, 40, 50]})
    refused = client.post("/api/steer", json={"action": "energy_arc", "value": bad})
    assert refused.status_code in (400, 422)
    assert client.get("/api/status").json()["steering"]["energy_arc"] == [10, 20, 30, 40, 50]


def test_reset_returns_to_each_mixs_own_arc_and_stays_reset(home, tmp_path):
    client = _app(home, tmp_path)
    client.post("/api/steer", json={"action": "energy_arc", "value": [10, 20, 30, 40, 50]})
    reset = client.post("/api/steer", json={"action": "energy_arc", "value": None})
    assert reset.status_code == 200 and reset.json()["energy_arc"] is None
    assert _app(home, tmp_path).get("/api/status").json()["steering"]["energy_arc"] is None


def test_rapid_writes_end_on_the_last_one(home, tmp_path):
    client = _app(home, tmp_path)
    for level in range(0, 101, 5):
        client.post("/api/steer", json={"action": "energy_arc", "value": [level] * 5})
    assert client.get("/api/status").json()["steering"]["energy_arc"] == [100] * 5


@pytest.mark.parametrize("target", ["unknown", "-3", "1; DROP TABLE songs", "2.5"])
def test_an_invalid_destination_is_refused_and_the_saved_one_stays(home, tmp_path, target):
    client = _app(home, tmp_path)
    client.post("/api/steer", json={"action": "take_me_to", "value": 2})
    refused = client.post("/api/steer", json={"action": "take_me_to", "value": target})
    assert refused.status_code == 400
    assert client.get("/api/status").json()["steering"]["target"] == "2"


def test_a_destination_that_has_left_the_library_stops_the_build_with_a_reason(home, tmp_path):
    client = _app(home, tmp_path)
    client.post("/api/mix/songs", json={"song_id": 1})
    client.post("/api/steer", json={"action": "take_me_to", "value": 999})
    from unittest import mock

    with mock.patch("selecta.planner.vibes.eligible", lambda *_: list(range(100))):
        refused = client.post("/api/vibes/pick/build")
    assert refused.status_code == 400
    assert "no longer mix-ready" in refused.json()["detail"]
    assert [item["song_id"] for item in client.get("/api/mix").json()["mix"]] == [1]


@pytest.mark.parametrize("arc", [[0.0] * 5, [1.0] * 5, [0.0, 1.0, 0.0, 1.0, 0.0]])
def test_the_planner_builds_a_whole_mix_on_an_extreme_curve(tmp_path, arc):
    songs, traits = _vibe_library(tmp_path)
    planned, _ = build_vibe(BY_KEY["pick"], songs, traits, {}, 8, seed=3, energy_arc=arc)
    ids = [item.song.id for item in planned]
    assert len(ids) == 8 and len(set(ids)) == 8
