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
    expect(await screen.findByText('Looking for a spot')).toBeInTheDocument();
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
    expect(await screen.findByText('Getting it ready')).toBeInTheDocument();
    expect(screen.getByText('Joins after Song 2. Ready in about a minute.')).toBeInTheDocument();
  });

  it('says when it has to be analysed first', async () => {
    await shown({ stage: 'analysing', waiting_on: 'analysis', seconds: 40 });
    expect(await screen.findByText('Analysing')).toBeInTheDocument();
    expect(screen.getByText(/needs to listen to it first\. Ready in under a minute/)).toBeInTheDocument();
  });

  it('is plain about a song it can’t place, rather than saying it’s still analysing', async () => {
    await shown({ no_cues: true });
    expect(await screen.findByText('Can’t place it')).toBeInTheDocument();
    expect(screen.getByText(/No lyrics were found/)).toBeInTheDocument();
  });

  it('says when a song is set to never play', async () => {
    await shown({ never: true });
    expect(await screen.findByText('Set to never play')).toBeInTheDocument();
  });

  it('names the extra song when it says where a request will go', async () => {
    await shown({ stage: 'preparing', after: 'Song 2', song_id: 9, route: [{ id: 8, title: 'Bridge' }, { id: 9, title: 'Wanted' }] });
    expect(await screen.findByText(/^Joins after Song 2, with Bridge leading in\./)).toBeInTheDocument();
  });

  it('says when a song has gone from the library', async () => {
    await shown({ available: 0 });
    expect(await screen.findByText('Not in your library')).toBeInTheDocument();
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
    expect(await screen.findByText('Needs your OK')).toBeInTheDocument();
    expect(screen.getByText('Getting to it takes one extra song: Bridge.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add both' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'No, keep waiting' })).toBeEnabled();
  });

  it('saying yes shows at once, and doesn’t need the mix to be playing', async () => {
    const { calls } = open({}, { 'POST /requests/7/bridge': { requests: [row({ bridge_choice: true })] } });
    fireEvent.click(await screen.findByRole('button', { name: 'Add both' }));
    expect(screen.getByText('Getting it ready')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add both' })).toBeNull();
    await waitFor(() => expect(calls.find((call) => call.path === '/requests/7/bridge')?.body).toEqual({ allow: true, songs: [8, 9] }));
  });

  it('never asks again after a yes, even if the last check still says it needs one', async () => {
    open({ bridge_choice: true });
    expect(await screen.findByText('Getting it ready')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add both' })).toBeNull();
  });

  it('saying no stops asking and says what happens now', async () => {
    const { calls } = open({}, { 'POST /requests/7/bridge': { requests: [row({ bridge_choice: false })] } });
    fireEvent.click(await screen.findByRole('button', { name: 'No, keep waiting' }));
    expect(screen.getByText('Looking for a spot')).toBeInTheDocument();
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
    const { playback } = open();
    fireEvent.click(await screen.findByRole('button', { name: 'Hear Bridge into Wanted' }));
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
    expect(playback.player.togglePause).toHaveBeenCalled();
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
    await screen.findByText('Getting it ready');
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

describe('a request on its way into the mix', () => {
  const state = (rows: unknown[], more: Record<string, unknown> = {}) => ({
    requests: rows,
    error: '',
    message: '',
    playback: playing(songs(undefined, undefined)),
    add: vi.fn(),
    cancel: vi.fn(async () => {}),
    chooseBridge: vi.fn(),
    addAnyway: vi.fn(),
    ...more,
  }) as unknown as RequestsState;
  const show = (value: RequestsState, after = 2) => render(
    <RequestsContext.Provider value={value}><ol><ComingSongs afterSongId={after} /></ol></RequestsContext.Provider>,
  );

  it('shows where it’s going, faded, and says it isn’t ready', () => {
    const { container } = show(state([row({ stage: 'preparing', after_id: 2, seconds: 170 })]));
    expect(container.querySelector('li.song.coming')).toBeInTheDocument();
    expect(screen.getByText('Wanted')).toBeInTheDocument();
    expect(screen.getByText('Requested')).toBeInTheDocument();
    expect(screen.getByText('Getting it ready · about 3 minutes')).toBeInTheDocument();
  });

  it('can’t be played, because it isn’t in the mix yet', () => {
    show(state([row({ stage: 'preparing', after_id: 2 })]));
    expect(screen.queryByRole('button', { name: /Play/ })).toBeNull();
    expect(screen.getAllByRole('listitem')[1]).toHaveAccessibleName(/won’t play until it’s ready/);
  });

  it('only shows at its own place', () => {
    const { container } = show(state([row({ stage: 'preparing', after_id: 3 })]));
    expect(container.querySelector('li')).toBeNull();
  });

  it('shows a bridge as well, in the order they’ll play', () => {
    show(state([row({ stage: 'preparing', after_id: 2, route: [{ id: 8, title: 'Bridge', artist: 'Someone' }, { id: 9, title: 'Wanted', artist: 'Artist' }] })]));
    const rows = screen.getAllByRole('listitem').slice(1);
    expect(rows[0]).toHaveTextContent('Bridge');
    expect(rows[0]).toHaveTextContent('Bridge to Wanted');
    expect(rows[1]).toHaveTextContent('Requested');
  });

  it('stays out of the timeline until there’s a spot, or an answer', () => {
    const { container } = show(state([
      row({ id: 1, stage: 'searching', after_id: 2 }),
      row({ id: 2, stage: 'approve', after_id: 2 }),
      row({ id: 3, waiting_on: 'analysis', after_id: 2 }),
    ]));
    expect(container.querySelector('li')).toBeNull();
  });

  it('shows straight after a yes to its bridge', () => {
    const { container } = show(state([row({ stage: 'approve', bridge_choice: true, after_id: 2 })]));
    expect(container.querySelector('li.song.coming')).toBeInTheDocument();
  });

  it('isn’t shown once nothing is playing, since the spot depends on where playback is', () => {
    const playback = playing(songs(undefined, undefined));
    (playback.player.state as { phase: string }).phase = 'idle';
    const { container } = show(state([row({ stage: 'preparing', after_id: 2 })], { playback }));
    expect(container.querySelector('li')).toBeNull();
  });

  it('can be cancelled from the timeline', () => {
    const value = state([row({ stage: 'preparing', after_id: 2 })]);
    show(value);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel request for Wanted' }));
    expect(value.cancel).toHaveBeenCalled();
  });
});

describe('transitions on their way in', () => {
  const seams = [
    { from: 'Song 2', to: 'Wanted', key: 'in', status: 'ready', label: 'Blend' },
    { from: 'Wanted', to: 'Song 3', key: 'out', status: 'rendering', label: 'Delay throw' },
  ];
  const value = (transitions: { from: string; to: string; key: string; status: string; label?: string }[] = seams) => ({
    requests: [row({ stage: 'preparing', after_id: 2, transitions })],
    error: '',
    message: '',
    playback: playing(songs(undefined, undefined, undefined)),
    add: vi.fn(),
    cancel: vi.fn(async () => {}),
    chooseBridge: vi.fn(),
    addAnyway: vi.fn(),
  }) as unknown as RequestsState;
  const show = (state: RequestsState) => render(
    <RequestsContext.Provider value={state}><ol><ComingSongs afterSongId={2} /></ol></RequestsContext.Provider>,
  );

  it('sit either side of the song, in playing order', () => {
    show(value());
    const rows = screen.getAllByRole('listitem').slice(1);
    expect(rows[0]).toHaveTextContent('Blend');
    expect(rows[1]).toHaveTextContent('Wanted');
    expect(rows[2]).toHaveTextContent('Delay throw');
  });

  it('are solid once done, and faded until then', () => {
    const { container } = show(value());
    const [done, waiting] = [...container.querySelectorAll('li.coming-seam')];
    expect(done).toHaveClass('done');
    expect(waiting).not.toHaveClass('done');
    expect(done).toHaveTextContent('Ready');
    expect(waiting).toHaveTextContent('Rendering…');
  });

  it('go solid by themselves as they finish', () => {
    const { container, rerender } = show(value());
    expect(container.querySelectorAll('li.coming-seam.done')).toHaveLength(1);
    rerender(
      <RequestsContext.Provider value={value(seams.map((seam) => ({ ...seam, status: 'ready' })))}><ol><ComingSongs afterSongId={2} /></ol></RequestsContext.Provider>,
    );
    expect(container.querySelectorAll('li.coming-seam.done')).toHaveLength(2);
  });

  it('can be heard once done, and pause the mix while you do', () => {
    const state = value();
    const { container } = show(state);
    fireEvent.click(screen.getByRole('button', { name: 'Hear it' }));
    expect(state.playback?.player.togglePause).toHaveBeenCalled();
    expect(container.querySelector('audio')).toHaveAttribute('src', '/api/seams/in/preview');
    fireEvent.click(screen.getByRole('button', { name: 'Hide' }));
    expect(container.querySelector('audio')).toBeNull();
  });

  it('only offer to be heard when there’s something to hear', () => {
    show(value());
    expect(screen.getAllByRole('button', { name: 'Hear it' })).toHaveLength(1);
  });

  it('show a bridge’s transitions between each song', () => {
    const three = [
      { from: 'Song 2', to: 'Bridge', key: 'a', status: 'ready' },
      { from: 'Bridge', to: 'Wanted', key: 'b', status: 'none' },
      { from: 'Wanted', to: 'Song 3', key: 'c', status: 'none' },
    ];
    const state = value(three);
    state.requests![0].route = [{ id: 8, title: 'Bridge' }, { id: 9, title: 'Wanted' }];
    show(state);
    const names = screen.getAllByRole('listitem').slice(1).map((item) => (item.classList.contains('coming-seam') ? 'seam' : 'song'));
    expect(names).toEqual(['seam', 'song', 'seam', 'song', 'seam']);
  });

  it('are fine with a request going at the very end, with no way back to the mix', () => {
    show(value([seams[0]]));
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    expect(screen.getByText(/once this transition is ready/)).toBeInTheDocument();
  });
});

describe('a bridge joining as one', () => {
  const route = [{ id: 8, title: 'Bridge', artist: 'Someone' }, { id: 9, title: 'Wanted', artist: 'Artist' }];
  const three = [
    { from: 'Song 2', to: 'Bridge', key: 'a', status: 'ready', label: 'Blend' },
    { from: 'Bridge', to: 'Wanted', key: 'b', status: 'rendering', label: 'Blend' },
    { from: 'Wanted', to: 'Song 3', key: 'c', status: 'queued', label: 'Blend' },
  ];
  const value = (more: Record<string, unknown> = {}) => ({
    requests: [row({ stage: 'preparing', after_id: 2, route, transitions: three, seconds: 120, ...more })],
    error: '',
    message: '',
    playback: playing(songs(undefined, undefined, undefined)),
    add: vi.fn(),
    cancel: vi.fn(async () => {}),
    chooseBridge: vi.fn(),
    addAnyway: vi.fn(),
    findBridges: vi.fn(),
    pickBridge: vi.fn(),
  }) as unknown as RequestsState;
  const show = (state: RequestsState) => render(
    <RequestsContext.Provider value={state}><ol><ComingSongs afterSongId={2} /></ol></RequestsContext.Provider>,
  );

  it('says they all come together, and that none of it can play until then', () => {
    show(value());
    expect(screen.getByText('Wanted is on its way, with a bridge')).toBeInTheDocument();
    expect(screen.getByText('These 2 songs join together once all 3 transitions are ready. None of them can play before that.')).toBeInTheDocument();
  });

  it('counts down how much of it is ready', () => {
    show(value());
    expect(screen.getByRole('status')).toHaveTextContent('1 of 3 ready · about 2 minutes');
  });

  it('has one way to cancel the lot, and nothing that plays', () => {
    show(value());
    expect(screen.getAllByRole('button', { name: /Cancel request/ })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: /^Play/ })).toBeNull();
    expect(screen.getAllByText('Not playable yet')).toHaveLength(2);
  });

  it('puts everything in it inside the one block', () => {
    const { container } = show(value());
    expect(container.querySelectorAll('.coming-group')).toHaveLength(1);
    expect(container.querySelectorAll('.coming-group .coming-rows > li')).toHaveLength(5);
  });

  it('says when it’s joining', () => {
    show(value({ stage: 'ready' }));
    expect(screen.getByRole('status')).toHaveTextContent('Joining now');
  });

  it('words a single song differently', () => {
    show(value({ route: undefined, transitions: three.slice(0, 2) }));
    expect(screen.getByText('Wanted is on its way')).toBeInTheDocument();
    expect(screen.getByText('It joins your mix once both transitions are ready. It can’t play before that.')).toBeInTheDocument();
  });
});

describe('rechecking whenever anything changes', () => {
  const considered = (calls: { path: string }[]) => calls.filter((call) => call.path === '/requests/consider').length;
  const backend = () => fakeBackend({
    'GET /requests': { requests: [row()] },
    'POST /requests/consider': { requests: [row({ stage: 'searching' })] },
  });

  it('as soon as the track changes', async () => {
    const calls = backend();
    const playback = playing(songs(undefined, undefined, undefined));
    const { rerender } = render(<Requests playback={playback} />);
    await waitFor(() => expect(considered(calls)).toBe(1));
    (playback.player.state as { position: number }).position = 1;
    rerender(<Requests playback={{ ...playback }} />);
    await waitFor(() => expect(considered(calls)).toBe(2));
  });

  it('as soon as the mix is edited', async () => {
    const calls = backend();
    const playback = playing(songs(undefined, undefined, undefined));
    const { rerender } = render(<Requests playback={playback} />);
    await waitFor(() => expect(considered(calls)).toBe(1));
    rerender(<Requests playback={{ ...playback, mix: songs(undefined, undefined) }} />);
    await waitFor(() => expect(considered(calls)).toBe(2));
  });

  it('as soon as a transition is changed, even with the same songs', async () => {
    const calls = backend();
    const playback = playing(songs(undefined, undefined, undefined));
    const { rerender } = render(<Requests playback={playback} />);
    await waitFor(() => expect(considered(calls)).toBe(1));
    rerender(<Requests playback={{ ...playback, mix: songs(seam('none', 'x'), undefined, undefined) }} />);
    await waitFor(() => expect(considered(calls)).toBe(2));
  });

  it('as soon as a transition has finished playing', async () => {
    const calls = backend();
    const playback = playing(songs(undefined, undefined, undefined));
    (playback.player.state as { inSeam: boolean }).inSeam = true;
    const { rerender } = render(<Requests playback={playback} />);
    await waitFor(() => expect(calls.some((call) => call.path === '/requests')).toBe(true));
    expect(considered(calls)).toBe(0);
    (playback.player.state as { inSeam: boolean }).inSeam = false;
    rerender(<Requests playback={{ ...playback }} />);
    await waitFor(() => expect(considered(calls)).toBe(1));
  });

  it('but not when nothing has changed', async () => {
    const calls = backend();
    const playback = playing(songs(undefined, undefined, undefined));
    const { rerender } = render(<Requests playback={playback} />);
    await waitFor(() => expect(considered(calls)).toBe(1));
    rerender(<Requests playback={{ ...playback }} />);
    await act(async () => { await new Promise((done) => setTimeout(done, 30)); });
    expect(considered(calls)).toBe(1);
  });

  it('looks again if something changed while it was already looking', async () => {
    let finish: (value: Response) => void = () => {};
    let asked = 0;
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      if (!url.includes('consider')) return Promise.resolve(new Response(JSON.stringify({ requests: [row()] }), { status: 200 }));
      asked += 1;
      return asked === 1
        ? new Promise<Response>((resolve) => { finish = resolve; })
        : Promise.resolve(new Response(JSON.stringify({ requests: [] }), { status: 200 }));
    }));
    const playback = playing(songs(undefined, undefined, undefined));
    const { rerender } = render(<Requests playback={playback} />);
    await waitFor(() => expect(asked).toBe(1));
    (playback.player.state as { position: number }).position = 1;
    rerender(<Requests playback={{ ...playback }} />);
    expect(asked).toBe(1);
    await act(async () => { finish(new Response(JSON.stringify({ requests: [row()] }), { status: 200 })); });
    await waitFor(() => expect(asked).toBe(2));
  });

  it('straight after someone presses something', async () => {
    const calls = fakeBackend({
      'GET /requests': { requests: [row({ stage: 'approve' })] },
      'POST /requests/consider': { requests: [row({ stage: 'approve', route: [{ id: 8, title: 'Bridge' }, { id: 9, title: 'Wanted' }] })] },
      'POST /requests/7/bridge': { requests: [row()] },
    });
    render(<Requests playback={playing(songs(undefined, undefined, undefined))} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Add both' }));
    await waitFor(() => expect(considered(calls)).toBeGreaterThanOrEqual(2));
  });

  it('says so when a request was settled by the song going in by hand', async () => {
    const notify = vi.fn();
    fakeBackend({
      'GET /requests': { requests: [row()] },
      'POST /requests/consider': { requests: [], settled: ['Wanted'] },
    });
    render(<Requests playback={playing(songs(undefined, undefined))} notify={notify} />);
    await waitFor(() => expect(notify).toHaveBeenCalledWith('Wanted is in your mix now, so that request is done.'));
  });
});

