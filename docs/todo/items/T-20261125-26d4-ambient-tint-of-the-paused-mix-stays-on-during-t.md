---
id: T-20261125-26d4
title: Ambient tint of the paused mix stays on during the blind listening study
area: shell
status: done
priority: normal
who: claude
created: 2026-11-25
source: Edge-case audit, 2026-11-25
commit: 54579e03
---

ADR-0477 rule 11 says the blind listening study gets no ambient colour. web/src/feel/useMusicFeel.ts:33-40 publishes the hue while the main player phase is not idle, and the study (web/src/views/Listening.tsx:240, takeAudio) only pauses the mix, so the paused song's tint (and its Listen bloom) stays behind the study. Nothing in feel/ or the study page turns the ambient part off. Fix: have the study page clear the hue while it is open (publishAmbientHue(null) and a data attribute that removes .ambient-layer and stops the beat bus), and add a test that the study page has no ambient layer and no data-beat targets running.
