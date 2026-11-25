import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setFlags } from '../flags';
import type { ImportSummary } from '../media';
import { clearImportSession, startImportSession } from './importSession';
import { addsToHomeScreen, captureInstallPrompt, decideInstall, installState, isStandalone, promptInstall, resetInstallForTests } from './install';
import { INSTALL_COPY, InstallOffer } from './InstallOffer';
import { persistAfterFirstImport, readPersistState, requestPersist } from './persistence';
import { MUSIC_NEVER_STORED, PERSIST_COPY, StorageCard } from './StorageCard';
import type { VenueDeps } from './venue/deps';
import { VenuePosture } from './venue/VenuePosture';

// Plan W5b: storage persistence and installing SelectaDJ as an app.

const browserEnv = (standalone = false, safari = false) => ({
  matchMedia: (query: string) => ({ matches: standalone && query === '(display-mode: standalone)' }),
  navigator: safari ? { standalone: false } : {},
});

/** A Chromium install offer, as the browser would fire it. */
function offer(outcome: 'accepted' | 'dismissed' = 'accepted') {
  const event = new Event('beforeinstallprompt', { cancelable: true }) as Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
  event.prompt = vi.fn(async () => {});
  event.userChoice = Promise.resolve({ outcome });
  return event;
}

function storageWith({ persisted = false, grants = false, persist = true }: { persisted?: boolean; grants?: boolean; persist?: boolean } = {}) {
  const storage = {
    estimate: vi.fn(async () => ({ usage: 2_500_000, quota: 100_000_000 })),
    persisted: vi.fn(async () => persisted),
    persist: persist ? vi.fn(async () => { persisted = grants; return grants; }) : undefined,
  };
  Object.defineProperty(navigator, 'storage', { configurable: true, value: storage });
  return storage;
}

beforeEach(() => {
  resetInstallForTests();
  setFlags({});
  try { localStorage.clear(); } catch { /* none */ }
});
afterEach(() => {
  Object.defineProperty(navigator, 'storage', { configurable: true, value: undefined });
  clearImportSession();
});

/** The button that asks the browser to keep SelectaDJ's details, and the line that says what it will do. */
const KEEP = 'Keep these details safe';
const stateLine = () => document.querySelector('[data-persist]')?.textContent ?? '';

