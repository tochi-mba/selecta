"""Renders seams in a process of its own, at low priority.

Rendering is heavy, and doing it inside the app made everything lag, even a slider. Here it can't.
The app sends requests down this process's input, one per line, and reads the results from disk.
When the app stops, the input closes and this stops too, so nothing is left running.
"""

from __future__ import annotations

import json
import os
import sys
import threading
import time
from collections import Counter
from typing import TextIO

from selecta import db, flags, mix
from selecta.config import load_settings
from selecta.jobs import kill_tree_of_children, set_render_priority, take_app_input
from selecta.seams import SeamRequest, SeamStore, request_from
from selecta.stems import cache_bytes, largest_cache_bytes

RELOAD_EVERY_SECONDS = 600.0


def _mix_seams(store: SeamStore, settings):
    """The current mix renders by itself, in order, ahead of anything nobody is waiting on."""
    conn = db.connect(settings.db_path)

    def pairs() -> list[tuple[SeamRequest, str]]:
        items = mix.read_mix(conn, store)
        return [
            (
                request_from(before["song_id"], item["song_id"], item["seam"]["settings"]),
                item["seam"]["state"]["status"],
            )
            for before, item in zip(items, items[1:], strict=False)
        ]

    def next_seam() -> SeamRequest | None:
        mix.settle_chain(conn, store)
        waiting = next((request for request, status in pairs() if status == "none"), None)
        # a mix bigger than the limit would delete its own early seams to make room for later ones
        limit = min(settings.effective_cache_cap_bytes, largest_cache_bytes(settings))
        if waiting is not None and cache_bytes(settings) >= limit:
            return None
        return waiting

    def keep() -> set[str]:
        return {request.key for request, _ in pairs()}

    def moves() -> Counter[str]:
        """What the mix uses so far: what finished seams became, and what the rest plan to be."""
        used: Counter[str] = Counter()
        items = mix.read_mix(conn, store)
        for item in items[1:]:
            state, settings_now = item["seam"]["state"], item["seam"]["settings"]
            move = state.get("style") if state["status"] == "ready" else settings_now.get("move")
            if move and move != "auto":
                used[move] += 1
        return used

    return next_seam, keep, moves


def _line_seams(store: SeamStore, settings):
    """Mixes waiting in the render line, in their order, once the current mix has nothing left."""
    conn = db.connect(settings.db_path)

    def pairs(draft: int) -> list[tuple[SeamRequest, str]]:
        items = mix.read_mix(conn, store, draft)
        return [
            (
                request_from(before["song_id"], item["song_id"], item["seam"]["settings"]),
                item["seam"]["state"]["status"],
            )
            for before, item in zip(items, items[1:], strict=False)
        ]

    def next_seam() -> tuple[int, SeamRequest] | None:
        limit = min(settings.effective_cache_cap_bytes, largest_cache_bytes(settings))
        for draft in mix.line_order(conn):
            mix.settle_chain(conn, store, draft)
            for request, status in pairs(draft):
                if status == "none":
                    # the same limit as the mix: it mustn't delete its own early seams to go on
                    return None if cache_bytes(settings) >= limit else (draft, request)
        return None

    def keep() -> set[str]:
        return {request.key for draft in mix.line_order(conn) for request, _ in pairs(draft)}

    def moves(draft: int) -> Counter[str]:
        used: Counter[str] = Counter()
        try:
            items = mix.read_mix(conn, store, draft)
        except mix.NoSuchDraft:
            return used
        for item in items[1:]:
            state, settings_now = item["seam"]["state"], item["seam"]["settings"]
            move = state.get("style") if state["status"] == "ready" else settings_now.get("move")
            if move and move != "auto":
                used[move] += 1
        return used

    return next_seam, keep, moves


def _preparer(store: SeamStore, settings):
    """Spare time goes on the best word links, then the best transitions in the whole library, at
    the lowest priority there is, giving way to anything else the moment it's asked for. It looks
    again now and then, as more songs are analysed."""
    from selecta.discovery.search import lyric_links
    from selecta.planner.prepare import (
        USE_OF_STORAGE,
        best_links,
        best_transitions,
        next_to_prepare,
        next_transition,
    )
    from selecta.planner.reel import load_library
    from selecta.request_planner import PairBook

    state = {"at": 0.0, "ranked": None, "pairs": [], "library": {}, "stems": "never"}
    # the app keeps its own, and two writers to one file would only lose each other's work
    book = PairBook(settings.home / "pair-book-spare.json")

    def reload() -> None:
        conn = db.connect(settings.db_path)
        songs = load_library(conn, settings)
        never = set(db.preference(conn, "never_play", []))
        allowed = {
            row[0]
            for row in conn.execute(
                "SELECT id FROM songs WHERE is_music=1 AND duplicate_of IS NULL"
            )
        } - never
        state["ranked"] = best_links(lyric_links(conn), songs)
        state["pairs"] = best_transitions(songs, store.memory, book, allowed)
        state["library"] = {song.id: song for song in songs}
        stems = db.preference(conn, "steering", {}).get("stems", "sometimes")
        state["stems"] = stems if flags.on("stems") else "never"
        state["at"] = time.monotonic()
        conn.close()

    def next_job() -> SeamRequest | None:
        if state["ranked"] is None or time.monotonic() - state["at"] > RELOAD_EVERY_SECONDS:
            reload()
        link = next_to_prepare(*state["ranked"], store.status, store.memory)
        if link is not None:
            return link
        limit = min(settings.effective_cache_cap_bytes, largest_cache_bytes(settings))
        if cache_bytes(settings) >= USE_OF_STORAGE * limit:
            return None
        request = next_transition(
            state["pairs"],
            state["library"],
            book,
            store.status_reader(),
            store.memory,
            state["stems"],
        )
        book.save()
        return request

    return next_job


def _pinned_ready_seams(settings):
    """Clips a ready-only draft or a fresh ready-only Lucy proposal relies on are kept from
    pruning for a bounded time, so "ready now" stays true while it's being decided on."""
    from selecta.lucy.readiness import pinned_keys

    conn = db.connect(settings.db_path)
    state = {"at": 0.0, "keys": set()}

    def keys() -> set[str]:
        if time.monotonic() - state["at"] > 60:
            state["keys"] = pinned_keys(conn)
            state["at"] = time.monotonic()
        return state["keys"]

    return keys


def _read_requests(store: SeamStore, app_input: TextIO) -> None:
    for line in app_input:
        if line.strip():
            message = json.loads(line)
            if "drop" in message:
                store.drop_requests(message["drop"])
                continue
            store.ask(
                SeamRequest(**message["request"]),
                urgent=message["urgent"],
                after=message.get("after"),
            )
    kill_tree_of_children()
    os._exit(0)


def main() -> None:
    set_render_priority(False)
    settings = load_settings()
    store = SeamStore(settings)
    store.forget_unfinished()
    if "--prepare" in sys.argv and flags.on("render.spare_time"):
        store.next_idle_job = _preparer(store, settings)
    app_input = take_app_input()
    threading.Thread(target=_read_requests, args=(store, app_input), daemon=True).start()
    store.next_mix_seam, mix_keys, store.mix_moves = _mix_seams(store, settings)
    store.next_line_seam, line_keys, store.draft_moves = _line_seams(store, settings)
    pinned = _pinned_ready_seams(settings)
    store.keep_for_now = lambda: mix_keys() | line_keys() | pinned()
    store.run_forever()


if __name__ == "__main__":
    main()
