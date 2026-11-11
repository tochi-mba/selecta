# ADR-0399 - Cloud playback with lossless playback proxies

- **Decision:** Accepted (owner, 2026-11-09).
- **Implementation:** 3/4 Implemented; 0/4 In progress; 1/4 Not started.
- **Independent verification:** 0/4 Verified.
- **Programme/date/baseline:** Selecta Cloud (SC); 2026-11-09; main `3c2f1eb`.
- **Priority / phase:** P1 / Phase 3. **Owner:** Unassigned. **Implementing PR/SHA:** None yet.
- **Existing ADR owners:** Audio focus rules in `docs/adr/selecta-3-audio.md`; their statuses are unchanged.
- **Source touchpoints:** `web/src/player.ts`; `web/src/audio/focus.ts`; `src/selecta/routes/library.py` (`/api/songs/{id}/audio`); new `play.proxy` job.
- **Proposal chapter:** [docs/saas/05-storage-uploads-playback.md](../saas/05-storage-uploads-playback.md#58-playback-in-the-cloud-a-real-design-problem).

## Context and evidence boundary

The player downloads whole songs decoded to WAV by the server (about 42 MB for four minutes), which keeps sample-accurate alignment with transitions. Lossy formats add encoder delay and padding that browsers handle inconsistently.

Cloud API routes issue short-lived signed URLs for an owned original or a valid derived object in the caller's workspace. The Cloud library player now requests one replacement URL after a media load error and restores its current time and playing/paused state. This applies to direct original playback; lazy proxies, mix-player integration, and live R2 continuity verification remain outstanding.

## Decision

- Make a lossless FLAC playback file per song from the same PCM the analysis used, lazily: only when a song enters a mix revision, a preview or a request, never for the whole library at upload (a FLAC copy of an MP3 is about six times its size). Originals already lossless at the analysis sample rate are played directly. Playback files live in the evictable derived budget.
- The player fetches proxies and seam clips cross-origin from R2 with short-lived presigned URLs (CORS allowlist), one song ahead, refreshing a URL once on 403.
- Segment streaming (only the parts a mix plays) is a later improvement.
- Mobile users see a data-use note.

## User outcome and acceptance contract

Cloud playback keeps transitions as tight as local playback, without the server decoding audio per request.

## Rejected alternatives

- MP3/AAC proxies (priming offsets break beat-matched hand-offs).
- Server-side decoding per request (CPU per listener).
- Making a proxy for every song at upload (roughly 600 GB of playback files for a full 100 GB MP3 library).

## Implementation checklist - 3/4 Implemented; 0/4 In progress; 1/4 Not started; 0/4 independently Verified

1. **SC-0399-01 - Lazy proxy job.** **Acceptance:** Playback files are made only for songs entering a mix, preview or request, inherit that work's urgency, and are evicted under the derived budget. **Required verification:** Integration test. **Implementation:** Implemented; playback files are made only when a song enters a mix, preview or request, take that work's lane and urgency, and are evicted and remade under the derived budget. **Evidence:** `tests/test_cloud_playback_proxy_lazy.py` (7 tests), passing on SQLite and PostgreSQL. **Independently Verified:** No.
2. **SC-0399-02 - Alignment.** **Acceptance:** Seam boundaries line up within one sample with the proxy on Chrome, Edge, Firefox and Safari. **Required verification:** Automated alignment check plus listening check. **Implementation:** Not started; no automated alignment check exists yet. Needs a person: the check must run on Chrome, Edge, Firefox and Safari (Safari needs a Mac or a device cloud this laptop can't provide), and the owner's listening check at seam boundaries. **Independently Verified:** No.
3. **SC-0399-03 - Signed URL refresh.** **Acceptance:** An expired URL mid-session refreshes once without changing the mix. **Required verification:** Playwright test. **Implementation:** Implemented; a 403 on a signed URL mid-song fetches a fresh URL once and keeps the song, queue and position. **Evidence:** `web/e2e-cloud/playback.cloud.ts` 'an expired signed URL mid-song refreshes once, keeping the song, the queue and the place', passing in `pnpm e2e:cloud`. **Independently Verified:** No.
4. **SC-0399-04 - Prefetch.** **Acceptance:** The next song and its transitions are buffered before they're needed. **Required verification:** Playwright timing test. **Implementation:** Implemented; the next song is downloaded while the current one plays and played from that copy. **Evidence:** `web/e2e-cloud/playback.cloud.ts` 'the next song is downloaded before the current one ends, and plays from that copy', passing in `pnpm e2e:cloud`. **Independently Verified:** No.

## Governance

Accepted by the owner on 2026-11-09. Older ADRs keep their statuses; this one only links to them.
