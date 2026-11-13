"""Business terms acceptance, upload rights attestation and takedown strikes (ADR-0449).

**Terms.** The SelectaDJ for Business terms (REX Technologies) are versioned. An owner or admin
accepts a version at checkout, at sign-in or when the terms change; the version, time, actor and
a hashed IP are stored. When the current version is not accepted, management is blocked at the
next sign-in until someone accepts it, but playback always continues.

**Upload rights.** Every upload batch into an organisation library records who uploaded it and
their attestation that the business holds the rights to copy and play the files. Uploads without
an attestation are refused. A venue moving to another organisation (ADR-0447) does not carry the
attestation: the new organisation attests again, because attestations are keyed by organisation.

**Takedowns.** ADR-0413's repeat-infringer rule applies per organisation: an organisation that
reaches `selecta.admin.takedowns.repeat_threshold()` valid notices (3 by default, set with
`SELECTA_REPEAT_INFRINGER_NOTICES`) has its uploads refused. The count is kept per organisation
in `biz_usage_counters` (meter `takedown_strikes`), one strike per actioned notice.

None of the wording here is legal advice; the terms themselves await the legal review gate
(BZ-0449-11).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import sqlalchemy as sa
from sqlalchemy.engine import Connection

from selecta.billing.schema import insert_ignore
from selecta.business.commercial_audit import audit, audit_rows
from selecta.business.commercial_facts import OrgFacts
from selecta.business.commercial_schema import (
    biz_terms_acceptances,
    biz_upload_attestations,
    biz_usage_counters,
)
from selecta.business.errors import BusinessError
from selecta.persistence import new_id

CURRENT_BUSINESS_TERMS_VERSION = "2026-11-12"
BUSINESS_TERMS_VERSIONS: tuple[str, ...] = (CURRENT_BUSINESS_TERMS_VERSION,)
BUSINESS_TERMS_PATH = "/legal/business/terms"
B2B_REFUND_POLICY_PATH = "/legal/business/refunds"
CONTEXTS = frozenset({"checkout", "sign_in", "change"})
ACCEPTING_ROLES = frozenset({"owner", "admin"})

TERMS_SUMMARY = (
    "Your business is responsible for every music licence and for the rights to every track it "
    "uploads, copies and plays. SelectaDJ does not supply music. The terms also cover warranty "
    "and indemnity, acceptable use and data processing."
)

CURRENT_UPLOAD_STATEMENT_VERSION = "2026-11-12"
UPLOAD_STATEMENT = (
    "I confirm this business holds the rights to copy these files to SelectaDJ and to play them "
    "in its venues."
)

STRIKE_METER = "takedown_strikes"
_DEFAULT_REPEAT_NOTICES = 3


class TermsError(BusinessError):
    code = "terms_invalid"


class TermsForbidden(BusinessError):
    code = "forbidden"


class UploadRefused(BusinessError):
    code = "upload_attestation_required"


# ---------------------------------------------------------------------------------------------
# Business terms


def accept(
    conn: Connection,
    org: OrgFacts,
    version: str,
    actor: str,
    context: str,
    ip_hash: str | None,
    *,
    now: float,
) -> bool:
    """Record an owner or admin accepting `version`. False when it was already accepted."""
    if version not in BUSINESS_TERMS_VERSIONS:
        raise TermsError("That is not a version of the SelectaDJ business terms.",
                         code="unknown_version")
    if context not in CONTEXTS:
        raise TermsError("Unknown acceptance context.", code="bad_context")
    if not any(m.user_id == actor and m.role in ACCEPTING_ROLES for m in org.members):
        raise TermsForbidden("Only the owner or an admin can accept the business terms.")
    created = insert_ignore(
        conn,
        biz_terms_acceptances,
        {
            "id": new_id(),
            "workspace_id": org.workspace_id,
            "organisation_id": org.organisation_id,
            "terms_version": version,
            "accepted_by": actor,
            "accepted_at": now,
            "context": context,
            "ip_hash": ip_hash,
        },
        ("organisation_id", "terms_version"),
    )
    if created:
        audit(conn, workspace_id=org.workspace_id, organisation_id=org.organisation_id,
              action="terms.accepted", actor=actor, now=now,
              detail={"version": version, "context": context})
    return created


def acceptance(conn: Connection, organisation_id: str,
               version: str | None = None) -> dict[str, Any] | None:
    version = version or CURRENT_BUSINESS_TERMS_VERSION
    row = conn.execute(
        sa.select(biz_terms_acceptances).where(
            biz_terms_acceptances.c.organisation_id == organisation_id,
            biz_terms_acceptances.c.terms_version == version,
        )
    ).mappings().first()
    return dict(row) if row else None


def needs_acceptance(conn: Connection, organisation_id: str | OrgFacts,
                     version: str | None = None) -> bool:
    org_id = organisation_id.organisation_id if isinstance(organisation_id, OrgFacts) \
        else organisation_id
    return acceptance(conn, org_id, version) is None


@dataclass(frozen=True)
class TermsAccess:
    current_version: str
    accepted: bool
    management_blocked: bool
    # Playback never stops over terms.
    playback_allowed: bool = True
    terms_path: str = BUSINESS_TERMS_PATH
    refund_policy_path: str = B2B_REFUND_POLICY_PATH

    def to_dict(self) -> dict[str, Any]:
        return dict(vars(self))


def access(conn: Connection, organisation_id: str) -> TermsAccess:
    """What a sign-in may do: management waits for acceptance, playback carries on."""
    accepted = not needs_acceptance(conn, organisation_id)
    return TermsAccess(CURRENT_BUSINESS_TERMS_VERSION, accepted,
                       management_blocked=not accepted)


# ---------------------------------------------------------------------------------------------
# Takedown strikes (ADR-0413 per organisation)


def repeat_threshold() -> int:
    """ADR-0413's repeat-infringer threshold, shared with `selecta.admin.takedowns`."""
    try:
        from selecta.admin.takedowns import repeat_threshold as adr0413_threshold
    except ImportError:  # pragma: no cover - the admin package is always present
        return _DEFAULT_REPEAT_NOTICES
    return adr0413_threshold()


