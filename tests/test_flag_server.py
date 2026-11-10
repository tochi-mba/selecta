"""What the server does when a feature flag is off: it refuses the feature's routes, makes none of
its moves, offers none of its mix ideas, and does none of its background work."""

from __future__ import annotations

import re
from collections import Counter

import numpy as np
import pytest
from cloud_helpers import make_cloud_app
from fastapi.testclient import TestClient
from mix_helpers import _same_songs, _song_row, _takes

from selecta import db, flags
from selecta.api import create_app
from selecta.config import Settings
from selecta.seams import SeamStore

WITH_ROUTES = [
    flag.id
    for flag in flags.registry().values()
    if flag.routes and not flag.core and "local" in flag.modes
]
CLOUD_WITH_ROUTES = [
    flag.id
    for flag in flags.registry().values()
    if flag.routes and not flag.core and "local" not in flag.modes
]


@pytest.fixture
def app_client(tmp_path):
    settings = Settings(tmp_path)
    conn = db.connect(settings.db_path)
    for song_id in (1, 2):
        _song_row(conn, song_id, f"Artist {song_id}", f"Song {song_id}")
    conn.commit()
    conn.close()
    return TestClient(create_app(settings, tmp_path / "no-web"))


def _call(client: TestClient, route: str):
    method, template = route.split(" ", 1)
    path = re.sub(r"\{[^}]+\}", "1", template)
    return client.request(method, path, json={})


@pytest.mark.parametrize("flag_id", WITH_ROUTES)
def test_every_route_of_a_turned_off_feature_is_refused(app_client, flag_id):
    flags.use(f"-{flag_id}")
    for route in flags.registry()[flag_id].routes:
        response = _call(app_client, route)
        assert response.status_code == 403, route
        body = response.json()
        assert body["code"] == "flag_off" and body["flag"] == flag_id, route
        assert "turned off in this build" in body["detail"]


@pytest.fixture
def cloud_client(tmp_path):
    app, engine, _ = make_cloud_app(tmp_path)
    with TestClient(app) as client:
        yield client
    engine.dispose()


@pytest.mark.parametrize("flag_id", CLOUD_WITH_ROUTES)
def test_every_cloud_route_of_a_turned_off_feature_is_refused(cloud_client, flag_id):
    """Cloud-only features are refused by the cloud app before sign-in is even checked."""
    flags.use(f"-{flag_id}")
    for route in flags.registry()[flag_id].routes:
        response = _call(cloud_client, route)
        assert response.status_code == 403, route
        body = response.json()
        assert body["code"] == "flag_off" and body["flag"] == flag_id, route


def test_a_feature_that_needs_one_thats_off_is_refused_too(app_client):
    flags.use("-requests")
    response = _call(app_client, "POST /api/requests/{request_id}/bridges")
    assert response.status_code == 403 and response.json()["flag"] == "requests.bridges"


def test_status_says_which_flags_are_on(app_client):
    flags.use("-requests")
    status = app_client.get("/api/status").json()
    assert status["flags"]["requests"] is False and status["flags"]["drafts"] is True
    assert set(status["flags"]) == set(flags.registry())
    assert "flags" in status["api"]["features"]


def test_a_refusal_isnt_replayed_once_the_feature_is_back(app_client):
    flags.use("-drafts")
    headers = {"x-operation-id": "draft-1"}
    assert app_client.post("/api/drafts", json={}, headers=headers).status_code == 403
    flags.use("")
    assert app_client.post("/api/drafts", json={}, headers=headers).status_code != 403


def test_routes_of_features_that_are_on_are_left_alone(app_client):
    flags.use("minimal")
    assert app_client.get("/api/status").status_code == 200
    assert app_client.get("/api/mix").status_code == 200


def test_a_bad_setting_stops_the_server_starting(tmp_path, monkeypatch):
    monkeypatch.setenv(flags.ENV, "-requets")
    flags.use(None)
    with pytest.raises(flags.FlagError, match="Did you mean requests"):
        create_app(Settings(tmp_path), tmp_path / "no-web")


# ---- transition moves


def test_a_move_thats_off_is_never_offered_or_fallen_back_to():
    from selecta.seam_kinds import fallback_order, moves_on

    flags.use("-move.echo_out -move.vocal_ride")
    assert "echo_out" not in moves_on() and "cut_on_one" in moves_on()
    order = fallback_order(1, 2, True, Counter())
    assert "echo_out" not in order and "vocal_ride" not in order and "delay_throw" in order


def test_status_names_only_the_moves_that_are_on(app_client):
    flags.use("-move.* -stems")
    moves = app_client.get("/api/status").json()["moves"]
    assert set(moves) == {"auto", "cut_on_one"}


def test_a_saved_seam_with_a_move_thats_off_is_let_selecta_pick():
    from selecta.seam_kinds import request_from

    seam = {"move": "delay_throw", "bars": 8}
    flags.use("-move.delay_throw")
    assert request_from(1, 2, seam).move == "auto"
    assert seam["move"] == "delay_throw", "nothing saved is changed"
    flags.use("")
    assert request_from(1, 2, seam).move == "delay_throw"


def test_choosing_a_move_thats_off_is_refused(app_client):
    flags.use("-move.reverb_wash")
    response = app_client.post("/api/mix/1/seam", json={"move": "reverb_wash"})
    assert response.status_code == 403 and response.json()["flag"] == "move.reverb_wash"


