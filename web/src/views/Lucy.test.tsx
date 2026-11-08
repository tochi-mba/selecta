import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeBackend } from '../test/backend';
import Lucy from './Lucy';

const conversation = {
  id: 'cv_1', title: 'Sunday', scope: {}, proposal_id: 'prop_1', parent_id: null, branched_from: null,
  archived: false, created_at: '2026-11-08T10:00:00Z', updated_at: '2026-11-08T10:00:00Z', last_user_text: 'make a mix',
};

const songs = [1, 2, 3].map((id, index) => ({
  occurrence: `occ_${id}`, song_id: id, artist: `Artist ${id}`, title: `Song ${id}`, duration: 200,
  bpm: index === 2 ? null : 120, key: '8A', energy: index === 1 ? null : 0.5, locked: false,
}));

const revision = {
  id: 'rev_1', proposal: 'prop_1', number: 1, parent: null, branch: 'main', kind: 'plan', hash: 'h'.repeat(64),
  summary: '3 songs', turn: 'turn_1', created_at: '2026-11-08T10:00:00Z',
  snapshot: {
    title: 'Sunday mix', ready_only: true, variant: 'ready_now', songs, revision: 'rev_1', number: 1, diff: null,
    seams: [1, 2].map((a) => ({
      a_occ: `occ_${a}`, b_occ: `occ_${a + 1}`, a, b: a + 1, key: `k${a}`, settings: { move: 'bass_swap_blend' },
      requested: 'bass_swap_blend', requested_label: 'Blend',
      ready: { status: 'already_rendered', rendered: 'bass_swap_blend', rendered_label: 'Blend', verified: true },
      evidence: { tempo_gap: 0.01, key_distance: 0, history: 'unknown', provenance: 'playable' }, warnings: [],
    })),
    constraints: [{
      id: 'rule_1', kind: 'ready_only', target: '', value: true, strength: 'hard', source: 'user', scope: 'proposal',
      created_turn: 'turn_1', supersedes: null, status: 'active', text: 'only ready', label: 'Only transitions that are already ready to play',
    }],
    evaluation: { duration: { source_seconds: 600, low: 480, high: 480, exact: true }, energy: [0.5, null, 0.5], warnings: [], objective: {} },
    versions: {},
  },
  ledger: {
    seams: [1, 2].map((a) => ({ a_occ: `occ_${a}`, b_occ: `occ_${a + 1}`, key: `k${a}`, status: 'already_rendered', requested: 'bass_swap_blend', rendered: 'bass_swap_blend', verified: true, proof: 'Checked on disk just now: the clip is there and plays.' })),
    ready: 2, needed: 2, playable_now: true, checked_at: '2026-11-08T10:00:00Z',
  },
};

const status = {
  enabled: true, phases: { chat: true, proposals: true, commit: true, memory: false, voice: false },
  provider: { kind: 'builtin', label: 'Built-in', model: null, base_url: null, remote: false, consented: false, key_set: false, mode: 'constrained', reason: 'Simpler.', capabilities: { streaming: true, tools: true, json_schema: false, context_tokens: null, cancellation: true } },
  budgets: { max_cycles: 6, max_steps: 40, max_seconds: 120, max_output_tokens: 4000, spend_cap_usd: null },
  privacy: { share_lyrics: false, share_history: false, data_classes: [] }, event_schema: 1, api_version: 1,
};

function backend() {
  return fakeBackend({
    'GET /lucy/status': status,
    'GET /lucy/conversations': { conversations: [conversation] },
    'GET /lucy/conversations/cv_1': {
      conversation,
      messages: [
        { id: 'm1', seq: 1, role: 'user', turn: 'turn_1', run: null, content: 'make a mix', status: 'complete', revision: null, meta: {}, created_at: '' },
        { id: 'm2', seq: 2, role: 'assistant', turn: 'turn_1', run: 'run_1', content: 'Here is a **proposal**.', status: 'complete', revision: 'rev_1', meta: {}, created_at: '' },
      ],
      proposal: { id: 'prop_1', current: revision, history: [{ ...revision, snapshot: undefined, songs: 3, title: 'Sunday mix', ready_only: true, current: true }] },
      run: { id: 'run_1', turn: 'turn_1', state: 'completed', cycles: 0, steps: 1, limits: {}, usage: {}, error: null },
      permissions: [], cards: [], cursor: 10, event_schema: 1,
    },
    'GET /lucy/conversations/cv_1/events.json': { events: [], gap: false, cursor: 10 },
    'GET /lucy/revisions/rev_1': revision,
    'GET /lucy/revisions/rev_1/readiness': revision.ledger,
    'POST /lucy/conversations/cv_1/turns': { turn: { id: 'turn_2', seq: 3, status: 'queued' }, new: true, run: 'run_2' },
    'POST /lucy/approvals': (body: unknown) => ({
      token: 'tok', expires_at: Math.floor(Date.now() / 1000) + 600, action: (body as { action: string }).action,
      preflight: { ok: true, problems: [], songs: 3, ready: 2, needed: 2, ready_only: true, title: 'Sunday mix', playable_now: true },
    }),
  });
}

const player = { play: vi.fn(), pause: vi.fn() } as never;

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe('Lucy', () => {
  it('shows the proposal as not built, with its hard ready-only rule and real readiness', async () => {
    backend();
    render(<Lucy conversation="cv_1" setMixData={vi.fn()} player={player} />);
    expect(await screen.findAllByText(/Proposed — not built/i)).not.toHaveLength(0);
    expect(screen.getAllByText(/Only transitions that are already ready/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/2 of 2 transitions ready/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/unknown/i).length).toBeGreaterThan(0); // missing BPM/energy stays unknown
    expect(document.querySelector('script')).toBeNull();
    expect(screen.getByText('proposal').tagName).toBe('STRONG'); // simple bold, never raw HTML
  });

  it('sends with a client id and the revision the person was looking at', async () => {
    const calls = backend();
    render(<Lucy conversation="cv_1" setMixData={vi.fn()} player={player} />);
    const box = await screen.findByRole('textbox', { name: /message|describe|lucy/i });
    await userEvent.type(box, 'remove the second one{Enter}');
    await waitFor(() => expect(calls.some((call) => call.method === 'POST' && call.path.endsWith('/turns'))).toBe(true));
    const sent = calls.find((call) => call.path.endsWith('/turns'))?.body as Record<string, unknown>;
    expect(sent.text).toBe('remove the second one');
    expect(typeof sent.client_id).toBe('string');
    expect(sent.expected_revision).toBe('rev_1');
  });

  it('asks separately before anything would start playing', async () => {
    const calls = backend();
    render(<Lucy conversation="cv_1" setMixData={vi.fn()} player={player} />);
    // a narrow screen shows one pane at a time
    await userEvent.click(await screen.findByRole('tab', { name: /your mix/i }));
    const [play] = await screen.findAllByRole('button', { name: /save and play/i });
    await userEvent.click(play);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/replaces what.s playing/i)).toBeTruthy();
    const approval = calls.find((call) => call.path === '/lucy/approvals')?.body as Record<string, unknown>;
    expect(approval).toMatchObject({ revision: 'rev_1', hash: 'h'.repeat(64), action: 'draft_and_play' });
    expect(calls.some((call) => call.path === '/lucy/commits')).toBe(false);
    expect((player as unknown as { play: ReturnType<typeof vi.fn> }).play).not.toHaveBeenCalled();
  });
});
