# Words we use

SelectaDJ runs in three places. The code grew three sets of names for them, and some words meant
two things. From 2026-11-25 (ADR-0479) new docs and all member copy use the words below. This is
the one list: every old name, in words and in code, is mapped to its new one further down, with
what was renamed in the code and what keeps its old name, and why.

## The three places

| Say | Means | In the code |
|---|---|---|
| **Desktop** | SelectaDJ running on the person's own computer: a local server and its site, no account, music never leaves the machine | `SELECTA_MODE=local`, `ShellMode 'local'`, `web/src/App.tsx`, "this PC" |
| **Cloud** | The signed-in SelectaDJ at `app.selectadj.app`. One app, whatever a song's home is | `SELECTA_MODE=cloud`, `web/src/cloud/`, `CloudShell` |
| **Kiosk** | A venue player for SelectaDJ for Business | `web/src/kiosk/`, `business/` |

What each place does (where the audio lives, who measures, who renders, what works across
devices) is in [saas/README.md, Three places](saas/README.md#three-places).

## Where a song lives (Cloud)

Members never see a "mode". They see where each song lives. One account can hold both.

| Say | Means | In the code |
|---|---|---|
| **On this device** | The file stays on the member's device; Cloud knows the song but holds no audio | `deviceMusic*` modules, `experience.local_first`, `cloud.local_first`, `cloud.local_media`, `local_songs`, `MusicHome 'device'` |
| **In your cloud library** | The file was uploaded and is stored with SelectaDJ | `cloudLibraryMedia`, `experience.hosted`, `cloud.hosted_media`, `cloud.stored_media`, `assets`, `MusicHome 'cloud_library'` |

Member copy that differs by where the music lives comes from one place, `web/src/copy.ts`:
`words()` gives the Desktop set on Desktop, and in Cloud the set for the account's music home
(on this device, in the cloud library, or both), with everything that does not differ shared.

## Where the audio work happens

A **studio** does the audio work: measuring songs, splitting stems, rendering and checking
transitions.

| Say | Means | In the code |
|---|---|---|
| **Desktop engine** | The full Python engine on the person's computer | `src/selecta/analysis`, `render`, `seams.py`, `stems.py` |
| **Cloud studio** | SelectaDJ's workers running that same engine on songs in the cloud library | `workers/engine_handlers.py`, `workers/engine_seams.py`, `hosted_render.py`, the console's Workers page |
| **Device studio** | The member's own browser doing the audio work on songs that stay on the device | `web/src/engine/`, `web/src/dsp/` |

## Planning words

| Say | Means |
|---|---|
| **Song facts** | Measurements of a song: tempo, beat and bar positions, sections, key, loudness, per-bar energy and tone numbers, when singing happens. Never audio. An engineering word: members read "measured", "tempo", "key" |
| **Audio id** | A fingerprint of a song's sound alone, leaving out its tags and artwork, so editing a title keeps it the same song. A hash, never audio; the same recording as MP3 and as FLAC has two (`library.audio_identity`, docs/engineering/audio-identity.md) |
| **Planner** | The Python code that chooses the song order, where to leave and enter, the move and its length. It runs on Desktop or on the Cloud server, never in a browser |
| **Script** | A transition described as data (`render/script.py` `TransitionScript`), which any studio can render |
| **Seam** | The stretch where one song hands over to the next. Members read "transition" |
| **Move** | A kind of transition: blend, vocal ride, cut, echo out and so on (`seam_kinds.MOVES`) |
| **Audit** | The measurements a rendered seam must pass before anyone hears it (`audit/checks.py`) |

## Words that keep two meanings, so say which

- **Workspace**: the account's workspace (tenancy), and the Workspace page in the shell.
- **Library**: the person's songs as a list, wherever they live.
- **Mode**, outside the three places: the console's view mode, billing safe mode, wall mode,
  Stage mode and the editor's modes are controls, not places, and keep the word.

## Old names and what they are now

Member copy and current docs no longer use the words on the left. Two copy audits refuse them in
any string a page or the server can show: `web/src/copyAudit.test.ts` and
`tests/test_no_promises_in_copy.py` ("no retired names"), each with a short list of identifiers
that must keep the old word and why.

| Old word | Now | Notes |
|---|---|---|
| local-first, local first | on this device (where a song lives), device studio (where the work happens) | Also meant Desktop in older ADRs ("local-first privacy"): there it is Desktop |
| browser-first, browser first | on this device, device studio | |
| BF (as a product name) | on this device | `BF-0455-03` and the like are requirement ids and stay |
| hosted, hosted mode, hosted media | in your cloud library; the cloud studio for the work | "hosted deployment" for our own servers is not this word |
| local mode | Desktop | `SELECTA_MODE=local` stays |
| cloud mode | Cloud (or "the Cloud server" for `SELECTA_MODE=cloud`) | |
| local, on its own | Desktop, or on this device | It meant both |
| mode, for the Cloud cases | where a song lives | There is one Cloud |
| the local app | the Desktop app | |
| hosted processing | the cloud studio | The console's Workers page |
| storage mode (console) | where their music lives | The console section is "Storage and processing" |
| Labs: browser-first Cloud | Labs: music on your devices | |
| hosted-mode-walkthrough.md | [cloud-library-walkthrough.md](engineering/cloud-library-walkthrough.md) | Moved with `git mv` |

### Code identifiers renamed (ADR-0479 phase 9)

Mechanical renames with `git mv` and a whole-identifier replace, each family its own commit,
checked with `tsc`, the family's tests, the copy audits, the polling register and the surface,
route-task and side-effect inventories. No behaviour changed; no stored key, route, flag id or
job type was renamed.

| Old identifier | New identifier | Scope | Size |
|---|---|---|---|
| `LocalFirstShell` (`cloud/LocalFirstShell.tsx` and its test) | `CloudShell` (`cloud/CloudShell.tsx`) | web, docs, inventories | 2 files moved, 19 files changed (`c2570848`) |
| `localFirst<Name>` modules: `localFirstRequest`, `localFirstRequests`, `localFirstMixes`, `localFirstPlayer`, `localFirstLibrary`, `localFirstLinks`, `localFirstDiscoveries`, `localFirstGate`, `localFirstParts`, and the `localFirstDecided` helper | `deviceMusic<Name>`: `deviceMusicRequest`, `deviceMusicRequests`, `deviceMusicMixes`, `deviceMusicPlayer`, `deviceMusicLibrary`, `deviceMusicLinks`, `deviceMusicDiscoveries`, `deviceMusicGate`, `deviceMusicParts`, `deviceMusicDecided` | web/src/cloud and importers, docs, side-effect map | 21 files moved, 75 files changed, 139 lines (`8b4a3159`) |
| `LocalFirstLabs`, `LocalFirstEmpty` | `DeviceMusicLabs`, `DeviceMusicEmpty` | web, CSS notes, registers | 4 files moved, 20 files changed (`94970404`) |
| `hostedMedia` and its `hostedAssets`, `hostedResolver`, `forgetHostedAssets`, `readHostedAssets`, `HostedAsset` | `cloudLibraryMedia`, `cloudLibraryAssets`, `cloudLibraryResolver`, `forgetCloudLibraryAssets`, `readCloudLibraryAssets`, `CloudLibraryAsset` | web/src/cloud, the reconciliation panel, the harness | 2 files moved, 11 files changed (`097d92d7`) |
| `copy.ts` `Mode`, `setCopyMode`, `copyMode`, `copy.local`, `cloudModeCopy` | `Place`, `setCopyPlace`, `copyPlace`, `copy.desktop`, `musicHomeCopy` (plus `MusicHome`, `setMusicHome`, `musicHomeOf`) | web | `65a35d31` |
| Diagnostics operation ids `local-first:*` | `device-music:*` | web, not stored | `b3f09dbb` |

Accepted ADR bodies keep the old identifiers as records.

### Code identifiers kept for now

| Identifier | Would be | Occurrences (git grep, words) | Why it stays |
|---|---|---|---|
| Flag ids `cloud.local_first`, `cloud.local_first_labs`, `cloud.hosted_media`, `cloud.hosted_render`, `cloud.hosted_shell`, `cloud.hosted_brain`, `cloud.hosted_caps`, `cloud.hosted_dedupe`, `cloud.local_media`, `cloud.browser_*` | (mapped only) | many | Stored in rule tables, settings and builds: renaming one drops every rule and preference set for it. Their labels now use the new words |
| `experience.local_first`, `experience.hosted` (account snapshot) | on device, cloud library | 9 | A wire field the deployed client reads |
| `src/selecta/local_media/` (the Cloud catalogue of device songs) | `device_music` | 214 in 123 files | String-referenced by the persistence registry (`selecta.local_media.*_schema`), owns tables and migrations, and names the `/api/local-media` routes |
| `src/selecta/hosted_render.py`, `hosted_brain.py`, `hosted_caps.py`, `hosted_*.py`, `hosted_coexistence/` | `cloud_studio_*` | `hosted_render` 154 in 38 files | Named by flag ids, job evidence lists in `cloud_mixes.CAPABILITIES`, docs evidence and tests; a Python package rename is not mechanical here |
| `src/selecta/cloud_mixes.py` | (keeps its name) | 29 in 8 files | Names itself in its own capability evidence strings and serves `/cloud-mixes`; "cloud mixes" is not a retired word |
| `tests/test_bf_*.py` | `test_device_music_*` | 24 files | Names cited in CI, ADR evidence and checklists; developer-only |
| `web/src/cloud/HostedShell.tsx`, `web/src/cloud/hosted/` (`HostedMix`, `HostedMakeAMix`, `hostedWords`, `timelinePlayer`), `useCloudPlayer.ts` | retired, not renamed | | Pages still in use; retiring them is to-do T-20261126-73f9 (below) |
| Route paths `/api/account/labs/local-first`, `/api/local-media/*`, `/api/hosted/*`, `/admin/hosted/*`, `/admin/customers/{id}/storage-mode` | (kept) | | A deployed client calls them |
| Stored values: the `bf-local-first` rule salt, the Labs cohort note, `selecta.labs.feedback-draft`, the `hosted_only` row kind, the `mode: 'hosted' or 'browser'` field of the console's API | (kept) | | Data: renaming loses a member's state or re-buckets a rollout |
| CSS classes such as `local-first-*`, `hosted-mix-*`, `cloud-hosted-page` | (kept) | | Selectors in tests, e2e specs and stylesheets; renaming them is not word-for-word safe |
| `localFirst` as a bare variable or prop, `SELECTA_MODE=local` | (kept) | | The first is local state named for the old flag; the second is the server's real setting |

## What was confusing and what it is now

ADR-0479 named what made the owner's original complaint ("the two Cloud modes are confusing").

- **Five names for one thing** (local-first, browser-first, BF, device music, "local mode" in
  Cloud): now one, "on this device", in every member string, guarded by both copy audits; the code
  says `deviceMusic*` for the web modules. The Python package `local_media` and the flag ids keep
  the old names (above).
- **"Hosted" as a mode and as a file source**: a member now reads "in your cloud library" for
  where a song lives, and staff read "cloud studio" for the workers; nothing a member sees says
  hosted. `hosted_*` Python modules, flags and routes keep the word.
- **"Local" meaning both Desktop and music on the device**: member copy, the server's messages and
  current docs say Desktop for the computer app and "on this device" for a song.
- **One Cloud word set that contradicted itself**: `copy.ts` now picks Cloud sentences by where
  the account's music lives, so a device-music member is no longer told SelectaDJ Cloud measured,
  uploaded or rendered their songs, and a cloud library member is no longer told nothing is
  measured ahead.
- **Three shells**: the device-music shell is now the Cloud shell (`CloudShell`), and with
  `cloud.hosted_shell` on (the default) cloud library accounts draw their pages inside it. Still
  open: the legacy side rail in `CloudApp.tsx` (kept for `cloud.hosted_shell` off) and the
  cloud library's own thinner pages (`HostedShell.tsx`, the Make a Mix card in
  `cloud/hosted/`) are still separate, to-do T-20261126-73f9.
- **Two Cloud players** (three counting the device's): still open. `useCloudPlayer.ts` plays the
  cloud library in the legacy pages, `cloud/hosted/timelinePlayer.ts` plays a cloud library mix
  on its card, and `deviceMusicPlayer.ts` plays music on the device; one player for the Cloud
  shell is part of the same to-do.
