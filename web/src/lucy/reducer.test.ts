import { describe, expect, it } from 'vitest';
import { canAdvance, cardKey, EMPTY_VIEW, reduce, summarize, type LucyView } from './reducer';
import type { LucyEvent, Snapshot } from './types';

const conversation = {
  id: 'cv_1', title: 'Test', scope: {}, proposal_id: null, parent_id: null, branched_from: null,
  archived: false, created_at: '', updated_at: '', last_user_text: null,
};

function snapshot(cursor = 0): Snapshot {
  return {
    conversation, messages: [], proposal: null, run: null, permissions: [], cards: [], cursor,
    event_schema: 1,
  } as unknown as Snapshot;
}

let nextId = 1;
function event(type: string, payload: Record<string, unknown> = {}, extra: Partial<LucyEvent> = {}): LucyEvent {
  return {
    id: nextId++, v: 1, type, conversation: 'cv_1', turn: 'turn_1', run: 'run_1', plan: null, step: null,
    payload, at: '', ...extra,
  } as LucyEvent;
}

function start(): LucyView {
  nextId = 1;
  return reduce(EMPTY_VIEW, { type: 'snapshot', snapshot: snapshot() });
}

describe('Lucy view from events', () => {
  it('builds streamed text in order and ignores events it has already seen', () => {
    let view = start();
    const started = event('message.started', { message: 'msg_1', role: 'assistant', seq: 2 });
    const one = event('message.delta', { message: 'msg_1', text: 'Here is ' });
    const two = event('message.delta', { message: 'msg_1', text: 'a mix.' });
    view = reduce(view, { type: 'events', events: [started, one, two] });
    view = reduce(view, { type: 'events', events: [one, two] }); // a reconnect replays them
    expect(view.messages.find((m) => m.id === 'msg_1')?.content).toBe('Here is a mix.');
    view = reduce(view, { type: 'events', events: [event('message.completed', { message: 'msg_1', status: 'complete', content: 'Here is a mix.' })] });
    const done = view.messages.find((m) => m.id === 'msg_1');
    expect(done?.status).toBe('complete');
    expect(view.cursor).toBe(4);
  });

  it('updates exactly the card each step event names, in any order', () => {
    let view = start();
    const plan = { plan: 'plan_1' };
    view = reduce(view, {
      type: 'events',
      events: [
        event('plan.started', { steps: [{ id: 'a', op: 'tracks.search', family: 'search', title: 'Searching', note: null }, { id: 'b', op: 'analysis.health', family: 'analysis', title: 'Checking', note: null }] }, plan),
        event('step.queued', { op: 'tracks.search', family: 'search', title: 'Searching', status: 'queued', attempt: 1 }, { ...plan, step: 'a' }),
        event('step.queued', { op: 'analysis.health', family: 'analysis', title: 'Checking', status: 'queued', attempt: 1 }, { ...plan, step: 'b' }),
        event('step.completed', { op: 'analysis.health', family: 'analysis', title: 'Checking', status: 'completed', attempt: 1 }, { ...plan, step: 'b' }),
        event('step.started', { op: 'tracks.search', family: 'search', title: 'Searching', status: 'running', attempt: 1 }, { ...plan, step: 'a' }),
        event('step.completed', { op: 'tracks.search', family: 'search', title: 'Searching', status: 'completed', attempt: 1, count: 12, returned: 12 }, { ...plan, step: 'a' }),
        // a late duplicate start never takes a finished card back
        event('step.started', { op: 'tracks.search', status: 'running', attempt: 1 }, { ...plan, step: 'a' }),
      ],
    });
    expect(view.cards[cardKey('plan_1', 'a')].status).toBe('completed');
    expect(view.cards[cardKey('plan_1', 'a')].count).toBe(12);
    expect(view.cards[cardKey('plan_1', 'b')].status).toBe('completed');
    expect(view.planOrder).toEqual(['plan_1']);
  });

  it('asks for the revision again rather than editing an old one', () => {
    let view = start();
    const before = view.revisionTick;
    view = reduce(view, { type: 'events', events: [event('proposal.revision', { proposal: 'prop_1', revision: 'rev_2', number: 2, current: true })] });
    expect(view.revisionTick).toBeGreaterThan(before);
  });

  it('shows a sent message straight away and settles on the server copy', () => {
    let view = start();
    view = reduce(view, { type: 'events', events: [event('turn.accepted', { text: 'make a mix', seq: 1 })] });
    expect(view.messages.filter((m) => m.role === 'user').map((m) => m.content)).toEqual(['make a mix']);
  });
});

describe('step states only move forward', () => {
  it('never regresses a settled step and lets a failed one be retried', () => {
    expect(canAdvance('queued', 'running', 1, 1)).toBe(true);
    expect(canAdvance('running', 'completed', 1, 1)).toBe(true);
    expect(canAdvance('completed', 'running', 1, 1)).toBe(false);
    expect(canAdvance('cancelled', 'completed', 1, 1)).toBe(false);
    expect(canAdvance('failed', 'retrying', 1, 2)).toBe(true);
    expect(canAdvance('failed', 'running', 1, 1)).toBe(false);
    expect(canAdvance('running', 'queued', 2, 1)).toBe(false);
    expect(canAdvance('progress', 'progress', 1, 1)).toBe(true);
  });
});

describe('screen reader summaries', () => {
  it('say what happened once, never word by word', () => {
    nextId = 100;
    const said = summarize([
      event('message.started', { role: 'assistant' }),
      ...Array.from({ length: 40 }, () => event('message.delta', { text: 'x' })),
      event('step.completed', {}),
      event('step.completed', {}),
      event('proposal.revision', { current: true, number: 3 }),
    ]);
    expect(said).toEqual(['Lucy is replying', '2 steps finished', 'New proposal: revision 3']);
  });
});
