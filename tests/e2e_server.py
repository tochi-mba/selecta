"""A real Selecta with a small made-up library, for the browser tests in web/e2e.

Every song is synthesized here, so no real music is involved. Analysis is written directly from what
the synthesis used, because the pages don't need the models to be tested. Rendering is real.
"""

from __future__ import annotations

import atexit
import json
import os
import shutil
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).parent))

import numpy as np  # noqa: E402
import soundfile as sf  # noqa: E402
import uvicorn  # noqa: E402
from synth import SR, make_track  # noqa: E402

from selecta import db, mix  # noqa: E402
from selecta.analysis.features import waveform_peaks  # noqa: E402
from selecta.analysis.pipeline import features_path  # noqa: E402
from selecta.api import create_app  # noqa: E402
from selecta.config import ANALYSIS_VERSION, Settings  # noqa: E402
from selecta.session import steer  # noqa: E402

LONG_TITLE = (
    "An Extraordinarily Long Song Title That Goes On And On Without Any Regard For The Width Of A "
    "Phone Screen (Extended Club Remix)"
)
SONGS = [
    ("Morning Light", "Ada Reyes", 120.0, "8A"),
    ("Slow Tide", "Bo Lindqvist", 121.0, "8A"),
    ("Paper Moon", "Cass Okafor", 119.0, "9A"),
    ("Neon Rain", "Dev Patel", 122.0, "7A"),
    ("שלום עולם", "נועה לוי", 120.0, "8B"),
    ("مرحبا بالعالم", "ليلى حسن", 121.0, "8A"),
    ("日本語の歌", "田中 葵", 120.0, "9A"),
    (LONG_TITLE, "An Artist Whose Name Is Also Far Too Long To Fit On One Line", 123.0, "8A"),
    ("Déjà Vu", "Zoë Müller", 118.0, "7A"),
    ("Same Name", "Hal Greene", 120.0, "8A"),
    ("Same Name", "Iris Vale", 124.0, "8A"),
    ("Last Call", "Jo Marsh", 120.0, "8A"),
]
LYRICS = """[00:01.00] the morning light comes through
[00:05.00] and everything is new
[00:09.00] we hold on to the night
[00:13.00] until the morning light
[00:17.00] the morning light comes through
[00:21.00] and everything is new
[00:25.00] we hold on to the night
[00:29.00] until the morning light
"""
BARS = 44


def _add_song(conn, settings: Settings, music: Path, number: int, song: tuple) -> None:
    title, artist, bpm, camelot = song
    track = make_track(bpm=bpm, bars=BARS, seed=number, root_hz=98.0 + 6 * (number % 5))
    path = music / f"song-{number:02d}.flac"
    sf.write(path, track.audio, SR, subtype="PCM_16")
    stat = path.stat()
    duration = track.audio.shape[0] / SR
    cursor = conn.execute(
        "INSERT INTO songs(path,folder,size,mtime,duration,artist,title,genre,is_music) "
        "VALUES(?,?,?,?,?,?,?,?,1)",
        (str(path), str(music), stat.st_size, stat.st_mtime, duration, artist, title, "Dance"),
    )
    song_id = int(cursor.lastrowid)

    beat_index = np.arange(0, track.beats.size, 4)
    rng = np.random.default_rng(number)
    energy = 0.45 + 0.05 * (number % 8)
    np.savez_compressed(
        features_path(settings, song_id),
        beats=track.beats,
        bar_starts=beat_index.astype(np.int32),
        raw_beats=track.beats.astype(np.float32),
        raw_downbeats=track.downbeats.astype(np.float32),
        chroma_bars=rng.random((BARS, 12)).astype(np.float16),
        mfcc_bars=rng.normal(size=(BARS, 13)).astype(np.float16),
        energy_bars=np.full(BARS, energy).astype(np.float16),
        rms_db_bars=np.full(BARS, -14.0).astype(np.float16),
        low_share_bars=np.full(BARS, 0.3).astype(np.float16),
        peaks=waveform_peaks(track.audio.mean(axis=1)),
    )
    half = BARS // 2
    db.save_analysis(
        conn,
        song_id,
        {
            "version": ANALYSIS_VERSION,
            "bpm": bpm,
            "constant_tempo": 1,
            "grid_confidence": 0.95,
            "beats_per_bar": 4,
            "key": "A minor",
            "camelot": camelot,
            "key_confidence": 0.9,
            "key_agrees_chroma": 1,
            "lufs": -14.0,
            "peak_db": -2.0,
            "energy": energy,
            "sections": [
                {
                    "start_bar": 0,
                    "end_bar": half,
                    "label": "verse",
                    "energy": energy,
                    "group": 0,
                    "chorus_prob": 0.2,
                },
                {
                    "start_bar": half,
                    "end_bar": BARS,
                    "label": "chorus",
                    "energy": energy,
                    "group": 1,
                    "chorus_prob": 0.9,
                },
            ],
            "timbre": [round(float(v), 3) for v in rng.normal(size=26)],
            "timings": {},
        },
    )
    if number == 0:
        conn.execute(
            "INSERT INTO lyrics(song_id,status,synced,plain) VALUES(?,?,?,?)",
            (song_id, "synced", LYRICS, LYRICS),
        )
    else:
        conn.execute("INSERT INTO lyrics(song_id,status) VALUES(?,?)", (song_id, "instrumental"))