describe('finding a bridge for a request', () => {
  const option = (more: Record<string, unknown> = {}) => ({
    best: true,
    songs: [{ id: 8, title: 'Bridge', artist: 'Someone', bridge: true }, { id: 9, title: 'Wanted', artist: 'Artist', bridge: false }],
    song_ids: [8, 9],
    after_id: 2,
    after: 'Song 2',
    before: 'Song 3',
    words: 'Tempo barely moves, keys match. 120 → 121 → 120 BPM.',
    transitions: [{ from: 'Song 2', to: 'Bridge', key: 'a', status: 'none', label: 'Blend' }],
    ...more,
  });
  const open = async (answer: unknown, stage: Record<string, unknown> = { stage: 'searching' }) => {
    const calls = fakeBackend({
      'GET /requests': { requests: [row(stage)] },
      'POST /requests/consider': { requests: [row(stage)] },
      'POST /requests/7/bridges': answer,
      'POST /requests/7/bridge': { requests: [row({ picked: [8, 9] })] },
      'POST /requests/7/hear': { seams: [] },
    });
    render(<Requests playback={playing(songs(undefined, undefined, undefined))} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Find a bridge' }));
    return calls;
  };

  it('says it’s looking from the moment it’s pressed', async () => {
    await open({ options: [], looked_at: 5, direct: false });
    expect(screen.getByText(/Going through every song in your library/)).toBeInTheDocument();
    expect(await screen.findByText(/Checked 5 songs/)).toBeInTheDocument();
  });

  it('shows the best first, how it gets there, and why', async () => {
    await open({ options: [option(), option({ best: false, song_ids: [7, 9], songs: [{ id: 7, title: 'Other', bridge: true }, { id: 9, title: 'Wanted', bridge: false }] })], looked_at: 581, direct: false });
    const list = await screen.findByRole('list', { name: 'Bridges to Wanted' });
    expect(within(list).getAllByRole('listitem')[0]).toHaveTextContent('Best match');
    expect(within(list).getAllByRole('listitem')[0]).toHaveTextContent('Song 2 → Bridge → Wanted → Song 3');
    expect(within(list).getAllByRole('listitem')[1]).not.toHaveTextContent('Best match');
    expect(screen.getByText(/Checked 581 songs/)).toBeInTheDocument();
    expect(screen.getAllByText(/Tempo barely moves/)).toHaveLength(2);
  });

  it('changes nothing until one is chosen', async () => {
    const calls = await open({ options: [option()], looked_at: 5, direct: false });
    await screen.findByRole('button', { name: 'Use this' });
    expect(calls.some((call) => call.path === '/requests/7/bridge')).toBe(false);
  });

  it('choosing one saves those exact songs, and closes straight away', async () => {
    const calls = await open({ options: [option()], looked_at: 5, direct: false });
    fireEvent.click(await screen.findByRole('button', { name: 'Use this' }));
    expect(screen.queryByRole('list', { name: 'Bridges to Wanted' })).toBeNull();
    expect(screen.getByText('Getting it ready')).toBeInTheDocument();
    await waitFor(() => expect(calls.find((call) => call.path === '/requests/7/bridge')?.body).toEqual({ allow: true, songs: [8, 9] }));
  });

  it('can be heard first, only rendering the one that’s asked for', async () => {
    const calls = await open({ options: [option()], looked_at: 5, direct: false });
    fireEvent.click(await screen.findByRole('button', { name: 'Hear the transitions' }));
    fireEvent.click(screen.getByRole('button', { name: 'Hear Song 2 into Bridge' }));
    await waitFor(() => expect(calls.find((call) => call.path === '/requests/7/hear')?.body).toEqual({ keys: ['a'] }));
  });

  it('says so when no song can do it', async () => {
    await open({ options: [], looked_at: 581, direct: false });
    expect(await screen.findByText(/No song makes a clean way there/)).toBeInTheDocument();
  });

  it('says why when the song’s beat is the problem', async () => {
    await open({ options: [], looked_at: 581, direct: false, unsteady: true });
    expect(await screen.findByText(/can’t find a steady enough beat/)).toBeInTheDocument();
  });

  it('says when it takes more than one song', async () => {
    await open({
      options: [option({
        song_ids: [6, 8, 9],
        songs: [{ id: 6, title: 'First', bridge: true }, { id: 8, title: 'Bridge', bridge: true }, { id: 9, title: 'Wanted', bridge: false }],
      })],
      looked_at: 5,
      direct: false,
    });
    expect(await screen.findByText('two extra songs on the way')).toBeInTheDocument();
    expect(screen.getByText('First and Bridge')).toBeInTheDocument();
  });

  it('says so when a bridge isn’t needed', async () => {
    await open({ options: [option()], looked_at: 5, direct: true }, { stage: 'preparing', after: 'Song 2', after_id: 2 });
    expect(await screen.findByText(/It can already go in without a bridge/)).toBeInTheDocument();
  });

  it('says what went wrong if the search fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/bridges')) return new Response(JSON.stringify({ detail: 'Start a mix first.' }), { status: 409 });
      return new Response(JSON.stringify({ requests: [row({ stage: 'searching' })] }), { status: 200 });
    }));
    render(<Requests playback={playing(songs(undefined, undefined, undefined))} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Find a bridge' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Start a mix first.');
  });

  it('is there on every request it could help', async () => {
    fakeBackend({
      'GET /requests': { requests: [row({ id: 1, stage: 'searching' }), row({ id: 2, song_id: 10, stage: 'preparing' }), row({ id: 3, song_id: 11, stage: 'approve' })] },
      'POST /requests/consider': { requests: [row({ id: 1, stage: 'searching' }), row({ id: 2, song_id: 10, stage: 'preparing' }), row({ id: 3, song_id: 11, stage: 'approve' })] },
    });
    render(<Requests playback={playing(songs(undefined, undefined, undefined))} />);
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Find a bridge' })).toHaveLength(2));
    expect(screen.getByRole('button', { name: 'See other bridges' })).toBeInTheDocument();
  });

  it('isn’t offered where it can’t work', async () => {
    fakeBackend({
      'GET /requests': { requests: [row({ waiting_on: 'analysis' }), row({ id: 8, song_id: 10, no_cues: true }), row({ id: 3, song_id: 11, never: true })] },
      'POST /requests/consider': { requests: [row({ waiting_on: 'analysis' }), row({ id: 8, song_id: 10, no_cues: true }), row({ id: 3, song_id: 11, never: true })] },
    });
    render(<Requests playback={playing(songs(undefined, undefined, undefined))} />);
    await screen.findByText('Analysing');
    expect(screen.queryByRole('button', { name: 'Find a bridge' })).toBeNull();
  });

  it('offers a different one when it already has one', async () => {
    const route = [{ id: 8, title: 'Bridge' }, { id: 9, title: 'Wanted' }];
    fakeBackend({
      'GET /requests': { requests: [row({ stage: 'preparing', route })] },
      'POST /requests/consider': { requests: [row({ stage: 'preparing', route })] },
    });
    render(<Requests playback={playing(songs(undefined, undefined, undefined))} />);
    expect(await screen.findByRole('button', { name: 'Find a different bridge' })).toBeInTheDocument();
  });

  it('a song on its way as a bridge can’t be requested as well', async () => {
    fakeBackend({
      'GET /requests': { requests: [row({ picked: [8, 9] })] },
      'GET /songs': [found(8, 'Bridge')],
    });
    render(<Requests />);
    await screen.findByText('Wanted');
    fireEvent.change(search(), { target: { value: 'bridge' } });
    expect(await screen.findByRole('button', { name: /Bridge .*Coming as a bridge/ })).toBeDisabled();
  });
});

