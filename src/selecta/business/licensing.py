"""Public performance licence attestation, the playback gate and expiry reminders (ADR-0449).

Each venue records the licences it holds to play recorded music in public, plus an attestation
that the business holds the rights to copy and play the music it uploads. Records are versioned:
recording a licence makes a new version and supersedes the previous one; every change is audited.

**Gate.** A zone cannot start scheduled playback until its venue has an unexpired attestation.
After expiry there is a 14-day grace (the owner can extend it once, with a reason). Past grace the
venue's zones do not start at the next opening, but a zone that is already playing is never
stopped mid-service: it plays to close.

**Reminders.** 30, 14 and 3 days before expiry, then daily during grace, to the owner, admins and
that venue's managers, by email and in-app (manager devices only, never kiosks or customer
displays). Sending goes through `commercial_audit.notice`, so a tick can run as often as it likes.

SelectaDJ (REX Technologies) does not check licence numbers with the societies and nothing here
is legal advice: the business decides which licences it needs.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

import sqlalchemy as sa
from sqlalchemy.engine import Connection

from selecta.business.commercial_audit import audit, notice
from selecta.business.commercial_facts import MANAGER_ROLES, OrgFacts, VenueFacts
from selecta.business.commercial_schema import biz_licence_extensions, biz_licences
from selecta.business.errors import BusinessError
from selecta.persistence import new_id

DAY = 86400.0
GRACE_DAYS = 14
REMINDER_DAYS = (30, 14, 3)
MAX_EXTENSION_DAYS = 30
OTHER = "other"


class LicensingError(BusinessError):
    code = "licensing_invalid"


class LicensingForbidden(BusinessError):
    code = "forbidden"


# ---------------------------------------------------------------------------------------------
# Licence types per territory


@dataclass(frozen=True)
class LicenceType:
    id: str
    label: str
    society: str
    # "performance" plays music in public; "copying" covers dubbing music onto devices.
    kind: str = "performance"


TERRITORY_LICENCE_TYPES: dict[str, tuple[LicenceType, ...]] = {
    "GB": (
        LicenceType("themusiclicence", "TheMusicLicence (PPL PRS)", "PPL PRS"),
        LicenceType("ppl_produb", "PPL ProDub (copying recordings)", "PPL", "copying"),
        LicenceType("prs_produb", "PRS for Music ProDub (copying works)", "PRS for Music",
                    "copying"),
    ),
    "US": (
        LicenceType("ascap", "ASCAP", "ASCAP"),
        LicenceType("bmi", "BMI", "BMI"),
        LicenceType("sesac", "SESAC", "SESAC"),
        LicenceType("gmr", "GMR (Global Music Rights)", "GMR"),
    ),
    "DE": (
        LicenceType("gema", "GEMA", "GEMA"),
        LicenceType("gvl", "GVL", "GVL"),
    ),
    "FR": (
        LicenceType("sacem", "SACEM", "SACEM"),
        LicenceType("spre", "SPRE", "SPRE"),
    ),
    "IE": (
        LicenceType("imro", "IMRO", "IMRO"),
        LicenceType("ppi", "PPI", "PPI"),
    ),
    "NL": (
        LicenceType("buma", "Buma", "Buma"),
        LicenceType("sena", "Sena", "Sena"),
    ),
    "ES": (
        LicenceType("sgae", "SGAE", "SGAE"),
        LicenceType("agedi", "AGEDI", "AGEDI"),
    ),
}


def licence_types(territory: str) -> list[dict[str, str]]:
    """The list a venue picks from, always ending with "other" (free-text society)."""
    out = [vars(t).copy() for t in TERRITORY_LICENCE_TYPES.get(territory.upper(), ())]
    out.append({"id": OTHER, "label": "Other (name the society)", "society": "",
                "kind": "performance"})
    return out


def _find_type(territory: str, licence_type: str) -> LicenceType | None:
    return next(
        (t for t in TERRITORY_LICENCE_TYPES.get(territory, ()) if t.id == licence_type), None
    )


# ---------------------------------------------------------------------------------------------
# Plain-words onboarding explainer (BZ-0449-08 renders it)

NOT_LEGAL_ADVICE = (
    "SelectaDJ does not give legal advice. This is a plain-words summary to help you find the "
    "right licensing bodies. Check with them, or with a lawyer, which licences your venue needs."
)

LICENSING_EXPLAINER: dict[str, Any] = {
    "title": "Music licences for your venue",
    "intro": (
        "Playing recorded music where customers or staff can hear it is a public performance, "
        "so your business usually needs a licence. SelectaDJ does not supply music or licences: "
        "your business is responsible for them and for the rights to every track it uploads."
    ),
    "disclaimer": NOT_LEGAL_ADVICE,
    "territories": [
        {
            "territory": "GB",
            "name": "United Kingdom",
            "summary": (
                "Most venues need TheMusicLicence from PPL PRS, priced by your sector, size and "
                "how you use music. Copying music onto a server or device for background music "
                "can need a separate copying licence (PPL and PRS for Music ProDub)."
            ),
            "links": [
                {"label": "TheMusicLicence (PPL PRS)",
                 "url": "https://pplprs.co.uk/themusiclicence/"},
                {"label": "PPL", "url": "https://www.ppluk.com/"},
                {"label": "PRS for Music", "url": "https://www.prsformusic.com/"},
            ],
        },
        {
            "territory": "US",
            "name": "United States",
            "summary": (
                "Venues license songs from the performing rights organisations. Each one "
                "represents different songwriters, so many venues hold more than one."
            ),
            "links": [
                {"label": "ASCAP", "url": "https://www.ascap.com/"},
                {"label": "BMI", "url": "https://www.bmi.com/"},
                {"label": "SESAC", "url": "https://www.sesac.com/"},
                {"label": "GMR", "url": "https://globalmusicrights.com/"},
            ],
        },
        {
            "territory": "EU",
            "name": "European Union",
            "summary": (
                "Each country has its own national societies, usually one for songwriters and "
                "one for recordings. For example GEMA and GVL in Germany, SACEM and SPRE in "
                "France, IMRO and PPI in Ireland, Buma and Sena in the Netherlands, SGAE and "
                "AGEDI in Spain."
            ),
            "links": [
                {"label": "GEMA", "url": "https://www.gema.de/"},
                {"label": "GVL", "url": "https://www.gvl.de/"},
                {"label": "SACEM", "url": "https://www.sacem.fr/"},
                {"label": "SPRE", "url": "https://www.spre.fr/"},
                {"label": "IMRO", "url": "https://www.imro.ie/"},
                {"label": "PPI", "url": "https://www.ppiltd.com/"},
                {"label": "Buma/Stemra", "url": "https://www.bumastemra.nl/"},
                {"label": "Sena", "url": "https://www.sena.nl/"},
                {"label": "SGAE", "url": "https://www.sgae.es/"},
                {"label": "AGEDI", "url": "https://www.agedi.es/"},
            ],
        },
        {
            "territory": OTHER,
            "name": "Somewhere else",
            "summary": (
                "Choose Other and name your society. SelectaDJ staff will look at it; your "
                "venue can still play while they do."
            ),
            "links": [],
        },
    ],
    "rights_statement": (
        "I confirm this business holds the licences listed and the rights to copy and play the "
        "music it uploads to SelectaDJ."
    ),
}


# ---------------------------------------------------------------------------------------------
# Recording licences


def _venue(org: OrgFacts, venue_id: str) -> VenueFacts:
    venue = org.venue(venue_id)
    if venue is None:
        raise LicensingError("That venue is not in this organisation.", code="not_found")
    return venue


def _row(row: Any) -> dict[str, Any] | None:
    return dict(row) if row is not None else None


def current_licence(conn: Connection, venue_id: str) -> dict[str, Any] | None:
    """The venue's current (not superseded) licence record, or None."""
    row = conn.execute(
        sa.select(biz_licences)
        .where(biz_licences.c.venue_id == venue_id, biz_licences.c.superseded_at.is_(None))
        .order_by(biz_licences.c.version.desc())
        .limit(1)
    ).mappings().first()
    return _row(row)


