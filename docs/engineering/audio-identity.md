# Audio identity

A song is identified by its audio, not by its whole file (owner decision, 2026-11-25, to-do item
T-20261125-bcae). Editing a title, adding artwork or letting another player write a rating
changes the file's bytes but not its audio, so it must not turn the song into a new one that
loses its measurements, corrections and seam history. Flag: `library.audio_identity` (both
modes). Off, no audio id is computed, sent, stored or matched.

Two implementations follow this page byte for byte: `src/selecta/library/audio_identity.py` and
`web/src/media/audioIdentity.ts`. Both are checked against the same fixtures,
`tests/fixtures/audio_identity/manifest.json`, written by `tools/audio_identity_fixtures.py`.

## The audio id

`a1:` followed by the SHA-256, in 64 lower-case hex digits, of the **encoded audio payload
bytes** of the file, as the ranges below pick them out, in file order, concatenated with nothing
between them. `a1` is the version of these rules; any change to them is a new prefix.

- It hashes encoded bytes, never decoded samples: decoders differ between Python and browsers,
  so decoded audio would not give a stable id. The same recording as MP3 and as FLAC therefore
  stays two songs. That is intended.
- A file whose format is not recognised, or which breaks any rule below, has **no audio id**
  (null). Identity then falls back to the whole-file hash exactly as before. Never guess.
- If the picked ranges hold zero bytes in total, the file has no audio id.
- It is computed by streaming. An implementation may read small headers out of order and keep a
  list of ranges, but never holds the file, or the payload, in memory a second time.

The format is found from the bytes, never from the file name, in this order:

1. `RIFF` at 0 and `WAVE` at 8: WAV. `RF64` at 0 and `WAVE` at 8: RF64.
2. `FORM` at 0 and `AIFF` or `AIFC` at 8: AIFF.
3. `ftyp` at 4: MP4.
4. `OggS` at 0: Ogg.
5. Otherwise skip every ID3v2 tag at the start (below). Then `fLaC` there: FLAC. A valid MPEG
   frame header there, or anywhere after at least one ID3v2 tag: MP3. Anything else: no id.

All sizes are unsigned. "Past the end" means beyond the file's size, and is always no id.

## ID3v2 at the start

At offset `p`: `ID3`, then major version `v` (2, 3 or 4), a revision byte that is not 0xFF, a
flags byte, and four size bytes each below 0x80 (otherwise it is not a tag, and the walk stops).
The tag is `10 + size` bytes, where size is the 28-bit syncsafe value
`(b0 << 21) | (b1 << 14) | (b2 << 7) | b3`, plus 10 more when `v == 4` and flag bit 0x10 (footer)
is set. Past the end: no id. Repeat at the next offset: there can be several tags.

## MP3 and raw MPEG audio

**Start.** After the ID3v2 tags, skip bytes up to the first valid frame header. Taggers change
padding and sometimes leave stray bytes; the audio starts at the frame. A valid frame header is 4
bytes `b0..b3` with: `b0 == 0xFF`, `(b1 & 0xE0) == 0xE0`, version bits `(b1 >> 3) & 3 != 1`,
layer bits `(b1 >> 1) & 3 != 0`, bitrate index `b2 >> 4 != 15`, sample rate index
`(b2 >> 2) & 3 != 3`. With no ID3v2 tag the header must be at offset 0. No header before the end
(as computed below): no id.

**End.** Start with `end` = the file size, then strip trailing tags:

1. ID3v1, once: when `end >= 128` and the 128 bytes before `end` start with `TAG`, `end -= 128`.
   Then when `end >= 227` and the 227 bytes before `end` start with `TAG+`, `end -= 227`.