def _strike_filter(organisation_id: str) -> Any:
    c = biz_usage_counters.c
    return sa.and_(c.organisation_id == organisation_id, c.venue_id == "", c.zone_id == "",
                   c.meter == STRIKE_METER, c.period_key == "current")


def takedown_strikes(conn: Connection, organisation_id: str) -> int:
    value = conn.execute(
        sa.select(biz_usage_counters.c.amount).where(_strike_filter(organisation_id))
    ).scalar()
    return int(value or 0)


def record_takedown_strike(conn: Connection, org: OrgFacts, *, notice_id: str, actor: str,
                           now: float) -> int:
    """Count one actioned takedown notice against the organisation. Idempotent per notice."""
    seen = any(r["detail"].get("notice_id") == notice_id
               for r in audit_rows(conn, org.organisation_id, "takedown.strike"))
    if seen:
        return takedown_strikes(conn, org.organisation_id)
    inserted = insert_ignore(
        conn,
        biz_usage_counters,
        {
            "id": new_id(), "workspace_id": org.workspace_id,
            "organisation_id": org.organisation_id, "venue_id": "", "zone_id": "",
            "meter": STRIKE_METER, "period_key": "current", "amount": 1.0, "updated_at": now,
        },
        ("organisation_id", "venue_id", "zone_id", "meter", "period_key"),
    )
    if not inserted:
        conn.execute(
            sa.update(biz_usage_counters)
            .where(_strike_filter(org.organisation_id))
            .values(amount=biz_usage_counters.c.amount + 1, updated_at=now)
        )
    count = takedown_strikes(conn, org.organisation_id)
    audit(conn, workspace_id=org.workspace_id, organisation_id=org.organisation_id,
          action="takedown.strike", actor=actor, now=now,
          detail={"notice_id": notice_id, "strikes": count, "threshold": repeat_threshold()})
    return count


