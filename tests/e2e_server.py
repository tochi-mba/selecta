"""A real Selecta with a small made-up library, for the browser tests in web/e2e.

Every song is synthesized here, so no real music is involved. Analysis is written directly from what
the synthesis used, because the pages don't need the models to be tested. Rendering is real.
"""

from __future__ import annotations

import json
import os
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).parent))

import numpy as np  # noqa: E402
import soundfile as sf  # noqa: E402
import uvicorn  # noqa: E402
from e2e_home import make_home  # noqa: E402
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

# MP-0272-05: stress metadata, only when SELECTA_E2E_STRESS=1 (web/playwright.mp.config.ts), so the
# ordinary run and its screenshots keep the twelve songs above. Every name is invented here: no real
# artist, song, path or person. Missing means NULL in the database, as an untagged file arrives.
STRESS = os.environ.get("SELECTA_E2E_STRESS") == "1"
UNBROKEN_TITLE = "Hyperextendedunbrokentitlewithoutanyspacesthatcannotwrapanywhereatall" + "Mix2026"
CJK_TITLE = "夜明けの街を歩きながら君のことを考えていた長い長い歌のタイトル"
ARABIC_TITLE = "أغنية طويلة جدا عن الليل والنهار والبحر والسماء والنجوم البعيدة"
STRESS_SONGS = [
    (None, None, 120.0, "8A"),  # missing title and artist
    (UNBROKEN_TITLE, "Nospacesartistnamethatalsorefusestowrap", 121.0, "8A"),
    ("Same Name", "Hal Greene", 120.0, "8A"),  # exact duplicate of title and artist
    ("Remix של שלום (feat. ليلى) 2026", "Mixed Bidi Ensemble", 120.0, "9A"),
    (CJK_TITLE, "東京の夜の楽団と仲間たち", 119.0, "8A"),
    (ARABIC_TITLE, "فرقة الليل الطويل", 122.0, "8A"),
]
# song ids: SONGS are 1-12, the set-aside and broken files 13-14, STRESS_SONGS 15-20
STRESS_MIX = (8, 15, 18, 19, 20, 10, 17, 16)
STRESS_LYRICS = (
    LYRICS
    + "[00:33.00] a lyric line long enough to wrap across the whole stage at every width\n"
    + """[00:37.00] שורה בעברית שעוברת מימין לשמאל
[00:41.00] 夜明けの街を歩きながら
"""
)


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
        mfcc_bars=rng.normal(size=(BARS, 20)).astype(np.float16),
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
    if number == 0 or (STRESS and number == 7):
        words = STRESS_LYRICS if STRESS else LYRICS
        conn.execute(
            "INSERT INTO lyrics(song_id,status,synced,plain) VALUES(?,?,?,?)",
            (song_id, "synced", words, words),
        )
    else:
        conn.execute("INSERT INTO lyrics(song_id,status) VALUES(?,?)", (song_id, "instrumental"))


# MP-0272-03: with SELECTA_E2E_STEMS=1 the Studio can open for the mix's first transition. Stems
# stay set to never for planning; this only fills the stem cache that separating would have filled,
# so the Studio lays out its grid without the big model. Each "stem" is a quieter copy of the
# window.
STEMS = os.environ.get("SELECTA_E2E_STEMS") == "1"


def seed_studio_stems(conn, settings: Settings, a_id: int, b_id: int) -> list[Path]:
    """Write the four cached stems for both windows the Studio would separate for a into b."""
    from selecta.analysis.song import load_song
    from selecta.stems import _window_folder
    from selecta.studio import _windows, find_placement

    a, b = load_song(conn, settings, a_id), load_song(conn, settings, b_id)
    place = find_placement(a, b)
    if place is None:
        raise ValueError(f"songs {a_id} and {b_id} can't share a Studio grid")
    folders = []
    for song, (start, length) in zip((a, b), _windows(a, b, place), strict=True):
        source = Path(song.path)
        folder = _window_folder(settings, source, start, length)
        folder.mkdir(parents=True, exist_ok=True)
        audio, rate = sf.read(source, always_2d=True, dtype="float32")
        first = max(0, int(start * rate))
        window = audio[first : first + int(length * rate)]
        for lane, gain in (("vocals", 0.3), ("drums", 0.4), ("bass", 0.3), ("other", 0.3)):
            sf.write(folder / f"{lane}.wav", window * gain, rate, subtype="PCM_16")
        folders.append(folder)
    return folders


