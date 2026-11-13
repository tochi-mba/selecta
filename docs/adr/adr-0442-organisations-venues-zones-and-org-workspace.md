# ADR-0442 - Organisations, venues, zones and the org workspace

- **Decision:** Proposed (2026-11-12).
- **Implementation:** 0/11 Not started.
- **Independent verification:** 0/11 Verified.
- **Programme/date/baseline:** SelectaDJ for Business (BZ); 2026-11-12; `feat/finish-checklists-2` at `1ccb08ba`.
- **Priority / phase:** P1 / Phase B0 (build, selling switched off), used by pilot venues in Phase B1. **Owner:** Unassigned. **Implementing PR/SHA:** None yet.
- **Existing ADR owners:** ADR-0393 (Postgres, Alembic and tenancy) and the rules in [docs/saas/06-data-model.md](../saas/06-data-model.md) (workspaces, row-level security), ADR-0402 (plans and entitlements), ADR-0415 (devices), ADR-0433 (venue speakers, leases and zones, Autopilot programme); their statuses are unchanged. Sibling Business ADRs: ADR-0441, ADR-0443 to ADR-0454.
- **Source touchpoints:** `src/selecta/identity/schema.py` (`WORKSPACE_KINDS`, `workspaces`, `workspace_members`); `src/selecta/identity/accounts.py`; `src/selecta/api_cloud.py` (the `X-Workspace-ID` header); `src/selecta/storage/eviction.py`; `src/selecta/rooms/settings.py` (`crate_song_ids`); new `src/selecta/business/orgs.py`, `src/selecta/business/venues.py`, `src/selecta/business/crates.py`, `src/selecta/business/schema.py`; new `web/src/business/`.
- **Proposal chapter:** [docs/saas/19a-venue-operations.md](../saas/19a-venue-operations.md#19a1-organisations-venues-and-zones), part of [docs/saas/19-business-venues.md](../saas/19-business-venues.md).

## Context and evidence boundary

Selecta Cloud today knows one kind of tenant that matters: a person's own workspace. `identity/schema.py` already has `WORKSPACE_KINDS = ("personal", "team")`, a unique personal workspace per owner, `workspace_members` with roles `owner`, `editor` and `viewer`, and the API picks the workspace from the `X-Workspace-ID` header (`api_cloud.py`). Every tenant table carries `workspace_id` under forced row-level security (06-data-model.md section 6.1.1). The playback session is one row per workspace (`playback/schema.py`, `playback_sessions` keyed by `workspace_id`), and the cloud has no crates: a Room's requestable songs are a list of song ids in `RoomSettings.crate_song_ids`.

A business needs more structure: one paying organisation with several sites, each site with its own address, time zone, opening hours and licence, and each site with one or more areas that play different music at once. The owner wants it built fully but not sold yet: selling stays behind `business.signups` (ADR-0441), and the first organisations are pilots created by REX Technologies staff (ADR-0452, "Pilot organisations").

This ADR records a proposed decision. Nothing in it is implemented or measured yet.

## Decision

### The hierarchy

- **Organisation** = one workspace of a new kind, `business`. It is the tenant: library, crates, ratings, Lucy memory, usage, jobs, devices and audit all hang off its `workspace_id`, so the existing row-level security, quota, scheduler and outbox work unchanged. `team` keeps its current meaning; `business` is added beside it.
- **Venue** = a physical site inside the organisation: name, address, country, IANA time zone, opening hours (ADR-0444), licence attestation (ADR-0449), content rules (ADR-0450), status `active`, `paused` or `archived`.
- **Zone** = an area of a venue with its own speaker: bar, terrace, dining room. Each zone has exactly one playback session (ADR-0443), its own schedule (ADR-0444) and its own kiosk player (ADR-0445). Status `active` or `paused`; a paused zone plays nothing and does not count toward paid zones (ADR-0447, ADR-0448).
- **Device** = a player or a remote. A kiosk belongs to the organisation and is paired to one zone (ADR-0452 device principals); a person's phone is a device of that person inside the organisation workspace.

### One library per organisation, crates per venue

- The organisation library is shared by every venue. Staff uploads land in it with `uploaded_by` recorded (shown as "Former member" after offboarding, ADR-0452).
- A **crate** is a named, ordered set of songs owned by the organisation. A crate is either organisation-wide ("Brand core") or owned by one venue ("Shoreditch Friday"). Venues may use organisation crates and their own; one venue never sees another venue's crates.
- Schedules (ADR-0444), zone defaults and content rules (ADR-0450) point at crates, never at song lists. Rooms for Business (ADR-0451) uses the same crate ids instead of `crate_song_ids`.
- A crate holds song ids and keeps a song's membership after the song is deleted only as a tombstone row, so a deleted song can be restored into the same crates within the 30-day recovery window (05-storage-uploads-playback.md section 5.5).

### Personal and business never mix

- A person can be a member of any number of organisations and keep their own personal workspace. They switch workspace (the switcher is ADR-0453 S7, flag `business.workspaces`).
- Every request names exactly one workspace (`X-Workspace-ID`), as today. Listening events, ratings, set-asides, Lucy turns, uploads, steering preferences and usage are written to the workspace of the request that caused them, never to both. A staff member skipping a song in a bar never teaches their personal taste profile anything.
- A browser keeps one device id per workspace (`usePlaybackDevice.ts` already stores `selecta.device.{workspaceId}`). The `selecta_device` cookie becomes a per-workspace cookie name (`selecta_device_{short workspace hash}`) so a browser in two workspaces never presents the wrong device id; the body's `device_id` still wins.
- A personal plan, its billing and its ten-device limit are untouched by joining or leaving an organisation.

### Pilot organisations and selling switched off

- With `business.signups` off (ADR-0441), the only way an organisation is created is ADR-0452's staff pilot flow (flag `business.pilots`, permission `business.pilots.create`). That flow calls the same `orgs.create` and `venues.create` functions as self-serve sign-up will, so a pilot exercises exactly the code a paying venue would.
- `workspaces.pilot_until` (nullable) marks a pilot organisation; entitlements come from ADR-0448's pilot allowance, not Stripe. Nothing in venues, zones, schedules, kiosks or offline playback branches on `pilot`; only billing, the HQ "Pilot" label (ADR-0453) and the end-of-pilot stop (ADR-0452) read it.
- Everything here is testable with the cloud test server (`tests/e2e_cloud_server.py`) seeded with a made-up organisation, two venues in different time zones and three zones. No paying venue and no Stripe account are needed.

### Feature flag

`business.orgs` (cloud mode, default off): the organisation, venue, zone and crate model and routes. It is turned on per pilot organisation by an ADR-0414 targeting rule and is independent of `business.signups`, so pilots work while selling is off. With it off, business routes answer 404, no business wording appears to individual users, and every personal page reflows unchanged.

## Data model and code touchpoints

| Change | Where | Notes |
|---|---|---|
| `WORKSPACE_KINDS` gains `business` | `identity/schema.py`, Alembic migration | The check constraint is widened; the unique personal-workspace index is unchanged |
| `workspaces.pilot_until` (Epoch, nullable) and `workspaces.legal_name` | same | Billing details live in ADR-0447's tables, not here |
| `workspace_members.role` | `identity/schema.py` | Business roles are ADR-0452's registry; `workspace_members` keeps `owner` for the organisation owner and a new `business_member` value, with venue-scoped assignments in ADR-0452's `business_role_assignments` |
| New `venues` (`id`, `workspace_id`, `name`, `address_json`, `country`, `timezone`, `status`, `created_at`, `archived_at`) | new `business/schema.py` | Tenant table: `workspace_id` plus the `workspace_isolation` policy; `timezone` validated against `zoneinfo.available_timezones()` |
| New `zones` (`id`, `workspace_id`, `venue_id`, `name`, `status`, `home_device_id`, `standby_device_id`, `created_at`) | same | Unique `(venue_id, lower(name))`; `home_device_id` and `standby_device_id` are ADR-0445's kiosks |
| New `crates` (`id`, `workspace_id`, `venue_id` nullable, `name`, `created_by`, `created_at`) and `crate_songs` (`crate_id`, `workspace_id`, `song_id`, `position`, `removed_at`) | same | `venue_id` null = organisation-wide |
| `songs.uploaded_by` | cloud library schema | Set from the upload session's user |
| `devices.zone_id`, `devices.principal` (`person` or `kiosk`), `devices.user_id` nullable for kiosks | `playback/schema.py` | ADR-0443 and ADR-0445 use them; a person device keeps `user_id` |
| Eviction protects every zone's playing revision and cached horizon | `storage/eviction.py` | Today it protects the one revision named by the workspace's single session; it must read every session row of the workspace (ADR-0443) and every revision a kiosk reports as cached (ADR-0446) |
| `tests/test_cloud_workspace_columns.py`, `tests/test_cloud_rls.py` | tests | New tables are listed as tenant tables and proven isolated on PostgreSQL |

## User outcome and acceptance contract

An owner sees their organisation, its venues and each venue's zones in one place. Every venue draws from one shared library, picks its own crates, and nothing a person does at work leaks into their personal SelectaDJ or the other way round.

## Edge cases

- **A person in a personal account and an organisation.** They switch workspace; a device playing personal music asks before switching (ADR-0453 D9); a device holding a zone lease cannot switch to personal until it hands the zone back (ADR-0443).
- **The same browser registered in both workspaces.** Two device rows, two cookies, two local-storage keys; neither workspace can read the other's row (row-level security plus the ADR-0415 rule that another workspace's device id looks missing).
- **Deleting a song used by a schedule.** Schedules point at crates, so the schedule stays valid. The song is tombstoned (05 section 5.5): it leaves every crate's effective list at once; each zone whose uncommitted horizon includes it replans from the first uncommitted transition (ADR-0444); the committed window (the next two transitions, already rendered and possibly cached on the kiosk) still plays it unless the manager chooses "Remove now", which skips it with a planned move. Offline kiosks drop it on reconnect (ADR-0446); if it played offline, the play log records it truthfully.
- **Deleting a crate used by a schedule block or a zone default.** Refused with "Used by 3 schedules: Brunch (Terrace), ..." and a link to each; the manager can reassign first. Archiving a crate is allowed and behaves like removal from those blocks only after confirmation.
- **A crate that becomes empty or nearly empty** (deletions, content rules): the block falls back to the zone's default crates, then the venue pool, as ADR-0450 decides; the manager is told.
- **Two venues in different time zones.** Each venue stores its own IANA zone; nothing is stored in "organisation time". The HQ view shows each venue's local time (ADR-0444).
- **Moving a venue to another time zone** (a data entry mistake): allowed only by an owner or admin, with a preview of the next week's opening and closing instants before and after; it is applied at the venue's next close.
- **Renaming or archiving a venue or zone mid-service.** Renames apply at once (kiosk screen updates); archiving a zone or venue asks for "now" or "at closing time" and pauses its playback at the chosen moment; nothing is deleted for 90 days.
- **Zone count over the paid count after a downgrade.** The owner picks which zones stay (ADR-0447); unpicked zones become `paused` at their next close; their schedules, crates and kiosks are kept.
- **Pilot ends.** ADR-0452 decides; this model only exposes `pilot_until` and keeps every row.
- **Uploads by a staff member who then leaves.** The song stays in the organisation library; `uploaded_by` points at a person who is no longer a member and shows "Former member".
- **An organisation member who is also its only owner closes their personal account.** The personal workspace follows the account-deletion workflow; the organisation is untouched and blocks the deletion until ownership is transferred (ADR-0452 rule that the last owner cannot leave).

