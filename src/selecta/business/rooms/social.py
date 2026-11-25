"""What a standing room does together: settings, plays, the pulse, reactions and dedications
(ADR-0488, venue rooms). Part of `ZoneRooms`; votes, the recap and patron screens are in
`social_votes`.

The rules are the party rooms' rules (`selecta.roomsocial`): a phone sends a tap, a vote or the
id of a listed line, never words; counts are shown, never who tapped; and every feature is
whole on the phone, with a patron screen only adding a shared view.

What differs is the venue. A feature is offered only while the room is taking part in the
evening (open, or its music paused), each feature has its own `business.rooms.*` flag, and
staff, not a host, switch them. A standing room has no end, so a play is told from another by
the zone session's own key, and what rooms loved is kept per zone: a quiet lunch should not
teach a late bar.
"""

from __future__ import annotations

import threading
import zlib
from typing import Any

import sqlalchemy as sa
from sqlalchemy.engine import Connection

from selecta.business.access import BusinessActor, BusinessInvalid
from selecta.business.rooms import social_schema as tables
from selecta.business.rooms.errors import Refused
from selecta.business.rooms.schema import business_zone_room_guests as guests_t
from selecta.business.rooms.schema import business_zone_room_requests as requests_t
from selecta.persistence import new_id, transaction
from selecta.rooms.social_schema import crowd_marks
from selecta.roomsocial import dedications as lines
from selecta.roomsocial import reactions as tap_rules

FEATURES = ("keeps", "reactions", "rounds", "dedications", "recap")
DEFAULTS: dict[str, Any] = {
    "keeps": True,
    "reactions": True,
    "rounds": True,
    "round_seconds": 45,
    "round_every_songs": 0,
    "dedications": True,
    "dedications_hidden": [],
    "recap": True,
    "screen_rounds": True,
    "screen_reactions": True,
    "screen_dedications": True,
    "screen_recap": True,
}
NUMBERS = {"round_seconds": (30, 120), "round_every_songs": (0, 10)}
SHOWN_STATES = ("open", "music_paused")
BLEND_WINDOW_S = 45.0
LATE_TAP_S = 15.0
GUEST_ONLINE_S = 60.0
SCREEN_ONLINE_S = 30.0
PULSE_LIVE_S = 1.0
TEXT_OFF = "That isn't on here."
TEXT_SONG_CHANGED = "That song has finished."


def song_number(title: str, artist: str) -> int:
    """A number for a song as a venue guest sees it. A venue guest is never given a catalogue
    id, but the page keeps and matches songs by a number, so it gets one made from the words."""
    return zlib.crc32(f"{title}|{artist}".encode())


def clean_settings(current: dict[str, Any], changes: dict[str, Any]) -> dict[str, Any]:
    """The room's choices with `changes` laid over them. Unknown keys are ignored; a value of
    the wrong kind is refused."""
    merged = {**DEFAULTS, **{k: v for k, v in current.items() if k in DEFAULTS}}
    for key, value in changes.items():
        if key not in DEFAULTS:
            continue
        if key == "dedications_hidden":
            if not isinstance(value, (list, tuple)):
                raise BusinessInvalid("Give the hidden dedications as a list.", code="bad_social")
            merged[key] = list(lines.known_ids(value))
        elif key in NUMBERS:
            if isinstance(value, bool) or not isinstance(value, int):
                raise BusinessInvalid(f"{key} must be a whole number.", code="bad_social")
            low, high = NUMBERS[key]
            merged[key] = 2 if key == "round_every_songs" and value == 1 else min(
                max(value, low), high)
        else:
            if not isinstance(value, bool):
                raise BusinessInvalid(f"{key} must be true or false.", code="bad_social")
            merged[key] = value
    return merged


