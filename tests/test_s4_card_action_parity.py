"""S4-0097-02: Play, Shape first and Save draft on a mix card make the same mix.

The site sends one build request for all three (Save draft adds as_draft=true; see
web/src/views/s4CardActionParity.test.tsx). Here the server is held to its half: the planner is
asked the same question either way, and the songs and transition settings that come back land
unchanged in the current mix or in the new draft, with the draft path leaving what plays alone.
"""

from __future__ import annotations

from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from selecta import db
from selecta.api import create_app
from selecta.config import ANALYSIS_VERSION, Settings
from selecta.seams import SeamStore


@pytest.fixture
def client(tmp_path, monkeypatch):
    settings = Settings(tmp_path)
    conn = db.connect(settings.db_path)
    for song_id in range(1, 7):
        conn.execute(
            "INSERT INTO songs(id,path,folder,size,mtime,duration,artist,title,is_music) "
            "VALUES(?,?,?,?,?,?,?,?,1)",
            (
                song_id, f"{song_id}.flac", "f", 1, 1.0, 200.0,
                f"Artist {song_id}", f"Song {song_id}",
            ),
        )
        conn.execute(
            "INSERT INTO analysis(song_id,version,bpm,camelot) VALUES(?,?,?,?)",
            (song_id, ANALYSIS_VERSION, 120.0, "8A"),
        )
    conn.commit()
    conn.close()
    monkeypatch.setattr(
        "selecta.analysis.song.load_song",
        lambda _conn, _settings, song_id: SimpleNamespace(
            id=song_id, title=f"Song {song_id}", vocals_known=True
        ),
    )
    monkeypatch.setattr("selecta.planner.reel.load_library", lambda _conn, _settings: [])
    monkeypatch.setattr(
        SeamStore, "submit", lambda self, request, urgent=False, retry=False: {
            "status": "queued", "key": request.key,
        },
    )
    return TestClient(create_app(settings, tmp_path / "no-web"))


@pytest.fixture
def planner(monkeypatch):
    asked = []

    class Planned:
        def __init__(self, song_id):
            self.song = SimpleNamespace(id=song_id)

    def build_vibe(vibe, songs, traits, phrases, count, start, **options):
        asked.append((vibe.key, count, start, {k: v for k, v in options.items() if k != "memory"}))
        return [Planned(3), Planned(1), Planned(5)], {1: {"move": "echo_out"}, 5: {"move": "cut"}}

    monkeypatch.setattr(
        "selecta.planner.vibes.eligible", lambda _vibe, songs, _traits: list(range(100))
    )
    monkeypatch.setattr("selecta.planner.vibes.build_vibe", build_vibe)
    return asked


def _shape(mix):
    return [(item["song_id"], (item.get("seam") or {}).get("settings")) for item in mix]


def test_play_shape_first_and_save_draft_make_the_same_mix(client, planner):
    from selecta.planner.vibes import VIBES

    key = VIBES[0].key
    client.post("/api/mix/songs", json={"song_id": 6})
    before = client.get("/api/mix").json()
    order = ",".join(str(item["song_id"]) for item in before["mix"])

    drafted = client.post(f"/api/vibes/{key}/build?count=3&as_draft=true")
    assert drafted.status_code == 200, drafted.text
    assert _shape(client.get("/api/mix").json()["mix"]) == _shape(before["mix"])
    draft = client.get(f"/api/mix?draft={drafted.json()['id']}").json()

    # Play and Shape first are one request; the site only lands somewhere else afterwards
    played = client.post(f"/api/vibes/{key}/build?count=3", headers={"x-mix-order": order})
    assert played.status_code == 200, played.text
    current = client.get("/api/mix").json()

    assert planner[0] == planner[1]
    assert _shape(draft["mix"]) == _shape(current["mix"]) == [
        (3, None), (1, {"move": "echo_out"}), (5, {"move": "cut"}),
    ]
    assert drafted.json()["count"] == played.json()["count"] == 3
    assert drafted.json()["name"] == current["name"] == VIBES[0].name


def test_a_refused_build_is_refused_the_same_way_from_every_entry_point(client, planner):
    unknown = [
        client.post("/api/vibes/not-a-mix/build?count=3"),
        client.post("/api/vibes/not-a-mix/build?count=3&as_draft=true"),
    ]
    assert [answer.status_code for answer in unknown] == [404, 404]
    assert unknown[0].json()["detail"] == unknown[1].json()["detail"]
    assert planner == []
    assert client.get("/api/drafts").json()["drafts"] == []
