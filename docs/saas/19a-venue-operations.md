*Part of the [Selecta Cloud proposal](README.md). Proposed on 2026-11-12; awaiting the owner's decision.*

## 19A. SelectaDJ for Business: venue operations

*Sub-chapter of [§19 SelectaDJ for Business](19-business-venues.md). The experience, content controls, Rooms for Business, roles and testing are in [§19B](19b-business-experience.md). Decisions: [ADR-0442](../adr/adr-0442-organisations-venues-zones-and-org-workspace.md), [ADR-0443](../adr/adr-0443-zone-playback-sessions.md), [ADR-0444](../adr/adr-0444-venue-hours-dayparts-and-unattended-scheduling.md), [ADR-0445](../adr/adr-0445-kiosk-player-devices.md), [ADR-0446](../adr/adr-0446-offline-first-venue-playback-and-resync.md).*

This part is about keeping music playing in a real place with nobody watching it: how an organisation, its venues and their zones are modelled, how each zone gets its own speaker, how the day runs itself, what the player device behind the bar does, and what happens when the internet drops.

The plan is built in full but not sold yet. Sign-up stays behind `business.signups` (off); the first organisations are pilots that REX Technologies staff create (`business.pilots`, ADR-0452). Nothing in this chapter branches on whether a venue is a pilot, so the pilots run exactly the code a paying venue would, and every piece here can be built and tested with the cloud test server and a made-up organisation, without a paying venue or Stripe.

### 19A.1 Organisations, venues and zones

