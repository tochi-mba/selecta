"""EX-0125-01: word connections are only ever built from timed lyrics.

A song whose lyrics were found only as plain, untimed text has no line times, so it can never offer a
shared word at a known moment. It must not reach the word-link search at all.
"""

from selecta import db
from selecta.discovery import search

LRC = "[00:10.00]we keep on dancing\n[00:14.00]until the morning light\n"


def test_untimed_lyrics_never_reach_word_links(tmp_path, monkeypatch):
    conn = db.connect(tmp_path / "test.sqlite")
    conn.executemany(
        "INSERT INTO songs(id,path,folder,size,mtime,duration,artist,title) VALUES(?,?,?,?,?,?,?,?)",
        [(song, f"{song}.wav", "", 1, 0.0, 60.0, "Same Artist", "Same Title") for song in (1, 2, 3)],
    )
    conn.execute("INSERT INTO lyrics(song_id,status,synced) VALUES(1,'synced',?)", (LRC,))
    conn.execute("INSERT INTO lyrics(song_id,status,plain) VALUES(2,'plain',?)", ("we keep on dancing",))
    conn.execute("INSERT INTO lyrics(song_id,status,synced,plain) VALUES(3,'plain',NULL,'until the morning light')")
    conn.commit()
    seen: dict = {}

    def capture(lines, limit, facts):
        seen.update(lines=lines, facts=facts)
        return []

    monkeypatch.setattr(search, "discover", capture)
    assert search.lyric_links(conn) == []
    assert set(seen["lines"]) == {1}
    assert set(seen["facts"]) == {1}
    assert seen["lines"][1], "the timed song keeps its timed lines"
