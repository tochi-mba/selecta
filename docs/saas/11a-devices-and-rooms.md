*Part of the [Selecta Cloud proposal](README.md). Accepted by the owner on 2026-11-09.*

## 11A. Playback devices and Rooms

These two belong together: a Room needs one device that is *the speaker*, and a signed-in account can be on many devices at once.

### 11A.1 Devices and the playback session

**Model** (similar in spirit to Spotify Connect: one active output device, every other device is a remote that sees shared state).

- **Device**: every signed-in browser registers once (`device_id` random, kept in a cookie and `localStorage`; name like "Chrome on Windows", renameable; kind laptop/phone/tablet/TV; capabilities: can play audio, supports wake lock, is an iOS home-screen app; last seen). Account → Devices lists them with "sign out this device". A second device with the same default name is numbered ("Edge on Windows 2"). Limit 10 signed-in devices; the least recently seen is signed out with a notice, never the device making the sound, and the default speaker only when nothing else can go.
- **One playback session per account.** Server-held state: current mix revision, position anchor `(song index, offset ms, server time)`, playing/paused, volume is local only, `active_device_id`, lease expiry, sequence number. One session per account also limits account sharing.
- **Active device lease.** The playing device heartbeats every 5 s with its position (lease 20 s). Everyone else is a remote: "Playing on Living-room laptop", with play/pause, skip, steering (Bigger/Calmer/Something else), reorder, request approval, and a live position bar extrapolated from the anchor using a server-clock offset measured over SSE.
- **Where the state lives.** The session is one Postgres row per account; a position heartbeat is a small update to that row. Commands and state changes go out through the outbox and each device's SSE stream ([§4A.6](04-queue-and-scheduling.md#4a6-workers-and-the-claim-protocol), [§11.3](11-ui-ux.md#113-real-time-updates)), so any API instance can serve any device.
- **Commands from remotes** go to the server with an idempotency id and the sequence number they were based on; the server validates, increments the sequence, and pushes to the active device over its event stream; the device applies and reports the new state. A command based on an old sequence is rejected with the current state, so two remotes can't fight silently.
- **"Play here" (transfer).** The new device asks to take over; the server moves the lease (sequence++), tells the old device "Playback moved to Phone", the old device fades out over about a second, and the new device starts at the extrapolated position once its audio is buffered ("Starting here…"). A short gap is acceptable; a double-playing room is not.
- **Pressing play on an inactive device** while another is active asks "Playing on Laptop. Play here instead?"; if the active lease has expired, it just takes over.

**When the speaker loses its connection.** The lease expires after 20 s, but the device may still be playing buffered audio. Remotes show "Laptop is offline and may still be playing" and offer an explicit "Play here". If nobody takes over, the laptop renews its lease when it reconnects and carries on. If someone did take over, the laptop learns it lost the lease on reconnect and fades out with "Playback moved to Phone". The active device keeps the next two songs' playback files and their transitions buffered, so a short drop doesn't stop the music.

**Every device a controller (browser-first Cloud, ADR-0475, flag `devices.remote_control`).** The music files stay on the person's devices, so a device may hold all, some or none of the account's songs. Each device reports which catalogue songs it can open (ids only), and every other device can read that (`GET /api/local-media/holdings`). A device without the music still sees and steers everything:
- **Listen, something playing elsewhere:** the remote: what plays, where, Up next with "Not on {speaker}" on any song the speaker cannot open. When the speaker is away, or a press finds nobody playing, it says so and lists "Play on {device}" for each open device with music and "Play here" when this device holds songs of the programme.
- **Listen, nothing playing, no music here:** "Nothing is playing" with the mix and "Play on {device}" for the open device holding most of it, each device's share ("All 12 songs", "3 of 12 songs"), and what will be skipped ("Tablet has 10 of these 12 songs. The other 2 will be skipped.").
- **Requests:** a request can be added from any device to the speaker's programme when the speaker holds the song; otherwise the row says where the file is ("Only on Tablet. Laptop can't play it.", "Old phone needs its music folder again to play this.", "No device has this song's file right now."). Counts and the badge include only rows this device can add; the rest are "waiting on a device".
- **Library:** one list for the account, each song marked "This device", "On {device}", "On {device}, open 2 hours ago" with "Open SelectaDJ on {device} to play this." or "No device right now", with the filters All, On this device, Can play now and Needs attention.
- **Mixes:** the current mix is one per account (`/api/local-media/current`, compare-and-set, `mix.current` on the event stream), so a mix made on any device is current on all of them without a reload. A device that has just connected ignores the older values its event stream replays, so opening SelectaDJ never changes the current mix. A speaker that is playing is never switched by it: it offers "Play it now" or "Keep playing"; the device that made the mix offers "Play on {speaker} now" or "Later". A device with no music makes mixes from the songs held by the device that would play them, and its Play reads "Play on {device}".

