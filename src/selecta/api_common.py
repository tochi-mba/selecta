"""What the API's routes have in common: request bodies, limits, and the background worker."""

from __future__ import annotations

import io
import os
import re
import sqlite3
import subprocess
import sys
import threading
from pathlib import Path

import numpy as np
import soundfile as sf
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, StrictInt
from starlette.exceptions import HTTPException as StarletteHTTPException

from selecta.config import ANALYSIS_VERSION, SAMPLE_RATE

LOCAL_HOSTS = {"127.0.0.1", "localhost", "testserver"}


LINKS_KEEP_SECONDS = 600.0


VIBE_KEYS = {
    "pick",
    "peak",
    "house_party",
    "late_night",
    "afro_heat",
    "rap_run",
    "rnb_hours",
    "road_trip",
    "throwbacks",
    "sunday",
    "wordplay",
    "slow_burn",
}


API_VERSION = 2


API_FEATURES = [
    "library_pages",
    "readiness",
    "corrections",
    "pair_insert",
    "mix_order_guard",
    "operation_ids",
    "jobs",
    "diagnostics",
    "folders",
    "folder_check",
    "scan_cancel",
    "draft_restore_by_id",
    "export_jobs",
    "lucy",
    "flags",
]


CAMELOT = re.compile(r"^(1[0-2]|[1-9])[AB]$")


LOWEST_TEMPO, HIGHEST_TEMPO = 40.0, 240.0


OPERATIONS_KEPT = 200


SORTS = {
    "title": "lower(coalesce(s.title,''))",
    "artist": "lower(coalesce(s.artist,''))",
    "tempo": "coalesce(o.bpm, a.bpm, -1)",
    "recent": "-s.id",
}


PAGE_ADDRESSES = re.compile(
    r"^(listen|mixes|mix|library|discover|workshop|listening|explore|my-mixes|workspace|studies)"
    r"(/[\w/-]*)?$"
)


class FreshFiles(StaticFiles):
    """Always ask before reusing a saved copy. Without this, a browser went on showing the last
    reel's page after a new reel was served at the same address. An address that belongs to a page
    gets the app, so reloading works anywhere. Only those: a missing file or a bad API route still
    gets a real 404, not a page pretending everything's fine."""

    async def get_response(self, path, scope):
        try:
            response = await super().get_response(path, scope)
        except StarletteHTTPException as problem:
            address = path.replace("\\", "/")
            known = PAGE_ADDRESSES.match(address)
            # Old browser links get the app, which can explain that the page is missing.
            # and offers a way back. Anything else asking for a missing file still gets a real 404
            accepts = dict(scope.get("headers", [])).get(b"accept", b"")
            opened = b"text/html" in accepts and "." not in address.rsplit("/", 1)[-1]
            if problem.status_code != 404 or address.startswith("api") or not (known or opened):
                raise
            response = await super().get_response("index.html", scope)
        response.headers["Cache-Control"] = "no-cache"
        return response


class SteerRequest(BaseModel):
    action: str
    value: str | int | list[StrictInt] | None = None
    # T0096: what the page last saw for the setting it is replacing (null is a real value, so
    # whether it was sent at all is read from model_fields_set). Older pages leave it out.
    expected: str | int | list[StrictInt] | None = None


class StorageRequest(BaseModel):
    budget_gb: float
    # T0096: the limit the page last saw. Older pages that don't send it still work.
    expected_budget_bytes: int | None = None


class BuildRequest(BaseModel):
    start: int | None = None
    count: int = 12
    vibe: str = "balanced"


class AddRequest(BaseModel):
    song_id: int
    position: int | None = None


class RequestPlayback(BaseModel):
    order: list[int]
    position: int
    phase: str
    seconds_left: float


class RequestOfferAction(RequestPlayback):
    offer: str


class BridgeChoice(BaseModel):
    allow: bool
    songs: list[int] | None = None


class SongCorrection(BaseModel):
    """Anything left out is left alone. An explicit null puts that one back to what was detected."""

    bpm: float | None = None
    camelot: str | None = None
    is_music: bool | None = None
    clear: list[str] = []


class PairInsert(BaseModel):
    a: int
    b: int
    move: str | None = None
    phrase: str | None = None


class HearWhich(BaseModel):
    keys: list[str] | None = None


class PastTheSeam(BaseModel):
    after: float


class WhereItsPlaying(BaseModel):
    """Where playback is, if it's playing at all. Pages send an empty body when it isn't."""

    order: list[int] | None = None
    position: int | None = None


