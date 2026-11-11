import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { VibeCard } from '../api';
import { SetPlayer } from '../player';
import { fakeBackend, songs, status } from '../test/backend';
import { Mixes } from './Mixes';

const card = (key: string, name: string, group: string, more: Partial<VibeCard> = {}): VibeCard => ({
  key,
  name,
  group,
  family: null,
  blurb: `${name} words`,
  songs: 40,
  ready: true,
  needs: 0,
  artists: ['Someone', 'Someone Else'],
  tempo: [100, 124],
  moves: 'Vocal rides and long blends',
  seconds: 3900,
  ...more,
});

function show(energyArc: number[] | null = null) {
  const player = new SetPlayer(() => [], () => {});
  const initialStatus = status();
  render(
    <Mixes
      status={{
        ...initialStatus,
        steering: { ...initialStatus.steering, energy_arc: energyArc },
      }}
      mix={[]}
      mixName=""
      canUndo={false}
      refreshMix={() => {}}
      setMixData={() => {}}
      refreshStatus={() => {}}
      player={player}
      now={player.state}
      setView={() => {}}
      notify={() => {}}
      stage={false}
      toggleStage={() => {}}
    />,
  );
}

describe('distinct visual mix ideas', () => {
  it('uses different decorative motifs for different ideas even within the same group', async () => {
    fakeBackend({ 'GET /vibes': [
      card('pick', 'Selecta’s pick', ''),
      card('evening-drive', 'Evening drive', 'The moment'),
      card('quiet-morning', 'Quiet morning', 'The moment'),
    ] });
    show();
    await screen.findByText('Evening drive');
    const first = document.querySelector('[data-vibe="evening-drive"] .vibe-motif');
    const second = document.querySelector('[data-vibe="quiet-morning"] .vibe-motif');
    expect(first).toBeInTheDocument();
    expect(second).toBeInTheDocument();
    expect(first?.innerHTML).not.toBe(second?.innerHTML);
    expect(first).toHaveAttribute('aria-hidden', 'true');
    expect(second).toHaveAttribute('aria-hidden', 'true');
  });
});