2. Then repeat until none applies:
   - APEv2: the 32-byte footer before `end` starts with `APETAGEX`; version (LE u32 at 8) is 1000
     or 2000; tag size `s` (LE u32 at 12) counts the items and the footer; flags (LE u32 at 20)
     bit 31 says a 32-byte header precedes the items. `end -= s + (32 if bit 31 else 0)`. A size
     below 32 or past the start of the audio: no id.
   - Lyrics3v2: the 9 bytes before `end` are `LYRICS200`, the 6 before those are ASCII digits
     giving `n`; the block is `n + 15` bytes and starts with `LYRICSBEGIN`. `end -= n + 15`.
     Digits that are not digits, or a block not starting `LYRICSBEGIN`: no id.
   - An appended ID3v2.4 tag: the 10 bytes before `end` are `3DI`, a version byte of 4, a
     revision, a flags byte and a syncsafe size `s` (each byte below 0x80). `end -= s + 20`.
   - Lyrics3v1: the 9 bytes before `end` are `LYRICSEND`: no id (it has no size to trust).

**Hash** `[first frame, end)`. The Xing, Info or VBRI frame, if present, is the first frame and
is kept: it is part of the audio stream and taggers do not rewrite it.

## FLAC

After any ID3v2 tags, `fLaC`, then metadata blocks: one header byte (bit 7: last block, bits 0
to 6: type) and a 24-bit big-endian length, then that many bytes. The first block must be
STREAMINFO (type 0, length 34); type 127 is invalid. Walk until a block with the last flag. The
next two bytes must be a frame sync: `0xFF` then `0xF8` or `0xF9`. **Hash** from that frame to the
end, minus a trailing ID3v1 tag (the last 128 bytes, if they start `TAG`). Anything past the end,
or a missing sync: no id. Tag edits rewrite VORBIS_COMMENT, PICTURE and PADDING blocks, which this
skips.

## MP4, M4A, M4B (ISO BMFF)

Walk top-level boxes from offset 0. A box is a big-endian u32 `size` and a 4-byte type. Size 1:
a big-endian u64 follows and the header is 16 bytes. Size 0: the box runs to the end of the file.
Otherwise the header is 8 bytes. A size smaller than its header, or a box past the end: no id.
The first box must be `ftyp`. **Hash** the payload (after the header) of every `mdat` box, in file
order. No `mdat`: no id. Tag edits rewrite `moov`, `udta` and `free` and may move `mdat` (its
chunk offsets live in `moov`), which this ignores.

## WAV and RF64

`RIFF` (LE u32 size `r`) `WAVE`. The chunk area ends at `8 + r`; if that is past the end: no id.
Chunks start at 12: a 4-byte id and an LE u32 size, then the data, then one pad byte when the
size is odd. Walk while 8 bytes of header fit before the area's end; a chunk whose data runs past
the area's end: no id (its pad byte may be missing). Exactly one `data` chunk must be found, or no
id. **Hash** the `data` chunk's data. Anything after the RIFF area (a stray ID3 tag) is ignored.

RF64: the same, except the RIFF size is `0xFFFFFFFF` and the first chunk must be `ds64` (at
least 28 bytes): its LE u64 at 0 is the real RIFF size, its LE u64 at 8 the real `data` size. A
`data` chunk whose size field is `0xFFFFFFFF` takes the `ds64` size. Any other chunk with size
`0xFFFFFFFF`: no id.

## AIFF and AIFC

`FORM` (BE u32 size `r`) and `AIFF` or `AIFC`. Chunks as in WAV but big-endian and starting at
12, area ending at `8 + r`. Exactly one `SSND` chunk: its data opens with a BE u32 `offset` and a
BE u32 block size; the sound data is `size - 8 - offset` bytes from `data + 8 + offset`. A size
below 8, or an offset beyond it: no id. **Hash** the sound data.

## Ogg (Vorbis and Opus)

Pages run back to back from offset 0 to the end of the file; anything else is no id. A page is
`OggS`, version 0, a header type byte (0x01 continued, 0x02 first, 0x04 last), an 8-byte granule
position, an LE u32 serial number, an LE u32 sequence number, a 4-byte checksum (not checked), a
segment count `n` and `n` lacing values. The body is the sum of the lacing values. A page past
the end: no id.

