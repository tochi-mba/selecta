*Part of the [Selecta Cloud proposal](README.md). Proposed on 2026-11-12; awaiting the owner's decision.*

> **Accepted local-first target (2026-11-13; implementation not started).** Business UI now needs per-venue music-source and transition readiness, local engine pairing/health, genuine output checks, offline fallback and missing-song remediation. Retain staff simplicity, customer-screen privacy and all content restrictions. See ADR-0478 and UX chapter 21. Historic architecture and evidence below remain part of the record. [Current direction](20-local-first-cloud-architecture.md) · [Migration](22-local-first-transition.md).


## 19B. SelectaDJ for Business: the experience, controls, people and testing

*Sub-chapter of [§19 SelectaDJ for Business](19-business-venues.md). Venue operations (hours, zones, kiosks, offline playback) are in [§19A](19a-venue-operations.md). This part covers what people see and do, the rules that govern what plays, who can do what, and how the whole business plan is tested before pilots and before sale. Users see "SelectaDJ"; the company is REX Technologies.*

The plan is built in full but not sold yet. Self-serve sign-up sits behind `business.signups`, off by default; the owner scouts first with a few friendly pilot venues that REX Technologies staff create from the admin console. Everything below works the same for a pilot as for a paying venue, except where it says "pilot".

### 19B.1 Content controls

[ADR-0450](../adr/adr-0450-venue-content-controls.md). A venue decides what may play where and when, and nothing else plays: not from the schedule, a guest request, Lucy, or a kiosk that lost its internet.

| Control | What it does | Who sets it |
|---|---|---|
| Explicit flag | Each song is explicit, clean or unknown: read from tags at upload (MP4 `rtng`, ID3 and Vorbis advisory fields), set by hand, or set in bulk (selection or CSV by ISRC). Lyrics only raise a "Worth checking" hint; analysis never decides | Venue manager and above |
| Explicit filter | Per zone and daypart: Off, No explicit (default), Clean only. A linked clean edit can stand in for a refused original | Venue manager and above |
| Blocklists | Song, artist (variants previewed), album or tag; at organisation, venue or zone scope; optional end date and reason | Admin (organisation), manager (venue, zone) |
| Allowed crates | Each daypart block names the venue crates it draws from | Venue manager |
| Brand rules | BPM range (half and double time counted), energy range, song and artist spacing | Venue manager |
| Volume | A cap per zone and lower caps in quiet hours; staff move freely below the cap | Manager sets the cap; staff set the volume |
| Expiring override | Allow one song or artist in one zone for up to 24 hours, never past Clean only | Venue manager, audited |

Rules only narrow from organisation to venue to zone to daypart. One engine answers every "may this play here now?" question, and every plan, request decision and play-log row records the rule version it used. If a pool gets too small, only spacing, then energy, then BPM relax, and the manager is told; the explicit filter, blocklists and crates never relax. A rule that would leave a scheduled block with nothing to play cannot be saved.

### 19B.2 Rooms for Business

