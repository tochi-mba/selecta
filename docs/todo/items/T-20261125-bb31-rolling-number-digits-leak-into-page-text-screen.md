---
id: T-20261125-bb31
title: Rolling number digits leak into page text (screen readers, and the failing web tests on main)
area: shell
status: open
priority: high
who: either
created: 2026-11-25
source: staging re-test with Modal workers after PR 149, 2026-11-25
commit:
---

The feel system's rolling numbers put every digit strip in the page text: a count reads as '48 songs / 0 / 1 / 2 / 3 / 4 / 5 / 6 / 7 / 8 / 9 / 0 / 1 ...' in innerText (seen on Make a Mix and on the console's Workers page). Unless each strip is hidden from assistive tech with the real value exposed once, a screen reader reads the digits, and tests that look for '3 transitions in line' or '12 to go' cannot find the text, which matches the 19 web tests failing on main. Owned by the feel-system work; listed here so it is not lost.
