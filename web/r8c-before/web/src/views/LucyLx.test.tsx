import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api';
import { lucy } from '../lucy/client';
import { EMPTY_VIEW, type LucyView, type PlanGroup } from '../lucy/reducer';
import type { Approval, Card, Commit, Message, Permission, ProposalSnapshot, PSong, Revision } from '../lucy/types';
import { fakeBackend } from '../test/backend';
import { ActivityCard, PermissionCard, PlanGroupView } from './LucyCards';
import { Composer } from './LucyComposer';
import { LucyHistory } from './LucyHistory';
import { Approve } from './LucyApprove';
import { DiffSummary, LifecyclePill, ProposalPane } from './LucyProposal';
import { EnergyBars, SongsAndSeams } from './LucySongs';
import { RichText, Transcript } from './LucyTranscript';
import { CardVisual } from './LucyVisuals';

// Selecta Library + Lucy programme (LX), ADR-0355 to ADR-0363: the conversation, its steps, the
// proposal, approval and history, checked against the acceptance of each LX task named below.

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.localStorage.clear();
  window.sessionStorage.clear();
});

const msg = (id: string, seq: number, role: Message['role'], turn: string | null, content: string, status: Message['status'] = 'complete'): Message =>
  ({ id, seq, role, turn, run: null, content, status, revision: null, meta: {}, created_at: '' });

const card = (step: string, status: Card['status'], more: Partial<Card> = {}): Card => ({
  plan: 'p1', step, run: 'r1', turn: 't1', op: 'search_songs', family: 'search', title: `Step ${step}`, status, attempt: 1,
  notices: [], visual: {}, ...more,
});

const view = (more: Partial<LucyView>): LucyView => ({ ...EMPTY_VIEW, ...more });
const noop = async () => {};

