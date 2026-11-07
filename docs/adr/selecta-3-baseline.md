# Selecta 3.0: baseline, inventory, task scripts and how issues are judged

Covers S3-0047-01, S3-0047-03 to S3-0047-08, S3-0052-01, S3-0075-06 and S3-0076-02.

## Starting point

- **Pinned commit:** main `84b8b5cbadf7204bf526e8932124b5c4890e2c44`, with PR #23 merged.
- **Runs on:** Windows 11 with Python 3.12 and a local server on `127.0.0.1`.
- **Browsers:** Chromium browsers are the supported target, and Edge is what the tests run in. Firefox and Safari work as ordinary tabs but haven't been tried for this work, and can't install the app.
- **Installed app:** Chrome and Edge, as a PWA over the local server. It needs the server running.
- **Evidence kinds are kept apart:** reading the code, automated checks in a real browser, screenshots of a made-up library, and what only a person can judge. Only the first three exist so far.

## Every place, overlay and message

| Kind | Items |
|---|---|
| Pages | Listen, Stage, Explore, Word connections, Harmonic matches, My Mixes, Edit current, Edit draft, Library, Workspace overview, Analysis, Sources, Storage, Learning, Diagnostics, Listening study, First run, Preparing your library, Can't reach Selecta, Not found, Draft gone |
| Overlays | Requests drawer, Activity drawer, Search and commands, Keyboard shortcuts, How mixes get built, Replace what's playing, Export, Song details, Transition sheet on narrow screens, Studio workspace |
| Menus | Draft actions, song actions in Edit, song actions in Library, Add both to |
| Always on | Navigation, header bar, mini-player, toasts, live region, connection banner, section error boundary |
| Between tabs | Another tab took the sound |

## States by surface

Each cell says how that state shows up. `n/a` gives the reason it can't happen.

| Surface | First load | Empty | Partial | Refreshing | Failed | Server gone | Recovered |
|---|---|---|---|---|---|---|---|
| Listen | Skeleton for song details | Explore instead, since there's nothing to hear | No lyrics or no beat grid: says which | Keeps playing, nothing moves | Details failed: says so, transport still works | Banner, loaded audio keeps playing | Re-reads the mix |
| Explore | Card skeletons | Preparing your library, under 6 ready songs | Ready cards plus "needs N more" | Cards stay | Problem with Try again | Banner | Re-reads |
| Word connections | Pair skeletons | No connections yet, or none on that word | Prepared count of the best ones | Cards stay | Problem, or "may be out of date" if some are showing | Same | Next poll |
| Harmonic matches | Skeleton | No matches yet | n/a: a match is whole or absent | Candidates stay | Problem with Try again | Same | Next poll |
| My Mixes | Card skeletons | "A place for your next mix" | Each draft's own state | Cards stay | Problem, "they're still saved" | "May be out of date" | Next poll |
| Edit | Timeline skeleton | Add the first song | Each transition's own state | Rows stay | Stale edit: refused, then re-read | Banner | Re-reads |
| Inspector | Skeleton | n/a: only opens on a real pair | Moves show why they're off | Keeps intent | Problem with Try again | Keeps intent | Re-reads |
| Studio | "Separating", with the wait | n/a | A missing stem disables that lane and says so | Keeps working copy | Keeps working copy, says what failed | Same | Apply again |
| Requests | "Loading your requests" | "Ask for a song any time" | Each request's stage | Rows stay | "Still saved" | Same | Next poll |
| Library | Row skeletons | No songs in this view, with clear filters | "Showing N of M" | Rows stay, "Updating results" | Problem, "your songs are fine", or "may be out of date" | Same | Next poll |
| Workspace | Metric skeletons | "Learning starts with listening" | Real counts | Values stay | Problem with Try again | Same | Next poll |
| Export | Stages from the job | n/a: needs two songs | Real count of ready transitions | Stage stays | Says why, with deliberate retry | Job says interrupted on return | Reads the job again |
| Study | "Opening study" | "No trials registered" | Comparison N of M | n/a: nothing polls | Keeps every answer, try again | Same | Reconciles by trial |

Saving, waiting, preparing and rendering are covered by `Action` (busy from press until the actual result) and the job and seam status words. See [the glossary](selecta-3-glossary.md).

## What must never break

Everything in the [hard preservation contract](selecta-3-roadmap.md), INV-01 to INV-20. This is what was actually done for it:

