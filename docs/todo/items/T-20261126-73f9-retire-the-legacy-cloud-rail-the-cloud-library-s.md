---
id: T-20261126-73f9
title: Retire the legacy Cloud rail, the cloud library's own pages and the extra Cloud players
area: shell
status: open
priority: normal
who: claude
created: 2026-11-26
source: docs/glossary.md, What was confusing and what it is now (ADR-0479 phase 9)
commit:
---

The Cloud shell (web/src/cloud/CloudShell.tsx) draws cloud library pages when cloud.hosted_shell is on, but three older pieces remain: the legacy side rail in web/src/cloud/CloudApp.tsx (kept for cloud.hosted_shell off), the cloud library's thinner pages of its own (web/src/cloud/HostedShell.tsx and the Make a Mix card with its own player in web/src/cloud/hosted/, HostedMix and timelinePlayer), and the legacy pages' player web/src/cloud/useCloudPlayer.ts. Good looks like: one Cloud shell renders the Desktop pages for every account whatever its music home, one Cloud player plays the cloud library and the device's music, and the old rail, pages and players are removed behind their flags with the e2e flag sweep still green. Then rename the remaining hosted identifiers in web/src/cloud (glossary, kept for now).
