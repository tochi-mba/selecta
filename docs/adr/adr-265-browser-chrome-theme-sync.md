# ADR-265 — Manual theme and browser/PWA chrome synchronization

- **Decision:** Proposed (explicit owner decision pending).
- **Implementation:** 0/8 Implemented; 0/8 In progress; 8/8 Not started.
- **Independent verification:** 0/8 Verified.
- **Programme/date/baseline:** Selecta final polish (FP), 2026-11-08; main `5347e7309c5ff8b2e2965c2194bf2089b6ad2721`.
- **Priority / phase:** P1 / Theme integration.
- **Owner:** Unassigned.
- **Existing primary ADRs:** ADR-0077, ADR-0201, ADR-0208, ADR-0238. Their decisions and implementation histories are not changed.
- **Source touchpoints:** `web/index.html`; `web/src/state/prefs.ts`; `web/src/ui/ThemeChoice.tsx`; `web/public/manifest.webmanifest`.

## Context and evidence boundary

index.html declares separate prefers-color-scheme theme-color meta tags, while ThemeChoice supports saved explicit Light/Dark/System preferences. In browsers that use only the OS media-query meta tag for chrome, a manually selected opposing app theme can create visually inconsistent browser/PWA chrome.

This is a proposal for additional, *precisely testable* acceptance, not a claim that the existing app or previous ADR is unimplemented. Source observations are not independent human, visual, audio or accessibility verification.

## Novel delta and proposed decision

**New delta:** Define resolved-theme precedence and browser-chrome matching only. Existing ThemeChoice, persistence and PWA installation remain unchanged.

**Decision proposal:** The effective selected theme (manual Light or Dark, otherwise System) should inform page and supported browser chrome, including before first paint. If browser/PWA platforms ignore a dynamic theme-color change, document the limitation and maintain legible fallback.

**Alternatives:** Do nothing when baseline testing finds no material usability problem; improve the specific existing component over a wholesale scene or token rewrite. Owner may reject or supersede after documenting decision/date.

## Implementation checklist — 0/8 Implemented; 0/8 Verified

1. **FP-265-01 — Specify resolved theme precedence.** **Acceptance:** Manual choice always outranks OS colour preference; System follows OS; unavailable storage returns safe documented default. **Required verification:** Truth table for all preference and OS combinations **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
2. **FP-265-02 — Reproduce or refute chrome mismatch.** **Acceptance:** Capture browser toolbar and installed PWA chrome for opposing manual/OS choices without presuming every browser supports dynamic metadata. **Required verification:** Actual Chrome/Edge dated screenshots and version record **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
3. **FP-265-03 — Align first-paint theme data.** **Acceptance:** Initial document theme and supported chrome choice do not visually contradict each other or flash the wrong selected palette. **Required verification:** Cold-start screenshot/performance recording **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
4. **FP-265-04 — Apply manual theme to chrome where supported.** **Acceptance:** Changing Light/Dark without reload updates supported theme-color while preserving chosen page appearance. **Required verification:** Runtime theme switch browser test **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
5. **FP-265-05 — Honor System setting changes.** **Acceptance:** Effective theme follows OS at runtime only while user chooses System. **Required verification:** OS media change E2E and native/browser check **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
6. **FP-265-06 — Protect manual override.** **Acceptance:** OS changes cannot override explicitly chosen Light/Dark when application remains open. **Required verification:** Preference persistence and system-flip regression **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
7. **FP-265-07 — Preserve transport and route state.** **Acceptance:** Theme choice does not remount the music player, interrupt a seam, change selection or lose editing scope. **Required verification:** Live-audio playthrough during theme changes **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
8. **FP-265-08 — Document platform limits and acceptance.** **Acceptance:** Supported/unsupported browser-chrome variants have recorded behaviour and safe fallbacks, reviewed independently. **Required verification:** Named OS/browser/PWA reviewer, SHA and verified matrix **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.

## Invariants, negative cases and gates

**Area-specific negatives:** manual Light + OS Dark; manual Dark + OS Light; OS flip while System active; inaccessible localStorage; cold start; refresh; installed Edge/Chrome PWA; live playback.

**Shared matrix:** Both light/dark themes and System, OS forced colours, Still/reduced-motion, 320–2560px and 400% zoom, real long/duplicate/Unicode/RTL metadata, idle/loading/failure/offline/stale, keyboard/touch/NVDA, and real audio when relevant.

**Non-negotiable:** Original local audio is never changed; preserve one audio owner and explicit Pause, song/seam occurrence and revision identity, scoped Undo, consented atomic bridges, eight Studio lanes (8–64 cells), truthful readiness, private local data, neutral blind studies and frozen-revision FLAC. No SaaS/cloud music/telemetry/new account feature.

**Proof:** Browser/OS/PWA theme precedence matrix with before/after screenshots, E2E and real playback. Capture named independent reviewer, device, browser/OS, exact implementing code SHA, actual outcomes and failure cases. Muted synthetic CI/screenshots alone are not independent verification.

## Decision, implementation and verification lifecycle

Decision **Proposed → Accepted/Rejected/Superseded** requires explicit dated owner rationale. Implementation **Not started → In progress → Implemented** requires a linked source/test PR and SHA satisfying each exact task; a docs-only PR is *never* implementation. **Independently Verified = Yes** requires separate reviewer and dated evidence. No previous T/P/S3/S31/S4/EX/MI/CI/SF/GP ledger or status is modified.

[Roadmap](selecta-final-polish-roadmap.md) · [Task register](selecta-final-polish-implementation-checklist.md) · [Evidence](selecta-final-polish-implementation-evidence.md) · [Verification](selecta-final-polish-verification-matrix.md).
