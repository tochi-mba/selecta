import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { EMPTY_VIEW, type LucyView } from '../lucy/reducer';
import type { LimitNotice, Message } from '../lucy/types';
import { LucyLimitStep, waitWords } from './LucyLimitStep';
import { Transcript } from './LucyTranscript';

const NEVER_SHOWN = /turn|token|\$|Sonnet|Opus|Haiku|Claude/i;
const SESSION: LimitNotice = { cause: 'session', back_words: '16:40', resets_at: 1_800_000_000, next: ['wait', 'plans', 'extra'] };
const reply = (id: string, seq: number, limit?: Partial<LimitNotice> | null, status: Message['status'] = 'complete'): Message => ({
  id, seq, role: 'assistant', turn: `t${seq}`, run: null, content: `Reply ${seq}`, status, revision: null, created_at: 1_700_000_000 + seq,
  meta: limit === null || limit === undefined ? {} : { limit: { ...SESSION, ...limit } },
});
const viewOf = (messages: Message[]): LucyView => ({ ...EMPTY_VIEW, loaded: true, messages });
const noop = async () => {};
const transcript = (messages: Message[], onExtra?: () => void) => (
  <Transcript view={viewOf(messages)} still pending={null} empty={null} canBranch={false} onBranch={noop} onRetry={noop} onDecide={noop} onExtra={onExtra} />
);
const steps = () => screen.queryAllByRole('complementary', { name: 'What you can do next' });

describe('the next step at a limit (ADR-0483 rule 6)', () => {
  it('lists only the choices the server says apply', () => {
    const onExtra = vi.fn();
    const { rerender, container } = render(<LucyLimitStep limit={{ ...SESSION, next: ['wait'] }} onExtra={onExtra} />);
    expect(container).toHaveTextContent('Lucy is back at 16:40.');
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
    rerender(<LucyLimitStep limit={{ ...SESSION, next: ['plans'] }} onExtra={onExtra} />);
    expect(container).not.toHaveTextContent('Lucy is back');
    expect(screen.getByRole('link', { name: 'See plans' })).toHaveAttribute('href', '/account/billing');
    rerender(<LucyLimitStep limit={{ ...SESSION, next: ['extra'] }} onExtra={onExtra} />);
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByRole('button', { name: 'Use extra usage' })).toBeInTheDocument();
    rerender(<LucyLimitStep limit={{ ...SESSION, next: [] }} onExtra={onExtra} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('waiting is plain words with the time, in the meter’s own words', () => {
    expect(waitWords(SESSION)).toBe('Lucy is back at 16:40.');
    expect(waitWords({ ...SESSION, cause: 'week', back_words: 'Thursday 09:00' })).toBe('Lucy is back Thursday 09:00.');
    expect(waitWords({ ...SESSION, cause: 'session_lighter' })).toBe('Lucy is back to normal at 16:40.');
    expect(waitWords({ ...SESSION, cause: 'platform', back_words: null })).toBe('Try again in a little while.');
    expect(waitWords({ ...SESSION, cause: 'week', back_words: null })).toBe('Lucy is back when this week’s use starts again.');
  });

  it('extra usage calls back and asks the server nothing by itself; without a callback it is not offered', async () => {
    const onExtra = vi.fn();
    const { rerender } = render(<LucyLimitStep limit={SESSION} onExtra={onExtra} />);
    await userEvent.click(screen.getByRole('button', { name: 'Use extra usage' }));
    expect(onExtra).toHaveBeenCalledTimes(1);
    rerender(<LucyLimitStep limit={SESSION} />);
    expect(screen.queryByRole('button', { name: 'Use extra usage' })).toBeNull();
    expect(screen.getByRole('link', { name: 'See plans' })).toBeInTheDocument();
  });

  it('never shows what is counted behind the limit', () => {
    for (const cause of ['session_lighter', 'session', 'week', 'lucy_off', 'backstop', 'platform', 'no_model'] as const) {
      const { container, unmount } = render(<LucyLimitStep limit={{ ...SESSION, cause }} onExtra={() => {}} />);
      expect(container.textContent).not.toMatch(NEVER_SHOWN);
      unmount();
    }
  });
});

describe('the next step in the conversation', () => {
  it('sits under the reply that met the limit, and a reply with no limit has none', () => {
    render(transcript([reply('m1', 1), reply('m2', 2, {})], () => {}));
    expect(steps()).toHaveLength(1);
    const holder = steps()[0].closest('article')!;
    expect(holder).toHaveTextContent('Reply 2');
    expect(within(holder).getByText('Lucy is back at 16:40.')).toBeInTheDocument();
  });

  it('is shown once per limit event: the same cause again does not repeat it, a new reset time does', () => {
    const { rerender } = render(transcript([reply('m1', 1, {}), reply('m2', 2, {})]));
    expect(steps()).toHaveLength(1);
    expect(steps()[0].closest('article')).toHaveTextContent('Reply 1');
    // the same messages drawn again: it stays where it was
    rerender(transcript([reply('m1', 1, {}), reply('m2', 2, {})]));
    expect(steps()).toHaveLength(1);
    expect(steps()[0].closest('article')).toHaveTextContent('Reply 1');
    // the next session's limit is a new event; so is a different cause
    rerender(transcript([reply('m1', 1, {}), reply('m2', 2, {}), reply('m3', 3, { resets_at: 1_800_018_000, back_words: '21:40' }), reply('m4', 4, { cause: 'week', back_words: 'Thursday 09:00' })]));
    expect(steps().map((step) => step.closest('article')!.textContent)).toEqual([expect.stringContaining('Reply 1'), expect.stringContaining('Reply 3'), expect.stringContaining('Reply 4')]);
  });

  it('never interrupts a reply that is still arriving', () => {
    const { rerender } = render(transcript([reply('m1', 1, {}, 'streaming')]));
    expect(steps()).toHaveLength(0);
    rerender(transcript([reply('m1', 1, {}, 'complete')]));
    expect(steps()).toHaveLength(1);
  });

  it('leaves what is typed in the box alone', async () => {
    const onExtra = vi.fn();
    function Page() {
      const [text, setText] = useState('half a thought');
      const [messages, setMessages] = useState([reply('m1', 1)]);
      return (
        <>
          {transcript(messages, onExtra)}
          <textarea aria-label="Message Lucy" value={text} onChange={(event) => setText(event.target.value)} />
          <button type="button" onClick={() => setMessages([reply('m1', 1), reply('m2', 2, {})])}>Arrive</button>
        </>
      );
    }
    render(<Page />);
    await userEvent.type(screen.getByLabelText('Message Lucy'), ' more');
    await userEvent.click(screen.getByRole('button', { name: 'Arrive' }));
    expect(steps()).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: 'Use extra usage' }));
    expect(onExtra).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('Message Lucy')).toHaveValue('half a thought more');
  });
});

