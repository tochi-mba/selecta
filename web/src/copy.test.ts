import { afterEach, describe, expect, it } from 'vitest';
import { copy, copyPlace, musicHomeOf, setCopyPlace, setMusicHome, words, type MusicHome } from './copy';
import { GLOSSARY } from './ui/glossaryTerms';
import { THEMES } from './ui/ThemeChoice';

const MACHINE_WORDS = /this PC|this computer|File Explorer|Restart SelectaDJ/i;

afterEach(() => { setCopyPlace('desktop'); setMusicHome('cloud_library'); });

const HOMES: MusicHome[] = ['cloud_library', 'device', 'both'];

describe('the copy layer', () => {
  it('keeps the local words exactly as they were', () => {
    expect(copy.desktop).toMatchSnapshot();
  });

  it('has Cloud words for every Desktop sentence, wherever the music lives', () => {
    expect(copy.cloud).toMatchSnapshot();
    for (const home of HOMES) expect(Object.keys(copy.cloud[home]).sort()).toEqual(Object.keys(copy.desktop).sort());
  });

  it('never tells a Cloud listener about their PC, File Explorer or restarting SelectaDJ', () => {
    for (const home of HOMES) {
      for (const [key, text] of Object.entries(copy.cloud[home])) expect([key, text]).not.toEqual([key, expect.stringMatching(MACHINE_WORDS)]);
    }
  });

  it('never tells a member with music on this device that it is uploaded or done by SelectaDJ Cloud', () => {
    // only the sentences that differ by home: the shared privacy note rightly names uploads too
    const own = Object.entries(copy.cloud.device).filter(([key, text]) => text !== copy.cloud.cloud_library[key as keyof typeof copy.desktop]);
    expect(own.length).toBeGreaterThan(5);
    for (const [key, text] of own) expect([key, text]).not.toEqual([key, expect.stringMatching(/(?<!not )upload(?!ed)|SelectaDJ Cloud (does|separates|listening)|by SelectaDJ Cloud|in SelectaDJ Cloud\./)]);
  });

  it('never tells a member whose music is in the cloud library that nothing is measured ahead', () => {
    for (const text of Object.values(copy.cloud.cloud_library)) expect(text).not.toMatch(/nothing is measured or rendered ahead/);
  });

  it('starts on Desktop and follows the server’s place, then where the music lives', () => {
    expect(copyPlace()).toBe('desktop');
    expect(words().startAudioStays).toBe('Your audio stays on this PC.');
    setCopyPlace('cloud');
    expect(words().startAudioStays).toBe('Your audio stays private to your workspace.');
    setMusicHome('device');
    expect(words().startAudioStays).toBe('Your audio stays on this device.');
    setCopyPlace('desktop');
    expect(words().startAudioStays).toBe('Your audio stays on this PC.');
  });

  it('reads where the music lives from what the account holds', () => {
    expect(musicHomeOf(true, true)).toBe('both');
    expect(musicHomeOf(true, false)).toBe('device');
    expect(musicHomeOf(false, true)).toBe('cloud_library');
    expect(musicHomeOf(false, false)).toBe('none');
  });

  it('reaches the glossary and theme names after they were loaded', () => {
    const rendered = () => GLOSSARY.find((term) => term.id === 'rendered')!.plain;
    const system = () => THEMES.find((theme) => theme.id === 'system')!.label;
    expect(rendered()).toMatch(/on this PC/);
    expect(system()).toBe('Match this computer');
    setCopyPlace('cloud');
    expect(rendered()).toMatch(/SelectaDJ Cloud/);
    expect(system()).toBe('Match this device');
  });
});
