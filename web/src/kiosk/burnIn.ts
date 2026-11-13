// Burn-in avoidance for screens that show the same words for hours (ADR-0453 D11): the text
// block moves a few pixels every 10 minutes. Under reduced motion or Still it stays put, and a
// slow fade between songs (kiosk.css) does the job instead.

export const SHIFT_EVERY_MS = 10 * 60 * 1000;
/** Small offsets in px, visited in turn; never more than 6 px from centre. */
export const SHIFTS: readonly [number, number][] = [[0, 0], [4, -3], [-4, 3], [3, 4], [-3, -4], [6, 0], [-6, 0]];

export function motionStill(win: Window = window): boolean {
  const reduced = typeof win.matchMedia === 'function' && win.matchMedia('(prefers-reduced-motion: reduce)').matches;
  return reduced || win.document.documentElement.dataset.motion === 'still';
}

export type BurnIn = { stop(): void; step(): void; apply(): void; offset(): [number, number] };

/** Shifts `target` every 10 minutes while `enabled()` holds and motion is allowed. */
export function startBurnIn(target: () => HTMLElement | null, enabled: () => boolean, win: Window = window): BurnIn {
  let index = 0;
  const apply = () => {
    const node = target();
    if (!node) return;
    const still = motionStill(win) || !enabled();
    const [x, y] = still ? [0, 0] : SHIFTS[index % SHIFTS.length];
    node.style.transform = x || y ? `translate(${x}px, ${y}px)` : '';
    node.dataset.shift = still ? 'still' : String(index % SHIFTS.length);
  };
  const step = () => {
    index += 1;
    apply();
  };
  const timer = win.setInterval(step, SHIFT_EVERY_MS);
  return {
    stop: () => win.clearInterval(timer),
    step,
    apply,
    offset: () => (motionStill(win) || !enabled() ? [0, 0] : SHIFTS[index % SHIFTS.length]),
  };
}
