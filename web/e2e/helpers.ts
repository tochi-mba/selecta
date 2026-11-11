import { APIRequestContext, expect, Page } from '@playwright/test';

export const PAGES = [
  '/listen',
  '/mixes',
  '/mixes/mine',
  '/mix/current/edit',
  '/library',
  '/discover',
  '/discover/harmonic',
  '/workshop',
  '/workshop/analysis',
  '/workshop/storage',
  '/workshop/sources',
  '/workshop/learning',
  '/workshop/diagnostics',
  '/listening',
];

type Started = { at: number; when: number; offset: number; duration: number | null; length: number };

declare global {
  interface Window {
    audioSpy: {
      contexts: AudioContext[];
      started: Started[];
      stopped: number;
      handlers: Record<string, ((details: MediaSessionActionDetails) => void) | null>;
    };
  }
}

/** Watches the page's real audio, without changing it: every context, every sound it starts, and
 * what it told the operating system's media keys to do. */
export async function spyOnAudio(page: Page) {
  await page.addInitScript(() => {
    const spy: Window['audioSpy'] = { contexts: [], started: [], stopped: 0, handlers: {} };
    window.audioSpy = spy;
    const Real = window.AudioContext;
    window.AudioContext = class extends Real {
      constructor(options?: AudioContextOptions) {
        super(options);
        spy.contexts.push(this);
      }
    };
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function started(when = 0, offset = 0, duration?: number) {
      spy.started.push({ at: this.context.currentTime, when, offset, duration: duration ?? null, length: this.buffer?.duration ?? 0 });
      return duration === undefined ? start.call(this, when, offset) : start.call(this, when, offset, duration);
    };
    const session = navigator.mediaSession;
    if (session) {
      const set = session.setActionHandler.bind(session);
      session.setActionHandler = (action, handler) => {
        spy.handlers[action] = handler as never;
        set(action, handler);
      };
    }
  });
}

export const soundsStarted = (page: Page) => page.evaluate(() => window.audioSpy.started.length);
/** Sounds started straight away: a song (re)starting, never a transition the player has queued
 * up ahead of its cue. A rendered seam is planned as soon as it is ready (its clip and the next song
 * are scheduled for later), so counting every start would call that look-ahead a restart whenever
 * an earlier test happened to render the same pair. */
export const soundsRestarted = (page: Page) => page.evaluate(() => window.audioSpy.started.filter((sound) => sound.when <= sound.at + 0.25).length);
export const audioClock = (page: Page) => page.evaluate(() => window.audioSpy.contexts.map((context) => context.currentTime));
export const audioStates = (page: Page) => page.evaluate(() => window.audioSpy.contexts.map((context) => context.state));

/** The time shown under the waveform, in seconds. */
export async function shownTime(page: Page): Promise<number> {
  const words = await page.getByRole('slider', { name: 'Where in the song' }).getAttribute('aria-valuetext');
  const match = /(\d+):(\d+)/.exec(words ?? '');
  return match ? Number(match[1]) * 60 + Number(match[2]) : -1;
}

/** Put the current mix back to these songs, with nothing left over from another test. */
export async function resetMix(request: APIRequestContext, songs = [1, 2, 3, 4]) {
  await request.post('/api/mix/clear');
  for (const song of songs) {
    await request.post('/api/mix/songs', { data: { song_id: song } });
  }
}

/** Wait until every transition in the current mix has actually been rendered. */
export async function allRendered(request: APIRequestContext) {
  await request.post('/api/mix/render');
  await expect
    .poll(
      async () => {
        const { mix } = await (await request.get('/api/mix')).json();
        return (mix as { seam: { state: { status: string } } | null }[])
          .slice(1)
          .filter((item) => item.seam?.state.status !== 'ready').length;
      },
      { timeout: 280_000, intervals: [2000] },
    )
    .toBe(0);
}

/** What's sticking out of the side of the window, by name, or nothing. */
export async function stickingOut(page: Page, where: string): Promise<string[]> {
  return page.evaluate((place) => {
    const room = window.innerWidth;
    if (document.documentElement.scrollWidth <= room) return [];
    const parts = [...document.querySelectorAll<HTMLElement>('body *')]
      .filter((part) => part.getBoundingClientRect().right > room + 1)
      .filter((part) => getComputedStyle(part).position !== 'fixed' && !part.closest('[aria-hidden="true"]'))
      .slice(-3)
      .map((part) => `${part.tagName.toLowerCase()}.${part.className}`);
    return [`${place}: ${document.documentElement.scrollWidth}px in ${room}px: ${parts.join(', ')}`];
  }, where);
}
