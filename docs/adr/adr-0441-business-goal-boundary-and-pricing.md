# ADR-0441 - SelectaDJ for Business: goal, product boundary and pricing model

- **Decision:** Proposed (2026-11-12).
- **Implementation:** 0/9 Not started.
- **Independent verification:** 0/9 Verified.
- **Programme/date/baseline:** SelectaDJ for Business (BZ); 2026-11-12; `feat/finish-checklists-2` at `1ccb08ba`.
- **Priority / phase:** P1 / Phase B0 (build, selling switched off), then Phase B1 (scouting with pilot venues). **Owner:** Unassigned. **Implementing PR/SHA:** None yet.
- **Existing ADR owners:** ADR-0391 (Cloud goal), ADR-0402 (plans and entitlements), ADR-0403 (Stripe), ADR-0414 (flag targeting), ADR-0415 (devices), ADR-0416 (Rooms); their statuses are unchanged. Sibling Business ADRs: ADR-0442 to ADR-0454.
- **Source touchpoints:** `src/selecta/billing/plans.py`; `src/selecta/flags/cloud.json` (new `business.signups`); new `src/selecta/business/`; new `web/src/business/`; `docs/adr/README.md`.
- **Proposal chapter:** [docs/saas/19-business-venues.md](../saas/19-business-venues.md).

## Context and evidence boundary

The owner wants a business product: venues (bars, restaurants, shops, gyms, hotels) pay per venue per month for unattended, automatically mixed music from their own library, with guest requests and multi-venue control. The owner's starting price is "79 per venue per month". On 2026-11-12 the owner added that the product must be fully built and ready, but nothing is sold to businesses yet: the owner will first scout with a few friendly venues.

Background-music competitors (Soundtrack, Rockbot, Cloud Cover, Soundsuit, Mood Media) charge roughly $17 to $50 per zone or location per month and include a licensed catalogue. SelectaDJ is bring-your-own-music with automatic DJ mixing, so £79 sits two to four times above them and has to be justified by mixing quality, Rooms requests and multi-venue control. That is a pricing risk to test, not a settled fact.

This ADR records a proposed decision. Nothing in it is implemented or measured; prices and costs come from the proposal chapter and public sources dated 2026 and must be re-checked when the work starts.

## Decision

- **Goal.** Build SelectaDJ for Business to release quality while selling stays switched off. A new flag `business.signups` (default off, cloud mode only) hides the business pricing page, business checkout and self-serve organisation creation. With it off, pages reflow and no business wording appears to individual users. Pilot organisations are enabled one by one through ADR-0414 targeting rules.
- **Phases.** B0 Build (dark), B1 Scouting (3 to 5 friendly pilot venues, the pricing test plan runs here), B2 Paid launch (only after the ADR-0449 legal gate and the ADR-0447 Stripe staging run pass), B3 US and EU.
- **Product boundary.** SelectaDJ for Business plays the organisation's own uploaded music, mixed automatically, in venues with their own public performance licences. It does not supply a catalogue, does not stream audio to guests and never mixes personal and business data (ADR-0442).
- **Pricing model (starting point, owner to confirm).** £79 per venue per month ex VAT including 1 zone and 3 staff seats; £790 per venue per year; extra zone £25 per month; extra staff seat £5 per month beyond 3 per venue (owners and admins free); 10% off at 10 to 24 venues; 25+ venues Enterprise and sales-led; 14-day trial for 1 venue and 1 zone with a card. GBP for the UK launch; USD and EUR prices are an owner decision.
- **Catalogue.** Business plans are new versioned entries in the existing plan catalogue; Free, Standard and Premium are unchanged.

## User outcome and acceptance contract

A venue owner sees one clear per-venue price, knows they bring the music and the licences, and gets mixed music that never goes silent. Until the owner switches selling on, nobody outside the pilots can find or buy the business plan.

## Edge cases

- `business.signups` off while a pilot organisation exists: the pilot keeps working through its targeting rule; new visitors see nothing.
- A person with a personal Premium account joins a pilot organisation: both workspaces work, the personal plan and its billing are untouched.
- Price changes after launch: existing organisations keep their plan version until a notified change at renewal (ADR-0402 versioning).
- A trial organisation asks for a second venue: refused with a plain message until the trial converts.
- 25 or more venues requested in self-serve: routed to "talk to us", never sold at the self-serve price.
- Currency: an organisation is billed in one currency for life of its subscription; changing currency needs a new subscription at a period boundary.

