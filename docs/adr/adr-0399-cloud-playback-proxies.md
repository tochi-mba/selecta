# ADR-0399 - Cloud playback with lossless playback proxies

- **Decision:** Accepted (owner, 2026-11-09).
- **Implementation:** 0/4 Implemented; 0/4 In progress; 4/4 Not started.
- **Independent verification:** 0/4 Verified.
- **Programme/date/baseline:** Selecta Cloud (SC); 2026-11-09; main `3c2f1eb`.
- **Priority / phase:** P1 / Phase 3. **Owner:** Unassigned. **Implementing PR/SHA:** None yet.
- **Existing ADR owners:** Audio focus rules in `docs/adr/selecta-3-audio.md`; their statuses are unchanged.
- **Source touchpoints:** `web/src/player.ts`; `web/src/audio/focus.ts`; `src/selecta/routes/library.py` (`/api/songs/{id}/audio`); new `play.proxy` job.
- **Proposal chapter:** [docs/saas/05-storage-uploads-playback.md](../saas/05-storage-uploads-playback.md#58-playback-in-the-cloud-a-real-design-problem).

## Context and evidence boundary

The player downloads whole songs decoded to WAV by the server (about 42 MB for four minutes), which keeps sample-accurate alignment with transitions. Lossy formats add encoder delay and padding that browsers handle inconsistently.

This ADR records a proposed decision. Nothing in it is implemented or measured yet; numbers come from the proposal and must be re-checked when the work starts.

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

## Implementation checklist - 0/4 Implemented; 0/4 independently Verified

1. **SC-0399-01 - Lazy proxy job.** **Acceptance:** Playback files are made only for songs entering a mix, preview or request, inherit that work's urgency, and are evicted under the derived budget. **Required verification:** Integration test. **Implementation:** Not started; **Independently Verified:** No.
2. **SC-0399-02 - Alignment.** **Acceptance:** Seam boundaries line up within one sample with the proxy on Chrome, Edge, Firefox and Safari. **Required verification:** Automated alignment check plus listening check. **Implementation:** Not started; **Independently Verified:** No.
3. **SC-0399-03 - Signed URL refresh.** **Acceptance:** An expired URL mid-session refreshes once without changing the mix. **Required verification:** Playwright test. **Implementation:** Not started; **Independently Verified:** No.
4. **SC-0399-04 - Prefetch.** **Acceptance:** The next song and its transitions are buffered before they're needed. **Required verification:** Playwright timing test. **Implementation:** Not started; **Independently Verified:** No.

## Governance

Accepted by the owner on 2026-11-09. Older ADRs keep their statuses; this one only links to them.
