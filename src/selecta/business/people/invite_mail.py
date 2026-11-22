"""The invitation email (ADR-0452 BZ-0452-05) through the repository's mail path (`notify.mail`).

The accept link carries a one-time token that the database keeps only as a hash, so the email
cannot be built later by the `emails` maintenance task from stored rows: it is sent once, right
after the invitation's transaction commits, through the same `Sender` the zone alerts use
(`alert_mail.sender_for`): the configured provider in production, the dev stack's inbox at
`/dev/mail` locally, or nothing at all. The idempotency key is the invitation id, so a retried
send is not delivered twice. When no sender is set up, or the send fails, the inviter still has
the link on the People page to send themselves (the route answers `emailed: false`).
"""

from __future__ import annotations

import html
import logging
import os
from collections.abc import Mapping

from selecta.notify.mail import EmailError, Message, Sender, valid_address

log = logging.getLogger(__name__)

SITE_ENVS = ("SELECTA_EMAIL_SITE_URL", "SELECTA_DEV_SITE_URL")
ROLE_WORDS = {
    "admin": "an admin",
    "venue_manager": "a venue manager",
    "staff": "staff",
    "viewer": "a viewer",
}


def site_url(env: Mapping[str, str] | None = None) -> str:
    env = os.environ if env is None else env
    for name in SITE_ENVS:
        value = (env.get(name) or "").strip().rstrip("/")
        if value:
            return value
    return ""


def message_for(*, to: str, org_name: str, role: str, venues: list[str], link: str,
                invitation_id: str) -> Message:
    where = f" at {', '.join(venues)}" if venues else ""
    subject = f"Join {org_name} on SelectaDJ"
    text = (
        f"You've been invited to join {org_name} on SelectaDJ as {ROLE_WORDS.get(role, role)}"
        f"{where}.\n\nOpen this link and sign in with this email address to join. It works "
        f"for 7 days:\n{link}\n\nIf you weren't expecting this, you can ignore it.\n\n"
        "SelectaDJ is a REX Technologies product."
    )
    body = "".join(f"<p>{html.escape(part)}</p>" for part in text.split("\n\n"))
    return Message(to=to, subject=subject, text=text, html=body, kind="business_invitation",
                   idempotency_key=f"business_invitation:{invitation_id}")


def send(sender: Sender | None, message: Message) -> bool:
    """True when the sender took the email; a failure is logged and the link still works."""
    if sender is None or not valid_address(message.to):
        return False
    try:
        sender.send(message)
        return True
    except EmailError as error:
        log.warning("Invitation email not sent: %s", error)
        return False


def default_sender() -> Sender | None:
    from selecta.business.alert_mail import sender_for

    return sender_for(os.environ)


__all__ = ["default_sender", "message_for", "send", "site_url"]
