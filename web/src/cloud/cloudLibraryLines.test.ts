import { describe, expect, it } from 'vitest';
import { remoteLineWords } from './CloudLibrary';

// ADR-0475 R6 and R7: the Library's one quiet line when another device has the music.
describe('the Library line when another device has the music', () => {
  it('a device with none: it is a remote, and connecting music here is a choice', () => {
    expect(remoteLineWords(0, 2864, { name: 'Laptop', online: true })).toBe('This device is a remote for Laptop. Connect music here only if you want this device to make the sound.');
    expect(remoteLineWords(0, 2864, { name: 'Laptop', online: false })).toMatch(/^Your music is on Laptop, which isn’t open right now\./);
  });
  it('a device with some (R7): how much is here and where the rest is', () => {
    expect(remoteLineWords(4, 2864, { name: 'Laptop', online: true })).toBe('4 of 2,864 songs are on this device. The rest are on Laptop.');
    expect(remoteLineWords(4, 2864, { name: 'Laptop', online: false })).toBe('4 of 2,864 songs are on this device. The rest are on Laptop, which isn’t open right now.');
  });
});

describe('a phone whose browser forgot the songs it was given (R7)', () => {
  it('says how many need choosing again, not that it is only a remote', () => {
    expect(remoteLineWords(0, 2864, { name: 'Laptop', online: true }, 4)).toBe('4 songs on this device need choosing again to play here. The rest are on Laptop.');
    expect(remoteLineWords(0, 2864, { name: 'Laptop', online: true }, 1)).toBe('1 song on this device needs choosing again to play here. The rest are on Laptop.');
  });
});
