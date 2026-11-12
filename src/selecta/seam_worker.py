"""Renders seams in a process of its own, at low priority.

Rendering is heavy, and doing it inside the app made everything lag, even a slider. Here it can't.
The app sends requests down this process's input, one per line, and reads the results from disk.
When the app stops, the input closes and this stops too, so nothing is left running.
"""

from __future__ import annotations

import json
import logging
import os
import sys
import threading
import time
from collections import Counter
from typing import TextIO

from selecta import cache_care, db, flags, mix
from selecta.config import load_settings
from selecta.jobs import kill_tree_of_children, set_render_priority, take_app_input
from selecta.seams import SeamRequest, SeamStore, request_from
from selecta.stems import cache_room

RELOAD_EVERY_SECONDS = 600.0
TIDY_EVERY_SECONDS = 6 * 60 * 60.0


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
        if waiting is None:
            return None  # r8d: nothing to make, so no need to walk the cache to measure it
        # a mix bigger than the limit would delete its own early seams to make room for later ones
        used, largest = cache_room(settings)
        if used >= min(settings.effective_cache_cap_bytes, largest):
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
        for draft in mix.line_order(conn):
            mix.settle_chain(conn, store, draft)
            for request, status in pairs(draft):
                if status == "none":
                    # the same limit as the mix: it mustn't delete its own early seams to go on.
                    # r8d: measured only once there's something to make, in one walk of the cache
                    used, largest = cache_room(settings)
                    full = used >= min(settings.effective_cache_cap_bytes, largest)
                    return None if full else (draft, request)
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
        # r8d: one look at what's been rendered, not a disk check for every link and move
        link = next_to_prepare(*state["ranked"], store.status_reader(), store.memory)
        if link is not None:
            return link
        used, largest = cache_room(settings)
        if used >= USE_OF_STORAGE * min(settings.effective_cache_cap_bytes, largest):
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


def _protecting(settings, keys):
    """The seams the mix and the render line use, recorded each time they're asked for, so a prune
    from any process (the app lowering the limit, a stem split) leaves them alone."""

    def keep() -> set[str]:
        found = keys()
        cache_care.remember_protected(settings, found)
        return found

    return keep


def _tidier(settings):
    """Tidy the caches when the worker first has nothing to do, and every few hours after. It runs
    beside the worker, never in its way: a seam the mix asks for meanwhile starts at once (a full
    tidy of a library-sized home took about 16 s, mostly deleting and compacting)."""
    state = {"at": float("-inf"), "thread": None}

    def tidy() -> None:
        running = state["thread"]
        if running is not None and running.is_alive():
            return
        if time.monotonic() - state["at"] < TIDY_EVERY_SECONDS:
            return
        state["at"] = time.monotonic()
        state["thread"] = threading.Thread(target=_tidy_once, args=(settings,), daemon=True)
        state["thread"].start()

    return tidy


def _tidy_once(settings) -> None:
    try:
        swept = cache_care.tidy(settings)
    except Exception:  # noqa: BLE001 - tidying must never stop the worker rendering
        logging.getLogger(__name__).exception("Tidying the caches failed")
        return
    if swept.removed or swept.linked:
        logging.getLogger(__name__).info(
            "Tidied the caches: %s, %d clips shared", swept.removed, swept.linked
        )


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
    # with `core.durable_local_jobs` the app starts this with --durable: no input pipe, the
    # work comes from the job store in the home, and it stops when the app's process does
    durable = "--durable" in sys.argv
    if durable:
        from selecta.workers import local_host, local_seams

        local_host.stop_with_parent()
        store = local_seams.DurableSeamStore(settings, local_host.open_store(settings.home))
    else:
        store = SeamStore(settings)
    store.forget_unfinished()
    if "--prepare" in sys.argv and flags.on("render.spare_time"):
        store.next_idle_job = _preparer(store, settings)
    if not durable:
        app_input = take_app_input()
        threading.Thread(target=_read_requests, args=(store, app_input), daemon=True).start()
    store.next_mix_seam, mix_keys, store.mix_moves = _mix_seams(store, settings)
    store.next_line_seam, line_keys, store.draft_moves = _line_seams(store, settings)
    pinned = _pinned_ready_seams(settings)
    store.keep_for_now = _protecting(settings, lambda: mix_keys() | line_keys() | pinned())
    store.when_idle = _tidier(settings)
    if durable:
        local_seams.serve_worker(store)
        return
    store.run_forever()


if __name__ == "__main__":
    main()
