import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBackend } from '../test/backend';
import { Listening } from './Listening';

// T0241: a missing clip, a partly answered trial, a refresh part way, keyboard-only answering,
// a double submit and finishing a whole study, each tested on its own.

const open = async () => {
  fireEvent.change(screen.getByLabelText('Study code'), { target: { value: 'flow' } });
  fireEvent.change(screen.getByLabelText('Listener nickname'), { target: { value: 'ear' } });
  fireEvent.change(screen.getByLabelText('Listening setup'), { target: { value: 'headphones' } });
  fireEvent.click(screen.getByRole('button', { name: 'Open study' }));
  await screen.findByText(/Comparison \d+ of/);
};

/** Makes a clip count as heard: it really played past half a second with data loaded. */
const hear = (version: 'A' | 'B') => {
  const audio = screen.getByLabelText(`Version ${version}`) as HTMLAudioElement;
  Object.defineProperty(audio, 'currentTime', { configurable: true, value: 1 });
  Object.defineProperty(audio, 'readyState', { configurable: true, value: 4 });
  fireEvent.timeUpdate(audio);
};

const quality = (version: 'A' | 'B') => within(screen.getByRole('radiogroup', { name: `Quality of ${version}` }));

beforeEach(() => {
  sessionStorage.clear();
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('blind listening study, start to finish', () => {
  it('a missing clip says so and still lets you record cannot judge', async () => {
    const calls = fakeBackend({ 'GET /listening': [{ id: 't1' }], 'POST /listening/t1/response': {} });
    render(<Listening />);
    await open();
    fireEvent.error(screen.getByLabelText('Version B'));
    expect(await screen.findByRole('alert')).toHaveTextContent('A comparison clip is unavailable');
    expect(screen.getByRole('button', { name: 'Prefer A' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cannot judge' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Cannot judge' }));
    await screen.findByText('All responses saved. Thank you for listening.');
    expect(calls.filter((call) => call.method === 'POST').map((call) => (call.body as { choice: string }).choice)).toEqual(['cannot_judge']);
  });

  it('a refresh part way returns to the same comparison with its ratings and heard clips', async () => {
    fakeBackend({ 'GET /listening': [{ id: 't1' }, { id: 't2' }], 'POST /listening/t1/response': {} });
    const first = render(<Listening />);
    await open();
    hear('A');
    hear('B');
    fireEvent.click(screen.getByRole('button', { name: 'Prefer B' }));
    await screen.findByText('Comparison 2 of 2');
    // A partial trial: one version rated, one heard, nothing chosen yet.
    fireEvent.click(quality('A').getByRole('radio', { name: '2' }));
    hear('A');
    first.unmount();

    render(<Listening />);
    await open();
    expect(screen.getByText('Comparison 2 of 2')).toBeInTheDocument();
    expect(quality('A').getByRole('radio', { name: '2' })).toBeChecked();
    expect(quality('B').getByRole('radio', { name: '2' })).not.toBeChecked();
    // Only A was heard before the refresh, so a preference still waits for B.
    expect(screen.getByRole('button', { name: 'Prefer A' })).toBeDisabled();
    hear('B');
    expect(screen.getByRole('button', { name: 'Prefer A' })).toBeEnabled();
  });

  it('a double submit stores one response and moves on once', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const calls = fakeBackend({ 'GET /listening': [{ id: 't1' }, { id: 't2' }], 'POST /listening/t1/response': {} });
    const fetcher = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    const answer = fetcher.getMockImplementation() as typeof fetch;
    fetcher.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') await gate;
      return answer(url, init);
    });
    render(<Listening />);
    await open();
    const cannot = screen.getByRole('button', { name: 'Cannot judge' });
    fireEvent.click(cannot);
    fireEvent.click(cannot);
    await act(async () => { release(); });
    await screen.findByText('Comparison 2 of 2');
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(1);
  });

  it('can be answered with the keyboard alone through to the end', async () => {
    const user = userEvent.setup();
    const calls = fakeBackend({ 'GET /listening': [{ id: 'k1' }], 'POST /listening/k1/response': {} });
    render(<Listening />);
    await user.click(screen.getByLabelText('Study code'));
    await user.keyboard('flow');
    await user.tab();
    await user.keyboard('ear');
    await user.tab();
    await user.keyboard('headphones');
    await user.keyboard('{Enter}');
    await screen.findByText('Comparison 1 of 1');
    const grade = quality('A').getByRole('radio', { name: '4' });
    grade.focus();
    await user.keyboard(' ');
    expect(grade).toBeChecked();
    const tag = within(screen.getByRole('group', { name: 'Issues with A, if any' })).getByRole('checkbox', { name: 'energy' });
    tag.focus();
    await user.keyboard(' ');
    expect(tag).toBeChecked();
    screen.getByRole('button', { name: 'Cannot judge' }).focus();
    await user.keyboard('{Enter}');
    await screen.findByText('All responses saved. Thank you for listening.');
    expect(calls.find((call) => call.method === 'POST')?.body).toMatchObject({ quality: { a: { grade: 4, tags: ['energy'] } } });
  });

  it('finishing every comparison saves each once and says the study is complete', async () => {
    const calls = fakeBackend({
      'GET /listening': [{ id: 't1' }, { id: 't2' }, { id: 't3' }],
      'POST /listening/t1/response': {}, 'POST /listening/t2/response': {}, 'POST /listening/t3/response': {},
    });
    render(<Listening />);
    await open();
    for (const [step, choice] of [[1, 'Prefer A'], [2, 'No preference'], [3, 'Prefer B']] as const) {
      await screen.findByText(`Comparison ${step} of 3`);
      hear('A');
      hear('B');
      fireEvent.click(screen.getByRole('button', { name: choice }));
    }
    expect(await screen.findByText('All responses saved. Thank you for listening.')).toBeInTheDocument();
    expect(screen.getByText('You answered 3 comparisons.')).toBeInTheDocument();
    expect(screen.queryByText(/Comparison \d of 3/)).toBeNull();
    const posts = calls.filter((call) => call.method === 'POST');
    expect(posts.map((call) => [call.path, (call.body as { choice: string }).choice])).toEqual([
      ['/listening/t1/response', 'a'], ['/listening/t2/response', 'tie'], ['/listening/t3/response', 'b'],
    ]);
    // Reopening a finished study shows it finished instead of starting again.
    fireEvent.click(screen.getByRole('button', { name: 'Open study' }));
    await waitFor(() => expect(screen.getByText('All responses saved. Thank you for listening.')).toBeInTheDocument());
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(3);
  });
});
