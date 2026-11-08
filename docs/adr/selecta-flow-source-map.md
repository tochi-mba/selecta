# Selecta / Flow - source and verification touchpoint map

**Scope:** 50 Accepted decisions and 400 Not started SF acceptance tasks. Source mapping is planning evidence only, not proof tasks are Implemented or independently Verified. Baseline: `c3715b14a70a0a9005e9fbc08d44576f3eac3c15`.

| Workstream | Existing implementation touchpoints | Source/automated test touchpoints | SF ADRs | Independent gate |
|---|---|---|---|---|
| Scene shell and routes | `web/src/App.tsx`, `web/src/shell/Shell.tsx`, `web/src/shell/manifest.ts`, `web/src/router.ts` | `web/src/shell/Shell.test.tsx`, `web/e2e/visual.e2e.ts` | ADR-0198, 0208, 0244 | Back/Forward, focus, exact scope and no audio reinitialization |
| Tokens, layout and themes | `web/src/styles/tokens.css`, `web/src/styles/foundation.css`, `web/src/styles/shell.css`, `web/src/styles/creation.css` | `web/e2e/visual.e2e.ts` screenshot candidates only | ADR-0200–0205, 0233, 0245 | Both themes, WCAG contrast, 320px and 400% zoom |
| Shared music objects | `web/src/ui/MusicObjects.tsx`, `web/src/styles/music-objects.css`, `web/src/state/readiness.ts` | `web/src/ui/MusicObjects.test.tsx` | ADR-0206, 0207, 0237 | Identity, provenance, planned vs real state and non-colour semantics |
| Controls and motion | `web/src/ui/controls.tsx`, `web/src/ui/primitives.tsx`, `web/src/ui/useReducedMotion.ts`, `web/src/ui/toasts.tsx` | `web/src/ui/controls.test.tsx` | ADR-0204, 0205, 0232, 0234, 0242, 0243 | Keyboard/NVDA, touch, reduced motion, no false success |
| Player and focus | `web/src/player.ts`, `web/src/audio/focus.ts` | `web/src/player.test.ts`, `web/src/audio/focus.test.tsx` | ADR-0209, 0211, 0214 | Single audio owner, manual Pause, media keys and live sound |
| Listen, Stage and Up Next | `web/src/views/Now.tsx`, `web/src/styles/listening.css`, `web/src/ui/seam.ts` | `web/src/views/Now.test.tsx` | ADR-0210, 0211, 0213–0215 | Actual song and transition clock, words, blocked seek and Stage fallback |
| Existing 15 spectrum modes | `web/src/views/spectrumVisuals.ts` | `web/src/views/spectrumVisuals.test.ts`, `web/e2e/creative-visualizers.e2e.ts` | ADR-0212 | Source-real frequency bins, silence, reduced motion and performance |
| Explore/Mix Setup | `web/src/views/Mixes.tsx`, `web/src/views/MixSetup.tsx` | `web/src/views/Mixes.test.tsx`, `web/src/views/MixSetup.test.tsx` | ADR-0216, 0217, 0222 | Actual plan/eligibility, exact 5-stop intent and correct scope |
| Discovery | `web/src/views/Links.tsx` | Manual source/contract and real-audition testing to be enumerated | ADR-0218 | Real phrase/harmonic pair and independent audible relevance |
| Mix editor and inspector | `web/src/views/Mix.tsx`, `web/src/views/EditorRows.tsx`, `web/src/views/SeamInspector.tsx` | `web/src/views/Mix.test.tsx` | ADR-0219–0222, 0243 | Stable pair/revisions/locks, 100-song stress, real audition |
| Stem Studio | `web/src/views/Studio.tsx`, `web/src/studio.ts` | `web/src/views/Studio.test.tsx` | ADR-0223, 0224 | 8 lanes, 8–64 cells, accurate AI diff and local recovery |
| Requests and consent | `web/src/views/Requests.tsx` | `web/src/views/Requests.test.tsx`, `web/src/views/RequestsJoining.test.tsx` | ADR-0225 | Exact target, optional bridge consent, atomic join and stale race |
| Library and song details | `web/src/views/Library.tsx`, `web/src/views/SongDetails.tsx` | `web/src/views/Library.test.tsx` | ADR-0226, 0227 | 20k-song responsiveness, readiness truth and metadata safety |
| Mix projects and drafts | `web/src/views/MyMixes.tsx`, `web/src/views/Drafts.tsx`, `web/src/views/CurrentMix.tsx` | `web/src/views/Drafts.test.tsx`, `web/src/views/CurrentMix.test.tsx` | ADR-0228 | Current/draft distinction, activation, rev guards and render queue |
| First run | `web/src/views/Start.tsx`, `web/src/views/Setup.tsx` | `web/src/views/Setup.test.tsx` | ADR-0229 | Local server paths, real 6-ready threshold, LRCLIB metadata disclosure |
| Workspace operations | `web/src/views/Workshop.tsx`, `web/src/views/WorkshopPanels.tsx` | `web/src/views/Workshop.test.tsx` | ADR-0230 | Actual jobs, local paths, storage confirmation and recoverability |
| FLAC export | `web/src/views/ExportPanel.tsx`, `web/src/views/ExportJobs.tsx`, `web/src/views/exportStore.ts` | Future exact rendered-output decoding/metadata verification | ADR-0231 | Frozen revision, decodable FLAC and real progress |
| Automated UX | `web/playwright.config.ts`, `web/e2e/visual.e2e.ts` | Edge synthetic-fixture E2E and proposed human baseline approval | ADR-0239, 0240, 0245 | Screenshot candidates ≠ approved goldens and muted test ≠ sonic proof |
| Performance and architecture | `web/src/styles/polish.css`, `web/src/views/Now.tsx`, `web/src/views/Library.tsx` | Real hardware profiling required outside ordinary unit tests | ADR-0235, 0236, 0241 | Audio CPU priority, responsive UI, reversible migration |
| Programme governance | `docs/adr/README.md`, `docs/acceptance.md` | SF checklist, evidence, independent verification, rollback | ADR-0199, 0240, 0246, 0247 | Exact tested SHA and independent sign-off |

## Source-level review cautions

- **An existing source file is not equivalent to completion of a new SF acceptance task.** Compare actual code/test behavior against each numbered criterion before status changes.
- **A missing independent acceptance result is not proof the underlying code is broken.** Real playback, aural quality, accessibility and hardware measurements must be collected separately.
- **No new media/file/network implementation is authorized.** SaaS is future-only and remains out of scope.

[Roadmap](selecta-flow-roadmap.md) · [Checklist](selecta-flow-implementation-checklist.md) · [Evidence](selecta-flow-implementation-evidence.md) · [Parity](selecta-flow-feature-parity.md) · [Verification](selecta-flow-verification-matrix.md).
