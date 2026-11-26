import { afterEach, describe, expect, it } from 'vitest';
import { copy, copyPlace, musicHomeOf, setCopyPlace, setMusicHome, words, type MusicHome } from './copy';
import { setFlags } from './flags';
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

  it('never tells a member whose music is in the cloud library that nothing is prepared ahead', () => {
    for (const text of Object.values(copy.cloud.cloud_library)) expect(text).not.toMatch(/nothing is prepared/);
  });

  it('says what this device prepares ahead, for each of its two switches', () => {
    setCopyPlace('cloud');
    setMusicHome('device');
    const said = (features: Record<string, boolean>) => { setFlags(features); return words().libraryReadyMeaning; };
    try {
      const none = said({ 'cloud.device_analysis': false, 'cloud.device_render': false });
      const songs = said({ 'cloud.device_analysis': true, 'cloud.device_render': false });
      const transitions = said({ 'cloud.device_analysis': false, 'cloud.device_render': true });
      const all = said({ 'cloud.device_analysis': true, 'cloud.device_render': true });
      expect(none).toMatch(/nothing is prepared in advance/);
      expect(songs).toMatch(/prepares each song in the background/);
      expect(songs).not.toMatch(/ahead of time|nothing is prepared/);
      expect(transitions).toMatch(/next transitions on this device ahead of time/);
      expect(transitions).not.toMatch(/background|nothing is prepared/);
      expect(all).toMatch(/in the background.*ahead of time/);
      // a server that has not said leaves both off: nothing is claimed that may not happen
      expect(said({})).toBe(none);
      setMusicHome('both');
      expect(said({ 'cloud.device_analysis': true, 'cloud.device_render': true })).toMatch(/cloud library are prepared ahead of time; songs on this device are prepared in the background/);
      expect(said({})).toBe(copy.cloud.both.libraryReadyMeaning);
      for (const text of [none, songs, transitions, all]) expect(text).not.toMatch(/render|measure|flag/i);
    } finally {
      setFlags(null);
    }
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
