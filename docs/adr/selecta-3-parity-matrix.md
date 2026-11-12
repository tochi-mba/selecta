# Selecta 3.0 - feature parity ownership and old/new comparison

- **Decision:** Accepted. **Implementation (2026-11-12):** In progress; 221 of 258 S3 tasks ticked with automated evidence, 0 independently Verified (see [the checklist](selecta-3-implementation-checklist.md)).
- **All rows:** Planned mappings, not verified behavior. Historical [feature-parity](feature-parity.md) remains authoritative for the existing product.
- **Scope:** No source audio, data, algorithm, study protocol or behavior is allowed to disappear for visual simplicity.

## Existing feature → proposed ADR owner

| Existing capability | New ADRs | Must verify |
|---|---|---|
| Import music, watchers and analysis queue | [0047](adr-0047-overhaul-charter-and-governance.md), [0053](adr-0053-first-run-sources-and-readiness.md), [0064](adr-0064-workspace-operations-sources-storage.md), [0072](adr-0072-local-privacy-pwa-security.md) | Permission, restart, safe path and readiness threshold |
| Sixteen presets and Selecta pick | [0054](adr-0054-explore-mix-discovery-and-steering.md), [0052](adr-0052-truthful-async-and-state-contracts.md) | Unavailable reasons, Play, draft and replacement |
| Duration, transition feel, stem frequency, curve, destination | [0054](adr-0054-explore-mix-discovery-and-steering.md), [0070](adr-0070-content-explanations-feedback-and-motion.md) | Saved settings, scale honesty and stale search |
| Gapless Web Audio, seek, media keys, previews | [0049](adr-0049-responsive-shell-player-and-stage.md), [0055](adr-0055-listen-lyrics-waveform-and-stage.md), [0069](adr-0069-single-audio-owner-and-playback-lifecycle.md) | Actual audible timing and ownership |
| Lyrics line/word, section waveform, spectrum, Stage | [0055](adr-0055-listen-lyrics-waveform-and-stage.md), [0073](adr-0073-performance-profiling-and-visual-budget.md) | Fallbacks, fullscreen and reduced motion |
| Global mini-player, shell, shortcuts, Undo, routes | [0048](adr-0048-intent-based-navigation-and-deep-links.md), [0049](adr-0049-responsive-shell-player-and-stage.md), [0051](adr-0051-accessible-components-overlays-and-undo.md), [0068](adr-0068-keyboard-command-palette-and-power-flows.md) | No player overlap, hidden focus or restart |
| Next-up Bigger/Calmer/Something else | [0055](adr-0055-listen-lyrics-waveform-and-stage.md), [0070](adr-0070-content-explanations-feedback-and-motion.md) | Accurate planner response and failure |
| Concurrent Requests, cancellation, live ghost rows | [0060](adr-0060-request-scheduling-bridge-consent.md), [0052](adr-0052-truthful-async-and-state-contracts.md) | Pending/confirmed state, idempotency |
| Bridge choices, consent, atomic joining and Play anyway | [0060](adr-0060-request-scheduling-bridge-consent.md), [0069](adr-0069-single-audio-owner-and-playback-lifecycle.md) | No duplicate or partial route |
| Edit insertion, ranking, analysis, reorder, lock, removal | [0057](adr-0057-editor-song-seam-timeline.md), [0058](adr-0058-transition-inspector-cues-and-previews.md) | Correct stable IDs and scoped Undo |
| Seam phrase, style, cue, bar length, preview/rating/fallback | [0058](adr-0058-transition-inspector-cues-and-previews.md), [0069](adr-0069-single-audio-owner-and-playback-lifecycle.md) | Manual intent versus actual render |
| Stem Studio 64 cells, solo, shapes, AI and Apply | [0059](adr-0059-stem-studio-creative-grid.md), [0067](adr-0067-wcag-responsive-and-human-access.md) | Grid keyboard, audio focus, revision |
| Draft save, rename, duplicate, restore, priority, swap | [0056](adr-0056-my-mixes-drafts-and-render-line.md), [0052](adr-0052-truthful-async-and-state-contracts.md) | Persisted scope, queue and Undo |
| Library filters, search, pagination, readiness and actions | [0062](adr-0062-scalable-library-browse-search-filters.md), [0063](adr-0063-library-track-details-corrections.md) | 20k, partial analysis, overrides |
| BPM/key corrections, Half/Double, exclude and sources | [0063](adr-0063-library-track-details-corrections.md), [0064](adr-0064-workspace-operations-sources-storage.md) | Reanalysis does not erase corrections |
| Word links, previews, feedback and pair addition | [0061](adr-0061-discovery-word-and-harmonic-workflows.md), [0060](adr-0060-request-scheduling-bridge-consent.md) | Atomic insertion and target |
| Harmonic four-stage audition and judgments | [0061](adr-0061-discovery-word-and-harmonic-workflows.md), [0066](adr-0066-blind-listening-study-integrity.md) | Audio focus and verdict recovery |
| Storage budget, analysis, watchers, learning, diagnostics | [0064](adr-0064-workspace-operations-sources-storage.md), [0072](adr-0072-local-privacy-pwa-security.md) | Failure, cache protection and privacy |
| Blind A/B study sessions, grading, choices, retry | [0066](adr-0066-blind-listening-study-integrity.md), [0074](adr-0074-testing-matrix-contract-and-races.md) | Blinding, no duplicate responses |
| Real FLAC export and final download | [0065](adr-0065-export-jobs-and-revision-identity.md), [0071](adr-0071-api-route-schema-compatibility.md) | Revision-accurate decodable FLAC |
| Security, localhost, LRCLIB and installed PWA | [0072](adr-0072-local-privacy-pwa-security.md), [0071](adr-0071-api-route-schema-compatibility.md) | No arbitrary path or remote transfer |
| A11y, responsive, performance, tests and rollback | [0067](adr-0067-wcag-responsive-and-human-access.md), [0073](adr-0073-performance-profiling-and-visual-budget.md), [0074](adr-0074-testing-matrix-contract-and-races.md), [0075](adr-0075-visual-research-evidence-and-release-gates.md), [0076](adr-0076-incremental-migration-rollback-and-go-no-go.md) | Human/automated gates |

