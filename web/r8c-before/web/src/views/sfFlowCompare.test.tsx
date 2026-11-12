import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MixItem } from '../api';
import { setFlags } from '../flags';
import { seam, songs } from '../test/backend';
import { forgetRenders } from './SeamCompare';
import { SeamInspector } from './SeamInspector';

const options = { moves: [{ name: 'bass_swap_blend', label: 'Blend', description: '', available: true, reason: null }], exits: [], entries: [], lengths: [], links: [], tempo_gap: 1, keys: ['8A', '8A'] };

let clips: Record<string, number> = {};
beforeEach(() => {
  forgetRenders();
  clips = {};
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.includes('/options')) return new Response(JSON.stringify(options), { status: 200 });
    const clip = /\/api\/seams\/([^/]+)\/preview/.exec(url);
    if (clip) return new Response('', { status: clips[clip[1]] ?? 404 });
    return new Response('{}', { status: 200 });
  }));
});
afterEach(() => { vi.unstubAllGlobals(); setFlags(null); });

const view = (item: MixItem, previous: MixItem) => (
  <SeamInspector item={item} previous={previous} names={{ bass_swap_blend: 'Blend', cut_on_one: 'Cut' }} refreshMix={() => {}} notify={() => {}}
    guard={{}} tab="listen" setTab={() => {}} autoPlay={false} onClose={() => {}} />
);
const compare = () => screen.queryByRole('region', { name: 'Compare with before' });

// SF-0221-06: A/B appears only between two real, finished, different renders of the same pair, and
// only once the earlier clip is confirmed to exist.
describe('SF-0221-06 A/B gated on real clips', () => {
  it('a single render has nothing to compare with', async () => {
    clips = { r1: 200 };
    const [previous, item] = songs(seam('ready', 'r1', { label: 'Blend', style: 'bass_swap_blend' }));
    render(view(item, previous));
    await new Promise((done) => setTimeout(done, 50));
    expect(compare()).toBeNull();
  });

  it('a new finished render of the same pair offers A and B, each its own real clip', async () => {
    clips = { r1: 200, r2: 200 };
    const [previous, item] = songs(seam('ready', 'r1', { label: 'Blend', style: 'bass_swap_blend' }));
    const page = render(view(item, previous));
    // changed, and still being made: nothing to compare yet
    page.rerender(view({ ...item, seam: seam('rendering', 'r2') as MixItem['seam'] }, previous));
    expect(compare()).toBeNull();
    page.rerender(view({ ...item, seam: seam('ready', 'r2', { label: 'Cut', style: 'cut_on_one' }) as MixItem['seam'] }, previous));
    await waitFor(() => expect(compare()).not.toBeNull());
    const before = screen.getByRole('button', { name: 'A: before (Blend)' });
    const now = screen.getByRole('button', { name: 'B: now (Cut)' });
    expect(now).toHaveAttribute('aria-pressed', 'true');
    const sources = () => [...compare()!.querySelectorAll('audio')].map((audio) => audio.getAttribute('src'));
    expect(sources()).toEqual(['/api/seams/r2/preview']);
    fireEvent.click(before);
    expect(sources()).toEqual(['/api/seams/r1/preview']);
  });

  it('an earlier clip the server no longer has is never offered', async () => {
    clips = { r2: 200 };
    const [previous, item] = songs(seam('ready', 'r1', { label: 'Blend', style: 'bass_swap_blend' }));
    const page = render(view(item, previous));
    page.rerender(view({ ...item, seam: seam('ready', 'r2', { label: 'Cut' }) as MixItem['seam'] }, previous));
    await new Promise((done) => setTimeout(done, 50));
    expect(compare()).toBeNull();
  });

  it('a failed new attempt is not a side, and another pair never borrows this one’s history', async () => {
    clips = { r1: 200, r9: 200 };
    const [previous, item, third] = songs(seam('ready', 'r1', { label: 'Blend' }), seam('ready', 'r9', { label: 'Blend' }));
    const page = render(view(item, previous));
    page.rerender(view({ ...item, seam: seam('failed', 'r2') as MixItem['seam'] }, previous));
    await new Promise((done) => setTimeout(done, 50));
    expect(compare()).toBeNull();
    page.rerender(view(third, item));
    await new Promise((done) => setTimeout(done, 50));
    expect(compare()).toBeNull();
  });

  it('closes up when its flag is off', async () => {
    setFlags({ 'seam_inspector.compare': false });
    clips = { r1: 200, r2: 200 };
    const [previous, item] = songs(seam('ready', 'r1', { label: 'Blend' }));
    const page = render(view(item, previous));
    page.rerender(view({ ...item, seam: seam('ready', 'r2', { label: 'Cut' }) as MixItem['seam'] }, previous));
    await new Promise((done) => setTimeout(done, 50));
    expect(compare()).toBeNull();
  });
});
