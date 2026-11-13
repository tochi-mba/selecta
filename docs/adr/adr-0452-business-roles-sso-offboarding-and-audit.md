# ADR-0452 - Business roles, SSO, staff offboarding and audit

- **Decision:** Proposed (2026-11-12).
- **Implementation:** 0/14 Not started.
- **Independent verification:** 0/14 Verified.
- **Programme/date/baseline:** SelectaDJ for Business (BZ); 2026-11-12; branch `feat/finish-checklists-2` at `1ccb08ba`.
- **Priority / phase:** P0 for pilots (roles, devices, offboarding, audit, pilot venues); SSO is P2 and needed only before Enterprise is sold. **Owner:** Unassigned. **Implementing PR/SHA:** None yet.
- **Existing ADR owners:** ADR-0400 (WorkOS AuthKit), ADR-0401 (staff RBAC and audit), ADR-0415 (devices), ADR-0435 (role security), ADR-0442 (organisations and venues), ADR-0445 (kiosk pairing), ADR-0447 and ADR-0448 (billing and seats); their statuses are unchanged.
- **Source touchpoints:** `src/selecta/authz/` (permission registry, check, audit patterns), `src/selecta/identity/`, `src/selecta/playback/devices.py`, `src/selecta/admin/`; new `src/selecta/business/members.py`, `src/selecta/business/roles.py`, `src/selecta/business/sso.py`, `src/selecta/business/pilots.py`; new `web/src/business/people/`, `web/src/admin/` pilot page.
- **Proposal chapter:** [docs/saas/19b-business-experience.md](../saas/19b-business-experience.md#19b3-roles-devices-and-audit).

## Context and evidence boundary

Selecta Cloud has three permission systems (ADR-0401): plan, workspace role (personal workspaces only) and platform staff role. A business organisation needs real customer-side roles: an owner who pays, a head office that watches every venue, managers who run one venue, bar staff who skip a song on a shared tablet, and devices that play music with nobody signed in. People join and leave venues every week, and someone who leaves must lose access at once without their personal SelectaDJ account being touched.

The owner will scout with a few friendly pilot venues before selling. Pilots need a free organisation created by REX Technologies staff, with no card and a clear end date.

This ADR records a proposed decision. Nothing in it is implemented or measured yet; numbers come from the proposal and must be re-checked when the work starts.

## Decision

### Roles and scope

| Role | Scope | Can | Cannot |
|---|---|---|---|
| Owner | Organisation | Everything, including billing, SSO, transferring ownership and closing the organisation | Remove the last owner |
| Admin | Organisation | Everything an owner can except transferring ownership and closing the organisation | Change owners |
| Venue manager | One or more venues | Zones, hours, schedules, content rules, Rooms settings, devices, licence details, play logs, invite staff into free seats for their venues | Billing, adding paid seats, SSO, other venues |
| Staff | One or more venues | Play, pause, skip, steer (Bigger, Calmer, Something else), volume up to the cap, approve or pass requests, stay open late within the allowance | Anything destructive or administrative: no deleting, unpairing, schedule or rule edits, billing or people |
| Viewer | Organisation or venues | Read health, now playing, schedules and play logs; export play logs | Any control |

- Permissions are stable strings in a business registry (`business.venue.read`, `business.zone.control`, `business.requests.moderate`, `business.rules.edit`, `business.devices.pair`, `business.people.invite`, `business.billing.manage`, `business.audit.read` and so on), separate from platform staff permissions. Roles are code-defined bundles, as in ADR-0401.
- Every business request resolves the person, their organisation assignments and the venue in question. A venue outside the person's scope answers 404, the same as one that does not exist.
- Owners and admins must use multi-factor sign-in (AuthKit MFA, or the identity provider's under SSO).
- A person can hold different roles in different venues (manager at Shoreditch, staff at Camden). The broadest role in scope wins for that venue.

### Seats

- A seat is a person with a manager or staff role. One person counts once per organisation, however many venues they work in. Owners, admins and viewers do not use seats.
- Included seats are pooled: 3 per paid venue (DESIGN section 2). Beyond that, each seat is billed (ADR-0447). A manager can invite into free seats; when none are free, the invite form says so and only an owner or admin can add a paid seat.
- Removing a person frees their seat at once; the billed quantity drops at the next invoice.

### Personal and business identity

- One WorkOS user can belong to organisations and keep a personal workspace. Business and personal libraries, ratings, Lucy memory, usage and devices never mix (DESIGN section 1).
- Leaving or being removed from an organisation never touches the personal workspace.
- An organisation can never see a member's personal workspace or plan.

### Device identity versus staff identity

- **Kiosk players** are organisation-owned device principals, not users. A manager pairs one by code to exactly one zone (ADR-0445). Its token can hold the zone lease, play, report health and play logs, download the cached horizon and receive commands. It cannot browse the library, read logs, change anything or act on another zone. It does not belong to the person who paired it, so it keeps playing when that person leaves.
- **Shared staff tablets** are device principals paired to a venue in shared mode. They show only the staff quick-control view. Each action is recorded as the device; if the venue turns on **staff PINs**, each action also needs a 4 to 6 digit personal PIN (per person, per venue, 5 wrong tries lock that PIN for 10 minutes) and the audit names the person.
- **Personal phones** sign in as the person and see what their role allows.
- Unpairing a kiosk during opening hours asks first: "Music in Terrace will stop now. Unpair now, or at closing time?"

### Invitations and SSO

- Invitations go by email, name the role and venues, expire after 7 days, and are accepted by signing in or signing up through AuthKit. Resending replaces the old link.
- **Enterprise SSO** through WorkOS (SAML or OIDC): verified domains, optional "require SSO for this domain", identity-provider-initiated sign-in, and optional Directory Sync (SCIM) with group-to-role mapping. A person arriving through SSO without a mapped group gets **no role** and an "Ask your admin for access" page; nothing is granted by default.
- An owner keeps a non-SSO sign-in with MFA as break-glass, shown in the SSO settings.
- SSO is plan-locked to Enterprise and behind `business.sso`.

### Offboarding

- Removing a person (from People, or by Directory Sync deactivation) at once: ends every business session of theirs (WorkOS sessions scoped to the organisation and our revocation cut-off), signs out every device they registered for the organisation, deletes their staff PINs, cancels their pending invitations, and frees their seat. Access stops within 30 seconds, matching ADR-0415's revocation bound.
- Kiosks and shared tablets they paired keep working. The People page lists "devices this person paired" so a manager can review them.
- Their uploads stay in the organisation library with the uploader shown as "Former member".
- The last owner cannot be removed or leave; ownership transfer needs the new owner to accept and the old owner to sign in again within 5 minutes.

### Pilot organisations (scouting before sale)

- Business sign-up is behind `business.signups`, off by default. Until the owner turns it on, the only way to get a business organisation is a **pilot** created by REX Technologies staff from the admin console (`web/src/admin/`), with the platform permission `business.pilots.create` (Owner and Admin staff roles).
- A pilot has: an organisation name, an invited owner email, a venue and zone allowance (default 1 venue, up to 3 zones), an end date (default 60 days, at most 180), and a note. No card, no Stripe subscription, no charge.
- Creating a pilot also adds the per-organisation targeting rule (ADR-0414) that switches the business features on for that organisation only, as docs/saas/19-business-venues.md requires; `business.signups` stays off for everyone else.
- Pilot organisations carry `pilot = true` and get Business entitlements for their allowance (ADR-0448). Every pilot action by staff is audited.
- Staff can extend the end date, change the allowance, convert the pilot to a paid organisation (which starts the normal Stripe flow for the owner, ADR-0447) or end it.
- When a pilot ends: management becomes read-only and playback stops at the venue's next closing time after the end date, with the same 72 h and 24 h warnings to the owner as billing grace (DESIGN section 6). Nothing is deleted for 90 days.

### Audit

- Business audit events are written append-only to the same audit store as ADR-0401, tagged with the organisation and venue: role and seat changes, invitations, removals, ownership transfers, SSO and directory changes, content rule changes and overrides, schedule changes, device pairing and unpairing, licence attestations, play-log exports, billing changes, pilot creation and changes, and staff (REX Technologies) access to the organisation.
- Owners and admins read the whole organisation's audit; managers read their venues'. It is searchable and exportable as CSV. Retention: 1 year (owner to confirm).
- Everyday control (skip, steer, volume, approve) goes to a lighter **activity log**, kept 90 days, shown on the venue page.

### Feature flags

`business.roles` (members, roles and invitations), `business.devices.shared` (shared tablets and staff PINs), `business.sso` (Enterprise SSO and Directory Sync), `business.audit` (the audit and activity pages), `business.signups` (self-serve sign-up, default off) and `business.pilots` (staff pilot creation), in the business flag area (ADR-0441).

## User outcome and acceptance contract

Each person sees and can do exactly what their job needs, at the venues they work at. Bar staff can never break anything. When someone leaves, they lose access within 30 seconds and the music keeps playing. Owners can see who changed what. REX Technologies can hand a friendly venue a free pilot without any card or sign-up page being live.

## Edge cases

- The same person is staff at one venue and viewer at the organisation: they control that venue and only watch the others.
- A manager tries to make themselves admin: refused and audited.
- An invite is accepted by a different email address than it was sent to: refused unless the address is on a verified SSO domain of the organisation and the owner allowed domain joins.
- Directory Sync removes someone mid-shift on a shared tablet: the tablet keeps working; that person's PIN stops working at once.
- A shared tablet is stolen: unpairing it revokes its token within 30 seconds; it can only ever have controlled one venue within limits.
- A kiosk token is copied to another machine: the lease and heartbeat show two devices with one token; the second is refused and the manager is told.
- SSO identity provider outage at shift change: existing sessions continue to expiry; staff tablets (device identity) keep working; the owner's break-glass sign-in works.
- An admin removes the only manager of a venue: allowed, with a notice that the venue has no manager.
- A pilot's end date falls on a Friday night with the venue open until 02:00: playback continues to 02:00 and stops at close.
- A pilot is converted to paid during its last day: no interruption; the read-only step never happens.
- REX Technologies staff open a customer organisation for support: only with a support case grant (ADR-0401), audited and shown in the organisation's audit.

## Rejected alternatives

- Treating kiosks as a signed-in staff member (a leaver would silence the venue, and the kiosk would hold powers it never needs).
- One login shared by all bar staff (no attribution, and offboarding becomes changing a password nobody remembers).
- Granting a default role to anyone who signs in through SSO.
- Letting pilots be created through the public sign-up with a coupon (the sign-up page would have to be live before legal sign-off).

## Implementation checklist - 0/14 Implemented; 0/14 independently Verified

1. **BZ-0452-01 - Business permission registry and roles.** **Acceptance:** Owner, admin, venue manager, staff and viewer hold exactly the permissions in the table; unknown permissions fail CI; business and platform permissions never overlap. **Required verification:** Unit tests per role and permission. **Implementation:** Not started. **Independently Verified:** No.
2. **BZ-0452-02 - Venue scope and 404s.** **Acceptance:** Every business route checks venue scope; out-of-scope venues answer 404 exactly like missing ones; a static test fails on a business route without a declared permission. **Required verification:** Route sweep test as each role; cross-organisation id-guessing tests. **Implementation:** Not started. **Independently Verified:** No.
3. **BZ-0452-03 - Staff can do nothing destructive.** **Acceptance:** As staff, every delete, unpair, rule, schedule, people and billing route is refused; play, pause, skip, steer, volume within cap, approve and stay open late within the allowance succeed. **Required verification:** API sweep test as staff. **Implementation:** Not started. **Independently Verified:** No.
4. **BZ-0452-04 - Seats.** **Acceptance:** Pooled included seats (3 per paid venue), one seat per person per organisation, managers invite only into free seats, owners and admins add paid seats, removal frees a seat at once. **Required verification:** Integration tests with ADR-0447's quantity sync faked. **Implementation:** Not started. **Independently Verified:** No.
5. **BZ-0452-05 - Invitations.** **Acceptance:** Email invites name role and venues, expire in 7 days, resend replaces, wrong-address acceptance is refused unless a verified domain allows it. **Required verification:** Integration tests. **Implementation:** Not started. **Independently Verified:** No.
6. **BZ-0452-06 - Personal and business separation.** **Acceptance:** A member's personal workspace is invisible to the organisation and untouched by leaving; business data never appears in the personal workspace. **Required verification:** Cross-workspace tests over every list and search route. **Implementation:** Not started. **Independently Verified:** No.
7. **BZ-0452-07 - Kiosk device principals.** **Acceptance:** A paired kiosk can only do its zone's playback, health, play-log and cache work; it survives the pairing person's removal; a copied token on a second machine is refused and reported. **Required verification:** API sweep as a kiosk token; token-copy test. **Implementation:** Not started. **Independently Verified:** No.
8. **BZ-0452-08 - Shared tablets and staff PINs.** **Acceptance:** Shared tablets show only staff controls for their venue; with PINs on, each action needs a PIN and the audit names the person; 5 wrong tries lock that PIN for 10 minutes. **Required verification:** Integration tests; Playwright for PIN entry. **Implementation:** Not started. **Independently Verified:** No.
9. **BZ-0452-09 - Offboarding.** **Acceptance:** Removal or Directory Sync deactivation ends the person's business sessions and devices, PINs and invites, frees their seat, within 30 seconds; kiosks they paired keep playing; uploads show "Former member". **Required verification:** Integration test timing the cut-off; offboarding drill in the security suite. **Implementation:** Not started. **Independently Verified:** No.
10. **BZ-0452-10 - Ownership and the last owner.** **Acceptance:** The last owner cannot be removed or leave; transfer needs acceptance and a fresh sign-in within 5 minutes. **Required verification:** Integration tests. **Implementation:** Not started. **Independently Verified:** No.
11. **BZ-0452-11 - Enterprise SSO and Directory Sync.** **Acceptance:** WorkOS SAML and OIDC sign-in for verified domains, optional enforcement, Directory Sync with group mapping, no role without a mapped group, owner break-glass; plan-locked to Enterprise. **Required verification:** Integration tests against WorkOS test fixtures; Needs a person: one real identity provider (for example Entra ID or Okta developer tenant) end to end in staging. **Implementation:** Not started. **Independently Verified:** No.
12. **BZ-0452-12 - Business audit and activity logs.** **Acceptance:** Every listed admin action writes an append-only audit row tagged with organisation and venue; owners, admins and managers read within scope; CSV export; everyday control goes to the 90-day activity log. **Required verification:** Database permission test (as ADR-0401); a test per audited action. **Implementation:** Not started. **Independently Verified:** No.
13. **BZ-0452-13 - Pilot organisations.** **Acceptance:** With `business.signups` off, only staff holding `business.pilots.create` can create a business organisation; pilots have an allowance, an end date (default 60, at most 180 days), no card; staff can extend, change, convert or end; at the end management is read-only and playback stops at the next close after 72 h and 24 h warnings; every staff action is audited. **Required verification:** Integration tests with a frozen clock across an overnight close; admin console Vitest and Playwright. **Implementation:** Not started. **Independently Verified:** No.
14. **BZ-0452-14 - Flags.** **Acceptance:** `business.roles`, `business.devices.shared`, `business.sso`, `business.audit`, `business.signups` (default off) and `business.pilots` are registered with `docs/flags.md` regenerated; pages reflow with each off; with `business.signups` off no public route creates an organisation. **Required verification:** `tests/test_flags.py`; route test that sign-up is refused with the flag off. **Implementation:** Not started. **Independently Verified:** No.

## Governance

Proposed on 2026-11-12 for the owner's decision. Older ADRs keep their statuses; this one only links to them.
