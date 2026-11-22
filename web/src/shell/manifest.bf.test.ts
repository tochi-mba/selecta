import { describe, expect, it, vi } from 'vitest';
import type { FlagId } from '../flags';
import {
  describeRoute, destinationOf, destinationVisible, destinationsFor, DESTINATIONS, moreDestinationsFor, moreRouteOf,
  type Destination, type DestinationContext, type Experience,
} from './manifest';

const context = (
  mode: 'local' | 'cloud',
  features: string[] = [],
  experience: Experience | null = null,
  capabilities: string[] = [],
): DestinationContext => ({
  mode,
  feature: (id: FlagId) => features.includes(id),
  experience,
  capability: (id: string) => capabilities.includes(id),
});
const LOCAL_FIRST: Experience = { local_first: true, hosted: false };
const BOTH: Experience = { local_first: true, hosted: true };

describe('shared-shell destination requirements (BF-0462-01)', () => {
  it('offers the same four primary music destinations in local and Cloud', () => {
    for (const mode of ['local', 'cloud'] as const) {
      expect(destinationsFor(context(mode, ['cloud.local_first'])).filter((item) => item.id !== 'workspace').map((item) => item.label))
        .toEqual(['Listen', 'Make a Mix', 'My Mixes', 'Library']);
    }
  });

  it('keeps local rendering identical: every local destination is there with every gate closed', () => {
    expect(destinationsFor(context('local')).map((item) => item.id)).toEqual(DESTINATIONS.map((item) => item.id));
    expect(destinationsFor({ mode: 'local', feature: () => false }).map((item) => item.id)).toEqual(DESTINATIONS.map((item) => item.id));
  });

  it('keeps Workspace out of the Cloud rail without cloud.workspace: its device cards are More > This device', () => {
    expect(destinationsFor(context('cloud')).map((item) => item.id)).not.toContain('workspace');
    expect(destinationsFor(context('cloud', ['cloud.local_first'], LOCAL_FIRST)).map((item) => item.id)).not.toContain('workspace');
    const more = moreDestinationsFor(context('cloud', [], LOCAL_FIRST)).find((item) => item.id === 'workspace');
    expect(more).toMatchObject({ label: 'This device', path: '/workshop' });
  });

  it('puts Workspace in the Cloud rail with cloud.workspace, after the four music destinations', () => {
    const rail = destinationsFor(context('cloud', ['cloud.local_first', 'cloud.workspace'], LOCAL_FIRST));
    expect(rail.map((item) => item.label)).toEqual(['Listen', 'Make a Mix', 'My Mixes', 'Library', 'Workspace']);
    expect(rail[rail.length - 1]).toMatchObject({ id: 'workspace', path: '/workshop' });
    // local mode has no such flag to pass: its gate is permissive, so its Workspace is untouched
    expect(destinationsFor({ mode: 'local', feature: () => false }).map((item) => item.id)).toContain('workspace');
  });

  it('requires mode, account flag, experience and measured capability together in Cloud', () => {
    const destination: Destination = {
      id: 'listen', label: 'Player', path: '/listen', icon: 'music', about: 'Player',
      requires: { modes: ['cloud'], flag: 'devices.browser_player', experience: 'local_first', capability: 'audio-worklet' },
    };
    const all = ['devices.browser_player'];
    expect(destinationVisible(destination, context('local', all, LOCAL_FIRST, ['audio-worklet']))).toBe(false);
    expect(destinationVisible(destination, context('cloud', [], LOCAL_FIRST, ['audio-worklet']))).toBe(false);
    expect(destinationVisible(destination, context('cloud', all, null, ['audio-worklet']))).toBe(false);
    expect(destinationVisible(destination, context('cloud', all, LOCAL_FIRST, []))).toBe(false);
    expect(destinationVisible(destination, context('cloud', all, LOCAL_FIRST, ['audio-worklet']))).toBe(true);
  });

  it('is permissive past the mode check in local mode, so the local sweep stays the oracle', () => {
    const gated: Destination = { id: 'library', label: 'Library', path: '/library', icon: 'library', about: '', requires: { flag: 'cloud.uploads', experience: 'hosted' } };
    const feature = vi.fn(() => false);
    expect(destinationVisible(gated, { mode: 'local', feature })).toBe(true);
    expect(feature).not.toHaveBeenCalled();
  });

  it('gives the hosted shell (cloud.local_first read as off) Make a Mix and Library by their own flags, and no My Mixes', () => {
    const ids = (features: string[]) => destinationsFor(context('cloud', features)).map((item) => item.id);
    expect(ids(['cloud.mix_create', 'cloud.stored_media'])).toEqual(['listen', 'explore', 'library']);
    expect(ids(['cloud.stored_media'])).toEqual(['listen', 'library']);
    expect(ids([])).toEqual(['listen']);
    // local mode never consults them
    expect(destinationsFor(context('local')).map((item) => item.id)).toEqual(DESTINATIONS.map((item) => item.id));
  });

  it('names the hosted overview, which belongs to no destination', () => {
    expect(describeRoute({ page: 'home' })).toEqual({ title: 'Overview', crumbs: [{ label: 'Overview' }] });
    expect(destinationOf({ page: 'home' })).toBeNull();
  });

  it('does not consult gates for an unrestricted destination', () => {
    const feature = vi.fn(() => false);
    const capability = vi.fn(() => false);
    const unrestricted: Destination = { id: 'library', label: 'Library', path: '/library', icon: 'library', about: '' };
    expect(destinationVisible(unrestricted, { mode: 'cloud', feature, capability })).toBe(true);
    expect(feature).not.toHaveBeenCalled();
    expect(capability).not.toHaveBeenCalled();
  });
});

describe('the Cloud More area (BF-0463-01)', () => {
  it('is empty in local mode whatever the flags', () => {
    expect(moreDestinationsFor(context('local', ['devices', 'rooms', 'cloud.uploads'], BOTH))).toEqual([]);
  });

  it('holds account, billing, devices, Rooms and this device for a local-first account', () => {
    expect(moreDestinationsFor(context('cloud', ['devices', 'rooms'], LOCAL_FIRST)).map((item) => item.id))
      .toEqual(['account', 'billing', 'devices', 'rooms', 'workspace']);
  });

  it('shows uploads only with the hosted experience and the uploads flag together', () => {
    expect(moreDestinationsFor(context('cloud', ['cloud.uploads'], LOCAL_FIRST)).map((item) => item.id)).not.toContain('uploads');
    expect(moreDestinationsFor(context('cloud', [], BOTH)).map((item) => item.id)).not.toContain('uploads');
    expect(moreDestinationsFor(context('cloud', ['cloud.uploads'], BOTH)).map((item) => item.id)).toContain('uploads');
  });

  it('drops devices and Rooms when their flags are off', () => {
    const ids = moreDestinationsFor(context('cloud', [], LOCAL_FIRST)).map((item) => item.id);
    expect(ids).not.toContain('devices');
    expect(ids).not.toContain('rooms');
  });

  it('routes and names every More address, with no breadcrumb into a page that does not exist', () => {
    expect(moreRouteOf('/account/billing/')).toEqual({ page: 'more', id: 'billing' });
    expect(moreRouteOf('/library')).toBeNull();
    const route = moreRouteOf('/account/devices')!;
    expect(describeRoute(route)).toEqual({ title: 'Devices', crumbs: [{ label: 'Devices' }] });
    expect(destinationOf(route)).toBeNull();
  });

  it('keeps the local names typographic, exactly as before', () => {
    expect(DESTINATIONS.find((item) => item.id === 'listen')?.about).toBe('What’s playing, what’s next and the lyrics');
  });
});
