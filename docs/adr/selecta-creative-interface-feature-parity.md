# Selecta - creative-interface feature preservation map

**State:** Accepted (owner approved 2026-11-08), 140 tasks Not started, 0 independently Verified. The table names source capabilities that future creative polish must preserve; it is not current independent testing.

| CI ADR | Existing behaviour to preserve | Earlier ADR references | CI status |
|---|---|---|---|
| [ADR-0165](adr-0165-creative-interface-charter.md) | Listening-first hierarchy, explicit creative agency and no surprise playback | ADR-0114/0135/0164 | Accepted / Not started / Verified No |
| [ADR-0166](adr-0166-music-object-visual-grammar.md) | Real analysis, trustworthy artwork semantics, accessible token colors and seam identity | ADR-0136/0147/0150/0155 | Accepted / Not started / Verified No |
| [ADR-0167](adr-0167-creative-scene-continuity.md) | Stable routes, exact current/draft scope, keyboard focus, one persistent player | ADR-0139/0140/0159 | Accepted / Not started / Verified No |
| [ADR-0168](adr-0168-expressive-mix-selection-and-reveal.md) | Vibe suggestions, Play, Shape first, Save draft, replacement confirmation | ADR-0142/0117/0118 | Accepted / Not started / Verified No |
| [ADR-0169](adr-0169-energy-horizon-and-scoped-shaping.md) | Five-stop curve, global/default scope, precise inputs and honest achieved energy | ADR-0143/0111/0150 | Accepted / Not started / Verified No |
| [ADR-0170](adr-0170-listen-audio-clock-and-handoffs.md) | Real analyzer, transport, seek restrictions, handoff timing, quiet mode | ADR-0144/0145/0147 | Accepted / Not started / Verified No |
| [ADR-0171](adr-0171-lyrics-wordplay-and-stage.md) | Timed/untimed lyrics, Stage fallback, manual scroll and legibility | ADR-0146/0147/0155 | Accepted / Not started / Verified No |
| [ADR-0172](adr-0172-seam-inspector-and-audition-comparison.md) | Selected seam identity, requested/rendered distinction and legitimate preview | ADR-0151/0121/0101 | Accepted / Not started / Verified No |
| [ADR-0173](adr-0173-tactile-mix-editor-and-energy-overview.md) | Accessible song/seam order, locks, Undo and scoped revision | ADR-0150/0100/0120 | Accepted / Not started / Verified No |
| [ADR-0174](adr-0174-stem-studio-tangible-layers-and-diffs.md) | Eight lanes and exact Shape/Grid/List arrangement, solo, local recovery | ADR-0152/0122/0102 | Accepted / Not started / Verified No |
| [ADR-0175](adr-0175-requests-and-consented-route-visualization.md) | Request status, deliberate bridge approval and atomic join | ADR-0148/0124/0103 | Accepted / Not started / Verified No |
| [ADR-0176](adr-0176-lyric-harmonic-connection-explorer.md) | Word links, real four-stage harmonic audition, candidate ratings | ADR-0155/0125/0104 | Accepted / Not started / Verified No |
| [ADR-0177](adr-0177-musical-library-and-real-track-identity.md) | Scalable query/filter/sort, readiness, metadata correction, local media | ADR-0153/0154/0123 | Accepted / Not started / Verified No |
| [ADR-0178](adr-0178-first-run-library-awakening.md) | Local folder checks, LRCLIB notice and six ready-song threshold | ADR-0141/0126/0053 | Accepted / Not started / Verified No |
| [ADR-0179](adr-0179-my-mixes-drafts-and-render-line-presence.md) | Safe current/draft separation, queue priority and Undo | ADR-0149/0119/0099 | Accepted / Not started / Verified No |
| [ADR-0180](adr-0180-workspace-library-health-and-progress.md) | Analysis, folders, storage, learning, diagnostics and safe retry | ADR-0156/0128/0107 | Accepted / Not started / Verified No |
| [ADR-0181](adr-0181-export-frozen-revision-and-artifact.md) | Exact frozen FLAC, job lifecycle, reliable background output | ADR-0157/0127/0108 | Accepted / Not started / Verified No |
| [ADR-0182](adr-0182-causal-motion-and-microcopy.md) | Semantic motion, reduced-motion parity, focus and truthful status | ADR-0137/0138/0159/0163 | Accepted / Not started / Verified No |
| [ADR-0183](adr-0183-responsive-accessibility-and-performance.md) | 320–2560px, 400% zoom, keyboard/AT/touch, audio CPU priority | ADR-0160/0161/0162/0110 | Accepted / Not started / Verified No |
| [ADR-0184](adr-0184-research-status-and-release-governance.md) | Blind A/B neutrality, playback/privacy safety, rollback and independent evidence | ADR-0164/0133/0113/0158 | Accepted / Not started / Verified No |

## Non-negotiable cross-cutting contracts

Single audio owner and manual Pause; no original music alteration, truthful LRCLIB metadata disclosure, current-versus-draft and mix revision guards, reversible scoped Undo, real requested-versus-rendered seam state, consented atomic bridge joining, complete eight Stem Studio lanes and 8–64 cells, honest Library readiness and corrections, neutral blind listening comparisons, exact decodable frozen FLAC, existing routes/keyboard and dark/light/reduced-motion functionality.

Never substitute fake beat, waveform, quality score, lyrics timing, artwork, progress, rendered success or UI audio for real backend information. Compare implementation slices to [MI parity](selecta-microinteraction-feature-parity.md) and [experience parity](selecta-experience-feature-parity.md); preserve old code paths until actual UI/AT/audio testing passes.