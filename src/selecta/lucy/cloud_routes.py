"""Lucy's conversation routes in browser-first Cloud (ADR-0476, flag `lucy.cloud_conversation`).

The same paths and answers as local Lucy (`web/src/lucy/client.ts`), under `/api/lucy-cloud`, so
the page is reused through a transport and no route is owned by two flags. Each is scoped to the
signed-in principal's workspace and, for conversations, to the person: another person's or
another workspace's conversation answers exactly like a made-up id (404 `not_found`). Reads need
`mixes.read`; saving a proposal into a mix needs `mixes.edit`.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from fastapi import Depends, FastAPI, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.engine import Engine
from sqlalchemy.exc import IntegrityError

from selecta.ai import gateway
from selecta.authz.roles import WorkspaceAction
from selecta.identity.tokens import Claims
from selecta.lucy import cloud_agent, cloud_proposals, cloud_settings, cloud_store
from selecta.lucy.cloud_proposals import ProposalError
from selecta.lucy.cloud_store import NotFound
from selecta.persistence import transaction
from selecta.usage import meters

BASE = "/api/lucy-cloud"
MAX_TEXT = 4000


class NewConversation(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str = Field(default="", max_length=200)
    scope: dict[str, Any] | None = None


class ConversationChange(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str | None = Field(default=None, max_length=200)
    archived: bool | None = None


class TurnBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    client_id: str = Field(min_length=1, max_length=64)
    text: str = Field(min_length=1, max_length=MAX_TEXT)
    expected_revision: str | None = Field(default=None, max_length=64)
    selection: dict[str, Any] | None = Field(default=None, max_length=4)
    # the playback device this was typed on (ADR-0476 item 22); unknown ids are ignored
    device_id: str | None = Field(default=None, max_length=36)


class RetryBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    turn: str = Field(min_length=1, max_length=64)


class EditBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected: str = Field(min_length=1, max_length=64)
    op: dict[str, Any] = Field(max_length=4)


class CurrentBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    revision: str = Field(min_length=1, max_length=64)
    expected: str | None = Field(default=None, max_length=64)


class ApproveBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    revision: str = Field(min_length=1, max_length=64)
    hash: str = Field(min_length=1, max_length=64)
    action: str = Field(pattern="^(draft|draft_and_play)$")


class RatingBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    rating: str = Field(pattern="^(up|down)$")


class CommitBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    token: str = Field(min_length=1, max_length=400)
    idempotency_key: str = Field(min_length=1, max_length=64)
    confirm_play: bool | None = None


def _missing() -> HTTPException:
    return HTTPException(status_code=404, detail={"code": "not_found",
                                                  "message": "That conversation isn't here."})


def _refused(error: ProposalError) -> HTTPException:
    return HTTPException(status_code=error.status,
                         detail={"code": error.code, "message": error.message})


def busy_words(device: str | None) -> str:
    if device:
        return (f"Lucy is answering a message from {device}. Send this again when she's done; "
                "your words are kept.")
    return ("Lucy is answering another message. Send this again when she's done; your words "
            "are kept.")


def suggestions(conn, workspace_id: str) -> list[str]:
    """Three first asks drawn from the person's own library: its two biggest artists and the
    current mix, so the empty conversation starts from music they have."""
    import sqlalchemy as sa

    from selecta.local_media import current_mix
    from selecta.local_media.schema import local_songs

    rows = conn.execute(
        sa.select(local_songs.c.artist, sa.func.count().label("n"))
        .where(local_songs.c.workspace_id == workspace_id)
        .where(local_songs.c.deleted_at.is_(None))
        .group_by(local_songs.c.artist)
        .order_by(sa.func.count().desc(), local_songs.c.artist)
        .limit(2)
    ).all()
    artists = [row.artist for row in rows if row.artist]
    asks = []
    if len(artists) >= 2:
        asks.append(f"An hour of {artists[0]} and {artists[1]}")
    elif artists:
        asks.append(f"A short mix of {artists[0]}")
    if current_mix.read(conn, workspace_id).get("mix_id"):
        asks += ["What's in my current mix?", "Take the slowest songs out of my mix"]
    elif artists:
        asks.append("Make a 30 minute mix to dance to")
    return asks[:3]


def status_of(choices: dict[str, Any], tier_label: str,
              asks: list[str] | None = None) -> dict[str, Any]:
    """The local status shape, with the plan's Lucy level in place of a provider and model."""
    return {
        "enabled": choices["enabled"],
        "phases": choices["phases"],
        "provider": {
            "kind": "anthropic", "label": tier_label, "model": None, "base_url": None,
            "remote": True, "consented": True, "key_set": True, "mode": "full", "reason": None,
            "capabilities": {"streaming": True, "tools": True, "json_schema": True,
                             "context_tokens": None, "cancellation": True},
        },
        "budgets": {"max_cycles": 0, "max_steps": 0, "max_seconds": 0, "max_output_tokens": 0,
                    "spend_cap_usd": None},
        "privacy": {
            **choices["privacy"],
            "data_classes": [
                {"id": "conversation", "label": "What you write to Lucy", "sent": True},
                {"id": "catalogue", "label": "Song titles, artists, albums and lengths",
                 "sent": True},
                {"id": "mixes", "label": "Your mixes' names and songs", "sent": True},
                {"id": "lyrics", "label": "Lyric snippets", "sent": False},
                {"id": "history", "label": "Listening history", "sent": False},
                {"id": "files", "label": "File names, folders and devices", "sent": False},
            ],
        },
        "event_schema": cloud_store.EVENT_SCHEMA,
        "api_version": 1,
        "suggestions": asks or [],
    }


