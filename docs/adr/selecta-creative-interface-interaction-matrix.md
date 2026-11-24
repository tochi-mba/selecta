# Selecta - creative-interface microinteraction and state matrix

**Accepted design (not yet implemented):** 20 ADRs Proposed; 140 implementation tasks Not started; 0 independently Verified. Durations below are candidate design targets and do not assert working animation or real-world performance. Reconcile [prior MI motion matrix](selecta-microinteraction-motion-matrix.md) before implementing.

| Interaction | Trigger | Data authority and meaning | Proposed response | Reduced-motion equivalent | Required guard |
|---|---|---|---|---|---|
| Button press | User action | Pending vs committed action distinct | 0–120 ms | Instant pressed/busy text | No duplicate request or focus move |
| Keyboard focus | Focusable target receives focus | Visible target and semantic name | Immediate | Persistent focus ring | Never hover-only |
| Mood card hover | Pointer over card | Only selected idea, not real audio | 100–160 ms | Static card | No autoplay or phantom preview |
| Group filter | Chosen group | Actual filtered candidates | 140–240 ms | Instant results | Keep selected control focused |
| Set length | Chosen approximate length | Approximate count not exact runtime | 150–250 ms | Instant value and shape | No duration promise |
| Energy arc paint | Pointer or slider updates five stops | Local shaping values | Direct input, ≤350 ms settle | Instant accurate curve | No drag lag or scrolling trap |
| Energy preset | User selects arc preset | Requested values and saved scope | 200–350 ms | Instant shape | No false achieved arc |
| Ending song | Selected valid target song | Requested destination, may be unreachable | ≤200 ms | Final marker label | Show fallback truth |
| Mix build | Server confirms generated plan | Actual selected songs, not finished sound | ≤350 ms reveal | Instant confirmed order | No fake progress or screen hijack |
| Switch draft | Server confirms activation | Current/draft revision switch | 180–260 ms | Status and title change | Prior playback preserved per contract |
| Timeline song drag | Pointer/keyboard reorder | Provisional insertion then server-confirmed order | Direct, ≤250 ms drop settle | Explicit insertion text | Cancel/error restores authoritative order |
| Lock song | Server confirms lock | Fixed sequence location | ≤160 ms | Persistent anchor icon/word | Not a filesystem lock |
| Seam select | User selects exact pair | Pair and revision in inspector | 120–220 ms | Static selection outline | No wrong-seam updates |
| Seam technique | User chooses compatible move | Requested style, not finished audio | ≤160 ms | Technique name+diagram | Disabled choices explain reason |
| Audition preview | Actual media playback begins | Real preview clip clock | Audio-clock dependent | Play/Stop and time | Single audio owner |
| Crossfade handoff | Actual seam starts/ends | Confirmed current and incoming song | Audio-clock dependent | Static paired title | No invented overlap or beat |
| Beat countdown | Real beat/bar timing known | Measured remaining beats/bars | Audio-clock dependent | Exact time words | Unknown beat uses seconds |
| Song strip seek | Seek available/blocked state | Precise playable interval | Direct | Accessible blocked description | No phantom draggable seam |
| Lyrics follow | Valid line/word timestamp | Line or word with timing confidence | Known time only | Static lyric line | No fake sung-word precision |
| Wordplay handoff | Actual shared phrase and transition | True lyric relationship | Line/audio-clock | Accessible phrase text | Never claim a guessed exact syllable |
| Stage entrance | User asks fullscreen | Same song, same audio ownership | 200–400 ms | Instant Stage view | Escape and refusal fallback |
| Spectrum graphic | Actual playing audio + analyser | Real bins only | Adaptive <=15fps design target | Still canvas+status | Stop hidden/paused/reduced motion |
| Stem cell paint | Pointer/keyboard toggles exact cell | Local unsaved eight-lane shape | 0–100 ms | Instant on/off label | No repeated toggle per stroke |
| Stem solo | User solos part | Temporary preview state | ≤120 ms | Solo label | No stored-shape mutation |
| Stem mode switch | User selects Shape/Grid/List | Same arrangement, different detail | 160–260 ms optional | Direct mode change | No lost cells or focus |
| Studio AI proposal | Server returns shape | Returned cell-level diff | 160–300 ms | Static before/after list | Never overwrite newer local edits |
| Apply stem arrangement | Server acknowledges applied snapshot | Applied is not rendered audio | Discrete | Applied state text | Keep recovery and revision |
| Request song | Server accepts chosen ID | Pending musical intent | ≤180 ms | Request status | No claim it is playable |
| Bridge results | Server returns real ordered route | Only returned intermediate songs | 150–300 ms | Ordered list | Must await full approval |
| Bridge join | Server confirms atomic insert | All extras join or none | ≤260 ms | Confirmed route status | Never partial or ahead of readiness |
| Library view change | User changes list/grid/density | Same query/sort/filter and item IDs | 140–240 ms | Instant layout | Large list remains responsive |
| Analyse readiness | Backend reports real count | True scanned/analysed/lyric/ready stages | Event-driven | Updated counts | Never fake percentage |
| Queue reorder | Server updates render priority | Real queue position | ≤200 ms | Order labels | No fake job completion |
| Export prepare | Actual job/seam status changes | Frozen revision and real progress | Discrete | Step and ETA words | No fabricated output |
| Export complete | FLAC actually exists | True filename and download | ≤180 ms | Ready file link | No autoplay/false quality |
| Toast/Undo | Operation succeeds or fails | Exact reversible affected object | 100–220 ms | Stable message | Guard later operations |
| Route transition | User navigates to valid destination | Same player and context | 120–240 ms | Immediate content | Back/Forward focus stable |
| Offline state | Server connection lost | Loaded audio may continue; data stale | Immediate | Persistent warning | No repeated disruptive toasts |

