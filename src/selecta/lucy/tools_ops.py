"""Lucy's read operations over the library, analysis, transitions and memory (ADR-0314..0317,
ADR-0320). Each one calls Selecta's existing services; none runs model-written code, none
returns a file path, and an unknown measurement stays null with a notice instead of a guess."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from weftai import ref, value
from weftai.schema.spec import any_schema, integer_schema, object_schema, string_schema

from selecta.lucy import catalog, memory, policy, readiness
from selecta.lucy.tools import Seam, Seams, Track, Tracks, define

LIST_LIMIT = 200
DETAIL_LIMIT = 20


def track_of(lib: catalog.Library, song: Any) -> Track:
    traits = lib.traits.get(song.id)
    plays = lib.plays.get(song.id, {}).get("completes") if lib.history_enabled else None
    return Track(
        id=song.id,
        title=policy.clean_text(song.title or "Untitled"),
        artist=policy.clean_text(song.artist or "Unknown artist"),
        genre=policy.clean_text(song.genre) or None,
        family=getattr(song, "family", None),
        bpm=round(float(song.bpm), 1) if song.bpm else None,
        key=getattr(song, "camelot", None) or None,
        energy=round(float(traits.energy), 3) if traits is not None else None,
        minutes=round(float(song.duration) / 60, 2) if song.duration else None,
        year=lib.years.get(song.id),
        plays=plays,
    )


def _row_track(row: Any, ready: bool) -> Track:
    return Track(
        id=row["id"],
        title=policy.clean_text(row["title"] or "Untitled"),
        artist=policy.clean_text(row["artist"] or "Unknown artist"),
        genre=policy.clean_text(row["genre"]) or None,
        minutes=round(float(row["duration"]) / 60, 2) if row["duration"] else None,
        mix_ready=ready,
    )


def _search(run) -> list[Track]:
    lib = run.ctx.lib()
    text = " ".join(str(run.input.get("text") or "").casefold().split())
    songs = lib.songs
    if text:
        songs = [s for s in songs if text in f"{s.artist} {s.title}".casefold()
                 or text in f"{s.title} {s.artist}".casefold()]
    run.notice(f"{len(lib.songs)} mix-ready songs in the library.")
    return [track_of(lib, song) for song in songs]


def _find(run) -> list[Track]:
    text = str(run.input["text"]).strip()
    if len(text) < 2:
        raise ValueError("Give at least two characters to look for.")
    lib = run.ctx.lib()
    like = f"%{text}%"
    rows = run.ctx.conn.execute(
        "SELECT id,title,artist,genre,duration FROM songs WHERE (title LIKE ? OR artist LIKE ?) "
        "ORDER BY artist,title LIMIT ?",
        (like, like, LIST_LIMIT),
    ).fetchall()
    if len(rows) == LIST_LIMIT:
        run.notice(f"Stopped at {LIST_LIMIT} songs; be more specific to see the rest.")
    return [_row_track(row, row["id"] in lib.by_id) for row in rows]


def _resolve(run) -> list[Track]:
    lib = run.ctx.lib()
    found = catalog.resolve(lib, str(run.input["name"]))
    if found["status"] == "missing":
        run.notice(found.get("reason") or "No mix-ready song or artist has that name.")
    elif found["status"] == "ambiguous":
        run.notice("Several recordings match; ask which one, by artist or version.")
    elif found["status"] == "artist":
        run.notice("That is an artist; these are their mix-ready songs.")
    return [track_of(lib, lib.by_id[song_id]) for song_id in found["ids"] if song_id in lib.by_id]


def _excluded(run) -> list[Track]:
    ids = sorted(run.ctx.app.never_played(run.ctx.conn))
    rows = [run.ctx.conn.execute("SELECT id,title,artist,genre,duration FROM songs WHERE id=?",
                                 (song_id,)).fetchone() for song_id in ids[:LIST_LIMIT]]
    return [_row_track(row, False) for row in rows if row is not None]


def _duplicates(run) -> list[Track]:
    rows = run.ctx.conn.execute(
        "SELECT id,title,artist,genre,duration FROM songs WHERE duplicate_of IS NOT NULL "
        "ORDER BY artist,title LIMIT ?", (LIST_LIMIT,)).fetchall()
    return [_row_track(row, False) for row in rows]


def _eligibility(run) -> list[dict]:
    """Why each song can or can't be mixed, from the same facts the planner uses."""
    from selecta.config import ANALYSIS_VERSION

    conn = run.ctx.conn
    lib = run.ctx.lib()
    never = run.ctx.app.never_played(conn)
    answers = []
    for track in list(run.input["from"].items)[:DETAIL_LIMIT]:
        row = conn.execute(
            "SELECT s.path,s.size,s.is_music,s.duplicate_of,a.version,a.error,a.bpm FROM songs s "
            "LEFT JOIN analysis a ON a.song_id=s.id WHERE s.id=?", (track.id,)).fetchone()
        reasons = []
        if row is None:
            reasons.append("not in the library any more")
        else:
            if not row["is_music"]:
                reasons.append("set aside as not music")
            if row["duplicate_of"]:
                reasons.append("a duplicate of another song")
            if track.id in never:
                reasons.append("you ruled it out")
            if row["version"] is None:
                reasons.append("not analysed yet")
            elif row["error"]:
                reasons.append("analysis failed")
            elif row["version"] != ANALYSIS_VERSION:
                reasons.append("analysed by an older version; waiting to be redone")
            elif row["bpm"] is None:
                reasons.append("no steady beat was found")
            if not Path(row["path"]).exists():
                reasons.append("the audio file is missing")
        answers.append({"id": track.id, "title": track.title,
                        "mix_ready": track.id in lib.by_id and not reasons, "reasons": reasons})
    return answers


