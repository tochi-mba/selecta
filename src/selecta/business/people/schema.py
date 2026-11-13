"""Tables for business people, devices, SSO, pilots and activity (ADR-0452, migration bz0452role01).

Every table except `business_pilots` is tenant data of the organisation workspace: it carries
`workspace_id` (indexed) and `organisation_id` (the same id: an organisation is a `workspaces`
row of kind `business`, ADR-0442) and gets the forced `workspace_isolation` policy on PostgreSQL.
`business_pilots` is platform data written by REX Technologies staff, so it has no tenant policy.

Venue, zone, device and user ids are plain strings: no foreign keys to other packages' tables, so
this package lands before or after them. "No venue" is the empty string, never NULL.

- `business_members`: one row per person per organisation. `org_role` is owner, admin, viewer
  or NULL (venue roles only). `status` active or removed; a removed row is kept for the audit and
  for "Former member" on uploads.
- `business_venue_roles`: a person's role at one venue (venue_manager, staff or viewer).
- `business_seats`: the organisation's paid extra seats (ADR-0447 syncs the billed quantity).
- `business_invitations`: email invites naming the role and venues, 7 days, one live per email.
- `business_ownership_transfers`: a pending transfer, accepted by the new owner and confirmed by
  the old owner's fresh sign-in within 5 minutes.
- `business_shared_tablets`: shared staff tablets paired to one venue (device principals).
- `business_venue_access`: per-venue settings, today only whether staff PINs are on.
- `business_staff_pins`: a person's PIN at one venue (salted hash), its failures and lock.
- `business_sso_connections`, `business_sso_group_maps`: WorkOS SSO and Directory Sync.
- `business_pilots`: free pilot organisations created by staff.
- `business_activity`: the 90-day everyday-control log (skip, steer, volume, approve).
"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from selecta.persistence import Epoch, Id, metadata

Json = sa.JSON().with_variant(postgresql.JSONB(), "postgresql")
Hash = sa.String(64)

ORG_ROLES = ("owner", "admin", "viewer")
VENUE_ROLES = ("venue_manager", "staff", "viewer")
MEMBER_STATUSES = ("active", "removed")
MEMBER_SOURCES = ("invite", "sso", "directory", "pilot", "founder")
PILOT_STATUSES = ("pending", "active", "ended", "converted")
SSO_KINDS = ("saml", "oidc")


def _one_of(column: str, values: tuple[str, ...]) -> str:
    return f"{column} IN ({', '.join(repr(value) for value in values)})"


def _tenant() -> list[sa.Column]:
    return [
        sa.Column("workspace_id", Id, nullable=False, index=True),
        sa.Column("organisation_id", Id, nullable=False),
    ]


business_members = sa.Table(
    "business_members",
    metadata,
    sa.Column("id", Id, primary_key=True),
    *_tenant(),
    sa.Column("user_id", Id, nullable=False),
    sa.Column("email", sa.String(320), nullable=False),
    sa.Column("display_name", sa.String(200)),
    sa.Column("org_role", sa.String(16)),
    sa.Column("status", sa.String(16), nullable=False, default="active"),
    sa.Column("source", sa.String(16), nullable=False, default="invite"),
    sa.Column("directory_user_id", sa.String(255)),
    sa.Column("joined_at", Epoch, nullable=False),
    sa.Column("removed_at", Epoch),
    sa.Column("removed_by", Id),
    sa.CheckConstraint(_one_of("status", MEMBER_STATUSES), name="status"),
    sa.CheckConstraint(_one_of("source", MEMBER_SOURCES), name="source"),
    sa.CheckConstraint(f"org_role IS NULL OR {_one_of('org_role', ORG_ROLES)}", name="org_role"),
    sa.UniqueConstraint("workspace_id", "user_id", name="uq_business_members_workspace_user"),
)

business_venue_roles = sa.Table(
    "business_venue_roles",
    metadata,
    sa.Column("id", Id, primary_key=True),
    *_tenant(),
    sa.Column("user_id", Id, nullable=False),
    sa.Column("venue_id", Id, nullable=False),
    sa.Column("role", sa.String(16), nullable=False),
    sa.Column("granted_by", Id),
    sa.Column("created_at", Epoch, nullable=False),
    sa.CheckConstraint(_one_of("role", VENUE_ROLES), name="role"),
    sa.UniqueConstraint(
        "workspace_id", "user_id", "venue_id", name="uq_business_venue_roles_user_venue"
    ),
    sa.Index("ix_business_venue_roles_workspace_venue", "workspace_id", "venue_id"),
)

business_seats = sa.Table(
    "business_seats",
    metadata,
    sa.Column("organisation_id", Id, primary_key=True),
    sa.Column("workspace_id", Id, nullable=False, index=True),
    sa.Column("paid_seats", sa.Integer, nullable=False, default=0),
    sa.Column("updated_at", Epoch, nullable=False),
    sa.Column("updated_by", Id),
)

business_invitations = sa.Table(
    "business_invitations",
    metadata,
    sa.Column("id", Id, primary_key=True),
    *_tenant(),
    sa.Column("email", sa.String(320), nullable=False),
    sa.Column("org_role", sa.String(16)),
    sa.Column("venue_roles", Json, nullable=False),  # {venue_id: role}
    sa.Column("token_hash", Hash, nullable=False, unique=True),
    sa.Column("invited_by", Id, nullable=False),
    sa.Column("created_at", Epoch, nullable=False),
    sa.Column("expires_at", Epoch, nullable=False),
    sa.Column("accepted_at", Epoch),
    sa.Column("accepted_by", Id),
    sa.Column("cancelled_at", Epoch),
    sa.Column("cancel_reason", sa.String(32)),
    sa.Index("ix_business_invitations_workspace_email", "workspace_id", "email"),
)

business_ownership_transfers = sa.Table(
    "business_ownership_transfers",
    metadata,
    sa.Column("id", Id, primary_key=True),
    *_tenant(),
    sa.Column("from_user_id", Id, nullable=False),
    sa.Column("to_user_id", Id, nullable=False),
    sa.Column("created_at", Epoch, nullable=False),
    sa.Column("expires_at", Epoch, nullable=False),
    sa.Column("accepted_at", Epoch),
    sa.Column("confirm_by", Epoch),
    sa.Column("completed_at", Epoch),
    sa.Column("cancelled_at", Epoch),
)

business_shared_tablets = sa.Table(
    "business_shared_tablets",
    metadata,
    sa.Column("id", Id, primary_key=True),
    *_tenant(),
    sa.Column("venue_id", Id, nullable=False),
    sa.Column("device_id", Id),
    sa.Column("name", sa.String(60), nullable=False),
    sa.Column("token_hash", Hash, nullable=False, unique=True),
    sa.Column("pairing_code_hash", Hash, unique=True),
    sa.Column("pairing_expires_at", Epoch),
    sa.Column("paired_by", Id, nullable=False),
    sa.Column("created_at", Epoch, nullable=False),
    sa.Column("paired_at", Epoch),
    sa.Column("last_seen_at", Epoch),
    sa.Column("revoked_at", Epoch),
    sa.Index("ix_business_shared_tablets_workspace_venue", "workspace_id", "venue_id"),
)

business_venue_access = sa.Table(
    "business_venue_access",
    metadata,
    sa.Column("venue_id", Id, primary_key=True),
    *_tenant(),
    sa.Column("staff_pins", sa.Boolean, nullable=False, default=False),
    sa.Column("updated_at", Epoch, nullable=False),
    sa.Column("updated_by", Id),
)

business_staff_pins = sa.Table(
    "business_staff_pins",
    metadata,
    sa.Column("id", Id, primary_key=True),
    *_tenant(),
    sa.Column("venue_id", Id, nullable=False),
    sa.Column("user_id", Id, nullable=False),
    sa.Column("pin_hash", Hash, nullable=False),
    sa.Column("salt", sa.String(32), nullable=False),
    sa.Column("failures", sa.Integer, nullable=False, default=0),
    sa.Column("locked_until", Epoch),
    sa.Column("created_at", Epoch, nullable=False),
    sa.UniqueConstraint(
        "workspace_id", "venue_id", "user_id", name="uq_business_staff_pins_venue_user"
    ),
)

business_sso_connections = sa.Table(
    "business_sso_connections",
    metadata,
    sa.Column("id", Id, primary_key=True),
    *_tenant(),
    sa.Column("workos_organization_id", sa.String(255)),
    sa.Column("workos_connection_id", sa.String(255), unique=True),
    sa.Column("kind", sa.String(8), nullable=False),
    sa.Column("domains", Json, nullable=False),  # [{"domain": ..., "verified": bool}]
    sa.Column("require_sso", sa.Boolean, nullable=False, default=False),
    sa.Column("allow_domain_join", sa.Boolean, nullable=False, default=False),
    sa.Column("directory_id", sa.String(255)),
    sa.Column("status", sa.String(16), nullable=False, default="draft"),
    sa.Column("created_at", Epoch, nullable=False),
    sa.Column("updated_at", Epoch, nullable=False),
    sa.CheckConstraint(_one_of("kind", SSO_KINDS), name="kind"),
)

business_sso_group_maps = sa.Table(
    "business_sso_group_maps",
    metadata,
    sa.Column("id", Id, primary_key=True),
    *_tenant(),
    sa.Column("group_id", sa.String(255), nullable=False),
    sa.Column("group_name", sa.String(255)),
    sa.Column("org_role", sa.String(16)),
    sa.Column("venue_roles", Json, nullable=False),  # {venue_id: role}
    sa.Column("created_at", Epoch, nullable=False),
    sa.UniqueConstraint("workspace_id", "group_id", name="uq_business_sso_group_maps_group"),
)

business_pilots = sa.Table(
    "business_pilots",
    metadata,
    sa.Column("id", Id, primary_key=True),
    # Empty until the invited owner accepts and the organisation exists.
    sa.Column("organisation_id", Id, unique=True),
    sa.Column("name", sa.String(200), nullable=False),
    sa.Column("owner_email", sa.String(320), nullable=False),
    sa.Column("venue_allowance", sa.Integer, nullable=False, default=1),
    sa.Column("zone_allowance", sa.Integer, nullable=False, default=3),
    sa.Column("ends_at", Epoch, nullable=False),
    sa.Column("note", sa.Text),
    sa.Column("status", sa.String(16), nullable=False, default="pending"),
    sa.Column("invitation_token_hash", Hash, unique=True),
    sa.Column("created_by", Id, nullable=False),
    sa.Column("created_at", Epoch, nullable=False),
    sa.Column("updated_at", Epoch, nullable=False),
    sa.Column("warned_72h_at", Epoch),
    sa.Column("warned_24h_at", Epoch),
    sa.Column("read_only_at", Epoch),
    sa.Column("stops_at", Epoch),
    sa.Column("ended_at", Epoch),
    sa.Column("converted_at", Epoch),
    sa.Column("purge_after", Epoch),
    sa.CheckConstraint(_one_of("status", PILOT_STATUSES), name="status"),
)

business_activity = sa.Table(
    "business_activity",
    metadata,
    sa.Column("id", Id, primary_key=True),
    *_tenant(),
    sa.Column("venue_id", Id, nullable=False),
    sa.Column("zone_id", Id),
    sa.Column("actor_kind", sa.String(16)),
    sa.Column("actor_id", Id),
    sa.Column("person_id", Id),  # who confirmed by PIN on a shared tablet
    sa.Column("kind", sa.String(48), nullable=False),
    sa.Column("words", sa.String(300), nullable=False),
    sa.Column("metadata", Json),
    sa.Column("created_at", Epoch, nullable=False),
    sa.Column("purge_after", Epoch, nullable=False),
    sa.Index("ix_business_activity_workspace_venue_time", "workspace_id", "venue_id", "created_at"),
)

TENANT_TABLES = (
    "business_members",
    "business_venue_roles",
    "business_seats",
    "business_invitations",
    "business_ownership_transfers",
    "business_shared_tablets",
    "business_venue_access",
    "business_staff_pins",
    "business_sso_connections",
    "business_sso_group_maps",
    "business_activity",
)
PLATFORM_TABLES = ("business_pilots",)

ALL_TABLES = [
    business_members,
    business_venue_roles,
    business_seats,
    business_invitations,
    business_ownership_transfers,
    business_shared_tablets,
    business_venue_access,
    business_staff_pins,
    business_sso_connections,
    business_sso_group_maps,
    business_pilots,
    business_activity,
]