def install_routes(
    app: FastAPI,
    *,
    engine: Engine,
    current_claims: Callable[..., Claims],
    principal_for: Callable[..., Any],
    runner: cloud_agent.Runner | None = None,
) -> None:
    runner = runner or cloud_agent.RUNNER

    def who(request: Request, claims: Claims, action=WorkspaceAction.MIXES_READ):
        principal = principal_for(engine, claims, request.headers.get("x-workspace-id"))
        if not principal.can(action):
            raise HTTPException(status_code=403, detail={"code": "not_allowed"})
        return principal

    def mine(conn, principal, conversation_id: str):
        try:
            return cloud_store.conversation_row(conn, principal.workspace.id, principal.user.id,
                                                conversation_id)
        except NotFound as error:
            raise _missing() from error

    def proposal_row(conn, principal, revision_id: str):
        try:
            row = cloud_proposals.row_by_id(conn, principal.workspace.id, revision_id)
        except ProposalError as error:
            raise _refused(error) from error
        mine(conn, principal, row.conversation_id)
        return row

    def tier_label(conn, principal) -> str:
        from selecta.billing import plans, stripe_sync

        entitlement = stripe_sync.effective_entitlement(conn, principal.workspace.id)
        return meters.lucy_tier(plans.plan_for(entitlement.plan_id, entitlement.plan_version))

    @app.get("/api/lucy-cloud/status")
    def status(request: Request, claims: Claims = Depends(current_claims)):  # noqa: B008
        principal = who(request, claims)
        with transaction(engine, principal.workspace.id) as conn:
            return status_of(cloud_settings.choices(conn, principal.user.id),
                             tier_label(conn, principal),
                             suggestions(conn, principal.workspace.id))

    @app.put("/api/lucy-cloud/settings")
    def settings(
        body: cloud_settings.LucyChoices, request: Request,
        claims: Claims = Depends(current_claims),  # noqa: B008
    ):
        principal = who(request, claims)
        with transaction(engine, principal.workspace.id) as conn:
            try:
                choices = cloud_settings.save(conn, principal.user.id, body)
            except ValueError as error:
                raise HTTPException(status_code=400, detail={
                    "code": "invalid_lucy_choice", "message": str(error)}) from error
            return status_of(choices, tier_label(conn, principal))

    @app.get("/api/lucy-cloud/conversations")
    def conversations(
        request: Request, q: str = "", archived: int = 0,
        claims: Claims = Depends(current_claims),  # noqa: B008
    ):
        principal = who(request, claims)
        with transaction(engine, principal.workspace.id) as conn:
            return {"conversations": cloud_store.list_conversations(
                conn, principal.workspace.id, principal.user.id, q[:200], bool(archived))}

    @app.post("/api/lucy-cloud/conversations")
    def create(
        body: NewConversation, request: Request,
        claims: Claims = Depends(current_claims),  # noqa: B008
    ):
        principal = who(request, claims)
        with transaction(engine, principal.workspace.id) as conn:
            return cloud_store.create_conversation(
                conn, principal.workspace.id, principal.user.id, body.title, body.scope)

    @app.get("/api/lucy-cloud/conversations/{conversation}")
    def conversation(
        conversation: str, request: Request,
        claims: Claims = Depends(current_claims),  # noqa: B008
    ):
        principal = who(request, claims)
        ws = principal.workspace.id
        with transaction(engine, ws) as conn:
            row = mine(conn, principal, conversation)
            cloud_store.settle_stale(conn, ws, row.id, runner.alive_turns())
            cursor = cloud_store.cursor_of(conn, ws, row.id)
            return {
                "conversation": cloud_store.get_conversation(conn, ws, principal.user.id,
                                                             row.id),
                "messages": cloud_store.snapshot_messages(conn, ws, row.id, cursor),
                "proposal": cloud_proposals.snapshot(conn, ws, row.id),
                "run": cloud_store.last_run(conn, ws, row.id),
                "permissions": [], "cards": [],
                "cursor": cursor,
                "event_schema": cloud_store.EVENT_SCHEMA,
            }

    @app.patch("/api/lucy-cloud/conversations/{conversation}")
    def update(
        conversation: str, body: ConversationChange, request: Request,
        claims: Claims = Depends(current_claims),  # noqa: B008
    ):
        principal = who(request, claims)
        with transaction(engine, principal.workspace.id) as conn:
            try:
                return cloud_store.update_conversation(
                    conn, principal.workspace.id, principal.user.id, conversation,
                    body.title, body.archived)
            except NotFound as error:
                raise _missing() from error

    @app.delete("/api/lucy-cloud/conversations/{conversation}")
    def delete(
        conversation: str, request: Request,
        claims: Claims = Depends(current_claims),  # noqa: B008
    ):
        principal = who(request, claims)
        runner.stop(conversation)
        with transaction(engine, principal.workspace.id) as conn:
            try:
                cloud_store.delete_conversation(conn, principal.workspace.id,
                                                principal.user.id, conversation)
            except NotFound as error:
                raise _missing() from error
        return {"deleted": True, "drafts_kept": True}

    def device_of(conn, principal, device_id: str | None) -> tuple[str | None, str | None]:
        if not device_id:
            return None, None
        from selecta.playback import store as playback_store

        device = playback_store.load_device(conn, principal.workspace.id, device_id)
        if device is None or device.signed_out_at is not None:
            return None, None
        return device.id, device.name

    def start_turn(principal, conversation_id: str, client_id: str, text: str,
                   device_id: str | None = None) -> dict:
        ws = principal.workspace.id
        with transaction(engine, ws) as conn:
            mine(conn, principal, conversation_id)
            choices = cloud_settings.choices(conn, principal.user.id)
            if not choices["enabled"] or not choices["phases"]["chat"]:
                raise HTTPException(status_code=403, detail={
                    "code": "lucy_off", "message": "Lucy is turned off in your settings."})
            found = cloud_store.turn_by_client(conn, ws, conversation_id, client_id)
            if found is not None:
                return {"turn": {"id": found.id, "seq": found.seq, "status": found.status},
                        "new": False, "run": found.run_id}
            # a turn a restart left behind no longer holds the conversation (item 34)
            cloud_store.settle_stale(conn, ws, conversation_id, runner.alive_turns())
        try:
            with transaction(engine, ws) as conn:
                device, device_name = device_of(conn, principal, device_id)
                plan = cloud_agent.admit(conn, ws, conversation_id, text,
                                         timezone=principal.user.timezone)
                turn = cloud_store.add_turn(conn, ws, conversation_id, client_id, text,
                                            device, device_name)
                cloud_store.set_turn(conn, ws, turn["id"], run_id=plan.run_id)
        except gateway.TurnRefused as refused:
            message = refused.message
            if refused.code == "busy":
                with transaction(engine, ws) as conn:
                    message = busy_words(cloud_store.busy_with(conn, ws))
            raise HTTPException(status_code=409, detail={
                "code": refused.code, "message": message}) from refused
        except IntegrityError as clash:
            # the same send arrived twice at once (the first made the turn), or another device
            # got a turn into this conversation first (one in flight per conversation)
            with transaction(engine, ws) as conn:
                found = cloud_store.turn_by_client(conn, ws, conversation_id, client_id)
                other = cloud_store.busy_with(conn, ws) if found is None else None
            if found is not None:
                return {"turn": {"id": found.id, "seq": found.seq, "status": found.status},
                        "new": False, "run": found.run_id}
            raise HTTPException(status_code=409, detail={
                "code": "busy", "message": busy_words(other)}) from clash
        runner.start(cloud_agent.Job(
            engine=engine, workspace_id=ws, user_id=principal.user.id,
            conversation_id=conversation_id, turn_id=turn["id"], text=text, plan=plan,
            device_id=device,
            timezone=principal.user.timezone, proposals_on=choices["phases"]["proposals"],
            provider_factory=getattr(app.state, "lucy_cloud_provider", None)
            or cloud_agent.default_provider,
        ))
        return {"turn": turn, "new": True, "run": plan.run_id}

    @app.post("/api/lucy-cloud/conversations/{conversation}/turns")
    def send(
        conversation: str, body: TurnBody, request: Request,
        claims: Claims = Depends(current_claims),  # noqa: B008
    ):
        principal = who(request, claims)
        return start_turn(principal, conversation, body.client_id, body.text.strip(),
                          body.device_id)

    @app.post("/api/lucy-cloud/conversations/{conversation}/retry")
    def retry(
        conversation: str, body: RetryBody, request: Request,
        claims: Claims = Depends(current_claims),  # noqa: B008
    ):
        principal = who(request, claims)
        with transaction(engine, principal.workspace.id) as conn:
            mine(conn, principal, conversation)
            turn = cloud_store.turn_row(conn, principal.workspace.id, body.turn)
            if turn is None or turn.conversation_id != conversation:
                raise _missing()
            text = turn.text
        return start_turn(principal, conversation, f"retry:{body.turn}:{cloud_agent.new_id()}"[:64],
                          text)

    @app.post("/api/lucy-cloud/conversations/{conversation}/stop")
    def stop(
        conversation: str, request: Request,
        claims: Claims = Depends(current_claims),  # noqa: B008
    ):
        principal = who(request, claims)
        with transaction(engine, principal.workspace.id) as conn:
            mine(conn, principal, conversation)
            active = cloud_store.active_turn(conn, principal.workspace.id, conversation)
            if active is not None:
                cloud_store.set_turn(conn, principal.workspace.id, active.id, status="stopping")
        return {"stopped": runner.stop(conversation) or active is not None}

    @app.get("/api/lucy-cloud/conversations/{conversation}/events.json")
    def events(
        conversation: str, request: Request, after: int = 0,
        claims: Claims = Depends(current_claims),  # noqa: B008
    ):
        principal = who(request, claims)
        with transaction(engine, principal.workspace.id) as conn:
            mine(conn, principal, conversation)
            return cloud_store.events_after(conn, principal.workspace.id, conversation,
                                            max(0, after))

    @app.get("/api/lucy-cloud/revisions/{revision}")
    def revision(
        revision: str, request: Request,
        claims: Claims = Depends(current_claims),  # noqa: B008
    ):
        principal = who(request, claims)
        with transaction(engine, principal.workspace.id) as conn:
            row = proposal_row(conn, principal, revision)
            return cloud_proposals.revision_json(conn, principal.workspace.id, row)

    @app.get("/api/lucy-cloud/revisions/{revision}/diff")
    def diff(
        revision: str, request: Request, against: str = "",
        claims: Claims = Depends(current_claims),  # noqa: B008
    ):
        principal = who(request, claims)
        with transaction(engine, principal.workspace.id) as conn:
            row = proposal_row(conn, principal, revision)
            other = proposal_row(conn, principal, against)
            before = [int(i) for i in other.song_ids]
            titles = {s["song_id"]: s["title"] for s in cloud_proposals.revision_json(
                conn, principal.workspace.id, other)["snapshot"]["songs"]}
            return cloud_proposals.diff_ids(before, [int(i) for i in row.song_ids], titles)

    @app.get("/api/lucy-cloud/revisions/{revision}/readiness")
    def readiness(
        revision: str, request: Request,
        claims: Claims = Depends(current_claims),  # noqa: B008
    ):
        principal = who(request, claims)
        with transaction(engine, principal.workspace.id) as conn:
            row = proposal_row(conn, principal, revision)
            return cloud_proposals.readiness(len(row.song_ids))

    @app.post("/api/lucy-cloud/revisions/{revision}/edit")
    def edit(
        revision: str, body: EditBody, request: Request,
        claims: Claims = Depends(current_claims),  # noqa: B008
    ):
        principal = who(request, claims)
        with transaction(engine, principal.workspace.id) as conn:
            row = proposal_row(conn, principal, revision)
            try:
                return cloud_proposals.edit(conn, principal.workspace.id, row, body.expected,
                                            body.op)
            except ProposalError as error:
                raise _refused(error) from error

    @app.post("/api/lucy-cloud/proposals/{proposal}/current")
    def make_current(
        proposal: str, body: CurrentBody, request: Request,
        claims: Claims = Depends(current_claims),  # noqa: B008
    ):
        principal = who(request, claims)
        with transaction(engine, principal.workspace.id) as conn:
            row = proposal_row(conn, principal, body.revision)
            if row.conversation_id != proposal:
                raise _missing()
            return cloud_proposals.make_current(conn, principal.workspace.id, row)

    @app.post("/api/lucy-cloud/approvals")
    def approve(
        body: ApproveBody, request: Request,
        claims: Claims = Depends(current_claims),  # noqa: B008
    ):
        principal = who(request, claims, WorkspaceAction.MIXES_EDIT)
        with transaction(engine, principal.workspace.id) as conn:
            if not cloud_settings.choices(conn, principal.user.id)["phases"]["commit"]:
                raise HTTPException(status_code=403, detail={
                    "code": "lucy_off", "message": "Saving is turned off in Lucy's settings."})
            row = proposal_row(conn, principal, body.revision)
            try:
                return cloud_proposals.approve(conn, principal.workspace.id, row, body.hash,
                                               body.action)
            except ProposalError as error:
                raise _refused(error) from error

    @app.post("/api/lucy-cloud/commits")
    def commit(
        body: CommitBody, request: Request,
        claims: Claims = Depends(current_claims),  # noqa: B008
    ):
        principal = who(request, claims, WorkspaceAction.MIXES_EDIT)
        ws = principal.workspace.id
        with transaction(engine, ws) as conn:
            try:
                asked = cloud_proposals.read_token(body.token)
                proposal_row(conn, principal, asked["revision"])
                return cloud_proposals.commit(conn, ws, principal.user.id, body.token,
                                              body.idempotency_key, bool(body.confirm_play))
            except ProposalError as error:
                raise _refused(error) from error

    @app.get("/api/lucy-cloud/commits/{key}")
    def commit_result(
        key: str, request: Request,
        claims: Claims = Depends(current_claims),  # noqa: B008
    ):
        principal = who(request, claims)
        with transaction(engine, principal.workspace.id) as conn:
            row = cloud_proposals.by_commit_key(conn, principal.workspace.id, key)
            if row is None:
                raise _missing()
            mine(conn, principal, row.conversation_id)
            return cloud_proposals.commit_answer(row, None)

    @app.post("/api/lucy-cloud/messages/{message}/rating")
    def rate(
        message: str, body: RatingBody, request: Request,
        claims: Claims = Depends(current_claims),  # noqa: B008
    ):
        """Was this answer useful? Stored on the answer, for Lucy's evaluation; the latest
        press wins."""
        principal = who(request, claims)
        with transaction(engine, principal.workspace.id) as conn:
            conversation = cloud_store.rate(conn, principal.workspace.id, message, body.rating)
            if conversation is None:
                raise _missing()
            mine(conn, principal, conversation)
        return {"rating": body.rating}

    @app.get("/api/lucy-cloud/memory")
    def memory(request: Request, claims: Claims = Depends(current_claims)):  # noqa: B008
        who(request, claims)
        return {
            "facts": [],
            "history": {"enabled": False, "events": 0, "top": [], "period": None},
            "provider_receives": ["What you write to Lucy in this conversation",
                                  "Song titles, artists, albums and lengths",
                                  "Your mixes' names and songs"],
        }


__all__ = ["BASE", "install_routes", "status_of"]
