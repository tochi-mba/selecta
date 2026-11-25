"""Matching a song to one MusicBrainz recording and choosing its cover's release (ADR-0478).

Every answer here is a hand-written fixture shaped like MusicBrainz's JSON, under
`tests/fixtures/catalog/`; nothing reaches the network.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from selecta.catalog import match

FIXTURES = Path(__file__).parent / "fixtures" / "catalog"
SONG = "Lanterns Over the Water"
ARTIST = "Night Harbour"
ALBUM_2024 = "bbbbbbbb-0000-4000-8000-000000000002"


def recordings(name: str) -> list[dict]:
    return json.loads((FIXTURES / f"{name}.json").read_text(encoding="utf-8"))["recordings"]


def query(seconds: float | None = 241.0, *, title: str = SONG, isrc: str | None = None):
    return match.Query(ARTIST, title, "Low Tide", seconds, isrc)


def test_an_isrc_hit_matches_with_full_confidence_and_groups_the_remaster():
    outcome = match.by_isrc(query(isrc="GBXYZ2400001"), recordings("isrc_two_recordings"))

    assert outcome.matched
    assert (outcome.method, outcome.confidence) == ("isrc", match.ISRC_CONFIDENCE)
    # the earliest official album with no secondary type is the cover, before the single
    assert outcome.release_ids[0] == ALBUM_2024
    assert outcome.recording_id == "aaaaaaaa-0000-4000-8000-000000000001"
    assert len(outcome.release_ids) == 4


def test_an_isrc_without_our_length_is_slightly_less_sure():
    outcome = match.by_isrc(query(None, isrc="GBXYZ2400001"), recordings("isrc_two_recordings"))

    assert outcome.matched and outcome.confidence == match.ISRC_NO_LENGTH_CONFIDENCE


def test_an_isrc_whose_recordings_disagree_with_our_length_falls_through_to_the_search():
    long_edit = query(300.0, isrc="GBXYZ2400001")
    assert match.by_isrc(long_edit, recordings("isrc_two_recordings")).status == "no_match"
    assert match.by_isrc(long_edit, []).status == "no_match"


def test_remasters_of_one_song_compete_as_one_group():
    outcome = match.choose(query(241.5), recordings("search_remasters"))

    assert outcome.matched and outcome.method == "search"
    assert outcome.confidence >= match.MIN_SCORE
    assert outcome.release_ids[0] == ALBUM_2024, "the original album beats the later remaster"
    assert {c.recording_id for c in outcome.candidates} == {
        "aaaaaaaa-0000-4000-8000-000000000001",
        "aaaaaaaa-0000-4000-8000-000000000002",
    }, "the unrelated title is dropped, not kept as a candidate"


def test_two_close_different_songs_are_ambiguous_and_not_a_match():
    outcome = match.choose(query(200.0, title="Lanterns"), recordings("search_two_close_songs"))

    assert outcome.status == "ambiguous"
    assert not outcome.matched and outcome.recording_id is None and outcome.release_ids == ()
    assert len(outcome.candidates) == 2, "both are kept for Wrong cover?"


def test_a_live_recording_is_not_the_studio_song():
    outcome = match.choose(query(241.0), recordings("search_live_only"))

    assert not outcome.matched
    assert outcome.status == "no_match"


@pytest.mark.parametrize(
    ("theirs", "ours", "kept"),
    [
        ("Lanterns Over the Water [Acoustic]", SONG, False),
        ("Lanterns Over the Water - Radio Remix", SONG, False),
        ("Lanterns Over the Water (Live)", "Lanterns Over the Water (Live)", True),
        ("Live Forever Tonight", "Live Forever Tonight", True),
    ],
)
def test_a_version_word_only_counts_in_their_brackets_or_dash_suffix(theirs, ours, kept):
    recording = {**recordings("search_live_only")[0], "title": theirs}

    assert (match.score(query(241.0, title=ours), recording) is not None) is kept


@pytest.mark.parametrize("ours", [236.9, 245.1])
def test_a_length_more_than_four_seconds_away_is_no_match(ours):
    outcome = match.choose(query(ours), recordings("search_remasters")[:1])

    assert outcome.status == "no_match" and outcome.candidates == ()


def test_the_search_needs_our_length():
    assert match.choose(query(None), recordings("search_remasters")).status == "no_match"


def release(rid: str, primary: str | None, date: str | None, *, status: str = "Official",
            secondary: tuple[str, ...] = ()) -> dict:
    group = {"primary-type": primary, "secondary-types": list(secondary)}
    return {"id": rid, "status": status, "date": date, "release-group": group}


def test_releases_rank_earliest_official_album_then_ep_single_and_the_rest():
    ranked = match.rank_releases([
        release("bootleg-album", "Album", "1999-01-01", status="Bootleg"),
        release("single", "Single", "2019-06-01"),
        release("broadcast", "Broadcast", "2017-01-01"),
        release("ep", "EP", "2020"),
        release("compilation", "Album", "2015-01-01", secondary=("Compilation",)),
        release("album-late", "Album", "2022-01-01"),
        release("album-early", "Album", "2021-03"),
        release("album-undated", "Album", None),
        release("album-early", "Album", "2021-03"),
    ])

    assert [r["id"] for r in ranked] == [
        "album-early", "album-late", "album-undated", "ep", "single", "compilation",
        "broadcast", "bootleg-album",
    ]


def test_the_lookup_key_is_shared_by_the_same_song_however_it_is_tagged():
    one = match.Query("Night Harbour feat. Somebody", "Lanterns Over the Water (Official Video)",
                      None, 241.2)
    two = match.Query("NIGHT HARBOUR", "Lanterns over the water", "Low Tide", 240.8)

    assert match.lookup_key(one) == match.lookup_key(two)
    assert match.lookup_key(query(isrc="GBXYZ2400001")) != match.lookup_key(query())
    assert one.sent()["artist"] == "Night Harbour"
    assert one.sent()["title"] == "Lanterns Over the Water"
