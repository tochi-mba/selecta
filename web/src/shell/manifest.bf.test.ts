import { describe, expect, it, vi } from 'vitest';
import { destinationVisible, destinationsFor, moreDestinationsFor, type Destination } from './manifest';

const context = (mode: 'local' | 'cloud', features: string[] = [], capabilities: string[] = []) => ({
  mode,
  feature: (id: string) => features.includes(id),
  capability: (id: string) => capabilities.includes(id),
});

describe('shared-shell destination requirements', () => {
  it('offers the same four primary music destinations in local and Cloud', () => {
    for (const mode of ['local', 'cloud'] as const) {
      expect(destinationsFor(context(mode)).filter((item) => item.id !== 'workspace').map((item) => item.label))
        .toEqual(['Listen', 'Make a Mix', 'My Mixes', 'Library']);
    }
  });

  it('requires mode, account flag and measured capability together', () => {
    const destination: Destination = {
      id: 'listen', label: 'Player', path: '/listen', icon: 'music', about: 'Player',
      requires: { modes: ['cloud'], flag: 'devices.browser_player', capability: 'audio-worklet' },
    };
    expect(destinationVisible(destination, context('local', ['devices.browser_player'], ['audio-worklet']))).toBe(false);
    expect(destinationVisible(destination, context('cloud', [], ['audio-worklet']))).toBe(false);
    expect(destinationVisible(destination, context('cloud', ['devices.browser_player'], []))).toBe(false);
    expect(destinationVisible(destination, context('cloud', ['devices.browser_player'], ['audio-worklet']))).toBe(true);
  });

  it('does not consult gates for an unrestricted destination', () => {
    const feature = vi.fn(() => false);
    const capability = vi.fn(() => false);
    const unrestricted: Destination = {
      id: 'library', label: 'Library', path: '/library', icon: 'library', about: '',
    };
    expect(destinationVisible(unrestricted, { mode: 'cloud', feature, capability })).toBe(true);
    expect(feature).not.toHaveBeenCalled();
    expect(capability).not.toHaveBeenCalled();
  });

  it('keeps account surfaces in Cloud More and hides hosted uploads without their grant', () => {
    expect(moreDestinationsFor(context('local', ['devices', 'rooms', 'cloud.uploads', 'billing.portal']))).toEqual([]);
    expect(moreDestinationsFor(context('cloud', ['devices', 'rooms', 'billing.portal'])).map((item) => item.id))
      .toEqual(['account', 'billing', 'devices', 'rooms']);
    expect(moreDestinationsFor(context('cloud', ['devices', 'rooms', 'cloud.uploads', 'billing.portal'])).map((item) => item.id))
      .toEqual(['account', 'billing', 'devices', 'rooms', 'uploads']);
  });
});
