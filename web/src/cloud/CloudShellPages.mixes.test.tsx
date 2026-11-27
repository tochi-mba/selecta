import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setFlags } from '../flags';
import type { StudioActivity } from './deviceStudio';

// Phase 4 (cloud.one_mixer): Make a Mix is the shared mixer for every Cloud account, so the mix it
// makes is the current mix; the separate cloud library card stays only with the flag off. The
// mixers themselves are stood in by markers, so this file tests only which one the page draws.

vi.mock('../views/Mixes', () => ({ Mixes: ({ studioLayout }: { studioLayout?: boolean }) => <section aria-label="Shared mixer">{studioLayout ? "Full Studio" : "Quick Mix"}</section> }));
vi.mock('./hosted/HostedMakeAMix', () => ({
  HostedMakeAMix: ({ browserMixer }: { browserMixer: unknown }) => <section aria-label="Cloud library card">{browserMixer ? 'with the browser mixer a press away' : ''}</section>,
}));
vi.mock('../views/Mix', async () => {
  const react = await import('react');
  const { ExportElsewhere: offer } = await import('../views/exportElsewhere');
  return { Mix: () => <p>{react.useContext(offer) ? 'Export offers the cloud file' : 'Export as before'}</p> };
});

const { CloudShellPages } = await import('./CloudShellPages');
const { gettingReady } = await import('./TransitionsGettingReady');
type Context = Parameters<typeof CloudShellPages>[0]['at'];

function page(route: Context['route'], { coexisting = true, hostedRender = true, devicesHere = true } = {}) {
  const at = {
    api: vi.fn(), cloud: vi.fn(), request: vi.fn(), workspaceId: 'ws-1', route,
    on: (id: string) => (id === 'cloud.hosted_render' ? hostedRender : true),
    shared: { status: { counts: { ready: 4 } }, setView: () => {} },
    data: { mix: [], name: 'Current mix', can_undo: false }, mixProblem: false,
    now: { phase: 'idle' }, shellPlayer: { togglePause: vi.fn() }, playback: { view: null },
    newMember: false, lucyHere: false, coexisting, devicesHere, moreItems: [], mixReady: 4, connected: 4, localExport: null,
    importLive: { phase: 'idle' }, setSpine: vi.fn(), setSpineAsked: vi.fn(),
  } as unknown as Context;
  return render(<>{CloudShellPages({ at })}</>);
}

afterEach(() => {
  cleanup();
  setFlags(null);
});

describe('Make a Mix for an account with songs in both places', () => {
  it('with cloud.one_mixer off, keeps the separate card, the shared mixer one press away', () => {
    setFlags({ 'cloud.one_mixer': false, 'cloud.hosted_render': true });
    page({ page: 'mixes', tab: 'browse' });
    expect(screen.getByRole('region', { name: 'Cloud library card' })).toHaveTextContent('with the browser mixer a press away');
    expect(screen.queryByRole('region', { name: 'Shared mixer' })).toBeNull();
  });

  it('with cloud.one_mixer on, draws the shared mixer and no card', () => {
    setFlags({ 'cloud.one_mixer': true, 'cloud.hosted_render': true });
    page({ page: 'mixes', tab: 'browse' });
    expect(screen.getByRole('region', { name: 'Shared mixer' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Cloud library card' })).toBeNull();
  });

  it('uses the full Studio in a Cloud storage workspace with no device music', () => {
    setFlags({ 'cloud.one_mixer': false, 'cloud.hosted_render': true });
    page({ page: 'mixes', tab: 'browse' }, { devicesHere: false });
    expect(screen.getByRole('region', { name: 'Shared mixer' })).toHaveTextContent('Full Studio');
    expect(screen.queryByRole('region', { name: 'Cloud library card' })).toBeNull();
  });

  it('draws the shared mixer for an account without the cloud studio, whatever the flag', () => {
    for (const on of [false, true]) {
      setFlags({ 'cloud.one_mixer': on, 'cloud.hosted_render': false });
      page({ page: 'mixes', tab: 'browse' }, { hostedRender: false });
      expect(screen.getByRole('region', { name: 'Shared mixer' })).toBeInTheDocument();
      cleanup();
    }
  });

  it('offers the cloud file in the editor’s Export panel only with the flag, the cloud studio and both places', () => {
    setFlags({ 'cloud.one_mixer': true, 'cloud.hosted_render': true });
    page({ page: 'edit', draft: null });
    expect(screen.getByText('Export offers the cloud file')).toBeInTheDocument();
    cleanup();
    page({ page: 'edit', draft: null }, { coexisting: false });
    expect(screen.getByText('Export as before')).toBeInTheDocument();
    cleanup();
    setFlags({ 'cloud.one_mixer': false, 'cloud.hosted_render': true });
    page({ page: 'edit', draft: null });
    expect(screen.getByText('Export as before')).toBeInTheDocument();
  });
});

describe('Getting transitions ready', () => {
  const activity = (over: Partial<StudioActivity>): StudioActivity => ({ making: null, waiting: 0, made: 0, ...over });
  it('is said while the mix’s own transitions are being prepared, never for a request’s alone', () => {
    expect(gettingReady(null)).toBe(false);
    expect(gettingReady(activity({}))).toBe(false);
    expect(gettingReady(activity({ waiting: 1 }))).toBe(true);
    expect(gettingReady(activity({ making: { a: 1, b: 2, forRequest: false } }))).toBe(true);
    expect(gettingReady(activity({ making: { a: 1, b: 2, forRequest: true } }))).toBe(false);
  });
});
