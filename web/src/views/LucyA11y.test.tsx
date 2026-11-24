import { render, screen } from '@testing-library/react';
import { useRef } from 'react';
import { describe, expect, it } from 'vitest';
import { EMPTY_VIEW, reduce, summarize } from '../lucy/reducer';
import type { LucyEvent, Snapshot } from '../lucy/types';
import { Composer } from './LucyComposer';

// Found walking Lucy with a screen reader's eyes (2026-11-24): a finished answer was announced
// only as "Lucy finished replying", and a message that couldn't be sent said so only at the
// bottom of the conversation, far from the box its words came back to.

let nextId = 1;
const event = (type: string, payload: Record<string, unknown> = {}) => ({
  id: nextId++, v: 1, type, conversation: 'cv_1', turn: 'turn_1', run: 'run_1', plan: null, step: null, payload, at: '',
}) as unknown as LucyEvent;

const snapshot = {
  conversation: { id: 'cv_1', title: '', scope: {}, proposal_id: null, parent_id: null, branched_from: null, archived: false, created_at: '', updated_at: '', last_user_text: null },
  messages: [], proposal: null, run: null, permissions: [], cards: [], cursor: 0,
} as unknown as Snapshot;

describe('a finished answer is said in its own words', () => {
  it('says the reply, not just that there was one, and never the earlier history', () => {
    nextId = 1;
    const before = reduce(EMPTY_VIEW, { type: 'snapshot', snapshot });
    const events = [
      event('message.started', { message: 'msg_1', role: 'assistant', seq: 2 }),
      event('message.delta', { message: 'msg_1', text: 'Here is a **slow** mix: ' }),
      event('message.delta', { message: 'msg_1', text: '6 songs.' }),
      event('message.completed', { message: 'msg_1', status: 'complete' }),
    ];
    const after = reduce(before, { type: 'events', events });
    expect(summarize(events, after)).toEqual(['Lucy is replying', 'Lucy replied: Here is a slow mix: 6 songs']);
  });

  it('cuts a long reply at a word and says where the rest is', () => {
    nextId = 1;
    const long = Array.from({ length: 120 }, (_, index) => `word${index}`).join(' ');
    const events = [event('message.completed', { message: 'msg_2', status: 'complete', content: long })];
    const after = reduce(reduce(EMPTY_VIEW, { type: 'snapshot', snapshot }), { type: 'events', events });
    const [said] = summarize(events, after);
    expect(said.length).toBeLessThan(360);
    expect(said).toMatch(/^Lucy replied: word0 word1 .*word\d+… The rest is in the conversation$/);
  });
});

function Box({ problem }: { problem: string }) {
  const box = useRef<HTMLTextAreaElement>(null);
  return <Composer value="one more song" onChange={() => undefined} onSend={() => undefined} onStop={async () => undefined} running={false} sending={false} blocked="" problem={problem} voice={false} boxRef={box} />;
}

describe('a message that wasn’t sent says so beside the box', () => {
  it('shows the reason under the box and makes it part of the box’s description', () => {
    render(<Box problem="Not sent. SelectaDJ didn’t answer, so it may not have arrived. Press Send to try again." />);
    const box = screen.getByRole('textbox', { name: 'Message to Lucy' });
    expect(box).toHaveAccessibleDescription(/^Not sent\. SelectaDJ didn’t answer.*Enter sends/);
  });

  it('says nothing extra when the last send went through', () => {
    render(<Box problem="" />);
    expect(screen.getByRole('textbox', { name: 'Message to Lucy' })).toHaveAccessibleDescription('Enter sends · Shift+Enter for a new line');
  });
});
