"""Practice Lucy for the local Cloud stack: no AI is called (ADR-0476).

With `SELECTA_DEV_LUCY_PRACTICE=1` the development API answers every Lucy turn with this
scripted stand-in instead of a model, so the conversation, several devices on it, Stop and
Save can be walked in a browser without a key or any spend. It answers slowly on purpose (a
word every quarter second), so a second device has time to send, stop or join. When the
message mentions a mix and the account's catalogue has songs, it proposes a new mix of the
first few. Development only: `application()` refuses to start outside development.
"""

from __future__ import annotations

import asyncio
from typing import Any

import sqlalchemy as sa
from sqlalchemy.engine import Engine

from selecta.local_media.schema import local_songs
from selecta.lucy.providers import ToolCall, TurnResult
from selecta.persistence import transaction

ENV = "SELECTA_DEV_LUCY_PRACTICE"
WORD_SECONDS = 0.25
NO_KEY = "practice-lucy-calls-no-ai"
"""Stands in for a deployment key so the gateway admits practice turns; never sent anywhere."""


class PracticeLucy:
    name = "scripted"
    model = "practice"

    def __init__(self, engine: Engine, workspace_id: str) -> None:
        self.engine, self.workspace_id = engine, workspace_id
        self.proposed = False

    def tool(self, name: str, description: str, schema: dict) -> dict:
        return {"name": name}

    def user(self, text: str) -> dict:
        return {"role": "user", "content": text}

    def results(self, turn: TurnResult, outputs: list) -> list[dict]:
        return [{"role": "assistant", "content": turn.text},
                {"role": "user", "content": "tool results"}]

    def _songs(self) -> list[int]:
        with transaction(self.engine, self.workspace_id) as conn:
            return [int(i) for i in conn.execute(
                sa.select(local_songs.c.id)
                .where(local_songs.c.workspace_id == self.workspace_id)
                .where(local_songs.c.deleted_at.is_(None))
                .order_by(local_songs.c.id).limit(4)
            ).scalars()]

    async def turn(self, system: list[str], messages: list[dict], tools: list[dict],
                   on_text: Any) -> TurnResult:
        asked = str(messages[-1].get("content") or "") if messages else ""
        songs = self._songs()
        if "mix" in asked.lower() and not self.proposed and len(songs) >= 2 and any(
            t["name"] == "propose_new_mix" for t in tools
        ):
            self.proposed = True
            return TurnResult(calls=[ToolCall("practice-1", "propose_new_mix", {
                "name": "Practice mix", "song_ids": songs, "summary": "A practice proposal."})])
        reply = ("I proposed a practice mix; it is in the Your mix pane, and nothing is saved "
                 "until you press Save." if self.proposed else
                 "This is practice Lucy on the local stack: no AI is called. I answer slowly "
                 "so you can try Stop and a second device while I type.")
        for word in reply.split(" "):
            await on_text(word + " ")
            await asyncio.sleep(WORD_SECONDS)
        return TurnResult(text=reply)


def factory(engine: Engine):
    return lambda settings, plan: PracticeLucy(engine, plan.workspace_id)


__all__ = ["ENV", "PracticeLucy", "factory"]
