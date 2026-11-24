"""Lucy's tools in browser-first Cloud (ADR-0476): the catalogue, the account's mixes, proposals.

Plain named tools with small schemas, so a small model calls them reliably. Each answer is
compact JSON holding only catalogue metadata (id, title, artist, album, minutes); no path,
device or audio detail exists here to leak. Song text is untrusted: it is data inside a JSON
string, never an instruction, and the system prompt says so.

Nothing here changes a mix. A proposal tool stores a proposal revision for the person to look
at; only their "Save" writes a recipe revision (`cloud_proposals.commit`).
"""

from __future__ import annotations

import json
import re
import unicodedata
from collections import Counter
from dataclasses import dataclass, field
from typing import Any

import sqlalchemy as sa
from sqlalchemy.engine import Connection, Engine

from selecta.local_media import current_mix, recipes, store, versions
from selecta.local_media.schema import local_song_availability, local_songs
from selecta.lucy import cloud_proposals
from selecta.mix_contract import MAX_SONGS, NAME_LIMIT
from selecta.persistence import transaction

SEARCH_LIMIT = 25
ARTIST_LIMIT = 40
MIX_SONGS_SHOWN = 60
TOOL_SCHEMA_VERSION = "cloud-tools-4"


def fold(text: str | None) -> str:
    """Lower case without accents, so "Beyonce" finds "Beyoncé"."""
    plain = unicodedata.normalize("NFKD", text or "")
    return "".join(ch for ch in plain if not unicodedata.combining(ch)).casefold()


def minutes(seconds: float | None) -> float | None:
    return None if seconds is None else round(float(seconds) / 60, 1)


@dataclass
class CloudCtx:
    engine: Engine
    workspace_id: str
    user_id: str
    conversation_id: str
    turn_id: str
    proposals_on: bool = True
    _songs: list[dict[str, Any]] | None = None
    proposed: list[str] = field(default_factory=list)
    seen_ids: set[int] = field(default_factory=set)

    def songs(self) -> list[dict[str, Any]]:
        """The whole catalogue, read once per turn."""
        if self._songs is None:
            with transaction(self.engine, self.workspace_id) as conn:
                # one line per song, never its extra copies (ADR-0469 amendment 2)
                rows = conn.execute(
                    versions.listed_songs(
                        self.workspace_id, local_songs.c.id, local_songs.c.title,
                        local_songs.c.artist, local_songs.c.album, local_songs.c.duration_s,
                        local_songs.c.never_play,
                    ).order_by(local_songs.c.id)
                ).all()
            self._songs = [
                {"id": int(r.id), "title": r.title, "artist": r.artist, "album": r.album,
                 "duration_s": r.duration_s, "never": bool(r.never_play)}
                for r in rows
            ]
        return self._songs

    def mark_where(self, lines: list[dict[str, Any]]) -> None:
        """ADR-0475: a song no open device of the person's holds right now can still go in a
        mix, but won't play until one that has it is open. Said only once any device reports."""
        ids = [line["id"] for line in lines]
        if not ids:
            return
        with transaction(self.engine, self.workspace_id) as conn:
            reporting = conn.execute(
                sa.select(local_song_availability.c.song_id)
                .where(local_song_availability.c.workspace_id == self.workspace_id).limit(1)
            ).first()
            if reporting is None:
                return
            # a song is on a device when any of its versions is
            groups = versions.groups_of(conn, self.workspace_id, ids)
            members = {member for group in groups.values() for member in group}
            held = store.availability_counts(conn, self.workspace_id, members)
            counts = {song: sum(held.get(m, 0) for m in groups.get(song, [song])) for song in ids}
        for line in lines:
            if not counts.get(line["id"]):
                line["not_on_an_open_device"] = True

    def by_id(self) -> dict[int, dict[str, Any]]:
        return {song["id"]: song for song in self.songs()}


def song_line(song: dict[str, Any]) -> dict[str, Any]:
    line: dict[str, Any] = {"id": song["id"], "title": song["title"], "artist": song["artist"]}
    if song.get("album"):
        line["album"] = song["album"]
    if song.get("duration_s"):
        line["min"] = minutes(song["duration_s"])
    if song.get("never"):
        line["never_play"] = True
    return line


def library_summary(ctx: CloudCtx) -> dict[str, Any]:
    songs = ctx.songs()
    artists = Counter(song["artist"] for song in songs if song["artist"])
    total = sum(song["duration_s"] or 0 for song in songs)
    return {
        "songs": len(songs),
        "artists": len(artists),
        "hours": round(total / 3600, 1),
        "top_artists": [f"{name} ({count})" for name, count in artists.most_common(12)],
    }


# The tools ---------------------------------------------------------------------------------

_WORD = re.compile(r"[\w']+", re.UNICODE)
STOP = frozenset("a an and the of by to some songs song music track tracks me for with".split())


