# ADR-0449 - Public performance licensing: attestation, play logs and business terms

- **Decision:** Proposed (2026-11-12).
- **Implementation:** 0/11 Not started.
- **Independent verification:** 0/11 Verified.
- **Programme/date/baseline:** SelectaDJ for Business (BZ); 2026-11-12; `feat/finish-checklists-2` at `1ccb08ba`.
- **Priority / phase:** P0 / Phase B0 (build); the legal review is the hard gate before Phase B2 (paid launch). **Owner:** Unassigned. **Implementing PR/SHA:** None yet.
- **Existing ADR owners:** ADR-0413 (copyright takedown and repeat infringers), ADR-0412 (retention), ADR-0416 (Rooms legal points), ADR-0441, ADR-0442, ADR-0447; their statuses are unchanged.
- **Source touchpoints:** new `src/selecta/business/licensing.py`, `src/selecta/business/playlog.py`; upload path; `src/selecta/flags/cloud.json` (new `business.licensing`); new `web/src/business/licensing/`.
- **Proposal chapter:** [docs/saas/19-business-venues.md](../saas/19-business-venues.md#198-licensing-and-the-hard-legal-gate).

## Context and evidence boundary

Playing recorded music in a venue is a public performance. In the UK the venue needs TheMusicLicence from PPL PRS, priced by sector, size and use. Copying recordings onto a server or device to supply business background music is a separate act; PPL licenses businesses that copy its repertoire to make music services ("dubbing"), and PRS for Music offers a ProDub licence for copying works. Personal downloads and CDs are licensed for personal use. Stems and transitions are derived audio. In the US, venues license from the performing rights organisations (ASCAP, BMI, SESAC, GMR); in the EU, from national societies (for example GEMA and GVL in Germany, SACEM in France), country by country.

SelectaDJ does not supply music, so these rights sit with the business, but the product copies the business's files to cloud storage, renders derived audio and caches it on kiosks. Whether SelectaDJ itself, the business, or both need a copying licence is a legal question nobody has answered yet. This is why the legal review is a hard gate before any paid business sale. It is not a gate on building.

This ADR records a proposed decision. Nothing in it is legal advice or implemented.

## Decision

- **Per-venue licence attestation:** each venue records its public performance licences (type from a list per territory, licence or account number, holder name, start and expiry date, territory), and an attestation that the business holds rights to copy and play the music it uploads. A zone cannot start scheduled playback until its venue has an unexpired attestation. Attestations are versioned and audited.
- **Expiry reminders:** 30, 14 and 3 days before expiry to the owner, admins and that venue's manager. After expiry, a 14-day grace with daily reminders; then the venue's zones do not start at the next opening (never stopped mid-service). The owner can extend grace once with a reason.
- **Upload rights attestation:** each upload batch into the organisation library records who uploaded it and their attestation that the business holds the rights; ADR-0413 takedown and repeat-infringer rules apply to organisations.
- **Play logs:** an append-only log per zone: track title, artist, album, ISRC (if known), label (if known), start time (UTC and venue local), seconds played, zone, source (schedule, staff, request), and whether it was heard inside a transition. Kept 3 years by default (licensing audits look back up to six years in the UK; the owner decides). Logs written offline are synced later (ADR-0446).
- **Play-log export:** CSV per venue and date range, with totals per track, for licensing returns and audits.
- **ISRC capture:** read ISRC from tags on upload; allow manual entry; show coverage per venue.
- **Business terms:** the business is responsible for every licence and for rights to every track it uploads, copies and plays; SelectaDJ does not supply music; warranty and indemnity; acceptable use; data processing terms. Accepted and versioned at checkout and on change.
- **Derived audio:** stems and transition renders are kept only as long as useful; business mix exports for redistribution are off by default.
- **Hard legal gate:** a UK media and IP lawyer reviews public performance, dubbing and copying (cloud storage, render, kiosk cache), derived audio, business terms, play-log retention and the US and EU positions. No business plan is sold until the review passes and the owner records it. Needs a person.

## User outcome and acceptance contract

A venue knows exactly which licences it needs, gets reminded before one runs out, and can hand a play log to a licensing body in a minute. REX Technologies never sells business plans before a lawyer has confirmed the position.

## Edge cases

- Licence expires during opening hours: playback continues to close; reminders continue.
- A venue in a territory with no list entry: "other" with free-text society name, flagged for staff review.
- Two venues share one licence number (one site, two trading names): allowed, with a staff review flag.
- A track's ISRC tag is wrong: manual correction is logged; exports show the corrected value and keep the original in the audit.
- Offline kiosk plays for 6 hours: play log entries are recorded on the device with monotonic times and synced in order; duplicates are dropped by idempotency key.
- Guest request (ADR-0451) of a track: logged with source `request`; guests' identities never appear in play logs.
- Venue transfer (ADR-0447): attestations and play logs move with the venue; the new organisation must re-attest upload rights.
- An organisation deletes a track: play-log rows keep their copied metadata, not a link to deleted audio.

## Rejected alternatives

- Checking licence numbers against society databases automatically (no public API; attestation plus spot checks instead).
- Logging only track ids (deleted tracks would make logs useless for audits).
- Building first, legal later with selling on (risk of selling an unlawful service).

## Implementation checklist - 0/11 Not started; 0/11 independently Verified

1. **BZ-0449-01 - Licence attestation model.** **Acceptance:** Venues store licences (type per territory, number, holder, dates, territory) and the copy-and-play rights attestation, versioned and audited; flag `business.licensing` registered (default off). **Required verification:** Integration tests. **Implementation:** Not started. **Independently Verified:** No.
2. **BZ-0449-02 - Attestation gates scheduled playback.** **Acceptance:** A zone cannot start scheduled playback without an unexpired attestation; expiry never stops a zone mid-service; after the 14-day grace the zone does not start at the next opening; the owner's one-off extension is audited. **Required verification:** Integration tests with a time-travel clock. **Implementation:** Not started. **Independently Verified:** No.
3. **BZ-0449-03 - Expiry reminders.** **Acceptance:** Reminders at 30, 14 and 3 days and daily during grace reach owner, admins and the venue manager by email and in-app on manager devices only. **Required verification:** Integration tests. **Implementation:** Not started. **Independently Verified:** No.
4. **BZ-0449-04 - Upload rights attestation.** **Acceptance:** Each organisation upload batch records uploader and attestation; uploads without it are refused; ADR-0413 takedown and repeat-infringer rules apply per organisation. **Required verification:** Integration tests. **Implementation:** Not started. **Independently Verified:** No.
5. **BZ-0449-05 - Play log.** **Acceptance:** Append-only per-zone log with every field above; offline entries sync in order without duplicates; rows keep copied metadata after a track is deleted; retention configurable with a 3-year default. **Required verification:** Integration tests including an offline sync test. **Implementation:** Not started. **Independently Verified:** No.
6. **BZ-0449-06 - Play-log export.** **Acceptance:** CSV export per venue and date range with per-track totals; matches the log exactly; available to owner, admin and venue manager only. **Required verification:** Integration tests plus a Playwright download test. **Implementation:** Not started. **Independently Verified:** No.
7. **BZ-0449-07 - ISRC capture.** **Acceptance:** ISRC read from tags on upload, manual entry with audit, coverage shown per venue. **Required verification:** Unit tests with tagged fixture files. **Implementation:** Not started. **Independently Verified:** No.
8. **BZ-0449-08 - Licensing onboarding and pages.** **Acceptance:** Venue onboarding asks for the licence and attestation before the first zone plays, explains TheMusicLicence (UK), PRO licences (US) and national societies (EU) in plain words with links, in both themes and at 320 px. **Required verification:** Playwright tests. **Implementation:** Not started. **Independently Verified:** No.
9. **BZ-0449-09 - Business terms capture.** **Acceptance:** Business terms are versioned; acceptance with version, time and actor is stored at checkout and when terms change; a business cannot continue past a changed version without accepting at its next sign-in (playback continues). **Required verification:** Integration tests. **Implementation:** Not started. **Independently Verified:** No.
10. **BZ-0449-10 - Derived audio and export limits.** **Acceptance:** Business stems and transition renders follow capped budgets with eviction; business mix exports are off by default behind their own flag. **Required verification:** Integration tests. **Implementation:** Not started. **Independently Verified:** No.
11. **BZ-0449-11 - Hard legal gate before selling.** **Acceptance:** A UK media and IP lawyer has reviewed public performance, dubbing and copying (cloud storage, renders, kiosk caches), derived audio, the business terms, play-log retention and the US and EU positions; the owner has recorded the outcome; the release-gate check (BZ-0441-09) refuses `business.signups` until this is ticked. **Required verification:** Legal review record. **Implementation:** Not started. Needs a person: the lawyer's review and the owner's recorded decision. **Independently Verified:** No.

## Governance

Proposed on 2026-11-12 for the owner's decision. Older ADRs keep their statuses; this one only links to them.
