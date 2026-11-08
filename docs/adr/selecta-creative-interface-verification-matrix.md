# Selecta — creative-interface independent verification matrix

**Status: 20 Accepted ADRs; 140 CI tasks Not started; 0 Implemented; 0 independently Verified.** This matrix defines future acceptance, not performed testing.

| ADR | Independent review focus | Implementation | Verified |
|---|---|---|---|
| [ADR-0165](adr-0165-creative-interface-charter.md) | creative modes, first value and attention focus | Not started (0/7) | No (0/7) |
| [ADR-0166](adr-0166-music-object-visual-grammar.md) | four honest musical visual objects across scales | Not started (0/7) | No (0/7) |
| [ADR-0167](adr-0167-creative-scene-continuity.md) | route/selection continuity, focus and audio | Not started (0/7) | No (0/7) |
| [ADR-0168](adr-0168-expressive-mix-selection-and-reveal.md) | vibe cards and confirmed generation | Not started (0/7) | No (0/7) |
| [ADR-0169](adr-0169-energy-horizon-and-scoped-shaping.md) | energy drawing, presets, scope and destination | Not started (0/7) | No (0/7) |
| [ADR-0170](adr-0170-listen-audio-clock-and-handoffs.md) | audio-clock Listen, spectrum and handoff | Not started (0/7) | No (0/7) |
| [ADR-0171](adr-0171-lyrics-wordplay-and-stage.md) | lyrics confidence, wordplay and Stage | Not started (0/7) | No (0/7) |
| [ADR-0172](adr-0172-seam-inspector-and-audition-comparison.md) | seam technique truth, previews and A/B capability gate | Not started (0/7) | No (0/7) |
| [ADR-0173](adr-0173-tactile-mix-editor-and-energy-overview.md) | tactile song/seam ordering and energy overview | Not started (0/7) | No (0/7) |
| [ADR-0174](adr-0174-stem-studio-tangible-layers-and-diffs.md) | eight-lane Studio, AI diff and real preview | Not started (0/7) | No (0/7) |
| [ADR-0175](adr-0175-requests-and-consented-route-visualization.md) | consented bridge paths and request status | Not started (0/7) | No (0/7) |
| [ADR-0176](adr-0176-lyric-harmonic-connection-explorer.md) | word/harmonic links and real listening stages | Not started (0/7) | No (0/7) |
| [ADR-0177](adr-0177-musical-library-and-real-track-identity.md) | large Library, readiness and corrections | Not started (0/7) | No (0/7) |
| [ADR-0178](adr-0178-first-run-library-awakening.md) | folder privacy and first audible handoff | Not started (0/7) | No (0/7) |
| [ADR-0179](adr-0179-my-mixes-drafts-and-render-line-presence.md) | current/draft identity and render line | Not started (0/7) | No (0/7) |
| [ADR-0180](adr-0180-workspace-library-health-and-progress.md) | Workspace progress/storage/recovery | Not started (0/7) | No (0/7) |
| [ADR-0181](adr-0181-export-frozen-revision-and-artifact.md) | frozen FLAC and job completion | Not started (0/7) | No (0/7) |
| [ADR-0182](adr-0182-causal-motion-and-microcopy.md) | semantic press/pending/Undo/microcopy | Not started (0/7) | No (0/7) |
| [ADR-0183](adr-0183-responsive-accessibility-and-performance.md) | zoom/touch/AT/reduced-motion and real DSP load | Not started (0/7) | No (0/7) |
| [ADR-0184](adr-0184-research-status-and-release-governance.md) | release evidence, neutral studies and rollback | Not started (0/7) | No (0/7) |

## Required test dimensions

- **Themes and responsive:** light, dark, system, forced colors; 320/375/430/768/1024/1440/1920/2560px; 200%/400% zoom, long/RTL/emoji text, unknown data.
- **Human access:** mouse, coarse touch, stylus for curve, keyboard-only, NVDA/Edge, screen-reader announcements, fullscreen refusal, mobile soft keyboard, focus return.
- **Motion and music:** normal/reduced motion, quiet/standard/focused; real audio analyzer, known vs unknown beat/lyrics timing, handoff, blocked seek, paused/hidden tab, preview audio focus.
- **Operational errors:** offline/reconnect, stale request, failed render, canceled task, missing music folder, Undo conflict, duplicate click, missing export and cross-tab audio.
- **Safety:** original files unchanged, disclosed LRCLIB metadata, current/draft revision and pair keys, explicit atomic bridge approval, eight-lane Studio recovery, exact frozen FLAC and neutral blind A/B study.
- **Performance:** measured named CPU/GPU/browser/OS with actual playback during analysis/render; frame/long-task/input and audible dropout evidence, not guessed budgets.
- **Human evaluation:** uncoached first mix, shaping, preview, Studio, request, discovery, export and recovery. Record participant denominator, completion, hesitation, confusion, delight and sensory comfort.

## Independent acceptance protocol

A docs PR, screenshot baseline candidate, synthetic muted end-to-end test or source-level implementation checkbox never establishes Verified Yes. An independent reviewer records exact tested SHA, dated results, real auditory assessment as applicable, accessibility and device evidence. Blind A/B experiments keep identical visual treatment to prevent bias. Per-task acceptance is in [checklist](selecta-creative-interface-implementation-checklist.md); record results in [evidence](selecta-creative-interface-implementation-evidence.md) and resolve [NO-GO gates](selecta-creative-interface-release-gates.md) before release.

**Current Verified Yes: 0 of 140.**