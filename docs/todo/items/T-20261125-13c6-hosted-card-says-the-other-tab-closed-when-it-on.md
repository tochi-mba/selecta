---
id: T-20261125-13c6
title: Hosted card says the other tab closed when it only stopped
area: devices
status: open
priority: later
who: claude
created: 2026-11-25
source: hosted polish, walkthrough 8.1
commit:
---

When another tab takes the hosted mix's sound and later lets go, the card shows 'The tab that was playing closed.' even when that tab only stopped playing. audioTab could broadcast a 'released' message on an ordinary release so the line can say 'The other tab stopped playing.' The app's own OtherTabLine has the same wording gap.