def licence_history(conn: Connection, venue_id: str) -> list[dict[str, Any]]:
    rows = conn.execute(
        sa.select(biz_licences)
        .where(biz_licences.c.venue_id == venue_id)
        .order_by(biz_licences.c.version)
    ).mappings()
    return [dict(r) for r in rows]


def record_licence(
    conn: Connection,
    org: OrgFacts,
    venue_id: str,
    *,
    territory: str,
    licence_type: str,
    licence_number: str,
    holder_name: str,
    starts_at: float,
    expires_at: float,
    rights_attested: bool,
    actor: str,
    now: float,
    society: str | None = None,
) -> dict[str, Any]:
    """Record a new licence version for a venue; the previous version is superseded."""
    _venue(org, venue_id)
    if rights_attested is not True:
        raise LicensingError(
            "Confirm the business holds the rights to copy and play its music.",
            code="rights_attestation_required",
        )
    territory = (territory or "").strip().upper()
    if territory == OTHER.upper():
        territory = OTHER
    licence_type = (licence_type or "").strip()
    number = (licence_number or "").strip()
    holder = (holder_name or "").strip()
    if not territory or not number or not holder:
        raise LicensingError("Territory, licence number and holder name are needed.")
    if expires_at <= starts_at:
        raise LicensingError("The expiry date must be after the start date.", code="bad_dates")

    review_reasons: list[str] = []
    known = _find_type(territory, licence_type)
    if known is not None:
        society = known.society
    elif licence_type == OTHER:
        society = (society or "").strip()
        if not society:
            raise LicensingError("Name the licensing society.", code="society_required")
        review_reasons.append("other_society")
    else:
        raise LicensingError("Pick a licence type from the list or Other.", code="unknown_type")

    shared = conn.execute(
        sa.select(biz_licences.c.id)
        .where(
            biz_licences.c.organisation_id == org.organisation_id,
            biz_licences.c.venue_id != venue_id,
            biz_licences.c.superseded_at.is_(None),
            biz_licences.c.licence_number == number,
        )
    ).scalars().all()
    if shared:
        review_reasons.append("shared_licence_number")
        conn.execute(
            sa.update(biz_licences)
            .where(biz_licences.c.id.in_(shared))
            .values(needs_review=True, review_reason="shared_licence_number")
        )

    previous = current_licence(conn, venue_id)
    top = conn.execute(
        sa.select(sa.func.max(biz_licences.c.version)).where(biz_licences.c.venue_id == venue_id)
    ).scalar()
    if previous is not None:
        conn.execute(
            sa.update(biz_licences)
            .where(biz_licences.c.id == previous["id"])
            .values(superseded_at=now)
        )
    values = {
        "id": new_id(),
        "workspace_id": org.workspace_id,
        "organisation_id": org.organisation_id,
        "venue_id": venue_id,
        "version": int(top or 0) + 1,
        "territory": territory,
        "licence_type": licence_type,
        "society": society,
        "licence_number": number,
        "holder_name": holder,
        "starts_at": float(starts_at),
        "expires_at": float(expires_at),
        "rights_attested": True,
        "attested_by": actor,
        "attested_at": now,
        "needs_review": bool(review_reasons),
        "review_reason": ",".join(review_reasons) or None,
        "superseded_at": None,
        "created_at": now,
    }
    conn.execute(sa.insert(biz_licences).values(**values))
    audit(
        conn,
        workspace_id=org.workspace_id,
        organisation_id=org.organisation_id,
        venue_id=venue_id,
        action="licence.recorded",
        actor=actor,
        now=now,
        detail={
            "licence_id": values["id"],
            "version": values["version"],
            "superseded": previous["id"] if previous else None,
            "territory": territory,
            "licence_type": licence_type,
            "expires_at": values["expires_at"],
            "needs_review": values["needs_review"],
            "review_reason": values["review_reason"],
        },
    )
    return values


