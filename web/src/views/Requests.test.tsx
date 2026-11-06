import { connectMainPlayer } from '../audio/focus';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MixItem } from '../api';
import { SetPlayer } from '../player';
import { fakeBackend, seam, songs } from '../test/backend';
import { ComingSongs, Requests, RequestsContext, RequestsState, RequestTag, requestWords } from './Requests';

const row = (more: Record<string, unknown> = {}) => ({ id: 7, song_id: 9, title: 'Wanted', artist: 'Artist', status: 'waiting', available: 1, ...more });
const playing = (mix: MixItem[]) => {
  const state = { phase: 'playing', position: 0, duration: 200, songTime: 20, inSeam: false };
  return { mix, player: { state, togglePause: vi.fn(async () => {}) } as unknown as SetPlayer, onMix: vi.fn() };
};
const found = (id: number, title: string) => ({ id, title, artist: `${title} artist`, genre: null, duration: 200, bpm: 120, camelot: '8A', lyric_status: 'synced', never: false, priority: false });
const search = () => screen.getByRole('textbox', { name: 'Request a song' });
const listed = () => within(screen.getByRole('list', { name: 'Your requests' }));

describe('song requests joining the mix', () => {
  it('uses the fresh playhead before adding a ready request, and says where it went', async () => {
    const playback = playing(songs(undefined, undefined, undefined));
    const notify = vi.fn();
    const calls = fakeBackend({
      'GET /requests': { requests: [] },
      'POST /requests/consider': () => {
        if ((playback.player.state as { position: number }).position === 1) return { requests: [] };
        (playback.player.state as { position: number }).position = 1;
        return { requests: [row({ ready: true, offer: 'prepared', after: 'Song 2', stage: 'ready' })] };
      },
      'POST /requests/insert': { mix: playback.mix, name: 'Mix', can_undo: true },
    });
    render(<Requests playback={playback} notify={notify} />);
    expect(await screen.findByText('Wanted joined your mix after Song 2.')).toBeInTheDocument();
    expect(playback.onMix).toHaveBeenCalledOnce();
    expect(calls.find((call) => call.path === '/requests/insert')?.body).toMatchObject({ position: 1, offer: 'prepared' });
    expect(notify.mock.calls[0][0]).toBe('Wanted joined your mix after Song 2.');
  });

  it('can be undone from the message that says it joined', async () => {
    const playback = playing(songs(undefined, undefined));
    const notify = vi.fn();
    const before = { mix: songs(undefined), name: 'Mix', can_undo: false };
    const calls = fakeBackend({
      'GET /requests': { requests: [] },
      'POST /requests/consider': { requests: [row({ ready: true, offer: 'prepared', stage: 'ready' })] },
      'POST /requests/insert': { mix: playback.mix, name: 'Mix', can_undo: true },
      'POST /mix/undo': before,
    });
    render(<Requests playback={playback} notify={notify} />);
    await waitFor(() => expect(notify).toHaveBeenCalled());
    await (notify.mock.calls[0][1] as () => Promise<void>)();
    expect(calls.some((call) => call.path === '/mix/undo')).toBe(true);
    expect(playback.onMix).toHaveBeenLastCalledWith(before);
  });

  it('leaves the mix alone when nothing is ready', async () => {
    const playback = playing(songs(undefined, undefined));
    const calls = fakeBackend({
      'GET /requests': { requests: [row()] },
      'POST /requests/consider': { requests: [row({ stage: 'searching' })] },
    });
    render(<Requests playback={playback} />);
    expect(await screen.findByText('Finding a place')).toBeInTheDocument();
    expect(calls.some((call) => call.path === '/requests/insert')).toBe(false);
  });

  it('only looks for a spot while the mix is playing', async () => {
    const playback = playing(songs(undefined, undefined));
    (playback.player.state as { phase: string }).phase = 'idle';
    const calls = fakeBackend({ 'GET /requests': { requests: [row()] } });
    render(<Requests playback={playback} />);
    expect(await screen.findByText('Waiting to play')).toBeInTheDocument();
    expect(calls.some((call) => call.path === '/requests/consider')).toBe(false);
  });
});