| Promise | How it's held |
|---|---|
| Source music is never touched | No code path here writes to it. Set aside and Never play are records, not file operations |
| Drafts, ratings, corrections and settings survive | No schema change. Additive preference keys only, ignored by older code |
| The right mix gets the change | Scope comes from the address, and `x-mix-order` refuses stale writes |
| One sound at a time | [One owner](selecta-3-audio.md), with stale events ignored |
| Bridges are consented and whole | Server rules untouched. The approval surface shows the whole route |
| Export matches its mix | Encoded from an immutable snapshot, not the live mix |
| Local only | [Unchanged and audited](selecta-3-privacy.md) |
| Readiness is never invented | One projection, with unknown values shown as unknown |

**Sign-off:** this contract was written by the implementer. S3-0047-03 asks for it to be signed off, which is the owner's to do.

## Task scripts

Each one is run on a real library, by someone who hasn't been told how. Record whether it was completed, how long it took, any critical errors and where they hesitated. None of these has been run.

**Listener.** First run: add your music folder, and say what leaves your PC. Start a mix when it's ready. Skip a song. Find the lyrics. Request a song you like. Leave it playing and go to another page.

**Creator.** Save a mix as a draft without changing what's playing. Add two songs and reorder them on a phone-width window. Change one transition and hear it. Put the draft in the render line ahead of another. Play it, change your mind and undo that.

**Expert.** Find a song Selecta got the tempo wrong on and fix it. Find why a transition fell back. Shape a transition in the Studio by keyboard only. Export a draft and check the file. Find out why rendering is paused.

**Failure.** Stop the server mid-edit. Unplug a watched drive. Delete a draft in another tab while editing it. Fill the storage budget.

## How issues are judged

| Level | Means | Release |
|---|---|---|
| P0 integrity or access | Lost or wrong data, wrong mix changed, unexpected sound or silence, a partial or unapproved bridge, an invalid FLAC, unsafe file access, invented readiness, an essential task that's inaccessible | Blocks |
| P1 task or recovery | A task can't be finished or a failure has no way out | Blocks unless the owner accepts it in writing |
| P2 presentation | Works, but looks wrong or reads badly | Reviewed and recorded, doesn't block |

A human can find a blind spot with every automated check green, and that finding is judged the same way.

## Defects found while doing this

| Level | What | Fixed by |
|---|---|---|
| P0 | Previewing clip A then B released B's sound and brought the mix back underneath it | Session numbers in `usePreview`, and ignoring `AbortError` |
| P0 | With two drafts deleted, Undo on the first restored the second | `POST /api/drafts/restore?id=N` |
| P0 | An old Undo could take back a newer change in the same mix | Newest-only per mix, and the undo is guarded by the order it was offered for |
| P1 | On a phone the mini-player sat on top of the bottom navigation | One geometry in `tokens.css` |
| P1 | `--bottom-chrome` never saw the player, so the end of a page could sit behind it | Same |
| P1 | A preview here could play over the mix in another tab, and the mix could resume over another tab | `takeAudio` announces it, and tab takeover clears the resume intent |
| P1 | A browser refusing sound left Play hanging forever | `wake` stops waiting and says so |
| P1 | The inspector showed the rendered move as chosen, silently rewriting a person's choice | Requested and actual kept apart |
| P2 | Readiness fell back to "Waiting to be analysed" for unknown values, and Library actions went by tempo alone | One projection |

## How work moves and who decides

- Decision statuses stay **Proposed** until the owner says otherwise, whatever the code does. Implementation is a separate status.
- **Implemented** means merged code with automated checks passing. **Verified** also needs the human evidence the ADR asks for. Nothing here is marked Verified.
- The ledger is [selecta-3-evidence.md](selecta-3-evidence.md). This document, the checklist and the roadmap change together.
- Normally each slice would have a design review and a separate PR. The owner chose one PR for this programme, and asked for it to be merged when CI is green, knowing the human checks are still open. That choice is recorded here, and it doesn't make anything Verified.

**Ownership:** the owner decides ADRs, listens and signs off releases. The implementer owns the code and automated checks, and each ADR's tests are named in [the verification matrix](selecta-3-verification-matrix.md).

## This document's own honesty

S3-0047-08 asked for a no-runtime-change statement for the documentation PR. That was true of PR 24 as it was opened, and it stopped being true when the owner asked for the implementation on the same PR. The PR's description says so.
