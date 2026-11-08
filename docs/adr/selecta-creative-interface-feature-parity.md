# Selecta — creative-interface feature preservation map

**State:** Proposed, 140 tasks Not started, 0 independently Verified. The table names source capabilities that future creative polish must preserve; it is not current independent testing.

| CI ADR | Existing behaviour to preserve | Earlier ADR references | CI status |
|---|---|---|---|
| [ADR-165](adr-165-creative-interface-charter.md) | Listening-first hierarchy, explicit creative agency and no surprise playback | ADR-0114/0135/0164 | Proposed / Not started / Verified No |
| [ADR-166](adr-166-music-object-visual-grammar.md) | Real analysis, trustworthy artwork semantics, accessible token colors and seam identity | ADR-0136/0147/0150/0155 | Proposed / Not started / Verified No |
| [ADR-167](adr-167-creative-scene-continuity.md) | Stable routes, exact current/draft scope, keyboard focus, one persistent player | ADR-0139/0140/0159 | Proposed / Not started / Verified No |
| [ADR-168](adr-168-expressive-mix-selection-and-reveal.md) | Vibe suggestions, Play, Shape first, Save draft, replacement confirmation | ADR-0142/0117/0118 | Proposed / Not started / Verified No |
| [ADR-169](adr-169-energy-horizon-and-scoped-shaping.md) | Five-stop curve, global/default scope, precise inputs and honest achieved energy | ADR-0143/0111/0150 | Proposed / Not started / Verified No |
| [ADR-170](adr-170-listen-audio-clock-and-handoffs.md) | Real analyzer, transport, seek restrictions, handoff timing, quiet mode | ADR-0144/0145/0147 | Proposed / Not started / Verified No |
| [ADR-171](adr-171-lyrics-wordplay-and-stage.md) | Timed/untimed lyrics, Stage fallback, manual scroll and legibility | ADR-0146/0147/0155 | Proposed / Not started / Verified No |
| [ADR-172](adr-172-seam-inspector-and-audition-comparison.md) | Selected seam identity, requested/rendered distinction and legitimate preview | ADR-0151/0121/0101 | Proposed / Not started / Verified No |
| [ADR-173](adr-173-tactile-mix-editor-and-energy-overview.md) | Accessible song/seam order, locks, Undo and scoped revision | ADR-0150/0100/0120 | Proposed / Not started / Verified No |
| [ADR-174](adr-174-stem-studio-tangible-layers-and-diffs.md) | Eight lanes and exact Shape/Grid/List arrangement, solo, local recovery | ADR-0152/0122/0102 | Proposed / Not started / Verified No |
| [ADR-175](adr-175-requests-and-consented-route-visualization.md) | Request status, deliberate bridge approval and atomic join | ADR-0148/0124/0103 | Proposed / Not started / Verified No |
| [ADR-176](adr-176-lyric-harmonic-connection-explorer.md) | Word links, real four-stage harmonic audition, candidate ratings | ADR-0155/0125/0104 | Proposed / Not started / Verified No |
| [ADR-177](adr-177-musical-library-and-real-track-identity.md) | Scalable query/filter/sort, readiness, metadata correction, local media | ADR-0153/0154/0123 | Proposed / Not started / Verified No |
| [ADR-178](adr-178-first-run-library-awakening.md) | Local folder checks, LRCLIB notice and six ready-song threshold | ADR-0141/0126/0053 | Proposed / Not started / Verified No |
| [ADR-179](adr-179-my-mixes-drafts-and-render-line-presence.md) | Safe current/draft separation, queue priority and Undo | ADR-0149/0119/0099 | Proposed / Not started / Verified No |
| [ADR-180](adr-180-workspace-library-health-and-progress.md) | Analysis, folders, storage, learning, diagnostics and safe retry | ADR-0156/0128/0107 | Proposed / Not started / Verified No |
| [ADR-181](adr-181-export-frozen-revision-and-artifact.md) | Exact frozen FLAC, job lifecycle, reliable background output | ADR-0157/0127/0108 | Proposed / Not started / Verified No |
| [ADR-182](adr-182-causal-motion-and-microcopy.md) | Semantic motion, reduced-motion parity, focus and truthful status | ADR-0137/0138/0159/0163 | Proposed / Not started / Verified No |
| [ADR-183](adr-183-responsive-accessibility-and-performance.md) | 320–2560px, 400% zoom, keyboard/AT/touch, audio CPU priority | ADR-0160/0161/0162/0110 | Proposed / Not started / Verified No |
| [ADR-184](adr-184-research-status-and-release-governance.md) | Blind A/B neutrality, playback/privacy safety, rollback and independent evidence | ADR-0164/0133/0113/0158 | Proposed / Not started / Verified No |

## Non-negotiable cross-cutting contracts

Single audio owner and manual Pause; no original music alteration, truthful LRCLIB metadata disclosure, current-versus-draft and mix revision guards, reversible scoped Undo, real requested-versus-rendered seam state, consented atomic bridge joining, complete eight Stem Studio lanes and 8–64 cells, honest Library readiness and corrections, neutral blind listening comparisons, exact decodable frozen FLAC, existing routes/keyboard and dark/light/reduced-motion functionality.

Never substitute fake beat, waveform, quality score, lyrics timing, artwork, progress, rendered success or UI audio for real backend information. Compare implementation slices to [MI parity](selecta-microinteraction-feature-parity.md) and [experience parity](selecta-experience-feature-parity.md); preserve old code paths until actual UI/AT/audio testing passes.