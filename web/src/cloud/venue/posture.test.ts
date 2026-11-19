import { describe, expect, it } from 'vitest';
import { freshPosture, Posture, PostureEvent, reduce, venueStatus } from './posture';
import * as truth from './soundCheckTruth';
import { atBoundary, fromEarlierVisit, heardByPerson, idleLongEnough, invalidate, NEVER_CHECKED } from './soundCheckTruth';

const AT = 1_800_000_000;
const run = (events: PostureEvent[], from: Posture = freshPosture()) => events.reduce(reduce, from);

/** The whole supported posture: probed, charging, wake lock held, Bluetooth, started, heard. */
const READY: PostureEvent[] = [
  { type: 'probed', ok: true, notes: [] },
  { type: 'battery', fact: 'charging' },
  { type: 'power_confirmed' },
  { type: 'wake', fact: 'held' },
  { type: 'wake_done' },
  { type: 'route_chosen', route: 'bluetooth' },
  { type: 'started' },
  { type: 'heard', at: AT },
];

describe('venue posture flow (BF-0460-02)', () => {
  it('walks power, wake, output, Start and the sound check in order', () => {
    const steps: string[] = [];
    READY.reduce((posture, event) => { const next = reduce(posture, event); steps.push(next.step); return next; }, freshPosture());
    expect(steps).toEqual(['power', 'power', 'wake', 'wake', 'output', 'start', 'soundcheck', 'ready']);
  });

  it('says sound confirmed only with the whole posture and a person’s confirmation', () => {
    const ready = run(READY);
    const status = venueStatus(ready);
    expect(status.status).toBe('verified');
    expect(status.detail).toMatch(/A person confirmed hearing the check tone at/);
    expect(status.problems.filter((problem) => problem.downgrades)).toEqual([]);
    expect(venueStatus(run(READY.slice(0, -1))).status).toBe('output_unverified');
  });

  it.each([
    [{ type: 'hidden' } as PostureEvent, 'uncertain', 'visible'],
    [{ type: 'wake', fact: 'released' } as PostureEvent, 'uncertain', 'wake'],
    [{ type: 'battery', fact: 'on_battery' } as PostureEvent, 'uncertain', 'power'],
    [{ type: 'interrupted' } as PostureEvent, 'interrupted', 'interrupted'],
    [{ type: 'route_changed' } as PostureEvent, 'output_unverified', 'check'],
    [{ type: 'idle' } as PostureEvent, 'output_unverified', 'check'],
  ])('every posture loss downgrades and names the fix: %o', (event, status, problem) => {
    const lost = venueStatus(run([...READY, event]));
    expect(lost.status).toBe(status);
    const named = lost.problems.find((found) => found.id === problem);
    expect(named?.fix.length).toBeGreaterThan(10);
    expect(lost.detail).toMatch(/Last confirmed by a person at/);
  });

  it('restoring the posture does not restore the confirmation: a person must hear it again', () => {
    const back = run([...READY, { type: 'hidden' }, { type: 'visible' }]);
    expect(venueStatus(back).status).toBe('output_unverified');
    expect(back.check.offer).toBe('returned');
    const rechecked = run([{ type: 'heard', at: AT + 60 }], back);
    expect(venueStatus(rechecked).status).toBe('verified');
  });

  it('a call needs a fresh Start and a fresh check', () => {
    const called = run([...READY, { type: 'interrupted' }]);
    const restarted = run([{ type: 'started' }, { type: 'resumed' }], called);
    expect(restarted.interrupted).toBe(false);
    expect(restarted.step).toBe('soundcheck');
    expect(venueStatus(restarted).status).toBe('output_unverified');
  });

  it('a failed probe is unsupported here, with the reason', () => {
    const failed = run([{ type: 'probed', ok: false, reason: 'This browser has no AudioWorklet, so SelectaDJ cannot mix audio here.' }]);
    expect(venueStatus(failed)).toMatchObject({ status: 'unsupported_here' });
    expect(venueStatus(failed).detail).toMatch(/no AudioWorklet/);
  });

  it('a browser without a wake lock is advice, not a downgrade, once auto-lock is the person’s job', () => {
    const noWake = run(READY.map((event) => (event.type === 'wake' ? { type: 'wake', fact: 'unsupported' } as PostureEvent : event)));
    const status = venueStatus(noWake);
    expect(status.status).toBe('verified');
    expect(status.problems.find((problem) => problem.id === 'wake')).toMatchObject({ downgrades: false });
  });
});

describe('sound-check truth (BF-0460-03)', () => {
  it('has no way to fresh except a person: nothing takes signal levels or analyser data', () => {
    const exported = Object.keys(truth).filter((name) => typeof (truth as Record<string, unknown>)[name] === 'function');
    expect(exported.filter((name) => /analy|signal|level|rms|meter/i.test(name))).toEqual([]);
    const makeFresh = exported.filter((name) => {
      const fn = (truth as unknown as Record<string, (...args: unknown[]) => unknown>)[name];
      const out = fn(NEVER_CHECKED, 'route_changed', false) as { fresh?: boolean } | undefined;
      return out && typeof out === 'object' && out.fresh === true;
    });
    expect(makeFresh).toEqual(['heardByPerson']);
  });

  it('never trusts a check from an earlier visit', () => {
    const remembered = fromEarlierVisit(AT);
    expect(remembered).toMatchObject({ fresh: false, lastHeardAt: AT, offer: 'new_visit' });
    expect(venueStatus(freshPosture(AT)).status).not.toBe('verified');
  });

  it('a route change makes a check stale and offers a re-check', () => {
    expect(invalidate(heardByPerson(NEVER_CHECKED, AT), 'route_changed')).toMatchObject({ fresh: false, lastHeardAt: AT, offer: 'route_changed' });
  });

  it('set start and after-idle are boundaries; a check made since still stands', () => {
    const heard = heardByPerson(NEVER_CHECKED, AT);
    expect(atBoundary(heard, 'set_start', false)).toMatchObject({ fresh: false, offer: 'set_start' });
    expect(atBoundary(heard, 'after_idle', false)).toMatchObject({ fresh: false, offer: 'after_idle' });
    expect(atBoundary(heard, 'after_idle', true).fresh).toBe(true);
    expect(idleLongEnough(AT, AT + truth.IDLE_RECHECK_S)).toBe(true);
    expect(idleLongEnough(AT, AT + 60)).toBe(false);
  });
});