**Model.** An organisation is a workspace of a new kind, `business` (today `identity/schema.py` has `personal` and `team`). It is the tenant: library, crates, ratings, Lucy memory, usage, jobs and devices carry its `workspace_id`, so row-level security, quotas, the fair scheduler and the outbox work unchanged ([§6.1.1](06-data-model.md#611-row-level-security-as-built)). Inside it:

| Level | What it is | Holds |
|---|---|---|
| Organisation | The paying business (or a pilot) | Shared library, organisation crates, people, billing |
| Venue | A physical site | Address, IANA time zone, opening hours, licence attestation, venue crates, content rules |
| Zone | An area with its own speaker (bar, terrace) | One playback session, a weekly programme, a home kiosk and an optional standby |
| Device | A player or a remote | A kiosk (organisation-owned, paired to one zone) or a person's phone or laptop |

**One library, crates per venue.** Every venue draws from the organisation library. A crate is a named set of songs, either organisation-wide ("Brand core") or owned by one venue; a venue never sees another venue's crates. Schedules, zone defaults, content rules and Rooms point at crates, never at song lists, so deleting a song never edits a schedule. Staff uploads land in the organisation library with the uploader recorded.

**Deleting a song that a schedule uses.** The song is tombstoned and leaves every crate at once. Each zone whose uncommitted horizon contains it replans; the committed window (the playing song and the next two transitions, already rendered and maybe cached on the kiosk) plays out unless a manager chooses "Remove now". An offline kiosk evicts it on reconnect, and if it played meanwhile the play log says so. Deleting a crate that a schedule uses is refused with the list of uses.

**Personal and business never mix.** A person can belong to organisations and keep a personal workspace, switching between them (ADR-0453 S7). Every request names one workspace (`X-Workspace-ID`), and listening events, ratings, uploads, steering, Lucy turns and usage go only to that workspace. A browser keeps one device id per workspace (already `selecta.device.{workspaceId}` in local storage; the device cookie becomes per workspace too). A phone acting as a zone's speaker cannot switch to personal until it hands the zone back.

### 19A.2 Zone playback sessions

ADR-0415's session becomes one session **per zone**. The session key changes from `workspace_id` to `(workspace_id, zone_id)`; a personal workspace keeps one session with no zone, so nothing changes for individuals. Every ADR-0415 rule holds per zone: one speaker with a 20 s lease and 5 s heartbeat, sequence numbers, idempotent commands, Play here, offline speaker rules.

- **One lease per device.** A device that is the speaker for the bar is refused as the terrace's speaker, checked in the same transaction.
- **Home and standby.** Each zone names a home kiosk and may name a standby. The standby takes over only after the zone's lease has been dead for 20 s, and hands back at the next song boundary when the home kiosk returns, so nobody hears a cut.
- **A staff phone pressing Play here** is allowed as an emergency speaker for people who can control the zone, after a confirm, because a silent bar is worse than a phone speaker. Managers see "Bar is playing from Sam's phone"; the phone is offered "Hand back to Bar player" when the kiosk returns. A venue can turn person speakers off per zone.
- **Zones sharing one physical speaker** are one zone in SelectaDJ. SelectaDJ does not synchronise audio across devices; one amplifier feeding two areas covers that case. Two zones paired from the same machine warn that they would play over each other.
- **Moving a kiosk between zones** asks "now" or "at closing time"; moving now fades it out of the old zone, which falls to its standby or raises the silent-zone alert.
- **Remotes** see every zone in their scope and steer one at a time; commands name the zone in the path. Zone volume is session state shared by every remote, clamped to the zone cap ([§19B](19b-business-experience.md), ADR-0450).

**Render priority across zones.** The rule that the mix playing now renders first holds per zone: what each zone is about to play is URGENT, the rest of each zone's current mix is MIX ([§4A.5](04-queue-and-scheduling.md#4a5-mapping-todays-ranks-onto-the-new-policy)). Across organisations, the organisation is one fair-share account with the Business weight (ADR-0448: 8 for a zone's interactive work inside opening hours). Inside the organisation, jobs carry `zone_id` and are ordered by urgency, then deadline (`needed_by`), then **zone fairness** (the zone served least recently first among equals), then render line and age. Deadline boosts and interactive concurrency are counted per zone, so a request flood on the terrace never delays the bar's next transition.

### 19A.3 Hours and dayparts

**Opening hours** are stored as wall-clock times in the venue's own IANA time zone, never as UTC instants, and turned into instants for a rolling 14 days with `zoneinfo`.

| Situation | Rule |
|---|---|
| Overnight (Friday 18:00 to 02:00) | The period belongs to the day it opens; Saturday 01:30 is inside Friday's period |
| Spring forward | A time in the missing hour moves to the first valid instant after it |
| Fall back | Times in the repeated hour use the first occurrence; a venue never closes twice; stay open late covers the extra hour |
| Different time zones | Each venue computes its own instants; HQ shows each venue's local time |
| Holidays and closures | Date exceptions keyed to the opening date: closed, or replacement periods; public holidays are suggested, never applied automatically |
| Open 24 hours | No closing and no auto-stop; dayparts only |
| Stay open late | Extends tonight only, within the role's allowance; reverses a closing fade already under way |
| Close now | Fades over 60 s; undo within 5 minutes |

**The zone's day** runs itself: Closed, then **Warming** from 45 minutes before opening (the horizon is rendered and downloaded, no audio), **Opening** with a 10 s fade-in, **Open**, then **Closing** (the song plays to its end within 4 minutes and fades, or ends exactly at the closing time for strict licence hours). A maintenance task on the leader computes each zone's next change and announces it; the kiosk also holds the schedule, so it acts on time without the server.

**Dayparts.** Each zone has a weekly programme of blocks ("Brunch calm" from 10:00, "Evening energy" from 18:00). A block sets the allowed crates, an energy level or arc, an optional vibe, the mix language and stems frequency, and the brand rules of [§19B](19b-business-experience.md). Blocks drive the existing planner exactly as a person's steering does today: the arc becomes the custom curve in `planner/arc.target_energy`, and the mix language and stems go where `Steering.mix_language` and `Steering.stems` go. There is no second planner.

**No hard cuts.** A block boundary is an energy target, not a wall. The planner ramps toward the new block over a lead-in (2 songs or 10 minutes), and the change lands on the transition nearest the boundary, at most 8 minutes early or late, through an ordinary planned seam; a bridge song or the always-available echo out covers pools that do not connect. Staff taps (Bigger, Calmer) shift the zone's energy and drift back to the block over three songs.

**Changes while playing.** Edits make a new schedule version and replan only after the committed window; an edit to the current block starts a lead-in; tightened content rules apply before the next song (ADR-0450).

### 19A.4 The kiosk player

The speaker in a venue is a small dedicated device (a mini PC, an Android box or a tablet) running `/kiosk`, a separate page bundle (`web/kiosk.html`, no React, no manager code; its screen is ADR-0453 D11).

**Pairing.** The kiosk shows a six-character code (renewed every 10 minutes, single use); a manager enters it on their phone and picks the zone. The kiosk gets a token in an HttpOnly cookie plus a non-extractable WebCrypto key; every heartbeat is signed, so a copied cookie on another machine is refused and the manager is told. Kiosks are organisation-owned device principals (ADR-0452): they keep working when the person who paired them leaves.

**Autoplay.** Browsers block sound until someone interacts with the page unless policy allows it. The kiosk detects this silently on load. If blocked, it shows "Tap to start the music" and, during opening hours, alerts the manager; one tap lasts for the life of the page. The kiosk setup guide removes the tap where the platform allows:

| Platform | How | Verdict |
|---|---|---|
| Windows mini PC with Chrome or Edge | The `AutoplayAllowed` or `AutoplayAllowlist` policy for the SelectaDJ origin, kiosk launch (`--kiosk`, or Edge Assigned Access), or the `--autoplay-policy=no-user-gesture-required` launch flag | Recommended |
| Linux mini PC with Chromium | The same managed policy file and `--kiosk` from session autostart | Supported |
| ChromeOS | Kiosk or managed-guest policy with the autoplay allowlist | Supported |
| Android tablet or box | A kiosk browser app that allows media without a gesture and starts on boot (owner to choose and license), or the site installed to the home screen; otherwise a tap per restart | Owner to choose |
| iPad | A tap after every page load; audio stops if the screen locks | Works, not recommended |

Every row is marked "checked on <device>, <date>" only after a person has tried it on real hardware.

**Power cuts.** The guide covers firmware power-on after power loss, automatic sign-in, browser autostart in kiosk mode, OS sleep off and OS and browser update windows outside opening hours. After a restart the kiosk restores its pairing and, if the venue is open and the time is trusted, starts where the schedule says it should be now; closed, it shows Closed; if the time cannot be trusted it waits for a tap rather than wake the neighbours at 03:00.

**Wake lock and updates.** The kiosk holds a screen wake lock while playing (`wakeLock.ts`). New versions download in the background and activate only while the zone is closed or before warming; the server supports the current and previous two kiosk versions for at least 14 days. An urgent security fix may apply during service only at a simple-fade song boundary, and the manager is told.

**Health and the silent-zone alert.** The kiosk reports health every 60 s: version, browser, audio state, autoplay, wake lock, its own output level, hours saved ahead, storage, network, clock offset and last restart. During opening hours a zone is **silent** after 60 s with no live lease, digital silence in SelectaDJ's own output, a suspended audio context, or a staff pause past 30 minutes; it is **unreachable** after 2 minutes without a heartbeat, reported as "offline, may still be playing" because the kiosk keeps playing offline. Managers hear after 2 minutes, admins after 15. An amplifier switched off is invisible, and the copy says only what is known.

**Stolen or replaced.** "Replace Bar player" makes the new device home and revokes the old one. Unpairing a stolen kiosk revokes it at once if online; offline it can play only its cached hours until its offline permit ends, and gets nothing on reconnect.

### 19A.5 Offline-first playback

The rule: the music never stops because the internet dropped.

- **Four hours ahead.** During warming and opening hours each zone keeps a horizon of about 4 hours rendered and downloaded to its kiosk (at least 1 hour), in three parts: committed (never replanned), prepared and planned. The next two transitions are URGENT, the rest of the first hour MIX, the later hours standard with later deadlines, within ADR-0448's render-ahead budget.
- **Device storage.** Files are cached by artifact key and checksum, checked after download, with persistent storage requested. The cap is the smaller of 4 GB and half the browser's quota; 4 hours of FLAC is about 1.6 GB. Played files are evicted first, never the committed window. A device that holds less says how many hours it holds.
- **Signed URLs.** Downloads ask for a fresh short-lived URL; a 403 refreshes it once and resumes from the saved bytes. Offline playback never needs a URL.
- **The offline bundle.** With the horizon the kiosk keeps a signed bundle: 7 days of opening instants, the programme, the content snapshot, volume rules and an **offline permit** (plan state, licence expiry, any billing or pilot stop instant, `valid_until` 7 days after issue). The kiosk applies the same stop rules the server would, so being offline never extends or shortens them. Past `valid_until`, it plays to the end of the open period and stops at close.
- **Past the horizon**, the kiosk plays a fallback reel of allowed cached songs joined by its own crossfades, logged as such. Only if nothing allowed is cached does it stop.
- **Commands.** Play, pause, skip and seek to an offline speaker are refused at once in plain words; nothing is queued to fire later. Steering, volume, schedule, rules and approvals are server state and reach the kiosk in order on reconnect. Staff phones drop their own queued commands after 2 minutes.
- **Resync.** The kiosk uploads its log (songs played, fallbacks, pauses, restarts) idempotently. The device wins on what played; the server wins on rules and schedules; the lease follows ADR-0415's reconnect rule; the horizon replans from where the device actually is.
- **Clocks.** Schedule decisions use trusted time (the server offset plus the monotonic clock), never the device wall clock, so a kiosk six hours wrong still opens on time. After a reboot with no network, a plausible wall clock is used; an implausible one waits for a tap.

### 19A.6 Feature flags

All in the cloud area, default off, turned on per pilot organisation by ADR-0414 targeting, and independent of `business.signups` so pilots work while selling is off: `business.orgs` (organisations, venues, zones, crates), `business.zones` (zone sessions, requires `business.orgs`), `business.schedules` (hours and dayparts), `business.kiosk` (kiosk pairing, health and screen, shared with ADR-0453), `business.offline` (the horizon cache and permits). With each off, its routes answer 404 and pages reflow.

### 19A.7 Open questions for the owner

- **Offline permit length.** 7 days of offline play before a kiosk stops at close: right, shorter or longer?
- **Closing in the repeated autumn hour.** The first occurrence by default (licence hours as written); should venues be able to choose the second?
- **Android kiosks.** Which kiosk browser app, if any, REX Technologies recommends and licenses, or whether Android stays "tap once per restart".
- **Alert channels.** In-app and email at launch; whether SMS or push is needed for the silent-zone alert, and its cost.
- **Staff phones as speakers.** On by default per zone (as proposed), or off by default?
- **Cache exposure.** A stolen kiosk exposes up to its cached hours of the organisation's music; acceptable with the terms saying so?
- **Weight per organisation.** One fair-share account per organisation at weight 8 (ADR-0448) means a 30-venue chain shares one weight; whether the weight should scale with open zones is ADR-0448's call, measured in the pilot.

---

[← 19-business-venues.md](19-business-venues.md) · [Contents](README.md#chapters) · [19b-business-experience.md →](19b-business-experience.md)
