---
id: T-20261125-9cad
title: Local drafts: Play carries the mix face to Listen
area: shell
status: open
priority: normal
who: claude
created: 2026-11-25
source: Feel build, 2026-11-25
commit:
---

Saved Cloud mixes and the current mix card now carry their face into Listen's cover (shared element player-art). A local draft's Play goes through App.playDraft (with its replace-the-playing-mix confirm), which navigates without the row's tile, and the local sheet hides Listen's cover, so there is no destination there. Thread the draft row's MixArt element through playDraft/activateDraft as navigate share, and give the local Listen hero a visible cover (or a mix-art destination) under the feel flags.