## Unverified T and P tasks -> S3 decisions

S3-0047-02. Every T task ([Selecta 2.0](implementation-checklist.md)) and P task ([UI/UX polish](polish-implementation-checklist.md)) that was still unchecked on 2026-11-10 is listed against the S3 decisions that now own its outcome. This is a mapping only: it completes nothing. Each task keeps its own checkbox, wording and evidence in its own checklist, and an S3 item is never ticked because an older task maps to it (or the reverse), so no completion is claimed twice. tests/test_s3_parity_task_map.py keeps every still-unchecked T and P task listed here under its own section.

| Programme | Older section | Unverified tasks (2026-11-10) | S3 decisions |
|---|---|---|---|
| T | ADR-0001 Product contract and parity | T0001, T0003, T0004, T0005, T0007 | [0047](adr-0047-overhaul-charter-and-governance.md) |
| T | ADR-0029 Baseline and test architecture | T0008, T0009, T0010, T0012, T0013, T0014, T0017 | [0074](adr-0074-testing-matrix-contract-and-races.md), [0075](adr-0075-visual-research-evidence-and-release-gates.md) |
| T | ADR-0030 Migration strategy | T0018, T0021, T0022 | [0076](adr-0076-incremental-migration-rollback-and-go-no-go.md) |
| T | ADR-0003 Semantic visual language | T0023, T0026, T0028, T0029 | [0050](adr-0050-brand-tokens-type-and-density.md) |
| T | ADR-0004 Accessible shared components and feedback | T0030, T0037 | [0051](adr-0051-accessible-components-overlays-and-undo.md) |
| T | ADR-0023 Accessibility foundation | T0038, T0043, T0044, T0045 | [0067](adr-0067-wcag-responsive-and-human-access.md) |
| T | ADR-0002 Routing and persistent app shell | T0053 | [0048](adr-0048-intent-based-navigation-and-deep-links.md), [0049](adr-0049-responsive-shell-player-and-stage.md) |
| T | ADR-0024 Responsive complex workspaces | T0059, T0060 | [0049](adr-0049-responsive-shell-player-and-stage.md), [0067](adr-0067-wcag-responsive-and-human-access.md) |
| T | ADR-0031 Installed PWA and browser support | T0061, T0062, T0065, T0066 | [0072](adr-0072-local-privacy-pwa-security.md) |
| T | ADR-0005 Typed frontend state and mutations | T0068, T0074 | [0052](adr-0052-truthful-async-and-state-contracts.md) |
| T | ADR-0026 Additive backend API evolution | T0075, T0083 | [0071](adr-0071-api-route-schema-compatibility.md) |
| T | ADR-0025 Local-first security | T0091 | [0072](adr-0072-local-privacy-pwa-security.md) |
| T | ADR-0028 Resilience and multi-tab ownership | T0094, T0096, T0097, T0098 | [0052](adr-0052-truthful-async-and-state-contracts.md), [0069](adr-0069-single-audio-owner-and-playback-lifecycle.md) |
| T | ADR-0006 Web Audio transport and conventional controls | T0105, T0106 | [0049](adr-0049-responsive-shell-player-and-stage.md), [0069](adr-0069-single-audio-owner-and-playback-lifecycle.md) |
| T | ADR-0007 Cross-feature audio focus | T0112, T0113 | [0069](adr-0069-single-audio-owner-and-playback-lifecycle.md) |
| T | ADR-0008 Listen experience | T0121, T0122 | [0055](adr-0055-listen-lyrics-waveform-and-stage.md) |
| T | ADR-0009 Lyrics and Stage | T0128, T0129 | [0055](adr-0055-listen-lyrics-waveform-and-stage.md) |
| T | ADR-0027 Explanations and feedback | T0135, T0136 | [0070](adr-0070-content-explanations-feedback-and-motion.md) |
| T | ADR-0010 Mix discovery and building | T0143, T0144 | [0054](adr-0054-explore-mix-discovery-and-steering.md) |
| T | ADR-0011 Energy arc and setting scope | T0151, T0152 | [0054](adr-0054-explore-mix-discovery-and-steering.md) |
| T | ADR-0012 Drafts and render queue | T0160 | [0056](adr-0056-my-mixes-drafts-and-render-line.md) |
| T | ADR-0013 Edit timeline and scoped actions | T0167, T0168 | [0057](adr-0057-editor-song-seam-timeline.md) |
| T | ADR-0014 Seam inspector and render truth | T0175, T0176 | [0058](adr-0058-transition-inspector-cues-and-previews.md) |
| T | ADR-0022 FLAC export | T0181, T0182 | [0065](adr-0065-export-jobs-and-revision-identity.md) |
| T | ADR-0015 Live Requests and bridge atomicity | T0192, T0193 | [0060](adr-0060-request-scheduling-bridge-consent.md) |
| T | ADR-0016 Stem Studio | T0196, T0201, T0202 | [0059](adr-0059-stem-studio-creative-grid.md) |
| T | ADR-0017 Library readiness and scale | T0210 | [0062](adr-0062-scalable-library-browse-search-filters.md) |
| T | ADR-0018 Metadata corrections and local sources | T0216, T0217, T0218 | [0063](adr-0063-library-track-details-corrections.md), [0064](adr-0064-workspace-operations-sources-storage.md) |
| T | ADR-0019 Word and harmonic Discover | T0225, T0226 | [0061](adr-0061-discovery-word-and-harmonic-workflows.md) |
| T | ADR-0020 Workshop and cache/processing | T0233, T0234 | [0064](adr-0064-workspace-operations-sources-storage.md) |
| T | ADR-0021 Blind listening studies | T0241, T0242 | [0066](adr-0066-blind-listening-study-integrity.md) |
| T | ADR-0032 Local diagnostics and operation tracing | T0244, T0248, T0249 | [0064](adr-0064-workspace-operations-sources-storage.md) |
| T | Cross-feature integration scenarios | T0251, T0252, T0253, T0255, T0256, T0258 | [0074](adr-0074-testing-matrix-contract-and-races.md) |
| T | Full quality and acceptance gates | T0261, T0262, T0263, T0264, T0265, T0266, T0267, T0269 | [0067](adr-0067-wcag-responsive-and-human-access.md), [0073](adr-0073-performance-profiling-and-visual-budget.md), [0074](adr-0074-testing-matrix-contract-and-races.md), [0075](adr-0075-visual-research-evidence-and-release-gates.md) |
| T | Controlled release and rollback | T0273, T0274, T0275, T0276, T0277, T0278, T0279 | [0076](adr-0076-incremental-migration-rollback-and-go-no-go.md) |
| P | ADR-0033 Polish baseline, complete state inventory and evidence governance | P0004, P0005, P0007, P0009, P0010 | [0047](adr-0047-overhaul-charter-and-governance.md), [0075](adr-0075-visual-research-evidence-and-release-gates.md) |
| P | ADR-0034 Precise visual foundations, typography and coherent iconography | P0019 | [0050](adr-0050-brand-tokens-type-and-density.md) |
| P | ADR-0035 Complete shared control states, overlays and recoverable feedback | P0022, P0027, P0031 | [0051](adr-0051-accessible-components-overlays-and-undo.md) |
| P | ADR-0036 Content-shaped skeletons and truthful asynchronous state transitions | P0032, P0033, P0034, P0035, P0036, P0037, P0038, P0042, P0043 | [0052](adr-0052-truthful-async-and-state-contracts.md) |
| P | ADR-0037 First-run setup, truthful readiness and local privacy explanations | P0050, P0051 | [0053](adr-0053-first-run-sources-and-readiness.md) |
| P | ADR-0038 Mix browsing, creation defaults and unmistakable draft scope | P0052, P0053, P0054, P0055, P0056, P0057, P0058, P0059, P0060 | [0054](adr-0054-explore-mix-discovery-and-steering.md), [0056](adr-0056-my-mixes-drafts-and-render-line.md) |
| P | ADR-0039 Calm listening hierarchy, stable transport and shell continuity | P0061, P0062, P0063, P0064, P0065, P0066, P0067, P0068, P0069 | [0049](adr-0049-responsive-shell-player-and-stage.md), [0055](adr-0055-listen-lyrics-waveform-and-stage.md) |
| P | ADR-0042 Understandable requests, explicit bridge consent and auditionable discovery | P0089, P0090, P0091, P0092, P0093, P0094, P0095, P0096, P0097, P0098, P0099 | [0060](adr-0060-request-scheduling-bridge-consent.md), [0061](adr-0061-discovery-word-and-harmonic-workflows.md) |
| P | ADR-0040 Precise editing timeline and context-preserving transition inspector | P0070, P0071, P0072, P0073, P0074, P0078, P0079 | [0057](adr-0057-editor-song-seam-timeline.md), [0058](adr-0058-transition-inspector-cues-and-previews.md) |
| P | ADR-0041 Readable Stem Studio grid, audition ownership and explicit commit state | P0080, P0081, P0082, P0083, P0084, P0085, P0086, P0087, P0088 | [0059](adr-0059-stem-studio-creative-grid.md) |
| P | ADR-0043 Scannable Library, actionable Workshop and polished export/study flows | P0100, P0101, P0102, P0103, P0104, P0105, P0106, P0107, P0108, P0109, P0110, P0111 | [0062](adr-0062-scalable-library-browse-search-filters.md), [0063](adr-0063-library-track-details-corrections.md), [0064](adr-0064-workspace-operations-sources-storage.md), [0065](adr-0065-export-jobs-and-revision-identity.md), [0066](adr-0066-blind-listening-study-integrity.md) |
| P | ADR-0045 Responsive workspace finish and complete accessible task journeys | P0121, P0122, P0123, P0124, P0125, P0126, P0127, P0128, P0129, P0130, P0131 | [0067](adr-0067-wcag-responsive-and-human-access.md) |
| P | ADR-0046 Visual regression, performance, listening and polish release gates | P0132, P0133, P0134, P0135, P0136, P0137, P0138, P0139, P0140, P0141, P0142, P0143 | [0073](adr-0073-performance-profiling-and-visual-budget.md), [0075](adr-0075-visual-research-evidence-and-release-gates.md), [0076](adr-0076-incremental-migration-rollback-and-go-no-go.md) |