describe('storage persistence (W5b)', () => {
  it('reads unsupported, not granted and granted from the browser', async () => {
    expect(await readPersistState(undefined)).toBe('unsupported');
    expect(await readPersistState({ persisted: async () => true })).toBe('unsupported');
    expect(await readPersistState({ persist: async () => false, persisted: async () => false })).toBe('not_granted');
    expect(await readPersistState({ persist: async () => true, persisted: async () => true })).toBe('granted');
  });

  it('reports exactly what the browser answered to the request', async () => {
    expect(await requestPersist({ persist: async () => true })).toBe('granted');
    expect(await requestPersist({ persist: async () => false })).toBe('refused');
    expect(await requestPersist({ persist: async () => { throw new Error('no'); } })).toBe('refused');
    expect(await requestPersist({})).toBe('unsupported');
  });

  it('only the granted copy says the browser keeps anything', () => {
    expect(PERSIST_COPY.granted).toBe('This browser keeps SelectaDJ’s details on this device; it will not clear them to make room.');
    for (const state of ['not_granted', 'refused', 'unsupported'] as const) {
      expect(PERSIST_COPY[state]).toMatch(/^The browser may clear them/);
      expect(PERSIST_COPY[state]).not.toMatch(/keeps SelectaDJ/);
    }
    expect(PERSIST_COPY.not_granted).toMatch(/Ask it to keep them, or install SelectaDJ; the browser decides./);
    expect(PERSIST_COPY.refused).toMatch(/decided not to keep them/);
    expect(MUSIC_NEVER_STORED).toMatch(/music files are never in browser storage/);
  });

  it('the card offers the button when not granted, and follows a refusal honestly', async () => {
    const storage = storageWith({ grants: false });
    const user = userEvent.setup();
    render(<StorageCard degraded={false} />);
    const button = await screen.findByRole('button', { name: KEEP });
    // how much is used is a meter; what the browser will do with it is the line under it
    expect(screen.getByRole('meter', { name: 'Used by SelectaDJ' })).toHaveAttribute('aria-valuetext', '2.5 MB of 100.0 MB');
    expect(stateLine()).toBe(PERSIST_COPY.not_granted);
    await user.click(button);
    expect(storage.persist).toHaveBeenCalledOnce();
    await waitFor(() => expect(document.querySelector('[data-persist]')?.getAttribute('data-persist')).toBe('refused'));
    expect(stateLine()).toBe(PERSIST_COPY.refused);
    expect(screen.getByText(new RegExp(MUSIC_NEVER_STORED.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))).toBeInTheDocument();
  });

  it('a grant changes the copy and the button goes away', async () => {
    storageWith({ grants: true });
    const user = userEvent.setup();
    render(<StorageCard degraded={false} />);
    await user.click(await screen.findByRole('button', { name: KEEP }));
    await waitFor(() => expect(stateLine()).toBe(PERSIST_COPY.granted));
    expect(screen.queryByRole('button', { name: KEEP })).toBeNull();
  });

  it('no button where the browser cannot ask, and none with cloud.local_media off', async () => {
    storageWith({ persist: false });
    const { unmount } = render(<StorageCard degraded={false} />);
    await screen.findByRole('meter', { name: 'Used by SelectaDJ' });
    expect(stateLine()).toBe(PERSIST_COPY.unsupported);
    expect(screen.queryByRole('button')).toBeNull();
    unmount();
    storageWith();
    setFlags({ 'cloud.local_media': false });
    render(<StorageCard degraded={false} />);
    await waitFor(() => expect(document.querySelector('[data-persist]')?.getAttribute('data-persist')).toBe('not_granted'));
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('asks once when the first import that registered songs finishes', async () => {
    const persist = vi.fn(async () => true);
    const memory = new Map<string, string>();
    const marker = { get: (key: string) => memory.get(key) ?? null, set: (key: string, value: string) => { memory.set(key, value); } };
    const stop = persistAfterFirstImport({ storage: { persist, persisted: async () => false }, marker });
    const summary: ImportSummary = { imported: 1, duplicates: 0, failed: 0, skipped: 0, cancelled: false, paused: false };
    const run = async (_: unknown, emit: (event: { kind: 'file'; name: string; stage: 'done'; songId: number }) => void) => { emit({ kind: 'file', name: 'a.mp3', stage: 'done', songId: 1 }); return summary; };
    await act(async () => { await startImportSession({ source: [], run, workspaceId: 'ws' }); });
    await waitFor(() => expect(persist).toHaveBeenCalledOnce());
    clearImportSession();
    await act(async () => { await startImportSession({ source: [], run, workspaceId: 'ws' }); });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(persist).toHaveBeenCalledOnce();
    stop();
  });

  it('an import that registered nothing does not ask', async () => {
    const persist = vi.fn(async () => true);
    const memory = new Map<string, string>();
    const stop = persistAfterFirstImport({ storage: { persist, persisted: async () => false }, marker: { get: (key) => memory.get(key) ?? null, set: (key, value) => { memory.set(key, value); } } });
    const summary: ImportSummary = { imported: 0, duplicates: 0, failed: 0, skipped: 0, cancelled: false, paused: false };
    await act(async () => { await startImportSession({ source: [], run: async () => summary, workspaceId: 'ws' }); });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(persist).not.toHaveBeenCalled();
    stop();
  });
});

describe('install capture and standalone detection (W5b)', () => {
  it('detects standalone from display-mode or Safari’s flag, and Safari from navigator.standalone', () => {
    expect(isStandalone(browserEnv(true))).toBe(true);
    expect(isStandalone({ matchMedia: () => ({ matches: false }), navigator: { standalone: true } })).toBe(true);
    expect(isStandalone(browserEnv(false))).toBe(false);
    expect(addsToHomeScreen(browserEnv(false, true))).toBe(true);
    expect(addsToHomeScreen(browserEnv(false, false))).toBe(false);
  });

  it('T-20261125-f78f: a browser inside another app on iPhone gets no Add to Home Screen words', () => {
    const iphone = (userAgent: string) => ({ matchMedia: () => ({ matches: false }), navigator: { standalone: false, userAgent } });
    const webkit = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko)';
    // Safari itself, and Chrome on iOS, keep the guidance
    expect(addsToHomeScreen(iphone(`${webkit} Version/18.1 Mobile/15E148 Safari/604.1`))).toBe(true);
    expect(addsToHomeScreen(iphone(`${webkit} CriOS/131.0 Mobile/15E148 Safari/604.1`))).toBe(true);
    // Instagram, Facebook, TikTok and a web view with no Safari token do not
    expect(addsToHomeScreen(iphone(`${webkit} Mobile/15E148 Instagram 357.0.0`))).toBe(false);
    expect(addsToHomeScreen(iphone(`${webkit} Mobile/15E148 [FBAN/FBIOS;FBAV/490.0]`))).toBe(false);
    expect(addsToHomeScreen(iphone(`${webkit} Mobile/15E148 musical_ly_37.0 BytedanceWebview/d8a21c6`))).toBe(false);
    expect(addsToHomeScreen(iphone(`${webkit} Mobile/15E148`))).toBe(false);
    expect(decideInstall({ standalone: false, installed: false, prompt: false, homeScreen: addsToHomeScreen(iphone(`${webkit} Mobile/15E148`)) })).toBe('none');
  });

  it('decides the state in order: installed, prompt, home screen, none', () => {
    expect(decideInstall({ standalone: true, installed: false, prompt: true, homeScreen: true })).toBe('installed');
    expect(decideInstall({ standalone: false, installed: false, prompt: true, homeScreen: true })).toBe('prompt');
    expect(decideInstall({ standalone: false, installed: false, prompt: false, homeScreen: true })).toBe('home_screen');
    expect(decideInstall({ standalone: false, installed: false, prompt: false, homeScreen: false })).toBe('none');
  });

  it('keeps the browser’s offer, uses it once, and says Installed after acceptance', async () => {
    const target = new EventTarget();
    captureInstallPrompt(target, browserEnv());
    captureInstallPrompt(target, browserEnv());
    expect(installState()).toBe('none');
    const event = offer('accepted');
    target.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(installState()).toBe('prompt');
    expect(await promptInstall()).toBe('accepted');
    expect(event.prompt).toHaveBeenCalledOnce();
    expect(installState()).toBe('installed');
    expect(await promptInstall()).toBe('unavailable');
  });

  it('a dismissed offer is dropped, and appinstalled says Installed', async () => {
    const target = new EventTarget();
    captureInstallPrompt(target, browserEnv());
    target.dispatchEvent(offer('dismissed'));
    expect(await promptInstall()).toBe('dismissed');
    expect(installState()).toBe('none');
    target.dispatchEvent(new Event('appinstalled'));
    expect(installState()).toBe('installed');
  });

  it('the offer shows guidance on iPad, Installed when standalone, and nothing otherwise', () => {
    const { rerender, container } = render(<InstallOffer state="home_screen" />);
    expect(screen.getByText(INSTALL_COPY.home_screen)).toBeTruthy();
    expect(INSTALL_COPY.home_screen).toBe("On iPad, tap Share, then Add to Home Screen. Installed, Safari keeps SelectaDJ's details instead of clearing them after a week away.");
    rerender(<InstallOffer state="installed" />);
    expect(screen.getByRole('status').textContent).toMatch(/^Installed/);
    rerender(<InstallOffer state="none" />);
    expect(container.innerHTML).toBe('');
  });

  it('the storage card shows Install once the browser offers it', async () => {
    storageWith();
    const target = new EventTarget();
    captureInstallPrompt(target, browserEnv());
    render(<StorageCard degraded={false} />);
    await screen.findByRole('button', { name: KEEP });
    expect(screen.queryByRole('button', { name: 'Install SelectaDJ' })).toBeNull();
    act(() => { target.dispatchEvent(offer()); });
    expect(screen.getByRole('button', { name: 'Install SelectaDJ' })).toBeTruthy();
  });
});

describe('venue flow install (W5b)', () => {
  function venue() {
    const memory = new Map<string, string>();
    const deps: Partial<VenueDeps> = {
      storage: { getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => { memory.set(key, value); } },
      battery: async () => null,
      openAudio: () => ({ probe: async () => ({ ok: true }), probeDetail: async () => ({ ok: true as const, sampleRate: 48000, schedulingMisses: 0, blocks: 64 }), wake: async () => true, playTone: async () => {}, confirmHeard: vi.fn(), markUnverified: vi.fn(), dispose: vi.fn() }),
      runSuite: async () => ({
        schema: 'selectadj/capability-record/1', key: 'k', identity_source: 'unknown', measured_at: 1,
        tuple: { device_model: 'unknown', os_version: 'unknown', browser_engine: 'unknown', browser_version: 'unknown', engine_version: 'e', codec: 'mp3', media_source: 'local_file', output_type: 'unknown' },
        probes: {
          worklet: { ok: true, sampleRate: 48000, schedulingMisses: 0, blocks: 64 },
          storage: { opfs: { supported: true }, space: { supported: false } },
          pickers: { directoryInput: { supported: true }, dirPicker: { supported: true } },
          codecs: { mp3: 'probably' }, benchmark: { ran: false, reason: 'test' }, outputSelection: false, wakeLockApi: true,
        },
      }),
      watchDocument: null,
      watchDevices: null,
      now: () => 1,
    };
    render(<VenuePosture workspaceId="ws-venue" places={{ localFirst: true, devices: true, rooms: true, library: true }} deps={deps} />);
  }

  it('shows Install in the power step only when the browser offered it', async () => {
    const target = new EventTarget();
    captureInstallPrompt(target, browserEnv());
    const user = userEvent.setup();
    venue();
    await user.click(screen.getByRole('button', { name: 'Check this tablet' }));
    await screen.findByRole('button', { name: 'It’s plugged in' });
    expect(screen.queryByRole('button', { name: 'Install SelectaDJ' })).toBeNull();
    act(() => { target.dispatchEvent(offer()); });
    expect(screen.getByRole('button', { name: 'Install SelectaDJ' })).toBeTruthy();
  });
});

const manifestText = import.meta.glob('../../public/manifest.webmanifest', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
// CSS imports are emptied under vitest, so the tokens are read from disk (as spacing-tokens.test.ts does).
const node = (globalThis as unknown as { process: { cwd(): string; getBuiltinModule(id: string): unknown } }).process;
const readText = (node.getBuiltinModule('node:fs') as { readFileSync(path: string, encoding: 'utf8'): string }).readFileSync;
const iconFiles = import.meta.glob('../../public/icons/*', { query: '?url', import: 'default', eager: true }) as Record<string, string>;

describe('web app manifest (W5b)', () => {
  const manifest = JSON.parse(Object.values(manifestText)[0]) as { name: string; short_name: string; display: string; start_url: string; scope: string; theme_color: string; background_color: string; icons: { src: string; sizes: string; type: string; purpose: string }[] };
  const tokens = readText(`${node.cwd()}/src/styles/tokens.css`, 'utf8');
  const token = (name: string) => tokens.match(new RegExp(`--${name}: *(#[0-9a-f]{6})`, 'i'))?.[1];

  it('names SelectaDJ, opens standalone at the root, in the tokens’ colours', () => {
    expect(manifest).toMatchObject({ name: 'SelectaDJ', short_name: 'SelectaDJ', display: 'standalone', start_url: '/', scope: '/' });
    expect(manifest.theme_color).toBe(token('bg'));
    expect(manifest.background_color).toBe(token('bg'));
  });

  it('has 192 and 512 PNGs and SVGs, for any and maskable, every one a real file', () => {
    const has = (sizes: string, type: string, purpose: string) => manifest.icons.some((icon) => icon.sizes === sizes && icon.type === type && icon.purpose === purpose);
    for (const purpose of ['any', 'maskable']) {
      expect(has('192x192', 'image/png', purpose)).toBe(true);
      expect(has('512x512', 'image/png', purpose)).toBe(true);
      expect(has('any', 'image/svg+xml', purpose)).toBe(true);
    }
    const files = Object.keys(iconFiles).map((path) => path.replace('../../public', ''));
    for (const icon of manifest.icons) expect(files).toContain(icon.src);
  });

  it('gives launchers their own full-bleed maskable PNGs, never the rounded any-purpose ones', () => {
    const sources = (purpose: string) => manifest.icons.filter((icon) => icon.type === 'image/png' && icon.purpose === purpose).map((icon) => icon.src);
    const maskable = sources('maskable');
    expect(maskable).toEqual(['/icons/selecta-maskable-192.png', '/icons/selecta-maskable-512.png']);
    for (const src of maskable) expect(sources('any')).not.toContain(src);
  });

  it('the SVG marks are the tokens’ lime on the dark base', () => {
    const svgs = import.meta.glob('../../public/icons/*.svg', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
    expect(Object.keys(svgs)).toHaveLength(2);
    for (const svg of Object.values(svgs)) {
      expect(svg).toContain(`fill="${token('accent')}"`);
      expect(svg).toContain(`fill="${token('bg')}"`);
    }
  });
});