describe('words for what a request is waiting on', () => {
  it('names the request it’s waiting behind', () => {
    const words = requestWords(row({ behind: 'Other Song' }) as never, 'searching');
    expect(words.detail).toBe('It would go in the same spot as Other Song, so it’s waiting for that to join first. Then it finds its own.');
  });

  it('says when a chosen bridge stopped working', () => {
    expect(requestWords(row({ bridge_lost: true }) as never, 'searching').detail).toMatch(/stopped fitting/);
    expect(requestWords(row({ bridge_lost: true, route: [{ id: 8, title: 'New' }, { id: 9, title: 'Wanted' }] }) as never, 'approve').detail)
      .toBe('The bridge you chose stopped fitting. Getting to it takes one extra song: New.');
  });

  it('counts two extra songs', () => {
    const route = [{ id: 7, title: 'One' }, { id: 8, title: 'Two' }, { id: 9, title: 'Wanted' }];
    expect(requestWords(row({ route }) as never, 'approve').detail).toBe('Getting to it takes two extra songs: One and Two.');
  });

  it('counts three as well', () => {
    const route = [{ id: 6, title: 'A' }, { id: 7, title: 'B' }, { id: 9, title: 'Wanted' }, { id: 8, title: 'C' }];
    expect(requestWords(row({ route }) as never, 'approve').detail).toBe('Getting to it takes three extra songs: A and B and C.');
  });

  it('tells a bridge leading out from one leading in', () => {
    const route = [{ id: 9, title: 'Wanted' }, { id: 8, title: 'After' }];
    expect(requestWords(row({ route, after: 'Song 2' }) as never, 'preparing').detail).toMatch(/^Joins after Song 2, with After leading out\./);
  });

  it('says a bridge won’t play before it’s all ready', () => {
    const route = [{ id: 8, title: 'Bridge' }, { id: 9, title: 'Wanted' }];
    expect(requestWords(row({ route, after: 'Song 2' }) as never, 'preparing').detail).toMatch(/none of them can play before that/);
  });
});