**Default speaker and the room's library (ADR-0475, revised R1).** A person may mark one device as their default speaker (Devices page). When nothing plays, Play starts on the session's speaker, else the default if it is open with music, else the only open device with music, else asks "Where should the music play?". A browser-first room offers guests only the songs the room's speaker holds now; with no speaker yet, or while it reconnects, guests are told so (never which device) and search waits. Two tabs of one browser never both make sound: a Web Lock picks the tab.

**Where the music is going, said once.** When Play starts the music on another device, or that device does not answer, the Listen card says so in one line with its choices ("Starting on X." with Play here instead; "X isn't open. Open SelectaDJ there, or play somewhere else." with Try again and Choose another device; "Playing on Y because X isn't open."). Each replaces the one before; none is a toast over the controls. "Play here instead" takes the music from whichever device is starting or playing it.

**Remote volume (ADR-0475 G1).** Every session carries one mix level (80 until someone sets it). Any of the person's devices can set it from the remote's slider or mute; the last level sent wins, the speaker ramps to it, and a new speaker rises from quiet over a second. The speaker sends a level only when its own slider moves. At 100 the remote says to turn up the speaker itself.

**Everything the speaker's screen does (ADR-0475 G2).** A remote has play, pause, next, previous, seek and volume; Up next with Edit (move up, move down, remove, Clear with a question first, which keeps the playing song and the next one, Undo for each); Stop, which ends the music and frees the speaker (unlike Pause); and "Move the music", which lists Play here instead and Move to each open device with music, saying first what it lacks. Not built: asking the speaker to check its folder for new music, a sleep timer, and lock-screen controls on a remote (a browser shows those only for a page making sound).

**A remote's press is honest (ADR-0475 G3).** Each press carries the session state it was based on and one key, so a retried press happens once and two people pressing Next together skip once. A remote shows a change only once the speaker has carried it out; if the speaker does not within seven seconds the remote says "{Speaker} didn't answer. Nothing changed there." and shows things as they were. Only the person whose device is playing can steer it; another member of a shared workspace is told "That music is playing on someone else's device." The speaker's own screen says briefly what was changed and from which device.

**A reloaded speaker.** A speaker page that reloads (or comes back after the browser discarded it) and has had no press says "The music paused when this page reloaded. Press Play to carry on." and tells the account it is paused, rather than holding the music in silence.

**Rooms and the speaker's state.** A room opens even when no device with music is open (guests are told the host is choosing where the music plays); the big-screen display says the same three states as the guest page. With no connection, Play never opens an empty picker. A default speaker unseen for 30 days can be forgotten from the note that says it isn't open. When the other device needs a tap before it may make sound, the remote says "Waiting for a tap on {device}". The account export marks the default speaker.

**Lessons from Spotify Connect.** A paused speaker stays the speaker; the play bar on a remote always names the device; every choice of device uses the one picker; any device can be renamed on the Devices page.

**The speaker's sound, from a remote.** A remote says nothing about the sound while the speaker plays; when the speaker's browser has stopped its audio it says "{Speaker} can't make sound right now. Press Play on {Speaker} to carry on."

**Said once.** "Playing on X because Y isn't open" and "Make {device} your usual speaker?" are each said once on a device. When the speaker went away, Play on another device carries on from where it was and says "Carrying on from {old} on {new}."

