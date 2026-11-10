# Frontend architecture: owners and boundaries

## One owner per concern

| Concern | Owner | Others may | Others may not |
|---|---|---|---|
| Playback transport and audio clock | `web/src/player.ts` (one instance, created in `App.tsx`, outside React rendering) | read state, call play/pause/seek/next | create an `AudioContext` for the mix |
| Who is making sound | `web/src/audio/focus.ts` | `takeAudio` / `releaseAudio` | play without taking ownership |
| OS media keys | `web/src/audio/mediaSession.ts` | - | register their own handlers |
| Routes and history | `web/src/router.ts` | `navigate`, `useRoute`, query helpers | touch `history` directly |
| Navigation names, titles, breadcrumbs | `web/src/shell/manifest.ts` | read | hard-code labels |
| Server calls | `web/src/api.ts` (`get`, `post`, `del`, types) | call through it | `fetch` the API directly |
| Preferences | `web/src/state/prefs.ts` | `usePrefs`, `setPrefs` | write `selecta.prefs` themselves |
| Readiness words | `web/src/state/readiness.ts` | read | invent readiness |
| Activity and Undo | `web/src/state/activity.ts`, `ui/toasts.tsx` | report outcomes | keep private Undo stacks |
| Background job status | `web/src/state/jobs.ts` | read | poll `/api/jobs` separately |
| Mix editing | `web/src/views/Mix.tsx` (+ `EditorRows`, `SeamInspector`, `Studio`, `EditorStory`) | - | edit a mix from another page |
| Styles | see [css-ownership.md](css-ownership.md) | | |

## Import direction

`ui/*` and `state/*` never import from `views/*`; `views/*` import `ui`, `state`, `api`, `lib`;
`App.tsx` wires views into the shell. Music objects (`ui/MusicObjects.tsx`) take plain data and
never fetch. `web/src/importBoundaries.test.ts` fails a shared module that imports a view, and any
direct `fetch('/api/...')` outside `api.ts` other than the listed byte streams. The 1,000-line limit (`tests/test_file_length.py`) keeps each module reviewable.

## Reversible rollout

New presentation (navigation labels, editor views, glossary hints) is switchable without data
migration: `?ui=classic` restores the older navigation; the editor view lives in the URL; term
hints have a preference. No stored mix, draft or media format changed in any UI programme.

## Storage seams for later

Everything the browser keeps is in `localStorage` keys listed in
[journeys.md](journeys.md#returning); everything durable is in the local SQLite database and
`seam-history/` under `SELECTA_HOME`. A future hosted version would replace `api.ts`'s base path and
the server's storage layer; nothing in the browser assumes a local file path except the folder
setup text. No such interface is built now (ADR-0134, ADR-0238).