describe('what each request is up to', () => {
  const shown = async (more: Record<string, unknown>, mix = songs(undefined, undefined)) => {
    fakeBackend({
      'GET /requests': { requests: [row(more)] },
      'POST /requests/consider': { requests: [row(more)] },
    });
    render(<Requests playback={playing(mix)} />);
    return screen.findByText('Wanted');
  };

  it('says where it will go and how long it will take', async () => {
    await shown({ stage: 'preparing', after: 'Song 2', seconds: 50 });
    expect(await screen.findByText('Getting ready')).toBeInTheDocument();
    expect(screen.getByText('Joins after Song 2. Ready in about a minute.')).toBeInTheDocument();
  });

  it('says when it has to be analysed first', async () => {
    await shown({ stage: 'analysing', waiting_on: 'analysis', seconds: 40 });
    expect(await screen.findByText('Getting ready')).toBeInTheDocument();
    expect(screen.getByText(/needs to listen to it first\. Ready in under a minute/)).toBeInTheDocument();
  });

  it('is plain about a song it can’t place, rather than saying it’s still analysing', async () => {
    await shown({ no_cues: true });
    expect(await screen.findByText('Needs attention')).toBeInTheDocument();
    expect(screen.getByText(/No lyrics were found/)).toBeInTheDocument();
  });

  it('says when a song is set to never play', async () => {
    await shown({ never: true });
    expect(await screen.findByText('Needs attention')).toBeInTheDocument();
  });

  it('names the extra song when it says where a request will go', async () => {
    await shown({ stage: 'preparing', after: 'Song 2', song_id: 9, route: [{ id: 8, title: 'Bridge' }, { id: 9, title: 'Wanted' }] });
    expect(await screen.findByText(/^Joins after Song 2, with Bridge leading in\./)).toBeInTheDocument();
  });

  it('says when a song has gone from the library', async () => {
    await shown({ available: 0 });
    expect(await screen.findByText('Needs attention')).toBeInTheDocument();
  });

  it('notices a song already in the mix', async () => {
    await shown({ song_id: 2 });
    expect(await screen.findByText('In your mix')).toBeInTheDocument();
  });

  it('never uses words like handover or cues', () => {
    const stages = ['adding', 'unavailable', 'never', 'in_mix', 'analysing', 'no_cues', 'no_mix', 'waiting', 'searching', 'approve', 'preparing', 'ready'] as const;
    for (const stage of stages) {
      const words = requestWords(row({ after: 'Song', seconds: 30 }), stage);
      expect(`${words.label} ${words.detail}`).not.toMatch(/handover|cue|proposal|route|playback/i);
    }
  });
});

