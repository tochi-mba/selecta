"""The Desktop's mix and draft routes for a Cloud account (docs/engineering/engine-store-mixes.md).

The same paths, request bodies and answers as Desktop's `routes/mixes.py` and `routes/edit.py`,
over the same operations (`mix.py`), on the account's own tables through the engine store. Each
change is one store transaction: what the page saw (`x-mix-order`) is checked, Undo remembers the
mix, and the edit lands, together or not at all.

What differs is only what Cloud has. Nothing is rendered on the server for these mixes, so a
seam's state is `none` with the browser's own words, there is no render line or time estimate,
and a song is a catalogue song (`local_songs`) of this workspace, never a path. Song ids in a body
are checked against the workspace's catalogue on every write.

Each route keeps its Desktop flag as owner and also needs `cloud.brain` and `cloud.account_mixes`
for the account (refused as `flag_off` otherwise), except `PUT /api/mix/order`, which Desktop has
no route for and `cloud.account_mixes` owns. The first use in a workspace brings its recipes and
its uploaded-music Cloud mixes (`/cloud-mixes`) in as drafts (`engine_store.mix_import`), once.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import sqlalchemy as sa
from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field

from selecta import flags, mix
from selecta.authz.roles import WorkspaceAction
from selecta.engine_store import EngineStore
from selecta.engine_store.mixes import StoreMixes
from selecta.identity.tokens import Claims

FLAGS = ("cloud.brain", "cloud.account_mixes")
MOST_SONGS = 200  # mix_contract.MAX_SONGS: the most a Cloud mix has ever held
MOST_DRAFTS = 500
MOST_OVERLAP_BARS = 64  # routes/edit.py
WORKED_OUT_LIVE = "Worked out in your browser as the mix plays."
SongId = Field(gt=0, lt=2**31)


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class DraftBody(_Strict):  # api_common.DraftRequest
    name: str | None = Field(default=None, max_length=200)
    copy_current: bool = False


class NameBody(_Strict):  # api_common.NameRequest
    name: str = Field(max_length=200)


class AddBody(_Strict):  # api_common.AddRequest
    song_id: int = SongId
    position: int | None = Field(default=None, ge=0, le=MOST_SONGS)


class MoveBody(_Strict):  # api_common.MoveRequest
    source: int = Field(ge=0, le=MOST_SONGS)
    target: int = Field(ge=0, le=MOST_SONGS)


class SeamBody(_Strict):  # api_common.SeamSettings
    move: str = Field(default="auto", max_length=40)
    shape: str | None = Field(default=None, max_length=40)
    bars: int | None = None
    exit_bar: int | None = Field(default=None, le=100_000)
    entry_bar: int | None = Field(default=None, le=100_000)
    phrase: str | None = Field(default=None, max_length=200)
    soft: bool = False


class OrderBody(_Strict):
    song_ids: list[int] = Field(max_length=MOST_SONGS)
    name: str | None = Field(default=None, max_length=200)


class MixChanged(Exception):
    """The page's view of the mix (`x-mix-order`) is no longer the mix."""


def cloud_state(key: str) -> dict:
    """A seam in a Cloud account's mix: nothing is rendered ahead, so none, with the words."""
    return {"status": "none", "key": key, "why": WORKED_OUT_LIVE}


def payload(mixes: StoreMixes, draft: int | None = None) -> dict:
    """`GET /api/mix` as Desktop answers it, without what only Desktop has (an estimate, a place
    in the render line, request marks)."""
    items = mix.read_mix(mixes, None, draft, status=cloud_state)
    answer = {
        "mix": items,
        "name": mix.mix_name(mixes, draft),
        "can_undo": mix.can_undo(mixes, draft),
    }
    if draft is not None:
        answer["draft"] = {"id": draft, "place": None}
    return answer


def drafts_payload(mixes: StoreMixes) -> dict:
    """`GET /api/drafts` as Desktop answers it (`routes/helpers.py`), for a mix nothing renders."""
    rows = mix.all_drafts(mixes)
    loaded = mix.rows_for_drafts(mixes, {row["id"]: row["items"] for row in rows})
    summaries = []
    for row in rows:
        items = mix.read_mix(mixes, None, row["id"], loaded[row["id"]], cloud_state)
        states = [item["seam"]["state"] for item in items[1:]]
        stored = mix._stored(row)
        summaries.append(
            {
                "id": row["id"],
                "name": row["name"],
                "songs": len(items),
                "seconds": sum(item["duration"] or 0 for item in items),
                "seams": len(states),
                "ready": 0,
                "failed": 0,
                "waiting": len(states),
                "rendering": False,
                "place": None,
                "eta": None,
                "to_render": 0,
                "missing": max(len(stored) - len(items), 0),
                "song_ids": [item["song_id"] for item in items],
            }
        )
    current = mix._rows(mixes)
    return {
        "drafts": summaries,
        "current": {
            "name": mix.mix_name(mixes),
            "songs": len(current),
            "left": 0,
            "eta": {"seconds": 0, "low": 0, "high": 0},
        },
        "out_of_room": False,
    }


