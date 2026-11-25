import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setFlags } from '../flags';
import { reloadPrefs, setPrefs } from '../state/prefs';
import { changeScene, navDirection, READY_WAIT_MS, sceneTransitionsWanted, type NavDirection } from './sceneTransition';

/** FL-0477-03: page travel. The direction is on <html data-nav> only while a transition runs, a new
 * navigation ends the running one, low power and every calm setting refuse it, a page's code is
 * waited for at most 150ms, and shared elements are named for the travel and unnamed after. */

type Started = { argument: unknown; nav: string | undefined; finish: () => void; skip: ReturnType<typeof vi.fn> };
let started: Started[] = [];
const html = document.documentElement;
const quietWindow = { matchMedia: () => ({ matches: false }) } as unknown as Window;
type Doc = { startViewTransition?: unknown };

/** A browser's startViewTransition: runs the update at once (as the real one does, a frame later)
 * and finishes only when the test says. */
function installTransitions() {
  (document as unknown as Doc).startViewTransition = (argument: unknown) => {
    let finish: () => void = () => undefined;
    const finished = new Promise<void>((resolve) => { finish = resolve; });
    const entry: Started = { argument, nav: html.dataset.nav, finish, skip: vi.fn() };
    started.push(entry);
    const update = typeof argument === 'function' ? argument : (argument as { update: () => unknown }).update;
    void update();
    return { finished, skipTransition: entry.skip };
  };
}

const settle = () => new Promise<void>((resolve) => { setTimeout(resolve, 0); });

beforeEach(() => {
  localStorage.clear();
  reloadPrefs();
  setPrefs({ motion: 'expressive' });
  started = [];
  installTransitions();
  delete html.dataset.nav;
  delete html.dataset.lowPower;
});

afterEach(async () => {
  vi.useRealTimers();
  for (const entry of started) entry.finish();
  await settle();
  delete (document as unknown as Doc).startViewTransition;
  delete (globalThis as { ViewTransition?: unknown }).ViewTransition;
  delete html.dataset.lowPower;
  document.body.replaceChildren();
  vi.useRealTimers();
});

describe('FL-0477-03 the direction on <html data-nav>', () => {
  it('is set while the transition runs and cleared when it finishes', async () => {
    const update = vi.fn();
    changeScene(update, document, quietWindow, { direction: 'forward' });
    expect(update).toHaveBeenCalledOnce();
    expect(started[0].nav).toBe('forward');
    expect(html.dataset.nav).toBe('forward');
    started[0].finish();
    await settle();
    expect(html.dataset.nav).toBeUndefined();
  });

  it('is handed to the browser as the transition type where it takes one', () => {
    function ViewTransition() { /* a stand-in whose prototype has `types`, as newer browsers' does */ }
    (ViewTransition.prototype as { types?: null }).types = null;
    (globalThis as { ViewTransition?: unknown }).ViewTransition = ViewTransition;
    changeScene(vi.fn(), document, quietWindow, { direction: 'back' });
    expect(started[0].argument).toMatchObject({ types: ['back'] });
  });

  it('a navigation during a transition ends it at once, and only the newest clears data-nav', async () => {
    changeScene(vi.fn(), document, quietWindow, { direction: 'forward' });
    changeScene(vi.fn(), document, quietWindow, { direction: 'back' });
    expect(started[0].skip).toHaveBeenCalledOnce();
    expect(html.dataset.nav).toBe('back');
    started[0].finish();
    await settle();
    expect(html.dataset.nav).toBe('back');
    started[1].finish();
    await settle();
    expect(html.dataset.nav).toBeUndefined();
  });
});

describe('FL-0477-03 refusal', () => {
  it('changes the page at once in low power at either step', () => {
    for (const level of ['lite', 'auto']) {
      html.dataset.lowPower = level;
      expect(sceneTransitionsWanted(quietWindow)).toBe(false);
      const update = vi.fn();
      changeScene(update, document, quietWindow, { direction: 'forward' });
      expect(update).toHaveBeenCalledOnce();
    }
    expect(started).toHaveLength(0);
    expect(html.dataset.nav).toBeUndefined();
  });

  it('changes the page at once when the feel is calm', () => {
    setPrefs({ motion: 'still' });
    const update = vi.fn();
    changeScene(update, document, quietWindow);
    expect(update).toHaveBeenCalledOnce();
    setPrefs({ motion: 'expressive' });
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
    changeScene(update, document, quietWindow);
    expect(update).toHaveBeenCalledTimes(2);
    expect(started).toHaveLength(0);
  });

  it('is off with app.scene_transitions off', () => {
    setFlags({ 'app.scene_transitions': false });
    const update = vi.fn();
    changeScene(update, document, quietWindow);
    expect(update).toHaveBeenCalledOnce();
    expect(started).toHaveLength(0);
  });
});