describe('Pick a feeling', () => {
  it('does not misreport zero mix-ready songs when an older server omits that count', async () => {
    fakeBackend({ 'GET /vibes': [] });
    const oldServerStatus = status();
    const counts = { ...oldServerStatus.counts };
    delete counts.ready;
    const player = new SetPlayer(() => [], () => {});
    render(
      <Mixes
        status={{ ...oldServerStatus, counts }}
        mix={[]}
        mixName=""
        canUndo={false}
        refreshMix={() => {}}
        setMixData={() => {}}
        refreshStatus={() => {}}
        player={player}
        now={player.state}
        setView={() => {}}
        notify={() => {}}
        stage={false}
        toggleStage={() => {}}
      />,
    );
    expect(
      await screen.findByText(/hasn’t reported how many songs have the cues needed for mixes/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/0 of 90 songs have the vocal or instrumental cues needed/)).not.toBeInTheDocument();
  });

  it('waits for six mix-ready songs even when audio analysis has finished on more', async () => {
    fakeBackend({ 'GET /vibes': [] });
    const player = new SetPlayer(() => [], () => {});
    render(
      <Mixes
        status={status({ counts: { ...status().counts, analysed: 20, ready: 2 } })}
        mix={[]}
        mixName=""
        canUndo={false}
        refreshMix={() => {}}
        setMixData={() => {}}
        refreshStatus={() => {}}
        player={player}
        now={player.state}
        setView={() => {}}
        notify={() => {}}
        stage={false}
        toggleStage={() => {}}
      />,
    );
    expect(await screen.findByText(/2 of 90 songs have the vocal or instrumental cues needed/)).toBeInTheDocument();
  });

  it('lets the listener choose the transition feel and saves it for future mixes', async () => {
    const calls = fakeBackend({
      'GET /vibes': [card('pick', 'Selecta’s pick', '')],
      'POST /steer': { mix_language: 'seamless' },
    });
    show();
    fireEvent.click(await screen.findByRole('button', { name: /^Customize: Shape this mix/ }));
    const select = await screen.findByLabelText('Transition feel');
    fireEvent.change(select, { target: { value: 'seamless' } });
    expect(await screen.findByRole('combobox', { name: 'Transition feel' })).toHaveValue('seamless');
    expect(calls.some((call) => call.method === 'POST' && call.path === '/steer' && (call.body as { value?: string }).value === 'seamless')).toBe(true);
  });

  it('serializes rapidly changed feel settings so the last selection wins on the server', async () => {
    const sent: string[] = [];
    let finishFirst: () => void = () => {};
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('/vibes')) return new Response(JSON.stringify([card('pick', 'Selecta’s pick', '')]), { status: 200 });
      if (url.includes('/steer') && init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as { value: string };
        sent.push(body.value);
        if (body.value === 'seamless') await new Promise<void>((done) => { finishFirst = done; });
        return new Response(JSON.stringify({ mix_language: body.value }), { status: 200 });
      }
      return new Response('{}', { status: 200 });
    }));
    show();
    fireEvent.click(await screen.findByRole('button', { name: /^Customize: Shape this mix/ }));
    const select = await screen.findByLabelText('Transition feel');
    fireEvent.change(select, { target: { value: 'seamless' } });
    await waitFor(() => expect(sent).toEqual(['seamless']));
    fireEvent.change(select, { target: { value: 'punchy' } });
    expect(select).toHaveValue('punchy');
    expect(sent).toEqual(['seamless']);
    finishFirst();
    await waitFor(() => expect(sent).toEqual(['seamless', 'punchy']));
    expect(select).toHaveValue('punchy');
  });

  it('lets the listener set how often new mixes use stem-assisted moves', async () => {
    const calls = fakeBackend({
      'GET /vibes': [card('pick', 'Selecta’s pick', '')],
      'POST /steer': { mix_language: 'balanced', stems: 'often', target: null },
    });
    show();
    fireEvent.click(await screen.findByRole('button', { name: /^Customize: Shape this mix/ }));
    fireEvent.change(await screen.findByLabelText('Stem-assisted moves'), { target: { value: 'often' } });
    expect(await screen.findByLabelText('Stem-assisted moves')).toHaveValue('often');
    expect(calls.some((call) => call.method === 'POST' && call.path === '/steer' && (call.body as { action?: string; value?: string }).action === 'stems' && (call.body as { value?: string }).value === 'often')).toBe(true);
  });

  it('lets the listener shape and save a five-stop energy arc', async () => {
    const calls = fakeBackend({
      'GET /vibes': [card('pick', 'Selecta’s pick', '')],
      'POST /steer': { energy_arc: [62, 72, 35, 85, 68] },
    });
    show();
    fireEvent.click(await screen.findByRole('button', { name: /^Customize: Shape this mix/ }));
    const middle = await screen.findByRole('slider', { name: 'Energy arc middle' });
    fireEvent.change(middle, { target: { value: '35' } });
    expect(middle).toHaveValue('35');
    await waitFor(() => {
      expect(
        calls.some(
          (call) =>
            call.method === 'POST' &&
            call.path === '/steer' &&
            (call.body as { action?: string; value?: number[] }).action === 'energy_arc' &&
            JSON.stringify((call.body as { value?: number[] }).value) ===
              JSON.stringify([62, 72, 35, 85, 68]),
        ),
      ).toBe(true);
    });
    const drawing = screen.getByRole('img', { name: 'Draw energy arc' });
    Object.defineProperty(drawing, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, width: 100, height: 40 }),
    });
    fireEvent.pointerDown(drawing, { clientX: 50, clientY: 4, pointerId: 1, pointerType: 'touch', isPrimary: true, button: 0 });
    expect(middle).toHaveValue('100');
    await waitFor(() => {
      expect(
        calls.some(
          (call) =>
            call.method === 'POST' &&
            call.path === '/steer' &&
            JSON.stringify((call.body as { value?: number[] }).value) ===
              JSON.stringify([62, 72, 100, 85, 68]),
        ),
      ).toBe(true);
    });
    expect(screen.getByRole('button', { name: 'Use each mix’s arc' })).toBeEnabled();
  });

  it('clears a saved energy arc back to the mix-specific default', async () => {
    const calls = fakeBackend({
      'GET /vibes': [card('pick', 'Selecta’s pick', '')],
      'POST /steer': { energy_arc: null },
    });
    show([20, 40, 80, 60, 30]);
    fireEvent.click(await screen.findByRole('button', { name: /^Customize: Shape this mix/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Use each mix’s arc' }));
    await waitFor(() => {
      expect(
        calls.some(
          (call) =>
            call.method === 'POST' &&
            call.path === '/steer' &&
            (call.body as { action?: string }).action === 'energy_arc' &&
            (call.body as { value?: number[] | null }).value === null,
        ),
      ).toBe(true);
    });
  });

  it('does not claim an energy shape was saved when clearing the shape fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('/vibes')) return new Response(JSON.stringify([card('pick', 'Selecta’s pick', '')]), { status: 200 });
      if (url.includes('/steer') && init?.method === 'POST') {
        return new Response(JSON.stringify({ detail: 'Could not save preferences' }), { status: 500 });
      }
      return new Response('{}', { status: 200 });
    }));
    show([20, 40, 80, 60, 30]);
    fireEvent.click(await screen.findByRole('button', { name: /^Customize: Shape this mix/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Use each mix’s arc' }));
    expect(await screen.findByRole('button', { name: 'Try saving the shape again' })).toBeEnabled();
    expect(screen.getByText(/Your change was not saved/)).toBeInTheDocument();
    expect(screen.queryByText('Each mix uses its own shape.')).toBeNull();
  });

  it('lets the listener set a song as the destination for future mixes', async () => {
    const calls = fakeBackend({
      'GET /vibes': [card('pick', 'Selecta’s pick', '')],
      'GET /songs': [
        { id: 7, artist: 'Example Artist', title: 'Midnight', genre: 'pop', duration: 200, bpm: 120, camelot: '8A', lyric_status: 'synced', never: false, priority: false },
        { id: 8, artist: 'Unready Artist', title: 'No Cues', genre: 'pop', duration: 200, bpm: 120, camelot: '8A', lyric_status: null, never: false, priority: false },
      ],
      'POST /steer': { mix_language: 'balanced', target: '7' },
    });
    show();
    fireEvent.click(await screen.findByRole('button', { name: /^Customize: Shape this mix/ }));
    fireEvent.change(await screen.findByLabelText('Take me to'), { target: { value: 'midnight' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Midnight - Example Artist' }));
    expect(await screen.findByText('Midnight - Example Artist')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'No Cues - Unready Artist' })).toBeNull();
    expect(calls.some((call) => call.method === 'POST' && call.path === '/steer' && (call.body as { action?: string; value?: string }).action === 'take_me_to' && (call.body as { value?: string }).value === '7')).toBe(true);
  });

  it('groups mixes by why you’d press them', async () => {
    fakeBackend({
      'GET /vibes': [
        card('pick', 'Selecta’s pick', ''),
        card('peak', 'Peak time', 'The moment'),
        card('feelings', 'In your feelings', 'The mood'),
        card('afro_heat', 'Afro heat', 'The sound'),
        card('slow_burn', 'Slow burn', 'The journey'),
      ],
    });
    show();
    const moment = (await screen.findByRole('heading', { name: 'The moment' })).parentElement!;
    expect(within(moment).getByRole('heading', { name: 'Peak time' })).toBeInTheDocument();
    expect(within(moment).queryByRole('heading', { name: 'In your feelings' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'The mood' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'The sound' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'The journey' })).toBeInTheDocument();
  });

  it('says what’s inside each one, from the songs that would really play', async () => {
    fakeBackend({ 'GET /vibes': [card('peak', 'Peak time', 'The moment')] });
    show();
    const heading = await screen.findByRole('heading', { name: 'Peak time' });
    const inside = within(heading.closest('article')!);
    expect(inside.getByText('Someone, Someone Else')).toBeInTheDocument();
    expect(inside.getByText(/100–124 BPM/)).toBeInTheDocument();
    expect(inside.getByText(/Vocal rides and long blends/)).toBeInTheDocument();
    expect(inside.getByText('40 matching songs')).toBeInTheDocument();
    expect(inside.getByText('About 1 hr 5 min of matching source songs')).toBeInTheDocument();
    expect(inside.getByRole('button', { name: 'Shape first' })).toBeEnabled();
  });

  it('shows and filters truthful family-specific candidates', async () => {
    fakeBackend({
      'GET /vibes': [
        card('peak', 'Peak time', 'The moment'),
        card('slow_burn__afro', 'Afrobeats & amapiano · Slow burn', 'The journey', { family: 'Afrobeats & amapiano' }),
      ],
    });
    show();
    const candidate = await screen.findByRole('heading', { name: 'Afrobeats & amapiano · Slow burn' });
    expect(within(candidate.closest('article')!).getByText('Stays within Afrobeats & amapiano')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'The journey' }));
    expect(screen.queryByRole('heading', { name: 'Peak time' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Afrobeats & amapiano · Slow burn' })).toBeInTheDocument();
  });

  it('keeps Christmas off the waiting list until there are enough songs for it', async () => {
    fakeBackend({
      'GET /vibes': [
        card('peak', 'Peak time', 'The moment'),
        card('christmas', 'Christmas', 'The sound', { ready: false, needs: 2 }),
        card('workout', 'Workout', 'The moment', { ready: false, needs: 3 }),
      ],
    });
    show();
    expect(await screen.findByText('needs 3 more')).toBeInTheDocument();
    expect(screen.queryByText('Christmas')).toBeNull();
  });
});

describe('a feeling kept as a draft', () => {
  it('builds it without touching what’s playing', async () => {
    const calls = fakeBackend({
      'GET /vibes': [card('peak', 'Peak time', 'The moment')],
      'POST /vibes/peak/build': { id: 4, name: 'Peak time', count: 12 },
      'GET /drafts': { drafts: [], current: { name: 'Current', songs: 3, left: 0, eta: { seconds: 0, low: 0, high: 0 } }, out_of_room: false },
    });
    const notify = vi.fn();
    const setMixData = vi.fn();
    const player = new SetPlayer(() => [], () => {});
    render(
      <Mixes
        status={status()}
        mix={[]}
        mixName=""
        canUndo={false}
        refreshMix={() => {}}
        setMixData={setMixData}
        refreshStatus={() => {}}
        player={player}
        now={player.state}
        setView={() => {}}
        notify={notify}
        stage={false}
        toggleStage={() => {}}
      />,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Save draft for Peak time' }));
    await waitFor(() => expect(notify).toHaveBeenCalled());
    expect(calls.find((call) => call.method === 'POST')?.path).toContain('as_draft=true');
    expect(setMixData).not.toHaveBeenCalled();
    expect(notify.mock.calls[0][0]).toContain('Your current playback was not changed');
  });
});

describe('browsing and my mixes', () => {
  it('browsing says roughly how long, because that’s all it can promise', async () => {
    fakeBackend({ 'GET /vibes': [card('pick', 'Selecta’s pick', '')] });
    show();
    expect(await screen.findByRole('button', { name: 'About 30 min' })).toBeInTheDocument();
    expect(screen.getByText(/How long it really runs depends/)).toBeInTheDocument();
  });

  it('how mixes get built stays out of the way until it’s wanted, and says it’s for new mixes', async () => {
    fakeBackend({ 'GET /vibes': [card('pick', 'Selecta’s pick', '')] });
    show();
    await screen.findByRole('button', { name: /^Customize: Shape this mix/ });
    expect(screen.queryByLabelText('Transition feel')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^Customize: Shape this mix/ }));
    expect(screen.getByText(/They don’t change a mix you’ve already got/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Done shaping' }));
    expect(screen.queryByLabelText('Transition feel')).toBeNull();
  });

  it('says why a preset can’t be played yet', async () => {
    fakeBackend({ 'GET /vibes': [card('pick', 'Selecta’s pick', ''), { ...card('rap', 'Rap run', ''), ready: false, needs: 4, group: 'The sound' }] });
    show();
    expect(await screen.findByText('needs 4 more')).toBeInTheDocument();
    expect(screen.getByText(/mix-ready songs/)).toBeInTheDocument();
  });
});

describe('safe activation from Explore', () => {
  it('keeps the active mix until confirmation and guards the mix seen when Play was chosen', async () => {
    const calls = fakeBackend({
      'GET /vibes': [card('peak', 'Peak time', 'The moment')],
      'POST /vibes/peak/build': { mix: songs(), name: 'Peak time', can_undo: true },
    });
    const setMixData = vi.fn();
    const player = new SetPlayer(() => [], () => {});
    const playing = { ...player.state, phase: 'paused' as const };
    vi.spyOn(player, 'playFrom').mockResolvedValue(undefined);
    render(
      <Mixes
        status={status()}
        mix={songs()}
        mixName="Current"
        canUndo={false}
        refreshMix={() => {}}
        setMixData={setMixData}
        refreshStatus={() => {}}
        player={player}
        now={playing}
        setView={() => {}}
        notify={() => {}}
        stage={false}
        toggleStage={() => {}}
      />,
    );
    const choice = within((await screen.findByRole('heading', { name: 'Peak time' })).closest('article')!);
    fireEvent.click(choice.getByRole('button', { name: 'Play' }));
    expect(screen.getByRole('dialog', { name: 'Replace Current?' })).toBeInTheDocument();
    expect(calls.some((call) => call.path.includes('/vibes/peak/build'))).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(setMixData).not.toHaveBeenCalled();
    // The previous Action's in-flight flag clears on the next microtask.
    await waitFor(() => expect(choice.getByRole('button', { name: 'Play' })).toBeEnabled());
    fireEvent.click(choice.getByRole('button', { name: 'Play' }));
    fireEvent.click(screen.getByRole('button', { name: 'Replace and play' }));
    await waitFor(() => expect(setMixData).toHaveBeenCalledOnce());
    expect(vi.mocked(fetch)).toHaveBeenCalledWith('/api/vibes/peak/build?count=12', expect.objectContaining({
      headers: expect.objectContaining({
        'x-mix-order': '1',
        'x-operation-id': expect.stringMatching(/^build-/),
      }),
    }));
  });
});


describe('compact Explore comparison and optional detail', () => {
  it('keeps real comparison facts and all three consequences visible while disclosing the longer explanation by intent', async () => {
    fakeBackend({ 'GET /vibes': [card('peak', 'Peak time', 'The moment')] });
    show();
    const heading = await screen.findByRole('heading', { name: 'Peak time' });
    const article = within(heading.closest('article')!);
    expect(article.getByText('40 matching songs')).toBeVisible();
    expect(article.getByRole('button', { name: 'Play' })).toBeVisible();
    expect(article.getByRole('button', { name: 'Shape first' })).toBeVisible();
    expect(article.getByRole('button', { name: 'Save draft for Peak time' })).toBeVisible();
    const disclosure = article.getByText('Why Peak time? More details').closest('details');
    expect(disclosure).not.toHaveAttribute('open');
    fireEvent.click(article.getByText('Why Peak time? More details'));
    expect(disclosure).toHaveAttribute('open');
    expect(article.getByText(/Planning preference, not a promised song order/)).toBeVisible();
    expect(article.getByText('Someone, Someone Else')).toBeVisible();
    expect(article.getByText('Vocal rides and long blends')).toBeVisible();
  });
});

describe('Quick Play and optional Lucy creation', () => {
  it('shows two distinct choices while keeping Quick Play independent of Lucy', async () => {
    const calls = fakeBackend({ 'GET /vibes': [card('pick', 'Selecta’s pick', '')] });
    show();
    const quick = screen.getByRole('region', { name: 'Listen now, shape later' });
    const lucy = screen.getByRole('region', { name: 'Create with Lucy' });
    await waitFor(() => expect(within(quick).getByRole('button', { name: 'Play' })).toBeEnabled());
    expect(within(lucy).getByRole('link', { name: 'Plan a mix with Lucy' })).toHaveAttribute('href', '/mixes/lucy');
    await screen.findByText('Selecta’s pick');
    expect(calls.every((call) => call.method === 'GET')).toBe(true);
  });

  it('offers a feeling-specific, editable Lucy prompt without sending it', async () => {
    const calls = fakeBackend({ 'GET /vibes': [
      card('pick', 'Selecta’s pick', ''),
      card('peak', 'Peak time', 'The moment'),
    ] });
    show();
    const heading = await screen.findByRole('heading', { name: 'Peak time' });
    const article = within(heading.closest('article')!);
    fireEvent.click(article.getByText('Why Peak time? More details'));
    const link = article.getByRole('link', { name: 'Use this feeling with Lucy' });
    const destination = new URL(link.getAttribute('href')!, 'http://localhost');
    expect(destination.pathname).toBe('/mixes/lucy');
    expect(destination.searchParams.get('prompt')).toContain('Peak time feeling');
    expect(calls.some((call) => call.path.includes('/lucy/') || call.method === 'POST')).toBe(false);
  });
});

// S3-0054-07: a slower answer to an older destination search can never replace the newer one
describe('destination search', () => {
  it('ignores an older answer that arrives after the newer search, and can be cleared', async () => {
    const row = (id: number, title: string) => ({ id, artist: 'Example Artist', title, genre: 'pop', duration: 200, bpm: 120, camelot: '8A', lyric_status: 'synced', never: false, priority: false });
    fakeBackend({ 'GET /vibes': [card('pick', 'Selecta’s pick', '')], 'POST /steer': { mix_language: 'balanced', target: null } });
    const stubbed = globalThis.fetch;
    let releaseOld: (() => void) | null = null;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('/songs?q=mi&')) {
        await new Promise<void>((done) => { releaseOld = done; });
        return new Response(JSON.stringify([row(1, 'Old Answer')]), { status: 200 });
      }
      if (url.includes('/songs?q=midnight&')) return new Response(JSON.stringify([row(7, 'Midnight')]), { status: 200 });
      return stubbed(url, init);
    }));
    show();
    fireEvent.click(await screen.findByRole('button', { name: /^Customize:/ }));
    const box = await screen.findByLabelText('Take me to');
    fireEvent.change(box, { target: { value: 'mi' } });
    await waitFor(() => expect(releaseOld).not.toBeNull());
    fireEvent.change(box, { target: { value: 'midnight' } });
    expect(await screen.findByRole('button', { name: 'Midnight - Example Artist' })).toBeInTheDocument();
    releaseOld!();
    await new Promise((done) => setTimeout(done, 50));
    expect(screen.queryByRole('button', { name: 'Old Answer - Example Artist' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Midnight - Example Artist' })).toBeInTheDocument();
    fireEvent.change(box, { target: { value: '' } });
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Midnight - Example Artist' })).toBeNull());
  });
});
