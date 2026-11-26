import { describe, expect, it } from 'vitest';
import { musicHomeCopy, pageShown } from './api';

const account = (features: Record<string, boolean>) => ({ features });

describe('browser-first Cloud page gates', () => {
  it('keeps the Library visible when hosted uploads are revoked', () => {
    const noHostedWrites = account({ 'cloud.uploads': false, 'cloud.stored_media': true });
    expect(pageShown(noHostedWrites, 'uploads')).toBe(false);
    expect(pageShown(noHostedWrites, 'library')).toBe(true);
  });

  it('hides the Library only when its read surface itself is switched off', () => {
    expect(pageShown(account({ 'cloud.stored_media': false }), 'library')).toBe(false);
  });
});

describe('where the music lives picks one truthful copy layer', () => {
  it.each([
    [{ local_first: true, hosted: false }, 'device', 'stays on this device'],
    [{ local_first: false, hosted: true }, 'cloud_library', 'cloud library stays available'],
    [{ local_first: true, hosted: true }, 'both', 'stays on this device'],
    [{ local_first: false, hosted: false }, 'none', 'not been given access'],
  ] as const)('describes %j without product jargon or deprecation language', (experience, source, words) => {
    const copy = musicHomeCopy({ experience });
    expect(copy.source).toBe(source);
    expect(copy.privacy).toContain(words);
    expect(`${copy.heading} ${copy.privacy}`).not.toMatch(/local.first|metadata.only|legacy|deprecated/i);
  });
});
