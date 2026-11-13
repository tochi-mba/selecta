# ADR-0445 - Kiosk player devices: pairing, autoplay, auto-start and health

- **Decision:** Proposed (2026-11-12).
- **Implementation:** 0/13 Not started.
- **Independent verification:** 0/13 Verified.
- **Programme/date/baseline:** SelectaDJ for Business (BZ); 2026-11-12; `feat/finish-checklists-2` at `1ccb08ba`.
- **Priority / phase:** P1 / Phase B0 (build, selling switched off); the real-hardware tasks run with pilot venues in Phase B1. **Owner:** Unassigned. **Implementing PR/SHA:** None yet.
- **Existing ADR owners:** ADR-0415 (devices and sessions), ADR-0416 (display pairing), ADR-0410 (observability and alerts), ADR-0429 (six-hour venue audio continuity) and ADR-0436 (operational observability) of the Autopilot programme; their statuses are unchanged. Sibling Business ADRs: ADR-0441 to ADR-0444, ADR-0446 to ADR-0454; ADR-0452 owns the kiosk as a device principal and ADR-0453 D11 owns the kiosk screen.
- **Source touchpoints:** `src/selecta/rooms/display.py` (pairing pattern); `src/selecta/playback/devices.py`, `session.py`, `api.py`; `web/src/devices/wakeLock.ts`, `audioSpeaker.ts`, `deviceInfo.ts`, `usePlaybackDevice.ts`; `web/display.html` and `web/src/display/` (separate entry pattern); new `web/kiosk.html`, `web/src/kiosk/`, `src/selecta/business/kiosk.py`, `business/health.py`, `business/alerts.py`; new `docs/business/kiosk-setup-guide.md`.
- **Proposal chapter:** [docs/saas/19a-venue-operations.md](../saas/19a-venue-operations.md#19a4-the-kiosk-player).

## Context and evidence boundary

A venue's speaker is a small dedicated device behind the bar: a mini PC, an Android TV box or a tablet, running the player page with nobody watching it. ADR-0415 built browsers as devices with a lease, a 5 s heartbeat and a one-second fade when the lease is lost; `wakeLock.ts` asks for a screen wake lock while a device is the speaker and again when the page returns; `audioSpeaker.ts` keeps local copies of the current and next two songs. ADR-0416 built display pairing: the TV shows a six-character code, the host types it in, and the TV gets a long token it keeps through power cuts (`rooms/display.py`).

A kiosk needs more than either. It must start itself after a power cut, play sound without a person tapping each morning, stay awake, update without interrupting service, prove it is the device that was paired, and tell a manager when the bar has gone quiet. Browsers block audio until a person interacts with the page unless policy says otherwise, and that policy differs by browser and platform; the exact flags and policies below must be checked on real hardware before the setup guide is published.

This ADR records a proposed decision. Nothing in it is implemented or measured yet.

## Decision

### The kiosk page and pairing

- A separate entry, `web/kiosk.html` with `web/src/kiosk/`, built like the guest and display pages: no React, no manager components (ADR-0453 D1 build test), a service worker for offline (ADR-0446), dark by default. Served at `/kiosk`.
- **Pairing** reuses the display pattern. Unpaired, the kiosk calls `POST /api/kiosk/pairings` and shows a six-character code in very large type with a QR to `selecta.app/pair` (renewed every 10 minutes, single use). A manager with `business.devices.pair` (ADR-0452) enters it on their phone and picks the venue and zone. The kiosk receives a **kiosk token** for that `(workspace, venue, zone, device)`.
- The kiosk token is an HttpOnly, Secure, SameSite=Strict cookie with path `/api/kiosk`, plus a **device key**: at pairing the page makes a non-extractable ECDSA P-256 key pair with WebCrypto, keeps it in IndexedDB, and sends the public key. Every heartbeat signs a server nonce from the previous answer. A copied cookie on another machine has no private key and is refused (`kiosk_key_mismatch`), and the zone's manager is told "A copy of the Bar player's sign-in was refused".
- The token never expires while the kiosk heartbeats; it rotates every 7 days on a heartbeat. It is revoked by unpairing, by replacing the device, or by ADR-0452's organisation-wide device revocation. Offboarding the person who paired it does not revoke it (ADR-0452).
- The kiosk is a `devices` row with `principal = 'kiosk'`, `user_id` null, `zone_id` set (ADR-0442), excluded from any person's ten-device limit. A venue may have at most 2 kiosks per zone (home and standby, ADR-0443) and a platform cap of 50 kiosks per organisation in pilots.
- The heartbeat records a **machine fingerprint** (a random id stored in IndexedDB at first launch, not a hardware id) so a second zone paired from the same machine warns (ADR-0443).

### Autoplay

- Browsers allow audio without a gesture only in some cases, so the kiosk **detects** rather than assumes: on load it creates an `AudioContext` and plays a silent buffer; if `state` stays `suspended` (or `play()` rejects with `NotAllowedError`) autoplay is blocked.
- Blocked: the kiosk shows **Tap to start the music** (ADR-0453 KioskTapToStart), and if this happens inside opening hours (or within 10 minutes of opening) the manager is alerted "Bar player needs a tap to start". One tap is enough for the life of the page; the kiosk never reloads itself during opening hours (below), so a venue taps at most once per restart.
- The **kiosk setup guide** (`docs/business/kiosk-setup-guide.md`, linked from the manager view) tells venues how to remove the tap entirely, per platform:

| Platform | How the page starts with sound | Status |
|---|---|---|
| Windows mini PC, Chrome | Chrome enterprise policies `AutoplayAllowed` or `AutoplayAllowlist` with the SelectaDJ origin; launch with `--kiosk https://selecta.app/kiosk`; or the launch flag `--autoplay-policy=no-user-gesture-required` | Recommended; verify on hardware |
| Windows mini PC, Edge | Edge policies `AutoplayAllowed` or `AutoplayAllowlist`; Windows Assigned Access or `msedge --kiosk https://selecta.app/kiosk --edge-kiosk-type=fullscreen` | Recommended; verify on hardware |
| Linux mini PC | Chromium with the same policy file under `/etc/chromium/policies/managed/` and `--kiosk`, started by the session autostart | Supported; verify on hardware |
| ChromeOS device | Kiosk app or managed-guest policy with `AutoplayAllowlist` | Supported where a venue already manages ChromeOS |
| Android tablet or TV box | No launch flags in Chrome for Android. Either a kiosk browser app that allows media without a gesture and starts on boot (third-party; the owner chooses and licenses one), or Chrome with the site installed to the home screen, which Chrome's autoplay policy may allow; otherwise one tap per restart | Owner to choose; verify on hardware |
| iPad | Safari always needs a tap after each page load and suspends audio when the screen locks (ADR-0415); Guided Access keeps it on the page | Supported with a tap per restart, screen always on; not recommended |

- The guide is a product document, versioned with the app, and each row's status changes to "checked on <device>, <date>" only after a person has done it (Needs a person).

### Power cuts and auto-start

- The guide covers the device side: BIOS or firmware "restore on AC power loss: power on", automatic sign-in to a local kiosk account, the browser started at sign-in in kiosk mode on `/kiosk`, OS sleep off, and Windows Update active hours (or the browser's relaunch window policy) set outside opening hours.
- On load, the kiosk restores its pairing from the cookie and IndexedDB, reads its cached schedule and horizon (ADR-0446), and:
  - inside opening hours with trusted time: starts the horizon where the schedule says it should be now, with a 5 second fade-in, and reports `restarted_at` so the manager sees "Bar player restarted at 14:02 (power or crash?)";
  - inside opening hours with autoplay blocked: Tap to start, and the alert above;
  - closed: shows Closed and waits;
  - time not trusted (no server contact since boot and an implausible clock, ADR-0446): does not start by itself; shows Tap to start with "Time unknown", so a power return at 03:00 cannot wake the neighbours.

### Wake lock and screen

- While playing, the kiosk holds a screen wake lock (`wakeLock.ts`, re-asked on `visibilitychange`). Where wake lock is missing, the health report says so and the guide says to turn screen sleep off in the OS; audio playback on a desktop OS continues with the screen off, but some Android devices suspend the page, which the guide calls out.
- When closed, the venue may let the screen sleep (ADR-0453). Burn-in avoidance is ADR-0453's.

### Auto-update without interrupting service

- The kiosk app is versioned (`kiosk_version` in every heartbeat). A new version is fetched by the service worker in the background and **activated only while the zone is closed**, or in the 30 minutes before warming (ADR-0444), never while open. Activation reloads the page once ("Updating, back in a moment", at most 60 seconds).
- The server keeps the kiosk API backward compatible for the current and previous two kiosk versions, and for at least 14 days after a release, so a kiosk that missed updates (a venue open every day until 02:00, offline at night) keeps working.
- An **urgent** update (a security fix) may be activated during opening hours only at a song boundary where the next transition is a simple fade, and only if REX Technologies marks it urgent; it is logged and the manager is told afterwards. Venues open 24 hours get updates at their quietest hour from the play history.
- Browser and OS updates are outside the page's control; the guide sets their windows and the health report shows the browser version so a forced browser restart is visible.

### Health heartbeat

- Every 5 s the speaker's playback heartbeat (ADR-0443) continues as today. Every 60 s, and on every state change, the kiosk sends a **health report** to `POST /api/kiosk/health`: kiosk version, browser and version, audio context state, autoplay allowed, wake lock held, current output level (RMS from an `AnalyserNode` after the gain, so silence in SelectaDJ's own output is visible), playing state, hours of music saved ahead and storage used and available (ADR-0446), network state, clock offset, last restart and its reason, battery state where reported, the venue network (the public address, kept only as a keyed hash and used by ADR-0451).
- `device_health` keeps the latest report per kiosk plus a 30-day history at 5-minute resolution for the SLO (ADR-0448).

### Silent-zone alert

- A zone is **silent** during its open state (ADR-0444) when any of these holds for 60 seconds: no live lease; the speaker reports `playing` but its output level is digital silence (below -60 dBFS) where the plan expects music; the audio context is suspended; or the zone is paused by staff for more than 30 minutes (ADR-0453 D10).
- A zone is **unreachable** when no heartbeat has arrived for 2 minutes. Because a kiosk can keep playing offline (ADR-0446), unreachable is reported as "Bar player offline since 14:02, may still be playing", not as silent, and escalates only after 15 minutes.
- Alerts go to the venue's managers (in-app on manager devices, ADR-0453 S2 and S3, and email; push or SMS later, owner to decide) after 2 minutes, then to organisation admins after 15 minutes if not acknowledged. They are suppressed outside opening hours, during a manager's planned maintenance window, and while a staff person deliberately paused (until the 30-minute reminder). Each alert closes itself when music resumes and records the silent minutes for the SLO.
- SelectaDJ cannot hear the room: a switched-off amplifier or unplugged cable is invisible. The alert copy says what is known ("The Bar player is sending sound") and the guide suggests an occasional check.

### Stolen, broken or replaced devices

- **Replace**: a manager pairs a new device with "Replace Bar player"; the new device becomes home, the old token is revoked at once, and if the old one is still online it fades out told "This player was replaced".
- **Stolen**: unpair revokes the token immediately for an online device. An offline stolen device keeps its cached music (at most the ADR-0446 cache) and can play it until its offline permit runs out (ADR-0446); this exposure is stated in the guide and the business terms (ADR-0449). Unpairing also invalidates the permit server-side so a reconnect gets nothing.
- **Broken and re-paired**: a factory reset loses the key and token; the device pairs again as new, and the manager removes the old entry (shown as "Not seen since ...").

## Data model and code touchpoints

| Change | Where | Notes |
|---|---|---|
| `devices.principal`, `devices.zone_id`, nullable `user_id` (ADR-0442) and new `devices.public_key`, `devices.machine_id`, `devices.kiosk_version` | `playback/schema.py` | Kiosks excluded from `MAX_SIGNED_IN_DEVICES` in `devices.register` |
| New `kiosk_pairings` (code hash, expiry, single use) | new `business/schema.py` | Same hashing and limits as `display_pairings` |
| New `kiosk_tokens` (token hash, device id, rotated_at, revoked_at, nonce) | same | The nonce chain makes each heartbeat single use |
| New `device_health` (latest) and `device_health_history` (5-minute buckets, 30 days) | same | Tenant tables with `workspace_id` |
| New `zone_alerts` (zone, kind, opened_at, acknowledged_by, closed_at, silent_seconds) | same | Feeds ADR-0448's SLO and ADR-0453's Needs attention |
| `business/kiosk.py` routes: `POST /api/kiosk/pairings`, `GET /api/kiosk/pairings/status`, `POST /api/kiosk/pair` (manager), `POST /api/kiosk/heartbeat`, `POST /api/kiosk/health`, `GET /api/kiosk/view`, `DELETE /api/devices/{id}/kiosk` (unpair) | new | Rate limits as `rooms/limits.py` for unauthenticated pairing |
| Kiosk player | `web/src/kiosk/` reusing `audioSpeaker.ts`, `wakeLock.ts`, `usePlaybackDevice.ts` logic | Adds the device key, autoplay detection, output level meter |
| Alerts | `business/alerts.py`, run from `work/maintenance.py` | Uses `notifications` and ADR-0410's alert routing |

## User outcome and acceptance contract

A venue plugs in a small player, types a code once, and from then on the music starts by itself every day, survives power cuts and updates, and a manager hears about it within minutes if the bar goes quiet.

## Edge cases

- **Power cut mid-service.** The device boots, signs in, opens the kiosk, and resumes within its boot time, from where the schedule says, with no tap where the browser policy allows it.
- **Power returns at 03:00 when closed.** Shows Closed; nothing plays; if time is untrusted, it waits for a tap.
- **Autoplay policy changes after a browser update.** Detection catches it; Tap to start and the manager alert follow.
- **The kiosk tab crashes or is closed by a curious customer.** The OS kiosk mode reopens the browser; the guide covers locking the device. A crash is reported as `restarted_at` with reason `crash` when the page can tell (a previous session never wrote a clean shutdown).
- **Two kiosks paired to one zone.** Home and standby (ADR-0443); a third is refused.
- **A kiosk token copied to another machine.** Refused without the device key; the manager is told.
- **Device clock wrong by hours.** Server time is used online; ADR-0446 when offline.
- **Update published at 14:00 on a busy Saturday.** Waits until close; the kiosk stays on the old version, still supported.
- **An update fails to activate** (service worker error). The kiosk keeps the old version and reports it; never a blank page during service.
- **A stolen kiosk.** Unpair, then it can only play its cache until the offline permit ends; nothing new is ever sent to it.
- **The pairing person leaves the organisation.** The kiosk keeps working (ADR-0452).
- **The kiosk's storage is cleared by the OS.** The pairing is lost if IndexedDB is cleared; the device shows a new pairing code and the manager is alerted "Bar player needs pairing again"; the guide recommends requesting persistent storage (ADR-0446 does this).
- **The amplifier is off.** Not detectable; the alert copy is honest about it.

## Rejected alternatives

- **A native app for each platform.** The owner chose a browser app with no wrapper (11a section 11A.1); a kiosk browser setup gives the same result for the target devices. A wrapper stays possible later.
- **Hardware ids for device binding.** Browsers do not expose them; the WebCrypto key is the binding.
- **Alerting on unreachable as silent.** False alarms every time the venue Wi-Fi blips while the music keeps playing.
- **Updating whenever a new version is out.** A reload in service is an audible failure.

## Implementation checklist - 0/13 Implemented; 0/13 independently Verified

1. **BZ-0445-01 - Kiosk entry.** **Acceptance:** `web/kiosk.html` builds as its own entry with no React and no manager components; the ADR-0453 build test fails if manager code appears in it; the kiosk view payload carries only allowlisted fields. **Required verification:** Build test and payload test; vitest for the kiosk modules. **Implementation:** Not started. **Independently Verified:** No.
2. **BZ-0445-02 - Pairing by code.** **Acceptance:** Six-character codes renewed every 10 minutes, single use, hashed, rate-limited; a manager pairs into a zone in their scope; at most 2 kiosks per zone. **Required verification:** Integration tests; Playwright test pairing a kiosk page from a manager page. **Implementation:** Not started. **Independently Verified:** No.
3. **BZ-0445-03 - Kiosk token and device key.** **Acceptance:** Heartbeats are signed with a non-extractable key; a copied cookie is refused with `kiosk_key_mismatch` and the manager is told; tokens rotate every 7 days; unpair and replace revoke at once. **Required verification:** Integration tests including `test_kiosk_token_copied_to_second_machine_is_refused`. **Implementation:** Not started. **Independently Verified:** No.
4. **BZ-0445-04 - Autoplay detection and tap to start.** **Acceptance:** Blocked autoplay is detected without sound; Tap to start shows; inside opening hours the manager is alerted; one tap lasts for the page's life. **Required verification:** Playwright tests with autoplay blocked and allowed (Chromium launch flag), including `test_autoplay_blocked_shows_tap_to_start`. **Implementation:** Not started. **Independently Verified:** No.
5. **BZ-0445-05 - Kiosk setup guide.** **Acceptance:** `docs/business/kiosk-setup-guide.md` covers every platform row, power-on after power loss, auto sign-in, browser autostart, OS sleep, update windows and device locking; every row says whether it has been checked on hardware. **Required verification:** Doc review. **Implementation:** Not started. **Independently Verified:** No.
6. **BZ-0445-06 - Auto-start after restart.** **Acceptance:** A reload inside opening hours resumes where the schedule says with a fade-in and reports `restarted_at`; closed shows Closed; untrusted time never starts by itself. **Required verification:** Playwright tests with a fake clock including `test_power_cut_restart_resumes_without_a_tap_when_flags_allow`. **Implementation:** Not started. **Independently Verified:** No.
7. **BZ-0445-07 - Wake lock.** **Acceptance:** The wake lock is held while playing, re-asked on return, released when closed; a missing wake lock is reported in health. **Required verification:** vitest for `wakeLock.ts` use in the kiosk. **Implementation:** Not started. **Independently Verified:** No.
8. **BZ-0445-08 - Auto-update windows.** **Acceptance:** New versions activate only when closed or before warming; urgent updates only at a fade boundary and logged; the server accepts the current and previous two kiosk versions for at least 14 days. **Required verification:** Playwright test including `test_auto_update_waits_for_closed_hours`; API compatibility tests. **Implementation:** Not started. **Independently Verified:** No.
9. **BZ-0445-09 - Health reports.** **Acceptance:** The kiosk reports every field listed each 60 s and on change; the latest and a 30-day 5-minute history are stored; the venue network is a keyed hash only. **Required verification:** Integration tests; vitest for the output level meter. **Implementation:** Not started. **Independently Verified:** No.
10. **BZ-0445-10 - Silent-zone and offline alerts.** **Acceptance:** Silent after 60 s and unreachable after 2 minutes are told apart; managers are alerted at 2 minutes and admins at 15; alerts are suppressed when closed, in maintenance windows and during deliberate pauses; each closes itself and records silent minutes. **Required verification:** Integration tests with a fake clock for each trigger and suppression. **Implementation:** Not started. **Independently Verified:** No.
11. **BZ-0445-11 - Replace, unpair and re-pair.** **Acceptance:** Replace makes the new device home and fades the old one; unpair revokes and invalidates the offline permit; a reset device pairs as new and the old entry shows "Not seen since". **Required verification:** Integration tests. **Implementation:** Not started. **Independently Verified:** No.
12. **BZ-0445-12 - Real hardware endurance.** **Acceptance:** On a Windows mini PC with Chrome or Edge, an Android box or tablet, and an iPad: pairing, start without a tap where the guide says so, a power pull during service with automatic resume, 12 hours of continuous playback with the screen awake, and an update held until close, each recorded with device, browser version and date. **Required verification:** Needs a person: run the checks on the real devices at a pilot venue or bench and record the results in the guide. **Implementation:** Not started. **Independently Verified:** No.
13. **BZ-0445-13 - Flag `business.kiosk`.** **Acceptance:** `business.kiosk` (shared with ADR-0453's kiosk screen) is registered in `src/selecta/flags/cloud.json` (cloud mode, default off, requires `business.zones`) with the kiosk routes; `docs/flags.md` regenerated; with it off the kiosk routes answer 404 and the manager pages hide pairing and health with layouts reflowing. **Required verification:** `tests/test_flags.py`; Playwright flag-off run. **Implementation:** Not started. **Independently Verified:** No.

## Governance

Proposed on 2026-11-12, awaiting the owner's decision. Older ADRs keep their statuses; this one only links to them.
