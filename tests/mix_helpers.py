"""Songs, stores and clients shared by the mix tests."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from helpers import song_from_track
from synth import make_track

from selecta import db, mix
from selecta.api import create_app
from selecta.config import ANALYSIS_VERSION, Settings
from selecta.lyrics.lrclib import Line
from selecta.planner.memory import RULES_VERSION
from selecta.seams import CannotRender, SeamRequest, SeamStore


def _song_row(conn, song_id, artist, title, path="x.flac"):
    conn.execute(
        "INSERT INTO songs(id,path,folder,size,mtime,duration,artist,title,is_music) "
        "VALUES(?,?,?,?,?,?,?,?,1)",
        (song_id, f"{song_id}-{path}", "f", 1, 1.0, 200.0, artist, title),
    )
    conn.execute(
        "INSERT INTO analysis(song_id,version,bpm,camelot) VALUES(?,?,?,?)",
        (song_id, ANALYSIS_VERSION, 120.0, "8A"),
    )


@pytest.fixture
def conn(tmp_path):
    connection = db.connect(tmp_path / "selecta.sqlite")
    for song_id in range(1, 6):
        _song_row(connection, song_id, f"Artist {song_id}", f"Song {song_id}")
    connection.commit()
    return connection


@pytest.fixture
def store(tmp_path):
    return SeamStore(Settings(tmp_path))


def _order(conn, store):
    return [item["song_id"] for item in mix.read_mix(conn, store)]


def _song(tmp_path, name, artist, bpm=120.0, energy=0.5, camelot="8A"):
    song = song_from_track(tmp_path, name, make_track(bpm=bpm, bars=64, seed=abs(hash(name)) % 99))
    song.artist = artist
    song.energy = energy
    song.camelot = camelot
    return song


@pytest.fixture
def client(tmp_path):
    settings = Settings(tmp_path)
    conn = db.connect(settings.db_path)
    for song_id in (1, 2):
        _song_row(conn, song_id, f"Artist {song_id}", f"Song {song_id}")
    conn.commit()
    conn.close()
    return TestClient(create_app(settings, tmp_path / "no-web"))


def _vibe_library(tmp_path):
    from selecta.planner.vibes import traits_of

    track = make_track(bpm=120, bars=64, seed=1)
    songs = []
    years = {}
    families = ["Afrobeats", "Hip-Hop", "R&B", "Rock", "Pop", "Dance"]
    for i in range(36):
        song = song_from_track(tmp_path, f"v{i}", track, genre=families[i % 6])
        song.id = i + 1
        song.artist = f"Artist {i}"
        song.bpm = 92.0 + i
        song.energy = 0.3 + i * 0.006
        songs.append(song)
        years[song.id] = "1999" if i < 12 else "2021"
    return songs, traits_of(songs, years)


def _request(a: int, b: int = 99) -> SeamRequest:
    return SeamRequest(a=a, b=b, move="cut_on_one")


HELPER_WHILE_WAITING = """
import subprocess, sys, threading, time
from selecta.jobs import take_app_input
app_input = take_app_input()
threading.Thread(target=app_input.read, daemon=True).start()
time.sleep(0.5)
subprocess.run([sys.executable, "-c", "print('hello')"], stdout=subprocess.DEVNULL)
print("finished", flush=True)
"""


def _report(*checks):
    from selecta.audit.checks import AuditReport, Check

    return AuditReport([Check(name, False, value, limit) for name, value, limit in checks])


def _same_songs(tmp_path, count):
    from selecta.planner.beam import PlannedSong

    track = make_track(bpm=120, bars=64, seed=1)
    songs = []
    for i in range(count):
        song = song_from_track(tmp_path, f"m{i}", track, genre="Pop")
        song.id = i + 1
        song.lines = [
            Line(30.0 + j * 4.0, 33.5 + j * 4.0, "you and me in the night") for j in range(20)
        ]
        songs.append(song)
    return [PlannedSong(song, "bass_swap_blend", "") for song in songs]


def _takes(store, monkeypatch, reports):
    def take(request, _a, _b):
        if request.move not in reports:
            raise CannotRender("not here")
        return f"take of {request.move}", reports[request.move], "why"

    monkeypatch.setattr(store, "_chosen_move", take)


def _two_songs(tmp_path):
    track = make_track(bpm=120, bars=64, seed=1)
    a = song_from_track(tmp_path, "a", track)
    b = song_from_track(tmp_path, "b", track)
    a.id, b.id = 1, 2
    return a, b


def _record(a=1, b=2, style="vocal_ride", passed=True, rating=None, **more):
    return {
        "status": "ready",
        "key": f"{a}-{b}-{style}",
        "style": style,
        "passed": passed,
        "rating": rating,
        "rules": RULES_VERSION,
        "request": {"a": a, "b": b, "move": style},
        **more,
    }
