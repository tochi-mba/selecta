import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setFlags } from '../flags';
import type { MediaStore, StoredFolderHandle } from '../media';
import type { WorkshopTab } from '../router';
import { status as appStatus } from '../test/backend';
import { CloudWorkspace, type FileCheck, type PlaybackFacts } from './CloudWorkspace';

// cloud.workspace: Workspace in browser-first Cloud keeps only the tabs a browser can fill
// truthfully. Its diagnostics copy holds capabilities and states, never anything personal.

const folders = vi.hoisted(() => ({ remembered: null as unknown, forgotten: [] as string[] }));
vi.mock('../media', async (original) => ({
  ...(await original<typeof import('../media')>()),
  recallFolder: async () => folders.remembered,
  forgetFolder: async (workspaceId: string) => { folders.forgotten.push(workspaceId); },
}));

vi.mock('../engine/probe', async (original) => ({
  ...(await original<typeof import('../engine/probe')>()),
  probeCapability: async () => ({ ok: true, sampleRate: 48000, schedulingMisses: 1, blocks: 200 }),
}));

const WORKSPACE = 'ws-private-7f3a';
const store = (degraded = false) => async () => ({ degraded }) as unknown as MediaStore;

function show(tab: WorkshopTab, more: Partial<{
  degraded: boolean; stemsShown: boolean; measuringKeys: boolean; savedMixes: number | null; fileCheck: FileCheck; playback: PlaybackFacts; counts: Record<string, number>;
}> = {}) {
  const status = appStatus();
  return render(
    <CloudWorkspace
      tab={tab}
      status={{ ...status, counts: { ...status.counts, music: 12, ready: 9, missing: 0, ...more.counts } }}
      workspaceId={WORKSPACE}
      openStore={store(more.degraded)}
      connect={<section aria-label="Connect music">connect here</section>}
      stems={<section aria-label="Stem splitting">stems here</section>}
      stemsShown={more.stemsShown ?? false}
      measuringKeys={more.measuringKeys ?? false}
      savedMixes={more.savedMixes === undefined ? 3 : more.savedMixes}
      fileCheck={more.fileCheck ?? { running: false, at: null }}
      playback={more.playback ?? { refusal: null, speaker: null, phase: 'idle' }}
    />,
  );
}

beforeEach(() => {
  folders.remembered = null;
  folders.forgotten.length = 0;
  Object.defineProperty(navigator, 'storage', {
    configurable: true,
    value: { estimate: async () => ({ usage: 2_500_000, quota: 3_000_000_000 }), persisted: async () => true, persist: async () => true },
  });
});

/** The figure in an overview tile, found by the tile's label: the words a screen reader hears, which
 * under motion are the rolled figure's own visually hidden copy (ADR-0477 NumberRoll). */
const tile = (label: string) => {
  const figure = screen.getByText(label).closest('a')?.querySelector('strong');
  return (figure?.querySelector('.number-roll > .visually-hidden') ?? figure)?.textContent;
};

