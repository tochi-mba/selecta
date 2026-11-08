# Product-surface interaction contracts

This document records the source-level contracts implemented by the current Mix ideas, shaping, Listen, requests, drafts, editor, inspector and Studio surfaces. It maps behavior to runtime sources; it does not replace independent visual, audio, assistive-technology, device or participant verification.

## Mix ideas — ADR-0142

- **Hierarchy (MI-0142-01):** each idea card presents name/intent, representative artists and one primary outcome. Supporting detail is subordinate; cards do not impersonate album artwork.
- **Three outcomes (MI-0142-02):** Play replaces the current mix only after required confirmation, Shape opens configuration without playback mutation, and details remain non-mutating. Operation/order guards prevent late responses from replacing newer intent.
- **Loading/missing metadata (MI-0142-03):** readiness, skeleton, partial artists and actionable failure/empty states remain distinct; absent artist/genre data uses explicit text rather than invented identity.
- **Category changes (MI-0142-04):** category state changes the visible candidate set while preserving native focus/order and current playback.
- **Authentic audition (MI-0142-05):** no card claims an audition unless real playable audio exists; choosing/building is not labelled heard or ready.
- **Contrast/density (MI-0142-07):** card actions consume semantic tokens and responsive card grids; independent computed contrast and density review remains open.

Sources: `web/src/views/Mixes.tsx`, `MixSetup.tsx`, `styles/creation.css`, `state/readiness.ts`; fixtures: `Mixes.test.tsx`, `MixSetup.test.tsx`.

## Mix shaping — ADR-0143

- **Committed vs working (MI-0143-05):** form controls own a working configuration until an explicit guarded build/commit response. Current playback and the saved/current mix do not change while inputs move.
- **Input performance (MI-0143-06):** range and numeric inputs synchronize locally; the energy preview is derived from values without network round trips or perpetual animation. Reduced-motion rules remove spatial/decorative motion.

Sources: `web/src/views/MixSetup.tsx`, `styles/creation.css`; fixtures: `MixSetup.test.tsx`.

## Listen hierarchy and transport — ADR-0144/0145

- **First glance (MI-0144-01):** song title/artist and transport are primary; transition, lyrics, next/request and expert detail are progressively disclosed.
- **Responsive composition (MI-0144-06):** Listen collapses without hiding transport; long/RTL text uses intrinsic sizing/wrapping and Stage remains optional. Safe-area and keyboard insets come from shell tokens.
- **Transport labels (MI-0145-01):** idle, blocked, playing, paused, seeking and transition states derive from `SetPlayer`; pressed controls never claim audio started before the audio context does.
- **Next versus jump (MI-0145-04):** Next advances to the following song; jump/skip moves to the current transition opportunity. Labels, shortcuts and command entries remain distinct.
- **Multi-tab/media parity (MI-0145-08):** BroadcastChannel/audio-focus arbitration ensures one tab owns playback; media keys and global controls invoke the same player methods. Physical headset/browser review remains open.

Sources: `web/src/views/Now.tsx`, `player.ts`, `App.tsx`, `shell/Shell.tsx`, `audio/focus.ts`, `styles/listening.css`; fixtures: `Now.test.tsx`, `player.test.ts`, `Shell.test.tsx`, `audio/focus.test.tsx`.

## Lyrics and Stage — ADR-0146

- **Timed lyric semantics (MI-0146-01):** word timing is used only when supplied; line timing/plain lyrics are honest fallbacks. Binary search chooses the current line and announcements avoid word/time spam.
- **Stage hierarchy (MI-0146-03):** Stage keeps song identity, lyrics and essential transport while removing editing/navigation competition; it never starts playback itself.
- **Fullscreen refusal (MI-0146-04):** rejected/unavailable fullscreen falls back to an in-page Stage with identical exit behavior.
- **Reachable media controls (MI-0146-07):** Stage exit/transport remain keyboard reachable, Escape exits, and originating focus is restored by identity where possible.

Sources: `web/src/views/Now.tsx`, `App.tsx`, `styles/listening.css`; fixtures: `Now.test.tsx`, `App.test.tsx`.

## Up next and handoff — ADR-0147

- **State diagram (MI-0147-01):** ordinary playback → transition available/countdown → transition playing → next song; pending/failed/late seams use fallback without claiming rendered audio.
- **Countdowns (MI-0147-02):** bars/beats appear only when real timing/alignment data supports them; otherwise time/state wording is used.
- **Next-card hierarchy (MI-0147-03):** next song identity is primary, request origin and transition readiness are supporting facts.
- **Requested vs rendered (MI-0147-05):** requested technique/route is kept separate from the matching rendered seam key/state and from what was actually heard.
- **Recovery (MI-0147-06):** late/failed seam falls back to safe song continuity with named status and retry/edit route; no fabricated transition animation.
- **Focus/announcements (MI-0147-07):** song changes announce once, clocks do not spam live regions, and optional next/transition changes do not steal focus.

