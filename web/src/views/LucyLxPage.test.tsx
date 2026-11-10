import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeBackend } from '../test/backend';
import Lucy from './Lucy';
import { LucySettings } from './LucySettings';

// Selecta Library + Lucy programme (LX): the whole Lucy page, for the readiness gate (LX-0353-05,
// LX-0363-07), exact scope across panes (LX-0355-06, LX-0357-02), unsent words per conversation
// (LX-0357-04, LX-0363-04) and recovery when Selecta can't be reached (LX-0363-05).

const conversation = (id: string, title: string) => ({
  id, title, scope: {}, proposal_id: 'prop_1', parent_id: null, branched_from: null,
  archived: false, created_at: '2026-11-10T10:00:00Z', updated_at: '2026-11-10T10:00:00Z', last_user_text: 'make a mix',
});

// The same recording twice: two occurrences that share a song id and a title.
const songs = [
  { occurrence: 'occ_a', song_id: 1, artist: 'Artist 1', title: 'Twice', duration: 200, bpm: 120, key: '8A', energy: 0.5, locked: false },
  { occurrence: 'occ_b', song_id: 2, artist: 'Artist 2', title: 'Between', duration: 200, bpm: 121, key: '8A', energy: 0.6, locked: false },
  { occurrence: 'occ_c', song_id: 1, artist: 'Artist 1', title: 'Twice', duration: 200, bpm: 120, key: '8A', energy: 0.5, locked: false },
];

const revision = {
  id: 'rev_1', proposal: 'prop_1', number: 1, parent: null, branch: 'main', kind: 'plan', hash: 'h'.repeat(64),
  summary: '3 songs', turn: 'turn_1', created_at: '2026-11-10T10:00:00Z',
  snapshot: {
    title: 'Sunday mix', ready_only: false, variant: 'balanced', songs, revision: 'rev_1', number: 1, diff: null,
    seams: [0, 1].map((at) => ({
      a_occ: songs[at].occurrence, b_occ: songs[at + 1].occurrence, a: songs[at].song_id, b: songs[at + 1].song_id, key: `k${at}`, settings: {},
      requested: 'bass_swap_blend', requested_label: 'Blend', ready: { status: 'none', rendered: null, rendered_label: null, verified: false },
      evidence: { tempo_gap: 1, key_distance: 0, history: 'unknown', provenance: 'predicted' }, warnings: [],
    })),
    constraints: [], evaluation: { duration: { source_seconds: 600, low: 560, high: 600, exact: false }, energy: [], warnings: [], objective: {} }, versions: {},
  },
};

const status = (more: Record<string, unknown> = {}, provider: Record<string, unknown> = {}) => ({
  enabled: true, phases: { chat: true, proposals: true, commit: true, memory: false, voice: false },
  provider: { kind: 'builtin', label: 'Built-in', model: null, base_url: null, remote: false, consented: false, key_set: false, mode: 'full', reason: null, capabilities: { streaming: true, tools: true, json_schema: false, context_tokens: null, cancellation: true }, ...provider },
  budgets: { max_cycles: 6, max_steps: 40, max_seconds: 120, max_output_tokens: 4000, spend_cap_usd: null },
  privacy: { share_lyrics: false, share_history: false, data_classes: [] }, event_schema: 1, api_version: 1, ...more,
});

function snapshotOf(id: string, title: string) {
  return {
    conversation: conversation(id, title),
    messages: [
      { id: `${id}-m1`, seq: 1, role: 'user', turn: 'turn_1', run: null, content: 'make a mix', status: 'complete', revision: null, meta: {}, created_at: '' },
      { id: `${id}-m2`, seq: 2, role: 'assistant', turn: 'turn_1', run: 'run_1', content: 'Here it is.', status: 'complete', revision: 'rev_1', meta: {}, created_at: '' },
    ],
    proposal: { id: 'prop_1', current: revision, history: [{ ...revision, snapshot: undefined, songs: 3, title: 'Sunday mix', ready_only: false, current: true }] },
    run: { id: 'run_1', turn: 'turn_1', state: 'completed', cycles: 0, steps: 1, limits: {}, usage: {}, error: null },
    permissions: [], cards: [], cursor: 10, event_schema: 1,
  };
}