def uploads_restricted(conn: Connection, organisation_id: str) -> bool:
    return takedown_strikes(conn, organisation_id) >= repeat_threshold()


# ---------------------------------------------------------------------------------------------
# Upload rights attestation


def record_upload_attestation(
    conn: Connection,
    org: OrgFacts,
    batch_id: str,
    uploader: str,
    file_count: int,
    statement_version: str,
    *,
    now: float,
    attested: bool = True,
    venue_id: str = "",
) -> dict[str, Any]:
    """Record the uploader's rights attestation for one upload batch. Audited."""
    if attested is not True:
        raise UploadRefused("Confirm the business holds the rights to these files.")
    if statement_version != CURRENT_UPLOAD_STATEMENT_VERSION:
        raise UploadRefused("Please confirm the current upload rights statement.",
                            code="stale_statement")
    if not batch_id or not uploader:
        raise UploadRefused("An upload batch and uploader are needed.", code="bad_batch")
    if int(file_count) < 1:
        raise UploadRefused("An upload batch has at least one file.", code="bad_batch")
    if not any(m.user_id == uploader for m in org.members):
        raise TermsForbidden("Only members of this organisation can upload to it.")
    if venue_id and org.venue(venue_id) is None:
        raise UploadRefused("That venue is not in this organisation.", code="not_found")
    if uploads_restricted(conn, org.organisation_id):
        raise UploadRefused("Uploads are suspended after repeated copyright notices.",
                            code="uploads_restricted")
    values = {
        "id": new_id(),
        "workspace_id": org.workspace_id,
        "organisation_id": org.organisation_id,
        "batch_id": batch_id,
        "uploader_id": uploader,
        "venue_id": venue_id,
        "statement_version": statement_version,
        "file_count": int(file_count),
        "attested_at": now,
    }
    if not insert_ignore(conn, biz_upload_attestations, values, ("batch_id",)):
        existing = _attestation(conn, batch_id)
        if existing is None or existing["organisation_id"] != org.organisation_id \
                or existing["uploader_id"] != uploader:
            raise UploadRefused("That upload batch belongs to someone else.", code="batch_taken")
        return existing
    audit(conn, workspace_id=org.workspace_id, organisation_id=org.organisation_id,
          venue_id=venue_id, action="upload.attested", actor=uploader, now=now,
          detail={"batch_id": batch_id, "file_count": int(file_count),
                  "statement_version": statement_version})
    return values


def _attestation(conn: Connection, batch_id: str) -> dict[str, Any] | None:
    row = conn.execute(
        sa.select(biz_upload_attestations).where(biz_upload_attestations.c.batch_id == batch_id)
    ).mappings().first()
    return dict(row) if row else None


def require_upload_attestation(
    conn: Connection,
    organisation_id: str,
    batch_id: str | None,
    *,
    uploader: str | None = None,
    files_so_far: int | None = None,
) -> dict[str, Any]:
    """The batch's attestation, or UploadRefused. Call before accepting each file.

    Refuses a batch with no attestation, one attested in another organisation (a transferred
    venue's new organisation must attest again), another uploader's batch, more files than were
    attested, or an organisation whose uploads are restricted after repeated takedowns.
    """
    if uploads_restricted(conn, organisation_id):
        raise UploadRefused("Uploads are suspended after repeated copyright notices.",
                            code="uploads_restricted")
    row = _attestation(conn, batch_id) if batch_id else None
    if row is None or row["organisation_id"] != organisation_id:
        raise UploadRefused("Confirm the business holds the rights to these files first.")
    if uploader is not None and row["uploader_id"] != uploader:
        raise UploadRefused("This upload batch was attested by someone else.",
                            code="batch_taken")
    if files_so_far is not None and int(files_so_far) > int(row["file_count"]):
        raise UploadRefused("This batch has more files than were attested.",
                            code="batch_overfull")
    return row
