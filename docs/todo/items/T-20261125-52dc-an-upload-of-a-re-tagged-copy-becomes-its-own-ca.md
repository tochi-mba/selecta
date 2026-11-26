---
id: T-20261125-52dc
title: An upload of a re-tagged copy becomes its own catalogue song
area: storage
status: done
priority: normal
who: claude
created: 2026-11-25
source: Audio identity build, 2026-11-25 (docs/engineering/audio-identity.md)
commit: 7cef8376
---

storage/catalogue_link.register_upload finds a song by the row's own file hash only. If a device already registered a re-tagged copy of a song (its hash is in local_song_hashes), uploading those exact bytes makes a second row for them, because the shell's stored-copy check matches the row's own hash and joining the upload to the song would hide it. The server could also compute the audio id from the bytes it holds. Good: decide how a song shows a stored copy under any of its known hashes, then join the upload to the song.

2026-11-26: done behind `storage.upload_identity` (phase 6a of the two-places plan). An upload may
name its song (checked at plan and at acceptance), and otherwise finds it by any of its file
hashes or by the audio id the server reads from the bytes; an unsure audio match becomes a
version. A stored copy under any of the song's hashes counts as its cloud copy (the duplicate
check and `POST /api/uploads/preview`); the Library side of showing it is phase 2
(`library.places`, `cloud_copies`). Tests: tests/test_cloud_upload_identity.py.