describe('FL-0477-03 waiting for the next page', () => {
  it('waits for a slow page no longer than READY_WAIT_MS', async () => {
    vi.useFakeTimers();
    expect(READY_WAIT_MS).toBe(150);
    const update = vi.fn();
    changeScene(update, document, quietWindow, { ready: () => new Promise(() => undefined) });
    await vi.advanceTimersByTimeAsync(READY_WAIT_MS - 1);
    expect(update).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(update).toHaveBeenCalledOnce();
  });

  it('swaps as soon as the page code arrives, and still swaps when it fails', async () => {
    let arrive: () => void = () => undefined;
    const update = vi.fn();
    changeScene(update, document, quietWindow, { ready: () => new Promise<void>((resolve) => { arrive = resolve; }) });
    expect(update).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(update).not.toHaveBeenCalled();
    arrive();
    await settle();
    expect(update).toHaveBeenCalledOnce();

    const failed = vi.fn();
    changeScene(failed, document, quietWindow, { ready: () => Promise.reject(new Error('offline')) });
    await settle();
    expect(failed).toHaveBeenCalledOnce();
  });

  it('swaps synchronously when nothing needs waiting for', () => {
    const update = vi.fn();
    changeScene(update, document, quietWindow, { ready: () => null });
    expect(update).toHaveBeenCalledOnce();
  });
});

describe('FL-0477-03 shared elements', () => {
  function element(vt?: string): HTMLElement {
    const made = document.createElement('div');
    if (vt) made.dataset.vt = vt;
    document.body.append(made);
    return made;
  }
  const nameOf = (made: HTMLElement) => (made.style as unknown as { viewTransitionName?: string }).viewTransitionName ?? '';

  it('names each shared element for the travel and clears the name after', async () => {
    const cover = element();
    const title = element();
    changeScene(vi.fn(), document, quietWindow, { share: [[cover, 'mix-art'], [title, 'page-title']] });
    expect(nameOf(cover)).toBe('mix-art');
    expect(nameOf(title)).toBe('page-title');
    started[0].finish();
    await settle();
    expect(nameOf(cover)).toBe('');
    expect(nameOf(title)).toBe('');
  });

  it('keeps the first of a repeated name, and quiets another element already wearing it', async () => {
    const first = element();
    const second = element();
    const wearing = element('mix-art');
    changeScene(vi.fn(), document, quietWindow, { share: [[first, 'mix-art'], [second, 'mix-art']] });
    expect(nameOf(first)).toBe('mix-art');
    expect(nameOf(second)).toBe('');
    expect(nameOf(wearing)).toBe('none');
    started[0].finish();
    await settle();
    expect(nameOf(first)).toBe('');
    expect(nameOf(wearing)).toBe('');
  });

  it('ignores a name that is not a plain identifier and an element that left the page', () => {
    const odd = element();
    const gone = document.createElement('div');
    changeScene(vi.fn(), document, quietWindow, { share: [[odd, 'Mix Art!'], [gone, 'song-art']] });
    expect(nameOf(odd)).toBe('');
    expect(nameOf(gone)).toBe('');
  });

  it('names nothing when the transition is refused', () => {
    setPrefs({ motion: 'subtle' });
    const cover = element();
    changeScene(vi.fn(), document, quietWindow, { share: [[cover, 'mix-art']] });
    expect(nameOf(cover)).toBe('');
  });
});

describe('FL-0477-03 navDirection', () => {
  function rail(...hrefs: string[]) {
    const nav = document.createElement('nav');
    nav.className = 'nav';
    const brand = document.createElement('a');
    brand.className = 'brand';
    brand.setAttribute('href', '/');
    nav.append(brand);
    for (const href of hrefs) {
      const link = document.createElement('a');
      link.setAttribute('href', href);
      nav.append(link);
    }
    document.body.append(nav);
  }

  it('drills in to a deeper address and goes back to its parent', () => {
    const cases: [string, string, NavDirection][] = [
      ['/mixes', '/mixes/mine', 'forward'],
      ['/mixes/mine', '/mixes', 'back'],
      ['/workshop/', '/workshop/storage?x=1', 'forward'],
      ['/library', '/library?sort=title', 'jump'],
    ];
    for (const [from, to, way] of cases) expect(navDirection(from, to), `${from} to ${to}`).toBe(way);
  });

  it('moves up or down by the rail order on the page, and jumps elsewhere', () => {
    rail('/mixes', '/library', '/discover', '/workshop');
    expect(navDirection('/mixes', '/library')).toBe('down');
    expect(navDirection('/discover', '/mixes')).toBe('up');
    expect(navDirection('/discover/harmonic', '/workshop/storage')).toBe('down');
    expect(navDirection('/library', '/somewhere-else')).toBe('jump');
  });

  it('is a jump with no rail on the page', () => {
    expect(navDirection('/mixes', '/library')).toBe('jump');
  });
});