describe('asking for a song', () => {
  it('searches and adds, keeping the results open for more', async () => {
    const calls = fakeBackend({
      'GET /requests': { requests: [] },
      'GET /songs': [found(9, 'Wanted')],
      'POST /requests': { id: 7, requests: [row()] },
    });
    render(<Requests />);
    fireEvent.change(search(), { target: { value: 'want' } });
    fireEvent.click(await screen.findByRole('button', { name: /Wanted/ }));
    await waitFor(() => expect(calls.find((call) => call.path === '/requests' && call.method === 'POST')?.body).toEqual({ song_id: 9 }));
    expect(search()).toHaveValue('want');
    expect(await screen.findByText('1 waiting')).toBeInTheDocument();
  });

  it('several songs can be asked for from one search, each showing at once', async () => {
    const answers = [
      { id: 7, requests: [row()] },
      { id: 8, requests: [row(), row({ id: 8, song_id: 10, title: 'Second' })] },
    ];
    const calls = fakeBackend({
      'GET /requests': { requests: [] },
      'GET /songs': [found(9, 'Wanted'), found(10, 'Second'), found(11, 'Third')],
      'POST /requests': () => answers.shift(),
    });
    render(<Requests />);
    fireEvent.change(search(), { target: { value: 's' } });
    const first = await screen.findByRole('button', { name: /Wanted .*\+ Request/ });
    fireEvent.click(first);
    expect(screen.getByRole('button', { name: /Wanted .*✓ Requested/ })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /Second .*\+ Request/ }));
    expect(screen.getByRole('button', { name: /Second .*✓ Requested/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Third .*\+ Request/ })).toBeEnabled();
    await waitFor(() => expect(calls.filter((call) => call.path === '/requests' && call.method === 'POST')).toHaveLength(2));
    await waitFor(() => expect(screen.getByText('2 waiting')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /Wanted .*✓ Requested/ })).toBeDisabled();
  });

  it('two picks close together both stay, whichever answer comes back first', async () => {
    const server = waitingBackend({
      'GET /requests': { requests: [] },
      'GET /songs': [found(9, 'Wanted'), found(10, 'Second')],
      'POST /requests': { id: 8, requests: [row(), row({ id: 8, song_id: 10, title: 'Second' })] },
    });
    render(<Requests />);
    fireEvent.change(search(), { target: { value: 's' } });
    fireEvent.click(await screen.findByRole('button', { name: /Wanted .*\+ Request/ }));
    fireEvent.click(screen.getByRole('button', { name: /Second .*\+ Request/ }));
    expect(screen.getAllByText('Adding')).toHaveLength(2);
    await server.release();
    await waitFor(() => expect(screen.queryByText('Adding')).toBeNull());
    expect(screen.getByText('2 waiting')).toBeInTheDocument();
  });

  it('one pick failing doesn’t lose another that worked', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const path = url.replace(/^\/api/, '');
      if (path.startsWith('/songs')) return new Response(JSON.stringify([found(9, 'Wanted'), found(10, 'Second')]), { status: 200 });
      if (init?.method === 'POST') {
        calls += 1;
        if (calls === 1) return new Response(JSON.stringify({ detail: 'Choose a music track.' }), { status: 400 });
        return new Response(JSON.stringify({ id: 8, requests: [row({ id: 8, song_id: 10, title: 'Second' })] }), { status: 200 });
      }
      return new Response(JSON.stringify({ requests: [] }), { status: 200 });
    }));
    render(<Requests />);
    fireEvent.change(search(), { target: { value: 's' } });
    fireEvent.click(await screen.findByRole('button', { name: /Wanted .*\+ Request/ }));
    fireEvent.click(screen.getByRole('button', { name: /Second .*\+ Request/ }));
    await waitFor(() => expect(screen.getByText('1 waiting')).toBeInTheDocument());
    expect(within(screen.getByRole('list', { name: 'Your requests' })).getByText('Second')).toBeInTheDocument();
    expect(within(screen.getByRole('list', { name: 'Your requests' })).queryByText('Wanted')).toBeNull();
  });

  it('Done closes the results, and so does Escape', async () => {
    fakeBackend({ 'GET /requests': { requests: [] }, 'GET /songs': [found(9, 'Wanted')] });
    render(<Requests />);
    fireEvent.change(search(), { target: { value: 'want' } });
    await screen.findByRole('button', { name: /Wanted/ });
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(search()).toHaveValue('');
    expect(screen.queryByRole('button', { name: /Wanted/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Done' })).toBeNull();
  });

  it('Enter takes the first song it can, and Escape clears the search', async () => {
    const calls = fakeBackend({
      'GET /requests': { requests: [row({ id: 3, song_id: 1, title: 'Taken' })] },
      'GET /songs': [found(1, 'Taken'), found(9, 'Wanted')],
      'POST /requests': { id: 7, requests: [] },
    });
    render(<Requests />);
    await screen.findByText('Taken');
    fireEvent.change(search(), { target: { value: 'a' } });
    await screen.findByRole('button', { name: /Wanted/ });
    fireEvent.keyDown(search(), { key: 'Enter' });
    await waitFor(() => expect(calls.find((call) => call.path === '/requests' && call.method === 'POST')?.body).toEqual({ song_id: 9 }));
    expect(search()).toHaveValue('a');
    fireEvent.keyDown(search(), { key: 'Escape' });
    expect(search()).toHaveValue('');
  });

  it('won’t let a song be asked for twice, or one already in the mix', async () => {
    fakeBackend({
      'GET /requests': { requests: [row({ id: 3, song_id: 5, title: 'Waiting song' })] },
      'GET /songs': [found(5, 'Waiting song'), found(1, 'Song 1')],
    });
    render(<Requests playback={playing(songs(undefined, undefined))} />);
    await screen.findByText('Waiting song');
    fireEvent.change(search(), { target: { value: 's' } });
    const inMix = await screen.findByRole('button', { name: /Song 1 .*In your mix/ });
    expect(inMix).toBeDisabled();
    expect(screen.getByRole('button', { name: /Waiting song .*Requested/ })).toBeDisabled();
  });

  it('says when nothing matches', async () => {
    fakeBackend({ 'GET /requests': { requests: [] }, 'GET /songs': [] });
    render(<Requests />);
    fireEvent.change(search(), { target: { value: 'zzz' } });
    expect(await screen.findByText('Nothing in your library matches that.')).toBeInTheDocument();
  });

  it('explains itself when there are no requests, then gets out of the way', async () => {
    fakeBackend({ 'GET /requests': { requests: [] } });
    render(<Requests />);
    expect(await screen.findByText(/Ask for a song any time/)).toBeInTheDocument();
    expect(screen.queryByText(/waiting/)).toBeNull();
  });
});

describe('cancelling a request', () => {
  it('needs no confirming and doesn’t touch the mix', async () => {
    const calls = fakeBackend({
      'GET /requests': { requests: [row()] },
      'DELETE /requests/7': { requests: [] },
    });
    render(<Requests />);
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel request for Wanted' }));
    await waitFor(() => expect(screen.queryByText('Wanted')).toBeNull());
    expect(calls.some((call) => call.path.startsWith('/mix'))).toBe(false);
  });

  it('keeps it on the list if cancelling fails, and says so', async () => {
    fakeBackend({ 'GET /requests': { requests: [row({ available: 0 })] } });
    render(<Requests />);
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel request for Wanted' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t cancel');
    expect(listed().getByText('Wanted')).toBeInTheDocument();
  });

  it('says if it had already joined', async () => {
    fakeBackend({
      'GET /requests': { requests: [row()] },
      'DELETE /requests/7': { cancelled: false, requests: [] },
    });
    render(<Requests />);
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel request for Wanted' }));
    expect(await screen.findByText(/already joined your mix/)).toBeInTheDocument();
  });
});

