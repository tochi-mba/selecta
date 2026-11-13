"""Reads and writes for the content control tables. No permission checks here: see `api`."""

from __future__ import annotations

from collections.abc import Iterable
from typing import Any

import sqlalchemy as sa
from sqlalchemy.engine import Connection

from selecta.business.content import schema as t
from selecta.business.content.engine import BlockEntry, Override, RuleRow
from selecta.business.content.tags import merge_tag_reading
from selecta.persistence import new_id

RULE_FIELDS = (
    "filter_mode", "crate_ids", "bpm_min", "bpm_max", "half_double", "energy_min",
    "energy_max", "song_spacing_hours", "artist_spacing_minutes",
)


# ---- the organisation's snapshot version


def version(conn: Connection, organisation_id: str) -> int:
    found = conn.execute(
        sa.select(t.policy_versions.c.version)
        .where(t.policy_versions.c.organisation_id == organisation_id)
    ).scalar()
    return int(found or 0)


def bump(conn: Connection, organisation_id: str, workspace_id: str, now: float) -> int:
    found = conn.execute(
        sa.select(t.policy_versions.c.version)
        .where(t.policy_versions.c.organisation_id == organisation_id)
    ).first()
    current = int(found[0]) if found else 0
    if found is None:
        conn.execute(t.policy_versions.insert().values(
            organisation_id=organisation_id, workspace_id=workspace_id, version=1,
            updated_at=now))
        return 1
    conn.execute(
        t.policy_versions.update()
        .where(t.policy_versions.c.organisation_id == organisation_id)
        .values(version=t.policy_versions.c.version + 1, updated_at=now)
    )
    return current + 1


# ---- rule levels


def _rule_row(row) -> RuleRow:
    crates = row["crate_ids"]
    windows = tuple(tuple(w) for w in (row["windows"] or ()))
    return RuleRow(
        level=row["level"], level_id=row["level_id"], daypart_id=row["daypart_id"] or None,
        daypart_label=row["daypart_label"], filter_mode=row["filter_mode"],
        crate_ids=frozenset(crates) if crates is not None else None,
        bpm_min=row["bpm_min"], bpm_max=row["bpm_max"], half_double=row["half_double"],
        energy_min=row["energy_min"], energy_max=row["energy_max"],
        song_spacing_hours=row["song_spacing_hours"],
        artist_spacing_minutes=row["artist_spacing_minutes"], windows=windows,
    )


def load_rules(conn: Connection, organisation_id: str) -> list[RuleRow]:
    rows = conn.execute(
        sa.select(t.zone_rules).where(t.zone_rules.c.organisation_id == organisation_id)
    ).mappings()
    return [_rule_row(row) for row in rows]


def rule_rows(conn: Connection, organisation_id: str, level: str, level_id: str) -> list[dict]:
    rows = conn.execute(
        sa.select(t.zone_rules).where(
            t.zone_rules.c.organisation_id == organisation_id, t.zone_rules.c.level == level,
            t.zone_rules.c.level_id == level_id)
    ).mappings()
    return [dict(row) for row in rows]


def save_rule(
    conn: Connection, *, organisation_id: str, workspace_id: str, level: str, level_id: str,
    values: dict[str, Any], actor: str | None, now: float, daypart_id: str | None = None,
    daypart_label: str | None = None, windows: list | None = None,
) -> None:
    clean = {name: values.get(name) for name in RULE_FIELDS}
    if clean["crate_ids"] is not None:
        clean["crate_ids"] = sorted(set(clean["crate_ids"]))
    where = (
        (t.zone_rules.c.organisation_id == organisation_id) & (t.zone_rules.c.level == level)
        & (t.zone_rules.c.level_id == level_id)
        & (t.zone_rules.c.daypart_id == (daypart_id or ""))
    )
    extra = {"daypart_label": daypart_label, "windows": windows, "updated_by": actor,
             "updated_at": now}
    if conn.execute(sa.select(t.zone_rules.c.id).where(where)).first():
        conn.execute(t.zone_rules.update().where(where).values(**clean, **extra))
    else:
        conn.execute(t.zone_rules.insert().values(
            id=new_id(), workspace_id=workspace_id, organisation_id=organisation_id,
            level=level, level_id=level_id, daypart_id=daypart_id or "", **clean, **extra))


def delete_dayparts_except(conn: Connection, organisation_id: str, zone_id: str,
                           keep: Iterable[str]) -> None:
    conn.execute(t.zone_rules.delete().where(
        t.zone_rules.c.organisation_id == organisation_id, t.zone_rules.c.level == "daypart",
        t.zone_rules.c.level_id == zone_id, t.zone_rules.c.daypart_id.not_in(list(keep))))


