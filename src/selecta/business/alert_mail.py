"""Zone alert emails (ADR-0445 BZ-0445-10) through the repository's mail path (`notify.mail`).

`collecting_notify` wraps the outbox notification: inside the alert sweep's transaction it
writes the `zone.alert` event (which the manager views read) and works out who should get an
email and what it says. `send` delivers them after the transaction commits, each with a stable
idempotency key, through whatever `Sender` the environment gives:

- production: the configured provider (`SELECTA_EMAIL_*`, see `notify.mail`);
- the local dev stack: `DevInboxSender`, which writes into the dev stack's own inbox at
  `/dev/mail` and never delivers anything;
- neither: no email at all, only the in-app event.

Managers are the organisation's owners and admins and the venue's managers; organisation
admins are owners and admins. Only verified addresses of active members are used. The copy says
what SelectaDJ knows and never claims the room is quiet: it cannot hear the room.
"""

from __future__ import annotations

import logging
from collections.abc import Mapping
from dataclasses import dataclass, field
from html import escape
from pathlib import Path
from typing import Any

import sqlalchemy as sa
from sqlalchemy.engine import Connection

from selecta.notify.mail import EmailError, Message, Sender, valid_address

log = logging.getLogger(__name__)
KIND = "zone_alert"

SUBJECTS = {
    "silent": "{zone} at {venue}: no music is coming out of SelectaDJ",
    "unreachable": "{zone} at {venue}: the player is offline",
    "needs_tap": "{zone} at {venue}: the player needs a tap to start",
    "needs_pairing": "{zone} at {venue}: the player needs pairing again",
    "key_mismatch": "{zone} at {venue}: a copy of the player's sign-in was refused",
}
BODIES = {
    "silent": (
        "The {zone} player at {venue} is connected but SelectaDJ has sent no music for over a "
        "minute. SelectaDJ cannot hear the room, so check the player and the amplifier."
    ),
    "unreachable": (
        "The {zone} player at {venue} has been offline since {since}. It may still be playing "
        "its saved music. Check its power and the venue's internet."
    ),
    "needs_tap": (
        "The {zone} player at {venue} restarted and its browser wants a tap before it can play. "
        "Tap the screen once. The kiosk setup guide shows how to remove the tap."
    ),
    "needs_pairing": (
        "The {zone} player at {venue} lost its pairing (its browser storage was cleared). "
        "Type the code it shows in SelectaDJ to pair it again."
    ),
    "key_mismatch": (
        "Someone used a copy of the {zone} player's sign-in from another machine at {venue}. "
        "It was refused. The real player keeps working. If you did not expect this, unpair the "
        "player in SelectaDJ and pair it again."
    ),
}


@dataclass
class Outgoing:
    messages: list[Message] = field(default_factory=list)


def _place(conn: Connection, workspace_id: str, zone_id: str) -> tuple[str, str, str | None, str]:
    from selecta.business.schema import venues, zones

    row = conn.execute(
        sa.select(zones.c.name, venues.c.name.label("venue"), venues.c.id, venues.c.timezone)
        .select_from(zones.join(venues, zones.c.venue_id == venues.c.id))
        .where(zones.c.workspace_id == workspace_id, zones.c.id == zone_id)
    ).first()
    if row is None:
        return "Zone", "your venue", None, "UTC"
    return row.name, row.venue, row.id, row.timezone