## Rejected alternatives

- Bundling a licensed catalogue (needs label and publisher deals well beyond this programme).
- Per-zone-only pricing like competitors (undersells multi-venue control and the per-venue licence workflow).
- Selling during the build to fund it (the owner chose scouting first, and the legal gate is not passed).

## Implementation checklist - 0/9 Not started; 0/9 independently Verified

1. **BZ-0441-01 - Programme entry.** **Acceptance:** `docs/adr/README.md` lists the SelectaDJ for Business programme (ADR-0441 to ADR-0454), states individual plans and local guarantees are unchanged and links the chapter. **Required verification:** Doc review. **Implementation:** Not started. **Independently Verified:** No.
2. **BZ-0441-02 - Launch flag `business.signups`.** **Acceptance:** Flag registered in `src/selecta/flags/cloud.json` (cloud mode, default off); with it off the business pricing page, checkout routes and self-serve organisation creation answer 404 or are absent, pages reflow, and `docs/flags.md` is regenerated; a targeting rule turns it on for one pilot organisation only. **Required verification:** `tests/test_flags.py`, unit tests for the routes, Playwright flag-off and flag-on runs. **Implementation:** Not started. **Independently Verified:** No.
3. **BZ-0441-03 - Business plan catalogue.** **Acceptance:** Versioned `business_venue_v1` entries carry per-venue price per currency and interval, included zones and seats, storage, processing weight, Lucy pool and flag ids; `validate_catalogue()` checks them; a snapshot test proves Free, Standard and Premium are unchanged. **Required verification:** Unit tests. **Implementation:** Not started. **Independently Verified:** No.
4. **BZ-0441-04 - Product boundary copy.** **Acceptance:** Business onboarding and pricing say plainly that the business brings its own music and licences, guests never receive audio, and personal and business libraries stay apart; copy lives in the mode-keyed copy layer and says SelectaDJ. **Required verification:** Vitest copy snapshot. **Implementation:** Not started. **Independently Verified:** No.
5. **BZ-0441-05 - Business pricing page.** **Acceptance:** Behind `business.signups`, a page shows the per-venue price ex VAT, extra zones and seats, annual price, volume discount and a live total for N venues and M zones, in the organisation's currency, in both themes and at 320 px. **Required verification:** Playwright test plus vitest for the total calculation. **Implementation:** Not started. **Independently Verified:** No.
6. **BZ-0441-06 - Scouting pilot kit.** **Acceptance:** A pilot agreement template (free or nominal, no paid sale), a per-pilot setup checklist, success measures (silent minutes, staff interventions per opening day, requests per day, uptime of the kiosk, staff satisfaction) collected automatically where possible, and a feedback card are in `docs/verification/`. **Required verification:** Doc review, plus a test that the pilot measures are computed from real play and heartbeat data. **Implementation:** Not started. **Independently Verified:** No.
7. **BZ-0441-07 - Run the scouting pilots.** **Acceptance:** 3 to 5 friendly venues run SelectaDJ for at least 4 weeks each with their own licences attested; results recorded against the success measures. **Required verification:** Pilot report. **Implementation:** Not started. Needs a person: the owner recruits the venues, installs the kiosks and runs the pilots. **Independently Verified:** No.
8. **BZ-0441-08 - Price-sensitivity check.** **Acceptance:** A Van Westendorp price-sensitivity survey (4 questions) plus a pilot conversion offer at £79 is run with pilot venues and at least 15 further venue owners; the acceptable price range and the share willing to pay £79 are recorded. **Required verification:** Survey results. **Implementation:** Not started. Needs a person: the owner runs the survey and the conversion conversations. **Independently Verified:** No.
9. **BZ-0441-09 - Owner pricing decisions and launch switch.** **Acceptance:** The owner records currency, venue price, zone price, seat price, annual discount, volume tiers and trial terms; `business.signups` can be turned on globally only when BZ-0449-11 (legal gate) and BZ-0447-15 (Stripe staging) are ticked, enforced by a release-gate check that refuses otherwise. **Required verification:** Release-gate check test, then the owner's recorded decision. **Implementation:** Not started. Needs a person: the owner's pricing decisions and the decision to switch selling on. **Independently Verified:** No.

## Governance

Proposed on 2026-11-12 for the owner's decision. Older ADRs keep their statuses; this one only links to them.