describe('the tag on a requested song', () => {
  it('says requested', () => {
    render(<RequestTag item={{ from_request: { kind: 'requested' } }} />);
    expect(screen.getByText('Requested')).toBeInTheDocument();
  });

  it('says which request a bridge is for', () => {
    render(<RequestTag item={{ from_request: { kind: 'bridge', for: 'Wanted' } }} />);
    expect(screen.getByText('Bridge to Wanted')).toBeInTheDocument();
  });

  it('shows nothing for a song a request didn’t add', () => {
    const { container } = render(<RequestTag item={{}} />);
    expect(container).toBeEmptyDOMElement();
  });
});

/** A server that doesn't answer until told to, to see what shows in the meantime. */
function waitingBackend(routes: Record<string, unknown>) {
  const held: (() => void)[] = [];
  const calls: { method: string; path: string; body: unknown }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const path = url.replace(/^\/api/, '');
    const method = init?.method ?? 'GET';
    calls.push({ method, path, body: init?.body ? JSON.parse(init.body as string) : null });
    const answer = routes[`${method} ${path.split('?')[0]}`];
    if (method !== 'GET' && path !== '/requests/consider') await new Promise<void>((resolve) => held.push(resolve));
    if (answer === undefined) return new Response(JSON.stringify({ detail: 'That didn’t work.' }), { status: 409 });
    return new Response(JSON.stringify(answer), { status: 200 });
  }));
  return { calls, release: async () => { await act(async () => { held.splice(0).forEach((resolve) => resolve()); }); } };
}

