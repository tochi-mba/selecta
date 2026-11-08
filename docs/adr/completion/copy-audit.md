# Copy audit: labels, messages, forms and errors

Method: every visible string in `web/src/**/*.tsx` and the word helpers in `web/src/lib.ts` were
read against the conventions below; fixes were made in this PR where a string broke one. The
glossary (`web/src/ui/glossaryTerms.ts`) is the reference for music terms.

## Conventions

| Topic | Rule | Where it is enforced |
|---|---|---|
| Case | Sentence case for buttons, headings and menu items | review |
| Voice | Plain, second person, no blame, no exclamation marks; say what happened and what is safe | `api.ts` `OFFLINE_WORDS`, `SERVER_FAILED_WORDS` |
| Apostrophes and quotes | Typographic (’ “ ”) in UI copy | review (one straight apostrophe fixed) |
| Times | m:ss under an hour, h:mm:ss above; never a time past the song's end | `lib.ts` `clock`, `player.test.ts` |
| Waits | a single number only when confident; a range when unsure; "running long" rather than counting to zero | `lib.ts` `etaWords`, `etaRangeWords`; `lib.test.ts` |
| Counts | number + correctly pluralised noun ("1 song", "2 songs") | `lib.ts` `plural` (this PR) |
| Storage | parts add up to the shown total | `lib.ts` `storageWords`; `lib.test.ts` |
| Keyboard hints | key names as shown on the keyboard ("Shift N", "Ctrl K") and `aria-keyshortcuts` | `state/shortcuts.ts` |
| Units | BPM, bars, beats, GB spelled out next to numbers | review |
| Busy labels | present participle with an ellipsis ("Saving…") on the pressed control only | `ui/controls.tsx` `Action` |

## Consequence labels

Each action names its real effect and scope:

| Label | Effect | Scope shown |
|---|---|---|
| Play | builds and replaces what's playing, after confirmation if a mix is active | "Replace <current mix>?" dialog |
| Shape first | builds the mix and opens it for editing without playing | the editor's scope bar |
| Save draft / Save as draft | creates a draft; playback unchanged | the draft name in the notice |
| Hear it | previews one transition through the audio owner | the pair in the inspector header |
| Apply (Studio) | sends the cell shape for that exact pair, then re-renders | pair header; "not applied yet" until confirmed |
| Use this / Don’t use a bridge | approves or declines extra songs for one request | every extra song listed |
| Play it anyway | joins without a bridge, warning of a rough transition | the warning beside it |
| Download audio / Save as an audio file | starts a FLAC export of a frozen revision | mix name and revision in the dialog |
| Delete draft / Clear the current mix | removes, with Undo | the draft or mix name |
| Replace local data on next restart | stages a restore; nothing changes until restart | counts of what is replaced and skipped |

## Forms and errors

| Form | Labels | Validation | Error keeps input? | Non-colour state |
|---|---|---|---|---|
| Music folder path | persistent label + help | server check before reading | yes | reason text |
| Library search | labelled search, Clear search | 128-character limit server-side | yes | "Nothing matches" text |
| Song correction (BPM/key) | labelled fields, measured value shown | range and Camelot format | yes, with the error beside it | error text, `aria-invalid` |
| Draft name | inline field, Enter saves, Escape cancels | non-empty | yes | resulting name announced |
| Storage budget | slider + number | 0.5 GB minimum, at most the largest cache | yes; "Retry saving budget" | text |
| Listening study | code + nickname with help | required | yes | error text |
| Relink folders | old and new path | local absolute paths only; preview before commit | yes | per-song status words |
| Backup restore | file chooser | archive validated before anything is staged | n/a | reason text |

Every field uses `Field` (`ui/primitives.tsx`), which joins label, help and error with
`aria-describedby` and sets `aria-invalid`. No field relies on placeholder text alone. Reduced
motion removes the busy animation but keeps the busy label.

## Findings fixed in this PR

| Finding | Severity | Fix |
|---|---|---|
| Counts not pluralised ("Confirm 1 recordings", "1 songs") | P2 | `plural()` helper used in Library, Export, Backup, energy summaries |
| Straight apostrophe in the inspector's "Available moves" note | P2 | typographic apostrophe |
| Decorative "◎" glyph in Explore cards | P2 | vector icon |