# ---------------------------------------------------------------------------------------------
# Grace and extension


def extension_for(conn: Connection, licence_id: str) -> dict[str, Any] | None:
    row = conn.execute(
        sa.select(biz_licence_extensions).where(biz_licence_extensions.c.licence_id == licence_id)
    ).mappings().first()
    return _row(row)


def grace_ends_at(conn: Connection, licence: dict[str, Any]) -> float:
    """End of grace: expiry plus 14 days, or the owner's extension if later."""
    end = float(licence["expires_at"]) + GRACE_DAYS * DAY
    ext = extension_for(conn, licence["id"])
    if ext is not None:
        end = max(end, float(ext["extended_until"]))
    return end


def extend_grace_once(
    conn: Connection,
    org: OrgFacts,
    venue_id: str,
    *,
    actor_user_id: str,
    reason: str,
    now: float,
    days: int = GRACE_DAYS,
) -> dict[str, Any]:
    """The owner's one-off grace extension for the venue's current licence. Audited."""
    _venue(org, venue_id)
    if not any(m.user_id == actor_user_id and m.role == "owner" for m in org.members):
        raise LicensingForbidden("Only the owner can extend the grace period.")
    if not reason or not reason.strip():
        raise LicensingError("Say why the grace period needs extending.", code="reason_required")
    if not 1 <= int(days) <= MAX_EXTENSION_DAYS:
        raise LicensingError(
            f"An extension is 1 to {MAX_EXTENSION_DAYS} days.", code="bad_extension"
        )
    licence = current_licence(conn, venue_id)
    if licence is None:
        raise LicensingError("This venue has no licence to extend.", code="no_attestation")
    if extension_for(conn, licence["id"]) is not None:
        raise LicensingError(
            "The grace period for this licence has already been extended once.",
            code="extension_used",
        )
    base = max(float(licence["expires_at"]) + GRACE_DAYS * DAY, now)
    values = {
        "id": new_id(),
        "workspace_id": org.workspace_id,
        "venue_id": venue_id,
        "licence_id": licence["id"],
        "extended_until": base + int(days) * DAY,
        "reason": reason.strip(),
        "actor": actor_user_id,
        "created_at": now,
    }
    conn.execute(sa.insert(biz_licence_extensions).values(**values))
    audit(
        conn,
        workspace_id=org.workspace_id,
        organisation_id=org.organisation_id,
        venue_id=venue_id,
        action="licence.grace_extended",
        actor=actor_user_id,
        now=now,
        detail={"licence_id": licence["id"], "extended_until": values["extended_until"],
                "days": int(days), "reason": values["reason"]},
    )
    return values


