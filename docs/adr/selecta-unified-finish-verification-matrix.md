# Selecta — UF independent verification matrix

**Status:** 24 Accepted ADRs (0366–0389); 170 UF tasks Not started; 22 In progress; 0 Implemented; 0 independently Verified. Requester accepted all UF ADRs on 2026-11-08. PR #41 includes code/tests and per-task source evidence; separate human/device/sound acceptance is outstanding. Baseline main `f17944530d54203e49baebdabc08a57ee9f40526` (2026-11-08).

These are planned verification requirements. No independent checks or sign-offs have yet happened under UF.

| ADR | Future independent proof | First risk cases |
|---|---|---|
| [ADR-0366](adr-0366-unified-finish-charter-and-parity.md) | Compare source, build and capture manifest.; Independent ADR link and owner audit.; Sample current source and related evidence. | Prioritise by critical risk; Approve unified charter |
| [ADR-0367](adr-0367-task-research-and-measurement.md) | Research protocol review.; Dry-run neutral task scripts.; Original app session record. | Track friction to implementation; Gate research conclusions |
| [ADR-0368](adr-0368-design-tokens-and-css-ownership.md) | Computed-style inventory.; Static token and reference audit.; Before/after owner critique. | Document new CSS rules; Approve cascade regression proof |
| [ADR-0369](adr-0369-typography-music-artwork-and-density.md) | Full-screen typographic review.; Text fixture and AT reading.; Breakpoint geometry snapshots. | Protect compact-mode functionality; Verify theme image/text balance |
| [ADR-0370](adr-0370-shared-controls-overlays-and-feedback.md) | Component gallery audit.; Screen task/hierarchy critique.; Slow-network E2E. | Protect scoped Undo; Approve complete component states |
| [ADR-0371](adr-0371-truthful-loading-recovery-and-async-state.md) | Cross-route state matrix.; Delayed-load browser test.; Variable-workload fixture. | Keep live feedback calm; Preserve layout and focus |
| [ADR-0372](adr-0372-navigation-onboarding-and-returning-context.md) | Uncoached route selection.; Router regression.; Setup walkthrough. | Remove shell occlusion; Keep focus navigation obvious |
| [ADR-0373](adr-0373-persistent-player-and-audio-focus.md) | Real player and multitab test.; Same-state cross-route fixture.; Seek edge fixtures. | Keep fixed chrome reachable; Explain output interruptions |
| [ADR-0374](adr-0374-listening-hierarchy-lyrics-and-handoffs.md) | Five-second recall task.; Real music + no-lyrics fixture.; Responsive text test. | Reduce optional panel competition; Test passive and active listening |
| [ADR-0375](adr-0375-visualizer-stage-and-sensory-motion.md) | Style list regression.; Known frequency/silence fixture.; Preference-switch task. | Keep Stage usable; Measure frame and energy costs |
| [ADR-0376](adr-0376-make-a-mix-quick-play-and-intent.md) | LX parity review.; Uncoached first use.; Replacement fixture. | Handle insufficient ready songs; Check responsive card actions |
| [ADR-0377](adr-0377-library-experience-integration-and-proof.md) | Owner/parity decision audit.; Duplicate-title fixture.; Route-state test. | Ensure inspector and player parity; Record real integration deltas |
| [ADR-0378](adr-0378-lucy-creation-integration-and-proof.md) | LU/LX source parity sign-off.; Scoped prompt and route test.; Uncoached action-prediction study. | Retain conversation continuity; Keep approval audio deliberate |
| [ADR-0379](adr-0379-my-mixes-drafts-render-line.md) | Same-name draft comprehension test.; Action order task study.; Job queue fixture. | Keep large draft collections usable; Design empty My Mixes path |
| [ADR-0380](adr-0380-editor-arrangement-and-song-seam-identity.md) | Mode-toggle equality E2E.; Repeated-song and AT fixture.; Keyboard/pointer reorder test. | Show undo and save provenance; Measure lengthy mix editing |
| [ADR-0381](adr-0381-seam-inspector-audition-and-explanation.md) | Duplicate-song fixture.; Real preview test.; Fallback/ready matrix. | Preserve Studio handoff; Validate tab and drawer navigation |
| [ADR-0382](adr-0382-stem-studio-musical-canvas.md) | Mode equivalence test.; Timing fixture.; Keyboard/forced-colour screenshots. | Protect unapplied departure; Verify keyboard manipulation |
| [ADR-0383](adr-0383-requests-bridges-and-consent.md) | Stage matrix.; Bridge comprehension test.; Consent integration. | Keep audition audio safe; Preserve responsive drawer access |
| [ADR-0384](adr-0384-discovery-word-and-harmonic-gallery.md) | Discovery state test.; Novice/expert explanation walkthrough.; Missing-audio fixture. | Preserve pair scroll and identity; Use accessible connection imagery |
| [ADR-0385](adr-0385-workspace-operations-storage-and-recovery.md) | Task triage review.; Interrupt/resume test.; Folder missing/return fixture. | Guard staged restore; Keep interface settings isolated |
| [ADR-0386](adr-0386-exports-frozen-revisions-and-listening-study.md) | Edit-during-export test.; Missing seam fixture.; Slow/failed export test. | Keep study methods blinded; Treat missing ratings as missing |
| [ADR-0387](adr-0387-responsive-reflow-and-input-adaptation.md) | Computed geometry and screenshots.; WCAG reflow check.; Occlusion/focus test. | Preserve scroll under updates; Compare route feature parity |
| [ADR-0388](adr-0388-accessibility-language-and-motion-acceptance.md) | Accessibility tree and human review.; Physical keyboard/NVDA/VoiceOver.; Independent criteria checklist. | Prevent announcement overload; Require real AT journey success |
| [ADR-0389](adr-0389-independent-visual-usability-and-release-gates.md) | Signed screenshot manifest.; Independent platform report.; Benchmark report. | Keep per-task status provenance; Require documented release verdict |

