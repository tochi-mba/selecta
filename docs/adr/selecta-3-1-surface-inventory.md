# Selecta 3.1 - inspected surface and state inventory

**Status: every route here is visited by the reflow, accessibility, keyboard and slow-loading tests, and the overlays by the dialog tests; not owner approved.** This is a route/overlay checklist grounded in `web/src/router.ts`, `web/src/App.tsx` and `web/e2e/helpers.ts` at PR #25. A link or component's presence proves neither responsive quality nor task success.

## Route and destination inventory

| Route or entry | User-facing surface | Relevant implementation | Evidence still required |
|---|---|---|---|
| `/`, `/mixes` (aliases `/explore`, `/explore/mixes`) | Explore / mix presets and customization | `Mixes.tsx`, `MixSetup.tsx` | Choice, build, empty, unavailable, failure and confirmation |
| `/mixes/mine` (alias `/my-mixes`) | Current mix, drafts, queue | `MyMixes.tsx`, `Drafts.tsx` | Distinct project/action identity, queue failure |
| `/listen` | Current song, player, lyrics, spectrum, Stage | `Now.tsx`, `App.tsx` | Audible continuity, empty/paused/failed, portrait/landscape |
| `/mix/current/edit` | Current mix editor/Inspector | `Mix.tsx`, `SeamInspector.tsx` | 100 songs, undo, fallback, keyboard move |
| `/mixes/drafts/:id/edit` | Draft editor | `Mix.tsx`, `MixScope` | Wrong-scope guard, gone draft, offline state |
| `/library` | Songs, sorting, filters, detail, pagination | `Library.tsx` | 20k rows, duplicate/RTL records, Back/Forward |
| `/discover` (alias `/explore/words`) | Word connections | `Links.tsx` | Real preview, empty/failure and pair identity |
| `/discover/harmonic` (alias `/explore/harmonic`) | Harmonic audition | `Links.tsx` | 4-stage audition and listening controls |
| `/workshop` (alias `/workspace`) | Workspace overview | `Workshop.tsx` | Background, stale, error, storage attention |
| `/workshop/analysis` | Analysis and queue | `Workshop.tsx` | Slowed/disconnected worker and progress |
| `/workshop/storage` | Storage/cache | `Workshop.tsx` | Resource limits and next safe action |
| `/workshop/sources` | Watched folders | `Workshop.tsx` | Path/permission/removable-drive recovery |
| `/workshop/learning` | Listening study | `Workshop.tsx` | A/B blinding, persistence, failed submit |
| `/workshop/diagnostics` | Privacy-safe diagnostics | `Workshop.tsx` | No private path leakage, actionable messages |
| `/listening` (alias `/studies`) | Listening study route | `Workshop.tsx` | Direct-link and reload continuity |
| Unknown route | Missing page | `App.tsx` | Recovery link and route compatibility |
| Initial no-library state | Setup/folder path | `Start.tsx`, `App.tsx` | Invalid, denied, empty, cancelled, unplugged |
| Initial server-unreachable | Start unavailable/retry | `App.tsx` | No invented local-offline playback |

The common shell additionally hosts the **persistent mini-player, keyboard shortcuts, navigation and theme choice**; these are evaluated on every route, not as separately mapped destinations.

## Overlay, persistent surface and focus inventory

| Trigger or surface | Owner | Primary risk to verify |
|---|---|---|
| Requests drawer and bridge finder | `App.tsx`, `Requests.tsx` | Escape/focus, consent, whole route atomicity |
| Activity drawer and Undo | `App.tsx`, `ActivityPanel.tsx` | Latest scoped Undo, failed Undo, expired toast |
| Command palette | `App.tsx`, `CommandPalette.tsx` | Combobox search and disabled results |
| Shortcut help | `App.tsx` | Focus trap, initial-focus and exit |
| Setup/customization dialog | `MixSetup.tsx` | Persisted steering and failed saves |
| Song details overlay | `Library.tsx` | Correction/saved state and focus return |
| Export modal and persistent jobs | `Mix.tsx`, `ExportPanel.tsx`, `ExportJobs.tsx` | Exact draft/revision, retry/download |
| Transition Inspector and Studio workspace | `SeamInspector.tsx`, `Studio.tsx` | Pair identity, grid, focus and audio ownership |
| Fullscreen Stage | `App.tsx`, `Now.tsx` | Fullscreen fallback, Escape, music continuity |
| Notifications, status live region | `toasts.tsx`, `controls.tsx` | No repetitive announcements and Undo availability |
| Mini-player on other routes | `App.tsx`, `Shell` | Sticky nav, safe area and main audio ownership |

## State-coverage design (not an observed pass table)

Every surface above must have explicit **initial/loading, partial or in-progress, empty, ready, refreshing/stale, failed/server unavailable and recovered** outcomes; apply N/A only with a concrete reason. The underlying source audit shows `Problem`, `Skeleton`, `Status` and `useLoaded` shared helpers, but use of a shared helper is not proof that each page implements every state. The verification matrix is the execution plan.

High-risk cross-state sequences requiring independent execution: request approval → cancellation → late poll; mix editor change → stale seam render → Undo; draft export → scope switch → download; Studio dirty grid → reload → server revision conflict; background worker offline → return → retry; long Library pagination → direct link/Back; Stage → modal → media key.

**Next evidence:** attach route screenshots, manual keyboard/AT outcomes, accessibility observations, server traces and owner findings per S31-0078-03/04 before checking them off.
