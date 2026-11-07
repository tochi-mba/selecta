import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DraftInfo, DraftList } from '../api';
import { fakeBackend } from '../test/backend';
import { Drafts, RenameDraft } from './Drafts';

const draft = (id: number, more: Partial<DraftInfo> = {}): DraftInfo => ({
  id,
  name: `Draft ${id}`,
  songs: 4,
  seconds: 800,
  seams: 3,
  ready: 1,
  failed: 0,
  waiting: 2,
  rendering: false,
  place: null,
  eta: null,
  to_render: 300,
  missing: 0,
  ...more,
});
const list = (drafts: DraftInfo[], more: Partial<DraftList> = {}): DraftList => ({
  drafts,
  current: { name: 'Current', songs: 10, left: 0, eta: { seconds: 0, low: 0, high: 0 } },
  out_of_room: false,
  ...more,
});

function show(answer: DraftList, routes: Record<string, unknown> = {}) {
  const calls = fakeBackend({ 'GET /drafts': answer, ...routes });
  const props = { notify: vi.fn(), openDraft: vi.fn(), playDraft: vi.fn(async () => {}), setView: vi.fn() };
  render(<Drafts {...props} />);
  return { calls, ...props };
}

/** Rename, Copy, Prioritize, Out of line and Delete live behind each draft's own menu. */
async function fromMenu(draft: string, item: string) {
  fireEvent.click(await screen.findByRole('button', { name: `More actions for ${draft}` }));
  fireEvent.click(screen.getByRole('menuitem', { name: item }));
}

