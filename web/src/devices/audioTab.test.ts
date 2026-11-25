import { describe, expect, it, vi } from 'vitest';
import { audioTab, houseTab } from './audioTab';

// ADR-0475 F: which tab of one browser makes the sound, with a fake lock manager and channel.

/** Web Locks as the browser does them: one holder per name, waiters queued, ifAvailable answers null. */
function fakeLocks() {
  const held = new Map<string, Promise<unknown>>();
  const queue = new Map<string, (() => void)[]>();
  const run = (name: string, body: (lock: unknown) => Promise<unknown>) => {
    const done = body({ name }).finally(() => {
      held.delete(name);
      const next = queue.get(name)?.shift();
      next?.();
    });
    held.set(name, done);
    return done;
  };
  return {
    request: (name: string, options: { ifAvailable?: boolean }, body: (lock: unknown) => Promise<unknown>) => {
      if (!held.has(name)) return run(name, body);
      if (options.ifAvailable) return body(null);
      return new Promise((resolve) => { queue.set(name, [...(queue.get(name) ?? []), () => resolve(run(name, body))]); });
    },
  };
}
/** BroadcastChannel between tabs: a message reaches every other tab. */
function fakeBus() {
  const tabs: ((event: MessageEvent) => void)[][] = [];
  return () => {
    const mine: ((event: MessageEvent) => void)[] = [];
    tabs.push(mine);
    return {
      postMessage: (data: unknown) => { for (const other of tabs) if (other !== mine) other.forEach((listen) => listen({ data } as MessageEvent)); },
      addEventListener: (_type: 'message', listen: (event: MessageEvent) => void) => { mine.push(listen); },
      close: () => undefined,
    };
  };
}
const settle = async () => { for (let i = 0; i < 6; i += 1) await Promise.resolve(); };

describe('one audio tab per browser', () => {
  it('a tab that would start by itself does not while another plays', async () => {
    const locks = fakeLocks();
    const bus = fakeBus();
    const one = audioTab('ws', { locks, channel: bus() });
    const two = audioTab('ws', { locks, channel: bus() });
    expect(await one.claim(false)).toBe(true);
    expect(await two.claim(false)).toBe(false);
    expect(two.holds()).toBe(false);
  });

  it('a press in another tab stops this one first, then that one plays: never both', async () => {
    const locks = fakeLocks();
    const bus = fakeBus();
    const one = audioTab('ws', { locks, channel: bus() });
    const two = audioTab('ws', { locks, channel: bus() });
    const playing = new Set<string>();
    const stopOne = vi.fn(() => { playing.delete('one'); });
    one.onTaken(stopOne);
    await one.claim(false);
    playing.add('one');
    const took = two.claim(true).then((ok) => { expect(playing.size).toBe(0); playing.add('two'); return ok; });
    expect(await took).toBe(true);
    expect(stopOne).toHaveBeenCalledTimes(1);
    expect([...playing]).toEqual(['two']);
    expect(one.holds()).toBe(false);
  });

  it('a closed audio tab frees the lock, so another may start', async () => {
    const locks = fakeLocks();
    const bus = fakeBus();
    const one = audioTab('ws', { locks, channel: bus() });
    const two = audioTab('ws', { locks, channel: bus() });
    await one.claim(false);
    one.close();
    await settle();
    expect(await two.claim(false)).toBe(true);
  });

  it('without Web Locks a tab plays as before', async () => {
    const tab = audioTab('ws', { locks: null, channel: null });
    expect(await tab.claim(false)).toBe(true);
  });

  it('one tab answers for the device, the next when it closes', async () => {
    const locks = fakeLocks();
    const first = houseTab('ws', locks);
    const second = houseTab('ws', locks);
    await settle();
    expect(first.holds()).toBe(true);
    expect(second.holds()).toBe(false);
    first.close();
    await settle();
    expect(second.holds()).toBe(true);
  });

  // T-20261125-ade0: the hosted mix and the browser mix are one sound per browser
  it('the hosted mix in one tab and the browser mix in another contend for one lock: either press stops the other', async () => {
    const locks = fakeLocks();
    const bus = fakeBus();
    const browserMix = audioTab('ws', { locks, channel: bus(), page: 'tab-a' });
    const hostedMix = audioTab('ws', { locks, channel: bus(), page: 'tab-b' });
    const playing = new Set<string>();
    const heard: Array<[string, boolean]> = [];
    browserMix.onTaken((here) => { heard.push(['browser', here]); playing.delete('browser'); });
    hostedMix.onTaken((here) => { heard.push(['hosted', here]); playing.delete('hosted'); });

    expect(await browserMix.claim(true)).toBe(true);
    playing.add('browser');
    // the hosted mix's Play in the other tab: the browser mix stops before the hosted one holds it
    const hostedPress = hostedMix.claim(true).then((held) => { expect(playing.has('browser')).toBe(false); if (held) playing.add('hosted'); return held; });
    expect(await hostedPress).toBe(true);
    expect([...playing]).toEqual(['hosted']);
    expect(heard).toEqual([['browser', false]]);

    // and the browser mix's Play there stops the hosted mix the same way
    const browserPress = browserMix.claim(true).then((held) => { expect(playing.has('hosted')).toBe(false); if (held) playing.add('browser'); return held; });
    expect(await browserPress).toBe(true);
    expect([...playing]).toEqual(['browser']);
    expect(heard).toEqual([['browser', false], ['hosted', false]]);
  });

  it('a take from the same page says so, so the player there does not report another tab', async () => {
    const locks = fakeLocks();
    const bus = fakeBus();
    const browserMix = audioTab('ws', { locks, channel: bus(), page: 'one-page' });
    const hostedMix = audioTab('ws', { locks, channel: bus(), page: 'one-page' });
    const taken = vi.fn();
    browserMix.onTaken(taken);
    await browserMix.claim(true);
    expect(await hostedMix.claim(true)).toBe(true);
    expect(taken).toHaveBeenCalledWith(true);
  });

  it('when the tab that took the sound closes, the one it stopped may carry on', async () => {
    const locks = fakeLocks();
    const bus = fakeBus();
    const hostedMix = audioTab('ws', { locks, channel: bus(), page: 'tab-a' });
    const browserMix = audioTab('ws', { locks, channel: bus(), page: 'tab-b' });
    await hostedMix.claim(true);
    await browserMix.claim(true);
    expect(hostedMix.holds()).toBe(false);
    const free = hostedMix.waitFree(new AbortController().signal);
    browserMix.close();
    expect(await free).toBe(true);
    expect(hostedMix.holds()).toBe(true);
  });
});
