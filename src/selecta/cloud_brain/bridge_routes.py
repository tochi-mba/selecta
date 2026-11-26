"""Find a bridge for a Cloud account's request: the Desktop's search, over stored song facts.

The Desktop's `POST /api/requests/{request_id}/bridges` (`routes/song_requests.py`) goes through
every song in the library for one or two that lead to a waiting request, with the planner core's
`request_planner.bridge_options`. Here the same function runs over the account's measured songs
(`engine_store.songs.load_songs`), with the same body and answer, so the browser's Requests panel
asks as it would ask the Desktop. Nothing is rendered or changed: choosing an option is the
existing `POST /api/requests/{request_id}/bridge`, and the device playing the mix then makes the
chain's transitions (`request_planning`, web/src/cloud/accountPlacements.ts).

Bounded, because every song looked at has its stored arrays read: at most `MOST_SONGS` songs a
search besides the mix's own stretch and the waiting requests, read `BATCH` at a time. A library
with more measured songs is searched over those nearest the request in tempo, and the answer
says so (`capped`, `measured`) rather than timing out. A browser may name the songs that play on
it (`songs`), so a bridge it offers is one this device can make. The route is a plain function,
so FastAPI runs it off the event loop; it is rate limited like the discovery sweep
(`ratelimit.STRICT`, 6 a minute).

It keeps its Desktop flag as owner (`requests.bridges`) and needs `cloud.brain` and
`cloud.account_mixes`, as the other request routes do.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import sqlalchemy as sa
from fastapi import Depends, FastAPI, HTTPException, Request
from pydantic import Field

from selecta import mix
from selecta.authz.roles import WorkspaceAction
from selecta.cloud_brain import request_planning
from selecta.cloud_brain.mixes_routes import FLAGS, _Open, _Strict
from selecta.cloud_brain.mixes_routes import MOST_SONGS as MIX_MOST
from selecta.cloud_brain.requests_routes import GONE, _number, request_rows
from selecta.engine_store import EngineStore, facts_store
from selecta.identity.tokens import Claims
from selecta.storage.artifacts import ArtifactStore

MOST_SONGS = 250
"""Songs one search looks at besides the mix's stretch and the requests (see the module). Each
song's arrays are read and the planner scores its ways in: 500 synthetic songs searched whole
took about 12 s on a developer machine, capped at 250 about 8 s. The planner itself tries the
songs nearest in tempo first (`request_planner.TOP_STEPS`), so the cap keeps those."""
BATCH = 100
"""Songs whose arrays are read in one store transaction."""


class BridgeBody(_Strict):  # api_common.WhereItsPlaying, and the songs that play on the device
    order: list[int] | None = Field(default=None, max_length=MIX_MOST)
    position: int | None = Field(default=None, ge=0, le=MIX_MOST)
    songs: list[int] | None = Field(default=None, max_length=20_000)


def _measured(
    store: EngineStore, near: float | None, among: list[int] | None
) -> tuple[list[int], int]:
    """The measured songs a bridge may come from (never Never play, never set aside), nearest the
    request in tempo first when there are more than `MOST_SONGS`, and how many there were."""
    from selecta.engine_store.schema import analysis
    from selecta.local_media.schema import local_songs

    joined = analysis.join(
        local_songs,
        sa.and_(
            local_songs.c.id == analysis.c.song_id,
            local_songs.c.workspace_id == analysis.c.workspace_id,
        ),
    )
    query = (
        sa.select(analysis.c.song_id, analysis.c.bpm)
        .select_from(joined)
        .where(
            store.mine(analysis),
            local_songs.c.deleted_at.is_(None),
            local_songs.c.duplicate_of.is_(None),
            local_songs.c.never_play.is_not(True),
        )
    )
    with store.read() as connection:
        rows = connection.execute(query).all()
    aside = facts_store.set_aside(store)
    wanted = set(among) if among is not None else None
    found = [
        (int(row.song_id), row.bpm)
        for row in rows
        if int(row.song_id) not in aside and (wanted is None or int(row.song_id) in wanted)
    ]
    if near is not None and len(found) > MOST_SONGS:
        found.sort(key=lambda song: (abs((song[1] or 0.0) - near), song[0]))
    return [song for song, _bpm in found[:MOST_SONGS]], len(found)


def _load(store: EngineStore, artifacts: ArtifactStore, ids: list[int]) -> list:
    from selecta.engine_store.songs import load_songs

    songs = []
    for start in range(0, len(ids), BATCH):
        found, _missing = load_songs(store, artifacts, ids[start : start + BATCH])
        songs.extend(found)
    return songs


def search(store: EngineStore, artifacts: ArtifactStore, request_id: int, body: BridgeBody) -> dict:
    """The Desktop's bridge search for one waiting request, over the account's stored facts."""
    from selecta.engine_store import seams as stored
    from selecta.planner_core.memory import SeamMemory
    from selecta.request_planner import PairBook, bridge_options

    with _Open(store, write=False) as mixes:
        rows = request_rows(mixes)
        row = next((r for r in rows if r["id"] == request_id), None)
        if row is None:
            raise HTTPException(409, GONE)
        items = mix._items(mixes)
    order = [item[0] for item in items]
    if not order:
        raise HTTPException(409, "Start a mix first, so a bridge has somewhere to start.")
    if row["song_id"] in order:
        raise HTTPException(409, "That song is already in your mix.")
    playing = body.position is not None and order == body.order and 0 <= body.position < len(order)
    protected = min(body.position + 1, len(order) - 1) if playing else 0
    (wanted,) = _load(store, artifacts, [row["song_id"]]) or (None,)
    if wanted is None:
        raise HTTPException(409, "SelectaDJ hasn’t measured that song yet.")
    candidates, measured = _measured(store, wanted.bpm, body.songs)
    stretch = order[protected : protected + request_planning.WINDOW]
    ids = list(dict.fromkeys([*stretch, *(r["song_id"] for r in rows), *candidates]))
    songs = _load(store, artifacts, ids)
    by_id = {song.id: song for song in songs}
    found = bridge_options(
        row,
        rows,
        items,
        songs,
        protected,
        SeamMemory.from_states(stored.records(store)),
        lambda _key: {"status": "none"},  # nothing is rendered ahead on the server
        "never",
        book=PairBook(),
        allowed={song for song in candidates if song in by_id} | {row["song_id"]},
    )
    options = []
    for index, route in enumerate(found["routes"]):
        chain = route["chain"]
        before = by_id[chain[0]]
        after = route["position"] < len(order)
        options.append(
            {
                "best": index == 0,
                "songs": [
                    {
                        "id": song,
                        "title": by_id[song].title,
                        "artist": by_id[song].artist,
                        "bridge": song != row["song_id"],
                    }
                    for song in route["songs"]
                ],
                "song_ids": route["songs"],
                "after_id": before.id,
                "after": before.title,
                "before": by_id[order[route["position"]]].title if after else None,
                "words": route["words"],
                # made on the device playing the mix once the member chooses (no key: no clip yet)
                "transitions": [
                    {
                        "from": by_id[a].title,
                        "to": by_id[b].title,
                        "a": a,
                        "b": b,
                        "status": "none",
                        "label": request_planning._label((seam or {}).get("move", "auto")),
                    }
                    for a, b, seam in zip(chain, chain[1:], route["seams"], strict=False)
                ],
            }
        )
    return {
        "options": options,
        "looked_at": found["looked_at"],
        "direct": found["direct"],
        "unsteady": found.get("unsteady", False),
        "capped": measured > MOST_SONGS,
        "measured": measured,
    }


def install(
    app: FastAPI,
    *,
    engine: Any,
    current_claims: Callable[..., Claims],
    principal_for: Callable[..., Any],
    artifacts: Callable[[], ArtifactStore],
    rules: Any = None,
) -> None:
    """Mount the bridge search for Cloud accounts."""

    def store_for(request: Request, claims: Claims) -> EngineStore:
        principal = principal_for(engine, claims, request.headers.get("x-workspace-id"))
        if not principal.can(WorkspaceAction.MIXES_EDIT):
            raise HTTPException(status_code=403, detail={"code": "not_allowed"})
        if rules is not None:
            from selecta.flags import cloud_gate
            from selecta.persistence import transaction

            with transaction(engine, principal.workspace.id) as connection:
                for flag_id in FLAGS:
                    cloud_gate.require(connection, principal, flag_id, rules)
        return EngineStore(engine, principal.workspace.id)

    @app.post("/api/requests/{request_id}/bridges")
    def find_request_bridges(
        request_id: str,  # a number; read after the workspace check
        request: Request,
        body: BridgeBody | None = None,
        claims: Claims = Depends(current_claims),  # noqa: B008
    ) -> dict:
        """The best ways of reaching this request through the account's measured songs. Nothing
        is changed or rendered until the member chooses one."""
        store = store_for(request, claims)
        return search(store, artifacts(), _number(request_id), body or BridgeBody())


__all__ = ["BATCH", "MOST_SONGS", "install", "search"]
