"""The metadata-only song catalogue for local-first Cloud accounts (ADR-0458).

The browser imports music the member can reach and registers track identities with Cloud: a
content hash plus display metadata, and which devices report holding a playable copy. The audio
itself never leaves the member's device, and no raw path ever reaches this package.

- `schema`: the `local_songs` and `local_song_availability` tables.
- `store`: register, list, soft-delete and availability reads and writes.
- `api`: the `/api/local-media/*` routes, owned by the `cloud.local_media` flag.
- `catalog`: `LocalMediaCatalog`, Rooms' `SongCatalogPort` over these tables.
"""

from __future__ import annotations
