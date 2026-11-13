"""Standing rooms: one per zone, stable codes, rotation, settings, print data and the screen code.

Part of `ZoneRooms` (see `service`). A zone's standing room is created the first time anyone
asks for it, with requests on in `staff_approve` mode. It never expires: whether it takes
requests follows the zone's opening hours (`ports.ZoneHours`), so a venue that stays open late
keeps its room open until the new close, and an overnight close or a DST night needs nothing
special here.
"""

from __future__ import annotations

from typing import Any

import sqlalchemy as sa
from sqlalchemy.engine import Connection

from selecta.business.access import BusinessActor, BusinessNotFound
from selecta.business.access.directory import ZoneRef
from selecta.business.rooms import branding, screen_code, settings
from selecta.business.rooms.schema import (
    business_zone_room_retired_codes as retired,
)
from selecta.business.rooms.schema import (
    business_zone_rooms as rooms_t,
)
from selecta.persistence import new_id
from selecta.rooms import codes

BRANDING_KEYS = ("welcome", "accent", "logo_url")


def join_path(code: str) -> str:
    return f"/r/{code}"


class RoomsCore:
    # Set by `ZoneRooms.__init__`: engine, pepper, directory, hours, presence, dayparts,
    # playback, content, songs, recorder, clock, flag_on, plan_guest_max.

    # ---- lookups -------------------------------------------------------------------------

    def zone(self, conn: Connection, zone_id: str) -> ZoneRef:
        found = self.directory.zone(conn, zone_id)
        if found is None:
            raise BusinessNotFound("There's no such zone.")
        return found

    def scoped_zone(self, conn: Connection, actor: BusinessActor, zone_id: str) -> ZoneRef:
        found = self.zone(conn, zone_id)
        if found.organisation_id != actor.organisation_id:
            raise BusinessNotFound("There's no such zone.")
        return found

    def room_row(self, conn: Connection, zone_id: str):
        return conn.execute(sa.select(rooms_t).where(rooms_t.c.zone_id == zone_id)
                            ).mappings().first()

    def ensure_room(self, conn: Connection, zone: ZoneRef):
        row = self.room_row(conn, zone.id)
        if row is not None:
            return row
        now = self.clock()
        seed, code_hash = self._fresh_code(conn)
        conn.execute(rooms_t.insert().values(
            id=new_id(), workspace_id=zone.workspace_id, organisation_id=zone.organisation_id,
            venue_id=zone.venue_id, zone_id=zone.id, code_hash=code_hash, code_seed=seed,
            code_version=1, requests_on=True, mode=settings.STAFF_APPROVE, daypart_modes={},
            paused=False, screen_code_on=False, screen_seed=codes.new_seed(),
            limits=settings.Limits().to_json(), created_at=now, updated_at=now,
        ))
        return self.room_row(conn, zone.id)

    def _fresh_code(self, conn: Connection) -> tuple[str, str]:
        for _ in range(20):
            seed = codes.new_seed()
            code_hash = codes.code_hash(codes.derive(seed, self.pepper), self.pepper)
            taken = conn.execute(sa.select(rooms_t.c.id).where(rooms_t.c.code_hash == code_hash)
                                 ).first() or conn.execute(
                sa.select(retired.c.id).where(retired.c.code_hash == code_hash)).first()
            if not taken and not self._personal_code_taken(conn, code_hash):
                return seed, code_hash
        raise RuntimeError("Couldn't find a free room code")  # pragma: no cover

    @staticmethod
    def _personal_code_taken(conn: Connection, code_hash: str) -> bool:
        from selecta.rooms.schema import rooms as personal

        try:
            with conn.begin_nested():
                return conn.execute(sa.select(personal.c.id).where(
                    personal.c.code_hash == code_hash)).first() is not None
        except sa.exc.SQLAlchemyError:
            return False  # the personal tables aren't in this database

    def code_of(self, row) -> str:
        return codes.derive(row["code_seed"], self.pepper)

    def limits_of(self, row) -> settings.Limits:
        return settings.limits_from_json(row["limits"])

    # ---- staff and manager actions -------------------------------------------------------

    def settings_view(self, conn: Connection, actor: BusinessActor, zone_id: str) -> dict:
        zone = self.scoped_zone(conn, actor, zone_id)
        row = self.ensure_room(conn, zone)
        decision = branding.check_accent(row["accent"])
        code = self.code_of(row)
        view: dict[str, Any] = {
            "zone_id": zone.id, "zone_name": zone.name, "room_id": row["id"],
            "requests_on": row["requests_on"], "mode": row["mode"],
            "effective_mode": self.effective_mode(conn, row, self.clock()),
            "daypart_modes": row["daypart_modes"], "paused": row["paused"],
            "flood_switched": row["flood_switched_at"] is not None,
            "limits": self.limits_of(row).to_json(),
            "limit_ranges": {k: [lo, hi if hi is not None else self.plan_guest_max(
                conn, zone.organisation_id)] for k, (lo, hi) in settings.RANGES.items()},
            "code": codes.display(code), "join_path": join_path(code),
            "code_version": row["code_version"],
        }
        if self.flag_on("business.rooms.branding"):
            view.update(welcome=row["welcome"], accent=row["accent"], logo_url=row["logo_url"],
                        accent_used=decision.used, accent_reason=decision.reason)
        if self.flag_on("business.rooms.screen_code"):
            view["screen_code_on"] = row["screen_code_on"]
        return view

    def update_settings(self, conn: Connection, actor: BusinessActor, zone_id: str,
                        changes: dict[str, Any]) -> dict:
        zone = self.scoped_zone(conn, actor, zone_id)
        row = self.ensure_room(conn, zone)
        values: dict[str, Any] = {}
        for key, value in changes.items():
            if key == "requests_on":
                values[key] = bool(value)
            elif key == "mode":
                values["mode"] = settings.validate_mode(value)
                values["flood_switched_at"] = None  # a manager's choice ends the flood switch
            elif key == "daypart_modes":
                values[key] = settings.validate_daypart_modes(value)
            elif key == "limits":
                if not isinstance(value, dict):
                    raise settings.BusinessInvalid("Limits must be a set of numbers.")
                values[key] = settings.validate_limits(
                    self.limits_of(row), value,
                    plan_guest_max=self.plan_guest_max(conn, zone.organisation_id),
                ).to_json()
            elif key in BRANDING_KEYS:
                if not self.flag_on("business.rooms.branding"):
                    raise self.flag_off("business.rooms.branding")
                values[key] = self._branding_value(key, value)
            elif key == "screen_code_on":
                if not self.flag_on("business.rooms.screen_code"):
                    raise self.flag_off("business.rooms.screen_code")
                values[key] = bool(value)
            else:
                raise settings.BusinessInvalid(f"There's no setting called {key}.",
                                               code="unknown_setting")
        if values:
            values["updated_at"] = self.clock()
            conn.execute(rooms_t.update().where(rooms_t.c.id == row["id"]).values(**values))
            before = {k: row[k] for k in values if k in row and k != "updated_at"}
            self.recorder.record(
                conn, actor, "rooms.settings_changed", organisation_id=zone.organisation_id,
                workspace_id=zone.workspace_id, venue_id=zone.venue_id, zone_id=zone.id,
                resource_type="zone_room", resource_id=row["id"],
                metadata={"changed": sorted(k for k in values if k != "updated_at"),
                          "before": before,
                          "after": {k: v for k, v in values.items() if k != "updated_at"}},
            )
        return self.settings_view(conn, actor, zone_id)

    @staticmethod
    def _branding_value(key: str, value: Any):
        if key == "welcome":
            return settings.validate_welcome(value)
        if key == "logo_url":
            return settings.validate_logo_url(value)
        if value in (None, ""):
            return None
        if not branding.is_colour(value):
            raise settings.BusinessInvalid("Pick a colour as #RRGGBB.", code="bad_accent")
        return value.lower()  # kept even when it fails contrast; the view says why it's unused

    def rotate(self, conn: Connection, actor: BusinessActor, zone_id: str) -> dict:
        zone = self.scoped_zone(conn, actor, zone_id)
        row = self.ensure_room(conn, zone)
        now = self.clock()
        conn.execute(retired.insert().values(
            id=new_id(), workspace_id=row["workspace_id"], organisation_id=row["organisation_id"],
            room_id=row["id"], code_hash=row["code_hash"], code_version=row["code_version"],
            retired_at=now,
        ))
        seed, code_hash = self._fresh_code(conn)
        version = row["code_version"] + 1
        conn.execute(rooms_t.update().where(rooms_t.c.id == row["id"]).values(
            code_seed=seed, code_hash=code_hash, code_version=version, updated_at=now))
        self.recorder.record(
            conn, actor, "rooms.code_rotated", organisation_id=zone.organisation_id,
            workspace_id=zone.workspace_id, venue_id=zone.venue_id, zone_id=zone.id,
            resource_type="zone_room", resource_id=row["id"],
            metadata={"code_version": version},
        )
        code = codes.derive(seed, self.pepper)
        return {"code": codes.display(code), "join_path": join_path(code),
                "code_version": version, "warning": settings.ROTATE_WARNING}

    def print_data(self, conn: Connection, actor: BusinessActor, venue_id: str) -> dict:
        venue = self.directory.venue(conn, venue_id)
        if venue is None or venue.organisation_id != actor.organisation_id:
            raise BusinessNotFound("There's no such venue.")
        sheets = []
        logo = None
        for zone in sorted(self.directory.zones_of(conn, venue_id), key=lambda z: z.name):
            row = self.ensure_room(conn, zone)
            if not row["requests_on"]:
                continue
            logo = logo or row["logo_url"]
            code = self.code_of(row)
            sheets.append({"zone_id": zone.id, "zone_name": zone.name,
                           "code": codes.display(code), "join_url": join_path(code),
                           "view_only": bool(row["screen_code_on"])})
        return {"venue_id": venue.id, "venue_name": venue.name,
                "logo_url": logo if self.flag_on("business.rooms.branding") else None,
                "zones": sheets}

    def screen_code(self, conn: Connection, actor: BusinessActor, zone_id: str) -> dict:
        zone = self.scoped_zone(conn, actor, zone_id)
        row = self.ensure_room(conn, zone)
        now = self.clock()
        if not row["screen_code_on"]:
            return {"on": False, "code": None, "changes_at": None}
        return {"on": True, "code": screen_code.code_for(row["screen_seed"], self.pepper, now),
                "changes_at": screen_code.changes_at(now)}

    def effective_mode(self, conn: Connection, row, now: float) -> str:
        from selecta.business.rooms.ports import utc

        part = self.dayparts.current(conn, row["zone_id"], utc(now))
        mode = (row["daypart_modes"] or {}).get(part, row["mode"]) if part else row["mode"]
        if mode == settings.AUTO_ACCEPT and row["flood_switched_at"] is not None:
            return settings.STAFF_APPROVE
        return mode


__all__ = ["RoomsCore", "join_path"]
