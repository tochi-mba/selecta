# ADR-0475 - Every device a controller: who holds a song, who makes the sound

- **Decision:** Proposed (owner asked for the design on 2026-11-23; approval is the owner's).
- **Implementation:** In progress on branch `feat/controller`. Built: holdings that other devices can read (every reporting device's ids, not only the speaker's), R2 "Play on {device}", R4 (all five rows and the counts), R5 (Request a song, in part), R1 picker judged by the mix, R3 pre-flight line and "Not on {speaker}" marks on a remote's Up next, R6 Library (header, row status, filters, the quiet line), R7 wording, R8 (the account's current mix), R9 for the playing bar. Not built: R3 marks in the mix editor, R5 order and labels. Proved in a browser with three devices and a guest on 2026-11-24 (checklist item 10). See "What is built, and where it differs" below.
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
- Row status: "This device", "{Device}" (the best holder by R1), "On {device}, open {when}" with the one hint "Open SelectaDJ on {device} to play this." and no Play button (I86), or "No device right now".
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

### R1, revised (2026-11-24): which device plays, and the default speaker

The one function: `whereToPlay(situation)` in `web/src/devices/whereToPlay.ts` (stable signature: a `Situation` of the person's devices with what each holds, the session's speaker and whether it is online, the default speaker's id, this device's id, the songs about to play and each device's song ids; it answers a `Choice`). The server applies the same order to a room's library in `room_speaker(conn, workspace_id, holds)` in `src/selecta/playback/default_speaker.py`. Every way of starting music in the local-first shell (Make a Mix, My Mixes, Listen, the play bar, Add next with nothing playing, an asked device) goes through the shell player's `playFrom`, which asks `useWhereToPlay().decide()` first. Lucy's tools and answer cards should call the same two functions; the start itself is the existing start-ask (expiring, one answer per ask) or the session's take-over (fenced), so a press sent twice does not start twice.

1. The session's speaker, while it is online (playing or paused).
2. Else the default speaker, when it is online and holds at least one song of what is about to play. It wins even when another device holds more; the device that would have played says "Playing on {default}." with "Play here instead", and when another open device holds the whole mix the default is still used (the not-on-speaker marks say what it lacks).
3. Else the only online device that holds some of it; when the default is the one away: "Playing on {device} because {default} isn't open."
4. Else, with two or more, "Where should the music play?" (`devices/SpeakerPicker.tsx`): each device with what it holds of this mix, the most first, then this device, then the most recently active, one "Suggested"; devices that cannot play listed disabled with the reason ("isn't open right now", "needs its music folder allowed again", "has no music connected", "has none of these songs"); same names told apart ("This device", "Last seen 10 minutes ago"); "Make this my default", saved on Confirm. Cancel, Escape or the backdrop choose nothing. The order is fixed once shown.
5. Else no Play: "None of your devices with music is open right now." with Connect music here.

**Default speaker.** One per workspace (`playback_default_speakers`, migration `bf0478speaker01`, workspace isolation policy), set with `PUT /api/devices/default-speaker` under `devices.remote_control`, only to the caller's own signed-in device (404 otherwise), returned with `/api/devices` and `/api/local-media/holdings`, cleared when that device is signed out. The Devices page offers "Make default speaker" on a device that holds music, marks "Default speaker" (or "Default speaker, no music connected"), and "Not the default" clears it. Setting it moves nothing playing ("Used the next time nothing is playing.").

**Rooms use the speaker's library.** A browser-first room offers its guests only the songs held now by the device `room_speaker` names (the session's speaker while its lease holds; else the rule above). The guest payload carries `music`: ready, choosing, reconnecting (the lease lapsed under five minutes ago) or none, and the guest page says "The host is choosing where the music plays.", "The music is paused while the host's device reconnects." or "The host hasn't connected any music yet." without naming a device, keeps the typed search and runs it again when the music is back. A request for a song the speaker no longer holds says "That song isn't available right now."

**Streaming a song from another open device: considered, not built.** It would need a second upload path, costs the other device's battery and data, and leaves a gap when that device sleeps. A song only on another open device keeps "Only on {device}. {Speaker} can't play it."

**Built since (2026-11-24, later):** a device that does not answer an ask within 8 seconds (`START_ASK_WAIT_MS`), or that the server refuses as not open, is left out for that press: "{Device} didn't answer." / "{Device} isn't open right now." with Try again and Choose another device, which runs the rule again and says "Playing on X because Y isn't open." (A1). A room keeps its speaker's songs for 12 seconds after the lease lapses before guests hear it is reconnecting (A2, `GRACE_SECONDS`). Two devices pressing Play at once: the take-over is a conditional write under the session lock (observed owner: nobody), so exactly one wins (B11, concurrent test). A signed-out device of the person's own is refused 409 `device_signed_out` (C17); the default's device id is a foreign key with ON DELETE CASCADE (C18); a change is published as `devices.default_speaker` and every open device reads again on it and on reconnect (C19). Media keys and the lock screen are registered only by the tab making the sound (F47).