[ADR-0451](../adr/adr-0451-rooms-for-business.md). Each zone with requests on has one **standing room** with a stable QR code for printed table cards (a print sheet makes cards and posters). It is open while the zone is open. Differences from a Premium party room ([§11A.2](11a-devices-and-rooms.md#11a2-rooms-premium)):

- **Staff approve each request** by default, from the staff view; unapproved requests expire after 20 minutes, and guests are told "Requests are paused for now" when no staff device has been seen for 10 minutes.
- **Content rules apply**: guest search shows only songs allowed in that zone at that time; requests are re-checked when they are placed and when their slot comes up.
- **Limits** a manager tunes within bounds: 1 pending per guest, 3 an hour, a 60-minute song cooldown, 20 pending and 12 accepted per zone per hour.
- **Venue Wi-Fi**: guests share one public address, so the kiosk's address is recorded as the venue network and crowd-sized limits apply to it; code-guessing lockouts never lock out the venue network.
- **Branding**: venue name, logo, zone name, a 140-character welcome line and an accent colour used only where it passes contrast in both themes. Guests never see staff names, billing, licence or device states.
- **Abuse**: remove or ban a guest, pause requests in one tap, an automatic switch to staff approval during a flood, and an optional on-screen code that changes every 15 minutes for venues with remote abuse. No free text anywhere.

### 19B.3 Roles, devices and audit

[ADR-0452](../adr/adr-0452-business-roles-sso-offboarding-and-audit.md).

| Role | Scope | In one line |
|---|---|---|
| Owner | Organisation | Everything, including billing, SSO and ownership |
| Admin | Organisation | Everything except ownership and closing the organisation |
| Venue manager | Venues | Runs their venues: zones, hours, schedules, rules, requests, devices, licence, play logs, staff into free seats |
| Staff | Venues | Play, pause, skip, steer, volume up to the cap, approve requests, stay open late within the allowance; nothing destructive |
| Viewer | Organisation or venues | Reads health, schedules and play logs; exports play logs |

- **Seats**: a manager or staff member uses one seat per organisation however many venues they work in; 3 included per paid venue, pooled ([ADR-0448](../adr/adr-0448-business-entitlements-storage-seats-weight-lucy-slo.md)).
- **Devices are not people**: a kiosk player is an organisation-owned device paired to one zone; it keeps playing when the person who paired it leaves. Shared bar tablets are devices in shared staff mode, with optional personal staff PINs for attribution.
- **Offboarding**: removing someone (or Directory Sync deactivating them) ends their business sessions, devices, PINs and invitations within 30 seconds and frees their seat. Their personal SelectaDJ account is untouched.
- **SSO** for Enterprise through WorkOS (SAML, OIDC, Directory Sync with group mapping). No role is granted without a mapped group. The owner keeps a break-glass sign-in.
- **Pilots**: REX Technologies staff create a pilot organisation (allowance, end date of 60 days by default, no card) from the admin console, which also adds the per-organisation targeting rule. When a pilot ends, management goes read-only and music stops at the venue's next closing time after 72 h and 24 h warnings, the same rule as billing grace.
- **Audit**: admin actions are written append-only per organisation and venue and exported as CSV; everyday control (skips, approvals) goes to a 90-day activity log.

### 19B.4 The business experience

[ADR-0453](../adr/adr-0453-business-ui-ux.md) is the full specification, with a state matrix for every surface. In short:

| Surface | For | The point of it |
|---|---|---|
| Sign-up and onboarding | New owners and pilot owners | One sitting from nothing to a scheduled first service: details, venue, hours, zones, licence, music, kiosk pairing, first daypart |
| HQ console | Owners, admins, viewers | Every venue's music at a glance, silent zones within a minute, schedules across venues, play-log export, billing |
| Venue manager view | Managers | Today's music, schedules, rules, requests, devices, licence and play log for one venue, from a phone or a laptop |
| Staff quick-control | Staff, shared tablets | Five big buttons (Bigger, Calmer, Something else, Skip, Pause), volume to the cap, requests to approve; nothing destructive |
| Kiosk player screen | Nobody manages it; customers may see it | A calm now-playing view, pairing and tap-to-start states, and "The music will be back shortly" at worst |
| Customer Rooms page and display | Guests | Now playing, search, requests; only calm music states |
| Workspace switcher | Anyone in an organisation | A clear band says which workspace you are in; personal and business never mix |
| Pilot administration | REX Technologies staff | Create, extend, convert and end pilots, each with a reason and an audit row |

**States every surface is tested against:** empty, loading, offline, degraded, silent zone, over seats, licence expiring, licence expired, payment grace, plan locked and pilot, on top of the Cloud state matrix in [§11.5](11-ui-ux.md#115-state-matrix-every-screen-is-tested-against).

**The customer-facing rule.** The kiosk screen, guest page and zone display are separate bundles that never contain manager components or manager fields. Billing, licence, seat, pilot and error states appear only on manager devices; customers see "Closed", "Music paused" or "The music will be back shortly" and never a cause. Build and payload tests enforce this.

**Access and layout.** Phone (320 and 375 px), tablet, desktop and big screen (1920 by 1080 at 3 metres); both themes through the existing tokens; 64 px targets on the staff view; keyboard and screen reader support with one assertive announcement (a new silent zone) and polite, rate-limited now-playing updates; no motion under reduced motion or Still; reflow at 400% zoom; forced colours. New components (WorkspaceSwitcher, VenueHealthGrid, SilentZoneAlert, ScheduleBoard, StaffControlDeck, BigAction, VolumeLimitSlider, KioskScreen, PilotBadge, ManagerNotice and others) are built from the existing primitives in `web/src/ui/`; the only new tokens are a big control height and a big-screen type step.

### 19B.5 Testing and release gates

[ADR-0454](../adr/adr-0454-business-edge-cases-stress-and-release-gates.md).

**Business invariants**, checked after every business test: no platform-caused silence while saved music exists; no refused song plays; one speaker per zone; no manager state on customer screens; no cross-organisation access; billing and pilot ends never stop music mid-service; each play logged exactly once; offboarding complete within 30 seconds; volume never above the cap.

**Every edge case is a named test**, grouped by hours and time, zones, kiosks and offline, content controls, Rooms, roles, billing and pilots, licensing and UI.

**Stress scenarios** (scaled down in CI, full size on staging):

| Scenario | Load | Must hold |
|---|---|---|
| Opening-hour peak | 500 venues by 3 zones, 70% opening within 10 minutes | Every zone audible within 60 s (p99); 4 hours saved ahead for 99% within 30 minutes; heartbeat p95 under 300 ms |
| Reconnect storm | 1,000 kiosks back within 10 s after a 30-minute outage | No audio gap; all reconnected within 2 minutes; one speaker per zone; offline play logs once |
| Bulk schedule edit | One edit to 200 venues, 60 open, 20 kiosks offline, a concurrent editor | Done within 60 s; online kiosks updated within 30 s; open venues change at the next block, never mid-song; conflicts reported |
| Grace at closing time | 300 organisations, grace ending at every awkward moment, late and duplicate webhooks | Music continues to each venue's own close and fades; no restart at next opening; warnings once each |

Six further scenarios cover request floods, an SSO outage at shift change, mass offboarding, a month of play-log export, organisation-wide rule changes at peak and a 72-hour soak. Three real kiosk types (mini PC, Android TV box, Android tablet) run a 72-hour soak with power cuts and a 2-hour network loss.

**Two release moments:**

| Gate | Means | Needs |
|---|---|---|
| **Ready for pilots** | All code and tests pass | Every named test and invariant green; the four stress scenarios at full size on staging; the real-device soak; accessibility and security runs; flags with `business.signups` off; the pilot agreement and each pilot's licence attestation |
| **Ready to sell** | Legal sign-off and validated pricing | Ready for pilots, plus the lawyer's written view, the owner's pricing decision from scouting evidence, 3 to 5 pilots of at least 4 weeks with no platform-caused silence, the further stress scenarios, Stripe readiness, support runbook, VoiceOver and real screen-reader checks, and the ADR-0440 GO decision. Only then does `business.signups` turn on |

### 19B.6 Open questions for the owner

1. **Explicit default for new zones**: "No explicit" (plays unknown songs) or the stricter "Clean only"? Proposed: No explicit, with the unknown count always visible.
2. **Viewers and seats**: viewers (HQ analysts) free, as proposed, or counted as seats?
3. **Audit retention**: 1 year proposed for business audit rows; activity log 90 days.
4. **"Powered by SelectaDJ"** on the guest page footer: keep, as proposed, or let Enterprise remove it?
5. **Silent-zone alert channels**: email and in-app first; push or SMS later (SMS costs money per message)?
6. **Staff PINs**: off by default, as proposed, or on by default for shared tablets?
7. **Pilot length**: 60 days default, 180 maximum, as proposed?

---

[← 19a-venue-operations.md](19a-venue-operations.md) · [Contents](README.md#chapters) · [19-business-venues.md](19-business-venues.md)
