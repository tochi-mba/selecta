# Selecta experience-first acceptance contract

This contract turns ADR-0114 through ADR-0134 into reviewable product evidence for PR #30. The owner-directed implementation request accepts the proposed direction for this PR, subject to the invariants and release gates below. Automated evidence may prove behavior, structure and regression safety; it is never described as a human usability, assistive-technology or listening result.

## Journeys and recovery

| Person and intent | First action | Successful completion | Error or ambiguity | Recovery |
|---|---|---|---|---|
| Listener: hear music now | Open **Listen** or choose **Play now** in **Make a Mix** | Transport identifies the current song, plays it and names what is next | Nothing ready, playback denied, seam still preparing, or Stage denied | Readiness link, explicit retry, truthful transition state, transport remains available outside Stage |
| Listener: request a song | Open DJ controls, request a song and inspect its state | Request is planned directly or the exact bridge is approved and joined atomically | No fit, stale plan, duplicate request, bridge declined or render failure | Recheck, force only by explicit action, decline without mutation, retry against the same request identity |
| Creator: make a mix quickly | Choose a music-first suggestion and select **Play now** | A valid current mix is created without compulsory configuration | Existing playback would be replaced or generation fails | Explicit replacement confirmation; cancel preserves playback; retry is scoped to the same request |
| Creator: shape before committing | Choose **Shape this mix** | Duration, feel, stems, five energy stops and destination survive; then Play, Edit first or Save draft has a stated consequence | Stale or duplicate submission, partial metadata or unavailable suggestion | Latest request wins; controls stay editable; error preserves input and current playback |
| Creator: edit an arrangement | Open **My Mixes**, select current/draft, then a song or transition | Reorder/add/remove/lock/preview/inspect/undo/export affects the named scope and revision | Late mutation, stale revision, failed seam or narrow viewport | Stable identity guard, scoped retry/Undo, non-drag controls, inspector sheet retains focus |
| Expert: shape stems | Open a transition in **Studio**, start in Shape or Detailed | Shape maps deterministically to the eight-lane grid; Detailed retains all cells, solo, presets, assist, preview and Apply | Mode switch, stale revision, failed preview or unsaved work | Non-destructive mode switch, reset/Undo, exact seam/revision check, single audio owner |
| Operator: restore readiness | Open **Workspace** and start with the issue summary | Source, scan, analysis, storage or export blocker has a truthful next action | Missing path, canceled scan, service failure, full cache, stale job | Correct local path, retry/resume, storage guidance, durable Activity/job entry |

## Navigation and route contract

Primary intents are **Listen**, **Make a Mix**, **My Mixes** and **Library**. Workspace and settings remain available as utilities. Legacy addresses remain aliases rather than redirects that discard state. Query-backed Library filters and paging remain in the URL, and browser Back, Forward and refresh retain their meaning. The shared player is owned above routed content and therefore does not remount when a page, dialog, Stage or theme changes.

The contextual root behavior is state based: a current mix opens Listen; an idle but ready library opens Make a Mix; an unready library opens Setup. A deliberate deep link always wins over contextual root selection.

## Preserved capability ownership

| Capability | Experience owner | Regression evidence |
|---|---|---|
| Transport, media keys, lyrics, Stage, transition truth and optional DJ controls | Listen | player/audio-focus unit tests and Listen/Stage Edge flows |
| Suggestions, category access, shaping and Play/Edit/Save outcomes | Make a Mix | Mixes/MixSetup unit tests and creation Edge flows |
| Current mix, drafts, render line and risky management actions | My Mixes | draft identity, scope, retry, Undo and render-line tests |
| Song/seam selection, commands, inspector and export | Arrangement editor | editor identity, keyboard reorder, failure and export tests |
| Eight-lane 8–64-cell editing, Shape mapping and detailed controls | Studio | round-trip, keyboard, stale-revision and preview-focus tests |
| Search/filter/page URL, priority, Never play, details and corrections | Library | 20k paging benchmark, history, correction and focus tests |
| Request lifecycle, bridge consent and atomic insertion | Requests | API concurrency/idempotency plus browser consent flows |
| Word and harmonic audition, pair identity, rating and safe add | Discovery | exact-pair, delayed-response and audio-focus tests |
| Local folder setup, readiness, sources, jobs, storage and diagnostics | Workspace | invalid-path, partial readiness, state-label and privacy tests |
| Frozen-revision FLAC and blind A/B | Export and study | decode/identity and hidden-condition/once-only tests |
| Themes, focus, overlays, Undo, responsive layouts and reduced motion | Shared foundation | control gallery, axe, keyboard, visual candidates and viewport suite |