# ---------------------------------------------------------------------------------------------
# The playback gate


@dataclass(frozen=True)
class GateDecision:
    allowed: bool
    # no_attestation, not_started, valid, grace, extended_grace, expired_continue_to_close,
    # expired
    reason: str
    licence_id: str | None = None
    expires_at: float | None = None
    grace_ends_at: float | None = None

    def to_dict(self) -> dict[str, Any]:
        return dict(vars(self))


def licence_state(conn: Connection, venue_id: str, now: float) -> GateDecision:
    """Where the venue's licence stands at `now`, ignoring whether a zone is playing."""
    licence = current_licence(conn, venue_id)
    if licence is None or not licence["rights_attested"]:
        return GateDecision(False, "no_attestation")
    expires = float(licence["expires_at"])
    grace_end = grace_ends_at(conn, licence)
    common = {"licence_id": licence["id"], "expires_at": expires, "grace_ends_at": grace_end}
    if now < float(licence["starts_at"]):
        return GateDecision(False, "not_started", **common)
    if now < expires:
        return GateDecision(True, "valid", **common)
    if now < expires + GRACE_DAYS * DAY:
        return GateDecision(True, "grace", **common)
    if now < grace_end:
        return GateDecision(True, "extended_grace", **common)
    return GateDecision(False, "expired", **common)


def can_start_scheduled_playback(
    conn: Connection, venue: VenueFacts | str, now: float, zone_playing: bool
) -> GateDecision:
    """May a zone of this venue (keep) play its schedule at `now`?

    A zone that is already playing is never stopped mid-service: past grace it continues to
    close (`expired_continue_to_close`) and is refused at the next opening.
    """
    venue_id = venue.id if isinstance(venue, VenueFacts) else venue
    state = licence_state(conn, venue_id, now)
    if state.reason == "expired" and zone_playing:
        return GateDecision(True, "expired_continue_to_close", state.licence_id,
                            state.expires_at, state.grace_ends_at)
    return state


# ---------------------------------------------------------------------------------------------
# Reminders


def _audience(org: OrgFacts, venue_id: str) -> tuple[str, ...]:
    owners = org.recipients(frozenset({"owner", "admin"}))
    managers = org.recipients(frozenset({"venue_manager"}), venue_id)
    return tuple(dict.fromkeys(owners + managers))


