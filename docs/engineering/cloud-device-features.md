# Cloud with music on the device: what it has of the Desktop

One place that answers "is a device-music Cloud account as good as the Desktop app, and where
is it not". A device-music account runs the Desktop's own shell in the browser
(web/src/cloud/LocalFirstShell.tsx) through the request adapter (web/src/cloud/localFirstRequest.ts).
What the shell switches off is one table, web/src/cloud/browserFlags.ts; every row there is
below, with what would switch it on.

Flags below are read with `flagListed` (web/src/flags.ts): a server too old to name a flag never
switches anything on. With any of them off, or on any failure, the page is as it was before.

## The table

| Desktop feature | Device-music Cloud account now | Flags | What would lift the difference |
|---|---|---|---|
| Library: every song, where it plays, Never play | Works | `cloud.local_first` | |
| Library rows and Song details: tempo, key, energy | Works for songs the account has measured; others show length only | `cloud.brain`, `cloud.device_analysis` | |
| Tempo and key corrections | Works: `PUT`/`DELETE /api/song-facts/{id}/correction`, read back from `GET /api/song-facts` | `cloud.brain`, `cloud.device_analysis` | |
| "Is it music?" | Decision: absent in a browser library; Never play keeps a song out of mixes | | T-20261126-3f92 |
| Analysis priority | Decision: absent; the device measures songs in spare time, one at a time | | |
| Song measurement (tempo, key, beats) | Works on the device, saved to the account | `cloud.device_analysis`, `cloud.brain` | |
| Neural beats | Works on a device that passes the Beat This gate; others use the standard beat finder, said in plain words | `cloud.device_analysis` | |
| Neural key, lyric timing | Decision: the standard key finder reads key; lyrics are not shown in a browser | | T-20261126-2cbe (lyrics) |
| Make a Mix: order from the planner | Works | `cloud.brain`, `cloud.device_analysis` | |
| Energy shape | Works: sent to the planner with the order | `cloud.brain`, `cloud.device_analysis` | |
| Idea cards on Make a Mix | Works: the account's cards beside the browser's own, and a card builds its mix with the planner choosing and ordering the songs; planned over at most 60 measured songs that play here | `cloud.brain`, `cloud.device_analysis` | T-20261126-6e24 (more than 60) |
| Mix language, ending | Works | | |
| Transition feel | Works: the order is planned in the feel, and each transition of a mix made in it is made on the device in that feel's moves (`language` on `/planning/candidates`); a mix already made keeps its transitions | `cloud.brain`, `cloud.device_analysis` (transitions: `cloud.device_render`) | |
| Stem moves, stem splitting | Decision: absent; the stem model is not published, so songs play whole | `cloud.browser_stems` when it is | T-20261125-03a3 |
| Transitions made ahead, audited and repaired | Works in a worker on the device | `cloud.device_render` | |
| Good and Bad on a transition | Works | `cloud.brain` | |
| Choosing a transition's move | Works | `cloud.browser_moves` | |
| Seam Inspector | Works for each transition this device made: the move, its reasons, where each song is left and joined, the checks, what else was tried, Good and Bad, and its preview played from the clip on the device; "Render it" asks this device to make one. Stem Studio is absent (no stems in a browser) | `cloud.device_render`, `cloud.brain` | |
| My Mixes, drafts, Undo | Works: the account's own mix routes | `cloud.brain`, `cloud.account_mixes` | |
| Locks | Works when the account keeps the mix; a mix kept in this browser has no lock | `cloud.brain`, `cloud.account_mixes` | |
| Energy horizon in the editor | Works: the mix's rows carry each song's energy, tempo and key as the account measured them; a song not measured shows none | `cloud.brain`, `cloud.device_analysis` | |
| Request a song | Works, kept with the account; the member adds it | `requests`, `cloud.account_mixes` | |
| A request placed by its planned transitions | Works: the account plans the place, this device makes its transitions after the mix's own, and it joins by itself (`/requests/consider` and `/requests/insert` with the device id); Add next still plays it right away | `cloud.brain`, `cloud.account_mixes`, `cloud.device_render`, `requests` | |
| Bridge songs for a request | Works when the account's place for a request needs one: the row shows the bridge and Use the bridge agrees to it; the device makes the chain's transitions and it joins by itself. Searching every song for a bridge has no Cloud route | `requests.bridges`, `cloud.brain`, `cloud.account_mixes`, `cloud.device_render` | T-20261126-0ae3 (the search) |
| Harmonic matches | Works from key profiles measured on the device | `cloud.browser_harmonic` | |
| Lucy | Works from the account | `lucy`, `lucy.cloud_conversation` | |
| Activity drawer | Works: this device's own work (songs being measured and how many are left, measurements being saved to the account, the transition being prepared and how many wait, the beat finder being downloaded or timed) above the recent changes with Undo; each line shows only with the flag behind that work | `app.activity` (each line: `cloud.device_analysis`, `cloud.brain`, `cloud.device_render`) | |
| Export of rendered audio | Works: Download audio saves the mix as a checked FLAC on this device, with the same transitions playback plays (made ahead, or made first, n of m shown, cancellable), each song at its playing level; nothing is uploaded | `cloud.local_export` (transitions: `cloud.device_render`) | |
| Lyrics | Decision: absent (licence, ADR-0406) | | T-20261126-2cbe |

## How the decisions are shown

A decision is never a dead control. The control is absent and the page reflows (the flag is
off in browserFlags.ts), and where the shell can still reach a route only the app answers, the
adapter refuses with "That works in the SelectaDJ app on a computer, not in a browser."
(`ONLY_IN_THE_APP`), which the views render as not available here.

## The rule that keeps it so

No string promises a feature later. web/src/copyAudit.test.ts ("no \"not yet\" in SelectaDJ")
and tests/test_no_promises_in_copy.py scan every string the web app and the server can say
for "not yet", "coming soon", "soon" as a promise and refusals ending in "yet", each with a
short list of explained exceptions (dates that are close, advice to retry, a CSS class).

## What leaves the device

Every request listed here is in web/src/cloud/deviceToAccount.egress.test.ts, with what it
carries: catalogue song ids, positions, tempos and keys, choices. Never audio, a file, a path or
a folder name.
