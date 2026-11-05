import random

from helpers import song_from_track
from synth import make_track

from selecta.planner.reel import _pick_pairs, lead_artist


def _library(tmp_path):
    songs = []
    for index, artist in enumerate(("Ana", "Ana feat. Bo", "Cy", "Di", "Ed")):
        song = song_from_track(tmp_path, f"s{index}", make_track(bars=48, seed=index))
        song.artist = artist
        songs.append(song)
    return songs


def test_featured_credits_count_as_the_same_artist(tmp_path):
    first, second, *_ = _library(tmp_path)
    assert lead_artist(first) == lead_artist(second)


def test_a_reel_never_pairs_an_artist_with_itself_or_reuses_one(tmp_path):
    library = _library(tmp_path)

    pairs = _pick_pairs("cut_on_one", library, {"cy"}, random.Random(1))

    assert pairs
    for _, a, b in pairs:
        assert lead_artist(a) != lead_artist(b)
        assert "cy" not in {lead_artist(a), lead_artist(b)}
