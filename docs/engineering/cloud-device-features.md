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
| Mix language, ending | Works | | |
| Transition feel | Decision: absent; transitions use the standard feel | | T-20261126-6f97 |
| Stem moves, stem splitting | Decision: absent; the stem model is not published, so songs play whole | `cloud.browser_stems` when it is | T-20261125-03a3 |
| Transitions made ahead, audited and repaired | Works in a worker on the device | `cloud.device_render` | |
| Good and Bad on a transition | Works | `cloud.brain` | |
| Choosing a transition's move | Works | `cloud.browser_moves` | |
| Seam Inspector | Decision: absent; rate and choose moves from the mix instead | | T-20261126-827e |
| My Mixes, drafts, Undo | Works: the account's own mix routes | `cloud.brain`, `cloud.account_mixes` | |
| Locks | Works when the account keeps the mix; a mix kept in this browser has no lock | `cloud.brain`, `cloud.account_mixes` | |
| Energy horizon in the editor | Decision: absent | | T-20261126-bfec |
| Request a song | Works, kept with the account; the member adds it | `requests`, `cloud.account_mixes` | |
| A request placed by its planned transitions | Works: the account plans the place, this device makes its transitions after the mix's own, and it joins by itself (`/requests/consider` and `/requests/insert` with the device id); Add next still plays it right away | `cloud.brain`, `cloud.account_mixes`, `cloud.device_render`, `requests` | |
| Bridge songs for a request | Decision: absent | | T-20261126-ae4f |
| Harmonic matches | Works from key profiles measured on the device | `cloud.browser_harmonic` | |
| Lucy | Works from the account | `lucy`, `lucy.cloud_conversation` | |
| Activity drawer | Decision: absent; the Workspace page shows the file check and imports | `cloud.workspace` | T-20261126-36c7 |
| Export of rendered audio | Decision: absent; Download my data is in Account | | |
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