**Rerun (2026-11-25, main checkout, seeded stack):** "Play here instead" on the phone won over the laptop it had asked (the press takes over from whoever plays by then); the laptop as a remote set 40, 0, 100 and the phone's gain followed to 0.4, 0, 1; the phone said "Volume changed from Edge on Windows." (G70). Two remotes at once, set with pointer-style input rather than key presses (the earlier mismatch came from the harness pressing keys): the session, both sliders and the speaker's gain all settled on 20.

**Remote volume proved (2026-11-25, `ctl7.js`):** the laptop as a remote set 40, then 0, then 100; the phone (the speaker) ramped its gain to 0.4, 0 and 1, and the laptop said "For more volume, turn up Firefox on Android itself." at 100. In an earlier run two remotes dragging at once settled on one value (60). "Play here instead" on the phone won over the laptop it had asked (the asked device stands down when another became the speaker meanwhile).

**Proved in a browser (2026-11-24, `ctl6.js`, laptop 1440x900 with 14 songs, phone 360x740 with 4, a guest on `/r/{code}`):** Play on the phone with no default opened "Where should the music play?" (the laptop first and Suggested, "11 of 12 songs"; the phone "This device, 3 of 12 songs"; old devices of the same name disabled "isn't open right now"); with "Make this my default" ticked the laptop played and the Devices page marked it "Default speaker". A guest's search for a song only on the phone found nothing while the laptop played. With the laptop closed, the phone's Play was refused by the laptop (still counted open for up to 30 seconds), said "Edge on Windows isn't open right now." with Choose another device, and played on the phone; the guest's search then found the phone's song. Tabs (`tabs.js`): two tabs of one browser, the hand-over traced in both (ask, stop, release, grant, take-over); 0 of 40 samples with both sounding; when the playing tab closed, the other carried on by itself.

### R10. One device, many tabs

Two tabs of one browser share one device id and both could take the speaker's part: reproduced with two pages in one browser (40 of 40 samples with both tabs producing sound). Now a Web Lock (`devices/audioTab.ts`, `selecta-audio:{workspace}`) decides which tab makes the sound. A press in another tab asks the holder over a BroadcastChannel to stop; it stops, then lets go, and only then does the new tab start. A reloaded or asked tab starts only if no tab holds the lock. Every other tab of the speaker says "Playing in another tab." with "Play in this tab instead". Asks to play from another device are answered by one tab (a second lock, `selecta-house:`). Without Web Locks a tab plays as before. Two different browsers or profiles are two devices, kept to one speaker by the server.

### R13. Playing Library songs from a remote (section I)

Walked first (2026-11-25, a phone with no music while the laptop played): the Library listed the whole account with "On Edge on Windows" and a long second line, and offered no way to play any of it: Start a mix needed the song on the phone, and Add to current mix never appeared in the browser at all (it needed a measured tempo).

Built: a song an open device holds is ready on a remote, with one plain line, "Plays on Laptop" (I83), and the Library's lead says "Your songs, and where each one plays." Start a mix, Add to current mix and Play next appear on its row; songs ready for a browser mix can be added by hand on any device. With another device playing, Add and Play next put the song into that device's programme (next, or at the end) with the same signed press a request uses, and Start a mix builds the mix and offers it to the speaker ("Your new mix is the current mix. Laptop is still playing the last one." with Play on Laptop now and Later), with no "Replace and play?" (I84). Proved (`ctl8.js`, 360x740): the phone added a laptop song and the laptop's programme went from 12 to 13; Start a mix from a row showed the offer. On a phone the Library on a remote is compact (I91): the page title is kept for screen readers only, the intro, count and where the music lives fold into one line ("All on Laptop"), Connect music is a small secondary action, search, filters and sort stick to the top while scrolling, the filter chips fade at the edge instead of cutting off, and sort sits beside the filters with its label kept for screen readers. While another device plays, the row's one button is "Play next", labelled "Play {song} next on {speaker}" for screen readers, and the row itself says "Added to {speaker}'s mix" for three seconds; a song already in the speaker's mix says "In the mix" instead of offering the button. Proved (`ctl9.js`, 360x740 and 390x844): the page title is hidden visually, the phone's search stays under the top bar while scrolling (its top at 56 px below the 48 px bar), the page never scrolls sideways, the row button's label read "Play Last Night next on Edge on Windows", the row said "Added to Edge on Windows's mix", and the laptop's programme went from 12 to 13.

Built (I85): a Library song the speaker lacks but another open device holds is never refused. Its row's button reads "Play on {device}" (for a screen reader, "Play {song} on {device}"), and pressing it, or Add or Play next from the menu, asks "{song} is on {device}. Move the music there?" with Move and play and Add it later. Move and play makes a mix of that song followed by the speaker's song and what came after it ("Moved to {device}"), makes it the account's current mix, and asks that device to play it with a start ask marked `move`, which the asked device answers by taking the music over (as Play here instead does) instead of standing down because another device plays. Add it later puts the song at the end of the current mix. A song no open device holds keeps the old line, "{speaker} can't play this: its file isn't there." Proved (`ctl10.js`, three browsers: a laptop playing 12 songs, a Mac holding 8 others, a phone at 390x844): the phone's row read "Play As It Was on Chrome on Mac", the offer showed, and after Move and play the Mac was the speaker playing As It Was first while the laptop's session showed it playing elsewhere.