# ---- blocklist


def _entry(row) -> BlockEntry:
    return BlockEntry(
        id=row["id"], kind=row["kind"], value=row["value"], label=row["label"],
        level=row["scope"], level_id=row["scope_id"], created_at=row["created_at"],
        ends_at=row["ends_at"], reason=row["reason"], author=row["author"],
    )


def load_entries(conn: Connection, organisation_id: str, now: float) -> list[BlockEntry]:
    table = t.blocklist
    rows = conn.execute(sa.select(table).where(
        table.c.organisation_id == organisation_id, table.c.removed_at.is_(None),
        sa.or_(table.c.ends_at.is_(None), table.c.ends_at > now))).mappings()
    return [_entry(row) for row in rows]


def list_entries(conn: Connection, organisation_id: str) -> list[dict]:
    table = t.blocklist
    rows = conn.execute(sa.select(table).where(
        table.c.organisation_id == organisation_id, table.c.removed_at.is_(None))
        .order_by(table.c.created_at)).mappings()
    return [dict(row) for row in rows]


def add_entry(conn: Connection, *, organisation_id: str, workspace_id: str, scope: str,
              scope_id: str, kind: str, value: str, label: str, reason: str | None,
              author: str | None, now: float, ends_at: float | None) -> str:
    entry_id = new_id()
    conn.execute(t.blocklist.insert().values(
        id=entry_id, workspace_id=workspace_id, organisation_id=organisation_id, scope=scope,
        scope_id=scope_id, kind=kind, value=value, label=label, reason=reason, author=author,
        created_at=now, ends_at=ends_at))
    return entry_id


def get_entry(conn: Connection, organisation_id: str, entry_id: str) -> dict | None:
    row = conn.execute(sa.select(t.blocklist).where(
        t.blocklist.c.organisation_id == organisation_id, t.blocklist.c.id == entry_id,
        t.blocklist.c.removed_at.is_(None))).mappings().first()
    return dict(row) if row else None


def remove_entry(conn: Connection, organisation_id: str, entry_id: str, actor: str | None,
                 now: float) -> None:
    conn.execute(t.blocklist.update().where(
        t.blocklist.c.organisation_id == organisation_id, t.blocklist.c.id == entry_id)
        .values(removed_at=now, removed_by=actor))


# ---- overrides


def _override(row) -> Override:
    return Override(
        id=row["id"], zone_id=row["zone_id"], kind=row["kind"], value=row["value"],
        created_at=row["created_at"], starts_at=row["starts_at"], ends_at=row["ends_at"],
        reason=row["reason"], author=row["author"],
    )


def live_override_rows(conn: Connection, organisation_id: str, zone_id: str | None,
                       now: float) -> list[dict]:
    table = t.rule_overrides
    query = sa.select(table).where(
        table.c.organisation_id == organisation_id, table.c.ended_at.is_(None),
        table.c.ends_at > now)
    if zone_id is not None:
        query = query.where(table.c.zone_id == zone_id)
    return [dict(row) for row in conn.execute(query.order_by(table.c.created_at)).mappings()]


def load_overrides(conn: Connection, organisation_id: str, zone_id: str,
                   now: float) -> list[Override]:
    return [_override(row) for row in live_override_rows(conn, organisation_id, zone_id, now)]


def add_override(conn: Connection, **values) -> str:
    override_id = new_id()
    conn.execute(t.rule_overrides.insert().values(id=override_id, **values))
    return override_id


def end_override(conn: Connection, organisation_id: str, override_id: str, now: float,
                 note: str) -> bool:
    done = conn.execute(t.rule_overrides.update().where(
        t.rule_overrides.c.organisation_id == organisation_id,
        t.rule_overrides.c.id == override_id, t.rule_overrides.c.ended_at.is_(None))
        .values(ended_at=now, end_note=note))
    return bool(done.rowcount)


# ---- explicit flags and clean links


def flags_map(conn: Connection, organisation_id: str) -> dict[str, str]:
    rows = conn.execute(sa.select(t.song_flags.c.song_id, t.song_flags.c.explicit).where(
        t.song_flags.c.organisation_id == organisation_id))
    return {song_id: explicit for song_id, explicit in rows}


def get_flag(conn: Connection, organisation_id: str, song_id: str) -> dict | None:
    row = conn.execute(sa.select(t.song_flags).where(
        t.song_flags.c.organisation_id == organisation_id,
        t.song_flags.c.song_id == song_id)).mappings().first()
    return dict(row) if row else None


