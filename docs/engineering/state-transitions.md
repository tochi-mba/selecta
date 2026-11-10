# Domain state transitions and their labels

S4-0095-01 (ADR-0095). Each background domain has a small state machine on the server and one
label the listener reads for each state. This page is the table per domain: what each state means,
which states it can move to, and the exact words shown. `web/src/state/s4StateTransitions.test.ts`
reads the label tables below and checks every row against the code that produces the words, so this
page cannot drift from what the site says.

Rules every domain keeps:

- A state is never relabelled as a different one to look better. Queued is not "rendering",
  paused is not "failed", blocked is not "paused", and a request that is ready is not "scheduled".
- An unknown state from a newer or older server reads as unknown, never as ready or as nothing.
- A label never promises a play time or a guaranteed result the server has not given.

## Transition render (seam)

Server field: `seam.state.status` (`src/selecta/` worker, `web/src/api.ts` `SeamState`).
Label code: `seamStatusWords` in `web/src/lib.ts`.

| State | Moves to | Label |
|---|---|---|
| `none` | `queued` | Not rendered yet |
| `queued` | `rendering`, `none` | In line |
| `rendering` | `ready`, `failed`, `queued` | Rendering… |
| `ready` | `queued` (a setting changed) | Ready |
| `failed` | `queued` (tried again) | Can’t do this one |

A `ready` seam whose checks did not all pass reads "Ready, with a warning", never plain Ready.

## Export job

Server field: `ExportJob.state` (`src/selecta/` export jobs, `web/src/api.ts` `ExportJobState`).
Label code: `exportStage` in `web/src/views/ExportJobs.tsx`.

| State | Moves to | Label |
|---|---|---|
| `preparing` | `encoding`, `cancelling`, `failed`, `interrupted` | Preparing transitions |
| `encoding` | `ready`, `failed`, `interrupted` (only `preparing` can be cancelled) | Creating the FLAC file |
| `ready` | `expired` | Ready to download |
| `failed` | (final; start another export) | Didn’t work |
| `cancelling` | `cancelled` | Cancelling |
| `cancelled` | (final) | Cancelled |
| `interrupted` | (final; a restart stopped it) | Interrupted |
| `expired` | (final; the file is gone) | The file has gone |

Any other state reads "State unknown".

## Song request

Server fields: `RequestRow.stage` plus availability, never-play, analysis and bridge answers.
Stage code: `stageOf`, label code: `requestWords`, both in `web/src/views/Requests.tsx`.

| State | Moves to | Label |
|---|---|---|
| `adding` | `waiting`, `analysing`, `unavailable`, `never`, `no_cues` | Adding |
| `unavailable` | (removed by the listener) | Needs attention |
| `never` | `waiting` (never-play cleared) | Needs attention |
| `in_mix` | (done) | In your mix |
| `analysing` | `waiting`, `no_cues` | Getting ready |
| `no_cues` | (removed by the listener) | Needs attention |
| `no_mix` | `waiting` (a mix starts) | Waiting for a mix |
| `waiting` | `searching`, `approve`, `preparing` | Requested · waiting |
| `searching` | `approve`, `preparing` | Finding a place |
| `approve` | `preparing` (yes), `searching` (no) | Needs your choice |
| `preparing` | `ready`, `searching` (bridge stopped fitting) | Getting ready |
| `ready` | `in_mix` (joined at an opening) | Ready for an opening |

## Background analysis

Server fields: `/api/jobs` `analysis.running`, `analysis.paused`, `analysis.left` and `storage_full`.
Label code: the job list in `web/src/views/Workshop.tsx`, checked by
`web/src/views/ex-0128-job-truth.test.tsx`; the header count is `jobAttention` in
`web/src/state/jobs.ts`, checked by `web/src/shell/s4HealthAttention.test.tsx`.

| State | Moves to | What the listener reads |
|---|---|---|
| running | paused, blocked, done | Working through your songs, with the count left |
| paused with songs left | running | Paused, N to go (and a header attention count) |
| blocked by storage | running (room made) | Blocked: the storage limit has been reached |
| done | running (new songs found) | Audio analysis is complete |
