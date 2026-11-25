---
id: T-20261125-f78f
title: iPhone in-app browsers are told to Add to Home Screen, which they cannot do
area: shell
status: open
priority: later
who: claude
created: 2026-11-25
source: Edge-case audit, 2026-11-25
commit:
---

web/src/cloud/install.ts:55-57 treats any page with navigator.standalone as Safari, but WebKit in-app browsers on iOS (Instagram, Facebook, Gmail, and other WKWebView hosts) expose it too and have no Share, Add to Home Screen. installMoments.ts then offers the home_screen words. Fix: detect common in-app user agents (FBAN, FBAV, Instagram, GSA, Line) and answer none there, or change the words to 'Open in Safari to install'.