class MoveRequest(BaseModel):
    source: int
    target: int


class SeamSettings(BaseModel):
    move: str = "auto"
    shape: str | None = None
    bars: int | None = None
    exit_bar: int | None = None
    entry_bar: int | None = None
    phrase: str | None = None
    soft: bool = False


class StudioShape(BaseModel):
    shape: dict


class DraftRequest(BaseModel):
    name: str | None = None
    copy_current: bool = False


class LineMove(BaseModel):
    step: int


class TuneRequest(BaseModel):
    shape: dict | None = None


class RateRequest(BaseModel):
    rating: str
    note: str = ""


class DiscoveryReview(BaseModel):
    verdict: str


class ListeningResponse(BaseModel):
    listener: str
    choice: str
    setup: str
    quality: dict | None = None


class SkipFeedback(BaseModel):
    song_id: int
    heard_seconds: float
    source_position: float


class ScanRequest(BaseModel):
    folder: str


class NameRequest(BaseModel):
    name: str


class PairRequest(BaseModel):
    a: int
    b: int
    move: str
    phrase: str | None = None


SWAPS_REMEMBERED = 12


NEARBY_SONGS = 3


MOST_FROM_ONE_ARTIST = 2


def _counts(conn: sqlite3.Connection) -> dict[str, int]:
    row = conn.execute(
        "SELECT COUNT(*) total, SUM(is_music=0) set_aside, "
        "SUM(is_music=1 AND duplicate_of IS NULL) music FROM songs"
    ).fetchone()
    analysed = conn.execute(
        "SELECT COUNT(*) FROM analysis WHERE version=? AND error IS NULL", (ANALYSIS_VERSION,)
    ).fetchone()[0]
    lyrics = conn.execute("SELECT COUNT(*) FROM lyrics WHERE status='synced'").fetchone()[0]
    return {
        "total": row["total"] or 0,
        "music": row["music"] or 0,
        "set_aside": row["set_aside"] or 0,
        "analysed": analysed,
        "lyrics": lyrics,
    }


def _wav(audio: np.ndarray) -> bytes:
    buffer = io.BytesIO()
    sf.write(buffer, audio, SAMPLE_RATE, format="WAV", subtype="PCM_16")
    return buffer.getvalue()


HEARD_BEFORE_A_REQUEST = 2


HEARING_KEPT_SECONDS = 600.0


TIME_TO_MAKE_ANOTHER = 30.0


QUICK_FOR_A_LATE_SEAM = "echo_out"


FIRST_LOOK_SECONDS = 15.0


WATCH_EVERY_SECONDS = 60.0


"""How often to look for new songs. Looking only reads the folder's listing, so it costs little."""


class _Background:
    """One long job at a time of each kind, whose state the page can poll."""

    def __init__(self, home: Path) -> None:
        self.scan: dict = {"status": "idle"}
        self.scan_stop = threading.Event()
        self.found: dict | None = None
        self.paused = False
        self.looking = threading.Lock()
        self.settling = threading.Lock()
        self.analysis: subprocess.Popen | None = None
        self.asked: list[int] = []
        self.asking: threading.Thread | None = None
        self.lock = threading.Lock()
        self.home = home

    def analyse(self, *songs: int) -> subprocess.Popen:
        """Analysis at low priority, tied to the app so it stops when the app does."""
        wanted = [part for song in songs for part in ("--song", str(song))]
        return subprocess.Popen(
            [sys.executable, "-m", "selecta.cli", "analyse", "--from-app", *wanted],
            stdin=subprocess.PIPE,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            env={**os.environ, "SELECTA_HOME": str(self.home)},
        )

    def ask_for(self, song_id: int) -> list[int]:
        """Songs a person wants now wait in one line, however many they ask for. Each analysis
        process holds about a gigabyte, so one per click can fill the machine's memory."""
        with self.lock:
            if song_id not in self.asked:
                self.asked.append(song_id)
            if self.asking is None:
                self.asking = threading.Thread(target=self._work_through_asked, daemon=True)
                self.asking.start()
            return list(self.asked)

    def _work_through_asked(self) -> None:
        while True:
            with self.lock:
                batch = list(self.asked)
                if not batch:
                    self.asking = None
                    return
            try:
                self.analyse(*batch).wait()
            finally:
                with self.lock:
                    self.asked = [song for song in self.asked if song not in batch]