Sources: `web/src/views/Now.tsx`, `lib.ts`, `player.ts`, `views/SeamInspector.tsx`; fixtures: `Now.test.tsx`, `player.test.ts`, `lib.test.ts`.

## Requests — ADR-0148

- **Lifecycle board (MI-0148-01):** searching, waiting, proposed bridge, consent required, accepted/joining, joined, failed/cancelled are separately named states.
- **Bridge consent (MI-0148-03):** proposed extra songs are listed in order with the requested song distinguished; nothing joins before explicit approval and revision guard success.
- **Cancellation (MI-0148-05):** a visible cancel/remove action targets the stable request ID, reports surviving state and cannot cancel a different row after refresh.
- **Rough override (MI-0148-06):** direct/rough insertion is labelled as a quality trade-off and remains explicit rather than silently bypassing bridge consent.

Sources: `web/src/views/Requests.tsx`, request API routes; fixtures: `Requests.test.tsx`, `RequestsJoining.test.tsx`, `tests/test_request_routes.py`.

## Drafts and render line — ADR-0149

- **Current/draft identity (MI-0149-01):** current mix and draft routes/scopes are different types/addresses; all draft mutations carry the draft ID and cannot touch playback.
- **Safe Play (MI-0149-02):** playing a draft requires explicit activation/replacement confirmation, preserves the former current mix as a draft and remains undoable.
- **Card actions (MI-0149-03):** edit, rename, duplicate, prioritize, play and delete are explicit controls scoped to stable draft ID; destructive action offers targeted restoration.
- **Render-line ordering (MI-0149-04):** preparation priority is explicitly not playback order; move/out controls serialize writes and render authoritative place/ETA.
- **Readiness (MI-0149-05):** saved, empty, waiting, rendering, partially ready, failed/missing and fully ready remain distinct.
- **Typography/density (MI-0149-08):** long names wrap/truncate without replacing accessible identity; compact/long lists retain visible controls and focus. Independent visual review remains open.

Sources: `web/src/views/Drafts.tsx`, `MyMixes.tsx`, `App.tsx`, `state/readiness.ts`, `styles/creation.css`; fixtures: `Drafts.test.tsx`, `tests/test_drafts.py`, E2E draft flows.

## Arrangement editor — ADR-0150

- **Selection grammar (MI-0150-01):** stable song-occurrence identity distinguishes duplicate songs; song and following seam remain separate selectable objects.
- **Insertion affordances (MI-0150-03):** explicit gaps/buttons and keyboard-accessible actions identify the exact insertion position; pointer drag is an additional path.
- **Locks/scope (MI-0150-05):** lock, move, remove and undo carry current/draft scope plus order/revision guards; stale responses refresh rather than mutate a different revision.

Sources: `web/src/views/Mix.tsx`, `EditorRows.tsx`, `mixScope.ts`, `state/readiness.ts`; fixtures: `Mix.test.tsx`, API contract/draft tests, E2E integration flows.

## Transition Inspector — ADR-0151

- **Audition-first hierarchy (MI-0151-01):** selected transition identity and Hear it are primary; technique/cue detail is subordinate and cannot auto-play.
- **Truth taxonomy (MI-0151-02):** requested settings, queued/rendering state, matching rendered key, preview and heard result are separately represented.
- **Stale guards (MI-0151-03):** every mutation is tied to seam/revision/order; a response for an older choice cannot overwrite a newer one.
- **Disabled explanations (MI-0151-05):** unavailable moves expose the reason/compatibility constraint, not merely a disabled icon.
- **Cue feedback (MI-0151-06):** source times, leave/enter consequences and pending/rendered state are explicit; preview uses the returned artifact.
- **Narrow sheet (MI-0151-07):** responsive inspector remains in document/overlay focus order, preserves selected seam context and exposes a close/return path.

Sources: `web/src/views/SeamInspector.tsx`, `Mix.tsx`, shared overlay controls, responsive CSS; fixtures: inspector/mix/API contract tests.

## Stem Studio — ADR-0152

- **Eight-lane cells (MI-0152-01):** every song/part/cell is a named button/gridcell with pressed, unavailable and keyboard-focus states; missing stems are immutable and explained.
- **Preview/cursor (MI-0152-03):** the audio deck clock owns preview time; stopping or losing ownership stops the cursor/audio immediately. No UI animation claims sound before sources start.

Sources: `web/src/views/Studio.tsx`, `studio.ts`, `audio/focus.ts`, `styles/creation.css`; fixtures: `Studio.test.tsx`, `studio.test.ts`, audio-focus tests.