def _most_played(run) -> list[Track]:
    conn = run.ctx.conn
    if not memory.history_enabled(conn):
        run.notice("Listening history is off, so there is nothing to rank. It can be turned on "
                   "in Lucy's settings.")
        return []
    days = int(run.input.get("days") or 90)
    found = memory.most_played(conn, days, 50)
    lib = run.ctx.lib()
    if not found["top"]:
        run.notice("No listening has been recorded in that period yet.")
    run.notice(f"Counted from real plays in the {found['period'] or 'chosen period'}.")
    tracks = []
    for row in found["top"]:
        song = lib.by_id.get(row["song_id"])
        if song is not None:
            item = track_of(lib, song)
            item.plays = row["completes"]
            tracks.append(item)
    return tracks


def _features(run) -> list[dict]:
    """Measured values only, each with where it came from (LU-315-01/02)."""
    from selecta.config import ANALYSIS_VERSION

    conn = run.ctx.conn
    lib = run.ctx.lib()
    items = list(run.input["from"].items)
    if len(items) > DETAIL_LIMIT:
        run.notice(f"Showing features for the first {DETAIL_LIMIT} of {len(items)} songs.")
    out = []
    for track in items[:DETAIL_LIMIT]:
        song = lib.by_id.get(track.id)
        if song is None:
            out.append({"id": track.id, "title": track.title, "measured": False,
                        "why": "not mix-ready, so there are no current measurements"})
            continue
        corrected = conn.execute("SELECT bpm,camelot FROM song_overrides WHERE song_id=?",
                                 (song.id,)).fetchone()
        lyric = conn.execute("SELECT status FROM lyrics WHERE song_id=?", (song.id,)).fetchone()
        source = f"analysis v{ANALYSIS_VERSION}"

        def field(value: Any, by: str = source) -> dict:
            return {"value": value, "known": value is not None, "source": by}

        out.append({
            "id": song.id,
            "title": policy.clean_text(song.title),
            "fields": {
                "bpm": field(round(float(song.bpm), 1) if song.bpm else None,
                             "your correction" if corrected and corrected["bpm"] else source),
                "key": field(song.camelot or None,
                             "your correction" if corrected and corrected["camelot"] else source),
                "key_confidence": field(round(float(song.key_confidence), 2)),
                "steady_tempo": field(bool(song.constant_tempo)),
                "beat_grid_confidence": field(round(float(song.grid_confidence), 2)),
                "energy_in_library": field(round(float(lib.traits[song.id].energy), 3)),
                "loudness_lufs": field(round(float(song.lufs), 1)),
                "sections": field(len(song.sections or [])),
                "minutes": field(round(float(song.duration) / 60, 2)),
                "lyrics": field(lyric["status"] if lyric else None, "LRCLIB lookup"),
            },
        })
    return out


def _health(run) -> dict:
    from selecta.config import ANALYSIS_VERSION

    conn = run.ctx.conn
    one = lambda sql, *args: conn.execute(sql, args).fetchone()[0]  # noqa: E731
    return {
        "songs": one("SELECT COUNT(*) FROM songs"),
        "music": one("SELECT COUNT(*) FROM songs WHERE is_music=1 AND duplicate_of IS NULL"),
        "mix_ready": len(run.ctx.lib().songs),
        "analysed_current": one("SELECT COUNT(*) FROM analysis WHERE version=? AND error IS NULL",
                                ANALYSIS_VERSION),
        "analysis_failed": one("SELECT COUNT(*) FROM analysis WHERE error IS NOT NULL"),
        "duplicates": one("SELECT COUNT(*) FROM songs WHERE duplicate_of IS NOT NULL"),
        "ruled_out": len(run.ctx.app.never_played(conn)),
    }


