# Selecta — Unified Finish cross-scene visual and interaction contract

**Status:** 24 Proposed ADRs (0366–0389); 192 UF tasks Not started; 0 In progress; 0 Implemented; 0 independently Verified. Owners unassigned. Baseline main `f17944530d54203e49baebdabc08a57ee9f40526` (2026-11-08); documentation only.

## Three complementary music experiences

**Listen — theatre:** first glance shows song identity, actual transport, progress and next handoff. Lyrics and visualiser options are layered for interested listeners; Stage is immersive yet controlled. Real frequency bins and the player clock alone drive visual sound.

**Discover — gallery:** inviting mood and connection objects display source-backed eligibility and provenance; suggestions are not ready seams until validated, and unsupported audio is never faked.

**Create — instrument:** exact mix revision, song occurrence, directed seam, timeline, heard preview, requested move and achieved output are clearly differentiated. Shape/Grid/List and Story/Arrange preserve musical semantics while offering different complexity.

**Library — collection:** fast retrieval, authentic art, safe exact-ID operations and trustworthy readiness. LX-0340–0352 owns detailed design.

**Lucy — collaborator:** calm conversation plus precise proposal, constraints, revisions, K−1 ready-only evidence and explicit commit. LU/LX own the detailed visual and engine contracts.

**Workspace — operations:** actionable attention, job truth, data provenance, local recovery and safe backups, not vanity telemetry.

## Shared semantics

| Fact | Meaning and visual truth | Must not suggest |
|---|---|---|
| Imported | Local file was indexed | Song is analysed or mix-ready |
| Mix-ready | Eligible source song according to canonical readiness | Every specific seam is cached |
| Proposed | Lucy/planner plan, not saved | Draft/playing state |
| Draft | Saved separate revision | Current audible sequence |
| Queued/rendering | Work to attempt/in progress | Ready playback |
| Seam ready | Actual valid directed cached playable seam | Historical success alone is sufficient |
| Playing | Audible transport with actual audio clock | Animated canvas is equivalent to playback |
| Export complete | File exists, correct frozen revision and decodes | Encoding or browser download merely started |

## UI implementation discipline

Preserve warm-dark branding and bright accent as a baseline, using semantic contrast-approved tokens and authentic artwork/decorative motifs, not inferred song covers. Make primary actions clear, expert detail discoverable, errors recoverable, irreversible actions guarded and Undo scopes visible. Never make navigation, theme or overlay changes mutate audio. Any drag must have accessible keyboard/list alternatives; animation respects reduced motion and silence.

Keep local original audio unchanged; one audio-focus owner and deliberate Pause; exact recording/mix/draft/revision/occurrence/seam identity, scoped Undo; explicit consent and atomic ready-only bridge checks (K songs need K−1 valid cached directed seams); all eight Stem Studio lanes and 8–64-cell shapes; truthful analysis and lyric provenance; frozen-revision decodable FLAC; blinded human listening protocols. No SaaS, accounts, telemetry, remote media upload, native folder bridge or audio-engine rewrite is authorised.

[Roadmap](selecta-unified-finish-roadmap.md) · [192-task checklist](selecta-unified-finish-implementation-checklist.md) · [evidence ledger](selecta-unified-finish-implementation-evidence.md) · [status JSON](selecta-unified-finish-code-status.json) · [overlap/parity](selecta-unified-finish-overlap-and-parity.md) · [experience contract](selecta-unified-finish-experience-contract.md) · [verification matrix](selecta-unified-finish-verification-matrix.md) · [status reconciliation](selecta-unified-finish-status-reconciliation.md) · [release gates](selecta-unified-finish-release-gates.md)
