# Selecta / Flow — artistic system and screen-by-screen design contracts

**Status: proposed design principles, not implemented, approved or independently verified.** Consult [ADR-0198–0247](selecta-flow-roadmap.md) for individual decisions and [400-task checklist](selecta-flow-implementation-checklist.md) for acceptance tasks. The existing app and all older designs can be reconsidered, subject to preservation and approval.

## 1. Creative direction

**Product statement:** “Music is art. Let the software disappear when listening deserves the spotlight, and become a precise instrument when creativity takes over.” Compose like an editorial music magazine with the tactility of a physical record collection, not a corporate dashboard or skeuomorphic DJ mixer. Use a recognizable musical visual grammar, **The Thread**, across all scenes. One music object, one first-glance action, one quiet utility layer and progressively disclosed advanced controls.

**Three emotional presentations:**

- **Listen — the theatre:** cinematic quiet, emotional confidence, artwork plus genuine audio movement, responsive persistent transport and real transition anticipation.
- **Explore — the gallery:** musical ideas as inviting editorial objects with real eligibility and no synthetic audio claims. Optional intent shaping is explicitly scoped.
- **Create — the instrument:** tangible song blocks and seam edges, audition-first inspection, exact cues and energy values, all tied to server revision. Dense Studio and Library are intentionally practical.

## 2. Candidate visual system (to be measured, not hard-coded without review)

- **Core atmosphere:** warm near-black `#111417` and subtle ivory `#F2EEE7`; gold `#DCC178`, sage `#93B8A5`, lilac `#B69BCE`, coral `#D89578` as *art direction candidates*, not automatically accessible text tokens. Build tested semantic colors for text, focus, ready, queued, planned, request, danger and errors.
- **Type roles:** expressive display for song/mix identity, editorial subheading, quiet readable interface, tabular technical type for time, tempo, cue and bar values. Control long, Unicode, repeated and RTL metadata without clipping.
- **Surface language:** wide confident music imagery and sparse cards where object boundaries help. No endless card-in-card boxes; use texture, depth and ambient light sparingly without corrupting status readability.
- **Mix Sleeve:** durable creative image for saved mix identity. Genuine covers are from actual authorized media; deterministic motifs are decorative, never fabricated album art or inferred quality.
- **Motion:** user/action feedback usually immediate; short scene transitions about 120–300ms as candidate targets. Actual handoff visuals use the real playback clock. Still/Subtle/Expressive preferences never override OS reduced motion. No decorative beat loops, pseudo-signal or self-playing sounds.

## 3. The Thread: one truthful music-visual grammar

- Identity is stable song occurrence, seam pair and mix revision. A repeated song is *not* the same occurrence.
- **Confirmed/playing** is solid, **planned** dashed or clearly marked, **blocked/failed** broken with text and non-color icon. These forms must survive grayscale, forced colors, AT and 320px.
- **Energy intent** is a requested shape; **measured/achieved** is separately labeled with actual source and scale. Connection graphs only use real pair data. Real audio spectrum must sample actual player frequency bins; silence never yields fake movement.
- The Thread scales from compact transport to full-size listening handoff, Story timeline, Request route and finished sleeve without redefining the underlying data.

## 4. Screen contracts and priority composition

| Scene | First-glance object / action | Advanced layer | Core negative states |
|---|---|---|---|
| First run | Local library path and first real Play | Scan/source privacy and LRCLIB metadata explanation | No folder, invalid path, scanning, fewer than six ready tracks |
| Listen | Actual current song / Pause-or-Play | Lyrics, 15 spectrum modes, transition truth and DJ steering | Silent/paused, no art, stale seam, blocked seek, last song, fullscreen refusal |
| Handoff | Outgoing and incoming identities / truthful takeover | Technique and time details | Fallback, missing render, skip/pause, unknown beat or phrase |
| Explore | One inspiring mix idea / Play or Shape | Compatibility, group filters, optional Compass | Insufficient ready music, unsupported intent, failed build |
| Connection Gallery | Validated pair with reason / Hear | Graph and ratings | Candidate-only, no clip, uncertain phrase, stale results |
| Create | Story of mix / Select song or seam | Exact reorder, locks, precision inspector, energy shape | Duplicate songs, revision conflict, Undo failure |
| Studio | Two songs × four actual parts / paint cell | Solo, Shape/Grid/List, AI diff, Apply, preview | Missing stem, 64-cell load, stale AI result, recovery |
| Requests | Requested song / approve actual route if necessary | Exact intermediate bridge songs | Rejected, stale, duplicate, unconsented atomic failure |
| Library | Real collection / Search | Dense table, readiness, correction | 20k items, missing source, corrupted media, RTL titles |
| My Mixes | Current performance vs project sleeves / Open | Draft management and render line | Wrong revision, activation conflict, lost export job |
| Workspace | Operational health / resolve blocker | Analysis, local sources, storage, diagnostics | Offline, cancel, cache failure, missing server path |
| Export | Frozen revision / Render | Real progress, decodable file, artifact location | Corrupt output, stale revision, storage full, job cancellation |

## 5. Accessibility, performance and user research

Build to WCAG 2.2 AA, real keyboard/NVDA/Edge, essential touch target sizing, forced-colors, 320px reflow and 400% zoom. Protect actual sound: target p75 INP ≤200ms and low layout shift where relevant, but record real-device metrics rather than treating targets as proof. Stress 20k songs, 100-song arrangements and 64-cell Studio under analysis/render load. Conduct independent uncoached listener, creator and DJ sessions; assess emotional delight separately from task accuracy and real sonic quality. Blind A/B must remain neutral. Acceptance requires named reviewers, actual source SHA and hardware evidence.

## 6. Strict exclusions and rollback

No accounts, subscriptions, mandatory SaaS, remote audio uploads, telemetry, fake audio/cover art, invented beat/lyric timing, automatic cloud sync, new launcher, silent edits or destructive source media operations. Introduce the system in small reversible slices and retain old links, audio state, local preferences and drafts. No design PR is a claim of app implementation.

[Interaction/motion matrix](selecta-flow-interaction-matrix.md) · [Feature preservation](selecta-flow-feature-parity.md) · [Status reconciliation](selecta-flow-status-reconciliation.md) · [Release gates](selecta-flow-release-gates.md).
