# ADR-0478 - Real artwork and web lookups for song details

- **Decision:** Proposed (the owner asked on 2026-11-25 to use the art already inside a song's file, to look up what is missing from free web sources, and to keep what is fetched in our own database; approval of this record is the owner's).
- **Implementation:** In progress on branch `feat/feel-system`. See the checklist at the end.
- **Independent verification:** None.
- **Programme/date/baseline:** Feel (FL); 2026-11-25; `main` at `f5b6a4ab`.
- **Existing ADR owners:** UF-0369-05 ("shows no album covers it doesn't have") is replaced by the rule below. ADR-0136 ("never invent cover art") is kept. ADR-0405 (licence register) gains rows.
- **Flags:** `library.art_embedded` (art from the person's own files) and `library.art_lookup` (web lookups; off outside development until the owner clears the terms below).

## The rule

**Real or clearly generated.** A cover is shown only when it is the file's own picture or a high-confidence match from our catalogue. Otherwise the generated colour tile is shown, as today. Never a guess, and never an invented picture.

## Where a cover comes from, in order

1. **The song's own file.** Embedded pictures: ID3 `APIC`, FLAC `PICTURE`, MP4 `covr`.
   - Cloud: read in the browser during import (`web/src/media/tags.ts`), downscaled in a worker to two sizes, kept on the device beside the import data. It is never uploaded.
   - Local app: read with mutagen during the scan (`src/selecta/library/scan.py`), cached under the data home and served by the local API.
2. **Our own catalogue, filled from the web.** A server-side job matches a song to a MusicBrainz release, fetches the front cover from the Cover Art Archive, and stores the text, the image sizes and a palette hue in our database and object storage. One lookup serves every account that has that song. A miss is remembered so it is not retried at once.
3. **The generated tile**, whenever neither exists or the match is not confident.

## Matching

- An ISRC read from the file's tags is used first (the reader in `src/selecta/business/isrc.py`).
- Otherwise: normalised artist and title, the duration within four seconds, and a single clear winner. Two close candidates count as no match.
- A match stores its method and confidence. The person can open "Wrong cover?" on a song to pick another candidate or go back to the generated tile; that choice is kept and wins over any later lookup.

## What leaves, and what does not

- A lookup sends the artist, title, album and length of a song from our server, the same details a lyric lookup sends. The account has a setting for it with those words beside it.
- The person's files and the pictures inside them never leave their device.
- Images are only ever served from our own origin or from a local blob. No page hot-links a third party.

## Build

- `src/selecta/catalog/`, shaped like `src/selecta/lyrics/lrclib.py`: an identified client, one request at a time, Retry-After honoured, and a platform-wide token row `musicbrainz` in the shared bucket (`src/selecta/usage/rate_limit.py`) so every instance together stays under one request a second.
- Tables (one migration): catalogue recordings and releases (MusicBrainz ids, names, year, ISRC), catalogue art (stored sizes, palette hue, source, fetched date, hidden flag) and song links (method, confidence, the person's choice).
- One art component: `web/src/views/CoverArt.tsx` becomes the ladder above with blur-up loading. `web/src/ui/ufTruthfulImagery.test.tsx` is rewritten so images are allowed only through it.
- An admin tool hides any catalogue image at once, following `src/selecta/admin/takedowns.py`.
- The playing song's cover is given to the system media controls and the lock screen (`web/src/audio/mediaSession.ts`).
- Details offered to the interface: canonical names as suggestions (a person's own tags are never silently overwritten), album, release year and ISRC.

## What the sources allow (read from each provider's own pages on 2026-11-25; facts, not legal advice)

| Source | Used | What their pages say |
| --- | --- | --- |
| Art inside the file | Yes, first | No third party is involved. |
| MusicBrainz core data | Yes | Names, ids, dates and ISRCs are public domain (CC0) and may be stored and used commercially. One request a second per IP, with an identified client. MetaBrainz asks companies with revenue to join a paid tier: free while not publicly offered, 100 to 599 dollars a month once public. |
| Cover Art Archive | Yes, behind the flag | No licence is granted: "Use the images at your own risk"; covers belong to their owners. No rate limit is stated. Sizes 250, 500 and 1200. |
| MusicBrainz genres and tags | No | A non-commercial licence unless bought. |
| TheAudioDB | Later, perhaps | Storing is allowed with credit; apps need a paid tier. |
| AcoustID | No | Free for non-commercial use only. |
| Deezer, Last.fm, Apple Search | No | Deezer: non-commercial, no local copies. Last.fm: a commercial agreement is needed and artwork is excluded. Apple: promotional use beside a store badge only. |
| Discogs | Not read | Its terms page would not load on the day. |

## Owner steps

- Register with MetaBrainz at the right tier before the lookup is on for customers.
- Decide whether to serve Cover Art Archive images in the paid product, ideally with counsel.
- Credit MusicBrainz in About.

## Checklist

1. **FL-0478-01 - Art from the file in Cloud.** Tag reading, the worker, on-device storage, the ladder component. Implementation: Not started.
2. **FL-0478-02 - Art from the file in the local app.** Scan, cache, route. Implementation: Not started.
3. **FL-0478-03 - Catalogue.** The module, the tables, the job, the rate bucket, matching against recorded fixtures. Implementation: Not started.
4. **FL-0478-04 - Controls.** The account setting with its disclosure, "Wrong cover?", the admin hide. Implementation: Not started.
5. **FL-0478-05 - Where it shows.** Library, song details, My Mixes collage, Listen, the dock, the queue, the editor, Rooms, the lock screen; catalogue covers only on guest phones and the display. Implementation: Not started.
6. **FL-0478-06 - Tests and register.** The truthful-imagery test, catalogue tests, the licence register rows, the operator checklist. Implementation: Not started.
7. **FL-0478-07 - Terms cleared.** The owner steps above. Needs the owner.

## Sources

- https://musicbrainz.org/doc/About/Data_License
- https://musicbrainz.org/doc/MusicBrainz_API/Rate_Limiting
- https://metabrainz.org/supporters/account-type
- https://musicbrainz.org/doc/Cover_Art_Archive
- https://developers.deezer.com/termsofuse
- https://www.last.fm/api/tos
- https://performance-partners.apple.com/search-api
- https://acoustid.org/license
- https://www.theaudiodb.com/docs_terms_of_use.php
