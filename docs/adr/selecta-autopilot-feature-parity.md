# Autopilot feature-preservation and older ADR ownership

**No current functionality is removed, deactivated or made inaccessible by this programme.** No older ADR status is changed. The source-present Local, Cloud and Rooms features remain first-class, not placeholders for a future venue redesign.

| Surface | Preserve | Existing owner | Proposed integration |
|---|---|---|---|
| Local privacy/startup | Account-free local server, music never silently uploaded, source paths, original file checksums | ADR-0025, 0072, 0391 | 0417, 0421 |
| Mix creation | Quick listen, defaults, destination, energy, lyric/stems, drafts/current mix, exact revision | ADR-0376, 0379 | 0418, 0423, 0426 |
| Listen and audio focus | Explicit Pause, seeking, current music identity and one owner | ADR-0373, 0399, 0415 | 0419, 0429 |
| Advanced tools | Editor, Seam Inspector, eight Studio lanes, 8-64 cells, fifteen visualizers, keyboard/Still | ADR-0380-0382, ADR-0185-0197 | 0417, 0427, 0439 |
| Requests and discovery | Approval, directed atomic bridges, words/harmony/lyrics and Lucy | ADR-0383-0384, 0404 | 0423, 0431 |
| Export and study | Frozen revision FLAC, truthful jobs, independent blind testing | ADR-0386 | 0427, 0438 |
| Cloud basics | Uploads/resumption, quotas, private Library, subscriptions, tenant isolation | ADR-0393-0403 | 0418-0421 |
| Cloud operations | Admin roles, flags, observability, privacy, licence register | ADR-0401, 0405, 0408, 0410-0414 | 0434-0436 |
| Cloud playback | Consumer device session, Play here, lease, offline and remotes | ADR-0415 | 0419, 0429, 0433 |
| Rooms | Host moderation, QR guest, nickname, votes, requests, anonymous tokens and display | ADR-0416 | 0422, 0431 |

Existing code observations that **need reproduction**, not confirmed defects: Cloud Library page-local audio versus PlayingBar, Cloud Listen using `/assets?limit=200` and song indexes until mixes exist, substring Cloud routing, initial error/empty confusion, upload mixed success message and nickname async poll. Do not call an old capability missing merely because its new acceptance task starts Not started. Any proposed replacement must add equivalent functionality, backcompat, flag-off parity and independent test results before removing an old route, and removal needs distinct explicit owner approval.