## Exact comparison protocol

1. Pin a baseline build and fixture, then record the old task steps and resulting frontend, backend, audio and persistent data state.
2. Use the redesigned surface with equivalent user inputs. Compare selection, exact mix/draft identity, operation revisions, readiness, audio ownership, render output, persisted settings and export.
3. Verify new labels and routes map to existing capabilities; original URLs still work. A new navigation label is not permission to drop a hidden feature.
4. Run negative states (stale response, offline, duplicate submission, insufficient readiness, permission denied), not just successful paths.
5. Preserve existing outcome-based assertions after changing selectors or component names.
6. Compare manual keyboard, assistive-tech task and audible results before design acceptance, not after shipping.
7. Link actual implementation evidence before promoting a parity row beyond **Not started**.

## Critical integrated scenarios

- Current A plays; draft B is reordered; current A gets a request; draft B renders a seam; return to A and Undo. Nothing in B changes A.
- Competing requests propose a multi-song bridge; one route is canceled, another approved; one seam fails; late poll arrives. No duplicate, canceled, unapproved or partial insertion.
- Choose a manual cue/style, render, then change intent before the old render returns. The UI preserves the new intent and names the actual audio used.
- Studio opens on pair P; audition, solo, navigate, explicitly pause main audio, recover shape, commit after P reordered. No unintended resume or wrong pair.
- Export draft B, reorder/replace its track list while encoding; output is the exact snapshot or correctly invalidated.
- Correct tempo/key; background reanalysis completes; effective manual override remains and derived readiness is accurate.
- Stop backend during Request/Library/export/storage action; never fabricate empty/success, reconcile before retry.