def _reminder_for(conn: Connection, licence: dict[str, Any], venue: VenueFacts,
                  now: float) -> tuple[str, str, float, dict[str, Any]] | None:
    """(kind, cycle_key, due_at, detail) of the reminder due at `now`, if any."""
    expires = float(licence["expires_at"])
    lid = licence["id"]
    if now < expires:
        due = [d for d in REMINDER_DAYS if now >= expires - d * DAY]
        if not due:
            return None
        days = min(due)
        return ("licence.expiry_reminder", f"{lid}:d{days}", expires - days * DAY,
                {"days_before": days, "expires_at": expires})
    grace_end = grace_ends_at(conn, licence)
    if now < grace_end:
        local_day = datetime.fromtimestamp(now, ZoneInfo(venue.time_zone)).date().isoformat()
        return ("licence.grace_reminder", f"{lid}:grace:{local_day}", now,
                {"expires_at": expires, "grace_ends_at": grace_end, "day": local_day,
                 "days_left": int((grace_end - now) // DAY)})
    return ("licence.lapsed", f"{lid}:lapsed", grace_end,
            {"expires_at": expires, "grace_ends_at": grace_end})


def reminders_tick(conn: Connection, org: OrgFacts, now: float) -> list[dict[str, Any]]:
    """Record every licence reminder due at `now`. Returns the notices this call created."""
    created: list[dict[str, Any]] = []
    for venue in org.venues:
        licence = current_licence(conn, venue.id)
        if licence is None:
            continue
        due = _reminder_for(conn, licence, venue, now)
        if due is None:
            continue
        kind, cycle_key, due_at, detail = due
        audience = _audience(org, venue.id)
        for channel in ("email", "in_app"):
            payload = dict(detail, licence_id=licence["id"], venue_name=venue.name)
            if channel == "in_app":
                payload["device_kinds"] = sorted(MANAGER_DEVICE_KINDS)
            if notice(
                conn,
                workspace_id=org.workspace_id,
                organisation_id=org.organisation_id,
                venue_id=venue.id,
                kind=kind,
                cycle_key=cycle_key,
                channel=channel,
                audience=audience,
                due_at=due_at,
                now=now,
                detail=payload,
            ):
                created.append({"venue_id": venue.id, "kind": kind, "channel": channel,
                                "cycle_key": cycle_key, "audience": audience})
    return created


# ---------------------------------------------------------------------------------------------
# In-app banners (manager devices only)

MANAGER_DEVICE_KINDS = frozenset({"manager", "web", "manager_app"})
BANNER_LEAD_DAYS = max(REMINDER_DAYS)


def licence_banners(
    conn: Connection, venue_id: str, *, role: str, device_kind: str, now: float
) -> list[dict[str, Any]]:
    """Licence banners for a manager on a manager device; nothing for staff, kiosks or
    customer displays."""
    if role not in MANAGER_ROLES or device_kind not in MANAGER_DEVICE_KINDS:
        return []
    state = licence_state(conn, venue_id, now)
    if state.reason == "no_attestation":
        return [{"kind": "licence_missing", "level": "error",
                 "text": "Add this venue's music licence before its zones can play."}]
    if state.reason == "not_started":
        return [{"kind": "licence_not_started", "level": "warning",
                 "text": "This venue's licence has not started yet, so its zones cannot play."}]
    assert state.expires_at is not None and state.grace_ends_at is not None
    if state.reason == "valid":
        days = int((state.expires_at - now) // DAY)
        if state.expires_at - now > BANNER_LEAD_DAYS * DAY:
            return []
        return [{"kind": "licence_expiring", "level": "warning", "days_left": days,
                 "text": f"This venue's music licence expires in {days} days. Add the renewed "
                         "licence in SelectaDJ."}]
    if state.reason in ("grace", "extended_grace"):
        days = int((state.grace_ends_at - now) // DAY)
        return [{"kind": "licence_grace", "level": "error", "days_left": days,
                 "text": f"This venue's music licence has expired. Zones keep playing for "
                         f"{days} more days; add the renewed licence to keep them going."}]
    return [{"kind": "licence_lapsed", "level": "error",
             "text": "This venue's music licence has expired. Zones will not start at the next "
                     "opening until a current licence is added."}]
