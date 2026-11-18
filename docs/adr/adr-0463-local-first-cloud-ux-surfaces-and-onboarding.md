# ADR-0463 - Local-first Cloud UX surfaces and onboarding

- **Decision:** Accepted (owner, 2026-11-17).
- **Implementation:** 3/7 Implemented; 2/7 In progress; 2/7 Not started.
- **Independent verification:** 0/7 Verified.
- **Programme/date/baseline:** Browser-first Cloud (BF); 2026-11-17; `main` at `7d7f7932`.
- **Priority / phase:** P1 / Phase BF4. **Owner:** Unassigned. **Implementing PR:** #96.
- **Existing ADR owners:** ADR-0390 (`when_off`/`when_locked` reflow semantics), ADR-0416 (Rooms): unchanged. The UI programmes' accessibility and design-language ADRs (ADR-0368 family): unchanged, inherited. Sibling BF ADRs: ADR-0460 (posture flow), ADR-0462 (shared shell).
- **Source touchpoints:** `web/src/shell/manifest.ts` (destinations and More area); `web/src/cloud/CloudRoot.tsx`, `web/src/cloud/accountStates.ts`, `web/src/cloud/CloudStates.tsx` (kept); `web/src/cloud/Billing.tsx`, `web/src/cloud/Uploads.tsx` (placed, flag-gated); `web/src/devices/`, `web/src/rooms/` (kept, reached from More); `web/src/copy.ts` (status vocabulary); `src/selecta/flags/cloud.json` (surfaces fields for the BF flags).
- **Proposal chapter:** [docs/saas/11-ui-ux.md](../saas/11-ui-ux.md).

## Context and evidence boundary

ADR-0462 decides that the local shell and screens serve local-first Cloud. What it does not decide is where Cloud's own surfaces live and how a brand-new browser-first member gets from an empty page to audible music. Cloud today onboards around uploading; local-first onboarding is a different spine ending in a sound check, and several of its states (capability-failed devices, output-unverified playback, flagged-off hosted surfaces) have no precedent in either mode.

Status vocabulary and truthfulness rules referenced here are defined in ADR-0457, ADR-0460 and ADR-0461; this ADR places them in the interface. Nothing below is implemented.

## Decision