function backend(lucyStatus: unknown = status()) {
  return fakeBackend({
    'GET /lucy/status': lucyStatus,
    'GET /lucy/conversations': { conversations: [conversation('cv_1', 'Sunday'), conversation('cv_2', 'Rainy')] },
    'GET /lucy/conversations/cv_1': snapshotOf('cv_1', 'Sunday'),
    'GET /lucy/conversations/cv_2': snapshotOf('cv_2', 'Rainy'),
    'GET /lucy/conversations/cv_1/events.json': { events: [], gap: false, cursor: 10 },
    'GET /lucy/conversations/cv_2/events.json': { events: [], gap: false, cursor: 10 },
    'GET /lucy/revisions/rev_1': revision,
    'GET /lucy/revisions/rev_1/readiness': { seams: [], ready: 0, needed: 2, playable_now: false, checked_at: '2026-11-10T10:00:00Z' },
    'POST /lucy/conversations/cv_1/turns': { turn: { id: 'turn_2', seq: 3, status: 'queued' }, new: true, run: 'run_2' },
  });
}

const player = { play: vi.fn(), pause: vi.fn(), playFrom: vi.fn() } as never;
const box = () => screen.findByRole('textbox', { name: 'Message to Lucy' });

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
  window.history.replaceState({}, '', '/');
});

