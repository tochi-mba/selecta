"""Strict ready-only mixes: only verified, playable, directed clips on disk, K-1 of them for K
songs, cues the mix engine leaves alone, nothing queued, and revalidation around eviction and
commit (ADR-0317, 0318, 0319, LU-335-03)."""

from __future__ import annotations

import json
import re
import shutil

from lucy_helpers import (
    approve,
    current,
    new_conversation,
    place_ready_seam,
    reply,
    say,
    song_ids,
)

from selecta import db, mix
from selecta.config import Settings
from selecta.lucy import intent, readiness
from selecta.planner.ready import ReadyEdge, _compatible
from selecta.seam_kinds import SeamRequest, request_from
from selecta.seams import SeamStore

CHAIN = [(1, 2), (2, 3), (3, 6), (6, 9), (9, 12)]


def ready_chain(home) -> None:
    for a, b in CHAIN:
        place_ready_seam(home, a, b)


def test_k_songs_use_exactly_k_minus_one_verified_directed_edges(lucy, lucy_home):
    ready_chain(lucy_home)
    cid = new_conversation(lucy)
    snap = say(lucy, cid, "make 6 songs, only transitions that are already ready")
    revision = current(snap)
    ids = song_ids(revision)
    assert len(ids) == 6
    pairs = list(zip(ids, ids[1:], strict=False))
    assert set(pairs) <= set(CHAIN)
    assert revision["snapshot"]["ready_only"] is True
    seams = revision["snapshot"]["seams"]
    assert len(seams) == 5
    assert all(seam["ready"]["verified"] for seam in seams)
    assert all(
        seam["key"] == SeamRequest(a=seam["a"], b=seam["b"], move="bass_swap_blend").key
        for seam in seams
    )
    ledger = revision["ledger"]
    assert ledger["needed"] == 5 and ledger["ready"] == 5 and ledger["playable_now"]
    duration = revision["snapshot"]["evaluation"]["duration"]
    assert duration["exact"] and duration["low"] == duration["high"]
    assert "All 5 transitions are already ready" in reply(snap)["content"]


def test_no_route_reports_real_limits_and_never_relaxes(lucy, lucy_home):
    ready_chain(lucy_home)
    cid = new_conversation(lucy)
    snap = say(lucy, cid, "make 9 songs, only transitions that are already ready")
    assert snap["proposal"] is None  # nothing proposed rather than a quietly shorter mix
    text = reply(snap)["content"]
    assert "longest connected run of already-ready transitions is 6 songs" in text
    assert "say “make 6 songs, only transitions that are already ready”" in text


def test_a_shorter_offer_keeps_an_immovable_end_song(lucy, lucy_home):
    """LX-0359-06: an infeasible strict plan offers only a shorter mix that keeps the person's own
    end song and rules, or relaxing the rule, as whole requests, and builds nothing until they
    choose. Each plan reads only its own words, so the offers quote complete requests."""
    ready_chain(lucy_home)
    cid = new_conversation(lucy)
    asked = "make 9 songs, end with Last Call, only transitions that are already ready"
    snap = say(lucy, cid, asked)
    assert snap["proposal"] is None
    text = reply(snap)["content"]
    offered = re.search(r"I can make a (\d+)-song mix", text)
    assert offered, text
    size = int(offered.group(1))
    fewer = f"make {size} songs, end with Last Call, only transitions that are already ready"
    relaxed = "make 9 songs, end with Last Call, you can render new ones"
    assert f"say “{fewer}”" in text, text
    assert f"say “{relaxed}”" in text
    chosen = current(say(lucy, cid, fewer))
    # the offer was a promise the plan keeps: that many songs, ending on Last Call, all ready
    assert len(song_ids(chosen)) == size and song_ids(chosen)[-1] == 12
    assert set(zip(song_ids(chosen), song_ids(chosen)[1:], strict=False)) <= set(CHAIN)
    assert chosen["snapshot"]["ready_only"] is True
    # the relaxed offer keeps the count and the end song and swaps only the strict rule
    kept = {(rule.kind, rule.value) for rule in intent.parse(relaxed)}
    assert kept == {("count", 9), ("end_with", "Last Call"), ("prefer_ready", True)}
    # nothing reaches Morning Light, so no shorter mix can end there: only relaxing is offered
    snap = say(
        lucy,
        new_conversation(lucy),
        "make 9 songs, end with Morning Light, only transitions that are already ready",
    )
    assert snap["proposal"] is None
    text = reply(snap)["content"]
    assert "-song mix" not in text and "you can render new ones" in text


def test_reversed_pairs_and_history_never_count_as_ready(lucy, lucy_home):
    place_ready_seam(lucy_home, 2, 1)  # only B -> A exists
    store = SeamStore(Settings(lucy_home))
    history = store.settings.home / "seam-history"
    history.mkdir(exist_ok=True)
    gone = SeamRequest(a=1, b=3, move="bass_swap_blend")
    (history / f"{gone.key}.json").write_text(json.dumps({"status": "ready", "key": gone.key}))
    cid = new_conversation(lucy)
    snap = say(
        lucy, cid, "make 3 songs starting with Morning Light, only already ready transitions"
    )
    assert snap["proposal"] is None


