"""GP-0259: every promise a mix card makes is checked against what the planner really builds.

Seeded planner fixtures: a 36-song, six-family library (``_vibe_library``) and a six-song,
one-genre library for the sparse case. Each card is described, then built with a fixed seed.
"""

from __future__ import annotations

import pytest
from helpers import song_from_track
from mix_helpers import _vibe_library, client  # noqa: F401
from synth import make_track

from selecta.planner import vibes
from selecta.planner.vibes import (
    BY_KEY,
    MIN_SONGS,
    MOVE_WORDS,
    build_vibe,
    candidate_vibes,
    describe,
    eligible,
    evidence,
)


def test_gp0259_01_every_card_promise_holds_in_a_seeded_build(tmp_path):
    songs, traits = _vibe_library(tmp_path)
    audited = 0
    for vibe in candidate_vibes(songs, traits):
        card = describe(vibe, songs, traits)
        found = eligible(vibe, songs, traits)
        found_ids = {song.id for song in found}
        # count, duration and artists are read from the songs that can really play
        assert card["songs"] == len(found)
        assert card["ready"] == (len(found) >= MIN_SONGS)
        assert set(card["artists"]) <= {song.artist for song in found}
        if card["tempo"]:
            felt = sorted(traits[song.id].felt for song in found)
            assert felt[0] <= card["tempo"][0] <= card["tempo"][1] <= felt[-1]
        if not card["ready"]:
            continue
        planned, _ = build_vibe(vibe, songs, traits, {}, 8, seed=7)
        audited += 1
        assert planned, vibe.key
        # nothing outside the card's own pool, and a family card never strays from its family
        assert {item.song.id for item in planned} <= found_ids, vibe.key
        if vibe.family:
            assert {item.song.family for item in planned} == {vibe.family}
            assert card["family"]
        # a non-seasonal idea never slips in a Christmas song
        if not vibe.seasonal:
            assert not any(traits[item.song.id].seasonal for item in planned)
    assert audited >= 10


def test_gp0259_01_moves_line_follows_the_listeners_saved_transition_feel(tmp_path):
    songs, traits = _vibe_library(tmp_path)
    peak = BY_KEY["peak"]
    assert describe(peak, songs, traits)["moves"] == MOVE_WORDS["seamless"]
    # build_vibe plans with the listener's feel over the idea's own; the card must say the same
    assert describe(peak, songs, traits, "punchy")["moves"] == MOVE_WORDS["punchy"]
    assert describe(peak, songs, traits, "made-up")["moves"] == MOVE_WORDS["seamless"]


def test_gp0259_01_the_vibes_route_describes_the_saved_transition_feel(client, monkeypatch):  # noqa: F811
    monkeypatch.setattr(vibes, "candidate_vibes", lambda _songs, _traits: (BY_KEY["peak"],))
    assert client.get("/api/vibes").json()[0]["moves"] == MOVE_WORDS["seamless"]
    client.post("/api/steer", json={"action": "mix_language", "value": "punchy"}).raise_for_status()
    assert client.get("/api/vibes").json()[0]["moves"] == MOVE_WORDS["punchy"]


def test_gp0259_02_cards_share_the_same_comparable_fields(tmp_path):
    songs, traits = _vibe_library(tmp_path)
    cards = [describe(vibe, songs, traits) for vibe in candidate_vibes(songs, traits)]
    fields = {"songs", "seconds", "tempo", "family", "moves", "basis", "ready", "needs"}
    assert all(fields <= set(card) for card in cards)
    assert all(isinstance(card["songs"], int) and card["seconds"] >= 0 for card in cards)


def _one_genre_library(tmp_path, count=6):
    from selecta.planner.vibes import traits_of

    track = make_track(bpm=118, bars=64, seed=3)
    songs = []
    for i in range(count):
        song = song_from_track(tmp_path, f"a{i}", track, genre="Afrobeats")
        song.id, song.artist, song.bpm, song.energy = (
            i + 1,
            f"Artist {i}",
            104.0 + i,
            0.4 + i * 0.05,
        )
        songs.append(song)
    return songs, traits_of(songs, {})


def test_gp0259_03_a_six_song_one_genre_library_says_what_is_eligible_and_what_is_not(tmp_path):
    songs, traits = _one_genre_library(tmp_path)
    cards = {card["key"]: card for card in (describe(v, songs, traits) for v in vibes.VIBES)}
    assert cards["pick"]["ready"] and cards["afro_heat"]["ready"]
    for key in ("rap_run", "rnb_hours", "guitars"):
        assert not cards[key]["ready"]
        assert cards[key]["needs"] == MIN_SONGS  # none of six Afrobeats songs can count
    # only family journeys the library really supports are offered
    offered = {vibe.key for vibe in candidate_vibes(songs, traits)}
    assert "slow_burn__afro" in offered and "slow_burn__hiphop" not in offered


def test_gp0259_03_an_unavailable_idea_is_refused_by_the_build_route(client):  # noqa: F811
    answer = client.post("/api/vibes/rap_run/build?count=12")
    assert answer.status_code == 400
    assert "needs more analysed songs" in answer.json()["detail"]


def test_gp0259_07_cards_name_only_the_evidence_their_songs_were_measured_for():
    assert evidence(BY_KEY["rap_run"]) == [
        "genre tags",
        "energy",
        "lyric themes",
        "how wordy the lyrics are",
    ]
    assert evidence(BY_KEY["throwbacks"]) == ["energy", "hook strength", "release year"]
    # a broad journey says nothing about genre or mood until it is bound to a family
    assert evidence(BY_KEY["slow_burn"]) == ["energy"]
    family = vibes.family_vibe(BY_KEY["slow_burn"], "afro")
    assert evidence(family) == ["genre tags", "energy"]
    # mood ideas that read lyrics say so; none claims lyric themes without reading them
    assert "lyric themes" in evidence(BY_KEY["feelings"])
    # Sunday morning ranks by key but does not require it, so it does not promise major keys
    assert "in major keys" not in BY_KEY["sunday"].blurb


@pytest.mark.parametrize("key", ["peak", "afro_heat", "feelings"])
def test_gp0259_07_card_basis_is_in_the_payload(tmp_path, key):
    songs, traits = _vibe_library(tmp_path)
    assert describe(BY_KEY[key], songs, traits)["basis"] == evidence(BY_KEY[key])
