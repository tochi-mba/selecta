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

Done in the two-places plan's phase 8, behind `cloud.one_shell` (off by default, needs `library.places` and `cloud.account_mixes`): CloudApp mounts CloudShell for every Cloud account, in one place in the tree. An account with no music on its devices gets the cloud-only profile (`musicHomes` `{device: false, cloud: true}`, web/src/cloud/musicHomes.ts): no device sweeps, folder checks, Connect music, This device, device studio, import chip or getting-started spine; the Library's add action is Upload music (/upload); songs play from the cloud library by catalogue id (`cloudOnlyResolver` in cloudShellMedia.ts) through the shared engine, which is a session speaker; Make a Mix is the shared mixer, with the cloud file and the file saved here. `cloud.local_first` off no longer swaps frames while `cloud.one_shell` is on, so the Labs switch only hides device features. Where every older page and control now lives: docs/engineering/cloud-library-walkthrough.md section 15. Still left: removing the older rail, pages and players after one release with the flag on (T-20261126-fefe), earlier versions of mixes from the older Make a Mix page (T-20261126-6080), and the renames.