**One tab per browser.** Two tabs of one browser are one device: a Web Lock picks the tab that makes the sound; the others say "Playing in another tab." with "Play in this tab instead", and carry on by themselves if that tab closes.

**The Library on a remote.** A phone without the music shows the whole account's library; each song an open device holds says "Plays on Laptop" and can be started as a mix, added or played next from the phone, on the device that holds it. On a phone the page is compact: one line says where the music lives, search and filters stay at the top, and while another device plays each row's button reads "Play next" and confirms "Added to Laptop's mix" in the row. A song the playing device does not have but another open device does says "Play on Tablet"; pressing it asks "This song is on Tablet. Move the music there?" with Move and play (the music moves to the tablet, starting with that song) and Add it later. Choosing several songs on a remote says first what will happen: "9 of 12 can play on Laptop. 3 are only on Tablet." with Play the 9 and Choose another device. A song's details say where its file lives (each device, open now or when it was last open) and list its versions. The list opens from what this browser kept and follows devices live: songs a device adds show where they play within seconds.

**One account per browser.** Signing out in one tab signs this device out of the account and stops anything it plays; every other tab says "You signed out in another tab." If music is playing, a room is open or an import is running in any tab, signing out asks first. A second account needs another browser profile.

**Browser realities (verify on real devices in Phase 6).**
- iOS Safari and iOS home-screen apps suspend Web Audio when the screen locks or the app goes to the background (long-standing WebKit bugs, worse reports on iOS 26). The player is Web Audio based, so an iPhone is a poor speaker device. Selecta detects this and says plainly: "On iPhone, keep Selecta open with the screen on while it plays". It requests a screen wake lock where the browser supports it.
- Laptops, desktops, Android Chrome and an on-screen iPad are the recommended speaker devices; phones make excellent remotes.
- AirPlay/Chromecast output is outside the browser player's reach at launch; Bluetooth speakers work through the OS.
- A native wrapper would fix background playback later, but you decided on a browser app with no wrapper, so this stays a documented limitation.

**Other device rules.** Signing out the active device ends playback gracefully. Revoking all sessions (password change, suspected compromise) stops playback within 30 s with a message. Switching plans mid-session doesn't interrupt the song that's playing. Two tabs on one device keep today's one-tab rule (`BroadcastChannel`). Playback events (for listening history) are reported only by the active device, so nothing is counted twice.

### 11A.2 Rooms (Premium)

**What it is.** A Premium host opens a Room from the Listen page. Selecta shows a big QR code and a short code. Anyone at the party scans it and, in their phone's browser with no app and no account, sees what's playing and what's coming, searches the host's requestable songs, and asks for one. Selecta's existing request planner finds a spot where the song fits (with bridges when needed), exactly as requests work today. The host's speaker device plays everything; guests never receive audio.