def test_unverifiable_clips_are_not_ready(lucy, lucy_home):
    broken = place_ready_seam(lucy_home, 1, 2)
    root = SeamStore(Settings(lucy_home)).root
    (root / broken.key / "clip.flac").write_bytes(b"not audio")
    place_ready_seam(lucy_home, 2, 3, passed=False)
    place_ready_seam(lucy_home, 3, 6, rating="bad")
    place_ready_seam(lucy_home, 6, 9, rules=-1)
    conn = db.connect(lucy_home / "selecta.sqlite")
    songs = lucy.app_ctx.library_now(conn)[0]
    assert readiness.inventory(conn, lucy.app_ctx.store, songs, fresh=True).edges() == []


def test_ready_only_build_and_play_queue_no_renders(lucy, lucy_home):
    ready_chain(lucy_home)
    cid = new_conversation(lucy)
    revision = current(say(lucy, cid, "make 6 songs, only transitions that are already ready"))
    granted = approve(lucy, revision, "draft_and_play")
    assert granted["preflight"]["ok"] and granted["preflight"]["playable_now"]
    done = lucy.post(
        "/api/lucy/commits",
        json={"token": granted["token"], "idempotency_key": "play-1", "confirm_play": True},
    ).json()
    assert done["status"] == "committed" and done["played"]
    playing = lucy.get("/api/mix").json()["mix"]
    assert [item["song_id"] for item in playing] == song_ids(revision)
    assert all(item["seam"]["state"]["status"] == "ready" for item in playing[1:])
    conn = db.connect(lucy_home / "selecta.sqlite")
    mix.settle_chain(conn, lucy.app_ctx.store)  # the engine leaves every seam as approved
    after = mix.read_mix(conn, lucy.app_ctx.store)
    assert all(item["seam"]["state"]["status"] == "ready" for item in after[1:])
    assert not any(item["seam"].get("too_soon") for item in after[1:])


def test_eviction_after_proposing_blocks_approval_and_shows_why(lucy, lucy_home):
    ready_chain(lucy_home)
    cid = new_conversation(lucy)
    revision = current(say(lucy, cid, "make 6 songs, only transitions that are already ready"))
    seam = revision["snapshot"]["seams"][2]
    shutil.rmtree(SeamStore(Settings(lucy_home)).root / seam["key"])
    readiness.forget_cache()
    granted = approve(lucy, revision)
    assert not granted["preflight"]["ok"]
    assert granted["preflight"]["ready"] == 4
    ledger = lucy.get(f"/api/lucy/revisions/{revision['id']}/readiness").json()
    assert ledger["seams"][2]["status"] == "gone" and not ledger["playable_now"]
    failed = lucy.post(
        "/api/lucy/commits", json={"token": granted["token"], "idempotency_key": "gone-1"}
    ).json()
    assert failed["status"] == "failed" and failed["draft_id"] is None
    assert lucy.get("/api/drafts").json()["drafts"] == []


def test_cue_checks_mirror_the_mix_engine():
    class Song:
        def __init__(self, duration):
            self.duration = duration

    songs = {1: Song(200.0), 2: Song(200.0), 3: Song(200.0)}
    entered = ReadyEdge(1, 2, "k1", {"move": "auto"}, "bass_swap_blend", 100.0, 20.0, 8.0)
    too_soon = ReadyEdge(2, 3, "k2", {"move": "auto"}, "bass_swap_blend", 40.0, 10.0, 8.0)
    fine = ReadyEdge(2, 3, "k3", {"move": "auto"}, "bass_swap_blend", 50.0, 10.0, 8.0)
    # with_room wants 30 s after the entry point, so 40 s after entering at 20 s is too soon
    assert not _compatible(entered, too_soon, songs)
    assert _compatible(entered, fine, songs)
    for edge in (too_soon, fine):
        settled = mix.with_room(
            {},
            2,
            3,
            20.0,
            200.0,
            lambda _key, e=edge: {"status": "ready", "a_source_start": e.a_source_start},
        )
        assert (settled == {}) == _compatible(entered, edge, songs)


def test_ready_only_drafts_pin_their_clips(lucy_home):
    conn = db.connect(lucy_home / "selecta.sqlite")
    items = [[1, None, 0], [2, json.dumps({"move": "bass_swap_blend"}), 0]]
    conn.execute(
        "INSERT INTO drafts(name,items,ready_only) VALUES('Ready',?,1)", (json.dumps(items),)
    )
    conn.execute(
        "INSERT INTO drafts(name,items,ready_only) VALUES('Other',?,0)",
        (json.dumps([[3, None, 0], [4, None, 0]]),),
    )
    conn.commit()
    from selecta.lucy import schema

    schema.ensure(conn)
    keys = readiness.pinned_keys(conn)
    assert request_from(1, 2, {"move": "bass_swap_blend"}).key in keys
    assert request_from(3, 4, {}).key not in keys


def test_the_relaxed_offer_keeps_rules_written_after_the_strict_one():
    """LX-0359-06: dropping the ready-only rule must not also drop a rule that follows it in
    the same clause ("... and make 10 songs"), nor quote a request with nothing left in it."""
    from selecta.lucy.builtin import _rephrase

    relaxed = _rephrase("only use ready transitions and make 10 songs", relax=True)
    assert relaxed is not None and not relaxed.startswith((",", "and "))
    kept = {(rule.kind, rule.value) for rule in intent.parse(relaxed)}
    assert kept == {("count", 10), ("prefer_ready", True)}
    assert _rephrase("only ready transitions", relax=True) is None
