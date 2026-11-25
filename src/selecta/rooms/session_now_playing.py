"""What is playing in a party room, read from the account's playback session (ADR-0488).

A room used to be told nothing about the music: the cloud app wired no now-playing source, so
the guest page and the big screen said "Nothing playing yet" over a mix that was playing. The
speaker already tells the playback session which programme it plays and where it is in it, and
a venue room already reads that (`business.rooms.ports.SessionPlayback`). This is the same
reading for a personal workspace's one session.

A song that is loaded but paused is still named, with `state` saying it is paused, so the room
can say what is loaded instead of "nothing". Stopped music, no programme, or a position outside
the programme all mean nothing is playing.

Guests learn only what `SongSummary` carries. A song deleted from the library since it was
queued is left out rather than shown as a blank.
"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.engine import Engine

from selecta.local_media.schema import local_songs
from selecta.persistence import db_now, transaction
from selecta.playback.model import PlayState, position_at
from selecta.playback.store import load_session
from selecta.rooms.ports import NowPlaying, SongSummary

UP_NEXT_SHOWN = 3


class SessionNowPlaying:
    def __init__(self, engine: Engine) -> None:
        self.engine = engine

    def now_playing(self, workspace_id: str) -> NowPlaying:
        with transaction(self.engine, workspace_id) as conn:
            session = load_session(conn, workspace_id)
            if session is None or session.state is PlayState.STOPPED:
                return NowPlaying(None)
            programme = session.programme or ()
            index = session.song_index
            if not 0 <= index < len(programme):
                return NowPlaying(None)
            wanted = [ref.song_id for ref in programme[index : index + 1 + UP_NEXT_SHOWN]]
            rows = conn.execute(
                sa.select(
                    local_songs.c.id,
                    local_songs.c.title,
                    local_songs.c.artist,
                    local_songs.c.duration_s,
                ).where(
                    local_songs.c.workspace_id == workspace_id,
                    local_songs.c.id.in_(wanted),
                    local_songs.c.deleted_at.is_(None),
                )
            )
            songs = {
                int(row.id): SongSummary(
                    song_id=int(row.id),
                    title=row.title,
                    artist=row.artist,
                    length_s=float(row.duration_s or 0.0),
                )
                for row in rows
            }
            current = songs.get(wanted[0])
            if current is None:
                return NowPlaying(None)
            offset_ms = position_at(session, db_now(conn)).offset_ms
        return NowPlaying(
            current=current,
            up_next=tuple(songs[song_id] for song_id in wanted[1:] if song_id in songs),
            state="playing" if session.state is PlayState.PLAYING else "paused",
            mix_key=session.mix_revision_id or "",
            song_index=index,
            offset_s=max(0.0, offset_ms / 1000.0),
        )

    def minutes_until(self, workspace_id: str, song_request_id: str) -> float | None:
        # The host's browser places each request by hand (`BrowserPlanner`), so the server
        # cannot know when one will be heard.
        return None


__all__ = ["SessionNowPlaying"]
