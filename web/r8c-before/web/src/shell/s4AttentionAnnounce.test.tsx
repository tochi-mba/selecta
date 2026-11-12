import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { setFlags } from '../flags';
import { SetPlayer } from '../player';
import { attentionWords, refreshJobs } from '../state/jobs';
import type { Jobs } from '../api';
import { fakeBackend, seam, songs, status } from '../test/backend';
import { clearToasts } from '../ui/toasts';

/**
 * S4-0092-09: a storage or analysis blocker is announced once, on whatever page is open, so a screen
 * reader user learns of it without opening Workspace. Flag app.attention_announce.
 */
const jobs = (more: Record<string, unknown> = {}) => ({
  worker: { running: true, rendering_the_mix: false },
  mix: { queued: 0, rendering: 0, failed: 0, none: 0, ready: 2 },
  drafts_in_line: 0,
  storage_full: false,
  analysis: { running: false, paused: false, asked_for: 0, left: 0 },
  failed_seams: [],
  failed_songs: [],
  estimates: '',
  ...more,
});

let reply: Record<string, unknown> = jobs();
const backend = (flags?: Record<string, boolean>) => fakeBackend({
  'GET /status': status(flags ? { flags } as never : {}),
  'GET /mix': () => ({ mix: songs(seam('ready', 'a')), name: 'Test mix', can_undo: false }),
  'GET /vibes': [],
  'GET /requests': { requests: [] },
  'GET /drafts': { drafts: [], current: { name: 'Test mix', songs: 2, left: 0, eta: { seconds: 0, low: 0, high: 0 } }, out_of_room: false },
  'GET /library': { songs: [], total: 0, next: null },
  'GET /jobs': () => reply,
});

const spoken = () => [...document.querySelectorAll('[aria-live="polite"][role="status"]')].map((node) => node.textContent ?? '').join(' | ');

beforeEach(() => {
  clearToasts();
  window.localStorage.clear();
  vi.spyOn(SetPlayer.prototype, 'playFrom').mockImplementation(async () => {});
});
afterEach(() => setFlags(null));

describe('S4-0092-09 attention words', () => {
  it('names every blocker, in the singular where there is one', () => {
    expect(attentionWords(jobs() as unknown as Jobs)).toBe('');
    expect(attentionWords(null)).toBe('');
    expect(attentionWords(jobs({ storage_full: true, analysis: { running: false, paused: true, asked_for: 0, left: 1 } }) as unknown as Jobs))
      .toBe('Workspace needs your attention: storage is full, analysis is paused with 1 song left.');
    expect(attentionWords(jobs({ failed_songs: [{}, {}], failed_seams: [{}] }) as unknown as Jobs))
      .toBe('Workspace needs your attention: 2 songs failed, 1 transition failed.');
  });

  it('a paused queue with nothing left is not a blocker', () => {
    expect(attentionWords(jobs({ analysis: { running: false, paused: true, asked_for: 0, left: 0 } }) as unknown as Jobs)).toBe('');
  });
});

describe('S4-0092-09 attention announcement', () => {
  it('a blocker that appears while Library is open is said in the live region', async () => {
    window.history.pushState({}, '', '/library');
    reply = jobs();
    backend();
    render(<App />);
    await screen.findByRole('navigation', { name: 'Main' });
    await act(async () => { await refreshJobs(); });
    reply = jobs({ storage_full: true });
    await act(async () => { await refreshJobs(); });
    await waitFor(() => expect(spoken()).toContain('Workspace needs your attention: storage is full.'));
    expect(window.location.pathname).toBe('/library');
  });

  it('with the flag off the header mark stays but nothing is said', async () => {
    window.history.pushState({}, '', '/mixes');
    reply = jobs();
    backend({ 'app.attention_announce': false });
    render(<App />);
    await screen.findByRole('navigation', { name: 'Main' });
    reply = jobs({ storage_full: true });
    await act(async () => { await refreshJobs(); });
    await screen.findByRole('link', { name: 'Workspace, 1 item needs your attention' });
    await new Promise((done) => setTimeout(done, 80));
    expect(spoken()).not.toContain('needs your attention');
  });
});
