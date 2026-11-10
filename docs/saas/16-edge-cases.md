*Part of the [Selecta Cloud proposal](README.md). Accepted by the owner on 2026-11-09.*

## 16. Edge cases: master checklist

Grouped one-liners; each maps to a test or a documented policy. (The scenario catalogue in [§15.5](15-stress-testing.md#155-scenario-catalogue-each-becomes-a-named-automated-test) covers load and failure; these are product and correctness rules.)

**Accounts**: same email signs up twice (one account) · email change to an address already used (refused) · sign-in from a new device (notify) · account deleted while jobs run (cancel, then delete) · deletion requested while a payment is pending (cancel subscription first) · user under 13 (refused) · suspended account (read-only access to own data and export, no processing).

**Library**: duplicate inside one account (ask) · same file name, different audio (distinct assets) · tags missing or garbage (filename fallback, editable) · song is spoken word (existing is-music detection; excluded from mixes) · song longer than plan limit (rejected with reason) · song replaced by a new upload with the same name (new asset; old one stays until deleted) · deleting a song used in drafts and exports (drafts show a gap to fix; frozen exports unaffected) · 20,000+ songs (paged lists, server search).

**Mixes**: user edits while seams render (new revision; stale results never replace newer) · user reorders render line (own account only) · two tabs edit (409 via existing `x-mix-order` check) · playing revision vs edited revision (playback stays on the pinned revision until the user switches) · export started then mix edited (export uses the frozen revision) · undo after a server-side change (existing undo history scoped per workspace).

**Uploads**: browser can't hash huge files fast (skip hash; server hash after) · Safari folder upload support (`webkitdirectory` fallback to multi-select) · mobile backgrounding mid-upload (resume on return) · unsupported formats (list of accepted formats shown up front) · DRM-protected files (rejected: can't decode).

**Quota**: exports pushing a user over quota (block new export, explain) · reservations from abandoned sessions (expire) · downgrade with in-flight uploads (they finish against the old reservation, then over-quota rules apply) · storage meter vs reality drift (reconciler) · rounding (always show one decimal; enforce bytes).

**Plans and billing**: upgrade then immediate downgrade (portal enforces period end) · currency change (one currency per customer in Stripe) · annual to monthly switch (at renewal) · trial (if offered) ends without card (Free) · refund after heavy usage (policy) · VAT number entered by a business customer (reverse charge handled by Stripe Tax when registered) · price change for existing subscribers (grandfathered or with notice per consumer law).

**Lucy**: allowance reached mid-conversation (finish the current turn, then explain) · plan downgraded mid-conversation (next turn uses new tier) · provider changes response format (schema validation fails safe) · library empty or unanalysed (Lucy says what it can do) · user asks for songs they don't have (never invents; suggests adding music).

**Processing**: model version bump (old artifacts valid for old revisions) · per-account stem cache full (evict least-recent unprotected windows) · LRCLIB unavailable (lyrics later; mixes unaffected) · job estimated cost unknown for a new type (conservative default, learned quickly) · daily analysis cap reached (remaining songs wait for tomorrow, shown as such).

**Time**: daylight-saving changes for daily caps (account timezone, calendar-day reset) · billing period edges (Stripe is the clock) · lease and deadline maths (database time only) · users in other timezones (show local times).

**Admin**: last Owner can't remove themselves · stale admin tab submits old config (version check) · admin action on a deleted account (refused) · role revoked during a pending delayed action (re-checked at execution) · emergency control toggled during a deploy (declarative state wins).

**Devices**: device cookie cleared (registers as a new device; old one ages out) · same device signed into two accounts in two browser profiles (separate devices) · the active device's tab is hidden or throttled (heartbeats from a worker-friendly timer; lease tolerant of 20 s) · remote opens while nothing is playing (shows the last mix with "Play here") · active device changes the mix revision while a remote has an edit open (revision conflict as in Mixes) · 11th device signs in (oldest signed out with notice) · playback position after a long pause (anchor frozen while paused) · daylight-saving or clock change on a device (server time only).

**Rooms**: guest opens an expired or closed room link (friendly "This room has ended") · guest with JavaScript blocked or a very old browser (plain HTML fallback for viewing; requesting needs JS) · guest rejoins after their cookie is cleared (new guest; host sees a new nickname) · guest requests a song that's already queued (adds a vote) · guest requests a song played 10 minutes ago (cooldown message) · the request fits nowhere even with bridges (honest "can't fit right now", stays pending if the host wants it later) · host's library has no mix-ready songs (room can't open; explains why) · host opens a room on Standard (locked, upgrade prompt) · host's subscription lapses mid-room (room continues to its end) · host leaves the party with the speaker device (room pauses after 60 min without a speaker) · two rooms attempted at once (second refused while the first is open) · offensive nicknames impossible (generated list only) · host turns votes off mid-room (pending order falls back to approval time) · display device loses power (reconnects with its token).

**Feature flags**: see [§11B.7](11b-feature-flags.md#11b7-edge-cases-for-flags).

**Local mode regressions** (must not break the existing app): first run with a folder path · gathering old homes · backups/restore · BYO-key Lucy · offline use · Windows paths with Unicode · the live dev site running from the main checkout during refactors.

---

[← 15-stress-testing.md](15-stress-testing.md) · [Contents](README.md#chapters) · [17-roadmap-and-risks.md →](17-roadmap-and-risks.md)
