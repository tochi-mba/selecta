# Critical task inventory across modes (ADR-0439)

This is the list of tasks a person must be able to finish in each SelectaDJ mode, whatever their
screen, zoom, input or sensory settings. The machine-readable copy is
[`critical-tasks.json`](critical-tasks.json); `tests/test_apb_staff.py` and
`web/src/venueops/StaffDashboard.test.tsx` read it, so the two can't drift.

## The bar every task meets

- Keyboard only: every step reachable with Tab, Shift+Tab, Enter, Space and arrows, with a visible
  focus ring, in a reading order that matches the screen.
- 320 CSS px wide and 400% zoom (1280 px at 400% is 320 CSS px): one column, no sideways page
  scroll, no clipped controls, targets at least `--control-height`.
- Both themes, `prefers-reduced-motion: reduce`, `prefers-contrast: more` and forced colours
  (Windows High Contrast): nothing relies on colour or motion alone.
- Screen readers: names, roles, states and live announcements make sense when heard. NVDA and
  VoiceOver sessions are person steps (NVDA runs are paused at the time of writing).

## Modes and tasks

| Mode | Task | Where |
|---|---|---|
| Local | Play, pause, previous and next | /listen |
| Local | Make a mix from the library | /mixes |
| Local | Edit the current mix | /mix/current/edit |
| Local | Find a song | /library |
| Local | Check analysis, storage and diagnostics | /workshop |
| Cloud | Sign in and pick a workspace | Cloud sign-in |
| Cloud | Play here or move playback to another device | Devices panel, playing bar |
| Cloud | Upload music and resume an interrupted upload | Library upload |
| Room host | Open, lock, unlock and end a room | Room panel |
| Room host | Approve or pass a guest request | Room panel inbox |
| Room host | Approve, remove or ban a guest | Room panel guests |
| Guest | Join a room with a code | Guest join |
| Guest | Search and request a song | Guest room |
| Guest | Read what happened to a request | Guest room |
| Venue staff | See now, next, the plan and health | Staff dashboard |
| Venue staff | Send a steering command and see it go from waiting to done | Staff dashboard |
| Venue staff | Emergency Stop | Staff dashboard top bar |
| Venue staff | Reach the expert controls | Staff dashboard, Expert controls |

## Expert path parity

The staff dashboard is an extra, calmer view. It never replaces or hides the expert tools: Listen,
Edit the mix, Mixes, Library, Discover, Lucy and Workshop stay at their own addresses, and the
dashboard links to each in every state, including loading, offline, manual and stopped. The list
is `EXPERT_CONTROLS` in `src/selecta/venueops/staff_commands.py`, checked against the JSON and
`web/src/router.ts`.

## Checks

| Check | How | State |
|---|---|---|
| Inventory and expert parity | `tests/test_apb_staff.py`, `web/src/venueops/StaffDashboard.test.tsx` | Automated |
| 320 px and 400% zoom | `web/e2e/apb-responsive-modes.e2e.ts`, `web/e2e/apb-staff-dashboard.e2e.ts` | Written, not run yet |
| Reduced motion, contrast, forced colours | same specs, `emulateMedia` | Written, not run yet |
| NVDA and VoiceOver | a person reads each task with the screen reader | Person step |
| Real phones and tablets | a person finishes each task on a real device | Person step |