describe('the tabs of the browser Workspace', () => {
  it('offers Overview, Sources, Storage and Diagnostics, each at its own address', () => {
    show('overview');
    const tabs = within(screen.getByRole('navigation', { name: 'Workspace' })).getAllByRole('link');
    expect(tabs.map((tab) => [tab.textContent, tab.getAttribute('href')])).toEqual([
      ['Overview', '/workshop'], ['Sources', '/workshop/sources'], ['Storage', '/workshop/storage'], ['Diagnostics', '/workshop/diagnostics'],
    ]);
    expect(screen.getByRole('link', { name: 'Overview' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('heading', { level: 1, name: 'Workspace' })).toBeVisible();
  });

  it('has no Analysis or Learning tab: their addresses say they belong to SelectaDJ on a computer', () => {
    for (const [tab, title] of [['analysis', 'Analysis'], ['learning', 'Learning']] as const) {
      const { unmount } = show(tab);
      expect(screen.getByRole('heading', { level: 1, name: `${title} is part of SelectaDJ on your computer` })).toBeVisible();
      expect(screen.getByRole('link', { name: 'Go to Workspace' })).toHaveAttribute('href', '/workshop');
      expect(screen.queryByRole('navigation', { name: 'Workspace' })).toBeNull();
      unmount();
    }
    show('overview');
    expect(screen.queryByRole('link', { name: 'Analysis' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Learning' })).toBeNull();
  });
});

describe('Workspace overview in the browser', () => {
  it('counts the library, what plays here and the saved mixes', () => {
    show('overview', { savedMixes: 1 });
    expect(tile('Songs')).toBe('12');
    expect(tile('Playable here')).toBe('9');
    expect(tile('Saved mixes')).toBe('1');
    expect(screen.getByText('Songs').closest('a')).toHaveAttribute('href', '/library');
    // nothing is missing, so no count of missing songs is drawn
    expect(screen.queryByText(/missing from every device/)).toBeNull();
  });

  it('holds the saved-mix count open until the server has said, and shows missing songs when there are some', () => {
    show('overview', { savedMixes: null, counts: { missing: 2 } });
    // no figure is claimed before the server answers: the tile holds a loading mark
    expect(tile('Saved mixes')).toBe('');
    expect(within(screen.getByText('Saved mixes').closest('a')!).getByLabelText('Loading')).toBeInTheDocument();
    // missing songs are something to act on, so they are said under Needs attention with a way to see them
    const needs = screen.getByRole('region', { name: 'Needs attention' });
    expect(needs).toHaveTextContent('2 songs are missing from every device');
    expect(within(needs).getByRole('link', { name: 'Show them' })).toHaveAttribute('href', '/library?show=attention');
  });

  it('says what this browser is doing in the background, and only what it is doing', () => {
    const { unmount } = show('overview');
    const background = screen.getByRole('region', { name: 'Activity' });
    // nothing is being added, so nothing says it is
    expect(background).not.toHaveTextContent(/Adding your music/);
    expect(background).toHaveTextContent('Songs not checked yet this visit.');
    expect(background).not.toHaveTextContent(/Harmonic matches/);
    expect(background).not.toHaveTextContent(/Stem splitting/);
    unmount();
    show('overview', { measuringKeys: true, stemsShown: true, fileCheck: { running: true, at: null } });
    const busy = screen.getByRole('region', { name: 'Activity' });
    expect(busy).toHaveTextContent('Checking which songs can play here.');
    expect(busy).toHaveTextContent('Measuring song keys for Harmonic matches.');
    expect(busy).toHaveTextContent('Stem splitting is under Storage.');
  });

  it('says when the file check last ran', () => {
    show('overview', { fileCheck: { running: false, at: new Date(2026, 10, 22, 9, 5).getTime() } });
    expect(screen.getByRole('region', { name: 'Activity' })).toHaveTextContent(/Songs checked at \d{1,2}[:.]05/);
  });

  it('keeps the interface choices, without the older navigation a browser has no pages for', () => {
    show('overview');
    expect(screen.getByRole('heading', { name: 'Interface' })).toBeVisible();
    expect(screen.getByRole('checkbox', { name: /Compact rows/ })).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: /older navigation/ })).toBeNull();
    expect(screen.getByText('SelectaDJ is a REX Technologies product.')).toBeVisible();
  });
});

describe('Workspace sources in the browser', () => {
  // today's surface, as it stays with cloud.music_folders off
  beforeEach(() => { setFlags({ 'cloud.music_folders': false }); });

  it('shows Your music folders in place of the one remembered folder with cloud.music_folders on', async () => {
    setFlags({ 'cloud.music_folders': true });
    show('sources');
    expect(screen.getByRole('region', { name: 'Your music folders' })).toBeVisible();
    expect(screen.getByRole('button', { name: /Add a folder/ })).toBeVisible();
    expect(screen.queryByRole('region', { name: 'Connected in this browser' })).toBeNull();
    expect(screen.getByText('9 of 12 songs open here')).toBeVisible();
  });

  it('shows Connect music and says no folder is remembered', async () => {
    show('sources');
    expect(screen.getByRole('region', { name: 'Connect music' })).toBeVisible();
    expect(await screen.findByText(/No folder is remembered in this browser/)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Forget' })).toBeNull();
  });

  it('names the remembered folder, says whether it may be read, and forgets it on request', async () => {
    folders.remembered = { name: 'Summer sets', queryPermission: async () => 'prompt' } as unknown as StoredFolderHandle;
    show('sources');
    const remembered = screen.getByRole('region', { name: 'Connected in this browser' });
    expect(await within(remembered).findByText('Summer sets')).toBeVisible();
    await waitFor(() => expect(remembered).toHaveTextContent('Folder. The browser asks your permission before reading it again.'));
    fireEvent.click(within(remembered).getByRole('button', { name: 'Forget' }));
    expect(await screen.findByText(/No folder is remembered in this browser/)).toBeVisible();
    expect(folders.forgotten).toEqual([WORKSPACE]);
  });

  it('says a folder it may read now can be read', async () => {
    folders.remembered = { name: 'Summer sets', queryPermission: async () => 'granted' } as unknown as StoredFolderHandle;
    show('sources');
    await waitFor(() => expect(screen.getByRole('region', { name: 'Connected in this browser' })).toHaveTextContent('Folder. This browser can read it now.'));
  });
});

describe('Workspace storage in the browser', () => {
  it('shows browser storage in MB and GB, the stem card and what this browser keeps', async () => {
    show('storage', { degraded: true });
    expect(await screen.findByRole('meter', { name: 'Used by SelectaDJ' })).toHaveAttribute('aria-valuetext', '2.5 MB of 3.0 GB');
    expect(screen.getByRole('region', { name: 'Stem splitting' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'What this browser keeps' })).toBeVisible();
    expect(await screen.findByRole('note')).toHaveTextContent(/not keeping SelectaDJ’s list of connected files/);
  });

  it('leaves out the device data card with cloud.local_media off', async () => {
    setFlags({ 'cloud.local_media': false });
    show('storage');
    await screen.findByRole('meter', { name: 'Used by SelectaDJ' });
    expect(screen.queryByRole('heading', { name: 'What this browser keeps' })).toBeNull();
  });
});

describe('browser diagnostics', () => {
  const summary = async () => JSON.parse((await screen.findByText(/"engine"/)).textContent ?? '{}') as Record<string, unknown>;

  it('lists what this browser can do, checked here', async () => {
    show('diagnostics');
    await screen.findByText(/"engine"/);
    const panel = document.body;
    // jsdom has no Web Audio, and the page says so instead of guessing: it is the headline
    expect(screen.getByRole('heading', { name: 'This browser has no way to play sound for SelectaDJ. A recent desktop browser can.' })).toBeVisible();
    expect(panel).toHaveTextContent('Audio checkNot run yet in this visit.');
    expect(panel).toHaveTextContent('Nothing is playing right now.');
    expect(panel).toHaveTextContent('Your list of connected songsKept in this browser between visits.');
    expect(panel).toHaveTextContent('The browser has agreed to keep SelectaDJ’s details on this device.');
    expect(panel).toHaveTextContent('2.5 MB used of 3.0 GB allowed.');
    // no feature counts: that is internal detail, not something a member can act on
    expect(panel).not.toHaveTextContent(/features? on/);
    expect(panel).toHaveTextContent('Checked in this browser; nothing is sent anywhere.');
  });

  it('says who the speaker is, or why playing here was refused', async () => {
    const { unmount } = show('diagnostics', { playback: { refusal: null, speaker: 'here', phase: 'playing' } });
    expect(await screen.findByText('This browser is the speaker.')).toBeVisible();
    unmount();
    const other = show('diagnostics', { playback: { refusal: null, speaker: 'elsewhere', phase: 'idle' } });
    expect(await screen.findByText('Another device is the speaker; this browser is controlling it.')).toBeVisible();
    other.unmount();
    show('diagnostics', { playback: { refusal: 'Another device took over.', speaker: null, phase: 'idle' }, degraded: true });
    expect(await screen.findByText('Playing here was refused: Another device took over.')).toBeVisible();
    expect(screen.getByText('This browser is not keeping it, so songs need choosing again next visit.')).toBeVisible();
  });

  it('summarises capabilities and states only', async () => {
    setFlags({ 'requests.bridges': false, 'editor': false });
    show('diagnostics', { playback: { refusal: null, speaker: 'here', phase: 'playing' } });
    const found = await summary();
    expect(Object.keys(found).sort()).toEqual([
      'audio_check', 'audio_worklet', 'cross_origin_isolated', 'engine', 'flags_off', 'folder_picker', 'indexeddb', 'online', 'opfs', 'persistence', 'playback', 'storage', 'web_audio',
    ]);
    expect(found).toMatchObject({
      web_audio: false, audio_worklet: false, audio_check: 'not run', persistence: 'granted', folder_picker: false,
      indexeddb: { opened: true, degraded: false }, playback: { refused: null, speaker: 'here', phase: 'playing' },
      storage: { usage_mb: 2.5, quota_mb: 3000 },
    });
    expect(found.flags_off).toEqual(expect.arrayContaining(['requests.bridges', 'editor']));
  });

  it('puts nothing personal in the summary: no account, workspace, folder or song', async () => {
    folders.remembered = { name: 'Summer sets' } as unknown as StoredFolderHandle;
    show('diagnostics');
    const text = (await screen.findByText(/"engine"/)).textContent ?? '';
    expect(text).not.toContain(WORKSPACE);
    expect(text).not.toContain('Summer sets');
    expect(text).not.toMatch(/@|email|user|account|workspace|device_id|token|title|artist|folder_name|path/i);
    // said beside the copy itself, which is closed until asked for
    expect(screen.getByText(/No names, emails, songs, folders or account details\./)).toBeInTheDocument();
  });

  it('copies exactly the summary shown, and says so', async () => {
    const writeText = vi.fn(async (_text: string) => {});
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    try {
      show('diagnostics');
      const shown = (await screen.findByText(/"engine"/)).textContent;
      fireEvent.click(screen.getByRole('button', { name: 'Copy details for support' }));
      expect(await screen.findByRole('button', { name: 'Copied' })).toBeVisible();
      expect(writeText).toHaveBeenCalledWith(shown);
    } finally {
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
    }
  });

  it('reports the audio check as not passing where there is no Web Audio, without throwing', async () => {
    show('diagnostics');
    fireEvent.click(await screen.findByRole('button', { name: 'Run the audio check' }));
    expect(await screen.findByText('Did not pass: This browser has no Web Audio.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Run the audio check again' })).toBeVisible();
    expect(await summary()).toMatchObject({ audio_check: { ok: false, reason: 'This browser has no Web Audio.' } });
  });

  it('reports a passing audio check with its numbers', async () => {
    class FakeContext { resume = async () => {}; close = async () => {}; }
    vi.stubGlobal('AudioContext', FakeContext);
    show('diagnostics');
    fireEvent.click(await screen.findByRole('button', { name: 'Run the audio check' }));
    expect(await screen.findByText('Passed at 48000 Hz with 1 gap in 200 blocks. This shows audio runs here, not that your speakers are on.')).toBeInTheDocument();
    expect(await summary()).toMatchObject({ web_audio: true, audio_check: { ok: true, sample_rate: 48000, scheduling_misses: 1, blocks: 200 } });
  });
});
