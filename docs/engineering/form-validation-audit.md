# Form validation and error audit

Selecta 2.0 task T0043, done 2026-11-11. Every form and input in `web/src` was read page by page and checked for four things: how bad input is caught, whether the error says what to do in plain words, whether the error is tied to the field it is about (`aria-invalid` plus `aria-describedby`, so a screen reader hears it on the field), and whether any state relies on colour alone. Reduced motion is covered separately at the end.

`web/src/views/formValidationAudit.test.tsx` keeps the fixes true and fails if any control in the app is marked `aria-invalid` without pointing at the words that explain it.

## Shared building blocks

| Part | Validation and errors |
| --- | --- |
| `Field` (`ui/primitives.tsx`) | Joins label, help and error to the control; error is `role="alert"` and sets `aria-invalid`. Used by Start, Sources, Song details, Listening and `ui/formControls.tsx`. |
| `TextField`, `Select`, `Combobox` (`ui/formControls.tsx`) | Built on `Field`; tested in `ui/formControls.test.tsx`. |
| `Action` (`ui/controls.tsx`) | A failed action says what went wrong and can be pressed again; busy state is spoken (`aria-busy`). |
| `Status` and `WORK_WORDS` (`ui/controls.tsx`, `state/workState.ts`) | Every status has words beside its colour and icon. |

## Page by page

| Page | Inputs | Validation and error copy | Tied to the field | Result |
| --- | --- | --- | --- | --- |
| Start (first run) | Music folder | Folder preflight says why a path can't be used (missing, no access, no audio); scan failures in an alert | Yes, via `Field` | Pass |
| Workspace, Sources | Music folder, relink folder, same-recording ticks | Server reason shown; relink blocked state explains nothing changes | Yes, via `Field` | Pass |
| Workspace, Storage | Storage limit slider | A refused limit says why and what the limit still is, with Retry | **Was not tied.** Fixed: slider now carries `aria-invalid` and `aria-describedby` | Fixed |
| Workspace, Settings | Motion radios, density and other checkboxes | No free text, nothing to validate | Labelled controls | Pass |
| Song details | Tempo, key corrections | Range help ("Between 40 and 240 BPM", "Like 8A or 11B"); failed save keeps the typing and says so | Yes, via `Field` | Pass |
| My Mixes | Find, sort, rename | Rename failure keeps the typing and gives the server reason | **Rename was marked invalid but not described.** Fixed with `aria-describedby` | Fixed |
| Listening study | Study code, nickname, setup | All three required, Open waits for all three; a study that won't open says to check the code; save failures say whether the answer was kept | **Study code error was page-level only.** Fixed: it now sits under the Study code field | Fixed |
| Lucy settings | Model, address, key, limits, spending cap, consent | Whole-number and dollar rules spelled out; consent requirement explained | **Limits and cap were marked invalid but not described.** Fixed: each field points at its help and the broken rule | Fixed |
| Lucy memory, composer | Memory entries, message box | Composer has a described hint; failures in an alert | Yes | Pass |
| Mix setup | Mix language, stem frequency, energy shape | A setting changed elsewhere says so and reloads the newer value | Labelled selects | Pass |
| Transition inspector | Move, bars, cues | A refused change is shown under the fields and tied to them (`cueProps`) | Yes | Pass |
| Requests | Song search | Unavailable, never-play and missing-cue reasons in words | Labelled search | Pass |
| Local backup | Backup ZIP | Validated before restore; problems in an alert with what was kept | Labelled file input | Pass |

## Non-colour state

Checked: readiness and job states (`Status`, `WORK_WORDS`), request stages (`requestWords` in `views/Requests.tsx`), seam badges and draft readiness (`state/readiness.ts`) all carry words. Forced-colours mode keeps motifs visible (`styles/music-objects.css`). Covered by `web/src/test/operations.test.ts` and `web/e2e/flow-forced-colors.e2e.ts`.

## Reduced motion

The OS setting and the in-app Still choice stop animation and smooth scrolling (`styles/tokens.css`, `styles/polish.css`, `ui/useReducedMotion.ts`). Covered by `ui/useReducedMotion.test.tsx`, `styles/motion-tokens.test.ts` and `web/e2e/motion-preference.e2e.ts`.

## Left for people

Whether each sentence reads well to a first-time listener is a judgement call for the owner. Hearing these errors through NVDA or VoiceOver is task T0044.