describe('your drafts', () => {
  it('invites you to start one when there are none, and starts it in one press', async () => {
    const { calls, openDraft } = show(list([]), { 'POST /drafts': { id: 4, name: 'Draft 1' } });
    fireEvent.click(await screen.findByRole('button', { name: 'New draft' }));
    await waitFor(() => expect(openDraft).toHaveBeenCalledWith(4));
    expect(calls.find((call) => call.method === 'POST')?.path).toBe('/drafts');
    expect(screen.getByText(/without touching what’s playing/)).toBeInTheDocument();
  });

  it('says where each draft has got to', async () => {
    show(list([draft(1), draft(2, { ready: 3, waiting: 0 }), draft(3, { songs: 0, seams: 0, waiting: 0, ready: 0 })]));
    expect(await screen.findByText(/1 of 3 ready/)).toBeInTheDocument();
    expect(screen.getByText(/Ready to play/)).toBeInTheDocument();
    expect(screen.getByText(/Empty/)).toBeInTheDocument();
  });

  it('is honest about seams that could not be made', async () => {
    show(list([draft(1, { ready: 2, failed: 1, waiting: 0 })]));
    expect(await screen.findByText(/1 couldn’t be made/)).toBeInTheDocument();
  });

  it('says when a song has left the library', async () => {
    show(list([draft(1, { missing: 2 })]));
    expect(await screen.findByText(/2 songs have left your library/)).toBeInTheDocument();
  });

  it('plays, and opens for editing, from the list', async () => {
    const { playDraft, openDraft } = show(list([draft(1)]));
    fireEvent.click(await screen.findByRole('button', { name: 'Play Draft 1' }));
    expect(playDraft).toHaveBeenCalledWith(1);
    fireEvent.click(screen.getAllByRole('button', { name: 'Edit Draft 1' })[0]);
    expect(openDraft).toHaveBeenCalledWith(1);
  });

  it('won’t play an empty draft, and says why', async () => {
    show(list([draft(1, { songs: 0, seams: 0, waiting: 0, ready: 0 })]));
    const play = await screen.findByRole('button', { name: 'Play Draft 1' });
    expect(play).toBeDisabled();
    expect(play).toHaveAttribute('title', 'Add a song first');
  });

  it('quotes how long a draft would take before it is prioritized', async () => {
    show(list([draft(1, { to_render: 300 })]));
    expect(await screen.findByText(/Rendering it would take about 5 minutes/)).toBeInTheDocument();
  });

  it('prioritizing puts it in line and says when it will start', async () => {
    const inLine = list([draft(1, { place: 1, eta: { seconds: 600, low: 500, high: 700 } })], {
      current: { name: 'Current', songs: 10, left: 2, eta: { seconds: 240, low: 200, high: 300 } },
    });
    const { calls, notify } = show(list([draft(1)]), { 'POST /drafts/1/line': inLine });
    await fromMenu('Draft 1', 'Prioritize Draft 1');
    await waitFor(() => expect(notify).toHaveBeenCalled());
    expect(calls.some((call) => call.path === '/drafts/1/line')).toBe(true);
    expect(notify.mock.calls[0][0]).toContain('about 10 minutes');
    expect(await screen.findByText('1st in line')).toBeInTheDocument();
    expect(screen.getByText(/Your current mix goes first, with 2 seams left \(about 4 minutes\)/)).toBeInTheDocument();
  });

  it('says it has started when nothing is ahead', async () => {
    const inLine = list([draft(1, { place: 1, eta: { seconds: 100, low: 80, high: 120 } })]);
    const { notify } = show(list([draft(1)]), { 'POST /drafts/1/line': inLine });
    await fromMenu('Draft 1', 'Prioritize Draft 1');
    await waitFor(() => expect(notify).toHaveBeenCalledWith('Rendering Draft 1 in the background.'));
    expect(screen.getByText(/Your current mix is done/)).toBeInTheDocument();
  });

  it('doesn’t offer to prioritize what has nothing left to render', async () => {
    show(list([draft(1, { ready: 3, waiting: 0 }), draft(2, { songs: 1, seams: 0, waiting: 0, ready: 0 })]));
    await screen.findByText(/Ready to play/);
    for (const name of ['Draft 1', 'Draft 2']) {
      fireEvent.click(screen.getByRole('button', { name: `More actions for ${name}` }));
      expect(screen.getByRole('menuitem', { name: `Copy ${name}` })).toBeInTheDocument();
      expect(screen.queryByRole('menuitem', { name: /^Prioritize/ })).toBeNull();
      fireEvent.keyDown(screen.getByRole('menuitem', { name: `Copy ${name}` }), { key: 'Escape' });
    }
  });

  it('can move through the line, but not past the ends', async () => {
    const answer = list([draft(1, { place: 1, eta: { seconds: 100, low: 80, high: 120 } }), draft(2, { place: 2, eta: { seconds: 200, low: 160, high: 240 } })]);
    const { calls } = show(answer, { 'POST /drafts/2/line/move': answer });
    expect(await screen.findByRole('button', { name: 'Move Draft 1 up the line' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move Draft 2 down the line' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Move Draft 2 up the line' }));
    await waitFor(() => expect(calls.find((call) => call.path === '/drafts/2/line/move')?.body).toEqual({ step: -1 }));
    expect(screen.getByText('2nd in line')).toBeInTheDocument();
  });

  it('can be taken out of the line', async () => {
    const before = list([draft(1, { place: 1, eta: { seconds: 100, low: 80, high: 120 } })]);
    const { calls } = show(before, { 'DELETE /drafts/1/line': list([draft(1)]) });
    fireEvent.click(await screen.findByRole('button', { name: 'Take Draft 1 out of the line' }));
    await waitFor(() => expect(screen.queryByRole('group', { name: 'Draft 1 in the render line' })).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'More actions for Draft 1' }));
    expect(screen.getByRole('menuitem', { name: 'Prioritize Draft 1' })).toBeInTheDocument();
    expect(calls.some((call) => call.method === 'DELETE')).toBe(true);
  });

  it('says when rendering has stopped for lack of room, and where to fix it', async () => {
    show(list([draft(1, { place: 1, eta: { seconds: 100, low: 80, high: 120 } })], { out_of_room: true }));
    expect(await screen.findByText(/storage limit/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Change the limit in Workspace' })).toHaveAttribute('href', '/workshop/storage');
  });

  it('confirms before deleting, preserves the draft on cancel and supports Undo', async () => {
    const { calls, notify } = show(list([draft(1)]), { 'DELETE /drafts/1': { name: 'Draft 1' }, 'POST /drafts/restore': { id: 1 } });
    await fromMenu('Draft 1', 'Delete Draft 1');
    expect(screen.getByRole('dialog', { name: 'Delete Draft 1?' })).toBeInTheDocument();
    expect(calls.some((call) => call.path === '/drafts/1')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Keep draft' }));
    expect(calls.some((call) => call.path === '/drafts/1')).toBe(false);
    await fromMenu('Draft 1', 'Delete Draft 1');
    fireEvent.click(screen.getByRole('button', { name: 'Delete draft' }));
    await waitFor(() => expect(notify).toHaveBeenCalled());
    const [message, undo] = notify.mock.calls[0];
    expect(message).toBe('Deleted Draft 1.');
    expect(screen.queryByRole('dialog')).toBeNull();
    await (undo as () => Promise<void>)();
    expect(calls.some((call) => call.path === '/drafts/restore?id=1')).toBe(true);
  });

  it('copies a draft', async () => {
    const { notify } = show(list([draft(1)]), { 'POST /drafts/1/duplicate': { id: 2, name: 'Draft 1 copy' } });
    await fromMenu('Draft 1', 'Copy Draft 1');
    await waitFor(() => expect(notify).toHaveBeenCalledWith('Made a copy: Draft 1 copy.'));
  });

  it('says so if the list can’t be read, rather than looking as if there are no drafts', async () => {
    fakeBackend({});
    render(<Drafts notify={vi.fn()} setView={vi.fn()} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('They’re still saved');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('updates by itself while rendering', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      let answer = list([draft(1, { ready: 1 })]);
      fakeBackend({ 'GET /drafts': () => answer });
      render(<Drafts notify={vi.fn()} setView={vi.fn()} />);
      await screen.findByText(/1 of 3 ready/);
      answer = list([draft(1, { ready: 2, waiting: 1 })]);
      await vi.advanceTimersByTimeAsync(4100);
      expect(await screen.findByText(/2 of 3 ready/)).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('naming a draft', () => {
  it('saves on Enter and says what name it ended up with', async () => {
    const calls = fakeBackend({ 'POST /drafts/1/name': { id: 1, name: 'Friday 2' } });
    const onDone = vi.fn();
    render(<RenameDraft id={1} name="Draft 1" onDone={onDone} />);
    const input = screen.getByRole('textbox', { name: 'Name this draft' });
    fireEvent.change(input, { target: { value: 'Friday' } });
    fireEvent.submit(input);
    await waitFor(() => expect(onDone).toHaveBeenCalledWith('Friday 2'));
    expect(calls[0].body).toEqual({ name: 'Friday' });
  });

  it('Escape and Cancel keep the old name without saving', () => {
    const calls = fakeBackend({});
    const onDone = vi.fn();
    render(<RenameDraft id={1} name="Draft 1" onDone={onDone} />);
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
    expect(onDone).toHaveBeenCalledWith('Draft 1');
    fireEvent.click(within(screen.getByRole('textbox').closest('form') as HTMLElement).getByRole('button', { name: 'Cancel' }));
    expect(onDone).toHaveBeenCalledTimes(2);
    expect(calls).toHaveLength(0);
  });
});
