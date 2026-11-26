---
id: T-20261126-f3d4
title: A Listening Room trial for transitions made in the cloud
area: editor
status: open
priority: normal
who: claude
created: 2026-11-26
source: two-places plan Phase 5 (cloud.studio_seams), browser half
commit:
---

The Listening Room compares transitions made ahead on this device against live ones, but has no trial for a transition made in the cloud (cloud.studio_seams). A fair trial needs both variants to play the songs' lossless files at the levels the cloud clip was made at: the room decodes and levels each song itself (listening-room/audition.ts decode and levelOf, keyed by song id), and createSession takes one list of trial pairs for the whole session, so a cloud pair needs its own kind per transition. Good: for a pair whose two songs have their own cloud copies, a 'made in the cloud' variant (a CloudSeams planner for the pair) against this device's live choice, both from the lossless files at the cloud's levels, blind as the other trials; the reveal says what played. Until then the owner compares by ear with the flag off and on (docs/engineering/one-brain-listening.md).
