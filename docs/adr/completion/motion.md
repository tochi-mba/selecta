# Motion: triggers, owners and interruption

Motion tokens live in `web/src/styles/tokens.css`: feedback 80 ms, fast 120 ms, reveal 160 ms,
handoff 200 ms, overlay 220 ms, slow 240 ms, one ease curve. The Subtle setting shortens them; Still
and the OS reduced-motion setting set them to 0 and stop every CSS animation and transition
(`tokens.css` `[data-motion='still']` and `prefers-reduced-motion` blocks). The OS setting always
wins over the in-app Expressive choice (`web/src/ui/useReducedMotion.ts`).

## Inventory

| Motion | Trigger (data owner) | Duration token | Interrupted by | Reduced / Still |
|---|---|---|---|---|
| Button press and hover colour | pointer/keyboard | fast | next press | instant |
| Working dot on a pressed button | `Action` pending promise (`ui/controls.tsx`) | 0.9 s loop while pending | the promise settling | static dot at 60 % |
| Toast appear | outcome reported by the server (`ui/toasts.tsx`) | reveal | dismiss, timeout | instant |
| Overlay appear | dialog/drawer mount | overlay | Escape / close | instant |
| Page reveal | route change (`router.ts`) | reveal | next route change | none |
| Mix-idea group reveal | cards inserted after load | handoff, once | — | none |
| Skeleton pulse | loading region | 3 cycles then still | content arriving | none |
| Skeleton → content | data arriving | 160 ms | — | none |
| Field/border focus | focus change | fast | blur | instant |
| Inspector scroll | selecting a seam | smooth scroll | user scroll | `auto` |
| Spectrum (15 styles) | `AnalyserNode` of the playing mix (`views/Now.tsx`) | ≤ 15 fps while playing | pause, hidden tab, Stage exit | static frame |
| Lyric line highlight | player clock | — | seek, pause | highlight changes without scrolling animation |
| Transition countdown | seam switch time, beat grid | per beat | seek, skip, pause | numbers only |
| Playhead | player clock | per frame | seek | moves (it is the information, not decoration) |

No animation starts on its own while idle, and none moves a target that is about to be pressed
(`web/e2e/finishing.e2e.ts` "with reduced motion nothing keeps moving by itself, on any page").

## Interruptions

Critical, interrupts the current task: consent the user must give (replace the current mix, approve
a bridge, delete, clear, restore), a failure of the action the user just took, playback stopped by
the system or another tab.

Non-critical, never takes focus or covers a dialog: routine completions, background job progress,
repeated status (coalesced in `state/activity.ts`), analysis and render updates (badges only).

Toasts sit under dialogs and yield to the on-screen keyboard and Stage; Activity keeps every notice
and Undo (`ui/ActivityPanel.tsx`). Live regions announce a song change once and never the clock
(`web/e2e/finishing.e2e.ts` "playing doesn’t flood a screen reader").