# S4-0105-07: with SELECTA_E2E_BULK=<n>, n more made-up songs waiting for analysis, each a short
# tone file of its own, so the Library has hundreds of pages. Analysis stays paused (the real
# worker would fetch model weights); /api/test/analysed records results the way the worker does.
BULK = int(os.environ.get("SELECTA_E2E_BULK", "0") or 0)


def add_bulk_songs(conn, music: Path, count: int) -> None:
    folder = music / "bulk"
    folder.mkdir()
    rate = 8000
    tone = (0.2 * np.sin(2 * np.pi * 220 * np.arange(rate // 4) / rate)).astype(np.float32)
    first = folder / "tone-00000.wav"
    sf.write(first, tone, rate, subtype="PCM_16")
    data = first.read_bytes()
    rows = []
    for number in range(count):
        path = folder / f"tone-{number:05d}.wav"
        if number:
            path.write_bytes(data)
        stat = path.stat()
        title = f"Zz Tone {number:05d}"
        rows.append(
            (str(path), str(folder), stat.st_size, stat.st_mtime, 180.0, "Tone Maker", title)
        )
    conn.executemany(
        "INSERT INTO songs(path,folder,size,mtime,duration,artist,title,is_music) "
        "VALUES(?,?,?,?,?,?,?,1)",
        rows,
    )
    db.set_preference(conn, "analysis_paused", True)


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
    if STRESS:
        for number, song in enumerate(STRESS_SONGS, start=len(SONGS) + 2):
            _add_song(conn, settings, music, number, song)
    if BULK:
        add_bulk_songs(conn, music, BULK)
    # splitting stems needs the big model, which isn't what these tests are about
    steer(conn, "stems", "never")
    conn.commit()
    order = STRESS_MIX if STRESS else (1, 2, 3, 4)
    for song_id in order:
        mix.add_song(conn, song_id)
    if STEMS:
        seed_studio_stems(conn, settings, order[0], order[1])
    conn.close()
    (home / "built.json").write_text(json.dumps({"songs": len(SONGS)}), "utf-8")
    return settings


def main() -> None:
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8799
    # its own folder every time, so a copy that's still shutting down can't get in the way
    # a neutral folder outside the user profile (see e2e_home), so no capture shows an account name
    home = make_home("selecta-e2e-")
    os.environ["SELECTA_HOME"] = str(home)
    settings = build(home)
    # SELECTA_E2E_DIST names another build folder under web/, so runs side by side can each
    # serve their own build instead of one rebuilding web/dist under another's feet
    dist = ROOT / "web" / os.environ.get("SELECTA_E2E_DIST", "dist")
    app = create_app(settings, dist, prepare_links=False)
    add_flag_switch(app)
    if BULK:
        add_analysed_switch(app, settings)
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


def add_analysed_switch(app, settings: Settings) -> None:
    """Test only, with SELECTA_E2E_BULK: record analysis results for the named songs as the
    worker would when it finishes each one, so a drill can watch readiness change mid-session."""
    from fastapi import APIRouter, Body

    router = APIRouter()

    @router.post("/api/test/analysed")
    def analysed(body: dict = Body(default={})) -> dict:  # noqa: B008
        ids = [int(song_id) for song_id in body.get("ids", [])]
        conn = db.connect(settings.db_path)
        try:
            for song_id in ids:
                db.save_analysis(
                    conn,
                    song_id,
                    {"version": ANALYSIS_VERSION, "bpm": 120.0, "camelot": "8A", "energy": 0.5},
                )
                conn.execute(
                    "INSERT OR REPLACE INTO lyrics(song_id,status) VALUES(?,?)",
                    (song_id, "instrumental"),
                )
            conn.commit()
        finally:
            conn.close()
        return {"analysed": len(ids)}

    app.router.routes[:0] = router.routes


if __name__ == "__main__":
    main()
