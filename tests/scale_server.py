"""The browser-test server with a big library and a long mix, for measuring how the pages hold up.

    python tests/scale_server.py 8821 20000 100

The first number after the port is how many songs the library gets, and the next how many of
them are in the current mix. Every extra song is the same few database rows and shares a
synthesized recording, so 20,000 songs take no real disk. What's measured is the database,
the server and the page, which is what a big library costs. Nothing here is real music.
"""

from __future__ import annotations

import atexit
import os
import shutil
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).parent))

import uvicorn  # noqa: E402
from e2e_server import build  # noqa: E402

from selecta import db, mix  # noqa: E402
from selecta.analysis.pipeline import features_path  # noqa: E402
from selecta.api import create_app  # noqa: E402
from selecta.config import Settings  # noqa: E402


def grow(settings: Settings, songs: int, in_mix: int) -> None:
    """Copy the first song's rows under new names, adding the first few to the mix."""
    conn = db.connect(settings.db_path)
    source = conn.execute("SELECT * FROM songs WHERE id=1").fetchone()
    analysis = conn.execute("SELECT * FROM analysis WHERE song_id=1").fetchone()
    features = features_path(settings, 1)
    audio = Path(source["path"])
    music = audio.parent
    adjectives = ["Golden", "Quiet", "Electric", "Paper", "Velvet", "Burning", "Silver", "Distant"]
    nouns = ["River", "Summer", "Signal", "Avenue", "Echo", "Horizon", "Garden", "Mirror"]
    song_columns = [column for column in source.keys() if column != "id"]
    analysis_columns = [column for column in analysis.keys() if column != "song_id"]
    extra = max(songs - 12, 0)
    for number in range(extra):
        title = f"{adjectives[number % 8]} {nouns[(number // 8) % 8]} {number}"
        path = music / f"extra-{number:05d}.flac"
        # only the ones that can really play get a file, and a link to the same audio costs nothing
        if number < in_mix:
            os.link(audio, path)
        values = {
            **{column: source[column] for column in song_columns},
            "path": str(path),
            "title": title,
            "artist": f"Artist {number % 700}",
            "bpm": None,
        }
        values = {column: values[column] for column in song_columns}
        names = ",".join(song_columns)
        marks = ",".join("?" for _ in song_columns)
        cursor = conn.execute(f"INSERT INTO songs({names}) VALUES({marks})", list(values.values()))
        song_id = int(cursor.lastrowid)
        names = ",".join(["song_id", *analysis_columns])
        marks = ",".join("?" for _ in range(len(analysis_columns) + 1))
        row = [song_id, *[analysis[column] for column in analysis_columns]]
        conn.execute(f"INSERT INTO analysis({names}) VALUES({marks})", row)
        conn.execute("INSERT INTO lyrics(song_id,status) VALUES(?,?)", (song_id, "instrumental"))
        if number < in_mix:
            shutil.copy(features, features_path(settings, song_id))
    conn.commit()
    conn.execute("DELETE FROM queue")
    conn.commit()
    ids = [
        row[0]
        for row in conn.execute("SELECT id FROM songs WHERE id>14 ORDER BY id LIMIT ?", (in_mix,))
    ]
    for song_id in ids:
        mix.add_song(conn, song_id)
    conn.close()


def main() -> None:
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8821
    songs = int(sys.argv[2]) if len(sys.argv) > 2 else 20000
    in_mix = int(sys.argv[3]) if len(sys.argv) > 3 else 100
    home = Path(tempfile.mkdtemp(prefix="selecta-scale-"))
    atexit.register(shutil.rmtree, home, ignore_errors=True)
    os.environ["SELECTA_HOME"] = str(home)
    settings = build(home)
    grow(settings, songs, in_mix)
    app = create_app(settings, ROOT / "web" / "dist", prepare_links=False)
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning")


if __name__ == "__main__":
    main()
