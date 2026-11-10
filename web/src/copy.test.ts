import { afterEach, describe, expect, it } from 'vitest';
import { copy, copyMode, setCopyMode, words } from './copy';
import { GLOSSARY } from './ui/glossaryTerms';
import { THEMES } from './ui/ThemeChoice';

const MACHINE_WORDS = /this PC|this computer|File Explorer|Restart Selecta/i;

afterEach(() => setCopyMode('local'));

describe('the copy layer', () => {
  it('keeps the local words exactly as they were', () => {
    expect(copy.local).toMatchSnapshot();
  });

  it('has Cloud words for every local sentence', () => {
    expect(copy.cloud).toMatchSnapshot();
    expect(Object.keys(copy.cloud).sort()).toEqual(Object.keys(copy.local).sort());
  });

  it('never tells a Cloud listener about their PC, File Explorer or restarting Selecta', () => {
    for (const [key, text] of Object.entries(copy.cloud)) expect([key, text]).not.toEqual([key, expect.stringMatching(MACHINE_WORDS)]);
  });

  it('starts local and follows the server’s mode', () => {
    expect(copyMode()).toBe('local');
    expect(words().startAudioStays).toBe('Your audio stays on this PC.');
    setCopyMode('cloud');
    expect(words().startAudioStays).toBe('Your audio stays private to your workspace.');
  });

  it('reaches the glossary and theme names after they were loaded', () => {
    const rendered = () => GLOSSARY.find((term) => term.id === 'rendered')!.plain;
    const system = () => THEMES.find((theme) => theme.id === 'system')!.label;
    expect(rendered()).toMatch(/on this PC/);
    expect(system()).toBe('Match this computer');
    setCopyMode('cloud');
    expect(rendered()).toMatch(/Selecta Cloud/);
    expect(system()).toBe('Match this device');
  });
});