describe('every press shows straight away', () => {
  it('a request appears the moment it’s picked, before the server answers', async () => {
    const server = waitingBackend({ 'GET /requests': { requests: [] }, 'GET /songs': [found(9, 'Wanted')], 'POST /requests': { id: 7, requests: [row()] } });
    render(<Requests />);
    fireEvent.change(search(), { target: { value: 'want' } });
    fireEvent.click(await screen.findByRole('button', { name: /Wanted/ }));
    expect(screen.getByText('Adding')).toBeInTheDocument();
    await server.release();
    await waitFor(() => expect(screen.queryByText('Adding')).toBeNull());
    expect(listed().getByText('Wanted')).toBeInTheDocument();
  });

  it('a pick that fails only takes itself back', async () => {
    let answers = 0;
    let finishSecond: () => void = () => {};
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const path = url.replace(/^\/api/, '');
      if (path.startsWith('/songs')) return new Response(JSON.stringify([found(9, 'Wanted'), found(10, 'Second')]), { status: 200 });
      if (init?.method === 'POST') {
        answers += 1;
        if (answers === 1) await new Promise<void>((resolve) => { finishSecond = resolve; });
        if (answers === 1 || answers === 2) return new Response(JSON.stringify({ detail: 'No.' }), { status: 400 });
      }
      return new Response(JSON.stringify({ requests: [] }), { status: 200 });
    }));
    render(<Requests />);
    fireEvent.change(search(), { target: { value: 's' } });
    fireEvent.click(await screen.findByRole('button', { name: /Wanted .*\+ Request/ }));
    fireEvent.click(screen.getByRole('button', { name: /Second .*\+ Request/ }));
    await screen.findByRole('alert');
    expect(listed().getByText('Wanted')).toBeInTheDocument();
    expect(listed().queryByText('Second')).toBeNull();
    await act(async () => { finishSecond(); });
  });

  it('an answer from the server doesn’t hide a pick it hasn’t heard about yet', async () => {
    let finishFirst: () => void = () => {};
    let answers = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const path = url.replace(/^\/api/, '');
      if (path.startsWith('/songs')) return new Response(JSON.stringify([found(9, 'Wanted'), found(10, 'Second')]), { status: 200 });
      if (init?.method === 'POST') {
        answers += 1;
        if (answers === 1) {
          await new Promise<void>((resolve) => { finishFirst = resolve; });
          return new Response(JSON.stringify({ requests: [row(), row({ id: 8, song_id: 10, title: 'Second' })] }), { status: 200 });
        }
        return new Response(JSON.stringify({ requests: [row({ id: 8, song_id: 10, title: 'Second' })] }), { status: 200 });
      }
      return new Response(JSON.stringify({ requests: [] }), { status: 200 });
    }));
    render(<Requests />);
    fireEvent.change(search(), { target: { value: 's' } });
    fireEvent.click(await screen.findByRole('button', { name: /Wanted .*\+ Request/ }));
    fireEvent.click(screen.getByRole('button', { name: /Second .*\+ Request/ }));
    await waitFor(() => expect(screen.getByText('2 waiting')).toBeInTheDocument());
    expect(listed().getByText('Wanted')).toBeInTheDocument();
    await act(async () => { finishFirst(); });
    await waitFor(() => expect(screen.queryByText('Adding')).toBeNull());
    expect(screen.getByText('2 waiting')).toBeInTheDocument();
  });

  it('takes it back and says so if saving fails', async () => {
    const server = waitingBackend({ 'GET /requests': { requests: [] }, 'GET /songs': [found(9, 'Wanted')] });
    render(<Requests />);
    fireEvent.change(search(), { target: { value: 'want' } });
    fireEvent.click(await screen.findByRole('button', { name: /Wanted/ }));
    expect(screen.getByText('Adding')).toBeInTheDocument();
    await server.release();
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('Adding')).toBeNull();
  });

  it('a cancelled request goes the moment it’s pressed', async () => {
    const server = waitingBackend({ 'GET /requests': { requests: [row()] }, 'DELETE /requests/7': { requests: [] } });
    render(<Requests />);
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel request for Wanted' }));
    expect(screen.queryByText('Wanted')).toBeNull();
    await server.release();
    expect(screen.queryByText('Wanted')).toBeNull();
  });

  it('a cancel that fails puts the request back', async () => {
    const server = waitingBackend({ 'GET /requests': { requests: [row()] } });
    render(<Requests />);
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel request for Wanted' }));
    expect(screen.queryByText('Wanted')).toBeNull();
    await server.release();
    expect(await screen.findByText('Wanted')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('a slow poll can’t bring back something just cancelled', async () => {
    let answer: (value: Response) => void = () => {};
    const slow = new Promise<Response>((resolve) => { answer = resolve; });
    let first = true;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'DELETE') return new Response(JSON.stringify({ requests: [] }), { status: 200 });
      if (first) { first = false; return new Response(JSON.stringify({ requests: [row()] }), { status: 200 }); }
      return slow;
    }));
    render(<Requests />);
    const cancelButton = await screen.findByRole('button', { name: 'Cancel request for Wanted' });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 4100)); });
    fireEvent.click(cancelButton);
    await waitFor(() => expect(screen.queryByText('Wanted')).toBeNull());
    await act(async () => { answer(new Response(JSON.stringify({ requests: [row()] }), { status: 200 })); await slow; });
    expect(screen.queryByText('Wanted')).toBeNull();
  }, 10000);

  it('stays free to use while something else is saving', async () => {
    const server = waitingBackend({ 'GET /requests': { requests: [row(), row({ id: 8, song_id: 10, title: 'Other' })] }, 'DELETE /requests/7': { requests: [row({ id: 8, song_id: 10, title: 'Other' })] }, 'DELETE /requests/8': { requests: [] } });
    render(<Requests />);
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel request for Wanted' }));
    expect(screen.getByRole('button', { name: 'Cancel request for Other' })).toBeEnabled();
    expect(search()).toBeEnabled();
    await server.release();
  });
});

