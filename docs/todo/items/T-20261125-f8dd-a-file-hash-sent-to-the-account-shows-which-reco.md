---
id: T-20261125-f8dd
title: A file hash sent to the account shows which recordings a member holds
area: legal
status: open
priority: normal
who: owner
created: 2026-11-25
source: One brain edge-case pass, 2026-11-25 (ADR-0479)
commit:
---

Device-only songs send no audio, but their SHA-256 and measurements are stored, and a hash of a commercial file is the same for everyone who has it. Shared derivations use that on purpose. The owner should confirm the privacy notice says so in plain words, and whether hashes may ever be matched across accounts for anything but sharing measurements.
