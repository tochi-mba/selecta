import type { Page } from '@playwright/test';

/**
 * ADR-0162 performance probe, shared by web/e2e/mi-0162-performance.e2e.ts and
 * web/bench/mi-0162-scale.bench.ts. It only watches: long tasks, long animation frames (with the
 * scripts the browser blames), Event Timing entries (the basis of INP) and a click/key-to-next-paint
 * time measured in the page, plus frame intervals from requestAnimationFrame over a fixed window.
 * Lab numbers from one machine; they say nothing about how anything sounds.
 */

export type LongTask = { start: number; duration: number };
export type LongFrame = { start: number; duration: number; blocking: number; scripts: string[] };
export type Interaction = { name: string; start: number; duration: number; target: string };
export type Probe = { longTasks: LongTask[]; longFrames: LongFrame[]; events: Interaction[]; paints: Interaction[] };
export type FrameWindow = {
  frames: number;
  frameP50: number;
  frameP95: number;
  frameWorst: number;
  longTasks: number[];
  longFrames: LongFrame[];
  animations: number;
  /** When each long task started, in ms from the start of the window. */
  longTaskAt: number[];
  /** API responses that finished inside the window: path and ms from the start of the window. */
  apiDone: string[];
};

declare global {
  interface Window {
    mi0162: Probe;
  }
}

/** Installs the observers before any page script runs. Call before the first goto. */
export async function installProbe(page: Page) {
  await page.addInitScript(() => {
    const probe: Probe = { longTasks: [], longFrames: [], events: [], paints: [] };
    window.mi0162 = probe;
    const label = (node: EventTarget | null) => {
      const element = node instanceof Element ? node : null;
      if (!element) return '';
      const name = element.getAttribute('aria-label') ?? element.textContent ?? '';
      return `${element.tagName.toLowerCase()} ${name.trim().slice(0, 40)}`;
    };
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) probe.longTasks.push({ start: entry.startTime, duration: entry.duration });
      }).observe({ type: 'longtask', buffered: true });
    } catch { /* not supported: the window reports none, and the report says which browser */ }
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as (PerformanceEntry & { blockingDuration: number; scripts: { invoker: string; sourceURL: string; duration: number }[] })[]) {
          probe.longFrames.push({
            start: entry.startTime,
            duration: entry.duration,
            blocking: entry.blockingDuration,
            scripts: entry.scripts.filter((script) => script.duration >= 5).map((script) => `${script.invoker} ${Math.round(script.duration)}ms`).slice(0, 4),
          });
        }
      }).observe({ type: 'long-animation-frame', buffered: true });
    } catch { /* older engines have no long-animation-frame */ }
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as (PerformanceEntry & { interactionId?: number; target?: Node | null })[]) {
          if (!entry.interactionId) continue;
          probe.events.push({ name: entry.name, start: entry.startTime, duration: entry.duration, target: label(entry.target ?? null) });
        }
      }).observe({ type: 'event', durationThreshold: 16, buffered: true } as PerformanceObserverInit);
    } catch { /* no Event Timing: the in-page paint times below still apply */ }
    // Input to the next paint, measured in the page: the event's own time stamp to a task queued right
    // after the next animation frame, which runs once that frame has been painted.
    for (const type of ['click', 'keydown']) {
      window.addEventListener(type, (event) => {
        const begun = event.timeStamp;
        const target = label(event.target);
        requestAnimationFrame(() => {
          const channel = new MessageChannel();
          channel.port1.onmessage = () => probe.paints.push({ name: type, start: begun, duration: performance.now() - begun, target });
          channel.port2.postMessage(0);
        });
      }, { capture: true });
    }
  });
}

export const percentile = (values: number[], at: number) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((one, other) => one - other);
  return sorted[Math.min(Math.floor(sorted.length * at), sorted.length - 1)];
};

const round = (value: number) => Math.round(value * 10) / 10;

/** Watches a fixed window of `ms` without touching the page: frame intervals, long tasks and long
 * animation frames that started inside it, and how many animations were running. `during` may scroll
 * or otherwise drive the page from inside the window. */
