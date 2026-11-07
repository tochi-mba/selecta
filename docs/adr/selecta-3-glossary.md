# Selecta 3.0: words, explanations and motion

Covers S3-0070-01 to S3-0070-05, S3-0060-02 and S3-0050-07. A state has one name everywhere, and the name comes from what the server says. Pages get these through `web/src/state/readiness.ts` and `web/src/ui/seam.ts`, never from a single field of their own.

## Things

| Word | Means | Not |
|---|---|---|
| Song | A track in your library | A file. Selecta never moves or changes files |
| Mix | An ordered set of songs with transitions between them | |
| Current mix | The one that plays. Editing it can change what you're hearing | |
| Draft | A saved mix that doesn't touch what's playing | A second playback queue |
| Transition, or seam | The rendered hand-over from one song to the next. Pages say transition; "seam" is the code's word and remains in some expert text | |
| Request | A song you asked for, waiting for a good place | A song already in the mix |
| Bridge | Extra songs that make a request reachable. Needs your OK, and joins together or not at all | |
| Render | Making a transition's actual audio | Saving an edit. A saved mix can still be unrendered |
| Render line | The order audio gets prepared in | The order music plays in |
| Stem | One separated part of a song: voice, drums, bass or melody | |
| Mix-ready | Analysed, with timed lyrics or marked instrumental | Merely having a tempo |

## States, and where each comes from

| On screen | Source | Means |
|---|---|---|
| Ready for mixes | `readiness.status = mix_ready` | Can start and join mixes |
| Not ready for mixes | `analysed_incomplete` | Analysed, but no timed lyrics. Can still be added by hand |
| Waiting to be analysed | `queued` | In line |
| Being analysed | `processing` | Under way now |
| Couldn't be analysed | `needs_attention` | Analysis failed |
| Set aside | `set_aside` | Selecta decided it isn't music. Nothing was deleted |
| Never plays | `excluded` | Your choice. Nothing was deleted |
| File is missing | `missing` | The file isn't where it was. Its record is kept |
| State unknown | Anything else | Never promoted to ready |
| Not rendered yet | `seam.state.status = none` | Planned, no audio |
| In line | `queued` | Waiting for the worker |
| Rendering | `rendering` | Being made now |
| X, ready | `ready`, passed | The audio exists |
| X, ready, with a warning | `ready`, `passed = false` | The audio exists and a measured check flagged it |
| X will play, because Y wouldn't work here | `ready`, `fell_back` or style differs | What you asked for and what will play differ, and both are named |
| Y won't work here | `failed` | There's no audio for this choice |

## Requests

| On screen | `stage` | Means |
|---|---|---|
| Adding | saving locally | The server hasn't confirmed yet |
| Waiting to play | `waiting` | Spots are found while a mix plays |
| Waiting for a mix | `no_mix` | Start a mix |
| Finding a place | `searching` | Nothing fits yet, and it won't force a bad transition |
| Needs your choice | `approve` | A bridge needs your OK |
| Getting ready | `preparing`, `analysing` | Its transitions are being made |
| Coming up | `ready` | About to join |
| In your mix | `in_mix` | Already there |
| Needs attention | `unavailable`, `never`, `no_cues` | It can't join, and the detail says why |

## How explanations are layered

Short reason, then actual outcome, then expandable evidence. Selecta only ever reports what was measured or what the render said:

- **Mix recommendation:** the preset's description, the real song count and real readiness.
- **Steering (Bigger, Calmer, Something else):** which song is next now, with Undo.
- **Transition choice:** the render's own `why`, what was tried and why each failed.
- **Bridge:** the ordered route, each transition's real status, and the planner's own words.
- **Fallback:** "X will play, because Y wouldn't work here". Requested and actual are both named.

Selecta never invents planner reasoning, probabilities or confidence.

## Being honest about numbers

- **Estimates** always read as estimates: "about 5 minutes", "2 to 6 minutes", or "taking longer than usual". There are no percentages for work without a real count.
- **Counts** are real: "3 of 7 transitions ready".
- **Scores:** a measured check says what it measured, and says that it can't tell you how something sounds.
- **Missing data** reads "Not measured yet" or "Not looked up yet", never zero and never a guess.
- **Subjective ratings** are explicit Good and Bad presses. Nothing is inferred from a skip.
- **Blind study results** apply to that study's listeners and clips, not to music in general.

## Buttons and messages

- A primary button is a verb and says what it does: "Play", "Apply to this transition", "Save it".
- A disabled control says why, in its title or next to it.
- An empty state says what to do next, and failing to load never looks like being empty.
- A retry says what it retries.
- A destructive button uses the word: Delete, Remove or Clear, with a trash icon where it has one. An X only ever means close or dismiss.

## Motion

- Motion only says something changed or is under way: overlays opening, playback progress, a button working.
- No flashing, no shimmer once content has loaded, and nothing moves just to look busy.
- Reduced motion turns off transitions and animation, draws the spectrum as still, and stops the working indicators from sweeping.
- A hidden tab draws nothing. The audio clock keeps time, so playback doesn't depend on any of this.

## Announcements

- Said once: each new song, page changes, an action's result.
- Not said: the running clock, progress ticks or polling. The countdown is a `timer` with `aria-live="off"`.
- The same words again within 8 seconds aren't repeated.
- Problems use `role="alert"`, and everything else stays polite.
