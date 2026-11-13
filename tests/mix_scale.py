"""A large My Mixes fixture: hundreds of drafts, each with a full undo history of revisions.

Shared by the My Mixes scale tests and by anyone measuring the list and open paths by hand."""

from __future__ import annotations

import json
import random

from selecta import db
from selecta.config import ANALYSIS_VERSION, Settings
from selecta.seams import request_from

MIXES = 500
SONGS_PER_MIX = 20
REVISIONS = 20  # mix.UNDO_DEPTH: every draft has the deepest history Selecta keeps
LIBRARY = 2_000


def make_mixes(
    settings: Settings,
    mixes: int = MIXES,
    songs: int = SONGS_PER_MIX,
    revisions: int = REVISIONS,
    library: int = LIBRARY,
    ready_every: int = 3,
    in_line: int = 5,
    seed: int = 7,
) -> list[int]:
    """Fill a fresh home with `mixes` drafts and return their ids. Every draft holds `songs` songs
    and `revisions` earlier versions of itself; every `ready_every`th transition is already
    rendered on disk, and the first `in_line` drafts wait in the render line."""
    rng = random.Random(seed)
    conn = db.connect(settings.db_path)
    conn.executemany(
        "INSERT INTO songs(id,path,folder,size,mtime,duration,artist,title,is_music) "
        "VALUES(?,?,'f',1,1.0,200.0,?,?,1)",
        [(n, f"song-{n}.flac", f"Artist {n % 300}", f"Song {n}") for n in range(1, library + 1)],
    )
    conn.execute(
        "INSERT INTO analysis(song_id,version,bpm,camelot) SELECT id,?,120.0,'8A' FROM songs",
        (ANALYSIS_VERSION,),
    )
    seams = settings.renders_dir / "seams"
    rows = []
    for number in range(mixes):
        order = rng.sample(range(1, library + 1), songs)
        items = [[song, None, 0] for song in order]
        for index in range(1, songs, ready_every):
            key = request_from(order[index - 1], order[index], {}).key
            folder = seams / key
            folder.mkdir(parents=True, exist_ok=True)
            (folder / "seam.json").write_text(
                json.dumps(
                    {
                        "status": "ready",
                        "key": key,
                        "a_source_start": 150.0,
                        "b_source_end": 40.0,
                    }
                ),
                "utf-8",
            )
        history = [
            {
                "label": f"edit {step}",
                "name": f"Mix {number}",
                "items": [[song, json.dumps({"move": "blend"}), 0] for song in order],
            }
            for step in range(revisions)
        ]
        rows.append(
            (
                f"Mix {number}",
                json.dumps(items),
                json.dumps(history),
                number if number < in_line else None,
                f"2026-01-01 00:{number // 60 % 60:02d}:{number % 60:02d}",
            )
        )
    conn.executemany(
        "INSERT INTO drafts(name,items,history,line,updated_at) VALUES(?,?,?,?,?)", rows
    )
    conn.commit()
    ids = [row["id"] for row in conn.execute("SELECT id FROM drafts ORDER BY id")]
    conn.close()
    return ids