- **Four music destinations plus More.** The primary rail (desktop) and bottom navigation (mobile) carry the shared music destinations from the manifest; everything account-shaped lives in a More area: account and billing, devices and speaker status, Rooms hosting, Workspace tabs that are Cloud-relevant, and, only for hosted-flag accounts, the upload surfaces. Admin and business entries appear only for the roles that have them, exactly as today.
- **Cloud-only surfaces stay first-class.** Auth and account states (`CloudStates`: signed-out, expired, suspended, unreachable), billing and meters, device management, Rooms hosting and data export keep their flows; they adopt the shared design system (ADR-0462) but are not forced into local-mode moulds that have no equivalent concepts.
- **Onboarding is the posture spine.** Connect Music (import, ADR-0458), verify locally, capability check (ADR-0460 probe, with the controller fallback explained when it fails), choose output, tap Start, audible sound check, keep-awake guidance, then optionally pair a remote controller (ADR-0461). No step says install, upload or wait for processing. Each step is resumable and skippable where honest (a member can browse the library before ever playing).
- **Truthful status, one vocabulary.** The member-facing words for playback state come from one copy table: playing (verified at a time), output unverified, interrupted, uncertain, unsupported here (with reason). No surface shows a green light it cannot back; remote surfaces inherit the same words (ADR-0461's applied versus audible distinction).
- **Locked and off follow the registry.** Flagged-off surfaces vanish with reflow (`when_off`); plan-locked features show the existing teaser treatment (`when_locked`), never a dead control. The BF flags declare their `surfaces` so the sweep tests know what to check.
- **Accessibility and small screens inherited.** 320 px, touch targets, screen readers, reduced motion and both themes are acceptance criteria on every new surface, as the UI programmes already require; the venue flow additionally works in landscape kiosk posture.

## User outcome and acceptance contract

A new member goes from signing in to hearing their own music mixed, on one device, in minutes, understanding at each step what is happening and what is not (nothing uploaded, nothing installed). A member whose device cannot play still gets a useful product and an honest reason. Nobody meets a dead button, a false Ready, or an upload surface they were not granted.

## Edge cases

- **Empty everything.** No music connected, no devices, no mixes: every destination has a designed empty state pointing at Connect Music, not a blank table.
- **Capability check fails mid-onboarding.** The flow forks to the controller experience with the reason and what device would work; it never loops the member back to a check they cannot pass.
- **Sound check fails.** The member says they heard nothing: the flow walks output routes (ADR-0460) and leaves status unverified; it never marks the step done to move on.
- **Hosted-flag account onboarding.** A grandfathered account sees both paths with the local-first spine default and uploads where they always were; no migration pressure in onboarding (ADR-0465).
- **Suspended or expired account mid-session.** The account states interrupt exactly as today; local playback already in progress on the device finishes the current track safely rather than cutting mid-seam, then stops with the state page.
- **A guest opens a member link.** Guests land in the guest experience (unchanged); member-only deep links show sign-in, then resume to the destination.
- **Reduced motion and screen readers in the venue flow.** The sound check and posture steps have non-visual confirmations; the Start control is reachable and labelled; the physical stop is always one obvious action.

## Rejected alternatives

- **Onboarding by upload with local as an option.** Inverts the default and buries the product's point; uploads are a granted mode, not a step.
- **A separate Cloud navigation for account surfaces.** A fourth shell by the back door; More inside the shared manifest keeps one navigation.
- **Optimistic status language.** Showing playing while uncertain reads better in demos and destroys venue trust the first time it lies; the truthful vocabulary is the brand.
- **Blocking the product until onboarding completes.** Browsing the library and building recipes need no audio; gating them on a sound check would be artificial.

## Implementation checklist - 3/7 Implemented; 2/7 In progress; 2/7 Not started; 0/7 independently Verified

1. **BF-0463-01 - More area and placement.** **Acceptance:** The manifest places account, billing, devices, Rooms hosting and flagged upload surfaces in More with the four music destinations primary; roles and flags decide presence; mobile bottom navigation and desktop rail both verified. **Required verification:** Vitest on the manifest, Playwright at 320 px and desktop. **Implementation:** Implemented: `web/src/shell/manifest.ts` places account, billing, devices, Rooms and upload entries in More with the four music destinations primary (`manifest.bf.test.ts` passes). Playwright at 320 px and desktop pending. **Independently Verified:** No.
2. **BF-0463-02 - Onboarding spine.** **Acceptance:** The Connect-to-sound-check flow ships resumable, skippable where honest, with no install or upload step for default accounts; each step's completion is recorded truthfully. **Required verification:** Playwright onboarding specs, including abandon-and-resume. **Implementation:** Implemented: `web/src/cloud/onboarding/` (spine, resumable state in `state.ts`, truthful completion, no upload step for default accounts) with the progressive import behind flag `cloud.progressive_import`: one import session (`web/src/cloud/importSession.ts`) shared by the spine, Connect Music and the shell, "Continue while it finishes" so verify never blocks and settles when the import lands, the shell import chip (`ImportChip.tsx`), and the resume offer after an interrupted import (remembered folder or a re-pick that duplicates nothing); `OnboardingSpine.test.tsx`, `ConnectMusic.test.tsx` and `LocalFirstShell.test.tsx` pass, and the Playwright onboarding specs pass, including abandon-and-resume (`web/e2e-cloud/onboarding-progressive.cloud.ts`). **Independently Verified:** No.
3. **BF-0463-03 - Status vocabulary table.** **Acceptance:** One copy table defines the five playback states; every surface renders from it (audit test); remote and local surfaces use identical words for identical states. **Required verification:** Vitest copy audit. **Implementation:** Implemented: `PLAYBACK_STATUS` in `web/src/copy.ts` defines the five states and `web/src/copyAudit.test.ts` holds surfaces to it; passes. **Independently Verified:** No.
4. **BF-0463-04 - Empty and failure states.** **Acceptance:** Designed empty states for every destination and the capability-failed fork; no blank tables, no dead ends; all reachable states screenshot-reviewed in both themes. **Required verification:** Playwright state sweep with screenshots to `docs/verification/`. **Implementation:** In progress: `web/src/cloud/LocalFirstEmpty.tsx` gives designed empty and capability-failed states; the screenshot review of every reachable state in both themes is not done. **Independently Verified:** No.
5. **BF-0463-05 - Surfaces declarations and sweep.** **Acceptance:** Every BF flag declares its `surfaces`; the flag sweep proves reflow for each (off leaves no trace; locked shows the teaser). **Required verification:** `flags.cloud.ts` and the local sweep extended. **Implementation:** In progress: every BF flag declares `surfaces` in `src/selecta/flags/cloud.json`, but only `cloud.hosted_media` is in the `web/e2e-cloud/flags.cloud.ts` reflow sweep. **Independently Verified:** No.
6. **BF-0463-06 - Accessibility pass.** **Acceptance:** New surfaces pass keyboard, screen-reader labels, 320 px, 400% zoom, reduced motion and both themes; the venue flow passes in landscape kiosk posture with an always-reachable stop. **Required verification:** Automated checks plus the recorded manual pass. **Implementation:** Not started. Needs a person: manual screen-reader run. No automated accessibility pass over the new surfaces is recorded yet. **Independently Verified:** No.
7. **BF-0463-07 - Owner experience review.** **Acceptance:** The owner walks the onboarding on a real tablet and a phone and accepts the flow and wording. **Required verification:** Owner's recorded review. **Implementation:** Not started. Needs a person: the owner. **Independently Verified:** No.

## Governance

Accepted by the owner on 2026-11-17. The truthful-status vocabulary is load-bearing across ADR-0457, ADR-0460 and ADR-0461; changing a state word later means changing it in one table and re-running the audits, never per surface.