def _ours(mixes: StoreMixes, songs: list[int]) -> None:
    """Refuse any song that isn't one of this workspace's catalogue songs."""
    from selecta.local_media.schema import local_songs

    wanted = sorted(set(songs))
    if not wanted:
        return
    found = set(
        mixes.connection.execute(
            sa.select(local_songs.c.id).where(
                mixes.store.mine(local_songs),
                local_songs.c.id.in_(wanted),
                local_songs.c.deleted_at.is_(None),
            )
        ).scalars()
    )
    if found != set(wanted):
        raise HTTPException(404, "That song isn't in your library.")


def _check_order(mixes: StoreMixes, request: Request, draft: int | None) -> None:
    seen = request.headers.get("x-mix-order")
    if seen is not None and seen != ",".join(str(item[0]) for item in mix._items(mixes, draft)):
        raise MixChanged()


def _room_for(mixes: StoreMixes, draft: int | None, more: int) -> None:
    if len(mix._items(mixes, draft)) + more > MOST_SONGS:
        raise HTTPException(409, f"A mix holds at most {MOST_SONGS} songs.")


def _a_new_draft(mixes: StoreMixes) -> None:
    if len(mixes.names()) >= MOST_DRAFTS:
        raise HTTPException(409, f"An account keeps at most {MOST_DRAFTS} drafts.")


def _placement(body: SeamBody) -> None:
    """Desktop's checks before a seam is saved (`routes/edit.py`), without bar counts Cloud may
    not know: an unknown count refuses nothing on a guess."""
    from selecta.flags.guard import refusal
    from selecta.seam_kinds import MOVE_FLAGS, move_on
    from selecta.seams import MOVES

    if body.move not in MOVES:
        raise HTTPException(400, f"unknown move: {body.move}")
    if not move_on(body.move):
        raise _Refused(refusal(MOVE_FLAGS[body.move]))
    if body.bars is not None and not 1 <= body.bars <= MOST_OVERLAP_BARS:
        raise HTTPException(
            422, f"An overlap is between 1 and {MOST_OVERLAP_BARS} bars, not {body.bars}."
        )
    for bar, words in (
        (body.exit_bar, "leave the first song"),
        (body.entry_bar, "bring in the second song"),
    ):
        if bar is not None and bar < 0:
            raise HTTPException(422, f"There's no bar {bar} to {words} at.")


class _Refused(Exception):
    def __init__(self, response: JSONResponse) -> None:
        self.response = response


def reordered(before: list[tuple], songs: list[int]) -> list[tuple]:
    """The mix as these songs, each seam kept where it still joins the same two songs (as a
    recipe keeps a chosen move), locks let go: a whole new order is a choice of its own."""
    seams = {(a[0], b[0]): b[1] for a, b in zip(before, before[1:], strict=False)}
    return [
        (song, seams.get((songs[at - 1], song)) if at else None, 0) for at, song in enumerate(songs)
    ]


