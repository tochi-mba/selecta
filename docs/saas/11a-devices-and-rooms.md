*Part of the [Selecta Cloud proposal](README.md). Accepted by the owner on 2026-11-09.*

## 11A. Playback devices and Rooms

These two belong together: a Room needs one device that is *the speaker*, and a signed-in account can be on many devices at once.

### 11A.1 Devices and the playback session

**Model** (similar in spirit to Spotify Connect: one active output device, every other device is a remote that sees shared state).

- **Device**: every signed-in browser registers once (`device_id` random, kept in a cookie and `localStorage`; name like "Chrome on Windows", renameable; kind laptop/phone/tablet/TV; capabilities: can play audio, supports wake lock, is an iOS home-screen app; last seen). Account → Devices lists them with "sign out this device". Limit 10 signed-in devices; the oldest is signed out with a notice.
- **One playback session per account.** Server-held state: current mix revision, position anchor `(song index, offset ms, server time)`, playing/paused, volume is local only, `active_device_id`, lease expiry, sequence number. One session per account also limits account sharing.
- **Active device lease.** The playing device heartbeats every 5 s with its position (lease 20 s). Everyone else is a remote: "Playing on Living-room laptop", with play/pause, skip, steering (Bigger/Calmer/Something else), reorder, request approval, and a live position bar extrapolated from the anchor using a server-clock offset measured over SSE.
- **Where the state lives.** The session is one Postgres row per account; a position heartbeat is a small update to that row. Commands and state changes go out through the outbox and each device's SSE stream ([§4A.6](04-queue-and-scheduling.md#4a6-workers-and-the-claim-protocol), [§11.3](11-ui-ux.md#113-real-time-updates)), so any API instance can serve any device.
- **Commands from remotes** go to the server with an idempotency id and the sequence number they were based on; the server validates, increments the sequence, and pushes to the active device over its event stream; the device applies and reports the new state. A command based on an old sequence is rejected with the current state, so two remotes can't fight silently.
- **"Play here" (transfer).** The new device asks to take over; the server moves the lease (sequence++), tells the old device "Playback moved to Phone", the old device fades out over about a second, and the new device starts at the extrapolated position once its audio is buffered ("Starting here…"). A short gap is acceptable; a double-playing room is not.
- **Pressing play on an inactive device** while another is active asks "Playing on Laptop. Play here instead?"; if the active lease has expired, it just takes over.

**When the speaker loses its connection.** The lease expires after 20 s, but the device may still be playing buffered audio. Remotes show "Laptop is offline and may still be playing" and offer an explicit "Play here". If nobody takes over, the laptop renews its lease when it reconnects and carries on. If someone did take over, the laptop learns it lost the lease on reconnect and fades out with "Playback moved to Phone". The active device keeps the next two songs' playback files and their transitions buffered, so a short drop doesn't stop the music.

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
| Limits | 1 pending request per guest, 3 per hour; a played song can't be requested again for 60 min; at most 20 pending in the room |
| Votes | On: guests upvote pending requests, which raises their priority but never forces a song that doesn't fit · off |
| Guest names | Hidden: generated nicknames ("Blue Fox") visible to the host only · shown to everyone |
| Big screen | Off · pair a TV or projector as a display |
| End | Host ends it · after 12 hours · after 60 minutes with no speaker device online |

Moderation: approve/pass requests, remove a guest, ban a guest for the room's lifetime (by guest id and a hashed IP), lock the room, make a new code (old code stops working; existing guests stay unless the host also chooses "remove everyone").

**Guest experience** (`selecta.app/r/K7QDM2XP`): a tiny separate page bundle (target under 100 KB of JavaScript) that works on old phones and weak signal. It shows the room name the host chose (never the host's email or real name), now playing, next up, a search box over requestable songs (title, artist and length only), and "My requests" with honest states: Sent → "Accepted, playing in about 12 min" / "The host passed on this one" / "Can't fit this into the mix right now" / "Played recently, try again later". Optional nickname picked from a generated list, votes, leave room. Same accessibility bar as the app.

**Guest identity.** An anonymous guest token in an HttpOnly cookie scoped to that room. Rate limits per guest, per IP and per room. A signed-in Selecta user who joins is just a guest in that room; nothing about their account is shown to the host.

**Codes and QR.** Eight characters from an unambiguous alphabet (no 0/O/1/I), shown as `K7QD-M2XP`, about 40 bits, looked up by hash. The QR code encodes only the link and is generated in the browser. Join attempts are rate-limited per IP with a Cloudflare rule on `/r/*`, so brute-forcing codes is impractical. Codes of closed rooms are never reused within 30 days.

**Big-screen display.** A TV or projector browser opens `selecta.app/display` and shows a pairing code; the host types it into the room panel; the display gets a read-only token for that room and shows the QR code, now playing, upcoming requests and "Scan to request a song". No audio. It reconnects by itself.

**How requests flow into the existing system.**
- A room request becomes a `song_requests` row with `source = room`, `room_id` and `guest_id`, so the current planner (`request_planner.py`, `requests.py`, PairBook, bridges with consent) does the musical work unchanged.
- Ordering among accepted room requests: host-approved time, then votes, with **round-robin across guests** so one guest can't take every spot (at most one of a guest's requests in the next few spots).
- Each accepted request creates interactive-lane seam jobs in the host's workspace at Premium weight. A per-room cap (e.g. 60 request renders an hour) stops a busy room from running away with compute.
- With no speaker device online, the room says "The music's paused"; requests wait.

**Plan and limits.** Premium: one open room at a time, up to 100 guests in beta (admin-tunable per plan), 12-hour maximum. Standard and Free see Rooms as a locked Premium feature (the `teaser` behaviour in [§11B.3](11b-feature-flags.md#11b3-targeting-rules)). If a host downgrades mid-party, the open room continues to its end; new rooms are blocked.

**Legal points specific to Rooms** (part of the Phase 0 legal review):
- **No audio to guests** keeps Selecta clear of sending the host's music to other people's devices.
- **Public performance**: a private party at home is generally fine; music in a venue or a public event needs a licence (in the UK, TheMusicLicence from PPL PRS, usually held by the venue). Terms say Selecta is for personal and private use and that public or commercial use needs the user's own licences.
- **Online Safety Act**: Rooms let one person's input be seen by another, and the Act's threshold is low (a comments box can be enough). To stay low-risk: requests are picks from a fixed catalogue, nicknames come from a generated list, there's no chat and no free-text "suggest a song" field. Get a legal view; if Rooms fall in scope anyway, do Ofcom's proportionate risk assessments and add a report button.
- **Guest privacy**: a short notice on the join page; data kept is the guest id, hashed IP, nickname and requests, deleted 30 days after the room closes; no tracking; guests may be children, so nothing is profiled.

---

[← 11-ui-ux.md](11-ui-ux.md) · [Contents](README.md#chapters) · [11b-feature-flags.md →](11b-feature-flags.md)
