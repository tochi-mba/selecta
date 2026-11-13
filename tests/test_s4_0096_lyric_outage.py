"""S4-0096-07: a lyric service outage fails single lookups, never the whole run or the music."""

from __future__ import annotations

import httpx
from mix_helpers import _song_row

from selecta import db
from selecta.config import Settings
from selecta.lyrics import lrclib


def test_a_non_json_outage_page_fails_one_song_and_the_rest_continue(tmp_path, monkeypatch):
    conn = db.connect(Settings(tmp_path).db_path)
    _song_row(conn, 1, "Someone", "Down Today")
    _song_row(conn, 2, "Someone Else", "Fine Today")
    conn.commit()

    def answer(request: httpx.Request) -> httpx.Response:
        if request.url.params.get("track_name") == "Down Today":
            return httpx.Response(200, text="<html>Service unavailable</html>")
        found = {"syncedLyrics": "[00:01.00] hello", "plainLyrics": "hello"}
        return httpx.Response(200, json=found)

    client = httpx.Client(transport=httpx.MockTransport(answer))
    real = lrclib.LrcLib
    monkeypatch.setattr(lrclib, "LrcLib", lambda: real(client))
    monkeypatch.setattr(lrclib, "REQUEST_SPACING_SECONDS", 0)
    counts = lrclib.fetch_all(conn)

    assert counts == {"network error": 1, "synced": 1}
    rows = conn.execute("SELECT song_id, status FROM lyrics")
    saved = {row["song_id"]: row["status"] for row in rows}
    assert saved == {2: "synced"}  # the failed song stays unlooked-up, so it is tried again later
