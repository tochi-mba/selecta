"""How long a song or a mix hosted processing takes on, said before any job runs (T-20261125-4c09).

Premium stores uploads of up to 2 hours and Standard up to 1 hour (`Plan.max_upload_seconds`),
but the server's jobs have runtime limits: analysis may run 1,200 s, a playback file 180 s, an
export 30 minutes. A one-hour track would run analysis for most of an hour and then fail on the
limit. So the limits are decided up front, from the song's stored length:

- **Songs up to `MAX_SONG_S` (30 minutes) are processed**; a longer one is never given a job. It
  stays in the library and plays from its original, and the hosted card shows it as not
  processed with `TOO_LONG` (its length and the limit), with no Try again, at once.
- **Each job's runtime limit follows the song** (`analysis_run_s`, `proxy_run_s`), never below
  the catalogue's figure: analysis measured 0.17 to 0.5 times the song's length on a quiet
  4 vCPU worker (1.7 times on a loaded laptop), so `ANALYSIS_FACTOR` 1.2 leaves more than twice
  the quiet worst case (a 30-minute song may run 36 minutes); a playback file took up to 9.7 s
  per minute of audio loaded, so `PROXY_FACTOR` 0.3 (18 s a minute) leaves about twice that.
  Memory is bounded: a 30-minute stereo song is about 0.6 GB of float32 samples, on 8 GB
  cpu-heavy workers; the playback file and the export are written as streams.
- **An export is at most `MAX_EXPORT_S` (4 hours)**, about 2.8 GB of 24-bit FLAC at 11.7 MB a
  minute, under R2's 5 GB single upload and joined at about 75 times real time, well inside the
  30-minute `export.render` limit. A longer mix is refused with `EXPORT_TOO_LONG` before any job
  is made.
"""

from __future__ import annotations

MAX_SONG_S = 30 * 60
MAX_EXPORT_S = 4 * 3600
ANALYSIS_FACTOR = 1.2
PROXY_FACTOR = 0.3
ANALYSIS_MIN_RUN_S = 1_200.0
PROXY_MIN_RUN_S = 180.0


def _clock(seconds: float) -> str:
    minutes = round(seconds / 60)
    hours, rest = divmod(minutes, 60)
    if not hours:
        return f"{minutes} minutes"
    return f"{hours} hour{'s' if hours > 1 else ''}" + (f" {rest} minutes" if rest else "")


def too_long(duration_s: float | None) -> str | None:
    """The reason a song isn't processed, or None when it fits."""
    if duration_s is None or float(duration_s) <= MAX_SONG_S:
        return None
    return (f"This song is {_clock(float(duration_s))} long. SelectaDJ's servers prepare songs "
            f"of up to {_clock(MAX_SONG_S)} for mixes, so it stays in your library and plays on "
            "its own, but can't join a server mix.")


def export_too_long(seconds: float) -> str | None:
    if seconds <= MAX_EXPORT_S:
        return None
    return (f"This mix is {_clock(seconds)} long; an export can be at most "
            f"{_clock(MAX_EXPORT_S)}. Make a shorter mix to export it.")


def analysis_run_s(duration_s: float | None) -> float:
    return max(ANALYSIS_MIN_RUN_S, ANALYSIS_FACTOR * float(duration_s or 0.0))


def proxy_run_s(duration_s: float | None) -> float:
    return max(PROXY_MIN_RUN_S, PROXY_FACTOR * float(duration_s or 0.0))


__all__ = ["MAX_EXPORT_S", "MAX_SONG_S", "analysis_run_s", "export_too_long", "proxy_run_s",
           "too_long"]
