# Selecta 3.0: audio ownership and playback lifecycle

Covers S3-0069-01, S3-0069-02 and S3-0069-08. The code is `web/src/audio/focus.ts` and `web/src/player.ts`.

Nothing here has been heard by a person. Automated tests watch the real Web Audio calls in a muted browser, which proves what was scheduled, not how it sounds.

## The one rule

One thing makes a sound at a time. The mix has one player for the life of the app. It is created once in `App` and kept in state, above every page, so a route change, the Stage, a sheet or a resize cannot start a second one. Pages and the mini-player only present it.

## States

| State | What's sounding | `owner` | `resumeAfter` |
|---|---|---|---|
| Idle | Nothing | none | false |
| Playing | The mix | none | false |
| Paused by the person | Nothing | none | false |
| Previewing, mix was playing | The preview | the preview | true |
| Previewing, mix wasn't playing | The preview | the preview | false |
| Previewing, then the person touched the transport | The preview stops | none | false |
| Another tab took the sound | Nothing here | none | false |

## Transitions

| From | Event | To | Why |
|---|---|---|---|
| Playing | A preview starts (`takeAudio`) | Previewing, will resume | The mix pauses and remembers it should come back |
| Previewing, will resume | The preview ends or is stopped (`releaseAudio`) | Playing | Nobody asked for silence |
| Previewing, will resume | Person presses play, pause, next, previous or seek | Their choice stands | `mainPlayerTouched` clears `resumeAfter` |
| Previewing, will resume | Studio stops or closes | Paused | Someone working in the Studio isn't done listening |
| Previewing | Another preview starts | Previewing | The old one is stopped first, and the resume intent carries over |
| Anything here | Another tab starts playing | Another tab has it | Intent is cleared, so nothing finishing here can bring the mix back over that tab |
| Playing | The system takes the sound (a call, for example) | Paused, with a notice | `onstatechange` keeps the screen honest |

## Stale events

Each press of play in `usePreview` has a session number. `onended`, `onerror` and a rejected `play()` from an older session are ignored, so they can't release the sound from the clip that replaced them.

`AbortError` from `play()` means the clip was changed or stopped on the way, and is not a failure. Before this was handled, previewing clip A and then clip B rejected A's `play()`, which released B's ownership and brought the mix back in underneath B. That was a real overlap bug, found while writing this audit.

## Every place that makes sound

| Place | Source file | How | Owner |
|---|---|---|---|
| Listen, mini-player, media keys | `web/src/player.ts` | `SetPlayer`, Web Audio | The mix |
| Inspector, word connection preview, coming seam | `web/src/ui/AudioPreview.tsx` | `<audio controls>` | One id per preview |
| Bridge transition previews | `web/src/audio/focus.ts` | `usePreview`, one shared `Audio` element | One id per panel |
| Harmonic matches | `web/src/views/Links.tsx` | `<audio>` | `harmonic-discoveries` |
| Stem Studio | `web/src/views/Studio.tsx`, `web/src/studio.ts` | `StemDeck`, its own Web Audio context | `studio-<position>-<song>` |
| Blind study A and B | `web/src/views/Listening.tsx` | `<audio controls>` | `listening-<trial>-a`, `listening-<trial>-b` |
| A phone or other device chosen as the speaker (later Cloud work) | `web/src/devices/PlayingBar.tsx`, `web/src/devices/audioSpeaker.ts` | One `<audio>` element on that device | The device lease: a device that loses it fades out, so only one device plays |
| Cloud library player (Cloud mode only) | `web/src/cloud/Library.tsx` | One `<audio controls>` | The Cloud page, which has no local mix player beside it |
| Cloud media context ownership (Cloud mode only) | `web/src/cloud/cloudMediaContexts.ts` | Acquires and releases Cloud media contexts | The active Cloud playback lease |
| Cloud transport dock (Cloud mode only) | `web/src/cloud/CloudTransportDock.tsx` | Dock transport and managed audio controls | The Cloud speaker session |

Export makes no sound. Its result is a downloaded file. `tests/test_s3_docs_contracts.py` fails if a file under `web/src` starts sound (`takeAudio(`, `new Audio(`, `<audio`, `new AudioContext(`) and isn't named in this table (audit rerun 2026-11-11).

## When audio fails

| Failure | What happens | What the person sees |
|---|---|---|
| Browser won't start sound without a tap (`resume()` never answers) | `wake` stops waiting after 3 seconds | "Your browser is holding the sound back. Press play to start." |
| Rejected `play()` on a preview | Sound is given back, unless it was only replaced | "That couldn't be played." or a reload button |
| Song is missing (404) | Player returns to idle | "That song isn't available." |
| Song can't be decoded | Player returns to idle | "That song's audio couldn't be read." |
| Seam not ready in time | The song plays on, and the next one fades in | A notice on Listen |
| Seam failed | Selecta picks another move for that seam | "That move couldn't work into X, so Selecta picked another." |
| System suspends the sound | Phase becomes paused | "The sound was interrupted. Press play to carry on." |

## What was deliberately not changed

Seam scheduling in `SetPlayer` is untouched: the sample-accurate start, 30 ms crossfade and fallback fade work exactly as before. `S3-0069-07` asks for continuity measured apart from animation. The existing Listen browser tests measure scheduling from the real `AudioBufferSourceNode.start` calls, and no animation is involved in those numbers.