def search_songs(
    ctx: CloudCtx, query: str = "", limit: int = 10, queries: Any = None, **_: Any
) -> dict[str, Any]:
    if isinstance(queries, list) and queries:
        # several artists or titles in one call: one result list per query
        each = max(1, min(int(limit or 10), SEARCH_LIMIT) // max(1, min(len(queries), 8)))
        return {"results": [search_songs(ctx, query=str(q), limit=max(each, 3))
                            for q in queries[:8]]}
    words = [w for w in _WORD.findall(fold(query)) if w not in STOP]
    limit = max(1, min(int(limit or 10), SEARCH_LIMIT))
    if not words:
        return {"error": "Give some words to search for (a title, an artist or an album)."}
    scored = []
    for song in ctx.songs():
        title, artist, album = fold(song["title"]), fold(song["artist"]), fold(song["album"])
        haystack = f"{title} {artist} {album}"
        hits = sum(1 for w in words if w in haystack)
        if not hits:
            continue
        exact = (fold(query).strip() in (title, artist)) * 3
        scored.append((hits * 2 + exact + (all(w in haystack for w in words)) * 2, song))
    scored.sort(key=lambda item: (-item[0], fold(item[1]["artist"]), fold(item[1]["title"])))
    found = [song_line(song) for _score, song in scored[:limit]]
    ctx.mark_where(found)
    ctx.seen_ids.update(line["id"] for line in found)
    return {"query": query, "matches": len(scored), "songs": found,
            "note": None if found else "Nothing in this library matches those words."}


def list_artists(ctx: CloudCtx, query: str = "", **_: Any) -> dict[str, Any]:
    counts = Counter(song["artist"] for song in ctx.songs() if song["artist"])
    wanted = fold(query).strip()
    rows = [(name, n) for name, n in counts.items() if not wanted or wanted in fold(name)]
    rows.sort(key=lambda item: (-item[1], fold(item[0])))
    return {"query": query or None, "artists": [{"artist": a, "songs": n}
                                                 for a, n in rows[:ARTIST_LIMIT]],
            "total_artists": len(rows)}


def _current_mix_id(conn: Connection, workspace_id: str) -> str | None:
    chosen = current_mix.read(conn, workspace_id).get("mix_id")
    if chosen:
        return chosen
    saved = recipes.list_recipes(conn, workspace_id)
    return saved[0]["mix_id"] if saved else None


def current_recipe(ctx: CloudCtx) -> dict[str, Any] | None:
    with transaction(ctx.engine, ctx.workspace_id) as conn:
        mix_id = _current_mix_id(conn, ctx.workspace_id)
        if mix_id is None:
            return None
        try:
            return recipes.read(conn, ctx.workspace_id, mix_id)["mix"]
        except recipes.RecipeError:
            return None


def get_current_mix(ctx: CloudCtx, **_: Any) -> dict[str, Any]:
    mix = current_recipe(ctx)
    if mix is None:
        return {"mix": None, "note": "There is no mix yet. Offer to make one."}
    songs = mix["songs"]
    total = sum(song.get("duration") or 0 for song in songs)
    shown = [
        {"pos": i + 1, "id": song["song_id"], "title": song["title"], "artist": song["artist"],
         "min": minutes(song.get("duration"))}
        for i, song in enumerate(songs[:MIX_SONGS_SHOWN])
    ]
    ctx.seen_ids.update(line["id"] for line in shown)
    ctx.mark_where(shown)
    return {"mix": {"name": mix["name"], "songs": len(songs), "minutes": round(total / 60),
                    "order": shown,
                    "more": max(0, len(songs) - MIX_SONGS_SHOWN) or None}}


def list_mixes(ctx: CloudCtx, **_: Any) -> dict[str, Any]:
    with transaction(ctx.engine, ctx.workspace_id) as conn:
        saved = recipes.list_recipes(conn, ctx.workspace_id)
        current = _current_mix_id(conn, ctx.workspace_id)
    return {"mixes": [{"name": m["name"], "songs": m.get("songs"),
                       "current": m["mix_id"] == current} for m in saved[:30]]}


def _ints(values: Any) -> list[int]:
    out = []
    for value in values or []:
        if isinstance(value, dict):
            value = value.get("song_id", value.get("id"))
        try:
            out.append(int(value))
        except (TypeError, ValueError):
            continue
    return out


def _unknown(ctx: CloudCtx, ids: list[int]) -> list[int]:
    known = ctx.by_id()
    return [song_id for song_id in ids if song_id not in known]


def propose_mix_change(
    ctx: CloudCtx, add: Any = None, remove: Any = None, move: Any = None, summary: str = "",
    **_: Any,
) -> dict[str, Any]:
    mix = current_recipe(ctx)
    if mix is None:
        return {"error": "There is no current mix to change. Use propose_new_mix instead."}
    order = [int(song["song_id"]) for song in mix["songs"]]
    removing = set(_ints(remove))
    missing_removes = sorted(removing - set(order))
    order = [song_id for song_id in order if song_id not in removing]
    adds = add if isinstance(add, list) else []
    added = []
    for item in adds:
        song_id = _ints([item])
        if not song_id:
            continue
        position = item.get("position") if isinstance(item, dict) else None
        if song_id[0] in order:
            continue
        at = len(order) if not isinstance(position, int) else max(0, min(len(order),
                                                                          position - 1))
        order.insert(at, song_id[0])
        added.append(song_id[0])
    for item in move if isinstance(move, list) else []:
        if not isinstance(item, dict):
            continue
        song_id = _ints([item])
        to = item.get("to_position", item.get("position"))
        if not song_id or song_id[0] not in order or not isinstance(to, int):
            continue
        order.remove(song_id[0])
        order.insert(max(0, min(len(order), to - 1)), song_id[0])
    unknown = _unknown(ctx, added)
    if unknown:
        return {"error": f"Song ids {unknown} are not in this library. Search first and use "
                         "only ids a tool returned."}
    if missing_removes and not added and len(removing) == len(missing_removes):
        return {"error": f"Song ids {missing_removes} are not in the current mix."}
    if order == [int(song["song_id"]) for song in mix["songs"]]:
        return {"error": "That changes nothing in the mix."}
    if len(order) < 2:
        return {"error": "A mix needs at least two songs."}
    if len(order) > MAX_SONGS:
        return {"error": f"A mix holds at most {MAX_SONGS} songs."}
    return _store_proposal(ctx, mix["mix_id"], mix["revision"], mix["name"], order, summary)


def propose_new_mix(
    ctx: CloudCtx, name: str = "", song_ids: Any = None, summary: str = "", **_: Any
) -> dict[str, Any]:
    ids = list(dict.fromkeys(_ints(song_ids)))
    unknown = _unknown(ctx, ids)
    if unknown:
        return {"error": f"Song ids {unknown} are not in this library. Search first and use "
                         "only ids a tool returned."}
    if len(ids) < 2:
        return {"error": "A mix needs at least two songs from this library."}
    if len(ids) > MAX_SONGS:
        return {"error": f"A mix holds at most {MAX_SONGS} songs."}
    title = (name or "").strip()[:NAME_LIMIT] or "Lucy's mix"
    return _store_proposal(ctx, None, None, title, ids, summary)


def _store_proposal(
    ctx: CloudCtx, mix_id: str | None, base: str | None, name: str, order: list[int],
    summary: str,
) -> dict[str, Any]:
    with transaction(ctx.engine, ctx.workspace_id) as conn:
        made = cloud_proposals.add_revision(
            conn, ctx.workspace_id, ctx.conversation_id, ctx.turn_id, mix_id=mix_id,
            base_revision=base, name=name, song_ids=order, summary=(summary or "")[:600],
        )
    ctx.proposed.append(made["id"])
    songs = ctx.by_id()
    total = sum(songs[i]["duration_s"] or 0 for i in order if i in songs)
    return {
        "proposal": {"songs": len(order), "minutes": round(total / 60),
                     "kind": "change to the current mix" if mix_id else "new mix"},
        "note": "Shown to the person in the Your mix pane. Nothing is saved until they press "
                "Save. Tell them in one or two sentences what you proposed.",
    }


TOOLS: dict[str, Any] = {
    "search_songs": search_songs,
    "list_artists": list_artists,
    "get_current_mix": get_current_mix,
    "list_mixes": list_mixes,
    "propose_mix_change": propose_mix_change,
    "propose_new_mix": propose_new_mix,
}
PROPOSAL_TOOLS = frozenset({"propose_mix_change", "propose_new_mix"})
TITLES = {
    "search_songs": ("Searching your library", "search"),
    "list_artists": ("Looking at your artists", "search"),
    "get_current_mix": ("Reading your current mix", "revision"),
    "list_mixes": ("Looking at your mixes", "history"),
    "propose_mix_change": ("Proposing a change to your mix", "planning"),
    "propose_new_mix": ("Proposing a new mix", "planning"),
}


def run_tool(ctx: CloudCtx, name: str, arguments: Any) -> tuple[str, bool]:
    """The tool's answer as compact JSON, and whether it worked."""
    tool = TOOLS.get(name)
    if tool is None or (name in PROPOSAL_TOOLS and not ctx.proposals_on):
        return json.dumps({"error": f"There is no tool called {name}."}), False
    try:
        answer = tool(ctx, **(arguments if isinstance(arguments, dict) else {}))
    except (TypeError, ValueError) as problem:
        return json.dumps({"error": f"Bad arguments: {problem}"}), False
    except recipes.RecipeError as problem:
        return json.dumps({"error": problem.message}), False
    ok = "error" not in answer
    return json.dumps(answer, ensure_ascii=False, separators=(",", ":")), ok


__all__ = ["CloudCtx", "PROPOSAL_TOOLS", "TITLES", "TOOLS", "TOOL_SCHEMA_VERSION", "run_tool"]