describe('LX-0356 readable transcript', () => {
  it('LX-0356-02 never renders links, scripts or HTML from message text', () => {
    const hostile = '<img src=x onerror="alert(1)"><script>alert(1)</script> [click](javascript:alert(1)) https://evil.example **fine**';
    const { container } = render(<RichText text={hostile} />);
    expect(container.querySelector('img, script, a, iframe')).toBeNull();
    expect(container.textContent).toContain('<script>alert(1)</script>');
    expect(container.querySelector('strong')?.textContent).toBe('fine');
  });

  it('LX-0356-03 groups a turn’s steps between what was asked and Lucy’s answer, apart from the dialogue', () => {
    const group: PlanGroup = { plan: 'p1', run: 'r1', turn: 't1', steps: ['a'], planned: [], done: true, ok: true, duration_ms: null };
    render(<Transcript
      view={view({
        messages: [msg('m1', 1, 'user', 't1', 'first ask'), msg('m2', 2, 'assistant', 't1', 'first answer'), msg('m3', 3, 'user', 't2', 'second ask')],
        plans: { p1: group }, planOrder: ['p1'], cards: { a: card('a', 'completed') },
      })}
      still pending={null} empty={null} canBranch={false} onBranch={noop} onRetry={noop} onDecide={noop}
    />);
    const items = [...document.querySelectorAll('.lucy-log > li')].map((item) => item.className);
    expect(items).toEqual([expect.stringContaining('is-user'), 'lucy-log-plan', expect.stringContaining('is-assistant'), expect.stringContaining('is-user')]);
    expect(screen.getByRole('region', { name: 'Lucy’s steps' })).toBeInTheDocument();
  });

  it('LX-0356-04 says sending, sent, failed, stopped, replaced and interrupted truthfully', () => {
    const messages = [
      msg('u1', 1, 'user', 't1', 'old ask'),
      msg('a1', 2, 'assistant', 't1', 'partial', 'interrupted'),
      msg('a2', 3, 'assistant', 't2', 'partial', 'cancelled'),
      msg('a3', 4, 'assistant', 't3', '', 'failed'),
      msg('a4', 5, 'assistant', 't4', '', 'streaming'),
    ];
    const props = { still: true, empty: null, canBranch: false, onBranch: noop, onRetry: noop, onDecide: noop };
    const { rerender } = render(<Transcript {...props} view={view({ messages, superseded: { t1: 't9' } })} pending={{ conversation: 'c', text: 'new', state: 'sending' }} />);
    expect(screen.getByText(/Replaced by a newer request/)).toBeInTheDocument();
    expect(screen.getByText(/Interrupted - this reply is incomplete/)).toBeInTheDocument();
    expect(screen.getByText(/Stopped - this reply is incomplete/)).toBeInTheDocument();
    expect(screen.getByText(/Didn’t finish/)).toBeInTheDocument();
    expect(screen.getByText(/Replying…/)).toBeInTheDocument();
    expect(screen.getByText(/Sending…/)).toBeInTheDocument();
    rerender(<Transcript {...props} view={view({ messages })} pending={{ conversation: 'c', text: 'new', state: 'sent', turn: 't5' }} />);
    expect(screen.getByText(/· Sent/)).toBeInTheDocument();
    rerender(<Transcript {...props} view={view({ messages })} pending={{ conversation: 'c', text: 'new', state: 'failed', message: 'No answer.' }} />);
    expect(screen.getByText(/Not sent/)).toBeInTheDocument();
    expect(screen.getByText(/Your words are back in the box below/)).toBeInTheDocument();
  });

  it('LX-0356-06 retry and branch say what they do and run once however fast they are pressed', async () => {
    let finish!: () => void;
    const onRetry = vi.fn(() => new Promise<void>((done) => { finish = done; }));
    render(<Transcript view={view({ messages: [msg('u1', 1, 'user', 't1', 'ask'), msg('a1', 2, 'assistant', 't1', 'half', 'interrupted')] })}
      still pending={null} empty={null} canBranch onBranch={noop} onRetry={onRetry} onDecide={noop} />);
    const retry = screen.getByRole('button', { name: 'Try again' });
    await userEvent.dblClick(retry);
    await userEvent.click(retry);
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledWith('t1');
    await act(async () => finish());
    expect(screen.getByRole('button', { name: 'Start a new conversation from this reply' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start a new conversation from this message of yours' })).toBeInTheDocument();
  });
});

function ComposerHarness({ running = false, onSend, onStop = noop }: { running?: boolean; onSend: () => void; onStop?: () => Promise<void> }) {
  const [value, setValue] = useState('');
  const box = useRef<HTMLTextAreaElement>(null);
  return <Composer value={value} onChange={setValue} onSend={onSend} onStop={onStop} running={running} sending={false} blocked="" voice boxRef={box} />;
}

describe('LX-0357 composer', () => {
  it('LX-0357-01 offers one labelled box for a musical request with a short hint', () => {
    render(<ComposerHarness onSend={vi.fn()} />);
    const box = screen.getByRole('textbox', { name: 'Message to Lucy' });
    expect(box).toHaveAttribute('placeholder', 'Describe a mix, or ask Lucy to change this one');
    expect(screen.getByText('Enter sends · Shift+Enter for a new line')).toBeInTheDocument();
  });

  it('LX-0357-03 Enter sends, Shift+Enter makes a new line and IME composition never submits', async () => {
    const onSend = vi.fn();
    render(<ComposerHarness onSend={onSend} />);
    const box = screen.getByRole('textbox', { name: 'Message to Lucy' });
    await userEvent.type(box, 'line one{Shift>}{Enter}{/Shift}line two');
    expect(onSend).not.toHaveBeenCalled();
    expect(box).toHaveValue('line one\nline two');
    fireEvent.keyDown(box, { key: 'Enter', isComposing: true });
    expect(onSend).not.toHaveBeenCalled();
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it('LX-0357-05 shows Stop only while Lucy is working and explains that sending replaces the run', async () => {
    const onStop = vi.fn(async () => {});
    const { rerender } = render(<ComposerHarness onSend={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /Stop/ })).toBeNull();
    rerender(<ComposerHarness running onSend={vi.fn()} onStop={onStop} />);
    expect(screen.getByText('Lucy is working. Sending now replaces what it’s doing.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Stop/ }));
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it('LX-0357-07 voice input only fills the box for editing; it never sends', async () => {
    const made: { onresult: ((event: unknown) => void) | null; onend: (() => void) | null }[] = [];
    class FakeSpeech {
      lang = ''; interimResults = false; continuous = false;
      onresult: ((event: unknown) => void) | null = null; onerror = null; onend: (() => void) | null = null;
      constructor() { made.push(this); }
      start() {}
      stop() { this.onend?.(); }
      abort() {}
    }
    vi.stubGlobal('SpeechRecognition', FakeSpeech);
    const onSend = vi.fn();
    render(<ComposerHarness onSend={onSend} />);
    await userEvent.type(screen.getByRole('textbox', { name: 'Message to Lucy' }), 'a calm hour');
    await userEvent.click(screen.getByRole('button', { name: 'Voice input' }));
    act(() => made[0].onresult?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: 'with no repeats' } }] }));
    act(() => made[0].onend?.());
    expect(screen.getByRole('textbox', { name: 'Message to Lucy' })).toHaveValue('a calm hour with no repeats');
    expect(onSend).not.toHaveBeenCalled();
  });
});

describe('LX-0358 activity cards', () => {
  it('LX-0358-03 a long plan leads with what failed and what is running; the rest is one press away', async () => {
    const cards = [card('1', 'completed'), card('2', 'completed'), card('3', 'failed', { error: 'No songs' }), card('4', 'completed'), card('5', 'running'), card('6', 'queued')];
    const group: PlanGroup = { plan: 'p1', run: 'r1', turn: 't1', steps: [], planned: [], done: false, ok: null, duration_ms: null };
    render(<PlanGroupView group={group} cards={cards} still />);
    const short = screen.getByRole('list');
    const shown = within(short).getAllByRole('listitem').map((item) => item.textContent ?? '');
    expect(shown.some((text) => text.includes('Step 3') && text.includes('Didn’t work'))).toBe(true);
    expect(shown.some((text) => text.includes('Step 5') && text.includes('Working'))).toBe(true);
    expect(shown.some((text) => text.includes('Step 1'))).toBe(false);
    expect(shown.at(-1)).toMatch(/and 2 more steps/);
    expect(screen.getByText(/Working on: Step 5 \(3 of 6 done\)/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Show all 6 steps' }));
    expect(screen.getAllByRole('article')).toHaveLength(6);
  });

  it('LX-0358-05 a known total is numeric; an unknown total says so, with no time estimate', () => {
    const { rerender, container } = render(<ActivityCard card={card('1', 'progress', { progress: { done: 3, total: 10, unit: 'songs' } })} still />);
    expect(screen.getByText('3 of 10 songs')).toBeInTheDocument();
    expect(container.querySelector('.lucy-progress')).not.toBeNull();
    rerender(<ActivityCard card={card('1', 'progress', { progress: { done: 3, total: null, unit: 'songs' } })} still />);
    expect(screen.getByText('3 songs so far')).toBeInTheDocument();
    expect(container.querySelector('.lucy-progress')).toBeNull();
    expect(container.textContent).not.toMatch(/(remaining|left|ETA|to go)/i);
  });

  it('LX-0358-07 the moving cue is only for real running work and goes when motion is Still', () => {
    const { container, rerender } = render(<ActivityCard card={card('1', 'running')} still={false} />);
    expect(container.querySelector('.lucy-indeterminate')).not.toBeNull();
    rerender(<ActivityCard card={card('1', 'running')} still />);
    expect(container.querySelector('.lucy-indeterminate')).toBeNull();
    expect(screen.getByText('Working')).toBeInTheDocument();
    rerender(<ActivityCard card={card('1', 'completed')} still={false} />);
    expect(container.querySelector('.lucy-indeterminate')).toBeNull();
  });

  it('LX-0358-02 and -04 draw only what the step returned, and say unknown for the rest', () => {
    const { container, rerender } = render(<CardVisual card={card('1', 'completed', { family: 'search', visual: { filters: [{ field: 'bpm', op: 'between', value: [118, 124] }], items: [{ id: 4, title: 'Real Song' }] } })} />);
    expect(screen.getByText('Matches: unknown')).toBeInTheDocument();
    expect(screen.getByText('Real Song')).toBeInTheDocument();
    expect(screen.getByText('Unknown artist')).toBeInTheDocument();
    rerender(<CardVisual card={card('1', 'completed', { family: 'analysis', visual: { song: { title: 'A' }, fields: { tempo: { known: false, value: 120 }, key: { known: true, value: '8A', source: 'analysis' } } } })} />);
    expect(screen.getByText('unknown')).toBeInTheDocument();
    expect(container.textContent).not.toContain('120');
    rerender(<CardVisual card={card('1', 'completed', { family: 'transition', visual: { a: { title: 'One' }, b: { title: 'Two' }, status: 'ready', requested: 'Blend' } })} />);
    expect(screen.getByText('Ready to play')).toBeInTheDocument();
    expect(screen.getByText(/Tempo difference: unknown/)).toBeInTheDocument();
    rerender(<CardVisual card={card('1', 'completed', { family: 'render', visual: {} })} />);
    expect(screen.getByText('How many are ready: unknown')).toBeInTheDocument();
    rerender(<CardVisual card={card('1', 'completed', { family: 'planning', visual: { count: 2, ready_only: true, songs: [{ title: 'One', energy: 0.4 }, { title: 'Two', energy: null }] } })} />);
    expect(screen.getByText('2 songs, length unknown')).toBeInTheDocument();
    expect(container.querySelector('ol.lucy-mini-list')).not.toBeNull();
    expect(screen.getByText('Only transitions that are already ready')).toBeInTheDocument();
  });

  it('LX-0358-06 a permission request is its own card with its own answer, outside the step log', async () => {
    const permission: Permission = { id: 'perm', tier: 'play', operation: 'play_mix', arguments: { mix: 'Sunday' }, text: '', status: 'pending', run: 'r1' };
    const onDecide = vi.fn(async () => {});
    const group: PlanGroup = { plan: 'p1', run: 'r1', turn: 't1', steps: ['a'], planned: [], done: true, ok: true, duration_ms: null };
    render(<Transcript view={view({ messages: [msg('u1', 1, 'user', 't1', 'ask')], plans: { p1: group }, planOrder: ['p1'], cards: { a: card('a', 'completed') }, permissions: [permission] })}
      still pending={null} empty={null} canBranch={false} onBranch={noop} onRetry={noop} onDecide={onDecide} />);
    const ask = screen.getByRole('article', { name: 'Lucy wants to change what’s playing' });
    expect(screen.getByRole('log').contains(ask)).toBe(false);
    expect(within(screen.getByRole('log')).queryByRole('button', { name: 'Allow' })).toBeNull();
    await userEvent.click(within(ask).getByRole('button', { name: 'Allow' }));
    expect(onDecide).toHaveBeenCalledWith('perm', 'allow');
    render(<PermissionCard permission={{ ...permission, status: 'denied' }} onDecide={onDecide} />);
    expect(screen.getByText('You said not now')).toBeInTheDocument();
  });
});

const song = (n: number, more: Partial<PSong> = {}): PSong => ({
  occurrence: `occ_${n}`, song_id: n, artist: `Artist ${n}`, title: `Song ${n}`, duration: 200, bpm: 120, key: '8A', energy: 0.5, locked: false, ...more,
} as PSong);

function snapshot(songs: PSong[], more: Partial<ProposalSnapshot> = {}): ProposalSnapshot {
  return {
    title: 'Sunday', ready_only: false, variant: 'balanced', songs, revision: 'rev_2', number: 2, diff: null,
    seams: songs.slice(1).map((b, index) => ({
      a_occ: songs[index].occurrence, b_occ: b.occurrence, a: songs[index].song_id, b: b.song_id, key: `k${index}`, settings: {},
      requested: 'bass_swap_blend', requested_label: 'Blend',
      ready: { status: 'none', rendered: null, rendered_label: null, verified: false },
      evidence: { tempo_gap: null, key_distance: null, history: 'unknown', provenance: 'predicted' }, warnings: [],
    })),
    constraints: [], evaluation: { duration: { source_seconds: 600, low: 0, high: 0, exact: false }, energy: [], warnings: [], objective: {} }, versions: {},
    ...more,
  } as unknown as ProposalSnapshot;
}

const rev = (id: string, number: number, snap: ProposalSnapshot) => ({ id, proposal: 'prop', number, parent: null, branch: 'main', kind: 'plan', hash: 'h'.repeat(64), summary: '', turn: 't', created_at: '', snapshot: snap } as unknown as Revision);

describe('LX-0359 to LX-0361 the proposal', () => {
  it('LX-0359-01 every lifecycle stage has its own words', () => {
    const stages = ['proposed', 'approved', 'draft', 'rendering', 'ready', 'playing'] as const;
    const said = stages.map((stage) => render(<LifecyclePill stage={stage} />).container.textContent);
    expect(new Set(said).size).toBe(stages.length);
    expect(said[0]).toBe('Proposed - not built');
  });

  it('LX-0359-03 and -05 song count, honest length, and Must kept apart from Prefer', () => {
    const paneProps = { phases: null, selection: null, onAsk: vi.fn(), adopt: vi.fn(), reload: vi.fn(), fillComposer: vi.fn(), approve: () => null };
    const rules = [
      { id: 'r1', kind: 'ready_only', target: '', value: true, strength: 'hard', source: 'user', scope: 'proposal', created_turn: 't', supersedes: null, status: 'active', text: '', label: '' },
      { id: 'r2', kind: 'tempo', target: '', value: 120, strength: 'soft', source: 'user', scope: 'proposal', created_turn: 't', supersedes: null, status: 'active', text: '', label: 'Around 120 BPM' },
    ];
    const one = rev('rev_1', 1, snapshot([song(1)], { constraints: rules } as unknown as Partial<ProposalSnapshot>));
    const { rerender } = render(<ProposalPane {...paneProps} proposal={{ id: 'prop', currentId: 'rev_1', history: [] }} revision={one} />);
    expect(screen.getByText(/0 of 0 transitions ready · Length unknown/)).toBeInTheDocument();
    const listed = within(screen.getByRole('list', { name: 'Rules for this mix' })).getAllByRole('listitem');
    expect(listed[0]).toHaveClass('lucy-ready-only');
    expect(listed[0].textContent).toMatch(/^Must/);
    expect(listed[1]).toHaveClass('is-soft');
    expect(listed[1].textContent).toMatch(/^Prefer Around 120 BPM/);
    const exact = rev('rev_1', 1, snapshot([song(1), song(2)], { evaluation: { duration: { source_seconds: 400, low: 380, high: 380, exact: true }, energy: [], warnings: [], objective: {} } } as unknown as Partial<ProposalSnapshot>));
    rerender(<ProposalPane {...paneProps} proposal={{ id: 'prop', currentId: 'rev_1', history: [] }} revision={exact} />);
    expect(screen.getByText(/2 songs/)).toBeInTheDocument();
    expect(screen.getByText(/0 of 1 transition ready · Runs /)).toBeInTheDocument();
    const range = rev('rev_1', 1, snapshot([song(1), song(2)], { evaluation: { duration: { source_seconds: 400, low: 300, high: 420, exact: false }, energy: [], warnings: [], objective: {} } } as unknown as Partial<ProposalSnapshot>));
    rerender(<ProposalPane {...paneProps} proposal={{ id: 'prop', currentId: 'rev_1', history: [] }} revision={range} />);
    expect(screen.getByText(/· About .+–/)).toBeInTheDocument();
  });

  it('LX-0359-02 and LX-0361-01 an older revision is labelled, read-only and not approvable', async () => {
    const current = rev('rev_2', 2, snapshot([song(1), song(2), song(3)]));
    const older = rev('rev_1', 1, snapshot([song(1), song(2)]));
    fakeBackend({ 'GET /lucy/revisions/rev_1': older });
    const approve = vi.fn((shown: Revision, isCurrent: boolean) => <span data-testid="approve">{`${shown.number}:${isCurrent}`}</span>);
    render(<ProposalPane proposal={{ id: 'prop', currentId: 'rev_2', history: [{ ...older, current: false, songs: 2, title: 'Sunday', ready_only: false } as never, { ...current, current: true, songs: 3, title: 'Sunday', ready_only: false } as never] }}
      revision={current} phases={null} selection={null} onAsk={vi.fn()} adopt={vi.fn()} reload={vi.fn()} fillComposer={vi.fn()} approve={approve} />);
    expect(screen.getByTestId('approve')).toHaveTextContent('2:true');
    await userEvent.click(screen.getByRole('button', { name: /Revision 2/ }));
    await userEvent.click(screen.getByRole('menuitemradio', { name: /Revision 1/ }));
    expect(await screen.findByText(/You’re looking at revision 1\./)).toBeInTheDocument();
    expect(screen.getByText(/The current one is revision 2\. Only the current revision can be changed or approved\./)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Revision 1 \(not the current one\)/ })).toBeInTheDocument();
    expect(screen.getByTestId('approve')).toHaveTextContent('1:false');
    expect(screen.getAllByRole('button', { name: /Move .* up/ })[0]).toHaveAttribute('aria-disabled', 'true');
  });

  it('LX-0361-02 and -03 a comparison says what changed in plain words, including verified transitions', () => {
    render(<DiffSummary label="Compared with revision 2:" diff={{
      songs: [], removed: [{ occurrence: 'o', song_id: 3, title: 'Gone Song', replaced: false }], counts: { added: 1, removed: 1, replaced: 0, moved: 2, kept: 4 },
      seams_changed: [], rules_changed: [{ id: 'r', status: 'added' }],
      readiness: { before: { ready: 3, needed: 5 }, after: { ready: 2, needed: 5 }, kept: 2, lost: 1, gained: 0 },
    }} />);
    expect(screen.getByText(/1 added, 2 moved, 1 removed, 4 kept/)).toBeInTheDocument();
    expect(screen.getByText('Taken out: Gone Song.')).toBeInTheDocument();
    expect(screen.getByText('1 rule changed.')).toBeInTheDocument();
    expect(screen.getByText('Verified ready transitions: 3 of 5 before, 2 of 5 after (1 no longer ready).')).toBeInTheDocument();
  });

  it('LX-0361-04 each instruction says whether it was met, not met or unknown, in words', () => {
    render(<CardVisual card={card('1', 'completed', { family: 'constraints', visual: { rules: [
      { id: 'a', strength: 'hard', label: 'No Jo Marsh', status: 'pass' },
      { id: 'b', strength: 'soft', label: 'Around 120 BPM', status: 'block' },
      { id: 'c', strength: 'soft', label: 'Build slowly', status: 'unknown' },
    ] } })} />);
    const said = screen.getAllByRole('listitem').map((item) => item.textContent?.replace(/\s+/g, ' ').trim());
    expect(said).toEqual(['Must No Jo Marsh Met', 'Prefer Around 120 BPM Not met', 'Prefer Build slowly Unknown']);
  });
});

describe('LX-0360 songs and transitions', () => {
  const props = { ledger: undefined, editable: true, selection: null, onAsk: vi.fn() };

  it('LX-0360-01 and -02 numbered songs with each transition between its exact neighbours', () => {
    const snap = snapshot([song(1), song(2), song(3)]);
    render(<SongsAndSeams {...props} snapshot={snap} onEdit={vi.fn(async () => true)} />);
    const slots = [...document.querySelectorAll('.lucy-song-slot')];
    expect(slots).toHaveLength(3);
    expect(slots[0].querySelector('.lucy-seam')).toBeNull();
    expect(slots[1].querySelector('.lucy-seam')?.getAttribute('aria-label')).toBe('Transition 1');
    expect(slots[2].querySelector('.lucy-seam')?.getAttribute('aria-label')).toBe('Transition 2');
    expect(screen.getAllByRole('group', { name: /^Transition / })).toHaveLength(2);
    expect(slots[1].querySelector('.lucy-song-name')?.textContent).toBe('Song 2: Song 2 Artist 2');
    expect(slots[1].querySelector('.lucy-song-facts')?.textContent).toContain('120 BPM · Key 8A · Energy 0.5');
  });

  it('LX-0360-03 only measured energy makes a bar; unknown energy is labelled', () => {
    const { container } = render(<EnergyBars values={[0.4, null, 0.8]} />);
    expect(container.querySelectorAll('.bar')).toHaveLength(3);
    expect(container.querySelectorAll('.bar.unknown')).toHaveLength(1);
    expect(container.querySelector('.bar.unknown')?.getAttribute('style')).toBeNull();
    expect(screen.getByText(/Dashed outline: energy unknown/)).toBeInTheDocument();
  });

  it('LX-0360-06 planned versus made, tempo and key gap, and history stay distinct', () => {
    const snap = snapshot([song(1), song(2)]);
    const seam = snap.seams[0] as unknown as Record<string, unknown>;
    Object.assign(seam, {
      requested_label: 'Blend',
      ready: { status: 'already_rendered', rendered: 'cut', rendered_label: 'Cut', verified: true },
      evidence: { tempo_gap: 2.04, key_distance: 1, history: 'liked', provenance: 'playable' },
    });
    render(<SongsAndSeams {...props} snapshot={snap} onEdit={vi.fn(async () => true)} />);
    expect(screen.getByText(/Planned:/).textContent).toBe('Planned: Blend · Made as: Cut');
    expect(screen.getByText('Ready to play')).toBeInTheDocument();
    expect(screen.getByText('Tempo differs by 2 BPM · Keys sit well together · You liked this transition before')).toBeInTheDocument();
  });

  it('LX-0360-04, -05 and -07 buttons do every change by exact occurrence, and focus stays on the moved song', async () => {
    const twice = [song(1), song(2), song(1, { occurrence: 'occ_again' })];
    const onEdit = vi.fn(async () => true);
    const { rerender } = render(<SongsAndSeams {...props} snapshot={snapshot(twice)} onEdit={onEdit} />);
    for (const name of ['Lock', 'Ask about Song 1']) expect(screen.getAllByRole('button', { name }).length).toBeGreaterThan(0);
    await userEvent.click(screen.getAllByRole('button', { name: 'Remove Song 1' })[1]);
    expect(onEdit).toHaveBeenLastCalledWith({ op: 'remove', occurrence: 'occ_again' });
    // the removed row is gone, so focus lands on the same control of its neighbour
    await waitFor(() => expect(document.activeElement?.closest('[data-occ]')?.getAttribute('data-occ')).toBe('occ_2'));
    expect(document.activeElement?.getAttribute('data-act')).toBe('remove');
    const down = screen.getAllByRole('button', { name: 'Move Song 1 down' })[0];
    down.focus();
    await userEvent.keyboard('{Enter}');
    expect(onEdit).toHaveBeenLastCalledWith({ op: 'move', occurrence: 'occ_1', to: 1 });
    rerender(<SongsAndSeams {...props} snapshot={snapshot([song(2), song(1), song(1, { occurrence: 'occ_again' })])} onEdit={onEdit} />);
    await waitFor(() => expect(document.activeElement?.closest('[data-occ]')?.getAttribute('data-occ')).toBe('occ_1'));
    expect(document.activeElement?.getAttribute('data-act')).toBe('down');
  });
});

describe('LX-0362 approval', () => {
  const props = { isCurrent: true, blocked: '', seen: {}, onStale: vi.fn(), startPlaying: vi.fn(async () => {}) };
  const approval: Approval = {
    token: 'tok', expires_at: Math.floor(Date.now() / 1000) + 300, action: 'draft',
    preflight: { ok: true, problems: [], songs: 3, ready: 2, needed: 2, ready_only: true, title: 'Sunday' },
  } as Approval;
  const shown = { id: 'rev_4', number: 4, hash: 'h'.repeat(64) } as Revision;

  it('LX-0362-02 the confirmation names the revision, title, songs, ready transitions and the strict rule', async () => {
    vi.spyOn(lucy, 'approve').mockResolvedValue(approval);
    render(<Approve {...props} revision={shown} />);
    await userEvent.click(screen.getByRole('button', { name: 'Save as draft' }));
    const facts = (await screen.findByRole('dialog')).querySelector('dl.lucy-facts') as HTMLElement;
    expect(facts.textContent).toContain('NameSunday');
    expect(facts.textContent).toContain('Revision4 (current)');
    expect(facts.textContent).toContain('Songs3');
    expect(facts.textContent).toContain('Transitions ready2 of 2');
    expect(facts.textContent).toContain('Only transitions that are already readyYes, this rule is on');
  });

  it('LX-0362-05 not received and unknown are separate states, each with its own next step', async () => {
    vi.spyOn(lucy, 'approve').mockResolvedValue(approval);
    vi.spyOn(lucy, 'commit').mockRejectedValue(new ApiError('Server trouble', 502));
    const result = vi.spyOn(lucy, 'commitResult').mockRejectedValueOnce(new ApiError('Not Found', 404)).mockRejectedValueOnce(new TypeError('Failed to fetch'));
    render(<Approve {...props} revision={shown} />);
    await userEvent.click(screen.getByRole('button', { name: 'Save as draft' }));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Save as draft' }));
    expect(await screen.findByText('Selecta didn’t receive that, so nothing was saved.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText(/Couldn’t find out whether it was saved\. Selecta can’t be reached right now\. Nothing will be sent twice\./)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Check again' })).toBeInTheDocument();
    expect(result).toHaveBeenCalledTimes(2);
    // the same key both times: a retry looks up or repeats one operation, never a second draft
    const keys = vi.mocked(lucy.commit).mock.calls.map(([body]) => body.idempotency_key);
    expect(new Set(keys).size).toBe(1);
  });

  it('LX-0362-07 a saved draft opens that exact draft in the editor', async () => {
    vi.spyOn(lucy, 'approve').mockResolvedValue(approval);
    vi.spyOn(lucy, 'commit').mockResolvedValue({ status: 'committed', draft_id: 7, name: 'Sunday', played: false, problems: [] } as unknown as Commit);
    render(<Approve {...props} revision={shown} />);
    await userEvent.click(screen.getByRole('button', { name: 'Save as draft' }));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Save as draft' }));
    expect(await screen.findByRole('link', { name: 'Open in editor' })).toHaveAttribute('href', '/mixes/drafts/7/edit');
    expect(screen.getByText('Saved draft')).toBeInTheDocument();
    expect(props.startPlaying).not.toHaveBeenCalled();
  });
});

describe('LX-0363 conversation history', () => {
  const conversations = [
    { id: 'cv_1', title: 'Sunday', scope: {}, proposal_id: null, parent_id: null, branched_from: null, archived: false, created_at: '', updated_at: '', last_user_text: '' },
    { id: 'cv_2', title: 'Rainy', scope: {}, proposal_id: null, parent_id: null, branched_from: 'cv_1', archived: false, created_at: '', updated_at: '', last_user_text: '' },
  ];

  it('LX-0363-01, -02 and -03 searchable, current marked, and delete says drafts and music are kept', async () => {
    const calls = fakeBackend({ 'GET /lucy/conversations': (_body: unknown, url: string) => ({ conversations: url.includes('q=') ? [conversations[1]] : conversations }) });
    render(<LucyHistory currentId="cv_1" refreshKey="k" />);
    expect(await screen.findByRole('link', { name: /Sunday/ })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: /Rainy/ }).textContent).toContain('branched');
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search conversations' }), 'rain');
    await waitFor(() => expect(calls.some((call) => call.path.includes('q=rain'))).toBe(true));
    await waitFor(() => expect(screen.queryByRole('link', { name: /Sunday/ })).toBeNull());
    await userEvent.click(screen.getByRole('button', { name: 'More for Rainy' }));
    const items = screen.getAllByRole('menuitem').map((item) => item.textContent);
    expect(items).toEqual(['Rename', 'Archive', 'Delete']);
    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete this conversation?' });
    expect(dialog.textContent).toContain('Drafts you already saved from it are kept in My Mixes, and your music is never touched.');
    expect(within(dialog).getByRole('button', { name: 'Keep it' })).toBeInTheDocument();
  });
});
