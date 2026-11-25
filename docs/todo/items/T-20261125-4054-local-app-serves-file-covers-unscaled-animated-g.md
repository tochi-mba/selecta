---
id: T-20261125-4054
title: Local app serves file covers unscaled: animated GIFs loop, and huge pictures decode at full size in every row
area: local-app
status: open
priority: high
who: claude
created: 2026-11-25
source: Edge-case audit, 2026-11-25
commit:
---

src/selecta/library/art.py:47 and sniff() (59-70) accept image/gif, and the bytes are served as stored up to 4 MB (MAX_PICTURE_BYTES, 42) by GET /api/songs/{id}/art (src/selecta/routes/library.py:795-825). Consequences: (1) an animated GIF, APNG or animated WebP cover loops forever in the Library, the dock, Listen and the lock screen, ignoring Still and reduced motion and ADR-0477 rule 4 (only music moves); (2) a 4 MB JPEG can declare 20,000 x 20,000 px and every row that shows it decodes it at full size in the page (no pixel cap anywhere on this path), enough to crash the tab mid-mix; (3) a 3000 px cover on 50 rows is ~1.8 GB decoded. Cloud avoids all three by re-encoding the first frame at 96 and 512 px (artWorker.ts). Fix: parse the header dimensions in art.py and refuse past ~40 MP; drop GIF (or keep only a still first frame); and either scale on the server (needs Pillow, see T-20261125-c833) or route local covers through the same browser worker downscale before showing them in rows.
