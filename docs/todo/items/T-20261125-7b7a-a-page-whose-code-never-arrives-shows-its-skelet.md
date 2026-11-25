---
id: T-20261125-7b7a
title: A page whose code never arrives shows its skeleton with no way to ask again
area: shell
status: done
priority: later
who: claude
created: 2026-11-25
source: Dead-end audit, 2026-11-25
commit: a238aee7
---

App.tsx wraps lazy pages in Suspense with a Skeleton fallback that has no retry (App.tsx around line 714, RuntimeApp.tsx 105 and 114, business/shell/pages.tsx PageFallback). lazyPage (web/src/ui/staleBuild.tsx) handles a failed import, but an import that stalls (a network that never answers) leaves the skeleton saying only 'keep waiting'. Good: after a generous limit the fallback offers Reload (reloadForUpdate) with words that say the page is slow to arrive and that music keeps playing until they reload.