## Object truth and visual identity

| Creative object | Required genuine data | Missing or tentative state | Prohibited implication |
|---|---|---|---|
| Song Identity | Stable track ID, actual metadata and measured attributes where available | Neutral typography/decorative motif | No invented album artwork/genre/energy |
| Seam Connection | Two exact IDs, requested technique, actual render/fallback and preview clock | Planned/queued/failed pair with words | No fake smooth audio/beat/ready state |
| Energy Horizon | User five-stop intention OR measured relative energy, explicitly separated | Unmeasured curve or no-result note | No comparable-score overlay without shared scale |
| Requested Route | Real returned bridge song IDs and consented insertion | Requested/waiting/proposed path | No fictitious search route or partial join |
| Spectrum | Player real analyzer and audio ownership | Still/dim/absent measurement state | No looping pseudo-equalizer |
| Lyrics | Actual synced word/line timing, confirmed shared phrase | Plain text/line focus/none | No sample-accurate claim from uncertain LRCLIB data |
| Stem Layers | Real eight-lane cell state, StemDeck preview and applied revision | Unavailable lane, unsaved, preparing | No generated audio until actually rendered |
| Export artifact | Frozen revision and authoritative completed FLAC | Pending, failed, expired | No downloadable file until real output exists |

## Universal state matrix

Review applicable idle, hovered, focused, pressed, selected, pending, queued, preparing, rendering, ready, applied, audible, failed, blocked, stale, offline, canceled, reverted and exported states. Each needs: clear label/icon; authoritative event and source; cancellation/stale-response rule; keyboard semantics; reduced-motion equivalent; and tests at dark/light/system/high-contrast plus representative mobile and desktop viewports.

## Performance and attention policy

Animations never delay a musical action, steal keyboard focus, trigger UI sounds, strobe or show endless particles. Media effects stop when hidden or paused and are capped against real render load. No visual treatment implies that a technical quality check proves a transition sounds good. [Checklist](selecta-creative-interface-implementation-checklist.md) · [Verification](selecta-creative-interface-verification-matrix.md).

## Animation ownership and interruption (CI-0182-01, reconciled 2026-11-10)

Every animation the stylesheets actually run, reconciled against every `@keyframes` in `web/src` and the
clock-driven marks. Each row names the data that owns it (the only thing allowed to start or stop it),
the states it is drawn in, and what interrupts it. Timings live in
[the motion inventory](../engineering/motion-inventory.md); `tests/test_ci_creative_interface.py`
fails if a stylesheet adds a `@keyframes` name that is not in this table, or a row loses its owner.

