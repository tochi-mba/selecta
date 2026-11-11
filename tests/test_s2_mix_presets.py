"""T0143: preset, sparse-library, failed-build and double-click safety."""

from __future__ import annotations

import pytest
from mix_helpers import _vibe_library, client  # noqa: F401

from selecta.planner.vibes import (
    MIN_SONGS,
    VIBES,
    build_vibe,
    candidate_vibes,
    describe,
    eligible,
    resolve_vibe,
)


def _order(client) -> list[int]:  # noqa: F811
    return [item["song_id"] for item in client.get("/api/mix").json()["mix"]]


def test_all_current_presets_have_unique_keys_and_are_resolvable():
    assert len(VIBES) == 26
    assert len({vibe.key for vibe in VIBES}) == len(VIBES)
    for vibe in VIBES:
        resolved = resolve_vibe(vibe.key)
        assert resolved is not None and resolved.key == vibe.key


@pytest.mark.parametrize("key", [vibe.key for vibe in VIBES])
def test_every_preset_builds_only_from_its_own_songs_or_is_honestly_unavailable(tmp_path, key):
    songs, traits = _vibe_library(tmp_path)
    vibe = resolve_vibe(key)
    assert vibe is not None
    fitting = {song.id for song in eligible(vibe, songs, traits)}
    if len(fitting) < MIN_SONGS:
        # A preview may show a disabled idea, but must honestly disclose how
        # many more eligible songs it needs instead of claiming it can play.
        card = describe(vibe, songs, traits)
        assert card["ready"] is False
        assert card["songs"] == len(fitting)
        assert card["needs"] == MIN_SONGS - len(fitting)
        for offered in candidate_vibes(songs, traits):
            if offered.key == key:
                assert describe(offered, songs, traits)["ready"] is False
        return
    planned, seams = build_vibe(vibe, songs, traits, {}, MIN_SONGS, seed=1)
    ids = [item.song.id for item in planned]
    assert ids, key
    assert set(ids) <= fitting, key
    assert len(ids) == len(set(ids)), key
    assert set(seams) <= set(ids[1:]), key


def test_every_family_journey_card_builds_inside_its_family(tmp_path):
    songs, traits = _vibe_library(tmp_path)
    family_cards = [card for card in candidate_vibes(songs, traits) if card.family]
    assert family_cards
    by_id = {song.id: song for song in songs}
    for card in family_cards:
        planned, _ = build_vibe(card, songs, traits, {}, MIN_SONGS, seed=2)
        assert planned and all(by_id[item.song.id].family == card.family for item in planned)


def test_a_sparse_library_refuses_the_build_and_keeps_the_current_mix(client):  # noqa: F811
    client.post("/api/mix/songs", json={"song_id": 1})
    before = _order(client)
    refused = client.post("/api/vibes/pick/build")
    assert refused.status_code == 400
    assert "needs more analysed songs" in refused.json()["detail"]
    assert _order(client) == before


def test_a_failed_build_changes_nothing_and_makes_no_empty_draft(client, monkeypatch):  # noqa: F811
    client.post("/api/mix/songs", json={"song_id": 1})
    before = _order(client)
    drafts_before = client.get("/api/drafts").json()
    monkeypatch.setattr(
        "selecta.planner.vibes.eligible", lambda _vibe, _songs, _traits: list(range(100))
    )

    def fails(*_args, **_kwargs):
        raise ValueError("No valid transition route reaches that song in this mix.")

    monkeypatch.setattr("selecta.planner.vibes.build_vibe", fails)
    for path in ("/api/vibes/pick/build", "/api/vibes/pick/build?as_draft=true"):
        failed = client.post(path)
        assert failed.status_code == 400
        assert "No valid transition route" in failed.json()["detail"]
    assert _order(client) == before
    assert client.get("/api/drafts").json() == drafts_before
    assert client.post("/api/vibes/not_a_preset/build").status_code == 404
    assert _order(client) == before


def test_a_second_click_on_a_changed_mix_is_refused_without_replacing_it(
    client,
    monkeypatch,  # noqa: F811
):
    client.post("/api/mix/songs", json={"song_id": 1})
    monkeypatch.setattr(
        "selecta.planner.vibes.eligible", lambda _vibe, _songs, _traits: list(range(100))
    )

    class Planned:
        def __init__(self, song_id):
            self.song = type("Song", (), {"id": song_id})

    monkeypatch.setattr(
        "selecta.planner.vibes.build_vibe",
        lambda *_args, **_kwargs: ([Planned(2), Planned(1)], {}),
    )
    original_order = ",".join(str(song) for song in _order(client))
    first = client.post(
        "/api/vibes/pick/build", headers={"x-mix-order": original_order}
    )
    assert first.status_code == 200, first.text
    assert _order(client) == [2, 1]
    # The second click still carries the order seen before the first one landed.
    second = client.post(
        "/api/vibes/pick/build", headers={"x-mix-order": original_order}
    )
    assert second.status_code == 409
    assert second.json()["code"] == "mix_changed"
    assert _order(client) == [2, 1]
