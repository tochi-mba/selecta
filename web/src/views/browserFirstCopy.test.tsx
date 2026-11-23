import { render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MixesEmpty } from '../cloud/LocalFirstEmpty';
import { JOINS_BY_HAND } from '../cloud/localFirstRequests';
import { setFlags } from '../flags';
import { SetPlayer } from '../player';
import { rememberStartedAMix } from './Setup';
import { fakeBackend, songs, status as appStatus } from '../test/backend';
import { GLOSSARY } from '../ui/glossaryTerms';
import { InterfaceChoices } from './InterfaceChoices';
import { Links } from './Links';
import { Mixes } from './Mixes';
import { RequestRow, RequestsContext, RequestsPanel, RequestsState } from './Requests';

// What the shared views say in browser-first Cloud, where nothing is analysed or rendered ahead:
// Word connections, Request a song, Make a Mix's layout, the interface choices and the glossary.

describe('Word connections in the browser', () => {
  const link = { phrase: 'tonight', kind: 'x', a: 1, b: 2, artist_a: 'A', title_a: 'One', artist_b: 'B', title_b: 'Two', line_a: 'all tonight', line_b: 'tonight we go', moves: ['auto'], move: 'auto', state: { status: 'none', key: 'link:1:2', why: 'Worked out in your browser as the mix plays.' }, worked: true };
  const props = (analysisAvailable: boolean) => ({ setMixData: vi.fn(), setView: vi.fn(), notify: vi.fn(), status: appStatus(), mix: [], tab: 'words' as const, analysisAvailable }) as unknown as Parameters<typeof Links>[0];
  const routes = (links: unknown[]) => ({ 'GET /links': { links, prepared: 0, preparing: 0 }, 'GET /drafts': { drafts: [{ id: 7, name: 'Friday' }], current: {}, out_of_room: false } });

  it('says the pairs come from lyrics and are worked out as the mix plays', async () => {
    fakeBackend(routes([link]));
    render(<Links {...props(false)} />);
    await screen.findByRole('button', { name: 'Add both to the mix' });
    const page = screen.getByRole('main');
    expect(page).toHaveTextContent(/another opens a line with them, found from your songs’ lyrics\. Pair two songs and SelectaDJ works out the transition as the mix plays\./);
    expect(page).not.toHaveTextContent(/and the music fits too|prepares the\s+best ones in the background/);
    expect(page).toHaveTextContent('Nothing is rendered ahead here: the shared words are a match to check, and SelectaDJ works the transition out in your browser as the mix plays.');
    expect(page).not.toHaveTextContent(/renders it after they go in/);
  });

  it('shows no render status or render button, because nothing is rendered ahead', async () => {
    fakeBackend(routes([link]));
    const { container } = render(<Links {...props(false)} />);
    await screen.findByRole('button', { name: 'Add both to the mix' });
    expect(container.querySelector('.link-status')).toBeNull();
    expect(screen.queryByRole('button', { name: /Render it now|Rendering|Play it|Try again/ })).toBeNull();
  });

  it('never asks for draft names, so a pair only goes in the current mix', async () => {
    const calls = fakeBackend(routes([link]));
    render(<Links {...props(false)} />);
    await screen.findByRole('button', { name: 'Add both to the mix' });
    expect(calls.some((call) => call.path.startsWith('/drafts'))).toBe(false);
    expect(screen.queryByRole('button', { name: 'Add both to…' })).toBeNull();
  });

  it('says more links come with more lyrics, with no analysis to point at', async () => {
    fakeBackend(routes([]));
    render(<Links {...props(false)} />);
    expect(await screen.findByText(/No links yet\. More appear as lyrics are found for more of your songs\./)).toBeVisible();
    expect(screen.queryByText(/Analysing more songs/)).toBeNull();
    expect(screen.queryByRole('link', { name: 'See analysis progress' })).toBeNull();
  });

  it('keeps local mode’s words, render button and drafts where there is analysis', async () => {
    const calls = fakeBackend(routes([{ ...link, moves: ['word_cut'], move: 'word_cut' }]));
    const { container } = render(<Links {...props(true)} />);
    await screen.findByRole('button', { name: 'Add both to…' });
    expect(screen.getByRole('main')).toHaveTextContent(/and the music fits too\. SelectaDJ prepares the best ones in the background/);
    expect(container.querySelector('.link-status')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Render it now' })).toBeVisible();
    expect(calls.some((call) => call.path.startsWith('/drafts'))).toBe(true);
  });
});

describe('Request a song in the browser', () => {
  const row = (more: Partial<RequestRow> = {}): RequestRow => ({ id: 7, song_id: 9, title: 'Wanted', artist: 'Artist', status: 'waiting', available: 1, ...more });
  const panel = (rows: RequestRow[], phase = 'playing') => {
    const playback = {
      mix: songs(undefined, undefined),
      player: { state: { phase, position: 0, duration: 200, songTime: 20, inSeam: false }, togglePause: vi.fn(async () => {}) } as unknown as SetPlayer,
      onMix: vi.fn(),
    };
    const value = { requests: rows, error: '', message: '', playback, add: vi.fn(), cancel: vi.fn(async () => {}), chooseBridge: vi.fn(), addAnyway: vi.fn(), findBridges: vi.fn(), pickBridge: vi.fn() } as unknown as RequestsState;
    return render(<RequestsContext.Provider value={value}><RequestsPanel /></RequestsContext.Provider>);
  };

  it('says a request waits until you add it, where no planner can find it a spot', () => {
    setFlags({ 'requests.bridges': false });
    fakeBackend({});
    panel([]);
    expect(screen.getByText(/Ask for a song any time\. It waits here until you add it after the song that’s playing\./)).toBeVisible();
    expect(screen.queryByText(/SelectaDJ finds a spot where it fits/)).toBeNull();
  });

  it('keeps the promise of finding a spot where the planner exists', () => {
    fakeBackend({});
    panel([]);
    expect(screen.getByText(/Ask for a song any time\. SelectaDJ finds a spot where it fits, without interrupting the mix\./)).toBeVisible();
  });

  it('tells a waiting request in the browser’s own words while a mix plays', () => {
    setFlags({ 'requests.bridges': false });
    fakeBackend({});
    panel([row({ stage: 'searching', browser_note: JOINS_BY_HAND })]);
    const list = within(screen.getByRole('list', { name: 'Your requests' }));
    expect(list.getByRole('button', { name: /^Add (next|to mix)/ })).toBeInTheDocument();
    expect(list.getByText(JOINS_BY_HAND)).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Your requests' })).not.toHaveTextContent(/looking for a spot|Finding a spot/i);
  });
});

describe('Make a Mix once the account has saved mixes', () => {
  function show(startedAMix?: boolean) {
    fakeBackend({ 'GET /vibes': [{ key: 'pick', name: 'SelectaDJ’s pick', group: '', family: null, blurb: 'Warm songs', songs: 40, ready: true, needs: 0, artists: [], tempo: [100, 124], moves: '', seconds: 3900 }] });
    const player = new SetPlayer(() => [], () => {});
    return render(
      <Mixes
        status={appStatus()} mix={[]} mixName="" canUndo={false}
        refreshMix={() => {}} setMixData={() => {}} refreshStatus={() => {}}
        player={player} now={player.state} setView={() => {}} notify={() => {}}
        stage={false} toggleStage={() => {}} startedAMix={startedAMix}
      />,
    );
  }
  const firstRunNotice = /Your library now has enough ready songs to make a first mix/;

  it('shows the first-run layout on a browser that has never started a mix', async () => {
    show();
    await screen.findByText('SelectaDJ’s pick');
    expect(screen.getByText(firstRunNotice)).toBeVisible();
    expect(screen.queryByText('Quick Play · Tap and play')).toBeNull();
  });

  it('shows the compact layout on a new device when the account already has saved mixes', async () => {
    show(true);
    await screen.findByText('SelectaDJ’s pick');
    expect(screen.queryByText(firstRunNotice)).toBeNull();
    expect(screen.getByText('Quick Play · Tap and play')).toBeVisible();
  });

  it('is not a first run with no saved mixes either, once this browser has started one', async () => {
    rememberStartedAMix();
    show(false);
    await screen.findByText('SelectaDJ’s pick');
    await waitFor(() => expect(screen.queryByText(firstRunNotice)).toBeNull());
    expect(screen.getByText('Quick Play · Tap and play')).toBeVisible();
  });
});

describe('Make a Mix while too few songs can play here', () => {
  it('keeps the current mix card in view above the empty state', () => {
    render(<MixesEmpty connected={5} current={<section aria-label="Current mix">Friday is playing</section>} />);
    const card = screen.getByRole('region', { name: 'Current mix' });
    const empty = screen.getByRole('heading', { name: 'Choose your music again to make a mix' });
    expect(card).toBeVisible();
    expect(card.compareDocumentPosition(empty) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1, name: 'Make a Mix' }).compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('draws nothing extra when there is no current mix', () => {
    render(<MixesEmpty connected={0} />);
    expect(screen.queryByRole('region', { name: 'Current mix' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Mixes start with your music' })).toBeVisible();
  });
});

describe('the interface choices', () => {
  it('offers the older navigation where it has pages to lead to', () => {
    render(<InterfaceChoices />);
    expect(screen.getByRole('heading', { name: 'Interface' })).toBeVisible();
    expect(screen.getByRole('checkbox', { name: /Use the older navigation/ })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /Compact rows/ })).toBeInTheDocument();
  });

  it('leaves the older navigation out in browser-first Cloud, and with its flag off', () => {
    const { unmount } = render(<InterfaceChoices classicNav={false} />);
    expect(screen.queryByRole('checkbox', { name: /older navigation/ })).toBeNull();
    expect(screen.getByRole('checkbox', { name: /Compact rows/ })).toBeInTheDocument();
    unmount();
    setFlags({ 'app.classic_nav': false });
    render(<InterfaceChoices />);
    expect(screen.queryByRole('checkbox', { name: /older navigation/ })).toBeNull();
  });
});

describe('what a harmonic match means, by where it is measured', () => {
  const plain = () => GLOSSARY.find((term) => term.id === 'harmonic-match')!.plain;

  it('is a key match measured on this device with browser harmonic matches on', () => {
    expect(plain()).toMatch(/^Two songs whose keys line up, measured across each whole song on this device\./);
    expect(plain()).toMatch(/You hear the end of one, then the start of the other\./);
    expect(plain()).not.toMatch(/chord/);
  });

  it('is a chord pattern match where SelectaDJ reads chords', () => {
    setFlags({ 'cloud.browser_harmonic': false });
    expect(plain()).toMatch(/^Two songs that may share a chord pattern\./);
    expect(plain()).toMatch(/It never adds anything to a mix\.$/);
  });
});