Built (I86, I87, I89): a song whose only copies are on closed devices reads "On {device}, open {when}" with the one hint "Open SelectaDJ on {device} to play this." always shown and no Play button. On a remote whose speaker has gone, the music is not there: the Library names the best open device instead, a row's button is Start a mix again, and starting asks no "Replace your current mix?", so the device rule picks where it plays (the only open device with the songs, the default speaker, or the picker). The row of the song playing now says "Playing now on {speaker}", and the play bar names the device. Proved (`ctl11.js`, a laptop holding 12 of 24 songs, a phone at 390x844, the session's old speaker gone): the phone showed "On Edge on Windows, open just now" with the hint for the 12 others, Start a mix from Anti-Hero made the laptop the speaker and playing with no question, and the Anti-Hero row said "Playing now on Edge on Windows".

Built (I88): on a remote with music playing, the selection bar offers "Play next on {speaker}". When some chosen songs are only elsewhere it first says what will happen, "12 of 24 can play on Laptop. 12 are only on Tablet.", with "Play the 12" (those songs go in next, in the order shown, in one signed press) and "Choose another device", which lists each open device holding some of them ("Play 8 on Tablet"); choosing one makes those songs a mix and moves the music there as Move and play does. Proved (`ctl12.js`, laptop playing 12, a Mac holding 8 more, phone selecting all 24): the bar said "12 of 24 can play on Edge on Windows. 12 are only on Chrome on Mac.", Play the 12 took the laptop's programme from 12 to 24, and Play 8 on Chrome on Mac made the Mac the speaker, playing the first of its 8. Found in that run and fixed: after a move the session kept the old speaker's programme (24 entries), because the new speaker's first send of its own went out before it was the speaker and the next try waited 10 seconds per programme; an untaken send now tries again in 2 seconds, and the rerun showed the Mac sending its 8 songs and the session holding 8.

Built (I90): a song's details on a device that is one of several have "Where it lives": this device when it holds the file, each open device ("Open now", or "Open now, playing the music" for the speaker) and each closed one ("Last open 4 minutes ago"), its versions when there are several (format, length, whether on this device, the one mixes use), and one line naming the device where changes that need the file are made. While another device plays it offers "Play next on {speaker}" when the speaker has the file, or "Play on {device}" (the I85 move) when only another open device has it. Proved (`ctl11.js`, phone at 390x844): Calm Down's details listed the laptop as open and playing, with Play next on Edge on Windows; As It Was listed Chrome on Mac, last open 4 minutes ago, with the file line.

Built (I92): the Library opens from the catalogue kept in this browser and replaces it with the server's list when that arrives. A device reporting its songs now publishes `devices.holdings`, and every other open device reads the holdings again at once (also when its page is looked at again), instead of on its next 15-second look; a device that closes drops out when it stops being seen for 30 seconds. Proved (`ctl13.js`, phone at 390x844): five rows of a Mac's songs read "Plays on Chrome on Mac" 3 seconds after the Mac added them, they went back 30 seconds after the Mac closed, and a reload showed the first row in 1.7 seconds.

Section I is built.

### R12. One account per browser profile, and every tab agrees

What happened before (reproduced 2026-11-25, two tabs of one browser): signing out in tab 2 stopped tab 1's music within a second (the app unmounted when its session ended), but tab 1 said "You were signed out. This session was ended, for example by 'Sign out everywhere' or a password reset", which is not what happened; nothing asked first; the device stayed signed in on the server.

