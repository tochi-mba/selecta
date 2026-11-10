# ADR-0134 - Web-first product boundary for a possible future SaaS

- **Decision:** Accepted (owner accepted all proposed ADRs on 2026-11-08, [#37](https://github.com/tochi-mba/selecta/pull/37)).
- **Implementation:** 2/5 Implemented; 1 Not started; EX-0134-04 and -05 Superseded by ADR-0391 (2026-11-10).
- **Verification:** No (0/5 tasks independently Verified).
- **Programme/date/baseline:** Experience-first UI/UX; 2026-11-07; `main` `6638ec2313ce53843adfaf363306f8e79c4c8c7e`, after merged PR #29.
- **Priority / phase:** P0 / Scope.
- **Related earlier ADRs:** ADR-0072, ADR-0096, ADR-0111, ADR-0113. Historical decisions are preserved, not automatically superseded.
- **Source touchpoints:** `web/src/views/Start.tsx`, `web/src/router.ts`, `src/selecta/api.py`, `docs/adr/selecta-4-feature-parity.md`.

## Context and limits of current evidence

The owner explicitly rejects desktop packaging/native folder picker work and may pursue SaaS far in the future. Current Selecta is a browser app backed by a local-only server and locally managed music; these truths cannot be rewritten by aspiration. Source observations and earlier planning are not proof of user task outcomes, accessible operation or current visual quality.

## Proposed decision

- Maintain a browser-first experience and avoid coupling its interface concepts to a native desktop window or shell.
- Keep current local folder entry, path validation, Host/Origin safeguards, audio privacy and lyric metadata disclosure until a separate approved platform project changes them.
- Use concepts such as Music sources and Readiness when useful, without claiming remote library ingestion or sync currently exist.
- Exclude installers, desktop launchers, native folder-picker bridges, browser directory handle bridges, cloud accounts/storage/uploads, subscriptions, tenancy and authentication from this programme.
- If SaaS is later prioritized, require separate architecture/security/privacy/data-migration ADRs and explicit owner approval before implementation.

## Alternatives and rationale

A desktop installer could reduce friction but contradicts stated direction; starting SaaS now expands scope without a product brief. Select a web-first UX-only boundary.

## Consequences and boundaries

Do not claim offline current storage equals SaaS privacy or that server paths will translate to cloud files. Future changes must protect existing users and media rights. Preserve old routes, preferences, original media, current/draft/revision identity, single audio owner, Undo, consented atomic bridges, full Studio control, blind study integrity and correct FLAC. No near-term desktop packaging or SaaS migration, no silent backend/audio/API changes or remote telemetry.

## Implementation tasks (all Not started; Verified: No)

1. **EX-0134-01 - Record current platform truth**. Acceptance: Current local server and later optional SaaS clearly differentiated. Required verification: README/API/privacy crosscheck. **Implementation: Implemented; Verified: Yes (2026-11-10).** Evidence: `README.md`, `docs/saas/README.md`, `web/src/localPrivacyCopy.test.ts`.
2. **EX-0134-02 - Review proposed UX for desktop coupling**. Acceptance: No new desktop-only assumption added. Required verification: Design review. **Implementation: Not started; Verified: No. Needs a person: design review for desktop coupling.**
3. **EX-0134-03 - Preserve folder setup until separate decision**. Acceptance: Current typed path, scan and recovery work. Required verification: Existing E2E. **Implementation: Implemented; Verified: No.** Evidence: `web/e2e/mp-0282-onboarding.e2e.ts`; rerun pending.
4. **EX-0134-04 - Audit excluded implementation scope**. Acceptance: No packaging, picker bridge, accounts or cloud dependencies. Required verification: Changed-path and lockfile review. **Implementation: Not started; Verified: No. Superseded by ADR-0391: accounts and cloud dependencies are now in scope for Cloud mode.**
5. **EX-0134-05 - Define future SaaS decision gate**. Acceptance: New separate platform/security plan required on owner request. Required verification: Owner sign-off only when future priority exists. **Implementation: Not started; Verified: No. Superseded by ADR-0391: the owner requested SaaS; `docs/saas/` and ADR-0391..0416 are the separate plan.**

## Verification and sources

Test dark/light/system themes, long/RTL metadata, 320–2560px viewports and 200/400% zoom, keyboard/touch/NVDA, reduced motion and async failure/race states. Real media and export must be heard/decoded as applicable. [WCAG 2.2](https://www.w3.org/TR/WCAG22/) · [WAI-ARIA APG](https://www.w3.org/WAI/ARIA/apg/patterns/grid/) · [Playwright visual testing](https://playwright.dev/docs/test-snapshots) · [web.dev INP](https://web.dev/articles/inp). These sources inform design methods, not reported Selecta test results. See [roadmap](selecta-experience-roadmap.md), [checklist](selecta-experience-implementation-checklist.md), [evidence](selecta-experience-evidence.md), [historical reconciliation](selecta-experience-status-reconciliation.md).
