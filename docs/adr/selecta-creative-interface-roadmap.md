# Selecta — creative-interface synthesis roadmap and 20 ADR index

**Documentation-only proposal (2026-11-08).** Baseline: main 4c2f9f03b8b7e185a7a5021979f4b443e40299dd, after merged PR #32. **20 Accepted decisions (owner approved 2026-11-08); 140 Not started tasks, 0 In progress, 0 Implemented; 0 independently Verified.** No source code, tests or assets changed in the original submission.

## Product direction and scope

Explore inspires, Create feels tactile and precise, Listen is immersive and calm. Song identity, seam, energy journey and requested route should be recognizable across screens and grounded in actual music. Preserve current local-first implementation. The earlier immersive ADR-0135–0164 programme has substantial already-implemented source-level work; this CI programme records NEW shared musical-object and human-outcome design deltas, not claims that prior work is absent.

## ADRs with decisions, implementation and verification status

| ADR / title | Phase | Priority | Decision | New implementation | Independently Verified | Earlier work |
|---|---|---|---|---|---|---|
| [ADR-0165](adr-0165-creative-interface-charter.md) — Creative-interface charter and attention modes | Foundation | P0 | Accepted | Not started (0/7) | No (0/7) | ADR-0114/0135/0164 |
| [ADR-0166](adr-0166-music-object-visual-grammar.md) — Shared song, seam, Energy Horizon and route visual grammar | Foundation | P0 | Accepted | Not started (0/7) | No (0/7) | ADR-0136/0147/0150/0155 |
| [ADR-0167](adr-0167-creative-scene-continuity.md) — Cross-scene continuity, contextual navigation and persistent context | Foundation | P0 | Accepted | Not started (0/7) | No (0/7) | ADR-0139/0140/0159 |
| [ADR-0168](adr-0168-expressive-mix-selection-and-reveal.md) — Make a Mix: expressive idea selection and honest result reveal | Explore | P0 | Accepted | Not started (0/7) | No (0/7) | ADR-0142/0117/0118 |
| [ADR-0169](adr-0169-energy-horizon-and-scoped-shaping.md) — Energy Horizon, tactile shaping and destination scope | Create | P0 | Accepted | Not started (0/7) | No (0/7) | ADR-0143/0111/0150 |
| [ADR-0170](adr-0170-listen-audio-clock-and-handoffs.md) — Listen: audio-clock musical scene, real spectrum and handoff | Listen | P0 | Accepted | Not started (0/7) | No (0/7) | ADR-0144/0145/0147 |
| [ADR-0171](adr-0171-lyrics-wordplay-and-stage.md) — Lyrics, authentic wordplay handoffs and fullscreen Stage | Listen | P1 | Accepted | Not started (0/7) | No (0/7) | ADR-0146/0147/0155 |
| [ADR-0172](adr-0172-seam-inspector-and-audition-comparison.md) — Transition Inspector: interpretive seam diagrams and honest A/B audition | Create | P0 | Accepted | Not started (0/7) | No (0/7) | ADR-0151/0121/0101 |
| [ADR-0173](adr-0173-tactile-mix-editor-and-energy-overview.md) — Arrangement timeline: tactile songs, seam edges and energy overview | Create | P0 | Accepted | Not started (0/7) | No (0/7) | ADR-0150/0100/0120 |
| [ADR-0174](adr-0174-stem-studio-tangible-layers-and-diffs.md) — Stem Studio: tactile layers, accurate playhead and human–Selecta differences | Create | P0 | Accepted | Not started (0/7) | No (0/7) | ADR-0152/0122/0102 |
| [ADR-0175](adr-0175-requests-and-consented-route-visualization.md) — Requests: visible musical routes, ghost placement and bridge consent | Engage | P0 | Accepted | Not started (0/7) | No (0/7) | ADR-0148/0124/0103 |
| [ADR-0176](adr-0176-lyric-harmonic-connection-explorer.md) — Musical discovery: phrase bridges and focused harmonic connection explorer | Explore | P1 | Accepted | Not started (0/7) | No (0/7) | ADR-0155/0125/0104 |
| [ADR-0177](adr-0177-musical-library-and-real-track-identity.md) — Library: expressive collection browsing and trustworthy track identity | Explore | P1 | Accepted | Not started (0/7) | No (0/7) | ADR-0153/0154/0123 |
| [ADR-0178](adr-0178-first-run-library-awakening.md) — Onboarding: honest library awakening and first audible DJ reward | Onboarding | P1 | Accepted | Not started (0/7) | No (0/7) | ADR-0141/0126/0053 |
| [ADR-0179](adr-0179-my-mixes-drafts-and-render-line-presence.md) — My Mixes: current-performance identity, drafts and real render line | Create | P1 | Accepted | Not started (0/7) | No (0/7) | ADR-0149/0119/0099 |
| [ADR-0180](adr-0180-workspace-library-health-and-progress.md) — Workspace: library health, truthful processing and operational calm | Operate | P1 | Accepted | Not started (0/7) | No (0/7) | ADR-0156/0128/0107 |
| [ADR-0181](adr-0181-export-frozen-revision-and-artifact.md) — Export: frozen mix revision, real preparation and finished artifact | Operate | P1 | Accepted | Not started (0/7) | No (0/7) | ADR-0157/0127/0108 |
| [ADR-0182](adr-0182-causal-motion-and-microcopy.md) — Unified microinteraction vocabulary, semantic feedback and musical copy | Foundation | P0 | Accepted | Not started (0/7) | No (0/7) | ADR-0137/0138/0159/0163 |
| [ADR-0183](adr-0183-responsive-accessibility-and-performance.md) — Responsive sensory design, keyboard parity and audio performance | Quality | P0 | Accepted | Not started (0/7) | No (0/7) | ADR-0160/0161/0162/0110 |
| [ADR-0184](adr-0184-research-status-and-release-governance.md) — Incremental implementation, evidence, neutrality and release gates | Quality | P0 | Accepted | Not started (0/7) | No (0/7) | ADR-0164/0133/0113/0158 |