def _request_analysis(run) -> dict:
    """Never runs analysis: files a request the person must allow (LU-315-05, LU-333-07)."""
    from selecta.lucy import permissions

    ids = [track.id for track in list(run.input["from"].items)[:50]]
    if not ids:
        raise ValueError("Name the songs to analyse first.")
    found = permissions.request(run.ctx, "compute", "analysis.request", {"song_ids": ids},
                                f"Analyse {len(ids)} song{'s' if len(ids) != 1 else ''} first? "
                                "This uses your computer for a few minutes per song, after "
                                "anything already playing or rendering.")
    run.notice("Nothing runs until the person allows it.")
    return {"permission": found["id"], "status": found["status"], "songs": len(ids)}


def _seam(lib: catalog.Library, edge: Any, verified: bool, status: str = "already_rendered",
          history: str = "unknown") -> Seam:
    return Seam(
        key=edge.key if hasattr(edge, "key") else edge["key"],
        a=edge.a, b=edge.b,
        a_title=lib.label(edge.a)["title"], b_title=lib.label(edge.b)["title"],
        requested=edge.settings.get("move", "auto") if hasattr(edge, "settings") else "auto",
        rendered=getattr(edge, "style", None), status=status, verified=verified,
        history=history,
    )


def _inventory(run, direction: str | None = None) -> list[Seam]:
    ctx = run.ctx
    lib = ctx.lib()
    found = readiness.inventory(ctx.conn, ctx.app.store, lib.songs)
    run.notice(
        f"Checked {found.counts.get('seams_examined', 0)} rendered transitions on disk; "
        f"{found.counts.get('verified_ready_edges', 0)} are ready to play now. Ones that were "
        "ready before but are gone don't count."
    )
    edges = found.edges()
    if direction is not None:
        ids = {track.id for track in run.input["from"].items}
        edges = [edge for edge in edges if (edge.a if direction == "from" else edge.b) in ids]
    return [_seam(lib, edge, True) for edge in edges]


def _evaluate(run) -> list[dict]:
    """Directed pairs in the given order: A→B and B→A are different questions (LU-320-01)."""
    from selecta.lucy.planning import _key_distance, _tempo_gap

    ctx = run.ctx
    lib = ctx.lib()
    tracks = list(run.input["from"].items)[:11]
    found = readiness.inventory(ctx.conn, ctx.app.store, lib.songs)
    out = []
    for first, second in zip(tracks, tracks[1:], strict=False):
        a, b = lib.by_id.get(first.id), lib.by_id.get(second.id)
        known = lib.memory.best_known(first.id, second.id) if lib.memory else None
        ready = [edge for edge in found.adjacency.get(first.id, ()) if edge.b == second.id]
        gap = _tempo_gap(a, b)
        out.append({
            "a": first.title, "b": second.title,
            "tempo_gap_percent": round(gap * 100, 1) if gap is not None else None,
            "key_steps_apart": _key_distance(a, b),
            "ready_clips": [{"move": edge.style, "key": edge.key} for edge in ready],
            "history": {"move": known[0], "result": known[1]} if known else None,
            "provenance": "playable" if ready else "history_only" if known else "predicted",
        })
    if len(tracks) < 2:
        run.notice("Give at least two songs, in the order to check.")
    return out


def _bridges(run) -> list[Track]:
    from selecta.planner.beam import rank_candidates

    lib = run.ctx.lib()
    a_items, b_items = list(run.input["a"].items), list(run.input["b"].items)
    if not a_items or not b_items:
        raise ValueError("Give a song to leave and a song to reach.")
    a, b = lib.by_id.get(a_items[0].id), lib.by_id.get(b_items[0].id)
    if a is None or b is None:
        raise ValueError("Both songs need to be mix-ready.")
    ranked = rank_candidates(a, b, lib.songs, {a.id, b.id}, lib.phrases, memory=lib.memory)
    run.notice("These are predictions from measurements, not rendered transitions.")
    return [track_of(lib, item.song) for item in ranked[:10]]


def _history(run) -> list[Seam]:
    lib = run.ctx.lib()
    ids = {track.id for track in run.input["from"].items}
    remembered = lib.memory
    seen: dict[tuple[int, int], str] = {}
    for group, how in ((remembered.liked, "liked"), (remembered.clean, "clean"),
                       (remembered.disliked, "failed")):
        for a, b, _move in group:
            if (a in ids or b in ids) and (a, b) not in seen:
                seen[(a, b)] = how
    run.notice("History says what happened before. It does not mean a clip is ready now.")
    return [
        Seam(key=f"{a}->{b}", a=a, b=b, a_title=lib.label(a)["title"],
             b_title=lib.label(b)["title"], requested="auto", status="history_only",
             history=how)
        for (a, b), how in list(seen.items())[:LIST_LIMIT]
    ]