## Measurable quality protocol

Every task record uses a denominator. A core-task study reports `completed without coaching / attempted`; confidence uses the same predeclared 1–5 question after each task; error rate is `incorrect or unsafe actions / opportunities`; recovery is `successfully recovered / injected or encountered failures`. The initial release target is at least 90% uncoached completion for core listener, creator and expert tasks, zero P0 safety failures, and every P1 explicitly dispositioned. Small samples are reported as raw counts and are not generalized.

Automated budgets cover all reachable routes at 320, 375 and 430 CSS pixels, desktop widths, reduced motion, dark/light themes, keyboard operation, 20,000 Library rows, a 100-song editor and 64 Studio cells. Where browser INP is meaningful, the target is 200 ms on named hardware; API/DSP latency is reported separately. Exact commands, candidate SHA, runner/OS and limitations belong in the evidence ledger.

## Interaction-state matrix

| State | Visual and copy contract | Semantic contract |
|---|---|---|
| Idle | Available action uses its stable label | Native button/link semantics |
| Hover | Supplemental emphasis only | No information available only on hover |
| Focus | High-contrast focus ring, never color alone | Logical order; focus is not moved unexpectedly |
| Pressed/selected | Persistent shape/icon/text cue | `aria-pressed`, `aria-selected` or native checked state as appropriate |
| Pending | Present-progress copy naming the exact operation | Disabled duplicate submit; restrained polite live announcement |
| Disabled | Reason is visible or programmatically associated | Native disabled or `aria-disabled` with no false action |
| Success | Names what actually completed and its scope | Announced once; never used for queued work |
| Failed | Names failure and a reachable scoped retry | Alert only when immediate attention is required |
| Blocked | Names dependency such as storage/readiness and next action | Not conflated with failed or paused |
| Recovering | Names the retry/recheck in progress | Stale response cannot overwrite a newer revision |
| Empty | Explains that the collection has no items and offers a valid first action | Distinct from loading, unavailable and failed |
| Loading | Content-shaped skeleton without invented progress | Busy region has an accessible name |

Dialogs, drawers and menus receive focus on entry, contain keyboard interaction while modal, close the innermost layer first on Escape, and restore focus to the invoker. Undo always names its exact mix/action scope and remains discoverable in Activity when a transient toast disappears.

## Visual and CSS ownership

`styles/tokens.css` owns semantic color, typography, spacing, radii, elevation and motion tokens for light/dark/system themes. `foundation.css` owns resets and shared primitives; `shell.css` owns navigation and persistent transport; `listening.css`, `creation.css` and `operations.css` own their task compositions; `polish.css` may supply narrowly documented compatibility rules but must not silently override domain ownership. Interactive state meaning cannot depend on color alone. Long and RTL metadata must wrap or truncate with the full accessible name preserved.

## Audio, data and platform invariants

- One audio-focus owner arbitrates transport, seam preview, Studio, discovery and request auditions. Explicit Pause never triggers an automatic resume.
- Original music files are read-only. Current/draft identity, revisions, stable song/seam IDs and scoped Undo are checked before mutation.
- A bridge lists every extra song and route before consent; joining is atomic and idempotent.
- Export freezes source kind, source ID, revision and ordered songs before work begins; completion is true only after the FLAC decodes and matches that frozen identity.
- Blind-study renderer/method identity is absent from the DOM and accessible name; assignment and answer identity are once-only under retry.
- The product remains a browser application backed by the local-only server. Typed local paths, Host/Origin protections and truthful LRCLIB disclosure remain. This programme adds no desktop packager, native or browser folder bridge, cloud upload/storage, accounts, auth, subscriptions, tenancy, sync or telemetry.

## Human-only evidence boundary

The following remain human evidence even when the corresponding implementation and automated checks pass: whether navigation terminology is understood uncoached; whether music and transitions sound good; whether the visual hierarchy is preferable; manual NVDA/Edge and touch acceptance; and counterbalanced blind or recommendation-choice outcomes. Their checklist boxes may be checked only when the ledger names the participant/reviewer, protocol, date, exact SHA, numerator/denominator and limitations.

## Rollback and release

PR #30 is one reversible candidate. The pre-candidate reference is `6638ec2313ce53843adfaf363306f8e79c4c8c7e`. Rollback verification opens a copied data directory with pre-candidate code, candidate code, then pre-candidate code again and compares current mix, drafts, preferences, songs and revisions. Release requires exact-head CI, review of synthetic visual candidates, no P0, explicit P1 dispositions and an owner GO. Merging the code is not by itself a claim of completed human research.