describe('LX-0353-05 and LX-0363-07 Lucy being off or unavailable never blocks Make a Mix', () => {
  it('says Lucy is off, that Make a Mix works the same, and links there', async () => {
    const calls = backend(status({ enabled: false }));
    render(<Lucy conversation={null} setMixData={vi.fn()} player={player} />);
    expect(await screen.findByRole('heading', { name: 'Lucy is turned off' })).toBeInTheDocument();
    expect(screen.getByText(/Make a Mix works exactly the same without it/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to Make a Mix' })).toHaveAttribute('href', '/mixes');
    expect(calls.filter((call) => call.method !== 'GET')).toEqual([]);
  });

  it('says an unavailable planner is unavailable and offers the built-in one and Make a Mix', async () => {
    backend(status({}, { kind: 'openai_compatible', label: 'My service', remote: true, consented: true, mode: 'unavailable', reason: 'No key' }));
    render(<Lucy conversation={null} setMixData={vi.fn()} player={player} />);
    const notice = await screen.findByRole('region', { name: 'Lucy’s planner isn’t available' });
    expect(notice.textContent).toContain('My service isn’t available right now: No key');
    expect(notice.textContent).toContain('Make a Mix still works as usual.');
    expect(within(notice).getByRole('button', { name: 'Use the built-in planner instead' })).toBeInTheDocument();
    expect(within(notice).getByRole('link', { name: 'Back to Make a Mix' })).toHaveAttribute('href', '/mixes');
    expect(await box()).toBeInTheDocument();
    expect(screen.getByText('My service isn’t available right now.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
  });
});

describe('LX-0355-06 and LX-0357-02 exact scope stays with the chat', () => {
  it('asks about the second of two identical songs by its own occurrence, and the label can be removed', async () => {
    const calls = backend();
    render(<Lucy conversation="cv_1" setMixData={vi.fn()} player={player} />);
    await userEvent.click(await screen.findByRole('tab', { name: 'Your mix' }));
    const asks = await screen.findAllByRole('button', { name: 'Ask about Twice' });
    expect(asks).toHaveLength(2);
    await userEvent.click(asks[1]);
    // asking takes you to the chat, with the scope labelled above the box
    expect(screen.getByRole('tab', { name: 'Chat' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Twice', { selector: '.lucy-selection span span' })).toBeInTheDocument();
    // looking at the proposal again does not lose or move the scope
    await userEvent.click(screen.getByRole('tab', { name: 'Your mix' }));
    expect(screen.getAllByRole('button', { name: 'Ask about Twice' })[1]).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getAllByRole('button', { name: 'Ask about Twice' })[0]).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(screen.getByRole('tab', { name: 'Chat' }));
    await userEvent.type(await box(), 'make this one calmer{Enter}');
    await waitFor(() => expect(calls.some((call) => call.path.endsWith('/turns'))).toBe(true));
    expect((calls.find((call) => call.path.endsWith('/turns'))?.body as { selection: unknown }).selection).toEqual({ occurrence: 'occ_c' });
  });

  it('removing the scope label means the next message has no scope', async () => {
    const calls = backend();
    render(<Lucy conversation="cv_1" setMixData={vi.fn()} player={player} />);
    await userEvent.click(await screen.findByRole('tab', { name: 'Your mix' }));
    await userEvent.click((await screen.findAllByRole('button', { name: 'Ask about Twice' }))[0]);
    await userEvent.click(screen.getByRole('button', { name: 'Stop asking about Twice' }));
    await userEvent.type(await box(), 'anything else?{Enter}');
    await waitFor(() => expect(calls.some((call) => call.path.endsWith('/turns'))).toBe(true));
    expect((calls.find((call) => call.path.endsWith('/turns'))?.body as Record<string, unknown>).selection).toBeUndefined();
  });
});

describe('LX-0357-04 and LX-0363-04 unsent words belong to one conversation', () => {
  it('keeps each conversation’s unsent words through switching and a reload, never mixing them', async () => {
    backend();
    const { rerender, unmount } = render(<Lucy conversation="cv_1" setMixData={vi.fn()} player={player} />);
    await userEvent.type(await box(), 'half a thought for Sunday');
    rerender(<Lucy conversation="cv_2" setMixData={vi.fn()} player={player} />);
    await waitFor(async () => expect(await box()).toHaveValue(''));
    await userEvent.type(await box(), 'rainy idea');
    rerender(<Lucy conversation="cv_1" setMixData={vi.fn()} player={player} />);
    await waitFor(async () => expect(await box()).toHaveValue('half a thought for Sunday'));
    unmount();
    render(<Lucy conversation="cv_2" setMixData={vi.fn()} player={player} />);
    await waitFor(async () => expect(await box()).toHaveValue('rainy idea'));
  });
});

describe('LX-0363-05 recovery when Selecta can’t be reached', () => {
  it('says what is shown may be out of date and keeps what is typed', async () => {
    fakeBackend({ 'GET /lucy/status': () => { throw new TypeError('Failed to fetch'); } });
    render(<Lucy conversation={null} setMixData={vi.fn()} player={player} />);
    expect(await screen.findByText(/Can’t reach Selecta right now\. What’s shown may be out of date, and anything you type is kept\./)).toBeInTheDocument();
    await userEvent.type(await box(), 'still here');
    expect(await box()).toHaveValue('still here');
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
  });
});

describe('LX-0363-06 provider facts before anything is sent', () => {
  const remote = status({ privacy: { share_lyrics: false, share_history: false, data_classes: [
    { id: 'request', label: 'What you type to Lucy', sent: true },
    { id: 'tags', label: 'Song titles, artists, tempo and key', sent: true },
    { id: 'audio', label: 'Your audio files', sent: false },
  ] } }, { kind: 'openai', label: 'My service', remote: true, consented: false, mode: 'full' });

  it('a remote service waits for consent, and the page says exactly what would go to it', async () => {
    backend(remote);
    render(<Lucy conversation={null} setMixData={vi.fn()} player={player} />);
    expect(await screen.findByText('Lucy needs your OK before it sends anything to My service.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    expect(screen.getByRole('region', { name: 'Before Lucy can start' }).textContent).toContain('Nothing is sent until you agree to exactly what would be sent.');
  });

  it('settings list what is sent and what never is, beside an unticked agreement', () => {
    render(<LucySettings status={remote as never} onSaved={vi.fn()} />);
    const consent = document.querySelector('.lucy-consent') as HTMLElement;
    expect(within(consent).getAllByRole('listitem').map((item) => item.textContent)).toEqual(['What you type to Lucy', 'Song titles, artists, tempo and key']);
    expect(consent.textContent).toContain('Never sent: Your audio files.');
    expect(within(consent).getByRole('checkbox', { name: /I agree to send exactly this to/ })).not.toBeChecked();
  });
});