| Animation | Source | Data owner | States drawn | Interruption and cancellation |
|---|---|---|---|---|
| `button-working` | `web/src/ui/controls.tsx` | the `Action` press promise (`data-working` while it runs) | idle, working, done, failed | stops the moment the promise settles; a second press is ignored while busy; reduced motion shows a still bar |
| `skeleton-breathe` | `web/src/ui/Skeleton.tsx` | the page or panel fetch that has not answered yet | loading only | removed when the data arrives or fails; breathes 3 times then holds still; reduced motion holds still |
| `skeleton-reveal` | `web/src/ui/Skeleton.tsx` | the same pending fetch, after `--motion-fast` so quick answers never flash | loading only | the whole skeleton unmounts when data or an error arrives; none under reduced motion |
| `lucy-slide` | `web/src/views/LucyCards.tsx` | a running Lucy card with no count from the server | running without a count | replaced by the real progress width as soon as a count arrives; gone once the card settles; never drawn under Still |
| `request-pulse` | `web/src/views/Requests.tsx` | the request stage from the server (adding, preparing, ready, analysing) | working stages only | stops on any other stage, including failed and cancelled; reduced motion holds still |
| `pending-flow` | `web/src/views/Now.tsx` | the next transition not yet rendered (`ready` false or no seam time) | preparing the hand-off | replaced by the clock-driven hand-over once the seam is ready; gone on the last track; reduced motion holds still |
| `feeling-reveal` | `web/src/views/Mixes.tsx` | a vibe group inserted on Make a Mix | first appearance only | runs once per inserted group, never loops; a filter change only reveals new groups; none under reduced motion |
| `toast-appear` | `web/src/ui/toasts.tsx` | a finished operation reporting success or failure | shown | entrance only; dismissing or a newer toast replaces it without replaying; none under reduced motion |
| `overlay-appear` | `web/src/ui/controls.tsx` | the person opening a dialog, sheet or drawer | opening | entrance only; Escape or close starts `dialog-exit` at once and returns focus; none under reduced motion |
| `drawer-appear` | `web/src/ui/controls.tsx` | the person opening a drawer or a phone sheet | opening | entrance only, from the panel's own side (`--overlay-travel`); Escape or close starts its exit at once and returns focus; none under reduced motion |
| `pop-appear` | `web/src/ui/controls.tsx` | the person opening a menu, popover or tooltip (`data-motion='pop'`) | opening | entrance only; closing swaps it for `fade-exit`, never replays it; none under reduced motion |
| `fade-exit` | `web/src/ui/exitMotion.ts` | a closing overlay's scrim, menu, popover or tooltip (`data-closing`) | closing | the closing copy is inert, so nothing can be pressed mid-exit; it unmounts on `animationend` or a token-length timeout; reduced motion uses it for every exit; none under Still |
| `dialog-exit` | `web/src/ui/exitMotion.ts` | a dialog being closed by Escape, its close button or its action | closing | plays on an inert copy while focus has already returned; unmounts on `animationend` or the `--motion-exit-dialog` timeout; reduced motion swaps it for `fade-exit` |
| `drawer-exit` | `web/src/ui/exitMotion.ts` | a drawer or sheet being closed | closing | slides back out its own side on an inert copy; unmounts on `animationend` or the `--motion-exit-drawer` timeout; reduced motion swaps it for `fade-exit` |
| `toast-exit` | `web/src/ui/toasts.tsx` | a toast dismissed, timed out or replaced | closing | the row stops taking presses at once; it unmounts on `animationend` or the `--motion-exit-toast` timeout; reduced motion swaps it for `fade-exit`; none under Still |
| `route-reveal` | `web/src/App.tsx` | a navigation to a valid route | entering a page | only the page content fades; the player and navigation never move; not on Stage; none under reduced motion |
| Hand-over progress width | `web/src/views/Now.tsx` | the player clock during a rendered seam | during the hand-over | follows the clock, so pause, seek or a skipped track move it at once; it never runs ahead of audio |
| Spectrum canvas | `web/src/views/Now.tsx` | the playing audio's analyser | playing, paused, hidden | blank on pause, stopped while the tab is hidden or the canvas off screen; one still frame under reduced motion |
| Lyric focus | `web/src/views/Now.tsx` | timed lyric lines and words against the player clock | current line or word | moves only when the clock passes a real timestamp; untimed lyrics never animate |
| `rise-in` | `web/src/cloud/Welcome.tsx` | the page opening: the welcome page and the gate screens mount (nothing is fetched for it) | arriving, at rest | runs once from the start state and ends at rest; a part that leaves the page is simply removed; with Still or reduced motion every part is at rest from the first frame |
| `blend-head` | `web/src/cloud/BlendArt.tsx` | nothing in the account: the drawing of a blend on the welcome and page-not-found pages | looping decoration, still | a slow loop that no control starts or waits on; it ends when the page is left; with Still or reduced motion the playhead rests at the blend point |
| `blend-skip` | `web/src/cloud/BlendArt.tsx` | the same drawing with nothing up next (the page that is not there) | looping decoration, still | the playhead reaches the blend point and starts over, never crossing into the empty lane; ends when the page is left; still under Still or reduced motion |
| `blend-ring` | `web/src/cloud/BlendArt.tsx` | the playhead of that drawing reaching the blend point | hidden, answering, still | tied to the same loop as the playhead, so it can never run without it; removed with the drawing; not drawn moving under Still or reduced motion |
| `blend-kick` | `web/src/cloud/BlendArt.tsx` | the bars of the incoming song in that drawing | at rest, kicking, still | one beat of the same loop; no state depends on it and nothing waits for it; the bars keep their drawn heights under Still or reduced motion |
| `blend-tag` | `web/src/cloud/BlendArt.tsx` | which of the drawing's two captions the playhead is under | quiet, lit, still | trades emphasis between the two captions on the same loop; both stay readable at every frame; both are plain under Still or reduced motion |
| `cloud-spin` | `web/src/ui/controls.tsx` | a Cloud button that is `aria-busy` or `data-working` (the `Action` press promise) | idle, working | the ring is only drawn while the button is busy and goes the moment the promise settles; a second press is ignored while busy; under Still or reduced motion the ring is drawn still and the button's words say it is working |
| `cloud-arrive` | `web/src/shell/Shell.tsx` | the route: a Cloud page, or a card in a card grid, being mounted | arriving, at rest | runs once from the start state; leaving the page unmounts it mid-way with nothing left behind; at rest from the first frame under Still or reduced motion |
| `meter-fill` | `web/src/ui/Meter.tsx` | a Cloud meter being mounted with a known value | filling, at rest | fills once to the value it was given; a new value afterwards moves by the meter's own transition, not this animation; at its value from the first frame under Still or reduced motion |
