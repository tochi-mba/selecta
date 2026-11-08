# Selecta / Flow — comprehensive proposed microinteraction and music-truth matrix

**50 Accepted ADRs; 400 SF tasks Not started; 0 independently Verified.** All durations are candidate design targets in milliseconds, *not measurements or implemented behavior*. Audio-clock effects obey actual player events and do not inherit UI-duration targets. Reconcile the [MI matrix](selecta-microinteraction-motion-matrix.md) and [CI matrix](selecta-creative-interface-interaction-matrix.md) before implementing.

| Interaction | Trigger | Authoritative meaning | Candidate feedback | Still/reduced-motion equivalent | Mandatory safety guard |
|---|---|---|---|---|---|
| Scene entry | User navigates | Router, current mix and player state | 150–280ms optional shared-object continuity | Immediate heading/focus with stable transport | No route-triggered audio, no lost seam |
| Scene exit | Back, Forward, another route | History and selection state | 120–220ms crossfade if supported | Immediate contextual scene | Focus/scroll and playback retained |
| Theme or density change | Preference action | Locally stored preference | Immediate or <=160ms palette settle | Immediate theme and text status | Never reinitialize playback |
| Sensory mode change | Still/Subtle/Expressive selected | OS setting and persisted user choice | Stop or reduce visual effects immediately | Textually named chosen mode | OS reduced motion wins |
| Artist/song hero | Playing song changes | Exact current song ID | Recompose real artwork/identity within 200–350ms | Direct identity swap | No fabricated or stale cover |
| Transport press | Play/Pause/Next | Player command acknowledgement | 0–120ms response, pending until ack | Same visible button state | No optimistic false playing |
| Song seek | Pointer/keyboard scrub | Proposed position then accepted audio clock | Direct ghost position, settle after ack | Value+current time text | Blocked seam seek remains blocked |
| Seam countdown | Actual seam approaching | Confirmed seam clock and beat certainty | Audio-clock visual only | Time phrase based on real facts | No guessed beats |
| Real handoff | Rendered transition begins | Player seam event, actual technique | Audio-clock outgoing/incoming takeover | Paired identities and status | No false overlap or switch |
| Visualizer style | User chooses one of 15 | Real analyzer bins; persisted mode | Immediate renderer replacement without audio action | Selected style text and still measured frame | Never start playback |
| Spectrum absence | Pause, silence, hidden tab | Player and sampled spectrum zero | Stop sampling or draw zero | Still/empty meaningful label | No self-running fake signal |
| Lyric auto-follow | Known lyric line timing | Available timestamp and confidence | Scroll only when follow enabled | Current line text | Respect manual reading |
| Wordplay reveal | Actual shared lyric handoff | Confirmed phrase and rendered transition | Audio-clock emphasis | Readable shared phrase if real | No invented syllable timing |
| Up Next change | Actual queue/steering edit | Current mix revision | Short local card update | Updated song and scope text | No hidden queue mutation |
| Mood card hover | Pointer movement | Available suggestion, not playable audio | <=160ms border/depth | Static selection state | No autoplay teaser |
| Compass/energy paint | Pointer/keyboard value change | Exact requested five-stop state | Direct curve move with settle | Five precise numeric inputs | Do not imply achieved energy |
| Mix build | Server returns plan | Confirmed response song IDs | <=350ms reveal of returned sequence | Immediate confirmed order | No fake steps or arbitrary progress |
| Song reorder | Pointer drag or keyboard command | Local provisional then server revision | Direct ghost insertion, ack settle | Text Move up/down and position | Cancel/reject rolls back |
| Seam select | Exact song-pair selection | Stable pair occurrence and revision | 120–220ms inspector focus continuity | Static selected edge and labels | No wrong seam editor |
| Seam move choice | User selects compatible technique | Backend capability and requested edit | Short local change after ack | Move name and committed status | No pretending render complete |
| Audition preview | Actual audio clip starts | Media player preview ownership | Real clip clock only | Play/Stop and time | Single audio owner |
| Conditional A/B | Two immutable actual clips available | Clip identity, frozen revision | No cosmetic bias, discrete switching | Clear A/B labels without priming | Hide feature when clips absent |
| Studio cell paint | User edits exact stem/time cell | Local eight-lane working arrangement | 0–100ms direct cell response | Text or checkbox cell state | Once per intended stroke |
| Studio proposal diff | Server returns actual proposed cells | Returned cell-level diff | <=300ms highlight changed cells | Static before/after list | Never overwrite newer local strokes |
| Studio apply | Server accepts arrangement | Applied revision vs working cells | Short discrete confirmation | Applied status text | Do not call applied rendered |
| Stem preview | User plays actual preview | Audio focus and prepared stem audio | Real position only | Play/Stop; track names | Do not overlap Listen |
| Request receipt | Request endpoint accepts ID | Request lifecycle ID | <=180ms outcome | Pending request text | No claim it plays next |
| Bridge route | Candidate route returned | Backend ordered intermediate song IDs | Optional ghost line until explicit consent | Ordered text list and approval | No partial or implicit insertion |
| Library paging | Query changes/scroll threshold | Cursor, filters and readiness | No skeleton once actual rows arrive | Results count and retained focus | No 20k eager DOM |
| Song correction | Edit to metadata accepted | Confirmed metadata version | Discrete result message | Corrected field and source | Never rewrite source recording |
| Draft activate | User approves current replacement | Server-confirmed current/draft revision | <=260ms identity change | Active mix label and Undo if valid | No surprise playback |
| Export start | Frozen revision accepted | Backend job snapshot | Queued state, no fabricated % | Revision and job status text | Cannot silently export newer edit |
| Export completion | Actual FLAC exists and decodes | Completed job artifact | Subtle sleeve completion | File format, path and ready label | Do not show premature success |
| Workspace update | Backend job progress changes | Real analysis/render job state | Discrete non-modal update | Exact status text | No focus steal or fake estimate |
| Undo | Backend restores supported state | Revision/undo operation result | Immediate pending then confirmed | Outcome and affected scope | No fake reversible action |
| Error and retry | Server error/cancel/conflict | Actual operation and error cause | Local error without celebratory motion | Cause, next action and retained input | No stale success overwrite |
| Fullscreen Stage | User explicitly requests it | Fullscreen API result | Optional 200–350ms composition | Instant layout with Escape support | No auto-audio or focus trap |

## Global motion and visual safety rules

- Immediate control feedback should not wait for animation or interfere with audio focus, Pause, Undo, cancel or navigation.
- UI transitions may typically use 60–400ms based on action semantics. Musical choreography instead follows actual measured audio, decoded waveform, seam clock, or explicit returned state. Never animate a fabricated beat or word-timed syllable.
- OS reduced-motion and user Still mode retain the *same facts*, with no mandatory spatial movement or hidden information. Never auto-play UI sound. Give every canvas/graph a usable text alternative.
- Pause and hidden/offscreen canvases stop sample loops. Manage DPR/frame allocation based on hardware evidence; no unexplained non-stop background effects. Protect touch/keyboard focus and WCAG contrast.
- Every asynchronous action distinguishes proposed, pending, server-committed, rendered, playing and failed states. A background task must not steal focus.

[Implementation tasks](selecta-flow-implementation-checklist.md) · [Verification](selecta-flow-verification-matrix.md) · [NO-GO gates](selecta-flow-release-gates.md).
