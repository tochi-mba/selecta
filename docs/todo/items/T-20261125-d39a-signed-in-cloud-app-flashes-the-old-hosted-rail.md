---
id: T-20261125-d39a
title: Signed-in Cloud app flashes the old hosted rail with Free plan before the account loads
area: shell
status: done
priority: normal
who: claude
created: 2026-11-25
source: Browser pass in Helium, 2026-11-25
commit: 217da733
---

Opening /library in Helium showed the legacy hosted frame (Overview, Add music, Plan and billing, a Free plan chip, an empty Your library) for several seconds, then the real shell with Premium. Good: the loading state holds until the account and its features are known, never a wrong frame or plan.
