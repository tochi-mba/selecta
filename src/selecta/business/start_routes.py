"""The `/business/start` page's server side (ADR-0453 D6, BZ-0453-04).

While `business.signups` is off (the default) the page is a pilot contact form:
`POST /api/business/pilot-interest` emails REX Technologies sales (`SELECTA_BUSINESS_SALES_EMAIL`)
through the repository mail path (`people.invite_mail`: the configured provider, or the dev stack's
`/dev/mail` inbox). Nothing is stored and no organisation is created: pilots are made by staff
(`/api/admin/business/pilots`). With no sender or no sales address set up the route says so
(503 `contact_unavailable`) rather than pretending the message went. With `business.signups` on
the page creates an organisation through `POST /api/business/orgs` instead (already gated there).

Owned by `business.start`. The sender's own verified email is the reply address in the text.
"""

from __future__ import annotations

import html
import os
from collections.abc import Callable
from typing import Any

from fastapi import Depends, FastAPI, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.engine import Engine

from selecta.identity.tokens import Claims
from selecta.notify.mail import Message, valid_address

SALES_ENV = "SELECTA_BUSINESS_SALES_EMAIL"


class InterestBody(BaseModel):
    business_name: str = Field(min_length=1, max_length=200)
    venues: int = Field(ge=1, le=10_000)
    city: str = Field(default="", max_length=120)
    message: str = Field(default="", max_length=2000)


def interest_message(*, to: str, reply_to: str, body: InterestBody, user_id: str) -> Message:
    text = (
        f"{body.business_name} would like a SelectaDJ for Business pilot.\n\n"
        f"Venues: {body.venues}\nCity: {body.city or 'not given'}\n"
        f"Reply to: {reply_to}\n\n{body.message or 'No message.'}"
    )
    return Message(
        to=to, subject=f"Pilot interest: {body.business_name}", text=text,
        html="".join(f"<p>{html.escape(part)}</p>" for part in text.split("\n\n")),
        kind="business_pilot_interest",
        idempotency_key=f"pilot_interest:{user_id}:{body.business_name.casefold()}",
    )


def install_routes(
    app: FastAPI,
    *,
    engine: Engine,
    current_claims: Callable[..., Claims],
    principal_for: Callable[..., Any],
    sender: Any = "environment",
    sales: str | None = None,
) -> None:
    from selecta.business.people import invite_mail

    mailer = invite_mail.default_sender() if sender == "environment" else sender
    to = (os.environ.get(SALES_ENV, "") if sales is None else sales).strip()

    @app.post("/api/business/pilot-interest", status_code=202)
    def pilot_interest(
        body: InterestBody, request: Request, claims: Claims = Depends(current_claims)  # noqa: B008
    ) -> dict[str, Any]:
        found = principal_for(engine, claims, None)
        reply = found.user.email if found.user.email_verified else None
        if mailer is None or not valid_address(to) or not reply:
            raise HTTPException(status_code=503, detail={
                "code": "contact_unavailable",
                "message": "We can't send this from here right now. Email REX Technologies "
                           "about a SelectaDJ for Business pilot instead.",
            })
        sent = invite_mail.send(mailer, interest_message(
            to=to, reply_to=reply, body=body, user_id=found.user.id))
        if not sent:
            raise HTTPException(status_code=503, detail={
                "code": "contact_unavailable",
                "message": "That didn't send. Try again in a few minutes.",
            })
        return {"sent": True}


__all__ = ["install_routes", "interest_message"]