describe('a request that needs an extra song', () => {
  const route = {
    stage: 'approve', needs_approval: true, offer: 'route', after: 'Song 1',
    route: [{ id: 8, title: 'Bridge' }, { id: 9, title: 'Wanted' }],
    transitions: [
      { from: 'Song 1', to: 'Bridge', key: 'one', status: 'none' },
      { from: 'Bridge', to: 'Wanted', key: 'two', status: 'ready' },
      { from: 'Wanted', to: 'Song 2', key: 'three', status: 'none' },
    ],
  };
  const open = (more: Record<string, unknown> = {}, routes: Record<string, unknown> = {}) => {
    const playback = playing(songs(undefined, undefined));
    const calls = fakeBackend({
      'GET /requests': { requests: [row()] },
      'POST /requests/consider': { requests: [row({ ...route, ...more })] },
      ...routes,
    });
    render(<Requests playback={playback} />);
    return { calls, playback };
  };

  beforeEach(() => {
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(async () => {});
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  });

  it('names the extra song and asks', async () => {
    open();
    expect(await screen.findByText('Needs your choice')).toBeInTheDocument();
    expect(screen.getByText('Getting to it takes one extra song: Bridge.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add both' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'No, keep waiting' })).toBeEnabled();
  });

  it('saying yes shows at once, and doesn’t need the mix to be playing', async () => {
    const { calls } = open({}, { 'POST /requests/7/bridge': { requests: [row({ bridge_choice: true })] } });
    fireEvent.click(await screen.findByRole('button', { name: 'Add both' }));
    expect(screen.getByText('Getting ready')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add both' })).toBeNull();
    await waitFor(() => expect(calls.find((call) => call.path === '/requests/7/bridge')?.body).toEqual({ allow: true, songs: [8, 9] }));
  });

  it('never asks again after a yes, even if the last check still says it needs one', async () => {
    open({ bridge_choice: true });
    expect(await screen.findByText('Getting ready')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add both' })).toBeNull();
  });

  it('saying no stops asking and says what happens now', async () => {
    const { calls } = open({}, { 'POST /requests/7/bridge': { requests: [row({ bridge_choice: false })] } });
    fireEvent.click(await screen.findByRole('button', { name: 'No, keep waiting' }));
    expect(screen.getByText('Finding a place')).toBeInTheDocument();
    expect(screen.getByText(/You said no to an extra song/)).toBeInTheDocument();
    await waitFor(() => expect(calls.find((call) => call.path === '/requests/7/bridge')?.body).toEqual({ allow: false }));
  });

  it('an answer that can’t be saved goes back to asking, and says so', async () => {
    open();
    fireEvent.click(await screen.findByRole('button', { name: 'Add both' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Add both' })).toBeInTheDocument();
  });

  it('every transition can be heard first', async () => {
    open();
    expect(await screen.findByRole('button', { name: 'Hear Song 1 into Bridge' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hear Bridge into Wanted' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hear Wanted into Song 2' })).toBeInTheDocument();
  });

  it('one that’s ready plays straight away and pauses the mix', async () => {
    const pause = vi.fn();
    connectMainPlayer({ isPlaying: () => true, pause, resume: vi.fn() });
    open();
    fireEvent.click(await screen.findByRole('button', { name: 'Hear Bridge into Wanted' }));
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
    expect(pause).toHaveBeenCalled();
    connectMainPlayer(null);
    expect(screen.getByRole('button', { name: 'Hear Bridge into Wanted' })).toHaveTextContent('Stop');
  });

  it('one that isn’t ready says so at once, then plays by itself', async () => {
    const seen = { status: 'queued' };
    const { calls } = open({}, { 'POST /requests/7/hear': { seams: [] }, 'GET /seams/one': () => seen });
    const button = await screen.findByRole('button', { name: 'Hear Song 1 into Bridge' });
    fireEvent.click(button);
    expect(button).toHaveTextContent('Getting it ready…');
    await waitFor(() => expect(calls.some((call) => call.path === '/requests/7/hear')).toBe(true));
    seen.status = 'ready';
    await waitFor(() => expect(HTMLMediaElement.prototype.play).toHaveBeenCalled(), { timeout: 3000 });
    expect(button).toHaveTextContent('Stop');
  });

  it('says so if a transition can’t be made', async () => {
    open({}, { 'POST /requests/7/hear': { seams: [] }, 'GET /seams/one': { status: 'failed' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Hear Song 1 into Bridge' }));
    expect(await screen.findByRole('alert', {}, { timeout: 3000 })).toHaveTextContent('didn’t work');
  });

  it('stops when pressed again', async () => {
    open();
    const button = await screen.findByRole('button', { name: 'Hear Bridge into Wanted' });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
    expect(button).toHaveTextContent('Hear');
  });
});

describe('playing a stuck request anyway', () => {
  const done = () => ({ mix: songs(undefined, undefined), name: 'Mix', can_undo: true });

  it('is offered when nothing fits, and goes straight in', async () => {
    const playback = playing(songs(undefined, undefined));
    const notify = vi.fn();
    const calls = fakeBackend({
      'GET /requests': { requests: [row()] },
      'POST /requests/consider': { requests: [row({ stage: 'searching' })] },
      'POST /requests/7/add': done(),
    });
    render(<Requests playback={playback} notify={notify} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Play it anyway' }));
    expect(screen.queryByText('Wanted')).toBeNull();
    await waitFor(() => expect(playback.onMix).toHaveBeenCalled());
    expect(calls.find((call) => call.path === '/requests/7/add')?.body).toMatchObject({ position: 0 });
    expect(notify.mock.calls[0][0]).toBe('Wanted is in your mix.');
    expect(typeof notify.mock.calls[0][1]).toBe('function');
  });

  it('is offered when a song can’t be placed', async () => {
    fakeBackend({ 'GET /requests': { requests: [row({ no_cues: true })] } });
    render(<Requests />);
    expect(await screen.findByRole('button', { name: 'Play it anyway' })).toBeInTheDocument();
  });

  it('isn’t offered while it still has a chance', async () => {
    fakeBackend({
      'GET /requests': { requests: [row()] },
      'POST /requests/consider': { requests: [row({ stage: 'preparing' })] },
    });
    render(<Requests playback={playing(songs(undefined, undefined))} />);
    await screen.findByText('Getting ready');
    expect(screen.queryByRole('button', { name: 'Play it anyway' })).toBeNull();
  });

  it('puts the request back if it can’t be added', async () => {
    fakeBackend({ 'GET /requests': { requests: [row({ no_cues: true })] } });
    render(<Requests />);
    fireEvent.click(await screen.findByRole('button', { name: 'Play it anyway' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(await screen.findByText('Wanted')).toBeInTheDocument();
  });
});
