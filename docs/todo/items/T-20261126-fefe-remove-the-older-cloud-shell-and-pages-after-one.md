---
id: T-20261126-fefe
title: Remove the older Cloud shell and pages after one release with cloud.one_shell on
area: shell
status: open
priority: normal
who: claude
created: 2026-11-26
source: two-places plan phase 8 (cloud.one_shell), docs/engineering/cloud-library-walkthrough.md section 15
commit:
---

With cloud.one_shell on, every Cloud account opens CloudShell (an account with no music on its devices gets the cloud-only profile), so the older Cloud frames and pages are used only with the flag off. After one release with cloud.one_shell on for every account and no rollback, remove them in one change: web/src/cloud/HostedShell.tsx and its test; the legacy side rail in web/src/cloud/CloudApp.tsx (the cloud-shell aside, Overview, RoomsCard, pageFor, PATHS, LABELS, TITLES, dockPage, choosePage, the legacy deleteDialog) and web/src/cloud/CloudRailFeel.tsx; web/src/cloud/Library.tsx (LibraryPanel); web/src/cloud/MakeCloudMix.tsx; web/src/rooms/CloudListen.tsx; web/src/cloud/hosted/HostedMix.tsx, HostedMakeAMix.tsx and hostedMix.css (footerWords moves out of hostedWords.ts first); web/src/cloud/useCloudPlayer.ts, web/src/cloud/CloudTransportDock.tsx and web/src/cloud/cloudCatalogue.ts if nothing else imports it; web/src/cloud/hosted/timelinePlayer.ts, partReader.ts and flacFrames.ts once cloudMediaContexts.ts and state/pollingPolicy.ts no longer import them; the HostedShell branch in CloudApp, NOT_IN_HOSTED, and the cloud.hosted_shell flag with its rules; web/e2e-cloud/hosted-shell.cloud.ts. Then cloud.local_first stops choosing a frame at all (it only says whether the account has music on its devices), and the glossary's kept identifiers for these files go. Good looks like: one Cloud shell and one player in web/src/cloud, the e2e flag sweep green, and no test or doc naming a removed file.
