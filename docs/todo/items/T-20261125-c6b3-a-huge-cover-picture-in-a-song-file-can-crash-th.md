---
id: T-20261125-c6b3
title: A huge cover picture in a song file can crash the tab while music plays (Cloud)
area: library
status: open
priority: high
who: claude
created: 2026-11-25
source: Edge-case audit, 2026-11-25
commit:
---

web/src/media/artWorker.ts:109-110 calls createImageBitmap on the whole picture and only then compares width*height to MAX_PIXELS (40 MP). A small JPEG or PNG can declare 20,000 x 20,000 or more (a flat colour compresses to well under tags.ts MAX_PICTURE_BYTES, 15 MB), so the decode itself allocates 1.6 GB or more. The worker shares the renderer process with the page in Chromium, so an out-of-memory decode can kill the whole tab, audio included, during an import. Fix: read the declared dimensions from the header before decoding (JPEG SOFn, PNG IHDR, WebP VP8/VP8L/VP8X) in tags.ts picture() or the worker, refuse anything past MAX_PIXELS, and decode with createImageBitmap(blob, { resizeWidth, resizeHeight, resizeQuality }) once the size is known. Test with a crafted 30,000 px PNG header.
