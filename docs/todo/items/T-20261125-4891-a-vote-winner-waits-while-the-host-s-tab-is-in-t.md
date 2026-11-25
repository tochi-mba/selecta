---
id: T-20261125-4891
title: A vote winner waits while the host's tab is in the background
area: rooms
status: open
priority: normal
who: either
created: 2026-11-25
source: ADR-0488 build, 2026-11-25
commit:
---

The room's pick joins the mix through the Requests join loop, which by design never changes the mix from a hidden tab. At an unattended party with the speaker's tab in the background the winner sits in Requests until the host returns, and guests see Going into the mix. Decide whether a room's pick may join from a hidden tab while that tab is the one making the sound.
