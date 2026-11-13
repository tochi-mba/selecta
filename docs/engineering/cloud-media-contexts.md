# Cloud media contexts (ADR-0419, AV-0419-01)

Every place the SelectaDJ Cloud site makes or measures sound, who owns it, and how it behaves
under the `cloud.single_audio_owner` flag. The machine-readable list is
`web/src/cloud/cloudMediaContexts.ts`; `web/src/cloud/apaCloudMediaContexts.test.ts` scans
`web/src/cloud`, `web/src/rooms` and `web/src/devices` and fails when a media element or audio
context appears in a file that is not registered there with the same count.

## Inventory

| Context | File | Kind | Owner and lifetime | Flag off (before ADR-0419) | Flag on |
| --- | --- | --- | --- | --- | --- |
| Library player | `web/src/cloud/Library.tsx` | `<audio controls>` | Library page; unmounts when the person leaves the page | Plays a run of library songs; stops on navigation | Not rendered; the page plays through the dock |
| Dock Library player | `web/src/cloud/CloudTransportDock.tsx` | `<audio controls>` | The transport dock, mounted by `CloudApp` above the pages | Not mounted | Same run, buffering and URL refresh as before; keeps playing across pages; focus `library` |
| Session speaker | `web/src/devices/PlayingBar.tsx` (driven by `devices/audioSpeaker.ts`, `devices/usePlaybackDevice.ts`) | `<audio preload="auto">` | The "Playing on ..." bar; holds the playback lease while it is the speaker | Lives on the Listen page only; leaving Listen unmounts it, stops the sound and lets the lease lapse | Lives in the dock from the first Listen visit; keeps the lease and the sound across pages; focus `device`; media failures recover (`cloud/recoveringSpeaker.ts`) |
| Device check | `web/src/devices/DeviceCheck.tsx` | `AudioContext` | Settings > Device check | Reads the sample rate, closes the context | Unchanged; silent, never takes focus |

Not Cloud media contexts, listed so nobody adds them by mistake:

- `web/src/audio/focus.ts` (`new Audio()` for local previews) belongs to the local app's audio
  owner model (ADR-0114, ADR-0389). No Cloud file imports it.
- `web/src/devices/deviceInfo.ts` only tests whether `Audio` or `AudioContext` exists.
- `web/src/rooms/*` (guest and host room pages) make no sound; the room's "Play here" uses the
  session speaker above.

## Rules with the flag on

1. One transport: both sound sources live in the dock, so navigation never stops either.
2. Exclusive focus: a source that starts playing claims focus and the other one pauses. The
   speaker keeps its lease while paused, and its next heartbeat reports the pause to every remote.
3. Explicit Pause stays paused: nothing in the transport resumes a source, not when the other
   source stops, not when the page changes, not after a link refresh that happened while paused.
4. Songs are addressed by stable asset id. Listen reads the whole library page by page with the
   server's cursor (no 200-song cap) in append-only oldest-first order
   (`web/src/cloud/cloudCatalogue.ts`). The playback session still stores a position; a
   position, once played on a device, stays pinned to its asset id there.
5. Media failure: the Library player refreshes a link once, then moves to the next song and says
   which song was skipped. The speaker refetches once, then moves to the next song and says so;
   at the end of the list it stops and says so.

## Rollback

Turn `cloud.single_audio_owner` off (`SELECTA_FLAGS=-cloud.single_audio_owner`). `CloudApp`
stops mounting the dock, `CloudListen` renders its own bar with the original one-page source and
`LibraryPanel` plays through its own element, exactly as before.
