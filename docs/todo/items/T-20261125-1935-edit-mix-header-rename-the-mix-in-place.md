---
id: T-20261125-1935
title: Edit mix header: rename the mix in place
area: editor
status: open
priority: normal
who: claude
created: 2026-11-25
source: Feel build, 2026-11-25
commit:
---

Plan 3.7 asks for inline rename in the editor header. Today Rename opens RenameDraft below the header (views/Mix.tsx renameForm). Mix.tsx is at about 980 of 1,000 lines, so the rename has to move into EditorHeader.tsx (the h1 becomes the field, styled like the My Mixes row rename in feel-library.css) with Mix.tsx passing only the handler.
