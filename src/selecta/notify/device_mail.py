""""A new device signed in to SelectaDJ": one email per new device (docs/saas/16-edge-cases.md,
Accounts; product audit item 3).

A person's devices are the `devices` rows the device registry writes when a browser first signs
in and is used (ADR-0475; the registry itself is the device and room agent's). This module only
reads them: a person device created within the look-back, belonging to someone who already had
an older device, is mailed once to that person, keyed by the device id, with the time in their
own time zone and a link to Account, where Sign out everywhere is. A person's very first device
is not news, and a kiosk (no person) never mails anyone. No place is given: SelectaDJ does not
look up where an address is.
"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.engine import Connection

from selecta.identity.schema import users
from selecta.notify import templates
from selecta.notify.billing_mail import day_in
from selecta.notify.mail import SENDER_NAME, Message, valid_address

LOOKBACK_S = 6 * 86_400.0
FLAG = "account.new_device_email"


def _time_in(epoch_s: float, timezone: str | None) -> str:
    from datetime import UTC, datetime
    from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

    try:
        zone = ZoneInfo(timezone or "UTC")
    except (ZoneInfoNotFoundError, ValueError):
        zone = ZoneInfo("UTC")
    moment = datetime.fromtimestamp(float(epoch_s), UTC).astimezone(zone)
    return f"{moment:%H:%M} on {day_in(epoch_s, timezone)} ({zone.key})"


def new_device(*, to: str, key: str, device: str, when: str, site_url: str = "") -> Message:
    return templates._message(
        to=to, kind="new_device", key=key,
        subject=f"A new device signed in to {SENDER_NAME}",
        lines=[
            f"A new device signed in to {SENDER_NAME}: {device}, at {when}.",
            "If this was you, there is nothing to do. If this wasn't you, sign out everywhere "
            "from Account, then change your password.",
        ],
        action=("Sign out everywhere", templates._link(site_url, "/account")),
    )


def due(conn: Connection, now: float, site_url: str = "") -> list[Message]:
    from selecta.playback.schema import devices

    earlier = devices.alias("earlier")
    older = sa.exists().where(
        earlier.c.user_id == devices.c.user_id,
        earlier.c.created_at < devices.c.created_at,
    )
    rows = conn.execute(
        sa.select(devices.c.id, devices.c.name, devices.c.created_at, users.c.email,
                  users.c.email_verified, users.c.deleted_at, users.c.timezone)
        .select_from(devices.join(users, users.c.id == devices.c.user_id))
        .where(devices.c.principal == "person", devices.c.created_at >= now - LOOKBACK_S, older)
    ).all()
    found = []
    for row in rows:
        if row.deleted_at is not None or not row.email_verified or not valid_address(row.email):
            continue
        found.append(new_device(
            to=row.email, key=f"new_device:{row.id}", device=row.name or "A browser",
            when=_time_in(row.created_at, row.timezone), site_url=site_url,
        ))
    return found


def on() -> bool:
    from selecta import flags

    try:
        return flags.on(FLAG)
    except KeyError:
        return False


__all__ = ["FLAG", "LOOKBACK_S", "due", "new_device", "on"]
