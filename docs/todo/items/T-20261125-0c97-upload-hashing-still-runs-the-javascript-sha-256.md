---
id: T-20261125-0c97
title: Upload hashing still runs the JavaScript SHA-256 on the page
area: library
status: doing
priority: normal
who: claude
created: 2026-11-25
source: Import freeze hunt, 2026-11-25
commit:
---

web/src/cloud/uploadParts.ts fileSha256 hashes each upload with @noble/hashes in 8 MB synchronous slices on the main thread (about 40 ms per MB on the owner's i7-10510U, so 300+ ms per slice). The import path now uses WebCrypto (media/identity.ts fileSha256). Reuse media/identity.ts fileSha256 here, or yield between smaller pieces; the digest must stay the same.
