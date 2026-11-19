"""The emails behind business billing notices (ADR-0447 dunning, VAT recheck, contracts).

Dunning, the VAT recheck and contract expiry record each email once as a `biz_notices` row
(channel `email`). `due` turns the recent ones into messages for the `emails` maintenance task
(`selecta.notify.emails.run`), which sends each at most once by its key. Audience entries are
user ids (only verified addresses get mail); `rex:sales` is REX Technologies sales, at
`SELECTA_BUSINESS_SALES_EMAIL` when set. Plain words, no blame, SelectaDJ.
"""

from __future__ import annotations

import html
import os
from datetime import UTC, datetime

import sqlalchemy as sa
from sqlalchemy.engine import Connection

from selecta.business.commercial_schema import biz_notices
from selecta.identity.schema import workspaces
from selecta.notify.mail import Message, valid_address

LOOKBACK_S = 6 * 86_400.0
SALES_ENV = "SELECTA_BUSINESS_SALES_EMAIL"


def _day(epoch: float | None) -> str:
    if not epoch:
        return "soon"
    return datetime.fromtimestamp(float(epoch), UTC).strftime("%d %B %Y").lstrip("0")


def words(kind: str, org: str, detail: dict) -> tuple[str, str] | None:
    """(subject, text) for a notice kind, or None for a kind that is never emailed."""
    if kind.startswith("dunning.email.day"):
        return (f"{org}: a SelectaDJ payment didn't go through",
                f"A payment for {org} didn't go through. Music keeps playing. Update the payment "
                f"details on the SelectaDJ billing page before the grace period ends on "
                f"{_day(detail.get('grace_ends_at'))}. After that, settings become read-only "
                "and each venue stops playing at its closing time, after two warnings.")
    if kind == "dunning.read_only":
        return (f"{org}: SelectaDJ settings are now read-only",
                f"The grace period for {org} has ended. Settings are read-only until the payment "
                "goes through. Each venue stops playing at its closing time after two warnings.")
    if kind.startswith("dunning.stop_warning."):
        hours = kind.rsplit(".", 1)[-1].removesuffix("h")
        venue = detail.get("venue") or "A venue"
        return (f"{venue} stops playing in about {hours} hours",
                f"{venue} will stop playing SelectaDJ at its close around "
                f"{_day(detail.get('stop_at_estimate'))} unless the payment for {org} goes "
                "through first. It never stops while the venue is open.")
    if kind == "billing.vat.recheck_failed":
        return (f"{org}: check your VAT number",
                f"The VAT number for {org} did not validate before renewal, so the renewal is "
                "held. Check the number on the SelectaDJ billing page. Music keeps playing "
                "during the grace period.")
    if kind.startswith("contract.expiry."):
        return (f"{org}: the SelectaDJ Enterprise contract ends {_day(detail.get('term_end'))}",
                f"The SelectaDJ Enterprise contract for {org} ends on "
                f"{_day(detail.get('term_end'))}. REX Technologies sales will be in touch "
                "about renewing.")
    if kind == "licence.expiry_reminder":
        venue = detail.get("venue_name") or "A venue"
        return (f"{venue}: the music licence ends {_day(detail.get('expires_at'))}",
                f"The music licence entered for {venue} ends on "
                f"{_day(detail.get('expires_at'))}. Renew it and enter the new one on the "
                "venue's Licence page in SelectaDJ, so the venue keeps playing.")
    if kind == "licence.grace_reminder":
        venue = detail.get("venue_name") or "A venue"
        return (f"{venue}: the music licence has run out",
                f"The music licence for {venue} has run out. Music keeps playing until "
                f"{_day(detail.get('grace_ends_at'))}; after that the venue does not start at "
                "its next opening until a licence is entered in SelectaDJ.")
    if kind == "licence.lapsed":
        venue = detail.get("venue_name") or "A venue"
        return (f"{venue} will not start playing until a licence is entered",
                f"The licence grace period for {venue} has ended. A zone playing now finishes "
                "at its close; the venue does not start again until a music licence is entered "
                "in SelectaDJ.")
    return None


def _address(conn: Connection, who: str) -> str | None:
    from selecta.identity.schema import users

    if who == "rex:sales":
        sales = os.environ.get(SALES_ENV, "").strip()
        return sales if valid_address(sales) else None
    row = conn.execute(sa.select(users.c.email, users.c.email_verified, users.c.deleted_at)
                       .where(users.c.id == who)).one_or_none()
    if row is None or row.deleted_at is not None or not row.email_verified:
        return None
    return row.email if valid_address(row.email) else None


def due(conn: Connection, now: float, site_url: str = "") -> list[Message]:
    """Messages for email notices recorded in the last `LOOKBACK_S`, one per recipient."""
    rows = conn.execute(sa.select(biz_notices).where(
        biz_notices.c.channel == "email", biz_notices.c.created_at >= now - LOOKBACK_S,
    )).mappings().all()
    names: dict[str, str] = {}
    out: list[Message] = []
    for row in rows:
        org_id = row["organisation_id"]
        if org_id not in names:
            names[org_id] = conn.execute(sa.select(workspaces.c.name).where(
                workspaces.c.id == org_id)).scalar() or "Your organisation"
        said = words(row["kind"], names[org_id], dict(row["detail"] or {}))
        if said is None:
            continue
        subject, text = said
        if site_url:
            text += f"\n\n{site_url.rstrip('/')}/b/{org_id}/billing"
        for who in row["audience"] or []:
            to = _address(conn, str(who))
            if to:
                out.append(Message(
                    to=to, subject=subject, text=text,
                    html="<p>" + html.escape(text).replace("\n\n", "</p><p>") + "</p>",
                    kind=row["kind"].split(".")[0] + "_billing",
                    idempotency_key=f"biz_notice:{row['id']}:{who}",
                ))
    return out


__all__ = ["LOOKBACK_S", "SALES_ENV", "due", "words"]
