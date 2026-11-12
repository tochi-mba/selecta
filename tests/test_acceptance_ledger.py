"""T0004: the code-checkable claims in docs/acceptance.md still match the code.

Each test names the ledger row it checks. Rows measured on the owner's real library (scan counts,
analysis times, lyric coverage, request fits, rating tallies) are not checked here: those need the
owner to re-measure. When one of these fails, update the ledger row or flag it as historical; do not
just change the number in the test.
"""

from pathlib import Path

from selecta import api_common, mix, request_planner
from selecta.discovery import search
from selecta.lyrics import lrclib
from selecta.planner import beam, prepare, vibes, wordreel
from selecta.styles import wordplay

ROOT = Path(__file__).resolve().parents[1]
LEDGER = (ROOT / "docs" / "acceptance.md").read_text(encoding="utf-8")


def test_word_cut_needs_tempos_within_6_percent():
    assert "Now needs tempos within 6%" in LEDGER
    assert wordreel.CUT_MAX_GAP == 0.06


def test_find_a_bridge_goes_up_to_3_extra_songs():
    assert "up to 3 extra songs" in LEDGER
    assert request_planner.MOST_EXTRA_WHEN_ASKED == 3


def test_songs_always_get_played_for_30_seconds():
    assert "has finished, plus 30 seconds" in LEDGER
    assert mix.SHORTEST_STAY == 30.0


def test_new_songs_are_looked_for_every_minute():
    assert "Looks every minute" in LEDGER
    assert api_common.WATCH_EVERY_SECONDS == 60.0


def test_spare_time_takes_the_top_30_links_and_stops_at_80_percent():
    assert "After the top 30 word links" in LEDGER and "Stops at 80% of the storage limit" in LEDGER
    assert prepare.LINKS_TO_PREPARE == 30
    assert prepare.USE_OF_STORAGE == 0.8


def test_rides_allow_up_to_40_ms():
    assert "rides allow up to 40 ms" in LEDGER
    assert wordplay._RIDE_BEAT_LIMIT_MS == 40.0


def test_quick_search_samples_80_partners_and_keeps_3_per_song():
    claim = "samples up to 80 partners per song and caps harmonic matches at three per song"
    assert claim in LEDGER
    assert search.COMPARED_PER_SONG == 80
    assert search.MOST_PER_SONG == 3


def test_planner_keeps_artists_10_apart():
    assert "artists kept 10 apart" in LEDGER
    assert beam.ARTIST_SEPARATION == 10


def test_mix_count_and_headings():
    assert "Twenty-five mixes under four headings" in LEDGER
    grouped = [vibe for vibe in vibes.VIBES if vibe.group]
    assert len(grouped) == 25
    headings = {"The moment", "The mood", "The sound", "The journey"}
    assert {vibe.group for vibe in grouped} == headings
    assert len(vibes.VIBES) - len(grouped) == 1  # Selecta's pick


def test_local_only_server_and_lyric_lookups():
    assert "Foreign hosts and other sites' changes get 403" in LEDGER
    assert api_common.LOCAL_HOSTS == {"127.0.0.1", "localhost", "testserver"}
    assert "Selecta is local only" in (ROOT / "src/selecta/api.py").read_text(encoding="utf-8")
    assert 'host="127.0.0.1"' in (ROOT / "src/selecta/cli.py").read_text(encoding="utf-8")
    disclosure = (
        "| Nothing leaves this computer | Every page's requests stay on this computer | "
        "Lyric lookups by the server still go to lrclib.net unless turned off |"
    )
    assert disclosure in LEDGER.splitlines()
    assert lrclib.API == "https://lrclib.net/api"


def test_flagged_rows_say_what_changed():
    assert "Historical: an override once needed the database" in LEDGER
    assert "Library still adds to the current mix only" in LEDGER
    assert "restores unfinished quality grades" in LEDGER
    assert "Folder entry is typed, not picked" in LEDGER
    web = ROOT / "web" / "src"
    sources = "".join(path.read_text(encoding="utf-8") for path in web.rglob("*.tsx"))
    assert "showDirectoryPicker" not in sources and "webkitdirectory" not in sources


def test_real_library_measurements_are_flagged_as_historical_snapshots():
    note = LEDGER.split("## Works", 1)[0]
    assert "tests/test_acceptance_ledger.py" in note
    assert "**historical snapshot**" in note and "not re-measured since" in note
    # the snapshot and the measured batches carry the date they were true on
    for dated in (
        "Latest live-library snapshot - 5 November 2026",
        "Local export batch - 5 November 2026",
        "Measured on 6 November",
    ):
        assert dated in LEDGER
