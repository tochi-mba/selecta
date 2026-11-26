"""The Desktop's song request routes for a Cloud account (engine-store-requests.md).

The same paths, bodies and answers as Desktop's `routes/song_requests.py`, over the same
operations (`requests.py`), on the account's own tables through the engine store. A request that
joins the mix is one store transaction with the mix's own writes (Undo, the songs, the request's
mark), on the account's current mix (`mixes_routes`).

What differs is only what Cloud has. Nothing is rendered on the server: the look
(`/consider`) plans each placement from song facts and names the handovers it needs, and a
placement is ready for the device that has rendered and reported them (`request_planning`).
`/insert` makes the same look again, so an offer is checked against the mix as it is now. A song
is a catalogue song of this workspace, never a path.

Each route keeps its Desktop flag as owner (`requests`, `requests.bridges`) and also needs
`cloud.brain` and `cloud.account_mixes` (refused as `flag_off` otherwise): requests edit the
account's mix. Searching every song for a bridge and hearing a handover ahead are Desktop's own
(they need the library's rendered seams), so Cloud has no routes for them.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import numpy as np
import sqlalchemy as sa
from fastapi import Depends, FastAPI, HTTPException, Query, Request
from pydantic import Field

from selecta import mix
from selecta import requests as song_requests
from selecta.authz.roles import WorkspaceAction
from selecta.cloud_brain import request_planning
from selecta.cloud_brain.mixes_routes import FLAGS, MOST_SONGS, SongId, _Open, _Strict, payload
from selecta.engine_store import EngineStore
from selecta.engine_store.mixes import StoreMixes
from selecta.engine_store.requests import StoreRequests
from selecta.identity.tokens import Claims
from selecta.storage.artifacts import ArtifactStore

MOST_WAITING = 200  # waiting requests an account keeps
DEVICE = r"^[A-Za-z0-9_-]{1,64}$"
GONE = "That request has already joined or been cancelled."


class AddBody(_Strict):  # api_common.AddRequest
    song_id: int = SongId
    position: int | None = Field(default=None, ge=0, le=MOST_SONGS)


class ChoiceBody(_Strict):  # api_common.BridgeChoice
    allow: bool
    songs: list[int] | None = Field(default=None, max_length=8)


class WhereBody(_Strict):  # api_common.WhereItsPlaying
    order: list[int] | None = Field(default=None, max_length=MOST_SONGS)
    position: int | None = Field(default=None, ge=0, le=MOST_SONGS)


class PlaybackBody(_Strict):  # api_common.RequestPlayback
    order: list[int] = Field(max_length=MOST_SONGS)
    position: int = Field(ge=0, le=MOST_SONGS)
    phase: str = Field(max_length=20)
    seconds_left: float


class OfferBody(PlaybackBody):  # api_common.RequestOfferAction
    offer: str = Field(pattern=r"^[0-9a-f]{64}$")


def request_rows(mixes: StoreMixes) -> list[dict]:
    """Waiting requests in Desktop's shape: which the member keeps out of built mixes, and each
    one's bridge answer. Nothing waits on analysis here, so no row has a time."""
    from selecta.local_media.schema import local_songs

    rows = song_requests.read_requests(mixes)
    ids = [row["song_id"] for row in rows]
    never = set()
    if ids:
        never = set(
            mixes.connection.execute(
                sa.select(local_songs.c.id).where(
                    mixes.store.mine(local_songs),
                    local_songs.c.id.in_(ids),
                    local_songs.c.never_play.is_(True),
                )
            ).scalars()
        )
    for row in rows:
        row["never"] = row["song_id"] in never
        row["bridge_choice"] = song_requests.bridge_choice(mixes, row["id"])
        row["picked"] = song_requests.chosen_route(mixes, row["id"])
        row["no_cues"] = False
    return rows


def _number(request_id: str) -> int:
    """The request's id. The path is read as text, so a workspace check comes before this."""
    if not request_id.isdigit() or len(request_id) > 12:
        raise HTTPException(404, "That request isn't there.")
    return int(request_id)


def _snapshot(mixes: StoreMixes, body: PlaybackBody) -> tuple[list[tuple], int]:
    """routes/song_requests.request_snapshot, word for word."""
    items = mix._items(mixes)
    order = [item[0] for item in items]
    if order != body.order or not 0 <= body.position < len(order):
        raise HTTPException(409, "The mix changed. Reconsidering requests.")
    if body.phase not in {"playing", "paused"}:
        raise HTTPException(409, "Requests wait until a mix is playing or paused.")
    if not np.isfinite(body.seconds_left) or body.seconds_left < 8:
        raise HTTPException(409, "The next handover is too close. Waiting for a safe place.")
    return items, min(body.position + 1, len(order) - 1)


