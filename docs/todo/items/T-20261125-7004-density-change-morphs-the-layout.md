---
id: T-20261125-7004
title: Density change morphs the layout
area: shell
status: open
priority: later
who: claude
created: 2026-11-25
source: Feel build, 2026-11-25
commit:
---

Plan 3.2 'Theme and density': the theme change is a circular reveal (built). A density change should morph rather than jump: wrap the density preference change in a view transition the way Shell useThemeReveal does for the theme, from wherever density is chosen (views/InterfaceChoices.tsx, outside the shell worker's files).
