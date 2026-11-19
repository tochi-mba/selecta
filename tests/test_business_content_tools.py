"""ADR-0450's library song facts, the content tool routes and the zone programme gate.

The organisation library is real rows (`assets`, `local_songs`, `artifacts`, `jobs`,
`crate_songs`, ISRC edits); the routes run on a bare app with a planted owner and a recording
permission check, like `test_business_content_routes.py`.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from selecta.business.access import BusinessActor, BusinessForbidden
from selecta.business.access.directory import StaticDirectory, VenueRef, ZoneRef
from selecta.business.content import api as content_api
from selecta.business.content import api_tools, gate, library, playback_gate, service, store
from selecta.business.content.engine import allowed
from selecta.persistence import make_engine, metadata, transaction

WS = "ws-1"
VENUE, BAR, ELSEWHERE = "venue-1", "zone-bar", "zone-other"
HEADERS = {"X-Workspace-ID": WS}
SHA = {name: (name * 64)[:64] for name in ("a", "b", "c", "d")}


def directory() -> StaticDirectory:
    return StaticDirectory(
        venues=[VenueRef(VENUE, WS, WS, "The Crown"), VenueRef("venue-2", "ws-2", "ws-2", "Away")],
        zones=[ZoneRef(BAR, VENUE, WS, WS, "Bar"),
               ZoneRef(ELSEWHERE, "venue-2", "ws-2", "ws-2", "X")],
    )


def owner() -> BusinessActor:
    return BusinessActor(kind="person", id="user-owner", organisation_id=WS, workspace_id=WS,
                         org_role="owner", display_name="Olu")


def _raw(engine, statements: list[tuple[str, dict]]) -> None:
    raw = engine.raw_connection()
    try:
        raw.execute("PRAGMA foreign_keys=OFF")
        for sql, values in statements:
            raw.execute(sql, values)
        raw.commit()
    finally:
        raw.close()


def plant_library(engine) -> None:
    """Four uploads: a and b analysed (a by song_facts, b by the worker), c not, d deleted."""
    rows = []
    for index, (name, title, artist) in enumerate(
            [("a", "Golden Hour", "Beyoncé feat. Jay-Z"), ("b", "Slow Brunch", "Calm Trio"),
             ("c", "Not Yet", "Someone"), ("d", "Gone", "Ghost")]):
        rows.append(("INSERT INTO assets (id, workspace_id, original_key, size, sha256, format, "
                     "duration_s, created_at, deleted_at) VALUES (:id, :ws, :key, 10, :sha, 'mp3', "
                     ":dur, :at, :deleted)",
                     {"id": f"song-{name}", "ws": WS, "key": f"k/{name}", "sha": SHA[name],
                      "dur": 200.0, "at": index, "deleted": 5 if name == "d" else None}))
        rows.append(("INSERT INTO local_songs (id, workspace_id, content_sha256, title, artist, "
                     "album, created_at, updated_at) VALUES (:id, :ws, :sha, :title, :artist, "
                     "'Album', 0, 0)",
                     {"id": index + 1, "ws": WS, "sha": SHA[name], "title": title,
                      "artist": artist}))
    rows.append(("INSERT INTO artifacts (id, workspace_id, kind, input_hash, keys, checksum, "
                 "provenance, created_at, last_used_at) VALUES ('art-a', :ws, 'song_facts', :sha, "
                 "'[]', 'x', :prov, 0, 0)",
                 {"ws": WS, "sha": SHA["a"], "prov": '{"facts": {"bpm": 98, "energy": 0.4}}'}))
    rows.append(("INSERT INTO artifacts (id, workspace_id, kind, input_hash, keys, checksum, "
                 "provenance, created_at, last_used_at) VALUES ('art-b', :ws, 'analysis', :hash, "
                 "'[]', 'x', '{}', 0, 0)", {"ws": WS, "hash": library.analysis_hash(SHA["b"])}))
    rows.append(("INSERT INTO jobs (id, workspace_id, type, pool, lane, base_lane, urgency, "
                 "base_urgency, input_ref, est_cost_s, state, max_attempts, max_run_s, result, "
                 "created_at, updated_at) VALUES ('job-b', :ws, 'analyse.song', 'cpu', "
                 "'standard', 'standard', 0, 0, '{}', 1, 'succeeded', 1, 60, :result, 0, 0)",
                 {"ws": WS, "result": json.dumps({"input_hash": library.analysis_hash(SHA["b"]),
                                                  "bpm": 92.5})}))
    rows.append(("INSERT INTO crate_songs (crate_id, song_id, workspace_id, position) "
                 "VALUES ('crate-brunch', 'song-b', :ws, 0)", {"ws": WS}))
    rows.append(("INSERT INTO biz_isrc_edits (id, workspace_id, track_id, new_isrc, source, "
                 "actor, created_at) VALUES ('e1', :ws, 'song-a', 'GBAYE0601498', 'tag', 'x', 0)",
                 {"ws": WS}))
    _raw(engine, rows)


@pytest.fixture
def engine(tmp_path):
    from selecta.persistence.registry import load_all_tables

    load_all_tables()
    built = make_engine(f"sqlite:///{tmp_path / 'tools.sqlite'}")
    metadata.create_all(built)
    plant_library(built)
    library.clear_cache()
    service.clear_cache()
    api_tools.clear_lyrics_cache()
    yield built
    built.dispose()


@pytest.fixture
def setup(engine, monkeypatch):
    checked: list[str] = []
    state = {"on": set(gate.ALL), "refuse": set()}
    monkeypatch.setattr(gate, "on", lambda flag: flag in state["on"])

    def authorize(conn, actor, permission, *, venue_id=None, zone_id=None, directory):
        checked.append(permission)
        if permission in state["refuse"]:
            raise BusinessForbidden(code="forbidden")

    lyrics = {"song-a": ("you fucking know it", "en"), "song-b": ("la la la", "en")}
    app = FastAPI()
    common = dict(engine=engine, current_claims=lambda request: None, directory=directory(),
                  authorize=authorize, actor_resolver=lambda request, conn, **_: owner())
    api_tools.install_routes(app, songs=library.SqlSongFacts(cached=False),
                             lyrics_source=lambda song: lyrics.get(song.song_id, (None, None)),
                             flag_on=lambda flag: flag in state["on"], **common)
    content_api.install_routes(app, songs_for=library.songs_for,
                               flag_on=lambda flag: flag in state["on"], **common)
    return TestClient(app), checked, state


# ---- the library as song facts -------------------------------------------------------------

def test_the_library_reads_titles_flags_crates_isrc_and_analysis(engine):
    with transaction(engine) as conn:
        store.set_flag(conn, organisation_id=WS, workspace_id=WS, song_id="song-a",
                       explicit="explicit", source="manual", set_by="u", now=1)
        songs, local_ids = library.load(conn, WS)
    assert set(songs) == {"song-a", "song-b", "song-c"}  # the deleted upload is gone
    a, b, c = songs["song-a"], songs["song-b"], songs["song-c"]
    assert (a.title, a.artist, a.explicit, a.isrc) == ("Golden Hour", "Beyoncé feat. Jay-Z",
                                                       "explicit", "GBAYE0601498")
    assert (a.bpm, a.energy, a.analysed) == (98.0, 0.4, True)
    assert (b.bpm, b.energy, b.analysed, b.crate_ids) == (92.5, None, True,
                                                          frozenset({"crate-brunch"}))
    assert c.analysed is False and c.explicit == "unknown"
    assert local_ids == {"song-a": 1, "song-b": 2, "song-c": 3}


def test_search_and_local_ids(engine):
    source = library.SqlSongFacts(cached=False)
    with transaction(engine) as conn:
        assert [s.song_id for s in source.search(conn, WS, "brunch", 10)] == ["song-b"]
        assert [s.song_id for s in source.search(conn, WS, "beyonce", 10)] == ["song-a"]
        assert source.song_for_local(conn, WS, 2) == "song-b"
        assert source.local_id(conn, WS, "song-a") == 1


# ---- routes ---------------------------------------------------------------------------------

def test_tool_routes_answer_flag_off_one_flag_at_a_time(setup):
    client, checked, state = setup
    state["on"] = {gate.ENGINE}
    assert client.post("/api/business/content/bulk/preview", headers=HEADERS,
                       json={"explicit": "clean"}).json()["detail"]["flag"] == gate.BULK
    assert client.get("/api/business/content/worth-checking", headers=HEADERS
                      ).json()["detail"]["flag"] == gate.LYRICS_HINT
    state["on"] = set()
    assert client.get(f"/api/business/zones/{BAR}/content/pool", headers=HEADERS
                      ).status_code == 404
    assert checked == []


def test_the_zone_pool_counts_blocks_unknown_and_unanalysed(setup, engine):
    client, checked, _ = setup
    with transaction(engine) as conn:
        store.save_rule(conn, organisation_id=WS, workspace_id=WS, level="daypart",
                        level_id=BAR, daypart_id="brunch", daypart_label="Brunch",
                        values={"crate_ids": ["crate-brunch"]}, windows=[[0, 600, 720]],
                        actor=None, now=0)
        store.bump(conn, WS, WS, 0)
    pool = client.get(f"/api/business/zones/{BAR}/content/pool", headers=HEADERS).json()
    assert pool["library"] == 3 and pool["unanalysed"] == 1
    blocks = {block["label"]: block for block in pool["blocks"]}
    assert blocks["All day"]["songs"] == 2 and blocks["All day"]["unknown"] == 2
    assert blocks["Brunch"]["songs"] == 1
    assert "business.rules.read" in checked
    other = client.get(f"/api/business/zones/{ELSEWHERE}/content/pool", headers=HEADERS)
    assert other.status_code == 404


def test_the_kiosk_snapshot_and_artist_variants(setup):
    client, _, _ = setup
    snap = client.get(f"/api/business/zones/{BAR}/content/snapshot", headers=HEADERS).json()
    assert snap["zone_id"] == BAR and snap["format"] == 1
    variants = client.get("/api/business/content/artist-variants?name=Jay-Z",
                          headers=HEADERS).json()
    assert variants["variants"] == ["Beyoncé feat. Jay-Z"]


def test_a_clean_edit_link_is_saved_and_checked(setup, engine):
    client, checked, _ = setup
    saved = client.put("/api/business/content/songs/song-a/clean-link", headers=HEADERS,
                       json={"clean_song_id": "song-b"})
    assert saved.status_code == 200, saved.text
    with engine.connect() as conn:
        assert store.clean_links_map(conn, WS) == {"song-a": "song-b"}
    assert "business.songs.flag" in checked
    missing = client.put("/api/business/content/songs/song-a/clean-link", headers=HEADERS,
                         json={"clean_song_id": "song-zzz"})
    assert missing.status_code == 404


def test_bulk_select_count_apply_and_undo(setup, engine):
    client, _, _ = setup
    body = {"explicit": "clean", "unknown_only": True}
    preview = client.post("/api/business/content/bulk/preview", headers=HEADERS, json=body).json()
    assert preview["count"] == 3 and preview["summary"] == "Marking 3 songs as clean"
    done = client.post("/api/business/content/bulk/apply", headers=HEADERS, json=body).json()
    with engine.connect() as conn:
        assert set(store.flags_map(conn, WS).values()) == {"clean"}
    undone = client.post(f"/api/business/content/bulk/{done['batch_id']}/undo", headers=HEADERS)
    assert undone.json()["restored"] == 3
    with engine.connect() as conn:
        assert store.flags_map(conn, WS) == {}
    by_artist = client.post("/api/business/content/bulk/preview", headers=HEADERS,
                            json={"explicit": "explicit", "artist": "Jay-Z"}).json()
    assert [song["id"] for song in by_artist["songs"]] == ["song-a"]


def test_csv_import_previews_then_saves_only_matched_rows(setup, engine):
    client, _, _ = setup
    csv = ("ISRC,Artist,Title,Explicit\n"
           "GB-AYE-06-01498,,,explicit\n"
           ",Calm Trio,Slow Brunch,clean\n"
           ",Nobody,Nothing,clean\n"
           ",Someone,Not Yet,rude\n")
    preview = client.post("/api/business/content/import/preview", headers=HEADERS,
                          json={"csv": csv}).json()
    assert preview["counts"] == {"matched": 2, "ambiguous": 0, "unmatched": 1, "invalid": 1}
    assert [row["by"] for row in preview["matched"]] == ["isrc", "artist_title"]
    with engine.connect() as conn:
        assert store.flags_map(conn, WS) == {}  # a preview saves nothing
    saved = client.post("/api/business/content/import/apply", headers=HEADERS,
                        json={"csv": csv}).json()
    assert saved["count"] == 2
    with engine.connect() as conn:
        assert store.flags_map(conn, WS) == {"song-a": "explicit", "song-b": "clean"}


def test_worth_checking_lists_hints_and_never_changes_a_flag(setup, engine):
    client, _, _ = setup
    found = client.get("/api/business/content/worth-checking", headers=HEADERS).json()
    assert [hint["song_id"] for hint in found["worth_checking"]] == ["song-a"]
    assert {hint["song_id"] for hint in found["not_checked"]} == {"song-c"}
    with engine.connect() as conn:
        assert store.flags_map(conn, WS) == {}


def test_venue_rules_that_leave_nothing_to_play_are_refused_with_the_block_named(setup):
    client, _, _ = setup
    body = {"zones": {BAR: {"crate_ids": ["crate-none"]}}}
    refused = client.put(f"/api/business/venues/{VENUE}/content/rules", headers=HEADERS,
                         json=body)
    assert refused.status_code == 422, refused.text
    assert "Bar all day would have no songs allowed" in refused.json()["detail"]["refusals"]
    short = client.put(f"/api/business/venues/{VENUE}/content/rules", headers=HEADERS,
                       json={"zones": {BAR: {"filter_mode": "off"}}})
    assert short.status_code == 409 and "under 2 hours" in short.json()["detail"]["message"]
    confirmed = client.put(f"/api/business/venues/{VENUE}/content/rules?confirm=true",
                           headers=HEADERS, json={"zones": {BAR: {"filter_mode": "off"}}})
    assert confirmed.status_code == 200


# ---- the zone programme gate and the request planner's clean swap --------------------------

def test_a_zone_programme_is_refused_song_by_song(engine, monkeypatch):
    from selecta.business.access import directory as directory_module

    monkeypatch.setattr(directory_module, "SqlDirectory", directory)
    monkeypatch.setattr(gate, "on", lambda flag: True)
    library.clear_cache()
    now = datetime(2026, 11, 16, 12, tzinfo=UTC).timestamp()
    with transaction(engine) as conn:
        store.add_entry(conn, organisation_id=WS, workspace_id=WS, scope="organisation",
                        scope_id=WS, kind="artist", value="Calm Trio", label="Calm Trio",
                        reason=None, author=None, now=0, ends_at=None)
        store.bump(conn, WS, WS, 0)
    with transaction(engine) as conn:
        assert playback_gate.refused_in_programme(conn, WS, BAR, [1], now) is None
        assert playback_gate.refused_in_programme(conn, WS, BAR, [2], now) == \
            "Slow Brunch doesn't fit this zone's music rules right now."
        assert playback_gate.refused_in_programme(conn, WS, BAR, [3], now)  # unanalysed
        assert playback_gate.refused_in_programme(conn, WS, BAR, [99], now) == \
            playback_gate.UNKNOWN
        assert playback_gate.refused_in_programme(conn, "personal", "zone-x", [2], now) is None
    monkeypatch.setattr(gate, "on", lambda flag: False)  # off: the check disappears
    with transaction(engine) as conn:
        assert playback_gate.refused_in_programme(conn, WS, BAR, [2], now) is None
        assert playback_gate.refused_in_programme(conn, WS, BAR, [99], now) is None


def test_every_song_choosing_path_goes_through_the_engine():
    """The static check: each caller that chooses or offers a song names the one engine."""
    from pathlib import Path

    root = Path(__file__).resolve().parents[1] / "src" / "selecta"
    callers = {
        "business/rooms/guests.py": "filter_allowed",  # guest search
        "business/rooms/requests.py": "self.content.check",  # placing, approving, the slot
        "business/content/playback_gate.py": "allowed(",  # staff play-next and steering
        "playback/zone_session.py": "refused_in_programme",
        "business/content/api_tools.py": "effective_pool",  # the manager's pool view
    }
    for path, needle in callers.items():
        assert needle in (root / path).read_text(encoding="utf-8"), path


def test_the_engine_refuses_an_explicit_song_and_offers_its_clean_edit(engine):
    with transaction(engine) as conn:
        store.set_flag(conn, organisation_id=WS, workspace_id=WS, song_id="song-a",
                       explicit="explicit", source="manual", set_by="u", now=1)
        store.set_clean_link(conn, organisation_id=WS, workspace_id=WS, song_id="song-a",
                             clean_song_id="song-b", actor=None, now=1)
        store.bump(conn, WS, WS, 1)
    with transaction(engine) as conn:
        snap = service.build_snapshot(conn, directory().zone(conn, BAR), now=0, version=9,
                                      enabled=True)
        songs, _ = library.load(conn, WS)
    at = datetime(2026, 11, 16, 12, tzinfo=UTC)
    assert allowed(songs["song-a"], snap, at).rule == "explicit"
    assert snap.clean_links["song-a"] == "song-b"
    assert allowed(songs["song-b"], snap, at).allowed