def install(
    app: FastAPI,
    *,
    engine: Any,
    current_claims: Callable[..., Claims],
    principal_for: Callable[..., Any],
    artifacts: Callable[[], ArtifactStore],
    rules: Any = None,
) -> None:
    """Mount the request routes for Cloud accounts."""
    from selecta.engine_store import mix_import

    def store_for(request: Request, claims: Claims, action: WorkspaceAction) -> EngineStore:
        principal = principal_for(engine, claims, request.headers.get("x-workspace-id"))
        if not principal.can(action):
            raise HTTPException(status_code=403, detail={"code": "not_allowed"})
        if rules is not None:
            from selecta.flags import cloud_gate
            from selecta.persistence import transaction

            with transaction(engine, principal.workspace.id) as connection:
                for flag_id in FLAGS:
                    cloud_gate.require(connection, principal, flag_id, rules)
        store = EngineStore(engine, principal.workspace.id)
        # the account's mix is the one its mix routes answer with, recipes brought in first
        mix_import.import_recipes(store)
        mix_import.import_cloud_mixes(store)
        return store

    def writing(request: Request, claims: Claims):
        return _Open(store_for(request, claims, WorkspaceAction.MIXES_EDIT), write=True)

    def the_row(mixes: StoreMixes, request_id: int) -> tuple[dict, list[dict]]:
        rows = request_rows(mixes)
        row = next((r for r in rows if r["id"] == request_id), None)
        if row is None:
            raise HTTPException(409, GONE)
        return row, rows

    def look(store: EngineStore, body: PlaybackBody, device_id: str | None, *, settle: bool):
        """The request look: settle what is in the mix already, then plan the rest."""
        with _Open(store, write=settle) as mixes:
            rows = request_rows(mixes)
            if not rows:
                return [], [], [], 0
            items, protected = _snapshot(mixes, body)
            in_mix = {item[0] for item in items}
            settled = [row for row in rows if row["available"] and row["song_id"] in in_mix]
            if settle:
                for row in settled:
                    song_requests.mark_added(mixes, row["id"], row["song_id"])
            rows = [row for row in rows if row not in settled]
        found = request_planning.plan(store, artifacts(), rows, items, protected, device_id)
        return found, settled, items, protected

    @app.get("/api/requests")
    def get_song_requests(
        request: Request,
        claims: Claims = Depends(current_claims),  # noqa: B008
    ) -> dict:
        store = store_for(request, claims, WorkspaceAction.MIXES_READ)
        with _Open(store, write=False) as mixes:
            return {"requests": request_rows(mixes)}

    @app.post("/api/requests")
    def request_song(
        body: AddBody,
        request: Request,
        claims: Claims = Depends(current_claims),  # noqa: B008
    ) -> dict:
        with writing(request, claims) as mixes:
            if len(song_requests.read_requests(mixes)) >= MOST_WAITING:
                raise HTTPException(409, f"An account keeps at most {MOST_WAITING} requests.")
            try:
                request_id = song_requests.add_request(mixes, body.song_id)
            except ValueError as problem:
                raise HTTPException(400, str(problem)) from problem
            return {"id": request_id, "requests": request_rows(mixes)}

    @app.delete("/api/requests/{request_id}")
    def cancel_song_request(
        request_id: str,  # a number; read after the workspace check
        request: Request,
        claims: Claims = Depends(current_claims),  # noqa: B008
    ) -> dict:
        with writing(request, claims) as mixes:
            cancelled = song_requests.cancel_request(mixes, _number(request_id))
            return {"cancelled": cancelled, "requests": request_rows(mixes)}

    @app.post("/api/requests/{request_id}/bridge")
    def choose_request_bridge(
        request_id: str,  # a number; read after the workspace check
        body: ChoiceBody,
        request: Request,
        claims: Claims = Depends(current_claims),  # noqa: B008
    ) -> dict:
        """Yes or no to an extra song for this request; naming the songs holds it to those."""
        with writing(request, claims) as mixes:
            request_id = _number(request_id)
            row, rows = the_row(mixes, request_id)
            songs = body.songs if body.allow else None
            if songs:
                in_mix = {item[0] for item in mix._items(mixes)}
                others = {r["song_id"] for r in rows if r["id"] != request_id}
                others |= song_requests.songs_in_chosen_routes(mixes, leaving_out=request_id)
                if songs.count(row["song_id"]) != 1 or len(set(songs)) != len(songs):
                    raise HTTPException(409, "That route doesn’t make sense. Search again.")
                if set(songs) & in_mix:
                    raise HTTPException(409, "One of those songs is already in your mix.")
                if set(songs) & others:
                    raise HTTPException(409, "Another request is already using one of those songs.")
                found = StoreRequests(mixes.connection, mixes.store)
                if set(songs) - found.usable(songs):
                    raise HTTPException(409, "One of those songs is no longer in your library.")
            if not song_requests.choose_bridge(mixes, request_id, body.allow, songs):
                raise HTTPException(409, GONE)
            return {"requests": request_rows(mixes)}

    @app.post("/api/requests/{request_id}/add")
    def add_request_anyway(
        request_id: str,  # a number; read after the workspace check
        request: Request,
        body: WhereBody | None = None,
        claims: Claims = Depends(current_claims),  # noqa: B008
    ) -> dict:
        """Put it in now: after the song after the playing one, past any lock. Undo, the song, its
        seam and the request's mark are one write."""
        body = body or WhereBody()
        with writing(request, claims) as mixes:
            request_id = _number(request_id)
            row, _rows = the_row(mixes, request_id)
            if not row["available"]:
                raise HTTPException(404, "That song isn't in your library.")
            items = mix._items(mixes)
            order = [item[0] for item in items]
            if row["song_id"] in order:
                raise HTTPException(409, "That song is already in your mix.")
            if len(order) >= MOST_SONGS:
                raise HTTPException(409, f"A mix holds at most {MOST_SONGS} songs.")
            position = len(order)
            playing = body.position is not None and order == body.order
            if playing and 0 <= body.position < len(order):
                position = min(body.position + 2, len(order))
            locked = [index for index, item in enumerate(items) if item[2]]
            position = max(position, (max(locked) + 1) if locked else 0)
            mix.remember(mixes, f"adding {row['title'] or 'a request'}")
            mix.add_song(mixes, row["song_id"], position)
            if position + 1 < len(order) + 1:
                mix.set_seam(mixes, position + 1, {"move": "auto"})
            song_requests.mark_added(mixes, request_id, row["song_id"])
            return payload(mixes)

    @app.post("/api/requests/consider")
    def consider_requests(
        body: PlaybackBody,
        request: Request,
        claims: Claims = Depends(current_claims),  # noqa: B008
        device_id: str | None = Query(default=None, pattern=DEVICE),  # noqa: B008
    ) -> dict:
        """Where each waiting request could join, and which handovers it needs. Ready for the
        device named (`device_id`) once it has reported them."""
        store = store_for(request, claims, WorkspaceAction.MIXES_EDIT)
        found, settled, _items, _protected = look(store, body, device_id, settle=True)
        return {"requests": found, "settled": [row["title"] for row in settled]}

    @app.post("/api/requests/insert")
    def insert_request(
        body: OfferBody,
        request: Request,
        claims: Claims = Depends(current_claims),  # noqa: B008
        device_id: str | None = Query(default=None, pattern=DEVICE),  # noqa: B008
    ) -> dict:
        """Put a ready placement in, against the exact mix it was planned for, once the device
        playing it (`device_id`) has its handovers."""
        store = store_for(request, claims, WorkspaceAction.MIXES_EDIT)
        if device_id is None:
            raise HTTPException(422, "Say which device plays the mix.")
        found, _settled, items, protected = look(store, body, device_id, settle=False)
        row = next((r for r in found if r.get("offer") == body.offer), None)
        if row is None:
            raise HTTPException(409, "The prepared placement changed. Finding another.")
        plan = row["plan"]
        if plan["bridges"] and row.get("bridge_choice") is not True:
            raise HTTPException(409, "Approve the bridge route first.")
        if not row["ready"]:
            raise HTTPException(409, "Both handovers must be made on this device first.")
        slot = song_requests.Slot(plan["position"], tuple(plan["songs"]), tuple(plan["bridges"]))
        with _Open(store, write=True) as mixes:
            try:
                song_requests.insert_ready(
                    mixes, row["id"], slot, items, protected, plan["seams"],
                    approved_bridges=slot.bridges,
                )  # fmt: skip
            except song_requests.PlacementChanged as problem:
                raise HTTPException(409, str(problem)) from problem
            return payload(mixes)


__all__ = ["install", "request_rows"]