export async function frameWindow(page: Page, ms: number, during: 'idle' | { scrollBy: number } = 'idle'): Promise<FrameWindow> {
  return page.evaluate(async ({ ms, during }) => {
    const begun = performance.now();
    const animations = document.getAnimations().filter((animation) => animation.playState === 'running').length;
    const frames: number[] = [];
    let last = begun;
    await new Promise<void>((done) => {
      const step = (now: number) => {
        frames.push(now - last);
        last = now;
        if (during !== 'idle') {
          const room = document.documentElement.scrollHeight - window.innerHeight;
          window.scrollBy(0, window.scrollY >= room - 1 ? -room : during.scrollBy);
        }
        if (now - begun < ms) requestAnimationFrame(step);
        else done();
      };
      requestAnimationFrame(step);
    });
    const ended = performance.now();
    // the first interval includes the wait for the first frame; leave it out
    const measured = frames.slice(1);
    const sorted = [...measured].sort((one, other) => one - other);
    const at = (share: number) => (sorted.length ? sorted[Math.min(Math.floor(sorted.length * share), sorted.length - 1)] : 0);
    const inside = (start: number) => start >= begun && start <= ended;
    return {
      frames: measured.length,
      frameP50: Math.round(at(0.5) * 10) / 10,
      frameP95: Math.round(at(0.95) * 10) / 10,
      frameWorst: Math.round((sorted[sorted.length - 1] ?? 0) * 10) / 10,
      longTasks: window.mi0162.longTasks.filter((task) => inside(task.start)).map((task) => Math.round(task.duration)),
      longFrames: window.mi0162.longFrames.filter((frame) => inside(frame.start)).map((frame) => ({ ...frame, duration: Math.round(frame.duration), blocking: Math.round(frame.blocking) })),
      animations,
      longTaskAt: window.mi0162.longTasks.filter((task) => inside(task.start)).map((task) => Math.round(task.start - begun)),
      apiDone: (performance.getEntriesByType('resource') as PerformanceResourceTiming[])
        .filter((entry) => entry.name.includes('/api/') && inside(entry.responseEnd))
        .map((entry) => `${new URL(entry.name).pathname} @${Math.round(entry.responseEnd - begun)}`),
    };
  }, { ms, during });
}

/** Marks a point in page time, for reading interactions and long tasks after it. */
export const mark = (page: Page) => page.evaluate(() => performance.now());

/** Interactions since `from`: the slowest Event Timing duration (what INP is built from, only
 * reported at 16 ms or more) and the slowest in-page input-to-next-paint time. */
export async function interactionsSince(page: Page, from: number) {
  const { events, paints, longTasks } = await page.evaluate((from) => ({
    events: window.mi0162.events.filter((event) => event.start >= from),
    paints: window.mi0162.paints.filter((paint) => paint.start >= from),
    longTasks: window.mi0162.longTasks.filter((task) => task.start >= from).map((task) => Math.round(task.duration)),
  }), from);
  const worstEvent = events.reduce<Interaction | null>((worst, event) => (!worst || event.duration > worst.duration ? event : worst), null);
  const worstPaint = paints.reduce<Interaction | null>((worst, paint) => (!worst || paint.duration > worst.duration ? paint : worst), null);
  return {
    count: paints.length,
    eventTimingWorstMs: worstEvent ? Math.round(worstEvent.duration) : 0,
    eventTimingWorst: worstEvent ? `${worstEvent.name} on ${worstEvent.target}` : 'none at 16 ms or more',
    nextPaintWorstMs: worstPaint ? round(worstPaint.duration) : 0,
    nextPaintP50Ms: round(percentile(paints.map((paint) => paint.duration), 0.5)),
    nextPaintWorst: worstPaint ? `${worstPaint.name} on ${worstPaint.target}` : 'none',
    longTasks,
  };
}

/** API requests whose path matches `match` that started after `from`: when each started and ended,
 * in ms after `from`, so a slow result can be split into waiting, server and rendering time. */
export async function apiSince(page: Page, from: number, match: string) {
  return page.evaluate(({ from, match }) => (performance.getEntriesByType('resource') as PerformanceResourceTiming[])
    .filter((entry) => entry.name.includes(match) && entry.startTime >= from)
    .map((entry) => ({ url: entry.name.replace(location.origin, '').slice(0, 80), start: Math.round(entry.startTime - from), end: Math.round(entry.responseEnd - from) })), { from, match });
}

/** Navigation milestones of the current page, in ms from navigation start. */
export async function navigationTimes(page: Page) {
  return page.evaluate(() => {
    const [entry] = performance.getEntriesByType('navigation') as PerformanceNavigationTiming[];
    return entry ? { response_end: Math.round(entry.responseEnd), dom_content_loaded: Math.round(entry.domContentLoadedEventEnd), load: Math.round(entry.loadEventEnd) } : null;
  });
}

/** Wall-clock milliseconds for an action to show its result, measured from the test runner. */
export async function timed(act: () => Promise<unknown>, done: () => Promise<unknown>) {
  const started = Date.now();
  await act();
  await done();
  return Date.now() - started;
}

/** The machine line every measured result carries. */
export async function browserLine(page: Page) {
  // the user agent string is reduced to 157.0.0.0; the full build comes from the client hints
  const edge = await page.evaluate(async () => {
    const hints = (navigator as unknown as { userAgentData?: { getHighEntropyValues(keys: string[]): Promise<{ fullVersionList?: { brand: string; version: string }[] }> } }).userAgentData;
    const list = hints ? (await hints.getHighEntropyValues(['fullVersionList'])).fullVersionList ?? [] : [];
    return list.find((brand) => /edge/i.test(brand.brand))?.version ?? /Edg\/([\d.]+)/.exec(navigator.userAgent)?.[1] ?? 'unknown';
  });
  return `shared 4-core Intel i7-10510U laptop, no GPU (integrated Intel UHD, headless), Windows 11, Edge ${edge}`;
}