def recipients(
    conn: Connection, workspace_id: str, venue_id: str | None, audience: str
) -> list[str]:
    """Verified addresses of the people to tell."""
    from selecta.business.people.schema import business_members, business_venue_roles
    from selecta.identity.schema import users, workspaces

    ids: set[str] = set()
    owner = conn.execute(
        sa.select(workspaces.c.owner_user_id).where(workspaces.c.id == workspace_id)
    ).scalar()
    if owner:
        ids.add(owner)
    for row in conn.execute(
        sa.select(business_members.c.user_id, business_members.c.org_role).where(
            business_members.c.workspace_id == workspace_id,
            business_members.c.status == "active",
        )
    ):
        if row.org_role in ("owner", "admin"):
            ids.add(row.user_id)
    if audience == "managers" and venue_id is not None:
        active = {
            row.user_id
            for row in conn.execute(
                sa.select(business_members.c.user_id).where(
                    business_members.c.workspace_id == workspace_id,
                    business_members.c.status == "active",
                )
            )
        }
        for row in conn.execute(
            sa.select(business_venue_roles.c.user_id).where(
                business_venue_roles.c.workspace_id == workspace_id,
                business_venue_roles.c.venue_id == venue_id,
                business_venue_roles.c.role == "venue_manager",
            )
        ):
            if row.user_id in active:
                ids.add(row.user_id)
    if not ids:
        return []
    rows = conn.execute(
        sa.select(users.c.email, users.c.email_verified, users.c.deleted_at).where(
            users.c.id.in_(sorted(ids))
        )
    ).all()
    return sorted(
        {
            r.email
            for r in rows
            if r.deleted_at is None and r.email_verified and valid_address(r.email)
        }
    )


def message_for(
    alert: Mapping[str, Any], zone: str, venue: str, since: str, to: str, audience: str
) -> Message:
    words = {"zone": zone, "venue": venue, "since": since}
    subject = SUBJECTS.get(alert["kind"], "{zone} at {venue}: the player needs a look").format(
        **words
    )
    text = BODIES.get(alert["kind"], "The {zone} player at {venue} needs a look.").format(**words)
    if audience == "admins":
        text += " Nobody at the venue has acknowledged this alert for 15 minutes."
    return Message(
        to=to,
        subject=subject,
        text=text,
        html=f"<p>{escape(text)}</p>",
        kind=KIND,
        idempotency_key=f"zone-alert:{alert['id']}:{audience}:{to}",
        metadata={"alert_id": str(alert["id"]), "kind": str(alert["kind"])},
    )


def collecting_notify(outgoing: Outgoing):
    """A `Notify` that writes the outbox event and queues the emails for after the commit."""
    from datetime import UTC, datetime
    from zoneinfo import ZoneInfo

    from selecta.business.alerts import outbox_notify

    def notify(conn: Connection, alert: dict[str, Any], audience: str, now: float) -> None:
        outbox_notify(conn, alert, audience, now)
        zone, venue, venue_id, tz = _place(conn, alert["workspace_id"], alert["zone_id"])
        since = (
            datetime.fromtimestamp(alert["started_at"], UTC)
            .astimezone(ZoneInfo(tz))
            .strftime("%H:%M")
        )
        for to in recipients(
            conn, alert["workspace_id"], alert.get("venue_id") or venue_id, audience
        ):
            outgoing.messages.append(message_for(alert, zone, venue, since, to, audience))

    return notify


def send(sender: Sender | None, outgoing: Outgoing) -> int:
    """Deliver the queued emails; a failed one is logged and never stops the sweep."""
    if sender is None:
        outgoing.messages.clear()
        return 0
    sent = 0
    for message in outgoing.messages:
        try:
            sender.send(message)
            sent += 1
        except EmailError as error:
            log.warning("Zone alert email not sent: %s", error)
    outgoing.messages.clear()
    return sent


class DevInboxSender:
    """The local dev stack's sender: every message lands in its inbox at `/dev/mail`."""

    def __init__(self, identity_folder: Path) -> None:
        from selecta.devstack.identity_store import IdentityStore

        self.store = IdentityStore(identity_folder)

    def send(self, message: Message) -> str:
        return str(self.store.send_mail(message.to, message.subject, message.text, None))


def sender_for(env: Mapping[str, str]) -> Sender | None:
    """The configured provider, else the dev stack's inbox when running in it, else None."""
    from selecta.notify import mail

    configured = mail.sender_from_environment(env)
    if configured is not None:
        return configured
    data = env.get("SELECTA_DEV_DATA", "").strip()
    if data:
        return DevInboxSender(Path(data) / "identity")
    return None


__all__ = [
    "DevInboxSender",
    "Outgoing",
    "collecting_notify",
    "message_for",
    "recipients",
    "send",
    "sender_for",
]
