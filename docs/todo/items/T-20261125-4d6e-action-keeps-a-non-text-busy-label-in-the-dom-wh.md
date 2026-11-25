---
id: T-20261125-4d6e
title: Action keeps a non-text busy label in the DOM while idle
area: shell
status: open
priority: later
who: claude
created: 2026-11-25
source: hosted polish, walkthrough 8.1
commit:
---

ui/controls Action now draws the label that is not true from data-label with empty alternative text, so no name carries busy words. That works only for string labels; a working label that is a React node (an icon and words) is still rendered hidden in the DOM while idle. Find any such use and make it a string, or reserve its room another way.
