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
| `feel-panel-in` | `web/src/ui/primitives.tsx` | the tab the person picked (`data-feel-from` says which side it came from) | entering a tab panel | runs once per tab change; a quicker second change starts it again on the new panel; none with the feel's motion off, Still or reduced motion |
| `feel-item-in` | `web/src/ui/controls.tsx` | a menu opened for the first time (`data-feel-first`), a diagnostics group opened, or Lucy's plan cards drawn | arriving, at rest | plays once from the start state; closing the menu or group removes the items mid-way with nothing waiting on them; none with the feel's motion off |
| `feel-fade-in` | `web/src/ui/controls.tsx` | the person opening a dialog, drawer or sheet (its scrim) | opening | entrance only; closing hands over to the exit protocol's fade on an inert copy; none with the feel's motion off |
| `feel-countdown` | `web/src/ui/toasts.tsx` | a toast's own time on screen (the ring left) | counting down | drawn once for the toast's life; dismissing or replacing the toast removes it with the toast; none with the feel's motion off |
| `feel-nudge` | `web/src/ui/primitives.tsx` | a field's error words (`Field` with an error) | error shown | plays once as the words appear; fixing the field removes them; the words and the field's own description stay without it; none with the feel's motion off |
| `feel-check` | `web/src/ui/primitives.tsx` | the checkbox or radio choice just pressed (checked and focused) | just checked | only on the one holding focus, so a page of checked boxes never pops; ends at its own size; none with the feel's motion off |
| `feel-bloom-in` | `web/src/ui/controls.tsx` | a pointer resting on, or the keyboard reaching, an icon button that can be pressed | hover, focus | plays once as hover or focus starts and is gone when they end; never on a disabled button; only with the feel's depth part on |
| `feel-scroll-edge` | `web/src/ui/DataTable.tsx` | how far a wide table, an overlay body or the palette list is scrolled (a scroll timeline) | at the start, scrolled | follows the scroll position, never time, so it stops when scrolling stops; no fade while the table has the keyboard; only with the feel's depth part on |
| `feel-skeleton-sweep` | `web/src/ui/Skeleton.tsx` | the page or panel fetch that has not answered yet | loading only | sweeps three times then holds still; the skeleton unmounts when data or an error arrives; none with the feel's motion off |
| `feel-bloom` | `web/src/ui/Meter.tsx` | a meter whose value reaches done while on screen (`data-complete`) | complete | blooms once and settles; a value that drops below done removes the attribute; only with the feel's depth part on |
| `feel-sweep` | `web/src/cloud/Welcome.tsx` | the welcome page's word being lit as the page opens | lit, at rest | runs once and ends at rest; leaving the page removes it; none with the feel's motion off |
| `feel-line-down` | `web/src/cloud/Welcome.tsx` | the welcome steps scrolling into view, and the hand-off line between two covers on Links | drawing, drawn | draws once from the start state; scrolling back or leaving the page never replays it as a loop; none with the feel's motion off |
| `feel-line-across` | `web/src/cloud/Welcome.tsx` | the same welcome steps on a wide screen, the covers line on harmonic matches, and an export's shape once it is ready (`data-export-ready`) | drawing, drawn | draws once; the export's line waits for the real ready state and never runs ahead of it; none with the feel's motion off |
| `feel-arrive-forward` | `web/src/cloud/onboarding/OnboardingSpine.tsx` | a step of Cloud onboarding reached by going on (`data-dir='forward'`) | arriving | runs once per step change; going back plays `feel-arrive-back` instead; sides swap in a right-to-left page; none with the feel's motion off |
| `feel-arrive-back` | `web/src/cloud/onboarding/OnboardingSpine.tsx` | a step of Cloud onboarding reached by going back (`data-dir='back'`) | arriving | runs once per step change; a further change starts the next step's arrival; none with the feel's motion off |
| `feel-listen-skip` | `web/src/views/NowStrip.tsx` | a press that moved the playhead on Listen's song strip | just skipped | plays once per press where the playhead landed; the audio has already moved, so nothing waits for it; none with the feel's motion off |
| `feel-listen-rise` | `web/src/views/Now.tsx` | the player clock nearing a blend (`data-blend-near`) | blend near | rises once as the blend comes near; a seek or skip that moves away removes the attribute; none with the feel's motion off |
| `feel-listen-build-out` | `web/src/views/BuildMoment.tsx` | a mix just built, shown over Listen's hero | building, folding away | never takes a press; it folds away after two glides and the component removes it by its own time limit at most; only with the feel's moments part on |
| `feel-word-light` | `web/src/views/ScanReveals.tsx` | words a library scan found, revealed as the scan reports them | lit, at rest | lights once per word and rests; a new scan replaces the words; only with the feel's depth and motion parts on |
| `feel-tick-draw` | `web/src/ui/controls.tsx` | an `Action` whose press promise settled well (its tick) | done | draws once after success and stays drawn until the button's next press; never after a failure; none with the feel's motion off |
| `feel-moment-ray` | `web/src/feel/moment.tsx` | a celebrated moment (a first blend, a finished mix) | celebrating | plays once and the moment removes itself when it ends; never blocks a control; only with the feel's moments part on |
| `feel-qr-wave` | `web/src/rooms/RoomShare.tsx` | a room's join code being shown as a QR code (`data-qr-wave`) | arriving, at rest | only opacity moves, so the code scans from the first frame; runs once; only with the feel's moments part on |
| `feel-speaker-pulse` | `web/src/devices/SpeakerMoved.tsx` | the playback session really naming a new speaker | moved | plays once after the session confirms the move; a later move replaces it; the words for a screen reader are in the line itself; none with the feel's motion off |
| `feel-beacon` | `web/src/rooms/RoomPanel.tsx` | a room just opened (`data-ping`) and this device in the devices list | just opened, this device | one ring, never a light left blinking; locking the room removes it; only with the feel's moments or motion part on |
| `feel-scene-leave` | `web/src/shell/sceneTransition.ts` | a navigation to a valid route, run as a view transition (`data-nav`) | leaving a page | part of one view transition the browser can skip at any time; a new navigation ends it at once; none under Still, low power or reduced motion |
| `feel-scene-enter` | `web/src/shell/sceneTransition.ts` | the same navigation, the new page coming in | entering a page | ends with the view transition; a new navigation replaces it; none under Still, low power or reduced motion |
| `feel-scene-travel` | `web/src/shell/sceneTransition.ts` | the same navigation, the shared element travelling between pages | travelling | ends with the view transition; a new navigation replaces it; none under Still, low power or reduced motion |
| `feel-rail-label` | `web/src/shell/Shell.tsx` | the person opening the navigation rail (`data-rail-move='opening'`) | opening | plays once as the rail opens; closing it mid-way removes the labels with no exit; none with the feel's motion off |
| `feel-menu-grow` | `web/src/shell/Shell.tsx` | the account menu opened, and the checkout summary on Billing being shown | opening | entrance only; closing uses the exit protocol's fade; none with the feel's motion off |
| `feel-crumb-in` | `web/src/shell/Shell.tsx` | the route: the last crumb of the context bar changing | arriving | runs once per page change; a further change starts again on the new crumb; none with the feel's motion off |
| `feel-ring` | `web/src/shell/Shell.tsx` | a context bar icon that has just something new to say | ringing | rings once and rests; nothing waits on it; none with the feel's motion off |
| `feel-ping` | `web/src/shell/Shell.tsx` | a context bar count that just went up (`feel-pop` on the count) | counted | one glow after the pop, never left blinking; only with the feel's motion and depth parts on |
| `feel-hop` | `web/src/shell/Shell.tsx` | the person opening the phone More menu (`aria-expanded`) | opened | hops once as it opens; closing never replays it; none with the feel's motion off |
| `feel-dock-rise` | `web/src/shell/Shell.tsx` | something starting to play, which mounts the mini player | arriving | runs once from the start state; stopping starts `feel-dock-sink` at once; none with the feel's motion off |
| `feel-dock-sink` | `web/src/shell/Shell.tsx` | playback ending, which closes the mini player (`data-closing`) | closing | the closing dock is inert, so nothing under a press is lost; it is removed when the sink ends; none with the feel's motion off |
| `feel-glyph-swap` | `web/src/ui/ThemeChoice.tsx` | a toggle's or the mini player's icon changing (a theme chosen, play to pause) | swapped | plays once per change; the button already works with the new state, so nothing waits on it; none with the feel's motion off |
| `feel-title-in` | `web/src/shell/Shell.tsx` | the song playing changing (the mini player's title) | arriving | runs once per new song; a skip mid-way starts it again on the next title; none with the feel's motion off |
| `feel-palette-grow` | `web/src/ui/CommandPalette.tsx` | the person opening the command palette | opening | entrance only; the closing copy keeps no grow, so only an open panel grows; none with the feel's motion off |
| `feel-banner-in` | `web/src/cloud/ConnectionBanner.tsx` | the connection state going down, or an import starting (the import chip) | arriving | runs once as it appears; a recovery starts `feel-banner-out`; none with the feel's motion off |
| `feel-banner-out` | `web/src/cloud/ConnectionBanner.tsx` | the connection coming back, so the banner has nothing more to say (`data-closing`) | closing | follows the exit protocol: an inert copy removed when the slide ends or times out; none with the feel's motion off |
| `feel-theme-reveal` | `web/src/shell/Shell.tsx` | the person choosing a theme (`data-theme-reveal` while the view transition runs) | revealing | part of one view transition the browser can skip; the attribute is cleared when it finishes; none under Still or reduced motion |
| `feel-arrive` | `web/src/ui/toasts.tsx` | something just mounted with `data-arrive` or in a `data-stagger` list (toasts, the rail, gate cards, Lucy's drawings) | arriving, at rest | runs once from the start state and ends at rest; a part removed mid-way simply goes; none with the feel's motion off |
| `feel-pop` | `web/src/ui/controls.tsx` | a menu, listbox, tooltip or dialog opening, or a control just switched on by a press (`feel-pop`) | opening, just on | entrance only, never replayed by tabbing past; closing uses the exit protocol; none with the feel's motion off |
| `feel-draw` | `web/src/cloud/StorageCard.tsx` | a value being drawn: the storage ring, the relationship map's lines, a `feel-tick` | drawing, drawn | draws once to the value given; a new value moves by the ring's own transition; none with the feel's motion off |
| `feel-flash` | `web/src/views/LucySongs.tsx` | a row a change really added (Lucy's new revision, a saved browser mix) | just added | lights once per revision, never on a redraw; nothing waits on it; none with the feel's motion off |
| `feel-collapse` | `web/src/views/EditorRows.tsx` | a row really removed (`feel-collapse-out`): an editor song, a request, a device, a Lucy song | leaving | the leaving row takes no presses and folds away; it is removed on `animationend` or a timeout; with the feel's motion off it simply goes |
| `feel-lucy-rise` | `web/src/views/LucyTranscript.tsx` | a Lucy message arriving in the conversation (`is-rise`) | arriving | runs once per message; nothing waits on it; none with the feel's motion off |
| `feel-lucy-fade` | `web/src/views/LucyTranscript.tsx` | a Lucy message or a streamed chunk of her answer arriving | arriving | fades in once per chunk as the server sends it, never ahead of the words; stopping the answer leaves what arrived; none with the feel's motion off |
| `feel-lucy-shimmer` | `web/src/views/LucyTranscript.tsx` | the server naming a new step Lucy is working on | working | runs once per new step and ends in the words' own colour; the answer arriving replaces it; none with the feel's motion off |
| `feel-lucy-edge` | `web/src/views/LucySongs.tsx` | a song Lucy's new revision added (with `feel-flash`) | just added | lights the edge once per revision, never on a redraw; none with the feel's motion off |
