# Audio ownership and interruptions

The owner/preview state machine is documented in [selecta-3-audio.md](../selecta-3-audio.md)
(states, transitions, stale-event rules); it still matches `web/src/audio/focus.ts`. This page adds
the physical interruption states from ADR-0254 and ADR-0093, as implemented in `web/src/player.ts`.

## Interruption states

| State | How it is detected | What the screen says | Resumes by itself? |
|---|---|---|---|
| Paused by the person | Pause / Space / media key (`mainPlayerTouched`) | Play button shows Play | never |
| Suspended by the system (call, another app) | `AudioContext.onstatechange` leaves `running` while playing, not during an intentional hold | "The sound was interrupted. Press play to carry on." | never |
| Output changed, context still running | `mediaDevices` `devicechange` | "Audio output changed. Check your speakers or headphones if you cannot hear the music." | keeps playing; no claim the device makes sound |
| Output changed, context stopped | `devicechange` with context not running | "Audio output changed. Press play to reconnect the sound." | never |
| Page away (sleep, back-forward cache) | `pageshow` with the context not running | "The sound stopped while this page was away. Press play to continue." | never |
| Song audio missing | fetch/decode failure | names the song; the next song plays; the last one stops with a reason | moves on only within the mix |
| Another tab took the sound | `BroadcastChannel` "selecta-audio" (`state/tabs.ts`) | "Playing in another tab now. Press play here to bring it back." | never |

Every row is feature-detected: if `mediaDevices` or `pageshow` is missing, those notices simply
never appear and playback is unaffected. Nothing ever resumes after a deliberate Pause, and the
position (song and seam) is kept because the player pauses rather than reloading.

## Where each surface takes the sound

Listen and the mini-player (the mix); transition previews in Edit and the inspector; Discovery
word-pair and harmonic auditions; Studio previews; request bridge previews; the listening study's A
and B clips. All go through `takeAudio` / `releaseAudio` in `web/src/audio/focus.ts`; none creates a
second `AudioContext` for the mix.