## Rejected alternatives

- **One workspace per venue.** It would split the library and fragment fair scheduling, and an organisation could not share crates or see one HQ view.
- **Reusing the `team` kind.** Team workspaces are a different, smaller idea; mixing them would make every business rule ask "which kind of team".
- **Song lists inside schedules.** Every deletion would edit schedules; crates keep one place to change.
- **Merging a member's personal library into the organisation.** Licensing (ADR-0449) and privacy both forbid it.

## Implementation checklist - 0/11 Implemented; 0/11 independently Verified

1. **BZ-0442-01 - Business workspace kind.** **Acceptance:** `WORKSPACE_KINDS` includes `business`; a migration widens the constraint and adds `pilot_until` and `legal_name`; personal and team workspaces are unchanged; `orgs.create` makes a business workspace with its owner as a member. **Required verification:** Migration test on SQLite and PostgreSQL; unit tests for `orgs.create`; existing identity tests still pass. **Implementation:** Not started. **Independently Verified:** No.
2. **BZ-0442-02 - Venues.** **Acceptance:** Create, rename, pause, archive and list venues; the time zone must be a valid IANA zone; address and country stored; archiving keeps every row for 90 days. **Required verification:** Integration tests including an invalid time zone and an archived venue that no longer plays. **Implementation:** Not started. **Independently Verified:** No.
3. **BZ-0442-03 - Zones.** **Acceptance:** Create, rename, pause and archive zones inside a venue; names unique per venue ignoring case; a paused zone plays nothing and is not counted as a paid zone; archiving asks for now or at closing. **Required verification:** Integration tests. **Implementation:** Not started. **Independently Verified:** No.
4. **BZ-0442-04 - Crates.** **Acceptance:** Organisation-wide and venue crates; a venue sees organisation crates and its own, never another venue's; crate order is kept; Rooms for Business reads crate ids instead of `crate_song_ids`. **Required verification:** Integration tests including a cross-venue read that answers 404. **Implementation:** Not started. **Independently Verified:** No.
5. **BZ-0442-05 - Uploads into the organisation library.** **Acceptance:** Uploads in a business workspace land in the organisation library with `uploaded_by`; quota is the pooled organisation quota (ADR-0448); an offboarded uploader shows as "Former member". **Required verification:** Integration tests on the upload plan and complete routes. **Implementation:** Not started. **Independently Verified:** No.
6. **BZ-0442-06 - Deleting songs and crates in use.** **Acceptance:** A deleted song leaves every crate at once, uncommitted horizons replan, the committed window plays out unless "Remove now" is chosen; deleting a crate used by a schedule or zone default is refused with the list of uses; a restored song returns to its crates. **Required verification:** Integration tests for each case. **Implementation:** Not started. **Independently Verified:** No.
7. **BZ-0442-07 - Personal and business separation.** **Acceptance:** Listening events, ratings, Lucy turns, uploads, steering and usage are written only to the request's workspace; one browser holds separate device ids and cookies per workspace; a personal plan is untouched by joining or leaving. **Required verification:** Integration tests that act in both workspaces from one browser identity and compare every affected table. **Implementation:** Not started. **Independently Verified:** No.
8. **BZ-0442-08 - Tenant isolation for new tables.** **Acceptance:** `venues`, `zones`, `crates` and `crate_songs` carry `workspace_id` with the `workspace_isolation` policy; deliberately unfiltered queries see only their own organisation. **Required verification:** `tests/test_cloud_rls.py` and `tests/test_cloud_workspace_columns.py` on PostgreSQL. **Implementation:** Not started. **Independently Verified:** No.
9. **BZ-0442-09 - Eviction protects every zone.** **Acceptance:** `storage/eviction.py` protects the playing revision of every zone session in the workspace and every revision a kiosk reports cached, not just one session's. **Required verification:** Unit tests in `tests/test_cloud_storage_eviction.py` with three zones. **Implementation:** Not started. **Independently Verified:** No.
10. **BZ-0442-10 - Pilot path uses the real model.** **Acceptance:** ADR-0452's staff pilot creation calls `orgs.create`, `venues.create` and `zones.create`; the cloud test server seeds a made-up pilot organisation with two venues in different time zones and three zones, so every Business browser test runs without Stripe or a paying venue. **Required verification:** Integration test of the pilot path; the seeded server starts in `tests/e2e_cloud_server.py`. **Implementation:** Not started. **Independently Verified:** No.
11. **BZ-0442-11 - Flag `business.orgs`.** **Acceptance:** Registered in `src/selecta/flags/cloud.json` (cloud mode, default off) with its routes; `docs/flags.md` regenerated; with it off business routes answer 404 and personal pages reflow; a targeting rule turns it on for one pilot organisation only. **Required verification:** `tests/test_flags.py`; Playwright flag-off and flag-on runs. **Implementation:** Not started. **Independently Verified:** No.

## Governance

Proposed on 2026-11-12, awaiting the owner's decision. Older ADRs keep their statuses; this one only links to them.