class SocialMixin:
    _pulses: dict[str, tuple[float, dict[str, Any]]]
    _pulse_lock: threading.Lock

    # ---- settings ------------------------------------------------------------------------

    def social_of(self, conn: Connection, room) -> dict[str, Any]:
        kept = conn.execute(sa.select(tables.social.c.settings).where(
            tables.social.c.room_id == room["id"])).scalar()
        return {**DEFAULTS, **{k: v for k, v in (kept or {}).items() if k in DEFAULTS}}

    def social_view(self, conn: Connection, actor: BusinessActor, zone_id: str) -> dict:
        zone = self.scoped_zone(conn, actor, zone_id)
        room = self.ensure_room(conn, zone)
        return {
            "zone_id": zone.id,
            "settings": self.social_of(conn, room),
            "on": {name: self.flag_on(f"business.rooms.{name}") for name in FEATURES},
            "lines": [{"id": line.id, "words": line.words} for line in lines.lines_for(
                lines.VENUE)],
            "screens": self.screens(conn, room, self.clock()),
            "display_on": self.flag_on("business.rooms.display"),
        }

    def update_social(self, conn: Connection, actor: BusinessActor, zone_id: str,
                      changes: dict[str, Any]) -> dict:
        zone = self.scoped_zone(conn, actor, zone_id)
        room = self.ensure_room(conn, zone)
        values = clean_settings(self.social_of(conn, room), changes)
        now = self.clock()
        updated = conn.execute(tables.social.update().where(
            tables.social.c.room_id == room["id"]).values(settings=values, updated_at=now)
        ).rowcount
        if not updated:
            conn.execute(tables.social.insert().values(
                room_id=room["id"], workspace_id=room["workspace_id"],
                organisation_id=room["organisation_id"], settings=values, updated_at=now))
        self.forget_pulse(room["id"])
        return self.social_view(conn, actor, zone_id)

    def offered(self, conn: Connection, room, now: float) -> dict[str, bool]:
        """Which of the five this room offers its guests right now."""
        chosen = self.social_of(conn, room)
        live = self.room_state(conn, room, now).state in SHOWN_STATES
        return {name: live and bool(chosen[name]) and self.flag_on(f"business.rooms.{name}")
                for name in FEATURES}

    def _need(self, conn: Connection, room, now: float, name: str) -> dict[str, Any]:
        if not self.offered(conn, room, now)[name]:
            raise Refused(409, "feature_off", TEXT_OFF)
        return self.social_of(conn, room)

    # ---- plays ---------------------------------------------------------------------------

    def observe_play(self, conn: Connection, room, now: float):
        """The play for the song the zone is on, written down on the first look at it."""
        state = self.playback.state(conn, room["zone_id"])
        playing = state.now_playing
        if not playing or not playing.get("play_key"):
            return None
        where = (tables.plays.c.room_id == room["id"],
                 tables.plays.c.play_key == playing["play_key"])
        row = conn.execute(sa.select(tables.plays).where(*where)).mappings().first()
        # paused at the very start is loaded, not played; paused part-way in has played
        if row is not None or (state.paused and float(playing.get("offset_s") or 0.0) <= 0.0):
            return row
        before = conn.execute(sa.select(tables.plays.c.id).where(
            tables.plays.c.room_id == room["id"]).order_by(
            tables.plays.c.started_at.desc(), tables.plays.c.id.desc()).limit(1)).scalar()
        try:
            with conn.begin_nested():
                conn.execute(tables.plays.insert().values(
                    id=new_id(), workspace_id=room["workspace_id"],
                    organisation_id=room["organisation_id"], room_id=room["id"],
                    zone_id=room["zone_id"], play_key=playing["play_key"],
                    title=playing.get("title") or "", artist=playing.get("artist") or "",
                    previous_play_id=before,
                    started_at=now - float(playing.get("offset_s") or 0.0), loves=0, blends=0))
        except sa.exc.IntegrityError:
            pass  # another look wrote it in the same instant
        return conn.execute(sa.select(tables.plays).where(*where)).mappings().first()

    def _play(self, conn: Connection, play_id: str | None):
        if not play_id:
            return None
        return conn.execute(sa.select(tables.plays).where(tables.plays.c.id == play_id)
                            ).mappings().first()

    def guests_online(self, conn: Connection, room, now: float) -> int:
        return conn.execute(sa.select(sa.func.count()).select_from(guests_t).where(
            guests_t.c.room_id == room["id"], guests_t.c.status == "active",
            guests_t.c.last_seen > now - GUEST_ONLINE_S)).scalar_one()

    # ---- the pulse -----------------------------------------------------------------------

    def forget_pulse(self, room_id: str) -> None:
        with self._pulse_lock:
            self._pulses.pop(room_id, None)

    def pulse(self, conn: Connection, room, now: float) -> dict[str, Any]:
        """The few things that change by the second, the same for every phone and screen in
        the room, made once a second per room."""
        with self._pulse_lock:
            kept = self._pulses.get(room["id"])
            if kept is not None and kept[0] > now:
                return kept[1]
        made = self._make_pulse(conn, room, now)
        with self._pulse_lock:
            if len(self._pulses) > 2000:
                self._pulses.clear()
            self._pulses[room["id"]] = (now + PULSE_LIVE_S, made)
        return made

    def _make_pulse(self, conn: Connection, room, now: float) -> dict[str, Any]:
        self.settle_round(conn, room, now)
        on = self.offered(conn, room, now)
        chosen = self.social_of(conn, room)
        play = self.observe_play(conn, room, now) if any(on.values()) else None
        state = self.playback.state(conn, room["zone_id"])
        online = self.guests_online(conn, room, now)
        answer: dict[str, Any] = {
            "now": now,
            "live": any(on.values()),
            "screen": self.screens_live(conn, room, now) > 0,
            "features": on,
            "shows": {name: on[name] and bool(chosen[f"screen_{name}"])
                      for name in ("rounds", "reactions", "dedications", "recap")},
            "song": None,
            "paused": bool(state.paused),
            "play": None,
            "online": online,
        }
        if play is not None:
            number = song_number(play["title"], play["artist"])
            answer["song"] = {"song_id": number, "title": play["title"],
                              "artist": play["artist"], "length_s": 0}
            before = self._play(conn, play["previous_play_id"])
            fresh = before is not None and now - play["started_at"] <= BLEND_WINDOW_S
            taps = on["reactions"]
            answer["play"] = {
                "play_id": play["id"], "song_id": number, "started_at": play["started_at"],
                "loves": play["loves"] if taps else 0,
                "blends": play["blends"] if taps else 0,
                "blend": {"from": {"song_id": song_number(before["title"], before["artist"]),
                                   "title": before["title"], "artist": before["artist"],
                                   "length_s": 0},
                          "until": play["started_at"] + BLEND_WINDOW_S}
                if fresh and taps else None,
            }
            answer["blend_loved"] = bool(taps and before is not None and tap_rules.worth_saying(
                play["blends"], online))
            if on["dedications"]:
                answer["dedication"] = self.dedication_showing(conn, room, play, chosen)
        if on["rounds"]:
            self.maybe_want_round(conn, room, now, online, chosen)
            answer["round"] = self.round_showing(conn, room, now)
        return answer

    def guest_pulse(self, token: str, room_key: str | None = None) -> dict[str, Any]:
        with transaction(self.engine) as conn:
            _guest, room = self.guest_row(conn, token, room_key)
            return self.pulse(conn, room, self.clock())

    def guest_social(self, conn: Connection, guest, room, now: float) -> dict[str, Any]:
        """What the guest's own view adds: which features are on, the lines offered, their own
        taps and vote, and the dedications on their requests."""
        on = self.offered(conn, room, now)
        answer: dict[str, Any] = {"social": on, "screen": self.screens_live(conn, room, now) > 0}
        chosen = self.social_of(conn, room)
        if on["dedications"]:
            answer["dedication_lines"] = [
                {"id": line.id, "words": line.words}
                for line in lines.lines_for(lines.VENUE, chosen["dedications_hidden"])]
            answer["my_dedications"] = {
                row.request_id: {"line": row.line, "words": lines.words_of(row.line)}
                for row in conn.execute(
                    sa.select(tables.dedications.c.request_id, tables.dedications.c.line)
                    .select_from(tables.dedications.join(
                        requests_t, requests_t.c.id == tables.dedications.c.request_id))
                    .where(requests_t.c.guest_id == guest["id"]))}
        if on["reactions"]:
            recent = list(conn.execute(sa.select(tables.plays.c.id).where(
                tables.plays.c.room_id == room["id"]).order_by(
                tables.plays.c.started_at.desc(), tables.plays.c.id.desc()).limit(2)).scalars())
            taps: dict[str, list[str]] = {}
            if recent:
                for row in conn.execute(sa.select(
                        tables.reactions.c.play_id, tables.reactions.c.kind).where(
                        tables.reactions.c.guest_id == guest["id"],
                        tables.reactions.c.play_id.in_(recent))):
                    taps.setdefault(row.play_id, []).append(row.kind)
            answer["my_taps"] = taps
        if on["rounds"]:
            answer.update(self.my_round_vote(conn, guest, room))
        return answer

    # ---- reactions -----------------------------------------------------------------------

    def react(self, token: str, kind: str, play_id: str, on: bool, *,
              room_key: str | None = None) -> dict[str, Any]:
        if kind not in tap_rules.KINDS:
            raise Refused(422, "bad_kind", "That isn't a reaction.")
        with transaction(self.engine) as conn:
            guest, room = self.guest_row(conn, token, room_key)
            now = self.clock()
            self._need(conn, room, now, "reactions")
            current = self.observe_play(conn, room, now)
            play = current if current is not None and current["id"] == play_id else None
            if (play is None and current is not None and current["previous_play_id"] == play_id
                    and now - current["started_at"] <= LATE_TAP_S):
                play = self._play(conn, play_id)  # a tap for the song that just ended
            if play is None:
                raise Refused(409, "song_changed", TEXT_SONG_CHANGED)
            before = self._play(conn, play["previous_play_id"])
            if kind == tap_rules.BLEND and on and (
                    before is None or now - play["started_at"] > BLEND_WINDOW_S):
                raise Refused(409, "song_changed", "That blend has passed.")
            mine = (tables.reactions.c.play_id == play["id"],
                    tables.reactions.c.guest_id == guest["id"],
                    tables.reactions.c.kind == kind)
            changed = False
            if on:
                try:
                    with conn.begin_nested():
                        conn.execute(tables.reactions.insert().values(
                            id=new_id(), workspace_id=room["workspace_id"],
                            organisation_id=room["organisation_id"], room_id=room["id"],
                            guest_id=guest["id"], play_id=play["id"], kind=kind, created_at=now))
                    changed = True
                except sa.exc.IntegrityError:
                    pass  # one tap of each kind per guest per play
            else:
                changed = bool(conn.execute(tables.reactions.delete().where(*mine)).rowcount)
            if changed:
                column = tables.plays.c.loves if kind == tap_rules.LOVE else tables.plays.c.blends
                step = 1 if on else -1
                conn.execute(tables.plays.update().where(tables.plays.c.id == play["id"]).values(
                    {column.name: sa.case((column + step < 0, 0), else_=column + step)}))
                self._mark(conn, room, play, before, kind, step, now)
            self.forget_pulse(room["id"])
            return {"play_id": play["id"], "kind": kind, "on": on,
                    "pulse": self.pulse(conn, room, now)}

    def _mark(self, conn: Connection, room, play, before, kind: str, step: int,
              now: float) -> None:
        """Add the tap to the zone's crowd marks. `rooms` here counts plays the room loved: it
        goes up on the tap that takes a play past the threshold."""
        def local(row) -> int | None:
            tail = str(row["play_key"]).rsplit(":", 1)[-1]
            return int(tail) if tail.isdigit() else None

        song = local(play)
        other = local(before) if before is not None else None
        if song is None or (kind == tap_rules.BLEND and other is None):
            return
        pair = (song, 0) if kind == tap_rules.LOVE else (other, song)
        taps = (play["loves"] if kind == tap_rules.LOVE else play["blends"]) + step
        online = self.guests_online(conn, room, now)
        crossed = step > 0 and tap_rules.room_counts(taps, online) and not tap_rules.room_counts(
            taps - 1, online)
        where = (crowd_marks.c.workspace_id == room["workspace_id"],
                 crowd_marks.c.zone_key == room["zone_id"], crowd_marks.c.song_id == pair[0],
                 crowd_marks.c.next_song_id == pair[1])
        total = crowd_marks.c.loves + step
        # The crowd marks are a table the party rooms own. A database that holds only the
        # business tables has none: the tap still counts for the room, and nothing is learned.
        try:
            with conn.begin_nested():
                updated = conn.execute(crowd_marks.update().where(*where).values(
                    loves=sa.case((total < 0, 0), else_=total),
                    rooms=crowd_marks.c.rooms + (1 if crossed else 0), last_at=now)).rowcount
                if not updated and step > 0:
                    conn.execute(crowd_marks.insert().values(
                        id=new_id(), workspace_id=room["workspace_id"], zone_key=room["zone_id"],
                        song_id=pair[0], next_song_id=pair[1], loves=1,
                        rooms=1 if crossed else 0, last_at=now))
        except sa.exc.SQLAlchemyError:
            pass

    # ---- dedications ---------------------------------------------------------------------

    def set_dedication(self, token: str, request_id: str, line_id: str | None, *,
                       room_key: str | None = None) -> dict[str, Any]:
        with transaction(self.engine) as conn:
            guest, room = self.guest_row(conn, token, room_key)
            now = self.clock()
            chosen = self._need(conn, room, now, "dedications")
            found = conn.execute(sa.select(requests_t).where(
                requests_t.c.id == request_id, requests_t.c.room_id == room["id"],
                requests_t.c.guest_id == guest["id"])).mappings().first()
            if found is None:
                raise Refused(404, "no_such_request", "That request has gone.")
            if found["status"] not in ("sent", "approved"):
                raise Refused(409, "not_allowed", "That request isn't waiting any more.")
            if line_id is not None and not lines.allowed(
                    line_id, lines.VENUE, chosen["dedications_hidden"]):
                raise Refused(422, "no_such_line", "Pick one of the dedications offered.")
            conn.execute(tables.dedications.delete().where(
                tables.dedications.c.request_id == request_id))
            if line_id is not None:
                conn.execute(tables.dedications.insert().values(
                    request_id=request_id, workspace_id=room["workspace_id"],
                    organisation_id=room["organisation_id"], room_id=room["id"], line=line_id,
                    created_at=now))
            self.forget_pulse(room["id"])
            return {"request_id": request_id, "dedication": line_id}

    def clear_dedication(self, conn: Connection, actor: BusinessActor, zone_id: str,
                         request_id: str) -> dict[str, Any]:
        zone = self.scoped_zone(conn, actor, zone_id)
        room = self.ensure_room(conn, zone)
        conn.execute(tables.dedications.delete().where(
            tables.dedications.c.request_id == request_id,
            tables.dedications.c.room_id == room["id"]))
        self.forget_pulse(room["id"])
        return {"request_id": request_id, "dedication": None}

    def dedication_showing(self, conn: Connection, room, play, chosen) -> dict | None:
        """The dedication for the song that is on. A request is matched to the play by its
        title and artist, and the first look binds it to this play, so it shows once."""
        hidden = set(chosen["dedications_hidden"])
        rows = conn.execute(
            sa.select(tables.dedications.c.request_id, tables.dedications.c.line,
                      tables.dedications.c.play_id)
            .select_from(tables.dedications.join(
                requests_t, requests_t.c.id == tables.dedications.c.request_id))
            .where(tables.dedications.c.room_id == room["id"],
                   requests_t.c.title == play["title"], requests_t.c.artist == play["artist"],
                   requests_t.c.status.in_(("approved", "played")),
                   sa.or_(tables.dedications.c.play_id.is_(None),
                          tables.dedications.c.play_id == play["id"]))
            .order_by(tables.dedications.c.created_at)).all()
        for row in rows:
            words = lines.words_of(row.line)
            if words is None or row.line in hidden:
                continue
            if row.play_id is None:
                conn.execute(tables.dedications.update().where(
                    tables.dedications.c.request_id == row.request_id).values(
                    play_id=play["id"]))
            # a venue never shows who asked: no nickname goes with it
            return {"request_id": row.request_id, "line": row.line, "words": words, "from": None}
        return None


__all__ = ["DEFAULTS", "FEATURES", "SocialMixin", "clean_settings", "song_number"]
