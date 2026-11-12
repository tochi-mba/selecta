import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setFlags } from '../flags';
import { fakeBackend } from '../test/backend';
import { Listening, nextUnanswered } from './Listening';

/** S4-0109-08: skip, no trials left and early exit. A skip saves nothing, the end never says "All
 * responses saved" while one is skipped, stopping sends nothing, and reopening picks up where it stopped. */
const THREE = [{ id: 't1' }, { id: 't2' }, { id: 't3' }];

const open = async () => {
  fireEvent.change(screen.getByLabelText('Study code'), { target: { value: 'skip-study' } });
  fireEvent.change(screen.getByLabelText('Listener nickname'), { target: { value: 'one' } });
  fireEvent.change(screen.getByLabelText('Listening setup'), { target: { value: 'headphones' } });
  fireEvent.click(screen.getByRole('button', { name: 'Open study' }));
};

afterEach(() => {
  sessionStorage.clear();
  act(() => setFlags(null));
});

describe('nextUnanswered', () => {
  it('goes to the next comparison without an answer, and past the end when none is left', () => {
    const ids = ['t1', 't2', 't3'];
    expect(nextUnanswered(ids, 0, [])).toBe(1);
    expect(nextUnanswered(ids, 0, ['t2'])).toBe(2);
    expect(nextUnanswered(ids, 1, ['t3'])).toBe(3);
    expect(nextUnanswered(ids, 2, [])).toBe(3);
  });
});

describe('skip and stop in the blind study', () => {
  it('a skip sends nothing, and the end says how many were skipped instead of claiming all were saved', async () => {
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    const calls = fakeBackend({ 'GET /listening': THREE, 'POST /listening/t2/response': {}, 'POST /listening/t1/response': {} });
    render(<Listening />);
    await open();
    await screen.findByText('Comparison 1 of 3');
    fireEvent.click(screen.getByRole('button', { name: 'Skip this comparison' }));
    expect(await screen.findByText('Comparison 2 of 3')).toBeInTheDocument();
    expect(calls.filter((call) => call.method === 'POST')).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Cannot judge' }));
    expect(await screen.findByText('Comparison 3 of 3')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Skip this comparison' }));
    expect(await screen.findByText('You reached the end, with 2 skipped.')).toBeInTheDocument();
    expect(screen.getByText(/1 of 3 comparisons answered and saved/)).toBeInTheDocument();
    expect(screen.queryByText('All responses saved. Thank you for listening.')).toBeNull();
    expect(calls.filter((call) => call.method === 'POST').map((call) => call.path)).toEqual(['/listening/t2/response']);

    // the second pass visits only the skipped ones, then the end is truthful again
    fireEvent.click(screen.getByRole('button', { name: 'Answer the skipped ones' }));
    expect(await screen.findByText('Comparison 1 of 3')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cannot judge' }));
    expect(await screen.findByText('Comparison 3 of 3')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Skip this comparison' }));
    expect(await screen.findByText('You reached the end, with 1 skipped.')).toBeInTheDocument();
  });

  it('stopping for now sends nothing, and opening the same study again carries on from there', async () => {
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    const calls = fakeBackend({ 'GET /listening': THREE, 'POST /listening/t1/response': {} });
    const { unmount } = render(<Listening />);
    await open();
    await screen.findByText('Comparison 1 of 3');
    fireEvent.click(screen.getByRole('button', { name: 'Cannot judge' }));
    await screen.findByText('Comparison 2 of 3');
    fireEvent.click(screen.getByRole('button', { name: 'Stop for now' }));
    const stopped = await screen.findByText(/Stopped for now/);
    expect(stopped.closest('[role="status"]')).toHaveTextContent('1 of 3 comparisons answered and saved.');
    expect(screen.getByText(/carry on from comparison 2/)).toBeInTheDocument();
    expect(screen.queryByText('Comparison 2 of 3')).toBeNull();
    expect(screen.queryByText(/All responses saved/)).toBeNull();
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(1);

    // a reload: the page is gone, then opened again with the same code, nickname and setup
    unmount();
    render(<Listening />);
    await open();
    expect(await screen.findByText('Comparison 2 of 3')).toBeInTheDocument();
  });

  it('with the flag off there is no skip or stop, and the page reads as before', async () => {
    act(() => setFlags({ 'listening_study.skip_and_stop': false }));
    fakeBackend({ 'GET /listening': THREE });
    render(<Listening />);
    await open();
    await screen.findByText('Comparison 1 of 3');
    expect(screen.queryByRole('button', { name: 'Skip this comparison' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Stop for now' })).toBeNull();
    expect(screen.queryByRole('group', { name: 'Leave this comparison' })).toBeNull();
  });

  it('no trials left is not a completion', async () => {
    fakeBackend({ 'GET /listening': [] });
    render(<Listening />);
    await open();
    expect(await screen.findByText('No trials are registered for this study code.')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText(/All responses saved|reached the end/)).toBeNull());
  });
});
