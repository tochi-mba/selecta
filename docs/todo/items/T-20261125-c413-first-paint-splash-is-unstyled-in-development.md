---
id: T-20261125-c413
title: First-paint splash is unstyled in development
area: shell
status: done
priority: later
who: claude
created: 2026-11-25
source: Browser pass in Helium, 2026-11-25
commit: a238aee7
---

web/index.html now carries a splash that relies on boot.css. In the Vite dev server CSS arrives from JavaScript, so a bare S and Starting SelectaDJ show on white for a moment. Production links the CSS in the head. Good: confirm it is styled in a production build, or inline the few rules the splash needs within the page security policy.