Built (`web/src/cloud/accountTabs.ts`, `CloudApp.tsx`): a sign-out or sign-in is told to every tab of the browser over a BroadcastChannel (the `storage` event where there is none). Before signing out, the tab asks the others what they are doing and, when any is playing, hosting an open room or importing, confirms first ("Signing out stops the music.", "...closes your room for guests", "...pauses adding your music"). Signing out first signs this device out on the server, which ends its playback cleanly (the account's other devices see it stopped, not reconnecting), clears it as the default speaker and takes it off the device list. Every other tab then shows one calm page: "You signed out in another tab." with Sign in. When another account signs in in a tab, the others say "Signed in as {email} in another tab." with Continue, which reloads (every per-account cache in memory goes with the page); when the same person signs back in, they reload into the app with nothing playing. The audio lock is named by workspace and the house lock by device, so a tab of one account never holds a lock for another. SelectaDJ is signed in to one account per browser; a second account needs another browser profile. Guest, display and kiosk pages have their own tokens and are not affected.

Proved (2026-11-25, two tabs of one browser, `signout.js`): tab 1 playing as the dev account; Sign out in tab 2 asked first ("Signing out stops the music." with Cancel and Sign out); tab 1 was silent 159 ms later and showed "You signed out in another tab."; when tab 2 signed in as another account, tab 1 said "Signed in as {email} in another tab." with Continue, showing nothing of the first account.

Proved (2026-11-25, `ctl17.js`, two tabs of one browser and a phone): tab 1 played as the dev account; Sign out in tab 2 asked first and tab 1 was silent 104 ms later with "You signed out in another tab."; tab 2 signed in as a second account, finished getting started later, connected four songs and played them (sound in tab 2) while tab 1 stayed silent on "Signed in as {email} in another tab." with Continue. The first account's phone (360x740) then showed "Nothing is playing" with "None of your devices has music connected yet." (the laptop had signed out), and its Devices page listed the phone as This device with Rename and Sign out, the same-named phones numbered.

Not built yet: the 401-on-next-request and focus checks as extra triggers (the server's session end already reaches the tab), drafts kept per account, and a browser proof of the new path.

### R11. A remote can do what the speaker's screen can (capability table)

A remote is any signed-in device of the same person that is not making the sound, including another tab. It can do everything the speaker's own screen does to the music, except what needs the speaker's hardware or files.

| Control (speaker's screen) | From a remote today | How |
| --- | --- | --- |
| Play, pause, next, previous, seek, skip to a song in Up next | Yes | Signed playback commands (ADR-0461), applied by the speaker once, in order |
| Volume and mute | Yes (G1, 2026-11-24) | `set_volume` on the session (every session carries `volume` now), last write wins; the speaker applies the session's level as it follows and sends its own only when its own slider moves; a new speaker rises from quiet over a second; unset plays at 80; at 100 "For more volume, turn up {speaker} itself." |
| The speaker's screen says what changed elsewhere | Yes (G70) | "Volume changed from Phone.", "Paused from Phone.", "Skipped from Phone.", "Went back", "Muted", "Up next changed" for four seconds on the speaker, never for a seek within the song |
| Add next, add a request | Yes (R4) | `set_programme` with the song after the playing one, `keep_position` |
| Reorder, remove, clear Up next, with undo | Yes (G2, 56) | Edit on the remote's Up next: move up, move down, remove, Clear (asked first); one `set_programme` with `keep_position`, and Undo from the toast sends the order back |
| Start a mix, a saved mix, Make a Mix | Yes (R8) | The account's current mix, played through the one rule (Play on {device}) |
| Stop (end the session) | Yes (G2, 57) | The `stop` command: the session is stopped and the speaker's lease runs out 5 seconds later (`STOP_GRACE_SECONDS`), so the speaker is free and any device may start; the speaker fades out |
| Play here instead, move to another device | Yes (G2, 58) | "Move the music" on the remote lists Play here instead and Move to {device} for each open device with music, saying first what it lacks ("Has 8 of 10 songs. 2 will be skipped."); a start ask marked `move`, which the asked device answers by taking over from the session's song and place |
| See what plays, position, Up next, the speaker's state | Yes | The session, the anchor and the server clock |
| Never play, per-song actions | Yes | Account-wide routes (`/local-media/songs/never`) |
| Rooms: open, close, approve, add, dismiss | Yes | The rooms routes are the account's, not the speaker's |
| Check the speaker for new music | Not built (G2, 63) | A browser can rescan a remembered folder only while it still has read permission, and asking again needs a press on that device; the remote would need a delivered ask and a progress report. Recorded, not built |
| Sleep timer | Not built; considered (G2, 64) | Needs a stored deadline on the session and the speaker stopping itself at a song's end; Stop covers the immediate case |
| Maximum volume on the speaker | Not built; considered | |
| Media keys and lock screen on the remote | Not possible without the remote making sound; not faked (G2, 66) | Browsers show lock-screen controls only for a page playing media; SelectaDJ does not play silent audio to fake them |

### R11, what a remote can do (G2, items 55 to 66), as built

- **Transport (55).** Play, pause, next, previous (restart after 3 seconds), seek by drag and by key, and a tap on a song in Up next plays it now. Each press is pending until the speaker confirms and says when it didn't (G3 below).
- **Queue (56).** Up next is live from the session. Edit shows each song with Move up, Move down and Remove; Clear asks "Clear Up next on {speaker}?" and keeps the playing song and the next one ("a mix keeps at least two songs", the browser mix's rule; Remove is off for the last one). Each change is one programme change that keeps the music where it is, with Undo in the toast for a few seconds (`RemoteQueue.tsx`). Add next and Add to the end come from the Library (I84).
- **Start and stop (57).** Any mix, song or saved mix starts through the one rule (R1, R8). Stop is not Pause: it ends the music on the speaker and frees it.
- **Move the music (58).** `RemoteMove.tsx`, while another device plays; the asked device starts at the session's song and place when its mix is the programme (`movedFrom` in `playOn.ts`).
- **See everything (59).** Title, artist, place in the mix, position from the server's anchor, Up next, the device and its state ("Playing on", "Paused on", "Stopped on", "{device} is offline") and its sound. Not shown on a remote: the coming transition and artwork (the remote has no audio analysis).
- **Per-song actions (60)** and **rooms (62)** are account routes, so a remote does what the speaker's screen does. **Mix settings (61)** are the mix editor's on any device; a changed mix is the account's current mix and is offered to the speaker (R8) rather than applied under the music.
- **Lucy (65).** Lucy's tools act through the same functions: `useWhereToPlay().decide()` and the start ask to start music, and the remote's `send(command, args)` (`useRemote`: `toggle`, `next`, `previous`, `seekTo`, `skipTo`, `setVolume`, `stop`, `setUpNext`) for everything after, so a Lucy press is a press like any other.
- **Proved (2026-11-25, `ctl15.js` and `ctl15b.js`, laptop 1440x900 playing 10 songs, a phone at 360x740, a Mac at 820x1180 holding 7 of them).** On the phone, Edit, Move Calm Down down: the laptop's programme swapped the two songs; Remove Creepin': the programme went from 10 to 9; Undo: back to 10 in the earlier order; Clear asked first and left the playing song and the next one (2), the laptop said "Up next changed from Chrome on Android." and kept playing; Undo: 10 again. Move the music listed "Chrome on Mac, Has 7 of 10 songs. 3 will be skipped." with Move to Chrome on Mac; pressed, the Mac became the speaker playing the same song at 62.4 seconds (the laptop had been at 56.7 seconds), and the phone said "Playing on Chrome on Mac". Stop: the Mac said "Stopped from Chrome on Android." 0.75 seconds later, and within 10 seconds nobody was the speaker and the phone showed "Nothing is playing" with Play on each device. Found in the runs and fixed: Clear sent an Up next with no songs, which the speaker refused (a browser mix keeps two); a move named the account's saved mix rather than the programme that plays, so the Mac answered it had no music for it (a move now carries the programme); the Mac never said "Stopped from" when its session look had already let the sound go before the stop's event arrived; and the phone kept "Starting on Chrome on Mac..." after the move (the ask is now forgotten when the speaker changes).
- **Not built:** rescan on the speaker (63), a sleep timer (64), lock-screen controls on a remote (66); reasons in the table above.

### R11, rules for every remote control (G3, items 67 to 71)

- **One command path (67).** Every press from a remote is `POST /api/playback/commands` with the session `seq` it was based on, the fence it saw and one idempotency key per press (`web/src/devices/usePlaybackDevice.ts`, `send`). A press that got no answer though the network is up is sent once more with the same key, so it is applied once. The server applies each press once, in order, under the session lock; a press based on an older `seq` is refused `stale_command` (volume excepted: a level, last one wins). Two remotes pressing Next from the same state make one skip: the second is stale, and its remote says nothing because the music already moved on from where its press saw it.
- **Confirmed by the speaker (68).** The session takes a press at once, but the session is not the sound. A remote that sent play, pause, skip, seek or stop reads `GET /api/playback/commands/{command_id}` (its own presses only; anyone else's is 404) until the speaker acks it or has reported where it is at that press's state (`followed`), for up to 7 seconds (`pressConfirm.ts`, `CONFIRM_MS`). Meanwhile the transport is marked busy (`aria-busy`). Unanswered, the remote says "{Speaker} didn't answer. Nothing changed there." and shows the session as it was before the press (state, song and place) until something newer happens or the speaker carries it out late (watched for the rest of the press's 60-second life). A press that never reached SelectaDJ says "You're offline, so that press wasn't sent." only when the network is gone, else "Couldn't reach SelectaDJ, so that press wasn't sent. Try again."
- **Who may control (69).** Only the person whose device is the speaker, from their own signed-in devices. A workspace's personal session can be another member's (a shared organisation workspace): a press from a device of someone else is refused 403 `not_your_music`, "That music is playing on someone else's device." No existing permission grants more; venue zones keep their own model (ADR-0443). A signed-out device is refused at once (403 `device_signed_out`), and so is a device id that is not the caller's own (404).
- **The speaker says what changed (70).** On the speaker's own screen, for four seconds: "Paused", "Playing again", "Skipped", "Went back", "Volume changed", "Muted", "Up next changed" or "Stopped", each "from {device}." Never for a seek within the playing song (`ChangedFromLine.tsx`, `changeWords`).
- **Proved (2026-11-25, `ctl14.js`, laptop 1440x900 playing 10 songs, phones at 360x740).** Pause from the phone: the transport was busy at once, the button flipped to Play when the laptop confirmed (0.9 to 2.5 seconds), and the laptop said "Paused from Chrome on Android."; Play again likewise. With the laptop's page stopped (its script paused, as a hung tab), the phone's Pause said after 8 seconds "Edge on Windows didn't answer. Nothing changed there." and still showed Playing and Pause; when the laptop ran again it carried the press out and the phone showed Play within 2 seconds. Two phones pressed Next together: the song moved from 1 to 2, and neither phone said anything. Offline, the phone said "You're offline, so that press wasn't sent." and kept Pause. Found in the run and fixed: the eyebrow said "Paused on" while the controls still showed the speaker playing (every line now reads the confirmed session), and a "couldn't play that song" from an earlier press was shown to a phone that opened later although the music had moved on (an unavailable ack is now reported only while the session is still at that press's state).
- **Flag off (71).** With `devices.remote_control` off the command and outcome routes are refused by the flag guard, the speaker applies nothing from another device, no remote page or line is drawn, and the shell's layout is as before.

### Audit (to-do T-c691, 2026-11-25)

- **A downgrade with a room open.** The server already let every route after opening through (only opening a room checks the plan), but the host's Rooms page showed only the "Rooms are part of Premium" card once the plan lost Rooms, so the open room vanished from the host's view while guests kept using it. Now the page reads the current room on any plan; with a room open it shows the room as before with "Your plan no longer includes Rooms. This room stays open until it ends; opening a new one needs Premium.", and the card comes back when the room ends (`RoomPanel.tsx`, test in `RoomPanel.test.tsx`).
- **Devices over the limit.** The eleventh sign-in signs out the least recently seen device, but never the device making the sound (a live lease), and the default speaker only when nothing else can go (`devices.register`, `_keep_signed_in`). A speaker whose lease has lapsed can still be the one that goes, which stops its session as before.
- **Default device names.** A new device named like one of the person's signed-in devices gets the next number ("Edge on Windows 2"), so pickers, lists and "Playing on" lines tell them apart; a name the person chose, and a device signing back in, keep theirs.
- **Room defaults.** The built defaults (3 waiting per guest, 20 an hour, a 20-minute replay wait, 50 waiting in the room, votes on, names hidden, no big screen, 12 hours, 60 minutes without a speaker) were set on purpose in `03a2a502`; 11a's table said 1, 3, 60 and 20 and now says what is built.
- **Sound edge cases.** Suspended audio and an output change were already said truthfully (the engine marks the output interrupted or unverified and remotes say "can't be sure it is making sound"). Sleep: the lease lapses, remotes say "{device} is offline", and on waking the speaker reconnects and carries on or fades out. A moved file is the R3 path ("couldn't play that song" with alternatives). New: a speaker page that reloads, or comes back after the browser discarded it, while the browser says it has had no press since loading, no longer starts silently while holding the lease; it tells the session the music is paused there and says "The music paused when this page reloaded. Press Play to carry on." Not proved in a browser: the harness browser reports a press after a reload, and its music was added by file picker, so a reloaded laptop has no files (it shows "Carry on here" from the one-tab rule instead). Found and left (to-do): a reloaded speaker whose other tab's lock lingers offers "Carry on here" while the session still says it plays until the lease runs out.

### Items A5, B14, C20, D29, D30 and E34 (2026-11-25)

- **A5, a ghost default.** When the default speaker is not open and another device plays instead, the note ("Playing on X because Y isn't open.") offers "Forget {device}" once that device has not been seen for 30 days (`GHOST_AFTER_SECONDS`); it signs that device out, which clears it as the default. The Devices page's Sign out does the same for any device at any time.
- **B14, a tap on the other device.** When the asked device's browser needs a press before it may make sound, the remote says "Waiting for a tap on {device}. Press Play there to allow sound." and never Playing before the speaker confirms; after 60 seconds with no start it says "{device} didn't answer." (`TAP_WAIT_MS`).
- **C20, export, deletion and a downgrade.** The account export marks the default speaker in `settings.json` (`devices[].default_speaker`). Account deletion removes it with every workspace row, and removing a device removes it by the database (C18). The device limit is the same on every plan (10), so a downgrade changes nothing here; when the limit is passed the default speaker is signed out only when no other device can go (audit, above).
- **D29, the room's big screen.** The display page says the same three states as the guest page: "The host is choosing where the music plays.", "The music is paused while the host's device reconnects." (headed Paused) and "The host hasn't connected any music yet.", from `music` on `/api/display/view`.
- **D30, a room with no device open.** A room opens when the account has songs but no device with music is open (`songs_waiting_for_a_speaker`); its guests are told the host is choosing, and the songs appear once a device opens. Not built: closing the room while the speaker picker is open does not close the picker (the picker is the Play button's, not the room's).
- **E34, no connection.** With no connection the one rule asks no device and opens no picker (what other devices hold may be stale); this device plays if it can, under the usual offline words, so there is never an empty picker.
- **Still open:** B7 (saying "Carrying on from {old} on {new}" when an offline speaker's mix resumes elsewhere), B16 (one-time offers remembered per account), F42 to F44 (housekeeping once per device across tabs, one tab scanning a folder, previews across tabs).

### Lessons from Spotify Connect and the form factors (2026-11-25, `ctl18.js`)

- **The speaker is not lost after a pause.** Paused from the phone for 35 seconds, the laptop stayed the speaker ("Paused on Edge on Windows"; it keeps checking in while paused), and Play from the phone started it again.
- **The play bar always says where it plays.** On a remote the mini player's second line is "{artist} · on {device}" (seen at 820x1180 on Library).
- **One picker.** Every start that must choose a device goes through `whereToPlay` and `SpeakerPicker`; "Move the music" on a remote lists only open devices with music for a music that is already playing.
- **Rename a device.** The Devices page has Rename on every device (seen at 360x740), and names are read live.
- **Sizes.** The remote at 360x740 and 820x1180 and the speaker at 1440x900 were opened and looked at; none scrolls sideways. Found: a laptop that was playing said "Safari on iPad 2 made a new mix." when a fresh tablet had only opened Listen and Library. Cause: the event stream replays its history to a device that has just connected; the tablet took each old `mix.current`, which set its pointer and told the account that old mix was current (one PUT per replayed event, 50 in one run), so the account's current mix changed under the laptop. Fixed: a value older than the one the device has already seen is ignored (`useAccountMix`). Proved (`ctl19.js`): the same fresh tablet made no PUT of the current mix and the laptop showed no offer.

### What a remote says about the speaker's sound (2026-11-25)

A remote said "{Speaker} hasn't confirmed its sound yet." under music that was plainly playing, because nobody had played the check tone on the speaker. That tone is the speaker's own business. A remote now says nothing about the sound while the speaker plays and reports where it is. It speaks only when the speaker truly can't make sound (the browser suspended its audio: autoplay blocked, a call, another app): "{Speaker} can't make sound right now. Press Play on {Speaker} to carry on." Whether the speaker is checking in at all is said by the state line ("has not checked in recently"). Proved (`ctl20.js`): a playing laptop gave the phone no sound line; with the laptop's audio suspended the phone said "Paused on Edge on Windows 3" and "Edge on Windows 3 can't make sound right now. Press Play on Edge on Windows 3 to carry on."

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

All five R4 rows are built. Each device that has reported holdings has its catalogue ids read (again only when its report changes), so the row for a song the speaker lacks says where the song is: "Only on {device}. {Speaker} can't play it." (another open device has it), "{Device} needs its music folder again to play this." (only a device that is not open has it), or "No device has this song's file right now." with a quiet "Connect music here" (offered only then). "Play on {device} instead" is not offered on the row; the remote's Listen offers it when the speaker is away (R1 below). With nothing playing on a device that lacks the file, the row says "Only on {device}. Start the music there to add it." and offers no Add: this device cannot add a song it cannot play to its own mix (R8 is not built). When the speaker has reported nothing it is treated as able to answer for itself, and the row offers Add next.

**Counts as built.** "Ready to add" in the Requests drawer, the room line and the side bar badge count only rows this device can add now (the device that would play the song holds it). Accepted room requests whose song waits on a device are shown in the room line as "N requests waiting on a device" and are not in the badge.

**R1, R2 and R3 as built.** "Play on {device}" is an expiring ask the asked device answers for itself (`POST /api/playback/start-asks`); it checks it has a mix, holds its music now, and that the tab may start sound, then takes over by its own action. On a device with no music while nothing plays, Listen is the controller page whenever the person has another signed-in device: with the mix's songs known (this device's current mix, or the account's newest saved mix read for its songs) each device says "All 12 songs" or "3 of 12 songs", the open device holding most of the mix is suggested, and when it lacks some: "Tablet has 10 of these 12 songs. The other 2 will be skipped." with "Play on {device}, which has all 12" when another open device does. On a remote, when the speaker is away or a press was answered `no_speaker`, Listen says so and lists "Play on {device}" for every open device with music (the R1 choice first) and "Play here" when this device holds songs of the programme. "Play here" makes this device's mix the programme's order (on this device only, not saved to the account) and takes over from where the music was. A remote's Up next marks each song the speaker reported it cannot open "Not on {speaker}". Not built: the marks in the mix editor, and the "ask before playing here" step of R2.

**R6 as built.** The header reads "{N} songs", then "All on {device}" (or "{n} on {device}"), then "{n} on this device". Each row says "This device", "On {device}", "On {device}, open {when}" (I86) or "No device right now". The browser filters are All, On this device (the old "Ready"), Can play now (here, or on another open device) and Needs attention. The large "hasn't been given your music" card shows only when no other device holds music; otherwise one quiet line: "This device is a remote for {device}. Connect music here only if you want this device to make the sound."

**R7 as built.** A device with some music of its own says "{n} of {N} songs are on this device. The rest are on {device}." A browser that cannot keep folder access between visits (no directory picker, as on phones) says once, until "Got it": "This browser can't keep access to your music between visits. When a song is needed again, SelectaDJ asks you to choose it." "Check for new music" is not built: a re-check runs when SelectaDJ opens and after each import.

**R8 as built (owner approved 2026-11-24).** The current mix is an account fact: table `local_current_mix` (one row per workspace: `mix_id`, a `revision` counter, `updated_at`, the choosing device), migration `bf0477current01` with the workspace isolation policy, `GET` and `PUT /api/local-media/current` under `cloud.local_media`. `PUT` is compare-and-set: the device names the mix it last saw as current, and when another device changed it meanwhile the answer is 409 `current_mix_changed`; deleting the current mix clears it; every change goes out as `mix.current` on the workspace event stream. On the client (`cloud/currentMix.ts`, `cloud/useAccountMix.tsx`), choosing or making a mix tells the account; a choice that lost says "{device} chose a different mix a moment ago. That one is now current; yours is saved in My Mixes."; opening, reconnecting and each event take the account's value without a reload; a mix remembered only by this browser (the old per-browser pointer) is offered to the account once, against none. The browser keeps its copy as the offline fallback.

The playback session stays the truth for what plays. A new current mix never switches a speaker that is making sound: it shows "{device} made a new mix" with Play it now and Keep playing, and starts nothing by itself when its programme ends. The device that made a mix while another plays shows "Your new mix is the current mix. {speaker} is still playing the last one." with "Play on {speaker} now" (an R2 ask naming the mix) and Later. A device with little or no music makes mixes from the songs held now by the device R1 chooses (Never play still honoured), its Play button reads "Play on {device}", and pressing it asks that device to play.

Where it differs: "Play on {speaker} now" uses the R2 ask rather than sending `set_programme`, because the speaker treats a programme that changes the playing song as its own to correct; the ask has the speaker load the mix and start it by its own action. An offline device keeps its last current mix but does not mark it as such beyond the connection banner. A mix made on a device that holds only some of the music uses the R1 device's songs, so the device making it may not hold every song (it plays on the R1 device).

**R9 as built.** "Playing on", "Paused on" and "Stopped on {device}", "{Device} is offline", "Playing here" and "Plays on {device}" are the words on Listen, the remote's Listen and the playing bar.

**Faults fixed in the remote control** (commit `3c47b738`, then `42f5c59d` and `4ce69b83`): the session look waits for the one in flight; a press answered `no_speaker` is a refusal with the ways on beside it; a change is marked applied only once followed; a speaker whose audio cannot start (at first, or on a skip or seek from a remote) tells the session it stopped, becomes a remote and says so; volume is sent only to a session that carries one; a reloaded speaker's reconnect does not start sound under a press already taking over; offline Skip on the last song does nothing and a paused seek stays paused; a 429 or 5xx is a refusal, not "offline".

**R5 as built.** With another device playing, "Request a song" looks through the whole account catalogue, with this device's own songs first. Results do not yet say where each would play (the row made from a result does), and the order does not yet put songs held nowhere last. The Library search is unchanged. With nothing playing elsewhere the search is as before.

## What is not decided here

- Shared volume for a personal session (the server refuses `set_volume` outside a venue zone).
- Moving a song's file from one device to another. Files never move.
- Background folder watching (not possible in a browser).

## Implementation checklist

1. Holdings: device reports, storage, expiry, and the devices list returning counts. Tests for report, replace, sign-out and expiry. **Partly done:** read route, counts, online, every device's ids on the client, tests for report, replace, another person's device, a removed song and a stale device. Not done: the per-page-load `now` rule, a test for sign-out.
2. R4 add from any device, with room request bookkeeping. Tests for each row of the table. **Done in code, with tests** (`controller.test.ts`, `controller.r4.test.ts`). Proved in a browser in the earlier round: a guest's request added from a phone with no music while the laptop played. The three newer rows and the counts are not yet seen in a browser.
3. R5 account-wide search. **Partly done:** Request a song, with a test and seen in a browser. Not done: the result order and labels, the Library search.
4. R2 "Play on {device}" with each refusal reason. **Done,** with tests (`playOn.test.tsx`). Not done: the "ask before playing here" step.
5. R1 picker and R3 pre-flight line. **Done in code, with tests** (`RemoteListen.ways.test.tsx`): the picker judged by the mix, the pre-flight line, Play on the device that has all, the ways on from a remote, "Not on {speaker}" in a remote's Up next. Not done: R3 marks in the mix editor.
6. R6 Library header, row status, filters and the quiet line. **Done in code, with tests** (`libraryDevices.test.ts`).
7. R7 wording for folder access that does not persist. **Done in code;** no unit test. Not done: "Check for new music".
8. R8 mixes from any device. **Done in code, with tests** (`tests/test_bf_current_mix.py`; `currentMix.test.tsx`). Not proved in a browser (see item 10).
9. R9 wording pass. **Done** for Listen, the remote's Listen and the playing bar.
10. Browser proof with three contexts: a laptop with all the music, a phone with none, and a phone with some. **Done** (2026-11-24, `ctl5.js`: A 1440x900 with 14 songs, B 360x740 with none, C 360x740 with four of its own kept on one page load, a guest on `/r/{code}`; every screenshot opened). Seen: B's Library (header, the quiet line, row status, Can play now); C's Library ("4 of 65 songs are on this device. The rest are on {laptop}." and the once-said folder line); the remote's Listen on B and C in portrait and 740x360; the guest's request for a song only C has reaching B as "Only on Firefox on Android. Edge on Windows can't play it." in a "Waiting on a device" group, with the room line "2 waiting on a device"; the laptop closed: B offers "Play on Firefox on Android, 2 of 12 songs" and C offers "Play here, 2 of 12 songs"; R8: B (no music) made a mix while nothing played ("14 of 65 songs can play on Edge on Windows", "Play on Edge on Windows") and the reopened laptop started it; while the laptop played, C made another: C showed "Your new mix is the current mix. Edge on Windows is still playing the last one." with Play on now and Later, the laptop showed "Firefox on Android made a new mix." with Play it now and Keep playing and kept playing, and B's My Mixes showed C's mix as current without a reload. Fixed from the runs: the remote for every device that is not the speaker (a phone with some music showed the ordinary Listen once the mix was the account's), no "Replace and play?" when another device plays, Make a Mix naming the device that plays, "Current mix" rather than "Playing now" on a device that is not the speaker, the squeezed "Got it" button, the room pill's length, the glossary "?" on a phone, and a stale "couldn't play that song" notice. Not seen: the `no_speaker` refusal itself (the remote's button read Pause while the lapsed session still said playing, so Play could not be pressed); the laptop's "Press Play to allow sound" step (the reopened laptop could start sound without it).
