# Selecta — creative-interface microinteraction and state matrix

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