def _facts(run) -> list[dict]:
    return [
        {"kind": fact["kind"], "subject": fact["subject"], "value": fact["value"],
         "confidence": fact["confidence"], "source": fact["source"]}
        for fact in memory.facts(run.ctx.conn, run.ctx.conversation)
    ]


def _remember(run) -> dict:
    """Only what the person asked Lucy to remember, in this very turn (save tier)."""
    ctx = run.ctx
    if ctx.turn_kind != "remember":
        raise PermissionError("Lucy only remembers something when you ask it to in your message.")
    if not memory.history_enabled(ctx.conn) and run.input.get("scope") != "conversation":
        kind = "session"
    else:
        kind = "explicit" if run.input.get("scope") != "conversation" else "session"
    fact = memory.add_fact(ctx.conn, run.input["subject"], run.input["value"], kind,
                           {"turn": ctx.turn, "words": policy.clean_text(ctx.turn_text, 300)},
                           None, ctx.conversation)
    return {"remembered": fact["label"], "kind": fact["kind"]}


def operations() -> list:
    from selecta.lucy import proposal_ops

    tracks_ref = object_schema({"from": ref(Tracks)})
    return [
        define("tracks.search", "Mix-ready songs, optionally only those whose title or artist "
               "contains `text`. Start here.", object_schema({"text": string_schema().optional()}),
               Tracks, _search),
        define("tracks.find", "Any song in the library by title or artist text, mix-ready or "
               "not, with mix_ready true/false.", object_schema({"text": string_schema()}),
               Tracks, _find),
        define("tracks.resolveName", "What a name the person used refers to: one song, an "
               "artist's songs, or several options to ask about.",
               object_schema({"name": string_schema()}), Tracks, _resolve),
        define("tracks.excluded", "Songs the person ruled out (never play).", object_schema({}),
               Tracks, _excluded),
        define("tracks.duplicates", "Songs set aside as duplicates.", object_schema({}), Tracks,
               _duplicates),
        define("tracks.eligibility", "Why each song can or can't be mixed.", tracks_ref,
               value(any_schema()), _eligibility),
        define("tracks.mostPlayed", "Most-played songs from real recorded listening, if the "
               "person turned history on.", object_schema({"days": integer_schema().optional()}),
               Tracks, _most_played),
        define("analysis.features", "Measured tempo, key, energy, loudness, sections and lyric "
               "status for up to 20 songs, each with its source. Unknown is null.", tracks_ref,
               value(any_schema()), _features),
        define("analysis.health", "Counts of analysed, failed, duplicate and ruled-out songs.",
               object_schema({}), value(any_schema()), _health),
        define("analysis.request", "ASK the person to allow analysing songs. Runs nothing by "
               "itself.", tracks_ref, value(any_schema()), _request_analysis, tier="compute"),
        define("transitions.readyInventory", "Transitions verified on disk as ready to play now "
               "(directed A → B). History never counts as ready.", object_schema({}), Seams,
               lambda run: _inventory(run)),
        define("transitions.readyFrom", "Ready transitions leaving these songs.", tracks_ref,
               Seams, lambda run: _inventory(run, "from")),
        define("transitions.readyTo", "Ready transitions arriving at these songs.", tracks_ref,
               Seams, lambda run: _inventory(run, "to")),
        define("transitions.evaluate", "Check each neighbouring pair in the given order: tempo "
               "gap, key distance, ready clips and history.", tracks_ref, value(any_schema()),
               _evaluate),
        define("transitions.bridges", "Songs that could sit between song a and song b.",
               object_schema({"a": ref(Tracks), "b": ref(Tracks)}), Tracks, _bridges),
        define("transitions.history", "Past results (liked, clean, failed) of transitions "
               "touching these songs. Not readiness.", tracks_ref, Seams, _history),
        define("memory.facts", "What Lucy remembers: things the person said, and patterns "
               "learned from real listening, with counts.", object_schema({}),
               value(any_schema()), _facts),
        define("memory.remember", "Remember a preference the person just asked you to remember, "
               "in their words.", object_schema({"subject": string_schema(),
                                                 "value": string_schema(),
                                                 "scope": string_schema().optional()}),
               value(any_schema()), _remember, tier="save"),
        *proposal_ops.operations(),
    ]