def install(
    app: FastAPI,
    *,
    engine: Any,
    current_claims: Callable[..., Claims],
    principal_for: Callable[..., Any],
    rules: Any = None,
    **_unused: Any,
) -> None:
    """Mount the mix and draft routes for Cloud accounts."""
    from selecta.engine_store import mix_import

    @app.exception_handler(MixChanged)
    def mix_changed(_request: Request, _problem: MixChanged) -> JSONResponse:
        return JSONResponse(
            {"detail": "This mix has just changed, so nothing was done.", "code": "mix_changed"},
            status_code=409,
        )

    @app.exception_handler(mix.NoSuchDraft)
    def draft_gone(_request: Request, _problem: mix.NoSuchDraft) -> JSONResponse:
        return JSONResponse({"detail": "That draft isn't there any more."}, status_code=404)

    @app.exception_handler(_Refused)
    def refused(_request: Request, problem: _Refused) -> JSONResponse:
        return problem.response

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
        mix_import.import_recipes(store)
        # an uploaded-music account's /cloud-mixes come in as drafts the same way, once; the
        # Cloud mix revisions themselves are never changed
        mix_import.import_cloud_mixes(store)
        return store

    def reading(request: Request, claims: Claims):
        return _Open(store_for(request, claims, WorkspaceAction.MIXES_READ), write=False)

    def writing(request: Request, claims: Claims):
        return _Open(store_for(request, claims, WorkspaceAction.MIXES_EDIT), write=True)

    @app.get("/api/mix")
    def get_mix(
        request: Request,
        claims: Claims = Depends(current_claims),  # noqa: B008
        draft: int | None = Query(default=None, ge=1),  # noqa: B008
    ) -> dict:
        with reading(request, claims) as mixes:
            return payload(mixes, draft)

    @app.get("/api/drafts")
    def get_drafts(
        request: Request,
        claims: Claims = Depends(current_claims),  # noqa: B008
    ) -> dict:
        with reading(request, claims) as mixes:
            return drafts_payload(mixes)

    @app.get("/api/drafts/names")
    def get_draft_names(
        request: Request,
        claims: Claims = Depends(current_claims),  # noqa: B008
    ) -> dict:
        with reading(request, claims) as mixes:
            return {
                "drafts": [
                    {"id": row["id"], "name": row["name"]} for row in mix.draft_names(mixes)
                ],
                "current": {"name": mix.mix_name(mixes)},
            }

    @app.post("/api/drafts")
    def new_draft(
        body: DraftBody,
        request: Request,
        claims: Claims = Depends(current_claims),  # noqa: B008
    ) -> dict:
        with writing(request, claims) as mixes:
            _a_new_draft(mixes)
            if body.copy_current:
                draft = mix.copy_current(mixes, body.name)
            else:
                draft = mix.create_draft(mixes, body.name)
            return {"id": draft, "name": mix.mix_name(mixes, draft)}

    @app.post("/api/drafts/restore")
    def restore_draft(
        request: Request,
        claims: Claims = Depends(current_claims),  # noqa: B008
        id: int | None = Query(default=None, ge=1),  # noqa: B008
    ) -> dict:
        with writing(request, claims) as mixes:
            draft = mix.restore_draft(mixes, id)
            if draft is None:
                raise HTTPException(404, "There's nothing to bring back.")
            return {"id": draft, "name": mix.mix_name(mixes, draft)}

    @app.post("/api/drafts/{draft}/name")
    def rename_draft(
        draft: int,
        body: NameBody,
        request: Request,
        claims: Claims = Depends(current_claims),  # noqa: B008
    ) -> dict:
        with writing(request, claims) as mixes:
            return {"id": draft, "name": mix.rename_draft(mixes, draft, body.name)}

    @app.post("/api/drafts/{draft}/duplicate")
    def duplicate_draft(
        draft: int,
        request: Request,
        claims: Claims = Depends(current_claims),  # noqa: B008
    ) -> dict:
        with writing(request, claims) as mixes:
            _a_new_draft(mixes)
            copy = mix.duplicate_draft(mixes, draft)
            return {"id": copy, "name": mix.mix_name(mixes, copy)}

    @app.delete("/api/drafts/{draft}")
    def delete_draft(
        draft: int,
        request: Request,
        claims: Claims = Depends(current_claims),  # noqa: B008
    ) -> dict:
        with writing(request, claims) as mixes:
            return {"name": mix.delete_draft(mixes, draft)}

    @app.post("/api/drafts/{draft}/play")
    def play_draft(
        draft: int,
        request: Request,
        claims: Claims = Depends(current_claims),  # noqa: B008
    ) -> dict:
        with writing(request, claims) as mixes:
            if not mix._rows(mixes, draft):
                raise HTTPException(400, "Add a song to this draft first.")
            mix.play_draft(mixes, draft)
            return payload(mixes)

    @app.post("/api/mix/songs")
    def add_song(
        body: AddBody,
        request: Request,
        claims: Claims = Depends(current_claims),  # noqa: B008
        draft: int | None = Query(default=None, ge=1),  # noqa: B008
    ) -> dict:
        with writing(request, claims) as mixes:
            _check_order(mixes, request, draft)
            _ours(mixes, [body.song_id])
            _room_for(mixes, draft, 1)
            title = mixes.songs_by_id([body.song_id])[body.song_id]["title"]
            mix.remember(mixes, f"adding {title}", draft)
            mix.add_song(mixes, body.song_id, body.position, draft)
            return payload(mixes, draft)

    @app.delete("/api/mix/songs/{position}")
    def remove_song(
        position: int,
        request: Request,
        claims: Claims = Depends(current_claims),  # noqa: B008
        draft: int | None = Query(default=None, ge=1),  # noqa: B008
    ) -> dict:
        with writing(request, claims) as mixes:
            _check_order(mixes, request, draft)
            mix.remember(mixes, "removing that song", draft)
            mix.remove_at(mixes, position, draft)
            return payload(mixes, draft)

    @app.post("/api/mix/move")
    def move_song(
        body: MoveBody,
        request: Request,
        claims: Claims = Depends(current_claims),  # noqa: B008
        draft: int | None = Query(default=None, ge=1),  # noqa: B008
    ) -> dict:
        with writing(request, claims) as mixes:
            _check_order(mixes, request, draft)
            if flags.on("editor.locks"):
                held = mix.locked_in_the_way(mixes, body.source, body.target, draft)
                if held is not None:
                    raise HTTPException(
                        409,
                        f"Song {held + 1} is locked, so it stays where it is and nothing "
                        "moved. Unlock it first to move songs past it.",
                    )
            mix.remember(mixes, "moving that song", draft)
            mix.move_song(mixes, body.source, body.target, draft)
            return payload(mixes, draft)

    @app.post("/api/mix/{position}/seam")
    def set_seam(
        position: int,
        body: SeamBody,
        request: Request,
        claims: Claims = Depends(current_claims),  # noqa: B008
        draft: int | None = Query(default=None, ge=1),  # noqa: B008
    ) -> dict:
        with writing(request, claims) as mixes:
            _placement(body)
            _check_order(mixes, request, draft)
            if not 1 <= position < len(mix._items(mixes, draft)):
                raise HTTPException(404, "There's no seam there.")
            mix.remember(mixes, "changing that seam", draft)
            mix.set_seam(mixes, position, body.model_dump(), draft)
            return payload(mixes, draft)

    @app.post("/api/mix/{position}/lock")
    def lock_song(
        position: int,
        request: Request,
        claims: Claims = Depends(current_claims),  # noqa: B008
        draft: int | None = Query(default=None, ge=1),  # noqa: B008
    ) -> dict:
        with writing(request, claims) as mixes:
            _check_order(mixes, request, draft)
            mix.toggle_lock(mixes, position, draft)
            return payload(mixes, draft)

    @app.post("/api/mix/undo")
    def undo_mix(
        request: Request,
        claims: Claims = Depends(current_claims),  # noqa: B008
        draft: int | None = Query(default=None, ge=1),  # noqa: B008
    ) -> dict:
        with writing(request, claims) as mixes:
            undone = mix.undo(mixes, draft)
            return {**payload(mixes, draft), "undone": undone}

    @app.post("/api/mix/clear")
    def clear_mix(
        request: Request,
        claims: Claims = Depends(current_claims),  # noqa: B008
    ) -> dict:
        with writing(request, claims) as mixes:
            _check_order(mixes, request, None)
            mix.remember(mixes, "clearing the mix")
            mix.write_order(mixes, [])
            mix.set_mix_name(mixes, "Your mix")
            return payload(mixes)

    @app.put("/api/mix/order")
    def set_order(
        body: OrderBody,
        request: Request,
        claims: Claims = Depends(current_claims),  # noqa: B008
        draft: int | None = Query(default=None, ge=1),  # noqa: B008
    ) -> dict:
        """The whole order at once: a mix made on this device, or another device's change."""
        with writing(request, claims) as mixes:
            _check_order(mixes, request, draft)
            _ours(mixes, body.song_ids)
            if len(set(body.song_ids)) != len(body.song_ids):
                raise HTTPException(422, "A mix has each song once.")
            before = mix._items(mixes, draft)
            mix.remember(mixes, "changing the order", draft)
            mix.write_order(mixes, reordered(before, body.song_ids), draft)
            if body.name is not None and mix._clean_name(body.name):
                if draft is None:
                    mix.set_mix_name(mixes, mix._clean_name(body.name))
                else:
                    mix.rename_draft(mixes, draft, body.name)
            return payload(mixes, draft)


class _Open:
    """One store transaction as a `StoreMixes`: a write for a change, a read otherwise."""

    def __init__(self, store: EngineStore, *, write: bool) -> None:
        self.store = store
        self._context = store.write() if write else store.read()

    def __enter__(self) -> StoreMixes:
        return StoreMixes(self._context.__enter__(), self.store)

    def __exit__(self, *problem: Any) -> bool | None:
        return self._context.__exit__(*problem)


__all__ = ["FLAGS", "cloud_state", "drafts_payload", "install", "payload", "reordered"]
