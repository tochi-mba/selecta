# Selecta 3.0 - feature parity ownership and old/new comparison

- **Decision:** Accepted. **Implementation:** Not started.
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
