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

from selecta import db, mix
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


def _preparer(store: SeamStore, settings):
    """Spare time goes on the best word links, reloading now and then as more songs are analysed."""
    from selecta.discovery.search import lyric_links
    from selecta.planner.prepare import best_links, next_to_prepare
    from selecta.planner.reel import load_library

    state = {"at": 0.0, "ranked": None}

    def next_job() -> SeamRequest | None:
        if state["ranked"] is None or time.monotonic() - state["at"] > RELOAD_EVERY_SECONDS:
            conn = db.connect(settings.db_path)
            state["ranked"] = best_links(lyric_links(conn), load_library(conn, settings))
            state["at"] = time.monotonic()
            conn.close()
        return next_to_prepare(*state["ranked"], store.status, store.memory)

    return next_job


def _read_requests(store: SeamStore, app_input: TextIO) -> None:
    for line in app_input:
        if line.strip():
            message = json.loads(line)
            store.ask(SeamRequest(**message["request"]), urgent=message["urgent"])
    kill_tree_of_children()
    os._exit(0)


def main() -> None:
    set_render_priority(False)
    settings = load_settings()
    store = SeamStore(settings)
    store.forget_unfinished()
    if "--prepare" in sys.argv:
        store.next_idle_job = _preparer(store, settings)
    app_input = take_app_input()
    threading.Thread(target=_read_requests, args=(store, app_input), daemon=True).start()
    store.next_mix_seam, store.keep_for_now, store.mix_moves = _mix_seams(store, settings)
    store.run_forever()


if __name__ == "__main__":
    main()