def test_the_planner_never_picks_a_move_thats_off(tmp_path):
    from selecta.planner.vibes import BY_KEY, seam_choices

    planned = _same_songs(tmp_path, 9)
    for item in planned:
        item.song.grid_confidence = 0.95
    flags.use("-move.vocal_ride -move.bass_swap_blend -move.filter_sweep")
    for seed in range(4):
        seams = seam_choices(BY_KEY["pick"], planned, {}, np.random.default_rng(seed))
        moves = {seams[item.song.id]["move"] for item in planned[1:] if item.song.id in seams}
        assert not moves & {"vocal_ride", "bass_swap_blend", "filter_sweep"}, moves


def test_with_stems_off_the_planner_makes_no_stem_moves(tmp_path):
    from selecta.planner.vibes import BY_KEY, seam_choices
    from selecta.seam_kinds import STEM_MOVES

    planned = _same_songs(tmp_path, 9)
    for item in planned:
        item.song.grid_confidence = 0.95
    flags.use("-stems")
    seams = seam_choices(BY_KEY["pick"], planned, {}, np.random.default_rng(1), stems="often")
    assert not {seam["move"] for seam in seams.values()} & STEM_MOVES


def test_without_second_takes_the_first_move_that_renders_is_kept(tmp_path, monkeypatch):
    from mix_helpers import _report, _two_songs

    store = SeamStore(Settings(tmp_path))
    a, b = _two_songs(tmp_path)
    failing = _report(("beat alignment", 60.0, 15.0))
    _takes(store, monkeypatch, {"filter_sweep": failing, "bass_swap_blend": _report()})
    monkeypatch.setattr(store, "mix_moves", lambda: Counter({"bass_swap_blend": 3}))
    flags.use("-render.repair")
    rendered, _report_, _why, _fell_back = store._best_move(a, b, [])
    assert rendered == "take of filter_sweep"


def test_with_stems_off_nothing_is_separated(tmp_path):
    from selecta.stems import separate_window

    flags.use("-stems")
    with pytest.raises(flags.FlagOff):
        separate_window(Settings(tmp_path), tmp_path / "song.flac", 0.0)


# ---- mix ideas


def _cards(songs, traits):
    from selecta.planner.vibes import candidate_vibes

    return [vibe.key for vibe in candidate_vibes(songs, traits)]


def test_without_mix_ideas_only_selectas_pick_is_left():
    from selecta.planner.vibes import resolve_vibe

    flags.use("-mixes.ideas")
    assert _cards([], {}) == ["pick"]
    assert resolve_vibe("house_party") is None and resolve_vibe("pick") is not None


def test_seasonal_and_wordplay_ideas_have_their_own_flags():
    from selecta.planner.vibes import resolve_vibe

    flags.use("-mixes.seasonal -mixes.wordplay_showcase")
    assert resolve_vibe("christmas") is None and resolve_vibe("wordplay") is None
    assert "christmas" not in _cards([], {})


def test_without_single_genre_journeys_a_journey_draws_from_everything():
    from selecta.planner.vibes import COHESIVE_JOURNEYS, resolve_vibe

    flags.use("-mixes.genre_variants")
    cards = _cards([], {})
    assert not [key for key in cards if "__" in key]
    assert COHESIVE_JOURNEYS - {"wordplay"} <= set(cards)
    assert resolve_vibe("slow_burn__afro") is None


# ---- lyrics


def test_with_lyric_lookup_off_nothing_is_sent(tmp_path, monkeypatch):
    from selecta.lyrics import lrclib

    def no_network(*_args, **_kwargs):
        raise AssertionError("nothing should be sent to LRCLIB")

    monkeypatch.setattr(lrclib.LrcLib, "lookup", no_network)
    conn = db.connect(Settings(tmp_path).db_path)
    _song_row(conn, 1, "Someone", "Something")
    conn.commit()
    flags.use("-lyrics.lookup")
    assert lrclib.fetch_all(conn) == {}


def test_with_lyric_lookup_off_a_song_without_lyrics_is_ready(app_client):
    with_lookup = app_client.get("/api/library?state=ready").json()
    flags.use("-lyrics.lookup")
    without = app_client.get("/api/library?state=ready").json()
    assert without["total"] >= with_lookup["total"]


# ---- Lucy


def test_a_lucy_phase_is_on_only_when_the_build_and_the_person_both_say_so(tmp_path):
    from selecta.lucy import settings as lucy_settings

    conn = db.connect(Settings(tmp_path).db_path)
    flags.use("-lucy.proposals -lucy.remote_providers")
    config = lucy_settings.get(conn)
    assert config["phases"]["proposals"] is False and config["phases"]["chat"] is True
    lucy_settings.update(conn, tmp_path, {"budgets": {"max_steps": 10}})
    flags.use("")
    assert lucy_settings.get(conn)["phases"]["proposals"] is True, "the person's choice is kept"


def test_a_build_without_ai_services_refuses_one(tmp_path):
    from selecta.lucy import settings as lucy_settings

    conn = db.connect(Settings(tmp_path).db_path)
    flags.use("-lucy.remote_providers")
    with pytest.raises(ValueError, match="built-in"):
        lucy_settings.update(conn, tmp_path, {"provider": {"kind": "anthropic"}})