def build(home: Path) -> Settings:
    settings = Settings(home)
    settings.ensure_dirs()
    music = home / "music"
    music.mkdir()
    conn = db.connect(settings.db_path)
    for number, song in enumerate(SONGS):
        _add_song(conn, settings, music, number, song)
    # some things the pages have to explain: a song set aside, and one analysis gave up on
    aside = music / "talk.flac"
    shutil.copy(music / "song-00.flac", aside)
    conn.execute(
        "INSERT INTO songs(path,folder,size,mtime,duration,artist,title,is_music,set_aside_reason) "
        "VALUES(?,?,?,?,80,'A Podcast','Episode 12',0,'Long and talky')",
        (str(aside), str(music), aside.stat().st_size, aside.stat().st_mtime),
    )
    broken = music / "broken.flac"
    shutil.copy(music / "song-00.flac", broken)
    cursor = conn.execute(
        "INSERT INTO songs(path,folder,size,mtime,duration,artist,title,is_music) "
        "VALUES(?,?,?,?,80,'Bad Rip','Broken File',1)",
        (str(broken), str(music), broken.stat().st_size, broken.stat().st_mtime),
    )
    conn.execute(
        "INSERT INTO analysis(song_id,version,error) VALUES(?,?,?)",
        (cursor.lastrowid, ANALYSIS_VERSION, "couldn't read it"),
    )
    db.set_preference(conn, "library_folders", [str(music)])
    # splitting stems needs the big model, which isn't what these tests are about
    steer(conn, "stems", "never")
    conn.commit()
    for song_id in (1, 2, 3, 4):
        mix.add_song(conn, song_id)
    conn.close()
    (home / "built.json").write_text(json.dumps({"songs": len(SONGS)}), "utf-8")
    return settings


def main() -> None:
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8799
    # its own folder every time, so a copy that's still shutting down can't get in the way
    home = Path(tempfile.mkdtemp(prefix="selecta-e2e-"))
    atexit.register(shutil.rmtree, home, ignore_errors=True)
    os.environ["SELECTA_HOME"] = str(home)
    settings = build(home)
    app = create_app(settings, ROOT / "web" / "dist", prepare_links=False)
    add_flag_switch(app)
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning")


def add_flag_switch(app) -> None:
    """Test only: change this server's flags without restarting it, so the browser sweep can try
    each one off in turn. Never part of the real app. It goes ahead of the site's files, which
    would otherwise answer every address."""
    from fastapi import APIRouter, Body

    from selecta import flags

    router = APIRouter()

    @router.post("/api/test/flags")
    def switch(body: dict = Body(default={})) -> dict:  # noqa: B008
        flags.use(str(body.get("flags", "")))
        return flags.snapshot()

    app.router.routes[:0] = router.routes


if __name__ == "__main__":
    main()
