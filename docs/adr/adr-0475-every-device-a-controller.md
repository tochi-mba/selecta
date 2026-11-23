# ADR-0475 - Every device a controller: who holds a song, who makes the sound

- **Decision:** Proposed (owner asked for the design on 2026-11-23; approval is the owner's).
- **Implementation:** In progress on branch `feat/controller`. Built so far: holdings that other devices can read, adding a request from any device (R4, in part), account-wide request search (R5, in part). Not started: R1 picker, R2 "Play on {device}", R3, R6, R7, R8, R9. See "What is built, and where it differs" below.
- **Independent verification:** None.
- **Programme/date/baseline:** Browser-first Cloud (BF); 2026-11-23; `main` at `bfcc5ed7`.
- **Existing ADR owners:** ADR-0415 (playback devices and sessions), ADR-0461 (remote control protocol: signed commands, fencing, take-over), ADR-0458 and ADR-0469 (song identity: one song, one fingerprint), ADR-0462 and ADR-0463 (shared shell, local-first surfaces), ADR-0416 (Rooms). None is replaced. This ADR adds the rules for a device that does not hold the music.
- **Flag:** everything here sits behind `devices.remote_control`. With it off the app behaves as before.

## The problem

In browser-first Cloud the music files stay on the person's devices. The account keeps each song's details (the catalogue), the mixes and the settings. A device was treated as useful only if it held the files: a phone with no music showed "Connect your music" on Listen, could not add a room request to the mix that the laptop was playing, and its song search only looked at what the phone itself could play. The owner's words: "I understand the music isn't on here but we should be able to still control the music, and search."

A phone may also hold music of its own, so the answer cannot be "phones are remotes". Any device may hold all, some or none of the account's songs.

## Decision in one paragraph

Every signed-in device can see and steer everything in the account. Only making sound needs the files. The account knows, for each device, which catalogue songs that device can open right now (its holdings). One device at a time is the speaker (unchanged). Any action that needs sound is carried out on the speaker, and the UI always names it. A device never tells the person to connect music as the only way forward when another of their devices can do the job, and never shows a control that cannot work.

## The model

**Song.** One row in the account's catalogue, identified by its fingerprint (ADR-0469). The same recording on two devices is one song.

**Holding.** A fact about one device and one song: this device can open this song's file now. A device's holdings change when the person connects a folder or files, when the browser drops the folder permission (most browsers do when the page closes), and when files move.

**Three holding states per device**, because browsers forget:

| State | Meaning | How it is known |
| --- | --- | --- |
| `now` | The device has opened the file in this page session. | The device reported it since its last page load. |
| `before` | The device held it last time but has not confirmed this session. It probably needs "Choose your music folder" again. | An older report, not refreshed this session. |
| `never` | No report that this device held it. | No row. |

**What a device reports.** The catalogue song ids it holds `now`, and nothing else: no paths, no file names, no folder names. It reports after an import or re-grant finishes, when the set changes, and once at page load (as `before` until confirmed). The report is a full set with a version number, sent only when its hash changed. A device that signs out or is signed out loses its holdings. A `before` holding older than 30 days is dropped.

**Speaker.** The device holding the playback lease (ADR-0415). Unchanged.

**Online.** The device's event stream or heartbeat was seen in the last 30 seconds.

## Rules

### R1. Who should play

When something must make sound and no speaker is playing, the app suggests a device in this order and always lets the person choose another:

1. The current speaker, if there is one (paused counts).
2. This device, if it holds every song of the mix `now`.
3. The online device holding the most songs of the mix `now`; ties go to the most recently active.
4. Otherwise nobody: say which devices held the music `before` and when each was last seen.

The picker lists each device with what it can do: "Laptop: all 12 songs", "This phone: 3 of 12", "Kitchen tablet: needs its music folder again". A device that is not online is listed and cannot be chosen.

### R2. Starting sound on another device

"Play on {device}" asks that device to become the speaker and start. The device itself performs the take-over (ADR-0461 keeps the rule that only a device can make itself the speaker); the request is a signed, expiring, targeted ask, not a remote take-over.

The target checks, in order, and answers with the first that fails:

1. It is signed in to the same account and the ask has not expired (10 seconds).
2. Its own "ask before playing here" setting. If on, it shows "Your phone asked to play here. Allow?" and waits.
3. It holds the mix's songs `now`. If its permission lapsed it shows "Choose your music folder again to play" and tells the asker `needs_music`.
4. The browser allows sound. A tab that has not been clicked this visit cannot start audio. Then it shows "Press Play to allow sound from this tab" and tells the asker `needs_gesture`.

The asker shows exactly what it was told: "Starting on Laptop…", "Laptop is asking to confirm", "Laptop needs its music folder again", "Laptop needs one press of Play", or after 10 seconds with no answer "Laptop didn't answer. Is SelectaDJ open on it?" It never claims sound started until the session shows the device as speaker and playing.

### R3. A song the speaker does not hold

Known before it happens, because holdings are known:

- In the mix view and Up next, a song the speaker does not hold `now` is marked "Not on {speaker}".
- Before starting: "Laptop has 10 of these 12 songs. The other 2 will be skipped." with "Play on a device that has all 12" when one exists.
- During play the existing ADR-0461 behaviour stands (the speaker reports the song unavailable and offers alternatives). Alternatives offered are only songs already in the programme, so a choice never silently fails. The speaker owns the programme while it plays.

### R4. Adding to the mix from any device (requests and "Request a song")

The mix belongs to the account. Any device may change it. The speaker hears the change, applies it and republishes its programme.

| Where the song is held `now` | What the row offers |
| --- | --- |
| On the speaker | "Add next" (or "Add to mix" when nothing is playing), with "Plays on {speaker}" when the speaker is not this device. |
| Not on the speaker, on another online device | "Add anyway" is not offered. The row says "Only on {device}. {Speaker} can't play it." with "Play on {device} instead" when that device holds the whole mix, else Dismiss. |
| Nothing playing, held by at least one device | "Add to mix", with where it will play by R1. |
| Only `before` somewhere | "{Device} needs its music folder again to play this." with Dismiss. |
| `never` anywhere | "No device has this song's file right now." with Dismiss and a quiet "Connect music here". |

If the speaker is offline when a song is added, the change is kept and shown as waiting: "Will be added when {speaker} is back." A room request is marked added only when the mix change is applied, exactly as when the host adds it on the speaker.

Counts ("Ready to add", the room pill, the side bar badge) count rows the person can act on from this device; the rest are counted separately as "waiting on a device".

### R5. Search

"Request a song" and the Library search look through the whole account catalogue from every device. Results are ordered: playable on the speaker (or by R1 when nothing plays) first, then held elsewhere, then held nowhere right now. Each result says where it would play only when that is not this device. "Nothing in your library matches that" appears only when the catalogue has no match.

### R6. Library

One list for the account on every device.

- Header: "2,864 songs" and then where they are: "All on Laptop. 310 on this phone."
- Row status: "This device", "{Device}" (the best holder by R1), "Needs its folder again on {device}", or "No device right now".
- Filters: All, On this device, Can play now, Needs attention.
- Row actions that need sound go to the speaker and say so.
- The large "This browser hasn't been given your music yet" card shows only when no device holds music `now`. When another device does, it is one quiet line: "This phone is a remote for Laptop. Connect music here only if you want this phone to make the sound."

### R7. A phone with its own music

"Connect music" on any device adds that device's folders or files. The import fingerprints each file. A song already in the catalogue is matched and becomes held by both devices; a new song is added to the account catalogue and is held only by that device. Nothing is uploaded.

Browsers cannot watch a folder in the background. "Watching" means: the device remembers what was connected, re-checks when SelectaDJ opens or when the person presses "Check for new music", and reports the change. Where the browser cannot keep folder access between visits (most phones), the app says so once and asks for the folder again when it is needed, never on every page.

### R8. Make a Mix and My Mixes

A mix made on any device is the account's mix. Making one on a device that cannot play it offers "Play on {device}" by R1. The mix maker only uses songs that at least one device holds `now`, and prefers songs the R1 device holds, so a mix made on the phone is playable on the laptop.

### R9. One wording for where sound comes from

"Playing on {device}", "Paused on {device}", "{Device} is offline", "Remote for {device}", "Playing here". Used identically in the Listen eyebrow, the mini player, the room pill tooltip and the Devices page.

## Edge cases and what happens

| Case | Behaviour |
| --- | --- |
| Speaker's tab is closed mid-song | Controllers show "{Device} is offline" within 30 seconds; presses wait and are delivered or dropped on return (ADR-0461). Offer "Play on…" another holder. |
| Speaker reloads and the browser dropped its folder | Its holdings fall to `before`. It shows "Choose your music folder again". Controllers show "{Device} needs its music folder again". |
| Two controllers press at once | Unchanged: sequence numbers and idempotency keys (ADR-0461). The second sees the new state. |
| Two devices both believe they are speaker | Unchanged: fencing. The stale one fades out and says where playback moved. |
| Phone is the speaker and a call or another app takes audio | Its output status becomes interrupted; controllers say so; nothing claims it is still audible. |
| A request names a song only the phone holds while the laptop plays | R4 row two. No silent skip. |
| A guest requests a song no device holds now | The host sees R4 row five; the guest sees the existing "can't fit this into the mix right now". |
| Controller is offline | It shows the last known state marked as such, queues nothing that needs the server, and says "You're offline" only for real network loss (a refused or blocked request is "couldn't reach SelectaDJ", never "offline"). |
| Target tab has never been clicked | R2 step 4: one press on that device, and the asker is told. |
| "Ask before playing here" is on | R2 step 2. |
| The same song as two different files | Two fingerprints, so two songs, as today (ADR-0469 handles duplicates). |
| A device is renamed | Names are read live; no stored text contains the old name. |
| A device is signed out or the account signs out everywhere | Its holdings are deleted. If it was speaker, playback stops (existing). |
| The ten-device limit | Unchanged. Holdings are stored per signed-in device only. |
| A very large library (20,000 songs) | Holdings are sent as one compressed set only when their hash changes; the catalogue is read in pages and cached on the device; search runs on the cached catalogue. |
| A song is removed from the account | Its holdings go with it; it leaves mixes by the existing rules. |
| Holdings are stale (the device has not been seen for weeks) | Shown as "last had its music on 3 Nov", never as playable. Dropped after 30 days. |
| Flag off, or a plan without remote control | Everything behaves as before this ADR. |
| An older app version that reports no holdings | Treated as unknown: the device is listed without a song count, can still be asked to play, and answers for itself. |
| Privacy | Holdings are catalogue ids per device. No path, file name or folder name ever leaves a device. |

## What is built, and where it differs (kept true to the code)

**Holdings use what the server already kept.** The account already stored, for each device and song, a `present` flag and when it was reported (`local_song_availability`, written by `POST /api/local-media/availability`, with reports older than 30 days no longer counted). That is the holding. No second table was added. `GET /api/local-media/holdings` (under `devices.remote_control`) returns the person's signed-in devices with a song count, the time of the newest report and `online`; with `?device_id=` it also returns that device's catalogue ids. Ids only.

**The three states are two facts, not a stored state.** The server keeps "this device reported it holds the song" and "this device was seen in the last 30 seconds". `now` is read as held and online; `before` as held and not online. A device whose browser dropped its folder but which has not yet sent a new report still counts as holding until it reports, so `now` can be wrong for the first moments after such a reload. The stricter rule in "The model" (a report made since the last page load) is not built.

**Online** comes from the device's own playback reads: every signed-in page reads its playback session every one to two seconds, and that read notes the device as seen at most once every 10 seconds. Before this, a device's last-seen time only moved when the page loaded.

**R4 as built.** A device that is not the speaker adds a song by sending the speaker `set_programme` with the song placed after the one that is playing and `keep_position` true (new: the session keeps its offset, so the music does not move). The speaker compares its own mix with the session's programme: when its mix changed it sends its own; when only the session changed it takes that order into its own mix (a new revision of the recipe it is playing) and keeps playing; when a song in it does not play there, it keeps its own mix and sends it again, so the asker sees the song did not join. The account's saved mix is therefore changed by the speaker, not by the asking device. A room request is settled by the speaker's own periodic look, exactly as when the host adds it there; on the asking device the row leaves the list for up to 30 seconds while that happens, and comes back if the speaker did not take it.

Of the R4 table, two rows are built: "on the speaker" (Add next, with "Plays on {speaker}") and "not on the speaker" ("{Speaker} can't play this: its file isn't there." with Dismiss and no Connect music button). The rows that need to know every other device's holdings for one song ("Only on {device}", "needs its music folder again", "No device has this song's file right now") are not built; they read as the second row. "Nothing playing" keeps the earlier behaviour. The separate "waiting on a device" count is not built. When the speaker has reported nothing, it is treated as able to answer for itself, and the row offers Add next.

**R5 as built.** With another device playing, "Request a song" looks through the whole account catalogue, with this device's own songs first. Results do not yet say where each would play (the row made from a result does), and the order does not yet put songs held nowhere last. The Library search is unchanged. With nothing playing elsewhere the search is as before.

## What is not decided here

- Shared volume for a personal session (the server refuses `set_volume` outside a venue zone).
- Moving a song's file from one device to another. Files never move.
- Background folder watching (not possible in a browser).

## Implementation checklist

1. Holdings: device reports, storage, expiry, and the devices list returning counts. Tests for report, replace, sign-out and expiry. **Partly done:** read route, counts, online, tests for report, replace, another person's device, a removed song and a stale device. Not done: the per-page-load `now` rule, a test for sign-out.
2. R4 add from any device, with room request bookkeeping. Tests for each row of the table. **Partly done:** two of five rows, with tests; proved in a browser with a laptop playing and a phone with no music, against a local API that had not loaded `keep_position` or the holdings route (so the song restarted on the laptop and the "not on the speaker" row was not seen live).
3. R5 account-wide search. **Partly done:** Request a song, with a test and seen in a browser. Not done: the result order and labels, the Library search.
4. R2 "Play on {device}" with each refusal reason. Tests for each. **Not started.**
5. R1 picker and R3 pre-flight line. **Not started** (the rule for the best holder exists as a function with a test, unused).
6. R6 Library header, row status, filters and the quiet line. **Not started.**
7. R7 wording for folder access that does not persist. **Not started.**
8. R8 mixes from any device. **Not started.**
9. R9 wording pass. **Not started** ("Plays on {device}" is new and follows it).
10. Browser proof with two real devices' worth of contexts: a laptop with all the music, a phone with none, and a phone with some. **Partly done:** laptop and phone with none, for R4 and R5 only.