## Dependency-ordered delivery plan

**Gate 0 — baseline, owner acceptance and old MI reconciliation:** 0165 and 0184. All 20 decisions were accepted by the owner on 2026-11-08; proceed in scoped workstreams.
**Gate 1 — coherent visual language:** 0166, 0167, 0182 and 0183. Specify real song/seam/energy/route data, state, focus and a reduced-motion equivalent.
**Gate 2 — first value and set creation:** 0178, 0168, 0169 and 0179. Introduce authentic onboarding, mood choice, Energy Horizon and preserved draft identity.
**Gate 3 — sound and musical handoff:** 0170 and 0171. Only actual analyser, playback clock and valid lyric timings drive the show.
**Gate 4 — composition and precision:** 0172, 0173 and 0174. Use truthful seam diagrams, edit interactions, Studio layers and returned AI diffs; A/B compare requires real immutable audio candidates.
**Gate 5 — requests and discovery:** 0175, 0176 and 0177. Make actual song paths and links visible, keeping bridge consent, audio focus, library search and source safety.
**Gate 6 — operations and output:** 0180 and 0181. Honest background pipeline and frozen decodable FLAC.
**Gate 7 — independent release acceptance:** 0183 and 0184. Named human/AT/touch/real-audio/performance review and old→new→old rollback.

## Status lifecycle

Decision Proposed → Accepted or Rejected/Superseded by dated owner action. Implementation Not started → In progress with named PR → Implemented after merged source and tests. Independently Verified No → Yes only after exact-SHA human, accessibility, audio and performance evidence as applicable. Merging the ADR PR does not tick any box. Prior MI code (historically 208 Implemented / 4 In progress / 28 Not started, 0 independently Verified in its own ledger) is not new CI completion.

## Planning artifacts

[140-task checklist](selecta-creative-interface-implementation-checklist.md) · [Evidence ledger](selecta-creative-interface-implementation-evidence.md) · [Parity](selecta-creative-interface-feature-parity.md) · [Interaction matrix](selecta-creative-interface-interaction-matrix.md) · [Verification matrix](selecta-creative-interface-verification-matrix.md) · [Reconciliation](selecta-creative-interface-status-reconciliation.md) · [NO-GO gates](selecta-creative-interface-release-gates.md).