---
id: T-20261125-52dc
title: An upload of a re-tagged copy becomes its own catalogue song
area: storage
status: open
priority: normal
who: claude
created: 2026-11-25
source: Audio identity build, 2026-11-25 (docs/engineering/audio-identity.md)
commit:
---

storage/catalogue_link.register_upload finds a song by the row's own file hash only. If a device already registered a re-tagged copy of a song (its hash is in local_song_hashes), uploading those exact bytes makes a second row for them, because the shell's stored-copy check matches the row's own hash and joining the upload to the song would hide it. The server could also compute the audio id from the bytes it holds. Good: decide how a song shows a stored copy under any of its known hashes, then join the upload to the song.
