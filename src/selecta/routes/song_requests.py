"""Songs asked for while a mix plays, and finding a way to bring them in."""

from __future__ import annotations

import hashlib
import json
import sqlite3
import threading
import time

import numpy as np
from fastapi import HTTPException

from selecta import db, mix
from selecta import requests as song_requests
from selecta.api_common import (
    HEARD_BEFORE_A_REQUEST,
    HEARING_KEPT_SECONDS,
    AddRequest,
    BridgeChoice,
    HearWhich,
    RequestOfferAction,
    RequestPlayback,
    WhereItsPlaying,
)
from selecta.config import ANALYSIS_VERSION
from selecta.eta import analysis_line_left, combine
from selecta.seams import MOVES, SeamRequest, request_from
from selecta.session import get_steering


def add_routes(app, ctx) -> None:
    analysed_or_404 = ctx.analysed_or_404
    background = ctx.background
    connect = ctx.connect
    library_now = ctx.library_now
    mix_payload = ctx.mix_payload
    music_ids = ctx.music_ids
    never_played = ctx.never_played
    settings = ctx.settings
    songs_in_line = ctx.songs_in_line
    store = ctx.store

    request_offers: dict[str, dict] = {}

    request_guard = threading.Lock()

    def request_audio_ready(request: SeamRequest) -> bool:
        state = store.status(request.key)
        return (
            state.get("status") == "ready"
            and (state.get("passed") is True or state.get("near_miss") is True)
            and (store.folder(request.key) / "clip.flac").is_file()
        )

    def request_rows(conn: sqlite3.Connection) -> list[dict]:
        """Waiting requests, saying which still have to be analysed and how long that will take."""
        rows = song_requests.read_requests(conn)
        never = never_played(conn)
        for row in rows:
            row["never"] = row["song_id"] in never
            row["bridge_choice"] = song_requests.bridge_choice(conn, row["id"])
            row["picked"] = song_requests.chosen_route(conn, row["id"])
        unanalysed = [
            row
            for row in rows
            if row["available"] and not db.is_analysed(conn, row["song_id"], ANALYSIS_VERSION)
        ]
        placeable = {song.id for song in library_now(conn)[0]} if rows else set()
        for row in rows:
            row["no_cues"] = (
                bool(row["available"])
                and not row["never"]
                and row not in unanalysed
                and row["song_id"] not in placeable
            )
        if unanalysed:
            ready_in = analysis_line_left(conn, songs_in_line(conn))
            for row in unanalysed:
                row["waiting_on"] = "analysis"
                row["seconds"] = ready_in.get(row["song_id"])
        return rows

    def request_snapshot(conn, body: RequestPlayback):
        items = mix._items(conn)
        order = [item[0] for item in items]
        if order != body.order or not 0 <= body.position < len(order):
            raise HTTPException(409, "The mix changed. Reconsidering requests.")
        if body.phase not in {"playing", "paused"}:
            raise HTTPException(409, "Requests wait until a mix is playing or paused.")
        if not np.isfinite(body.seconds_left) or body.seconds_left < 8:
            raise HTTPException(409, "The next handover is too close. Waiting for a safe place.")
        return items, min(body.position + 1, len(order) - 1)

    request_asks: dict[int, set[str]] = {}

    request_dead_ends: set[tuple[int, int]] = set()

    heard_seams: dict[str, float] = {}

    bridge_searches: dict[int, dict[str, SeamRequest]] = {}

    pair_books: list = []

    def pair_book():
        """What's been worked out about pairs of songs, kept across rechecks and restarts."""
        from selecta.request_planner import PairBook

        if not pair_books:
            pair_books.append(PairBook(settings.home / "pair-book.json"))
        return pair_books[0]

    def only_what_requests_need() -> None:
        now_time = time.time()
        for key, until in list(heard_seams.items()):
            if until < now_time:
                del heard_seams[key]
        store.keep_requested(set(heard_seams).union(*request_asks.values()))

    def entered_at(items: list, position: int) -> float | None:
        """Where the song at this place in the mix gets going, if that's known yet."""
        if position <= 0:
            return None  # the first song starts from the top, so it has all the room it needs
        before, item = items[position - 1], items[position]
        request = request_from(before[0], item[0], json.loads(item[1] or "{}"))
        state = store.status(request.key)
        return state.get("b_source_end") if state.get("status") == "ready" else None

    def transition_rows(seams: list[SeamRequest], songs: list) -> list[dict]:
        title_of = {song.id: song.title for song in songs}
        return [
            {
                "from": title_of.get(request.a, "Song"),
                "to": title_of.get(request.b, "Song"),
                "key": request.key,
                "status": store.status(request.key)["status"],
                "label": MOVES.get(request.move, (request.move, ""))[0],
            }
            for request in seams
        ]

    @app.post("/api/requests/consider")
    def consider_requests(body: RequestPlayback) -> dict:
        from selecta.request_planner import proposals

        with request_guard, connect() as conn:
            rows = request_rows(conn)
            if not rows:
                request_asks.clear()
                only_what_requests_need()
                return {"requests": []}
            items, protected = request_snapshot(conn, body)
            # one that's been put in the mix by hand has got what it wanted
            order = {item[0] for item in items}
            settled = [row for row in rows if row["available"] and row["song_id"] in order]
            for row in settled:
                song_requests.mark_added(conn, row["id"], row["song_id"])
            rows = [row for row in rows if row not in settled]
            songs, _traits = library_now(conn)
            found = proposals(
                rows,
                items,
                songs,
                protected,
                store.remembered(),
                store.status_reader(),
                get_steering(conn).stems,
                book=pair_book(),
                allowed=music_ids(conn),
                avoid=request_dead_ends,
            )
            now_time = time.time()
            for key in list(request_offers):
                if request_offers[key]["expires"] < now_time:
                    del request_offers[key]
            asks: dict[int, set[str]] = {}
            # the worker takes requests in turn, so each one waits for those before it as well
            counted: set[str] = set()
            ahead: list = []
            by_id = {song.id: song for song in songs}
            for row in found:
                plan = row.get("plan")
                if plan is None:
                    continue
                choice = row.get("bridge_choice")
                if plan["bridges"] and choice is False:
                    # they said no to an extra song, so this keeps waiting for a direct spot
                    row.update(plan=None, stage="searching", declined=True)
                    continue
                picked = row.get("picked")
                approved = (
                    not plan["bridges"]
                    or (picked is not None and list(plan["songs"]) == list(picked))
                    or (picked is None and choice is True)
                )
                chain = [
                    items[plan["position"] - 1][0],
                    *plan["songs"],
                    *[item[0] for item in items[plan["position"] : plan["position"] + 1]],
                ]
                # each song has to get a turn, including the one it's going in after
                plan["seams"] = mix.chain_with_room(
                    chain,
                    plan["seams"],
                    entered_at(items, plan["position"] - 1),
                    lambda song: getattr(by_id.get(song), "duration", None),
                    store.status,
                )
                seam_requests = [
                    request_from(a, b, seam)
                    for a, b, seam in zip(chain, chain[1:], plan["seams"], strict=False)
                ]
                states = [store.status(request.key) for request in seam_requests]
                # one held to a later place might not have anywhere to go, so try somewhere else
                stuck = [
                    (request, state)
                    for request, state in zip(seam_requests, states, strict=True)
                    if request.leave_after is not None
                    and (
                        state["status"] == "failed"
                        or (state["status"] == "ready" and not request_audio_ready(request))
                    )
                ]
                if stuck:
                    request_dead_ends.update((request.a, request.b) for request, _ in stuck)
                    row.update(plan=None, stage="searching")
                    continue
                # the next transitions have to be right, so they go first. Anything further off is
                # minutes of music away and can wait the minute or so a request takes, or a request
                # would sit behind a whole unrendered mix. One seam here would be replaced by this
                # song anyway, so rendering it first would be waste
                played_first = [
                    request_from(
                        items[index - 1][0], items[index][0], json.loads(items[index][1] or "{}")
                    )
                    for index in range(body.position + 1, min(plan["position"], len(items)))
                ][:HEARD_BEFORE_A_REQUEST]
                if approved:
                    asks[row["id"]] = {request.key for request in seam_requests}
                    after = [request.key for request in played_first]
                    for request, state in zip(seam_requests, states, strict=True):
                        if state["status"] == "none" or store.forget_missing_audio(request.key):
                            store.submit(request, after=after)
                ready = approved and all(request_audio_ready(request) for request in seam_requests)
                row["transitions"] = transition_rows(seam_requests, songs)
                if approved:
                    row["reason"] = (
                        "Ready to join the mix."
                        if ready
                        else "Preparing both handovers. The playing mix stays ahead."
                    )
                    row["stage"] = "ready" if ready else "preparing"
                else:
                    row["stage"] = "approve"
                row["after_id"] = items[plan["position"] - 1][0]
                row["after"] = next((s.title for s in songs if s.id == row["after_id"]), None)
                if approved and not ready:
                    unfinished = {"none", "queued", "rendering"}
                    for request in [*played_first, *seam_requests]:
                        if request.key in counted:
                            continue
                        counted.add(request.key)
                        if store.status(request.key)["status"] not in unfinished:
                            continue
                        ahead.append(store.clock.estimate(request.move))
                        a, b = by_id.get(request.a), by_id.get(request.b)
                        if a is not None and b is not None:
                            windows = store.windows_left(request, a, b)
                            ahead += [store.clock.estimate("stem_window")] * windows
                    row["seconds"] = round(combine(ahead).seconds)
                signature = hashlib.sha256(
                    json.dumps([items, row["id"], plan], sort_keys=True).encode()
                ).hexdigest()
                row.update(
                    offer=signature,
                    ready=ready,
                    needs_approval=not approved,
                    route=[
                        {
                            "id": sid,
                            "title": next((s.title for s in songs if s.id == sid), "Song"),
                            "artist": next((s.artist for s in songs if s.id == sid), None),
                        }
                        for sid in plan["songs"]
                    ],
                )
                request_offers[signature] = dict(
                    request_id=row["id"],
                    plan=plan,
                    items=items,
                    seams=seam_requests,
                    expires=now_time + 15,
                )
            request_asks.clear()
            request_asks.update(asks)
            only_what_requests_need()
            pair_book().save()
            return {"requests": found, "settled": [row["title"] for row in settled]}

    @app.post("/api/requests/{request_id}/bridges")
    def find_request_bridges(request_id: int, body: WhereItsPlaying) -> dict:
        """Go through every song in the library for the best ways of reaching this one. Nothing is
        changed or rendered until a person chooses one."""
        from selecta.request_planner import bridge_options

        with connect() as conn:
            rows = request_rows(conn)
            row = next((r for r in rows if r["id"] == request_id), None)
            if row is None:
                raise HTTPException(409, "That request has already joined or been cancelled.")
            items = mix._items(conn)
            order = [item[0] for item in items]
            if not order:
                raise HTTPException(409, "Start a mix first, so a bridge has somewhere to start.")
            if row["song_id"] in order:
                raise HTTPException(409, "That song is already in your mix.")
            songs, _traits = library_now(conn)
            if row["song_id"] not in {song.id for song in songs}:
                raise HTTPException(409, "SelectaDJ can’t tell where the singing is in it yet.")
            playing = (
                body.position is not None
                and order == body.order
                and 0 <= body.position < len(order)
            )
            protected = min(body.position + 1, len(order) - 1) if playing else 0
            stems = get_steering(conn).stems
            allowed = music_ids(conn)
        search = bridge_options(
            row,
            rows,
            items,
            songs,
            protected,
            store.remembered(),
            store.status_reader(),
            stems,
            book=pair_book(),
            allowed=allowed,
        )
        pair_book().save()
        by_id = {song.id: song for song in songs}
        seams_found: dict[str, SeamRequest] = {}
        options = []
        for index, route in enumerate(search["routes"]):
            seams = [
                request_from(a, b, seam)
                for a, b, seam in zip(
                    route["chain"], route["chain"][1:], route["seams"], strict=False
                )
            ]
            seams_found.update({request.key: request for request in seams})
            before = by_id[route["chain"][0]]
            after = route["position"] < len(order)
            options.append(
                {
                    "best": index == 0,
                    "songs": [
                        {
                            "id": sid,
                            "title": by_id[sid].title,
                            "artist": by_id[sid].artist,
                            "bridge": sid != row["song_id"],
                        }
                        for sid in route["songs"]
                    ],
                    "song_ids": route["songs"],
                    "after_id": before.id,
                    "after": before.title,
                    "before": by_id[order[route["position"]]].title if after else None,
                    "words": route["words"],
                    "transitions": transition_rows(seams, songs),
                }
            )
        bridge_searches[request_id] = seams_found
        return {
            "options": options,
            "looked_at": search["looked_at"],
            "direct": search["direct"],
            "unsteady": search.get("unsteady", False),
        }

    @app.post("/api/requests/{request_id}/bridge")
    def choose_request_bridge(request_id: int, body: BridgeChoice) -> dict:
        """Yes or no to using an extra song for this request. It doesn't need the mix to be playing.
        Naming the songs holds it to those, which is what someone picking a bridge has agreed to."""
        with connect() as conn:
            rows = request_rows(conn)
            row = next((r for r in rows if r["id"] == request_id), None)
            if row is None:
                raise HTTPException(409, "That request has already joined or been cancelled.")
            songs = body.songs if body.allow else None
            if songs:
                in_mix = {item[0] for item in mix._items(conn)}
                others = {r["song_id"] for r in rows if r["id"] != request_id}
                others |= song_requests.songs_in_chosen_routes(conn, leaving_out=request_id)
                if songs.count(row["song_id"]) != 1 or len(set(songs)) != len(songs):
                    raise HTTPException(409, "That route doesn’t make sense. Search again.")
                if set(songs) & in_mix:
                    raise HTTPException(409, "One of those songs is already in your mix.")
                if set(songs) & others:
                    raise HTTPException(409, "Another request is already using one of those songs.")
                if set(songs) - music_ids(conn):
                    raise HTTPException(409, "One of those songs is no longer in your library.")
            if not song_requests.choose_bridge(conn, request_id, body.allow, songs):
                raise HTTPException(409, "That request has already joined or been cancelled.")
            return {"requests": request_rows(conn)}

    @app.post("/api/requests/{request_id}/hear")
    def hear_request_route(request_id: int, body: HearWhich | None = None) -> dict:
        """Render what a person would be agreeing to, so they can hear it before they answer. Only
        what they asked to hear, when they say, since each one takes a while."""
        now_time = time.time()
        offered = {
            request.key: request
            for offer in request_offers.values()
            if offer["request_id"] == request_id and offer["expires"] >= now_time
            for request in offer["seams"]
        }
        known = {**bridge_searches.get(request_id, {}), **offered}
        wanted = body.keys if body is not None and body.keys else list(offered)
        seams = [known[key] for key in wanted if key in known]
        if not seams:
            raise HTTPException(409, "That route has changed. Try again in a few seconds.")
        for request in seams:
            heard_seams[request.key] = now_time + HEARING_KEPT_SECONDS
            if store.status(request.key)["status"] == "none" or store.forget_missing_audio(
                request.key
            ):
                store.submit(request, after=[])
        return {"seams": [store.status(request.key) for request in seams]}

    @app.post("/api/requests/{request_id}/add")
    def add_request_anyway(request_id: int, body: WhereItsPlaying) -> dict:
        """A person decided: put it in now, even though nothing clean was found. It goes as soon as
        it safely can, and the transitions fall back on whatever works, which may be a cut."""
        with request_guard, connect() as conn:
            row = next((r for r in request_rows(conn) if r["id"] == request_id), None)
            if row is None:
                raise HTTPException(409, "That request has already joined or been cancelled.")
            song = analysed_or_404(conn, row["song_id"])
            items = mix._items(conn)
            order = [item[0] for item in items]
            if row["song_id"] in order:
                raise HTTPException(409, "That song is already in your mix.")
            position = len(order)
            playing = body.position is not None and order == body.order
            if playing and 0 <= body.position < len(order):
                position = min(body.position + 2, len(order))
            locked = [index for index, item in enumerate(items) if item[2]]
            position = max(position, (max(locked) + 1) if locked else 0)
            mix.remember(conn, f"adding {song.title}")
            mix.add_song(conn, row["song_id"], position)
            if position + 1 < len(order) + 1:
                mix.set_seam(conn, position + 1, {"move": "auto"})
            song_requests.mark_added(conn, request_id, row["song_id"])
            return mix_payload(conn)

    @app.post("/api/requests/insert")
    def insert_request(body: RequestOfferAction) -> dict:
        with request_guard, connect() as conn:
            items, protected = request_snapshot(conn, body)
            offer = request_offers.get(body.offer)
            if offer is None or offer["expires"] < time.time() or offer["items"] != items:
                raise HTTPException(409, "The prepared placement changed. Finding another.")
            plan = offer["plan"]
            choice = song_requests.bridge_choice(conn, offer["request_id"])
            if plan["bridges"] and choice is not True:
                raise HTTPException(409, "Approve the bridge route first.")
            if not all(request_audio_ready(request) for request in offer["seams"]):
                raise HTTPException(409, "Both handovers must finish and pass their checks first.")
            slot = song_requests.Slot(
                plan["position"], tuple(plan["songs"]), tuple(plan["bridges"])
            )
            try:
                song_requests.insert_ready(
                    conn,
                    offer["request_id"],
                    slot,
                    items,
                    protected,
                    plan["seams"],
                    approved_bridges=slot.bridges,
                )
            except song_requests.PlacementChanged as problem:
                raise HTTPException(409, str(problem)) from problem
            request_offers.pop(body.offer, None)
            return mix_payload(conn)

    @app.get("/api/requests")
    def get_song_requests() -> dict:
        with connect() as conn:
            return {"requests": request_rows(conn)}

    @app.post("/api/requests")
    def request_song(body: AddRequest) -> dict:
        with connect() as conn:
            try:
                request_id = song_requests.add_request(conn, body.song_id)
            except ValueError as problem:
                raise HTTPException(400, str(problem)) from problem
            if not db.is_analysed(conn, body.song_id, ANALYSIS_VERSION):
                background.ask_for(body.song_id)
            return {"id": request_id, "requests": request_rows(conn)}

    @app.delete("/api/requests/{request_id}")
    def cancel_song_request(request_id: int) -> dict:
        with connect() as conn:
            cancelled = song_requests.cancel_request(conn, request_id)
            request_asks.pop(request_id, None)
            bridge_searches.pop(request_id, None)
            only_what_requests_need()
            return {"cancelled": cancelled, "requests": request_rows(conn)}