The first page must have the 0x02 flag; its serial number names the stream. Pages of other
serial numbers are skipped whole (their bytes are never hashed). A page of the stream after its
0x04 page: no id. Packets are rebuilt from the stream's segments: a lacing value below 255 ends a
packet. A page's 0x01 flag must be set exactly when a packet is unfinished from the page before,
or no id. An unfinished packet at the end: no id.

Packet 0 must start `\x01vorbis` (then packet 1 must start `\x03vorbis`) or `OpusHead` (then
packet 1 must start `OpusTags`); anything else, FLAC in Ogg included, is no id. **Hash** every
packet except packet 1 (the comment header, which tag edits rewrite), in order, as plain
concatenated bytes. Page headers are never hashed, so re-paging after a tag edit, new sequence
numbers and new checksums do not change the id. FLAC in Ogg is left out because its tags can be
spread over several header packets; it is in to-do item "Ogg FLAC has no audio id".

## Not covered

WMA, AAC in ADTS without ID3, Musepack, WavPack, APE, DSD and every other format: no id, so the
whole-file hash identifies them, as before.

## Where the whole-file hash stays

- Uploads verify the stored bytes with the file's SHA-256 (`assets.sha256`). An uploaded copy is
  always the exact bytes it was hashed from.
- Sharing measurements across accounts by possession proof (`storage/shared_derivations.py`)
  keeps keying on the file hash. **Cross-account matching is never widened to the audio id**: an
  audio id is a claim from a device, not proof of holding the bytes.
- The catalogue row (`local_songs`) stays unique per (workspace, file hash).

## Desktop

`songs.audio_id` (library migration `lib0004audioid`, nullable, indexed). With
`core.engine_store` and `library.audio_identity` on, the hash job (`engine_store/song_hashes.py`)
fills `content_hash` and `audio_id` in one read of the file, and analysis records both. A Desktop
song is its `songs` row, keyed by path, so a re-tagged file already kept its analysis and
corrections, and the scan never re-analyses a changed file. What the audio id adds: when a file's
size or time changes, `db.upsert_song` clears both hashes for the hash job to fill again, and
the features stored by audio id (below) are found again under the same key, so nothing is
measured twice and nothing reads the older fallback file.

A moved or renamed file is not matched automatically: the scan forgets the old path and adds the
new one, as before. To-do item "Re-point a moved song by its audio id" describes doing it safely.

Features key: `engine_store.songs.audio_features_key(workspace, audio_id, version)`. A song with
an audio id publishes and reads its features there first; the content-hash key
(`features_key`) and then `features/{song_id}.npz` are read as fallbacks, and nothing is deleted.

## Cloud: the same song with new bytes

`local_songs.audio_id` (nullable; index on (workspace_id, audio_id), not unique) and the table
`local_song_hashes` (workspace, song, file hash; unique per (workspace, file hash)): the other
file hashes known for a song. A device sends `audio_id` beside `content_sha256` when it
registers a song; the server takes it only when it is `a1:` and 64 lower-case hex digits, and
refuses the request otherwise.

The rule, in one transaction, with registrations of one workspace taking turns (a PostgreSQL
transaction lock per workspace; SQLite writers already queue):

1. A file hash the workspace knows, as a row's own hash or in `local_song_hashes`, is that song,
   as before. A row with no audio id takes the one sent (this is how older rows fill in lazily).
2. A new file hash with an audio id that exactly one row of this workspace has, and that row is
   not deleted: the same song. Its row, id, facts, corrections and availability stay; the new
   file hash is added to `local_song_hashes`. The row's own hash never changes, so an uploaded
   copy (stored under the old hash) still matches it, and shared measurements keep using the
   hash the server verified.
3. No match, two or more rows, or a deleted match: a new song, exactly as before. A wrong merge
   loses a member's data; a missed merge only costs a re-measure.

The browser keeps a file's audio id beside its file hash (derived kind `audio`, keyed by the file
hash), so a file already seen is not read again.
