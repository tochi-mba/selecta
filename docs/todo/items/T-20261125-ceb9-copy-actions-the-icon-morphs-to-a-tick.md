---
id: T-20261125-ceb9
title: Copy actions: the icon morphs to a tick
area: shell
status: open
priority: normal
who: claude
created: 2026-11-25
source: Feel build, 2026-11-25
commit:
---

Plan 3.0 'Copy actions': each copy button's icon should turn into a drawn tick when the clipboard write really succeeded. Copy buttons live in other screens' files: rooms/RoomShare.tsx, rooms/RoomRecap.tsx, devices/DeviceCheck.tsx, cloud/BrowserDiagnostics.tsx, views/LucyTranscript.tsx, views/WorkshopPanels.tsx, listening-room/RevealScreen.tsx (neutral: component feedback only), business/venue/PeoplePage.tsx, admin/ui.tsx, admin/StripeLive.tsx. Good: they use Action from ui/controls.tsx (which already draws the tick after real success and a danger edge after failure), or a shared CopyButton built on it with a gallery specimen.