describe('use extra usage (ADR-0486 rule 3)', () => {
  const WEEK: LimitNotice = { cause: 'week', back_words: 'Thursday 09:00', resets_at: 1_800_000_000, next: ['wait', 'extra'] };
  const button = () => screen.queryByRole('button', { name: 'Use extra usage' });
  /** A press whose answer the test gives when it chooses. */
  function held() {
    let settle: { yes: (answer: 'on' | 'none') => void; no: (error: Error) => void } = { yes: () => {}, no: () => {} };
    const onExtra = vi.fn(() => new Promise<'on' | 'none'>((yes, no) => { settle = { yes, no }; }));
    return { onExtra, yes: (answer: 'on' | 'none' = 'on') => settle.yes(answer), no: () => settle.no(new Error('503')) };
  }

  it('one press says yes, then tells the member to send again', async () => {
    const press = held();
    render(<LucyLimitStep limit={WEEK} onExtra={press.onExtra} />);
    await userEvent.click(button()!);
    expect(press.onExtra).toHaveBeenCalledTimes(1);
    press.yes();
    expect(await screen.findByRole('status')).toHaveTextContent('Extra usage is on for this week. Send your message again.');
    expect(button()).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('cannot be pressed twice while the yes is on its way', async () => {
    const press = held();
    render(<LucyLimitStep limit={WEEK} onExtra={press.onExtra} />);
    await userEvent.click(button()!);
    expect(button()).toHaveAttribute('aria-disabled', 'true');
    expect(button()).toHaveAttribute('aria-busy', 'true');
    await userEvent.click(button()!);
    await userEvent.click(button()!);
    expect(press.onExtra).toHaveBeenCalledTimes(1);
    press.yes();
    await waitFor(() => expect(button()).toBeNull());
  });

  it('says a failure plainly and leaves the button to press again', async () => {
    const press = held();
    render(<LucyLimitStep limit={WEEK} onExtra={press.onExtra} />);
    await userEvent.click(button()!);
    press.no();
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t turn on extra usage. Try again.');
    expect(button()).not.toHaveAttribute('aria-disabled');
    expect(button()).not.toHaveAttribute('aria-busy');
    await userEvent.click(button()!);
    expect(press.onExtra).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).toBeNull();
    press.yes();
    expect(await screen.findByRole('status')).toHaveTextContent('Extra usage is on for this week.');
  });

  it('says so when the extra usage had gone by the time it was pressed', async () => {
    const press = held();
    render(<LucyLimitStep limit={WEEK} onExtra={press.onExtra} />);
    await userEvent.click(button()!);
    press.yes('none');
    expect(await screen.findByRole('status')).toHaveTextContent('There’s no extra usage left to use.');
    expect(button()).toBeNull();
  });

  it('is absent when the server does not offer it', () => {
    const onExtra = vi.fn();
    render(<LucyLimitStep limit={{ ...WEEK, next: ['wait', 'plans'] }} onExtra={onExtra} />);
    expect(button()).toBeNull();
    expect(screen.getByRole('link', { name: 'See plans' })).toBeInTheDocument();
    expect(onExtra).not.toHaveBeenCalled();
  });
});
