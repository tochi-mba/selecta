# Shared interaction contracts

This source-level contract maps shared control, navigation, playback and onboarding behavior to the implementation. Independent visual, assistive-technology, physical-device and comprehension review remains separate.

## Shared control state matrix — MI-0138-01

| State | Semantics | Input behavior | Visible result | Recovery |
|---|---|---|---|---|
| Rest | Available action or current value | Pointer and keyboard enabled | Stable label and boundary | — |
| Hover | Pointer location only | No action until activation | Non-essential surface cue | Same information remains on focus/touch |
| Focus | Keyboard/programmatic target | Enter/Space according to native role | High-contrast focus ring, never colour alone | Focus remains or moves to named result |
| Pressed/selected | Current toggle/chip value | Native button plus `aria-pressed`/checked state | Persistent text/icon/surface state | Re-activate only where reversible |
| Working | One accepted operation | Duplicate activation blocked; stable operation identity reused | In-place working label, stable footprint | Error retains object and retry |
| Success | Authoritative response received | Next valid action enabled | Scoped confirmation; durable state is primary | Undo only when actual inverse exists |
| Failed | Operation rejected/unknown | Surviving controls remain usable | Named object, consequence and reason | Retry reuses identity when duplicate work is unsafe |
| Disabled/unavailable | Action cannot currently succeed | Native disabled or `aria-disabled` with explanation | Reason remains reachable | State change re-enables without focus theft |
| Stale/offline | Display may not be authoritative | Buffered/local behavior survives where safe | Persistent stale/offline wording | Refresh/reconnect reconciles authoritative state |

The implementation is centralized in `web/src/ui/controls.tsx`, `web/src/ui/primitives.tsx`, `web/src/ui/toasts.tsx`, `web/src/state/async.ts` and `web/src/styles/foundation.css`/`polish.css`.

## Toggle, chip and field rules — MI-0138-03/04

- Toggles and filter chips are native buttons with `aria-pressed`; selection is readable without hover, motion or colour.
- Menu check items use their native/ARIA checked state and retain a visible label.
- Field input remains owned by the field while the request is pending. Validation does not clear invalid text; focus moves to the first invalid field only after validation identifies it.
- Server validation is shown beside/in the owning form or object. A successful label appears only after the response.
- Debounced search replaces the URL only for typing; explicit filter/sort choices push history so Back undoes them.

Representative sources: `Library.tsx`, `SongDetails.tsx`, `MixSetup.tsx`, `Requests.tsx`, `controls.tsx`; representative fixtures live beside those views.

## Retry and operation identity — MI-0138-05

Mutations that could duplicate work carry a stable `x-operation-id` generated before the first attempt and retained across an uncertain retry. Revision-sensitive mutations also carry the relevant mix/order/snapshot guard. A definite client rejection may retire the operation ID; a timeout or lost response may not. Implementations include mix creation, pair/discovery actions, draft creation, request joining and export jobs. Backend idempotence and conflict fixtures live in `tests/test_api_contracts.py`, `tests/test_request_routes.py` and export job tests.

## No hover-only behavior — MI-0138-07

Every hover disclosure has a focus/touch route: actions are buttons, menu openers remain visible/reachable, tooltips respond to focus, and timeline drag has explicit move controls/keyboard behavior. CSS hover treatments do not reveal the sole label or state. Physical touch and AT review remains open.

## Navigation and collapsed-shell contract — MI-0139-02/04/07

- The canonical manifest (`web/src/shell/manifest.ts`) supplies the same destination/selection semantics to desktop rail, compact navigation and command palette.
- Active destinations use `aria-current`; icon-only compact controls retain accessible names and minimum target sizing.
- Route changes preserve the single player instance in `App.tsx`; Shell merely renders controls for it. The mini-player never owns a second audio element or restarts playback.
- Page entry moves focus to the destination heading and restores saved scroll on Back/Forward. Drawers/dialogs trap and restore focus through shared overlay controls.
- The mini-player exposes song identity, elapsed/duration, play/pause, next and Stage without depending on hover.

## Mini-player geometry and truth — MI-0140-01/04

The mini-player is a persistent shell region with reserved safe-area/keyboard space, truncated visual text plus full accessible/title identity, clock-derived elapsed/duration and state-derived controls. It appears only when playback has an active song; route content cannot fabricate or reset its time. Geometry is owned by `web/src/styles/shell.css` and `tokens.css`; state is owned by `Shell.tsx` and `SetPlayer`.

## Preview ownership — MI-0140-03

`web/src/audio/focus.ts` is the single preview arbitration layer. Starting a preview pauses the main mix only when it was playing, stops the previous preview, and records an intent generation so completion cannot resume after a newer user action. Studio, discovery and transition previews use this contract. Unit fixtures cover normal resume, initially paused playback and stale completion.

## First-run progress and preservation — MI-0141-03/05/06

- Folder scan, analysis and mix readiness are separate states with explicit progress/unknown/failure wording.
- Setup copy states that original audio stays on the PC and is not moved or modified; lyric metadata disclosure is separate from audio.
- Restart/reload reads authoritative status, resumes background analysis reporting, and distinguishes cancelled/failed/continued work. The application never invents completion from a prior browser state.
- Readiness derives from the shared status model rather than a single percentage or animation.

Representative sources: `web/src/views/Start.tsx`, `Setup.tsx`, `Mixes.tsx`, `WorkshopPanels.tsx`, `state/readiness.ts`; backend scan/analysis state remains authoritative.

