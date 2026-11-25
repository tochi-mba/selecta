import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EMPTY_VIEW, type LucyView, type Note } from '../lucy/reducer';
import type { LimitNotice, Message } from '../lucy/types';
import { Transcript } from './LucyTranscript';

// ADR-0483 rule 3: a lighter Lucy says so once a session. The live notice is an event; a page that
// reads the conversation afterwards (a reload, another device, a reply that beat the page to it)
// only has the reply's own note, so the transcript says it from that.

const LIGHTER: LimitNotice = { cause: 'session_lighter', back_words: '16:40', resets_at: 1_800_000_000, next: [] };
const WORDS = 'A lighter Lucy is answering until this session ends at 16:40.';
const reply = (seq: number, limit?: LimitNotice, status: Message['status'] = 'complete'): Message => ({
  id: `m${seq}`, seq, role: 'assistant', turn: `t${seq}`, run: null, content: `Reply ${seq}`, status, revision: null, created_at: 1_700_000_000 + seq,
  meta: limit ? { limit } : {},
});
const noop = async () => {};
const transcript = (messages: Message[], notes: Note[] = []) => {
  const view: LucyView = { ...EMPTY_VIEW, loaded: true, messages, notes };
  return <Transcript view={view} still pending={null} empty={null} canBranch={false} onBranch={noop} onRetry={noop} onDecide={noop} />;
};
const said = () => screen.queryAllByText(/lighter Lucy/);

describe('a lighter Lucy’s notice in a conversation read afterwards', () => {
  it('is said once, above the reply that carries the note, with no next step', () => {
    render(transcript([reply(1), reply(2, LIGHTER), reply(3)]));
    expect(said()).toHaveLength(1);
    expect(said()[0]).toHaveTextContent(WORDS);
    const items = screen.getAllByRole('listitem').map((item) => item.textContent ?? '');
    expect(items.findIndex((text) => text.includes(WORDS))).toBe(items.findIndex((text) => text.includes('Reply 2')) - 1);
    expect(screen.queryByRole('complementary', { name: 'What you can do next' })).toBeNull();
  });

  it('is not said twice when the live notice for that turn is on the page', () => {
    const live: Note = { id: 'note-7', text: WORDS, tone: 'info', afterSeq: 1, turn: 't2' };
    render(transcript([reply(1), reply(2, LIGHTER)], [live]));
    expect(said()).toHaveLength(1);
  });

  it('waits for the reply to finish, and uses a later day’s words as they are', () => {
    const { rerender } = render(transcript([reply(1, LIGHTER, 'streaming')]));
    expect(said()).toHaveLength(0);
    rerender(transcript([reply(1, { ...LIGHTER, back_words: 'Thursday 09:00' })]));
    expect(said()[0]).toHaveTextContent('A lighter Lucy is answering until this session ends Thursday 09:00.');
    rerender(transcript([reply(1, { ...LIGHTER, back_words: null })]));
    expect(said()[0]).toHaveTextContent('A lighter Lucy is answering until this session ends.');
  });

  it('says nothing for a reply at any other limit', () => {
    render(transcript([reply(1, { ...LIGHTER, cause: 'session', next: ['wait'] }), reply(2)]));
    expect(said()).toHaveLength(0);
  });
});