## Whole-application test evidence

| Axis | Fixture/device requirement | Pass evidence |
|---|---|---|
| Route coverage | Listen, Make a Mix, My Mixes, Library/Details, Lucy, Editor/Inspector/Studio, Requests, word/harmonic discovery, Workspace, Export and study | Screen and task manifest |
| Visual | Same fixture/route/state/revision/viewport in Light and Dark, System + forced colour exceptions | Reviewed paired screenshots, computed geometry, approved baseline |
| Responsive | 320,375,620,760,768,1024,1280,1440,1920,3840px; short landscape; keyboard inset; 200/400% zoom | No obscured focus/critical actions or unexpected scroll |
| Accessibility | Physical keyboard, NVDA, VoiceOver/TalkBack where relevant, WCAG 2.2 AA, dragging alternatives, semantics | Named independent AT and criteria report |
| Real audio | Preview focus, current music, actual rendered seams/lyrics, Stage and Studio, frozen FLAC | Dated audible and decoder results on named setup |
| Async/recovery | No-ready, stale, offline, failed, cancelled, lost reply, evicted seam, external drive gone, multitab | Expected UI and atomic state traces |
| Load/performance | 20k Library, 40+ editor, long Lucy transcript, all live visualiser styles on named device | Recorded timing/CPU/interaction budgets |
| User comprehension | Uncoached novice/expert completion, confidence, errors and lifecycle prediction | Sample counts and observed task results |

**References:** [WCAG 2.2](https://www.w3.org/TR/WCAG22/) · [ARIA APG](https://www.w3.org/WAI/ARIA/apg/patterns/) · [Playwright screenshot testing](https://playwright.dev/docs/test-snapshots) · [web.dev Web Vitals](https://web.dev/articles/vitals) · [Microsoft Human-AI Guidelines](https://www.microsoft.com/en-us/research/publication/guidelines-for-human-ai-interaction/).

A candidate screenshot, axe scan or muted Playwright pass is not a human-approved visual, independent accessibility or sound-quality review. Source status and independent acceptance remain distinct.

[Roadmap](selecta-unified-finish-roadmap.md) · [192-task checklist](selecta-unified-finish-implementation-checklist.md) · [evidence ledger](selecta-unified-finish-implementation-evidence.md) · [status JSON](selecta-unified-finish-code-status.json) · [overlap/parity](selecta-unified-finish-overlap-and-parity.md) · [experience contract](selecta-unified-finish-experience-contract.md) · [verification matrix](selecta-unified-finish-verification-matrix.md) · [status reconciliation](selecta-unified-finish-status-reconciliation.md) · [release gates](selecta-unified-finish-release-gates.md)