def set_flag(conn: Connection, *, organisation_id: str, workspace_id: str, song_id: str,
             explicit: str, source: str, set_by: str | None, now: float,
             tag_reading: str | None = None) -> dict | None:
    """Store a flag; returns the row it replaced (None if there was none)."""
    previous = get_flag(conn, organisation_id, song_id)
    values = {"explicit": explicit, "source": source, "set_by": set_by, "set_at": now}
    if tag_reading is not None:
        values["tag_reading"] = tag_reading
    if previous:
        conn.execute(t.song_flags.update().where(t.song_flags.c.id == previous["id"])
                     .values(**values))
    else:
        conn.execute(t.song_flags.insert().values(
            id=new_id(), workspace_id=workspace_id, organisation_id=organisation_id,
            song_id=song_id, **values))
    return previous


def record_tag_reading(conn: Connection, *, organisation_id: str, workspace_id: str,
                       song_id: str, reading: str, now: float) -> bool:
    """Apply a tag reading at upload. Never replaces a manual, bulk or import choice."""
    previous = get_flag(conn, organisation_id, song_id)
    merged = merge_tag_reading(previous and previous["explicit"],
                               previous and previous["source"], reading)
    if merged is None:
        if previous:
            conn.execute(t.song_flags.update().where(t.song_flags.c.id == previous["id"])
                         .values(tag_reading=reading))
        return False
    set_flag(conn, organisation_id=organisation_id, workspace_id=workspace_id, song_id=song_id,
             explicit=merged[0], source=merged[1], set_by=None, now=now, tag_reading=reading)
    return True


def clean_links_map(conn: Connection, organisation_id: str) -> dict[str, str]:
    rows = conn.execute(sa.select(t.clean_links.c.song_id, t.clean_links.c.clean_song_id)
                        .where(t.clean_links.c.organisation_id == organisation_id))
    return dict(rows.all())


def set_clean_link(conn: Connection, *, organisation_id: str, workspace_id: str, song_id: str,
                   clean_song_id: str | None, actor: str | None, now: float) -> None:
    conn.execute(t.clean_links.delete().where(
        t.clean_links.c.organisation_id == organisation_id, t.clean_links.c.song_id == song_id))
    if clean_song_id:
        conn.execute(t.clean_links.insert().values(
            id=new_id(), workspace_id=workspace_id, organisation_id=organisation_id,
            song_id=song_id, clean_song_id=clean_song_id, created_by=actor, created_at=now))


# ---- volume


def volume_row(conn: Connection, zone_id: str) -> dict | None:
    row = conn.execute(sa.select(t.volume_rules).where(t.volume_rules.c.zone_id == zone_id)
                       ).mappings().first()
    return dict(row) if row else None


def volume_rows(conn: Connection, organisation_id: str, venue_id: str) -> list[dict]:
    rows = conn.execute(sa.select(t.volume_rules).where(
        t.volume_rules.c.organisation_id == organisation_id,
        t.volume_rules.c.venue_id == venue_id)).mappings()
    return [dict(row) for row in rows]


def save_volume(conn: Connection, *, organisation_id: str, workspace_id: str, venue_id: str,
                zone_id: str, cap: float, quiet_hours: list[dict], actor: str | None,
                now: float) -> None:
    values = {"cap": cap, "quiet_hours": quiet_hours, "updated_by": actor, "updated_at": now}
    if volume_row(conn, zone_id):
        conn.execute(t.volume_rules.update().where(t.volume_rules.c.zone_id == zone_id)
                     .values(**values))
    else:
        conn.execute(t.volume_rules.insert().values(
            id=new_id(), workspace_id=workspace_id, organisation_id=organisation_id,
            venue_id=venue_id, zone_id=zone_id, **values))


# ---- bulk undo


def add_undo_rows(conn: Connection, rows: list[dict]) -> None:
    if rows:
        conn.execute(t.flag_undo.insert(), [{"id": new_id(), **row} for row in rows])


def undo_rows(conn: Connection, organisation_id: str, batch_id: str) -> list[dict]:
    rows = conn.execute(sa.select(t.flag_undo).where(
        t.flag_undo.c.organisation_id == organisation_id, t.flag_undo.c.batch_id == batch_id,
        t.flag_undo.c.undone_at.is_(None))).mappings()
    return [dict(row) for row in rows]


def mark_undone(conn: Connection, organisation_id: str, batch_id: str, now: float) -> None:
    conn.execute(t.flag_undo.update().where(
        t.flag_undo.c.organisation_id == organisation_id, t.flag_undo.c.batch_id == batch_id)
        .values(undone_at=now))


def delete_flag(conn: Connection, organisation_id: str, song_id: str) -> None:
    conn.execute(t.song_flags.delete().where(
        t.song_flags.c.organisation_id == organisation_id, t.song_flags.c.song_id == song_id))