**Host controls** (room panel, usable from any of the host's devices):

| Setting | Options (default first) |
|---|---|
| Who can join | Anyone with the code · host approves each new guest · locked (no new guests) |
| Requests | Auto-accept · host approves each · off (watch-only room) |
| Requestable songs | All mix-ready songs · a chosen crate · (set-aside, never-play and unanalysed songs are always excluded) |
| Limits | 3 waiting requests per guest and 20 an hour (the host sets 1 to 20 waiting, and 1 to 60 an hour or no hourly limit); a played song can't be requested again for 20 min; at most 50 waiting in the room |
| Votes | On: guests upvote pending requests, which raises their priority but never forces a song that doesn't fit · off |
| Guest names | Hidden: generated nicknames ("Blue Fox") visible to the host only · shown to everyone |
| Big screen | Off · pair a TV or projector as a display |
| End | Host ends it · after 12 hours · after 60 minutes with no speaker device online |

Moderation: approve/pass requests, remove a guest, ban a guest for the room's lifetime (by guest id and a hashed IP), lock the room, make a new code (old code stops working; existing guests stay unless the host also chooses "remove everyone").

**Guest experience** (`app.selectadj.app/r/K7QDM2XP`): a tiny separate page bundle (target under 100 KB of JavaScript) that works on old phones and weak signal. It shows the room name the host chose (never the host's email or real name), now playing, next up, a search box over requestable songs (title, artist and length only), and "My requests" with honest states: Sent → "Accepted, playing in about 12 min" / "The host passed on this one" / "Can't fit this into the mix right now" / "Played recently, try again later". Optional nickname picked from a generated list, votes, leave room. Same accessibility bar as the app.

**Guest identity.** An anonymous guest token in an HttpOnly cookie scoped to that room. Rate limits per guest, per IP and per room. A signed-in Selecta user who joins is just a guest in that room; nothing about their account is shown to the host.

**Codes and QR.** Eight characters from an unambiguous alphabet (no 0/O/1/I), shown as `K7QD-M2XP`, about 40 bits, looked up by hash. The QR code encodes only the link and is generated in the browser. Join attempts are rate-limited per IP with a Cloudflare rule on `/r/*`, so brute-forcing codes is impractical. Codes of closed rooms are never reused within 30 days.

**Big-screen display.** A TV or projector browser opens `app.selectadj.app/display` and shows a pairing code; the host types it into the room panel; the display gets a read-only token for that room and shows the QR code, now playing, upcoming requests and "Scan to request a song". No audio. It reconnects by itself.

**How requests flow into the existing system.**
- A room request becomes a `song_requests` row with `source = room`, `room_id` and `guest_id`, so the current planner (`request_planner.py`, `requests.py`, PairBook, bridges with consent) does the musical work unchanged.
- Ordering among accepted room requests: host-approved time, then votes, with **round-robin across guests** so one guest can't take every spot (at most one of a guest's requests in the next few spots).
- Each accepted request creates interactive-lane seam jobs in the host's workspace at Premium weight. A per-room cap (e.g. 60 request renders an hour) stops a busy room from running away with compute.
- With no speaker device online, the room says "The music's paused"; requests wait.

**Plan and limits.** Premium: one open room at a time, up to 100 guests in beta (admin-tunable per plan), 12-hour maximum. Standard and Free see Rooms as a locked Premium feature (the `teaser` behaviour in [§11B.3](11b-feature-flags.md#11b3-targeting-rules)). If a host downgrades mid-party, the open room continues to its end and stays on the host's Rooms page with a line saying so; new rooms are blocked.

**Legal points specific to Rooms** (part of the Phase 0 legal review):
- **No audio to guests** keeps Selecta clear of sending the host's music to other people's devices.
- **Public performance**: a private party at home is generally fine; music in a venue or a public event needs a licence (in the UK, TheMusicLicence from PPL PRS, usually held by the venue). Terms say Selecta is for personal and private use and that public or commercial use needs the user's own licences.
- **Online Safety Act**: Rooms let one person's input be seen by another, and the Act's threshold is low (a comments box can be enough). To stay low-risk: requests are picks from a fixed catalogue, nicknames come from a generated list, there's no chat and no free-text "suggest a song" field. Get a legal view; if Rooms fall in scope anyway, do Ofcom's proportionate risk assessments and add a report button.
- **Guest privacy**: a short notice on the join page; data kept is the guest id, hashed IP, nickname and requests, deleted 30 days after the room closes; no tracking; guests may be children, so nothing is profiled.


**What a room does together (ADR-0488, proposed 2026-11-25).** Five things beyond asking for songs, each with its own flag and its own room setting, in party rooms and in venue rooms:

| Feature | What a guest does | Flag |
|---|---|---|
| Pick the next song | Votes once between two to four songs the room is offered; the winner goes into the mix | `rooms.rounds` |
| Keep the songs you liked | Taps a heart; the song is saved on their own phone and nowhere else | `rooms.keeps` |
| Reactions | Loves the playing song, or the blend into it; the room sees counts, never who | `rooms.reactions` |
| Dedications | Puts one line from a fixed list on their own waiting request | `rooms.dedications` |
| Tonight in numbers | Sees the room's totals once it has ended | `rooms.recap` |

A phone only ever sends a tap, a vote for an offered song or the id of a listed line, so the "no free text anywhere" rule above still holds. Every feature works with phones alone: a paired screen that has looked in the last 30 seconds adds a shared view, and the host is offered the big-screen settings only while a screen is paired. Phones and screens read the room's pulse, a small answer made once a second per room, by polling. Reactions, votes and plays are deleted with the guest data after 30 days; the recap and the crowd marks (what rooms loved, for the planner) hold no guest data and stay with the host. Venue rooms have the same five behind `business.rooms.*` flags, with the server offering only songs the zone's content rules allow, and a patron screen paired at `/display` (`business.rooms.display`).

### 11A.3 Current implementation

What the cloud app does today. The domain rules are in `src/selecta/playback/` and `src/selecta/rooms/`; the routes are installed by `rooms/wiring.py` from `api_cloud.create_cloud_app`.

**Devices and the session** (`playback/api.py`, flag `devices`; commands need `devices.remote_control`, which every plan includes). A browser registers with `POST /api/devices` (name, kind, capabilities) and keeps the returned id in local storage and an HttpOnly `selecta_device` cookie (path `/api`). `GET /api/devices`, `PATCH /api/devices/{device_id}` and `POST /api/devices/{device_id}/sign-out` list, rename and sign out; registering an eleventh device signs out the least recently seen one and answers with a `notice`. The speaker calls `POST /api/playback/heartbeat`; `POST /api/playback/take-over` is Play here; `POST /api/playback/reconnect` says `continue` or `stop_moved`; `GET /api/playback/session` is what a device draws, with the server time for the clock offset. `POST /api/playback/commands` takes `command`, `args`, `based_on_seq` and an `idempotency_key` (or the `Idempotency-Key` header); a stale one is 409 `stale_command` with the current session. A device id that isn't the caller's own looks exactly like a missing one (404 `unknown_device`). Steering, reordering and approving from the session answer 409 `command_unavailable` until the cloud has a mix to change. Every change is written to the outbox, so `GET /api/events` carries it.

**Rooms for the host** (`rooms/api_host.py`, flag `rooms`): `POST /api/rooms` opens a room and is Premium (403 `plan_required` otherwise, from the same targeting decision as the site's feature list). Then `GET /api/rooms/current`, `GET /api/rooms/{room_id}` (the panel: code, join path, settings, guests, inbox, coming up, can't fit, renders left, displays), `PATCH .../settings` (merged into the current settings), `POST .../lock`, `.../unlock`, `.../code` (`remove_everyone`), `.../end`, `.../requests/{request_id}/approve` and `/pass`, `.../guests/{guest_id}/approve`, `/remove` and `/ban`. Routes after opening don't re-check the plan: the room carries the limits copied in when it opened, so a downgrade lets it finish. Pairing a display (`POST` and `DELETE /api/rooms/{room_id}/displays`) needs `rooms.display`.

**Guests** (`rooms/api_guest.py`, no account): `POST /api/guest/join` with the code sets an HttpOnly, Secure, SameSite=Strict `selecta_guest` cookie whose path is that room's own routes, `/api/guest/rooms/{room_id}`. The room id stays the same when the host makes a new code. Under it: `GET` (the guest view), `GET .../search?q=`, `POST .../requests`, `DELETE .../requests/{request_id}` (withdraw), `GET .../nicknames`, `PUT .../nickname` and `POST .../leave`; voting (`POST` and `DELETE .../requests/{request_id}/vote`) is flag `rooms.votes`. Every guest route checks the token belongs to the room in its path; a token for another room is 401 `not_a_guest`. Cookie-authenticated writes refuse an `Origin` outside `SELECTA_ALLOWED_ORIGINS`.

**Displays**: `POST /api/display/pairings` returns a six-character pairing code and sets a read-only `selecta_display` cookie (path `/api/display`); `GET /api/display/view` shows `waiting`, `expired`, `ended`, or once paired the room name, code, join path, now playing, next up and upcoming requests.

**Rate limits** (`rooms/limits.py`, per API instance, behind the Cloudflare rule): 10 joins a minute per IP; per guest 120 reads, 30 searches and 20 writes a minute; 120 writes a minute per IP and 600 per room; 10 display pairings and 120 display reads a minute per IP. Over a limit is 429 `rate_limited` with `Retry-After`. Code guessing (`rooms/guessing.py`): the tenth wrong, unknown or ended code from one address in 10 minutes locks that address out of joining for 15 minutes, right code or not, and writes a `rooms.join.code_guessing_locked_out` audit row (address as its keyed hash only); more than 300 wrong codes a minute across all addresses raise one `security.room_code_guessing` platform alert per minute, without refusing anyone's join. Guest routes reached without a valid token for the room are limited to 60 a minute per IP, after which that address is turned away before the token lookup for a minute. The room's own limits (one waiting, three an hour, twenty in the room, the replay cooldown) still apply behind them. Behind a proxy, set `SELECTA_CLIENT_IP_HEADER` (for example `cf-connecting-ip`) so the visitor's address is used; it is only ever stored as a keyed hash.

**Secrets.** Room codes are hashed with `SELECTA_ROOMS_PEPPER` (at least 16 bytes); without it the Rooms, guest and display routes answer 503 `rooms_unavailable`. Codes and tokens never go into logs, errors, reprs or URLs other than the guest page's own `/r/{code}`.

**Ports in the cloud** (`rooms/cloud_ports.py`): plans come from the workspace's effective entitlement, the speaker from the playback session, and events go to the outbox. The cloud has no analysed song library, request planner or mix yet, so by default no song is requestable and opening a room is refused with `no_songs`; tests and the browser-test server pass a library through `create_cloud_app(room_ports=...)`.

**Pages.** The guest page (`web/guest.html`, `web/src/guest/`) and the display (`web/display.html`, `web/src/display/`) are their own entries without React; `web/rooms.vite.ts` fails the build if the guest page's JavaScript passes 100 KB uncompressed and writes `dist/guest-size.json`. A static host must answer `/r/*` with `guest.html` and `/display` with `display.html`. QR codes are drawn in the browser by Selecta's own encoder (`web/src/rooms/qr.ts`); unit tests decode them with jsqr (Apache-2.0, test only).

**Host and device panels.** `web/src/rooms/RoomPanel.tsx` is the host's room panel (QR, code, link, lock, new code, settings, requests inbox, coming up, guests with let in, remove and ban, big-screen pairing, end); a plan without Rooms sees it as a locked Premium feature. `web/src/devices/` holds the device side: `deviceInfo.ts` (kind, name such as "Safari on iPhone", and the iOS and home-screen detection behind the "keep the screen on" warning), `wakeLock.ts` (asked for while this device is the speaker, and again whenever the page comes back), `usePlaybackDevice.ts`, `PlayingBar.tsx` ("Playing here", "Playing on Living-room laptop" with play, pause and skip, and Play here, which asks first while the other device is online) and `DevicesPanel.tsx` (Account, Devices). The speaker checks the session every second and fades out over one second when it loses the lease; the device taking over waits 2.4 seconds ("Starting here...") before it starts, so there is a short gap and never two speakers. The speaker plays from local copies of the current song and the next two (`audioSpeaker.ts`), so it keeps playing through a dropped connection; on reconnect it carries on or fades out with "Playback moved to ..." as above.

**Browser tests.** `web/e2e-cloud/*.cloud.ts`, run with `pnpm e2e:cloud` (port 8812) against `tests/e2e_cloud_server.py`, the one cloud browser-test server: the real cloud API over SQLite with test sign-ins (`alice` and `bob` on Premium, `carol` on Free), a synthetic Rooms song library and quiet synthesized audio. `vite.cloud-e2e.config.ts` builds the web app into `web/dist-cloud-e2e` with `SELECTA_CLOUD_E2E=1`, which adds `cloud-harness.html`, a test-only page that mounts the room and device panels without AuthKit. The guest tests run on a 320 px phone over an emulated slow connection. See [testing](../engineering/testing.md#cloud-browser-tests).

---

[← 11-ui-ux.md](11-ui-ux.md) · [Contents](README.md#chapters) · [11b-feature-flags.md →](11b-feature-flags.md)
